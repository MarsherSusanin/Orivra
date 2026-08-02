// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const runA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fdcHub = "0x3333333333333333333333333333333333333333";

const preflightEvidence = {
  version: "1",
  chainId: 114,
  fdcHub,
  requestBytes: "0x574542324a534f4e",
  requestCalldata: "0xfeedcafe",
  quotedFeeWei: "12345",
};

type Row = Record<string, any>;

function createPool(mode: "wallet" | "relayer" = "wallet") {
  const persistedManifest = {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
  const runs = new Map<string, Row>([
    [runA, {
      id: runA,
      project_id: projectA,
      manifest: persistedManifest,
      projection: { stages: { preflight: "completed" } },
    }],
    [runB, {
      id: runB,
      project_id: projectA,
      manifest: persistedManifest,
      projection: { stages: { preflight: "completed" } },
    }],
  ]);
  const commands = new Map<string, Row>();
  const shares: Row[] = [];

  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    const normalized = text.replace(/\s+/g, " ");
    const requestedRun = values.find(
      (value) => typeof value === "string" && runs.has(value),
    ) as string | undefined;
    const requestedProject = values.find(
      (value) => value === projectA || value === projectB,
    ) as string | undefined;
    const owned = requestedRun
      ? runs.get(requestedRun)?.project_id === requestedProject
      : false;

    if (/SELECT[\s\S]+FROM proofline_private\.run_artifacts/i.test(text)) {
      return owned
        ? {
            rowCount: 1,
            rows: [
              {
                ...runs.get(requestedRun!),
                kind: "preflight-evidence",
                canonical_bytes: Buffer.from(JSON.stringify(preflightEvidence)),
                metadata: preflightEvidence,
              },
            ],
          }
        : { rowCount: 0, rows: [] };
    }
    if (/SELECT[\s\S]+FROM proofline_private\.runs/i.test(text)) {
      return owned
        ? { rowCount: 1, rows: [{ ...runs.get(requestedRun!) }] }
        : { rowCount: 0, rows: [] };
    }
    if (/SELECT[\s\S]+FROM proofline_private\.run_commands/i.test(text)) {
      const idempotencyKey = values.find(
        (value) => typeof value === "string" && commands.has(`${requestedProject}:${value}`),
      );
      const row = commands.get(`${requestedProject}:${String(idempotencyKey)}`);
      return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    }
    if (/INSERT INTO proofline_private\.run_commands/i.test(text)) {
      const [, projectId, runId, idempotencyKey, kind, payload] = values;
      const key = `${String(projectId)}:${String(idempotencyKey)}`;
      if (commands.has(key)) return { rowCount: 0, rows: [] };
      const row = {
        id: values[0],
        project_id: projectId,
        run_id: runId,
        idempotency_key: idempotencyKey,
        kind,
        payload: typeof payload === "string" ? JSON.parse(payload) : payload,
      };
      commands.set(key, row);
      return { rowCount: 1, rows: [row] };
    }
    if (/INSERT INTO proofline_private\.share_tokens/i.test(text)) {
      shares.push({ values, sql: normalized });
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  });

  const client = { query, release: vi.fn() };
  return {
    pool: {
      query,
      connect: vi.fn().mockResolvedValue(client),
    },
    commands,
    shares,
    query,
  };
}

function service(harness: ReturnType<typeof createPool>) {
  return createProductionProoflineService({
    pool: harness.pool as any,
    tokenDigestKey: "slice-003-token-digest-key",
    publicWebOrigin: "https://proofline.test",
  });
}

describe("Slice 003 production wallet preparation", () => {
  it("returns the exact persisted unsigned Coston2 transaction synchronously", async () => {
    const harness = createPool();
    const result = await service(harness).createSubmission({
      projectId: projectA,
      runId: runA,
      idempotencyKey: "wallet-prepare-1",
      mode: "wallet",
    });

    expect(result).toEqual({
      version: "1",
      runId: runA,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: {
        chainId: "0x72",
        to: fdcHub,
        data: "0xfeedcafe",
        value: "0x3039",
      },
    });
    expect(
      [...harness.commands.values()].filter((row) => row.kind === "SUBMIT_WALLET"),
      "An async SUBMIT_WALLET command has no public transaction readback path",
    ).toEqual([]);
  });
});

describe("Slice 003 production ownership and idempotency intent", () => {
  it("rejects a submission for a run owned by another project before enqueue", async () => {
    const harness = createPool();
    await expect(
      service(harness).createSubmission({
        projectId: projectB,
        runId: runA,
        idempotencyKey: "foreign-submission",
        mode: "relayer",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(harness.commands.size).toBe(0);
  });

  it("rejects share creation for a run owned by another project", async () => {
    const harness = createPool();
    await expect(
      service(harness).createShare({
        projectId: projectB,
        runId: runA,
        idempotencyKey: "foreign-share",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(harness.shares).toEqual([]);
  });

  it("returns a conflict when one idempotency key is reused for another run", async () => {
    const harness = createPool("relayer");
    const productionService = service(harness);
    await expect(
      productionService.createSubmission({
        projectId: projectA,
        runId: runA,
        idempotencyKey: "submission-intent-1",
        mode: "relayer",
      }),
    ).resolves.toMatchObject({
      version: "1",
      runId: runA,
      mode: "relayer",
      effectOwner: "worker",
      commandId: expect.any(String),
    });

    await expect(
      productionService.createSubmission({
        projectId: projectA,
        runId: runB,
        idempotencyKey: "submission-intent-1",
        mode: "relayer",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(harness.commands.size).toBe(1);
  });
});
