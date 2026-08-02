// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111110";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0";
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;
const FDC_HUB = "0x3333333333333333333333333333333333333333";

type SubmissionMode = "wallet" | "relayer" | "replay";

function manifest(mode: SubmissionMode) {
  return {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
}

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function harness(mode: SubmissionMode) {
  const commands = new Map<string, Record<string, unknown>>();
  const query = vi.fn(
    async (text: string, values: readonly unknown[] = []) => {
      if (/LEFT JOIN LATERAL/i.test(text)) {
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: manifest(mode),
            projection: { stages: { preflight: "completed" } },
            kind: "preflight-evidence",
            canonical_bytes: Buffer.from(
              JSON.stringify({
                chainId: 114,
                fdcHub: FDC_HUB,
                requestCalldata: "0xfeedcafe",
                quotedFeeWei: "12345",
              }),
            ),
          },
        ]);
      }
      if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: manifest(mode),
            projection: { stages: { preflight: "completed" } },
            last_sequence: 2,
          },
        ]);
      }
      if (
        /SELECT project_id, run_id, idempotency_key, kind, payload/i.test(text)
      ) {
        const key = String(values[1] ?? "");
        const existing = commands.get(key);
        return existing ? result([existing]) : result([], 0);
      }
      if (/kind = 'SUBMIT_RELAYER'/i.test(text)) {
        const existing = [...commands.values()].find(
          (command) => command.kind === "SUBMIT_RELAYER",
        );
        return existing ? result([existing]) : result([], 0);
      }
      if (/INSERT INTO proofline_private\.run_commands/i.test(text)) {
        const row = {
          id: values[0],
          project_id: values[1],
          run_id: values[2],
          idempotency_key: values[3],
          kind: values[4],
          payload: JSON.parse(String(values[5])),
        };
        commands.set(String(values[3]), row);
        return result([row]);
      }
      return result([], 1);
    },
  );
  return {
    commands,
    query,
    service: createProductionProoflineService({
      pool: { query } as any,
      tokenDigestKey: "slice-010-contract-key",
      publicWebOrigin: "https://proofline.test",
    }),
  };
}

function mismatch() {
  return {
    status: 409,
    code: "SUBMISSION_MODE_MISMATCH",
  };
}

describe("Slice 010 API submission authority", () => {
  it("rejects relayer submission for a wallet manifest before command insert", async () => {
    const fixture = harness("wallet");

    await expect(
      fixture.service.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "wallet-cannot-relay",
        mode: "relayer",
      }),
    ).rejects.toMatchObject(mismatch());
    expect(fixture.commands).toHaveLength(0);
  });

  it("rejects wallet attachment for a relayer manifest before command insert", async () => {
    const fixture = harness("relayer");

    await expect(
      fixture.service.attachTransaction({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "relayer-cannot-attach",
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject(mismatch());
    expect(fixture.commands).toHaveLength(0);
  });

  it.each([
    ["wallet transaction preparation", "wallet"],
    ["relayer submission", "relayer"],
  ] as const)("rejects %s for a replay manifest", async (_label, requestedMode) => {
    const fixture = harness("replay");

    await expect(
      fixture.service.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: `replay-cannot-${requestedMode}`,
        mode: requestedMode,
      }),
    ).rejects.toMatchObject(mismatch());
    expect(fixture.commands).toHaveLength(0);
  });

  it("rejects wallet attachment for a replay manifest", async () => {
    const fixture = harness("replay");

    await expect(
      fixture.service.attachTransaction({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "replay-cannot-attach",
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject(mismatch());
    expect(fixture.commands).toHaveLength(0);
  });

  it.each(["wallet", "relayer"] as const)(
    "keeps an exact selected %s retry idempotent",
    async (mode) => {
      const fixture = harness(mode);
      const first =
        mode === "wallet"
          ? () =>
              fixture.service.attachTransaction({
                runId: RUN_ID,
                projectId: PROJECT_ID,
                idempotencyKey: "selected-retry",
                transactionHash: TRANSACTION_HASH,
              })
          : () =>
              fixture.service.createSubmission({
                runId: RUN_ID,
                projectId: PROJECT_ID,
                idempotencyKey: "selected-retry",
                mode,
              });

      const accepted = await first();
      if (mode === "wallet") {
        expect(accepted).toEqual({ accepted: true, runId: RUN_ID });
      } else {
        expect(accepted).toMatchObject({
          version: "1",
          runId: RUN_ID,
          mode: "relayer",
          effectOwner: "worker",
          commandId: expect.any(String),
        });
      }
      await expect(first()).resolves.toEqual(accepted);
      expect(fixture.commands).toHaveLength(1);
    },
  );
});
