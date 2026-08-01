// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) as string;
}

function row(input: {
  report?: unknown;
  sha256?: Buffer | null;
  projection?: unknown;
  metadata?: unknown;
} = {}) {
  const bytes = input.report === undefined
    ? null
    : Buffer.from(canonicalJson(input.report), "utf8");
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    projection: input.projection ?? {
      version: "1",
      runId: RUN_ID,
      sequence: 2,
      terminal: false,
      stages: {
        preflight: "completed",
        request: "active",
        round: "pending",
        proof: "pending",
        verify: "pending",
        consumer: "pending",
      },
    },
    canonical_bytes: bytes,
    sha256:
      input.sha256 === undefined && bytes
        ? createHash("sha256").update(bytes).digest()
        : input.sha256,
    metadata: input.metadata ?? {},
  };
}

function serviceWith(result: { rowCount: number; rows: Record<string, unknown>[] }) {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => result);
  const service = createProductionProoflineService({
    pool: { query } as any,
    tokenDigestKey: "slice016-test-digest-key-with-32-bytes",
    publicWebOrigin: "https://proofline.test",
  }) as any;
  return { service, query };
}

async function read(service: any) {
  expect(
    service.getPreflightReport,
    "Slice 016A requires the production persisted-report service boundary",
  ).toBeTypeOf("function");
  return service.getPreflightReport({ projectId: PROJECT_ID, runId: RUN_ID });
}

describe("Slice 016A persisted preflight report read", () => {
  it("scopes by project, verifies canonical bytes and digest, parses V1 and ignores metadata", async () => {
    const fixture = serviceWith({
      rowCount: 1,
      rows: [
        row({
          report: validPreflightReport,
          metadata: {
            report: { ...validPreflightReport, verdict: "blocked" },
            requestBytes: "0xprivate",
          },
        }),
      ],
    });

    await expect(read(fixture.service)).resolves.toEqual(validPreflightReport);
    expect(fixture.query).toHaveBeenCalledOnce();
    const [sql, values] = fixture.query.mock.calls[0];
    expect(sql).toMatch(/run_artifacts|preflight-report-v1/i);
    expect(sql).toMatch(/project_id\s*=\s*\$2/i);
    expect(values).toEqual([RUN_ID, PROJECT_ID]);
  });

  it("uses the same not-found contract for a missing or foreign run", async () => {
    const fixture = serviceWith({ rowCount: 0, rows: [] });

    await expect(read(fixture.service)).rejects.toMatchObject({ status: 404 });
  });

  it("distinguishes an active pending report from a terminal legacy run without one", async () => {
    const pending = serviceWith({
      rowCount: 1,
      rows: [
        row({
          projection: {
            version: "1",
            runId: RUN_ID,
            sequence: 1,
            terminal: false,
            stages: { preflight: "active" },
          },
        }),
      ],
    });
    await expect(read(pending.service)).rejects.toMatchObject({
      status: 409,
      code: "PREFLIGHT_REPORT_PENDING",
    });

    const unavailable = serviceWith({
      rowCount: 1,
      rows: [
        row({
          projection: {
            version: "1",
            runId: RUN_ID,
            sequence: 7,
            terminal: true,
            stages: { preflight: "completed" },
          },
        }),
      ],
    });
    await expect(read(unavailable.service)).rejects.toMatchObject({
      status: 409,
      code: "PREFLIGHT_REPORT_UNAVAILABLE",
    });
  });

  it.each([
    [
      "stored digest mismatch",
      row({ report: validPreflightReport, sha256: Buffer.alloc(32, 0xff) }),
    ],
    [
      "invalid JSON bytes",
      {
        ...row({ report: validPreflightReport }),
        canonical_bytes: Buffer.from("{invalid", "utf8"),
        sha256: createHash("sha256").update("{invalid").digest(),
      },
    ],
    [
      "schema-invalid report",
      row({ report: { ...validPreflightReport, sampleFingerprints: [] } }),
    ],
    [
      "valid JSON stored in non-canonical key order",
      (() => {
        const canonicalBytes = Buffer.from(JSON.stringify(validPreflightReport), "utf8");
        return {
          ...row({ report: validPreflightReport }),
          canonical_bytes: canonicalBytes,
          sha256: createHash("sha256").update(canonicalBytes).digest(),
        };
      })(),
    ],
    [
      "report bound to another run",
      row({ report: { ...validPreflightReport, runId: "run_other" } }),
    ],
  ])("fails closed for %s", async (_label, corruptRow) => {
    const fixture = serviceWith({ rowCount: 1, rows: [corruptRow] });

    await expect(read(fixture.service)).rejects.toMatchObject({
      status: 500,
      code: "PREFLIGHT_REPORT_INVALID",
    });
  });
});
