// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  makeBundleInput,
  makeRunEvents,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WALLET_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0";
const CLAIM = "11111111-1111-4111-8111-111111111111";
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const relayerManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "relayer" as const },
};

function service(pool: any) {
  return createProductionProoflineService({
    pool,
    tokenDigestKey: "coverage-digest-key",
    publicWebOrigin: "https://proofline.test/",
  });
}

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

describe("production service run transaction coverage", () => {
  it("creates a run atomically and returns an existing byte-identical intent", async () => {
    const expectedFingerprint = createHash("sha256")
      .update(JSON.stringify(validManifest))
      .digest();
    let existing = false;
    const client = {
      query: vi.fn(async (text: string) => {
        if (/SELECT id, request_fingerprint/i.test(text)) {
          return existing
            ? result([{ id: RUN_ID, request_fingerprint: expectedFingerprint }])
            : result([], 0);
        }
        return result([], 1);
      }),
      release: vi.fn(),
    };
    const production = service({
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(),
    });

    const created = await production.createRun({
      projectId: PROJECT_ID,
      idempotencyKey: "create-1",
      manifest: validManifest,
    });
    expect(created).toMatchObject({ status: "accepted" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO proofline_private\.runs/i),
      expect.arrayContaining([PROJECT_ID, "create-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/RUN_PREFLIGHT/),
      expect.any(Array),
    );

    client.query.mockClear();
    existing = true;
    await expect(
      production.createRun({
        projectId: PROJECT_ID,
        idempotencyKey: "create-1",
        manifest: validManifest,
      }),
    ).resolves.toEqual({
      status: "accepted",
      runId: RUN_ID,
      location: `/v1/runs/${RUN_ID}`,
    });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it("rolls back both idempotency conflicts and storage failures", async () => {
    const conflictClient = {
      query: vi.fn(async (text: string) =>
        /SELECT id, request_fingerprint/i.test(text)
          ? result([{ id: RUN_ID, request_fingerprint: Buffer.alloc(32, 9) }])
          : result([], 1),
      ),
      release: vi.fn(),
    };
    await expect(
      service({ connect: vi.fn().mockResolvedValue(conflictClient) }).createRun({
        projectId: PROJECT_ID,
        idempotencyKey: "conflict",
        manifest: validManifest,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(conflictClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(conflictClient.release).toHaveBeenCalledOnce();

    const failingClient = {
      query: vi.fn(async (text: string) => {
        if (/SELECT id, request_fingerprint/i.test(text)) return result([], 0);
        if (/INSERT INTO proofline_private\.runs/i.test(text)) {
          throw new Error("storage unavailable");
        }
        return result([], 1);
      }),
      release: vi.fn(),
    };
    await expect(
      service({ connect: vi.fn().mockResolvedValue(failingClient) }).createRun({
        projectId: PROJECT_ID,
        idempotencyKey: "storage-failure",
        manifest: validManifest,
      }),
    ).rejects.toThrow(/storage unavailable/i);
    expect(failingClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(failingClient.release).toHaveBeenCalledOnce();
  });
});

describe("production service read, artifact, replay, and share coverage", () => {
  it("serves owned projections, events, consumers, bundles, replay, and shares", async () => {
    const events = makeRunEvents();
    const bundle = createProofBundle(makeBundleInput());
    const serialized = canonicalSerializeProofBundle(bundle);
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/SELECT projection/i.test(text)) {
        return result([{ projection: { runId: RUN_ID, terminal: true } }]);
      }
      if (/SELECT event_payload/i.test(text)) {
        return result(events.slice(0, 2).map((event_payload) => ({ event_payload })));
      }
      if (/SELECT manifest FROM proofline_private\.runs/i.test(text)) {
        return result([{ manifest: validManifest }]);
      }
      if (/artifact\.kind = 'proof-bundle'/i.test(text)) {
        return result([{
          canonical_bytes: Buffer.from(serialized),
          sha256: createHash("sha256").update(serialized).digest(),
        }]);
      }
      if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {},
            last_sequence: 2,
          },
        ]);
      }
      if (/INSERT INTO proofline_private\.share_tokens/i.test(text)) {
        expect(values[3]).toBeInstanceOf(Uint8Array);
        return result([], 1);
      }
      return result([], 1);
    });
    const production = service({ query });

    await expect(
      production.getRun({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).resolves.toEqual({ runId: RUN_ID, terminal: true });
    await expect(
      production.listEvents({ runId: RUN_ID, projectId: PROJECT_ID, after: 0 }),
    ).resolves.toEqual({ events: events.slice(0, 2), nextAfter: 2 });
    await expect(
      production.generateConsumer({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).resolves.toMatchObject({
      source: expect.stringContaining("contract ProoflineSafeWeb2JsonConsumer"),
    });
    await expect(
      production.generateConsumer({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        contractName: "CoverageConsumer",
      }),
    ).resolves.toMatchObject({
      source: expect.stringContaining("contract CoverageConsumer"),
    });
    await expect(
      production.getBundle({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).resolves.toEqual(serialized);
    await expect(production.replay({ bundle: serialized })).resolves.toEqual({
      runId: bundle.runId,
      byteIdentical: true,
      checksum: bundle.checksum,
    });
    const share = await production.createShare({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      expiresAt: "2025-05-16T12:04:11.000Z",
    });
    expect(share).toMatchObject({ version: "1", runId: RUN_ID });
    expect(share.url).toMatch(
      new RegExp(`^https://proofline\\.test/runs/${RUN_ID}#share=share_[a-f0-9]{64}$`),
    );
    expect(share).not.toHaveProperty("token");
  });

  it("fails closed for missing IDs, foreign runs, and unavailable artifacts", async () => {
    const production = service({ query: vi.fn(async () => result([], 0)) });
    await expect(production.getRun({ runId: "", projectId: PROJECT_ID })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      production.getRun({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      production.generateConsumer({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      production.getBundle({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      production.createShare({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ status: 404 });

    const emptyEvents = service({ query: vi.fn(async () => result([], 0)) });
    await expect(
      emptyEvents.listEvents({ runId: RUN_ID, projectId: PROJECT_ID }),
    ).resolves.toEqual({ events: [], nextAfter: 0 });
  });
});

describe("production service submission and command intent coverage", () => {
  it("enqueues selected commands on distinct persisted run authorities", async () => {
    const commands = new Map<string, Record<string, unknown>>();
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
        const selectedRunId = String(values[0]);
        return result([{
          id: selectedRunId,
          project_id: PROJECT_ID,
          manifest:
            selectedRunId === WALLET_RUN_ID ? validManifest : relayerManifest,
          projection: { stages: { preflight: "completed" } },
        }]);
      }
      if (/SELECT project_id, run_id, idempotency_key, kind, payload/i.test(text)) {
        const row = /idempotency_key\s*=\s*\$2/i.test(text)
          ? commands.get(String(values[1]))
          : [...commands.values()].find(
              (command) => command.run_id === values[0],
            );
        return row ? result([row]) : result([], 0);
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
    });
    const production = service({ query });
    const base = { runId: RUN_ID, projectId: PROJECT_ID };

    const relayerContext = {
      ...base,
      mode: "relayer" as const,
      idempotencyKey: "submit-1",
    };
    const acceptedRelayer = await production.createSubmission(relayerContext);
    expect(acceptedRelayer).toMatchObject({
      version: "1",
      runId: RUN_ID,
      mode: "relayer",
      effectOwner: "worker",
      commandId: expect.any(String),
    });
    await expect(production.createSubmission(relayerContext)).resolves.toEqual(
      acceptedRelayer,
    );
    await production.attachTransaction({
      ...base,
      runId: WALLET_RUN_ID,
      idempotencyKey: "attach-1",
      transactionHash: `0x${"9".repeat(64)}`,
    });
    await production.verifyConsumer({
      ...base,
      idempotencyKey: "verify-1",
      consumer: "canonical-vulnerable",
    });
    await production.verifyConsumer({
      ...base,
      idempotencyKey: "verify-2",
      consumer: "canonical-safe",
    });
    expect([...commands.values()].map((row) => row.kind)).toEqual([
      "SUBMIT_RELAYER",
      "ATTACH_WALLET_TRANSACTION",
      "VERIFY_CONSUMER",
      "VERIFY_CONSUMER",
    ]);
  });

  it("rejects unsupported modes, ownership failures, and raced intent conflicts", async () => {
    const missing = service({ query: vi.fn(async () => result([], 0)) });
    await expect(
      missing.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "missing",
        mode: "relayer",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      missing.createSubmission({ runId: RUN_ID, projectId: PROJECT_ID, mode: "other" }),
    ).rejects.toMatchObject({ status: 400 });

    let commandSelects = 0;
    const raced = service({
      query: vi.fn(async (text: string) => {
        if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
          return result([{ id: RUN_ID, project_id: PROJECT_ID, manifest: validManifest }]);
        }
        if (/SELECT project_id, run_id, idempotency_key, kind, payload/i.test(text)) {
          commandSelects += 1;
          return commandSelects === 1
            ? result([], 0)
            : result([
                {
                  run_id: RUN_ID,
                  kind: "VERIFY_CONSUMER",
                  payload: { consumer: "wrong" },
                },
              ]);
        }
        if (/INSERT INTO proofline_private\.run_commands/i.test(text)) return result([], 0);
        return result([], 1);
      }),
    });
    await expect(
      raced.verifyConsumer({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "race",
        consumer: "canonical-safe",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["hub", { fdcHub: "not-an-address" }],
    ["calldata", { requestCalldata: "0x1" }],
    ["fee", { quotedFeeWei: "-1" }],
  ])("rejects invalid persisted wallet %s evidence", async (_label, override) => {
    const evidence = {
      chainId: 114,
      fdcHub: FDC_HUB,
      requestCalldata: "0xfeedcafe",
      quotedFeeWei: "12345",
      ...override,
    };
    const production = service({
      query: vi.fn(async (text: string) => {
        if (/FROM proofline_private\.run_commands/i.test(text)) {
          return result([], 0);
        }
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {
              terminal: false,
              stages: { preflight: "completed", request: "pending" },
            },
            canonical_bytes: Buffer.from(JSON.stringify(evidence)),
          },
        ]);
      }),
    });
    await expect(
      production.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode: "wallet",
        idempotencyKey: `invalid-wallet-${_label}`,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("supports exact nested wallet evidence and rejects missing evidence", async () => {
    const nested = service({
      query: vi.fn(async (text: string) => {
        if (/FROM proofline_private\.run_commands/i.test(text)) {
          return result([], 0);
        }
        return result([
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {
              terminal: false,
              stages: { preflight: "completed", request: "pending" },
            },
            canonical_bytes: Buffer.from(
              JSON.stringify({
                version: "1",
                canonicalUrl: "https://api.example.com/prices/eth",
                requestBytes: "0x1234abcd",
                network: {
                  chainId: 114,
                  blockNumber: "12345678",
                  registryAddress:
                    "0x2222222222222222222222222222222222222222",
                  resolvedContracts: {
                    FdcHub: FDC_HUB,
                    FdcRequestFeeConfigurations:
                      "0x6666666666666666666666666666666666666666",
                    FdcVerification:
                      "0x1111111111111111111111111111111111111111",
                    Relay: "0x4444444444444444444444444444444444444444",
                  },
                },
                requestCalldata: "0xfeedcafe",
                quotedFeeWei: "12345",
              }),
            ),
          },
        ]);
      }),
    });
    await expect(
      nested.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode: "wallet",
        idempotencyKey: "nested-wallet",
      }),
    ).resolves.toMatchObject({
      version: "1",
      runId: RUN_ID,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: { chainId: "0x72", to: FDC_HUB },
    });
    const missing = service({ query: vi.fn(async () => result([], 0)) });
    await expect(
      missing.createSubmission({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        mode: "wallet",
        idempotencyKey: "missing-wallet",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
