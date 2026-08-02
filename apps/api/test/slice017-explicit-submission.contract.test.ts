// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  validManifest,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111117";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa017";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const TX_HASH = `0x${"9".repeat(64)}`;
const FDC_HUB = "0x3333333333333333333333333333333333333333";

type SubmissionMode = "wallet" | "relayer" | "replay";

function manifest(mode: SubmissionMode) {
  return {
    ...validManifest,
    submission: { ...validManifest.submission, mode },
  };
}

function request(
  body: unknown,
  input: { token?: string; idempotencyKey?: string } = {},
) {
  return new Request(`https://api.proofline.test/v1/runs/${RUN_ID}/submissions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token ?? PROJECT_TOKEN}`,
      "content-type": "application/json",
      ...(input.idempotencyKey === undefined
        ? {}
        : { "idempotency-key": input.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

describe("Slice 017 HTTP confirmation boundary", () => {
  it("requires an explicit mode and idempotency key and forwards all three modes", async () => {
    const createSubmission = vi.fn(async (context: Record<string, unknown>) => ({
      version: "1",
      runId: RUN_ID,
      mode: context.mode,
      effectOwner:
        context.mode === "wallet"
          ? "wallet"
          : context.mode === "relayer"
            ? "worker"
            : "none",
      ...(context.mode === "wallet"
        ? {
            transaction: {
              chainId: "0x72",
              to: FDC_HUB,
              data: "0xfeedcafe",
              value: "0x3039",
            },
          }
        : { commandId: `command_${String(context.mode)}` }),
    }));
    const api = createProoflineApi({
      service: { createSubmission },
      authenticate: vi.fn(async (token: string) =>
        token === PROJECT_TOKEN
          ? { kind: "project" as const, projectId: PROJECT_ID }
          : token === SHARE_TOKEN
            ? { kind: "share" as const, projectId: PROJECT_ID, runId: RUN_ID }
            : null,
      ),
    });

    expect((await api.fetch(request({}, { idempotencyKey: "missing-mode" }))).status).toBe(400);
    expect((await api.fetch(request({ mode: "replay" }))).status).toBe(400);

    for (const mode of ["wallet", "relayer", "replay"] as const) {
      const response = await api.fetch(
        request({ mode }, { idempotencyKey: `confirm-${mode}` }),
      );
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        version: "1",
        runId: RUN_ID,
        mode,
      });
    }
    expect(createSubmission.mock.calls.map(([context]) => context)).toEqual([
      expect.objectContaining({ projectId: PROJECT_ID, runId: RUN_ID, mode: "wallet", idempotencyKey: "confirm-wallet" }),
      expect.objectContaining({ projectId: PROJECT_ID, runId: RUN_ID, mode: "relayer", idempotencyKey: "confirm-relayer" }),
      expect.objectContaining({ projectId: PROJECT_ID, runId: RUN_ID, mode: "replay", idempotencyKey: "confirm-replay" }),
    ]);
  });

  it("keeps project mutation authority and rejects share confirmation before the service", async () => {
    const createSubmission = vi.fn();
    const api = createProoflineApi({
      service: { createSubmission },
      authenticate: vi.fn(async () => ({
        kind: "share" as const,
        projectId: PROJECT_ID,
        runId: RUN_ID,
      })),
    });
    const response = await api.fetch(
      request({ mode: "replay" }, { token: SHARE_TOKEN, idempotencyKey: "share-cannot-confirm" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "SHARE_READ_ONLY" },
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });
});

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function serviceHarness(input: {
  mode: SubmissionMode;
  preflight?: "completed" | "active";
  request?: "pending" | "completed";
  terminal?: boolean;
}) {
  const commands: Record<string, unknown>[] = [];
  const projection = {
    terminal: input.terminal ?? false,
    stages: {
      preflight: input.preflight ?? "completed",
      request: input.request ?? "pending",
      round: "pending",
      proof: "pending",
      verify: "pending",
      consumer: "pending",
    },
  };
  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    if (/LEFT JOIN LATERAL/i.test(sql)) {
      return result([{
        id: RUN_ID,
        project_id: PROJECT_ID,
        manifest: manifest(input.mode),
        projection,
        kind: "preflight-evidence",
        canonical_bytes: Buffer.from(JSON.stringify({
          version: "1",
          canonicalUrl: validPreflightReport.canonicalUrl,
          requestBytes: "0x1234abcd",
          requestCalldata: "0xfeedcafe",
          quotedFeeWei: "12345",
          network: {
            ...validPreflightReport.registrySnapshot,
            chainId: 114,
            resolvedContracts: {
              ...validPreflightReport.registrySnapshot.resolvedContracts,
              FdcHub: FDC_HUB,
            },
          },
        })),
      }]);
    }
    if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(sql)) {
      return result([{
        id: RUN_ID,
        project_id: PROJECT_ID,
        manifest: manifest(input.mode),
        projection,
        last_sequence: 2,
      }]);
    }
    if (/SELECT project_id, run_id, idempotency_key, kind, payload/i.test(sql)) {
      if (/idempotency_key\s*=\s*\$2/i.test(sql)) {
        const found = commands.find(
          (command) => command.idempotency_key === values[1],
        );
        return found ? result([found]) : result([], 0);
      }
      const found = commands.find(
        (command) => command.run_id === values[0] && command.status !== "cancelled",
      );
      return found ? result([found]) : result([], 0);
    }
    if (/INSERT INTO proofline_private\.run_commands/i.test(sql)) {
      const command = {
        id: values[0],
        project_id: values[1],
        run_id: values[2],
        idempotency_key: values[3],
        kind: values[4],
        payload: JSON.parse(String(values[5])),
        status: "queued",
      };
      commands.push(command);
      return result([command]);
    }
    return result([], 0);
  });
  const createService = () => createProductionProoflineService({
    pool: { query } as any,
    tokenDigestKey: "slice-017-contract-key",
    publicWebOrigin: "https://proofline.test",
  });
  return {
    commands,
    query,
    service: createService(),
    restartService: createService,
  };
}

describe("Slice 017 persisted confirmation authority", () => {
  it.each([
    ["relayer", "SUBMIT_RELAYER", "worker"],
    ["replay", "APPLY_REPLAY_EVIDENCE", "none"],
  ] as const)(
    "creates exactly one explicit %s command and returns its effect identity",
    async (mode, kind, effectOwner) => {
      const fixture = serviceHarness({ mode });
      const context = {
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode,
        idempotencyKey: `confirm-${mode}`,
      };
      const first = await fixture.service.createSubmission(context);
      const retry = await fixture.service.createSubmission(context);

      expect(first).toEqual(retry);
      expect(first).toMatchObject({
        version: "1",
        runId: RUN_ID,
        mode,
        effectOwner,
        commandId: expect.any(String),
      });
      expect(fixture.commands).toHaveLength(1);
      expect(fixture.commands[0]).toMatchObject({
        run_id: RUN_ID,
        idempotency_key: `confirm-${mode}`,
        kind,
      });
    },
  );

  it("returns wallet-owned transaction identity without creating a worker command", async () => {
    const fixture = serviceHarness({ mode: "wallet" });
    await expect(fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "wallet",
      idempotencyKey: "confirm-wallet",
    })).resolves.toMatchObject({
      version: "1",
      runId: RUN_ID,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: {
        chainId: "0x72",
        to: FDC_HUB,
        data: "0xfeedcafe",
        value: "0x3039",
      },
    });
    expect(fixture.commands).toHaveLength(0);
  });

  it("reconciles an exact wallet attachment retry without creating a duplicate authority", async () => {
    const fixture = serviceHarness({ mode: "wallet" });
    const attachment = {
      runId: RUN_ID,
      projectId: PROJECT_ID,
      idempotencyKey: "wallet-authority",
      transactionHash: TX_HASH,
    };

    const first = await fixture.service.attachTransaction(attachment);
    const retry = await fixture.service.attachTransaction(attachment);
    expect(retry).toEqual(first);
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.commands[0]).toMatchObject({
      kind: "ATTACH_WALLET_TRANSACTION",
      payload: { transactionHash: TX_HASH },
    });
  });

  it("refuses a new unsigned wallet transaction after persisted attachment authority survives restart", async () => {
    const fixture = serviceHarness({ mode: "wallet" });
    await fixture.service.attachTransaction({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      idempotencyKey: "wallet-authority",
      transactionHash: TX_HASH,
    });
    expect(fixture.commands).toHaveLength(1);

    await expect(fixture.restartService().createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "wallet",
      idempotencyKey: "wallet-rebroadcast-after-restart",
    })).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
    expect(fixture.commands).toHaveLength(1);
  });

  it("refuses a new unsigned wallet transaction when the persisted projection proves request submission", async () => {
    const fixture = serviceHarness({
      mode: "wallet",
      request: "completed",
    });

    await expect(fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "wallet",
      idempotencyKey: "wallet-rebroadcast-after-event",
    })).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
    expect(fixture.commands).toHaveLength(0);
  });

  it.each(["wallet", "relayer", "replay"] as const)(
    "rejects %s confirmation until preflight is completed",
    async (mode) => {
      const fixture = serviceHarness({ mode, preflight: "active" });
      await expect(fixture.service.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode,
        idempotencyKey: `not-ready-${mode}`,
      })).rejects.toMatchObject({ status: 409, code: "PREFLIGHT_NOT_READY" });
      expect(fixture.commands).toHaveLength(0);
    },
  );

  it.each(["wallet", "relayer", "replay"] as const)(
    "rejects terminal %s confirmation with one stable conflict",
    async (mode) => {
      const fixture = serviceHarness({ mode, terminal: true });
      await expect(fixture.service.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode,
        idempotencyKey: `terminal-${mode}`,
      })).rejects.toMatchObject({ status: 409, code: "RUN_TERMINAL" });
      expect(fixture.commands).toHaveLength(0);
    },
  );

  it("rejects requested mode drift before creating an effect authority", async () => {
    const fixture = serviceHarness({ mode: "wallet" });
    await expect(fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "replay",
      idempotencyKey: "mode-drift",
    })).rejects.toMatchObject({ status: 409, code: "SUBMISSION_MODE_MISMATCH" });
    expect(fixture.commands).toHaveLength(0);
  });

  it("requires completed preflight before wallet tx attachment", async () => {
    const fixture = serviceHarness({ mode: "wallet", preflight: "active" });
    await expect(fixture.service.attachTransaction({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      idempotencyKey: "attach-before-ready",
      transactionHash: TX_HASH,
    })).rejects.toMatchObject({ status: 409, code: "PREFLIGHT_NOT_READY" });
    expect(fixture.commands).toHaveLength(0);
  });

  it.each(["relayer", "replay"] as const)(
    "rejects wallet tx attachment for persisted %s mode",
    async (mode) => {
      const fixture = serviceHarness({ mode, preflight: "completed" });
      await expect(fixture.service.attachTransaction({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: `attach-${mode}`,
        transactionHash: TX_HASH,
      })).rejects.toMatchObject({
        status: 409,
        code: "SUBMISSION_MODE_MISMATCH",
      });
      expect(fixture.commands).toHaveLength(0);
    },
  );

  it("fails closed when one idempotency key changes its confirmed intent", async () => {
    const fixture = serviceHarness({ mode: "relayer" });
    await fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "relayer",
      idempotencyKey: "one-intent",
    });
    await expect(fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "replay",
      idempotencyKey: "one-intent",
    })).rejects.toMatchObject({ status: 409 });
    expect(fixture.commands).toHaveLength(1);
  });

  it("uses one stable conflict when a second key competes for run authority", async () => {
    const fixture = serviceHarness({ mode: "relayer" });
    await fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "relayer",
      idempotencyKey: "first-authority",
    });
    await expect(fixture.service.createSubmission({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      mode: "relayer",
      idempotencyKey: "competing-authority",
    })).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
    expect(fixture.commands).toHaveLength(1);
  });

  it("uses one stable conflict when wallet attachment changes under the same key", async () => {
    const fixture = serviceHarness({ mode: "wallet" });
    await fixture.service.attachTransaction({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      idempotencyKey: "wallet-intent",
      transactionHash: TX_HASH,
    });
    await expect(fixture.service.attachTransaction({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      idempotencyKey: "wallet-intent",
      transactionHash: `0x${"8".repeat(64)}`,
    })).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
    expect(fixture.commands).toHaveLength(1);
  });
});
