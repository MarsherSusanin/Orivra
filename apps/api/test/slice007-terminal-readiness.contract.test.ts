// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionCliDependencies } from "../../../packages/cli/src/index";
import { createProoflineApi } from "../src/app";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const TRANSACTION_HASH = `0x${"b".repeat(64)}`;

function terminalPool() {
  const query = vi.fn(async (text: string) => {
    if (/SELECT[\s\S]+FROM proofline_private\.run_commands/i.test(text)) {
      return { rowCount: 0, rows: [] };
    }
    if (/SELECT[\s\S]+FROM proofline_private\.runs/i.test(text)) {
      return {
        rowCount: 1,
        rows: [
          {
            id: RUN_ID,
            project_id: PROJECT_ID,
            manifest: validManifest,
            projection: {
              version: "1",
              runId: RUN_ID,
              sequence: 4,
              terminal: true,
              stages: {
                preflight: "completed",
                request: "completed",
                round: "failed",
                proof: "pending",
                verify: "pending",
                consumer: "pending",
              },
              terminalFailure: {
                stage: "round",
                error: {
                  version: "1",
                  category: "not-finalized",
                  code: "COMMAND_RETRY_EXHAUSTED",
                  message: "Relay retry budget exhausted",
                  retryable: false,
                  evidence: {},
                },
              },
            },
            last_sequence: 4,
          },
        ],
      };
    }
    if (/INSERT/i.test(text)) return { rowCount: 1, rows: [] };
    return { rowCount: 1, rows: [] };
  });
  return { query, connect: vi.fn() };
}

function productionService(pool: ReturnType<typeof terminalPool>) {
  return createProductionProoflineService({
    pool: pool as any,
    tokenDigestKey: "slice-007-digest-key",
    publicWebOrigin: "https://proofline.test",
  });
}

describe("Slice 007 terminal API immutability", () => {
  it.each([
    [
      "relayer submission",
      (service: ReturnType<typeof productionService>) =>
        service.createSubmission({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "terminal-submit",
          mode: "relayer",
        }),
    ],
    [
      "wallet transaction attachment",
      (service: ReturnType<typeof productionService>) =>
        service.attachTransaction({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "terminal-attach",
          transactionHash: TRANSACTION_HASH,
        }),
    ],
    [
      "consumer verification",
      (service: ReturnType<typeof productionService>) =>
        service.verifyConsumer({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "terminal-consumer",
          consumer: "canonical-vulnerable",
        }),
    ],
  ])("rejects %s after terminal failure", async (_label, invoke) => {
    const pool = terminalPool();
    await expect(invoke(productionService(pool))).rejects.toMatchObject({
      status: 409,
    });
    expect(
      pool.query.mock.calls.some(([text]) => /INSERT/i.test(String(text))),
    ).toBe(false);
  });

  it("allows terminal codegen as a derived product without mutating the journal", async () => {
    const pool = terminalPool();
    await expect(
      productionService(pool).generateConsumer({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        idempotencyKey: "terminal-codegen",
      }),
    ).resolves.toMatchObject({
      source: expect.stringContaining("contract ProoflineSafeWeb2JsonConsumer"),
    });

    expect(
      pool.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.run_events/i.test(String(text)),
      ),
    ).toBe(false);
    expect(
      pool.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.run_commands/i.test(String(text)),
      ),
    ).toBe(true);
  });

  it("allows terminal sharing as a read-only product without mutating the journal", async () => {
    const pool = terminalPool();
    await expect(
      productionService(pool).createShare({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        idempotencyKey: "terminal-share",
      }),
    ).resolves.toMatchObject({
      version: "1",
      runId: RUN_ID,
      url: expect.stringMatching(
        new RegExp(`^https://proofline\\.test/runs/${RUN_ID}#share=share_[a-f0-9]{64}$`),
      ),
    });

    expect(
      pool.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.run_events/i.test(String(text)),
      ),
    ).toBe(false);
    expect(
      pool.query.mock.calls.some(([text]) =>
        /INSERT INTO proofline_private\.share_tokens/i.test(String(text)),
      ),
    ).toBe(true);
  });
});

describe("Slice 007 stable preflight readiness contract", () => {
  it("raises PREFLIGHT_NOT_READY from the production service", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const service = createProductionProoflineService({
      pool: pool as any,
      tokenDigestKey: "slice-007-digest-key",
      publicWebOrigin: "https://proofline.test",
    });

    await expect(
      service.createSubmission({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        idempotencyKey: "wallet-not-ready",
        mode: "wallet",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "PREFLIGHT_NOT_READY",
    });
  });

  it("preserves PREFLIGHT_NOT_READY through the public API so the CLI retries", async () => {
    let attempts = 0;
    const transaction = {
      chainId: "0x72",
      to: "0x3333333333333333333333333333333333333333",
      data: "0xfeedcafe",
      value: "0x3039",
    };
    const api = createProoflineApi({
      authenticate: vi.fn(async () => ({
        kind: "project" as const,
        projectId: PROJECT_ID,
      })),
      service: {
        async createSubmission() {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("Preflight evidence is not durable yet"), {
              status: 409,
              code: "PREFLIGHT_NOT_READY",
            });
          }
          return {
            version: "1",
            runId: RUN_ID,
            mode: "wallet",
            effectOwner: "wallet",
            transaction,
          };
        },
      },
    });
    let now = 0;
    const cli = createProductionCliDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
      },
      fetch: (request, init) => api.fetch(new Request(request, init)),
      walletFactory: vi.fn(),
      clock: {
        now: () => now,
        sleep: vi.fn(async (milliseconds: number) => {
          now += milliseconds;
        }),
      },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    await expect(
      cli.client.prepareSubmission({ runId: RUN_ID, mode: "wallet" }),
    ).resolves.toEqual(transaction);
    expect(attempts).toBe(2);
  });
});
