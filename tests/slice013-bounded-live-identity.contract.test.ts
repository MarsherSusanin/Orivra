// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  makeBundleInput,
  validManifest,
} from "../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import { runProoflineAction } from "../packages/action/src/index";
import { createPersistedActionRunClient } from "../packages/action/src/runtime";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const COMMIT_HASH = "b".repeat(40);
const TREE_HASH = "c".repeat(40);
const TRANSACTION_HASH = `0x${"d".repeat(64)}`;
const PROOF_CHECKSUM = `sha256:${"e".repeat(64)}`;
const MANIFEST_PATH = "proofline.manifest.json";

const liveEnvironment = {
  PROOFLINE_API_URL: "https://proofline.invalid",
  PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
  GITHUB_EVENT_NAME: "merge_group",
  GITHUB_SHA: COMMIT_HASH,
  PROOFLINE_TREE_HASH: TREE_HASH,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function timeoutExpectation(reason: unknown) {
  expect(reason).toMatchObject({
    code: "RELEASE_GATE_TIMEOUT",
    retryable: false,
  });
  expect(String((reason as { message?: unknown })?.message ?? reason)).toMatch(
    /release gate.*timed out/i,
  );
}

function makeClient(input: {
  environment?: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  clock?: { now(): number; sleep(ms: number): Promise<void> | void };
}) {
  return createPersistedActionRunClient({
    environment: input.environment ?? liveEnvironment,
    fetch: input.fetch,
    clock:
      input.clock ??
      ({
        now: () => Date.now(),
        sleep: (milliseconds: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      } as const),
    files: {
      readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)),
    },
  });
}

function liveEvidence(overrides: Record<string, unknown> = {}) {
  return {
    commitHash: COMMIT_HASH,
    treeHash: TREE_HASH,
    runId: RUN_ID,
    transactionHash: TRANSACTION_HASH,
    votingRound: "42871",
    proofChecksum: PROOF_CHECKSUM,
    consumerVerified: true,
    broadcastCountAfterRecordedHash: 0,
    persistedRun: { runId: RUN_ID, lastSequence: 7 },
    ...overrides,
  };
}

function actionHarness(result: Record<string, unknown>) {
  const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
  return {
    artifacts,
    input: {
      eventName: "merge_group",
      inputs: { manifest: MANIFEST_PATH },
      env: liveEnvironment,
      client: {
        replayManifest: vi.fn(),
        runLive: vi.fn().mockResolvedValue(result),
      },
      artifacts,
    } as Parameters<typeof runProoflineAction>[0],
  };
}

describe("Slice 013 bounded live deadline", () => {
  it("aborts a hung live HTTP request within the release deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fetch = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("transport aborted"), { name: "AbortError" })),
            { once: true },
          );
        }),
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient({ fetch });
    let outcome:
      | { status: "pending" }
      | { status: "resolved"; value: unknown }
      | { status: "rejected"; reason: unknown } = { status: "pending" };

    void client
      .runLive({ manifestPath: MANIFEST_PATH, timeoutMs: 5 })
      .then(
        (value) => {
          outcome = { status: "resolved", value };
        },
        (reason: unknown) => {
          outcome = { status: "rejected", reason };
        },
      );
    await vi.advanceTimersByTimeAsync(6);
    await Promise.resolve();

    expect(outcome.status, "a hung fetch must not remain pending").toBe(
      "rejected",
    );
    if (outcome.status === "rejected") timeoutExpectation(outcome.reason);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses one cumulative deadline and issues no replay after the budget expires", async () => {
    let now = 0;
    let projectionReads = 0;
    const calls: string[] = [];
    const bundle = createProofBundle(makeBundleInput());
    const serializedBundle = canonicalSerializeProofBundle(bundle);
    const fetch = vi.fn(
      async (requestInput: string | URL | Request, init?: RequestInit) => {
        const request = new Request(requestInput, init);
        const path = new URL(request.url).pathname;
        calls.push(`${request.method} ${path}`);

        if (request.method === "POST" && path === "/v1/runs") {
          now = 1;
          return Response.json({ runId: RUN_ID }, { status: 202 });
        }
        if (request.method === "POST" && path.endsWith("/submissions")) {
          now = 3;
          return Response.json({ accepted: true }, { status: 202 });
        }
        if (request.method === "GET" && path === `/v1/runs/${RUN_ID}`) {
          projectionReads += 1;
          if (projectionReads === 1) {
            now = 5;
            return Response.json({
              runId: RUN_ID,
              terminal: false,
              sequence: 6,
              proofVerified: true,
              stages: { verify: "completed" },
            });
          }
          now = 9;
          return Response.json({
            runId: RUN_ID,
            terminal: true,
            sequence: 7,
            transactionHash: TRANSACTION_HASH,
            consumerVerified: true,
            broadcastCountAfterRecordedHash: 0,
          });
        }
        if (
          request.method === "POST" &&
          path.endsWith("/consumer-verifications")
        ) {
          now = 7;
          return Response.json({ accepted: true }, { status: 202 });
        }
        if (request.method === "GET" && path.endsWith("/bundle")) {
          now = 10;
          return new Response(serializedBundle);
        }
        if (request.method === "POST" && path === "/v1/replays") {
          now = 11;
          return Response.json({
            runId: RUN_ID,
            byteIdentical: true,
            checksum: bundle.checksum,
          });
        }
        throw new Error(`Unexpected request ${request.method} ${path}`);
      },
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient({
      fetch,
      clock: {
        now: () => now,
        sleep: vi.fn(async (milliseconds: number) => {
          now += milliseconds;
        }),
      },
    });

    const outcome = await client
      .runLive({ manifestPath: MANIFEST_PATH, timeoutMs: 10 })
      .then(
        (value) => ({ status: "resolved" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") timeoutExpectation(outcome.reason);
    expect(calls).toEqual([
      "POST /v1/runs",
      `POST /v1/runs/${RUN_ID}/submissions`,
      `GET /v1/runs/${RUN_ID}`,
      `POST /v1/runs/${RUN_ID}/consumer-verifications`,
      `GET /v1/runs/${RUN_ID}`,
      `GET /v1/runs/${RUN_ID}/bundle`,
    ]);
  });

  it.each([0, -1, 600_001])(
    "rejects invalid timeout %s before the first API request",
    async (timeoutMs) => {
      const fetch = vi.fn(async () => {
        throw new Error("unexpected fetch");
      }) as unknown as typeof globalThis.fetch;
      const client = makeClient({ fetch });

      await expect(
        client.runLive({ manifestPath: MANIFEST_PATH, timeoutMs }),
      ).rejects.toThrow(/timeout.*(?:positive|600000|range)|invalid.*timeout/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["GITHUB_SHA", "a".repeat(39)],
    ["GITHUB_SHA", "g".repeat(40)],
    ["PROOFLINE_TREE_HASH", "b".repeat(41)],
    ["PROOFLINE_TREE_HASH", ` ${"c".repeat(40)}`],
  ])("rejects malformed %s before the first API request", async (name, value) => {
    const fetch = vi.fn(async () => {
      throw new Error("unexpected fetch");
    }) as unknown as typeof globalThis.fetch;
    const environment = { ...liveEnvironment, [name]: value };

    await expect(
      Promise.resolve().then(async () => {
        const client = makeClient({ environment, fetch });
        return client.runLive({ manifestPath: MANIFEST_PATH, timeoutMs: 10 });
      }),
    ).rejects.toThrow(/(?:commit|tree|GITHUB_SHA|PROOFLINE_TREE_HASH).*40.*hex/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Slice 013 Action candidate identity binding", () => {
  it.each([
    ["malformed commit", { commitHash: "not-a-git-hash" }],
    ["mismatched commit", { commitHash: "f".repeat(40) }],
    ["malformed tree", { treeHash: "not-a-git-hash" }],
    ["mismatched tree", { treeHash: "0".repeat(40) }],
  ])("publishes nothing for %s evidence", async (_label, override) => {
    vi.stubEnv("NODE_ENV", "production");
    const harness = actionHarness(liveEvidence(override));

    await expect(runProoflineAction(harness.input)).resolves.toBe(1);
    expect(harness.artifacts.upload).not.toHaveBeenCalled();
    expect(harness.artifacts.writeSummary).toHaveBeenCalledWith(
      expect.stringMatching(/commit\/tree identity|release evidence/i),
    );
  });

  it("accepts and uploads an exact valid 40-hex commit/tree pair", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const evidence = liveEvidence();
    const harness = actionHarness(evidence);

    await expect(runProoflineAction(harness.input)).resolves.toBe(0);
    expect(harness.artifacts.upload).toHaveBeenCalledExactlyOnceWith(
      "proofline-live-evidence",
      evidence,
    );
  });

  it("leaves the hermetic PR replay path independent of live Git identity", async () => {
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    const replayEvidence = {
      runId: RUN_ID,
      checksum: PROOF_CHECKSUM,
      byteIdentical: true,
      localReplay: true,
    };

    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: MANIFEST_PATH },
        env: { GITHUB_SHA: "malformed", PROOFLINE_TREE_HASH: "also-malformed" },
        client: {
          replayManifest: vi.fn().mockResolvedValue(replayEvidence),
          runLive: vi.fn(),
        },
        artifacts,
      }),
    ).resolves.toBe(0);
    expect(artifacts.upload).toHaveBeenCalledWith(
      "proofline-replay-evidence",
      replayEvidence,
    );
  });
});
