// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  OCCURRED_AT,
  expectedCanonicalUrl,
  makeBundleInput,
  validManifest,
} from "../packages/contracts/test/fixtures";
import {
  appendRunEvents,
  canonicalSerializeProofBundle,
  createProofBundle,
  projectRun,
} from "@proofline/domain";
import { runProoflineAction } from "../packages/action/src/index";
import {
  createPersistedActionRunClient,
  createProductionActionDependencies,
} from "../packages/action/src/runtime";
import { createProductionCommandHandlers } from "../apps/worker/src/worker";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const RELAY = "0x4444444444444444444444444444444444444444";

const immutableActionEnvironment = {
  PROOFLINE_API_URL: "https://proofline.invalid",
  PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
  GITHUB_REPOSITORY: "proofline/proofline",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_SHA: "b".repeat(40),
  PROOFLINE_TREE_HASH: "c".repeat(40),
  GITHUB_WORKFLOW: "proofline-release",
  GITHUB_JOB: "proofline",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function bundleFor(mode: "replay" | "relayer", terminal = true) {
  const input = makeBundleInput();
  const manifest = {
    ...input.manifest,
    submission: { ...input.manifest.submission, mode },
  };
  const events = input.events.map((event) => {
    if (event.type === "RUN_CREATED") {
      return { ...event, payload: { manifest } };
    }
    if (event.type === "REQUEST_SUBMITTED") {
      return {
        ...event,
        payload: {
          ...event.payload,
          mode: mode === "relayer" ? ("relayer" as const) : ("wallet" as const),
        },
      };
    }
    return event;
  });
  const selectedEvents = terminal ? events : events.slice(0, 2);
  return createProofBundle({
    ...input,
    manifest,
    events: selectedEvents,
  });
}

function actionClientHarness(input: {
  environment?: Record<string, string | undefined>;
  now: number;
  mode: "replay" | "relayer";
  terminalBundle?: boolean;
  projectionRunId?: string;
}) {
  const requests: Request[] = [];
  const bundle = bundleFor(input.mode, input.terminalBundle ?? true);
  const serialized = canonicalSerializeProofBundle(bundle);
  const replayBundlePath = "fixtures/proofline.bundle.json";
  const projectionRunId = input.projectionRunId ?? RUN_ID;
  const fetch = vi.fn(
    async (requestInput: string | URL | Request, init?: RequestInit) => {
      const request = new Request(requestInput, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/v1/runs") {
        return Response.json({ runId: RUN_ID }, { status: 202 });
      }
      if (
        request.method === "POST" &&
        path === `/v1/runs/${RUN_ID}/submissions`
      ) {
        return Response.json({ accepted: true }, { status: 202 });
      }
      if (request.method === "GET" && path === `/v1/runs/${RUN_ID}`) {
        return Response.json({
          runId: projectionRunId,
          terminal: true,
          sequence: bundle.events.length,
          transactionHash: TRANSACTION_HASH,
          votingRound: String(bundle.proof.votingRound),
          proofChecksum: bundle.checksum,
          consumerVerified: true,
          broadcastCountAfterRecordedHash: 0,
        });
      }
      if (request.method === "GET" && path === `/v1/runs/${RUN_ID}/bundle`) {
        return new Response(serialized, {
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && path === "/v1/replays") {
        return Response.json({
          runId: RUN_ID,
          checksum: bundle.checksum,
          byteIdentical: true,
        });
      }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    },
  );
  const client = createPersistedActionRunClient({
    environment: {
      ...immutableActionEnvironment,
      PROOFLINE_REPLAY_BUNDLE_PATH: replayBundlePath,
      ...input.environment,
    },
    fetch,
    clock: { now: () => input.now, sleep: vi.fn() },
    files: {
      readText: vi.fn(async (path: string) =>
        path === replayBundlePath
          ? serialized
          : JSON.stringify(bundle.manifest),
      ),
    },
  });
  return { client, requests, bundle };
}

function postKeys(requests: readonly Request[]) {
  return requests
    .filter((request) => request.method === "POST")
    .map((request) => ({
      path: new URL(request.url).pathname,
      key: request.headers.get("idempotency-key"),
    }));
}

describe("Slice 007 persisted Action release identity", () => {
  it("does not release a PR whose persisted bundle command graph is nonterminal", async () => {
    const { client } = actionClientHarness({
      now: 1_000,
      mode: "replay",
      terminalBundle: false,
    });

    await expect(
      client.replayManifest("proofline.manifest.json"),
    ).rejects.toThrow(/terminal|command graph|consumer|lifecycle evidence/i);
  });

  it("replays the same local bytes after a clock change and process restart", async () => {
    const first = actionClientHarness({ now: 1_000, mode: "replay" });
    const restarted = actionClientHarness({ now: 98_765, mode: "replay" });

    const firstReplay = await first.client.replayManifest("proofline.manifest.json");
    const restartedReplay = await restarted.client.replayManifest(
      "proofline.manifest.json",
    );

    expect(restartedReplay).toEqual(firstReplay);
    expect(first.requests).toEqual([]);
    expect(restarted.requests).toEqual([]);
  });

  it("separates every immutable GitHub identity component and submission mode", async () => {
    const replay = actionClientHarness({
      now: 1_000,
      mode: "replay",
      environment: { GITHUB_EVENT_NAME: "workflow_dispatch" },
    });
    const live = actionClientHarness({
      now: 1_000,
      mode: "relayer",
      environment: { GITHUB_EVENT_NAME: "workflow_dispatch" },
    });

    await replay.client.replayManifest("proofline.manifest.json");
    await live.client.runLive({
      manifestPath: "proofline.manifest.json",
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });

    const replayCreate = postKeys(replay.requests)[0]?.key;
    expect(postKeys(live.requests)[0]?.key).not.toBe(replayCreate);
    const variations = [
      { GITHUB_REPOSITORY: "proofline/another-repository" },
      { GITHUB_EVENT_NAME: "merge_group" },
      { GITHUB_SHA: "d".repeat(40) },
      { PROOFLINE_TREE_HASH: "e".repeat(40) },
      { GITHUB_WORKFLOW: "another-workflow" },
      { GITHUB_JOB: "another-job" },
    ];
    for (const environment of variations) {
      const changed = actionClientHarness({
        now: 1_000,
        mode: "relayer",
        environment: {
          GITHUB_EVENT_NAME: "workflow_dispatch",
          ...environment,
        },
      });
      await changed.client.runLive({
        manifestPath: "proofline.manifest.json",
        network: "coston2",
        timeoutMs: 600_000,
        rebroadcastAfterTransactionHash: false,
      });
      expect(
        postKeys(changed.requests)[0]?.key,
        `identity must include ${Object.keys(environment)[0]}`,
      ).not.toBe(replayCreate);
    }
  });

  it("still rejects a projection whose persisted run identity mismatches", async () => {
    const { client } = actionClientHarness({
      now: 1_000,
      mode: "replay",
      projectionRunId: "run_other",
      environment: { GITHUB_EVENT_NAME: "workflow_dispatch" },
    });

    await expect(
      client.replayManifest("proofline.manifest.json"),
    ).rejects.toThrow(/identity mismatch/i);
  });
});

function liveGraphHarness() {
  const manifest = {
    ...validManifest,
    submission: { ...validManifest.submission, mode: "relayer" as const },
  };
  const state = {
    events: [
      {
        version: "1" as const,
        runId: RUN_ID,
        sequence: 1,
        commandId: "create-live-run",
        occurredAt: OCCURRED_AT,
        type: "RUN_CREATED" as const,
        payload: { manifest },
      },
    ],
    artifacts: [] as Array<Record<string, unknown>>,
    relayer: null as Record<string, unknown> | null,
  };
  let broadcastCount = 0;
  let broadcastCountAfterRecordedHash = 0;
  const verifiedConsumers: unknown[] = [];
  const repository = {
    async loadRunExecutionContext() {
      return {
        runId: RUN_ID,
        projectId: "11111111-1111-4111-8111-111111111111",
        manifest,
        events: [...state.events],
        projection: projectRun(state.events),
        artifacts: [...state.artifacts],
      };
    },
    async findRelayerTransaction() {
      return state.relayer;
    },
    async persistRelayerTransaction(value: Record<string, unknown>) {
      state.relayer = {
        ...value,
        broadcastAttemptedAt: null,
        broadcastAt: null,
      };
    },
    async claimRelayerBroadcastAttempt() {
      if (state.relayer?.broadcastAttemptedAt) return false;
      state.relayer = {
        ...state.relayer,
        broadcastAttemptedAt: OCCURRED_AT,
      };
      return true;
    },
    async markRelayerBroadcast(_key: string, transactionHash: string) {
      state.relayer = {
        ...state.relayer,
        transactionHash,
        broadcastAt: OCCURRED_AT,
      };
    },
  };
  const ports = {
    async preflight() {
      return {
        canonicalUrl: expectedCanonicalUrl,
        requestBytes: "0x574542324a534f4e",
        requestCalldata: "0xfeedcafe",
        quotedFeeWei: 12_345n,
        network: {
          chainId: 114 as const,
          registryAddress: "0x2222222222222222222222222222222222222222",
          resolvedContracts: {
            FdcHub: FDC_HUB,
            FdcVerification: FDC_VERIFICATION,
            Relay: RELAY,
          },
        },
      };
    },
    async signRelayerTransaction(value: Record<string, unknown>) {
      return {
        idempotencyKey: value.idempotencyKey,
        nonce: 7n,
        rawTransaction: "0x02f8signed",
        transactionHash: TRANSACTION_HASH,
        chainId: 114,
        target: FDC_HUB,
        calldata: "0xfeedcafe",
        valueWei: 12_345n,
      };
    },
    async broadcastRawTransaction() {
      if (state.relayer?.broadcastAt) broadcastCountAfterRecordedHash += 1;
      broadcastCount += 1;
      return TRANSACTION_HASH;
    },
    async getTransactionReceipt() {
      return {
        transactionHash: TRANSACTION_HASH,
        blockHash: `0x${"c".repeat(64)}`,
        blockTimestamp: 1_747_308_251n,
      };
    },
    async getVotingConfiguration() {
      return {
        firstVotingRoundStartTs: 1_747_265_565n,
        votingEpochDurationSeconds: 90n,
        protocolId: 200,
      };
    },
    async isRelayFinalized() {
      return true;
    },
    async getRelayRoot() {
      return `0x${"d".repeat(64)}`;
    },
    async fetchDaProof() {
      return {
        response_hex: "0x1234abcd",
        attestation_type: "Web2Json",
        proof: [`0x${"e".repeat(64)}`],
      };
    },
    async verifyProof() {
      return { verified: true, verificationContract: FDC_VERIFICATION };
    },
    async verifyConsumer(value: Record<string, unknown>) {
      verifiedConsumers.push(value.consumer);
      return { passed: value.consumer === "canonical-safe", diagnostics: [] };
    },
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as never,
    ports: ports as never,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (command: any) => Promise<any>>;

  return {
    state,
    handlers,
    verifiedConsumers,
    get broadcastCount() {
      return broadcastCount;
    },
    get broadcastCountAfterRecordedHash() {
      return broadcastCountAfterRecordedHash;
    },
  };
}

describe("Slice 007 scheduled live command graph", () => {
  it("drains relayer mode to truthful safe-consumer release evidence", async () => {
    const fixture = liveGraphHarness();
    const queue: Array<{ id: string; kind: string; payload: Record<string, unknown> }> = [
      { id: "run-preflight", kind: "RUN_PREFLIGHT", payload: {} },
    ];
    const executed: string[] = [];

    for (let step = 0; queue.length > 0 && step < 20; step += 1) {
      const command = queue.shift()!;
      const handler = fixture.handlers[command.kind];
      expect(handler, `${command.kind} must be a registered production command`).toEqual(
        expect.any(Function),
      );
      const outcome = await handler({ ...command, runId: RUN_ID, attempts: 1 });
      executed.push(command.kind);
      fixture.state.events = appendRunEvents(
        fixture.state.events,
        outcome.events ?? [],
      );
      fixture.state.artifacts.push(...(outcome.artifacts ?? []));
      queue.push(...(outcome.nextCommands ?? []));
      if (command.kind === "VERIFY_PROOF") {
        queue.push({
          id: "verify-safe-consumer",
          kind: "VERIFY_CONSUMER",
          payload: { consumer: "canonical-safe" },
        });
      }
    }

    expect(executed).toEqual([
      "RUN_PREFLIGHT",
      "SUBMIT_RELAYER",
      "BROADCAST_RELAYER_TRANSACTION",
      "POLL_TRANSACTION_RECEIPT",
      "POLL_RELAY_FINALIZATION",
      "FETCH_DA_PROOF",
      "VERIFY_PROOF",
      "VERIFY_CONSUMER",
      "BUILD_PROOF_BUNDLE",
    ]);
    expect(projectRun(fixture.state.events)).toMatchObject({ terminal: true });
    expect(fixture.verifiedConsumers).toEqual(["canonical-safe"]);
    expect(fixture.state.artifacts.some((value) => value.kind === "proof-bundle")).toBe(
      true,
    );
    expect(fixture.broadcastCount).toBe(1);
    expect(fixture.broadcastCountAfterRecordedHash).toBe(0);
  });
});

describe("Slice 007 Action custody boundary", () => {
  it("runs merge release with a project token and no Action private key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const runLive = vi.fn().mockResolvedValue({
      commitHash: immutableActionEnvironment.GITHUB_SHA,
      treeHash: immutableActionEnvironment.PROOFLINE_TREE_HASH,
      runId: RUN_ID,
      transactionHash: TRANSACTION_HASH,
      votingRound: "42871",
      proofChecksum: `sha256:${"f".repeat(64)}`,
      consumerVerified: true,
      broadcastCountAfterRecordedHash: 0,
      persistedRun: { runId: RUN_ID, lastSequence: 7 },
    });

    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "proofline.manifest.json" },
        env: {
          ...immutableActionEnvironment,
          GITHUB_EVENT_NAME: "merge_group",
        },
        client: { replayManifest: vi.fn(), runLive },
        artifacts: { writeSummary: vi.fn(), upload: vi.fn() },
      }),
    ).resolves.toBe(0);
    expect(runLive).toHaveBeenCalledOnce();
  });

  it("does not expose or forward a private key accidentally present in Action env", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const secret = `0x${"7".repeat(64)}`;
    const runLive = vi.fn().mockResolvedValue({});
    const dependencies = createProductionActionDependencies({
      environment: {
        ...immutableActionEnvironment,
        PROOFLINE_COSTON2_PRIVATE_KEY: secret,
      },
      core: {
        getInput: vi.fn((name: string) =>
          name === "manifest" ? "proofline.manifest.json" : "live",
        ),
        setFailed: vi.fn(),
        writeSummary: vi.fn(),
      },
      replayManifest: vi.fn(),
      runLive,
      uploadJson: vi.fn(),
    });

    expect(JSON.stringify(dependencies.env)).not.toContain(secret);
    await dependencies.client.runLive({ manifestPath: "proofline.manifest.json" });
    expect(runLive.mock.calls[0]?.[0]).not.toHaveProperty("privateKey");
    expect(JSON.stringify(runLive.mock.calls)).not.toContain(secret);
  });

  it("removes the legacy monolithic live gate from the worker bootstrap graph", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const visited = new Map<string, string>();
    const visit = (file: string) => {
      if (visited.has(file)) return;
      const source = readFileSync(file, "utf8");
      visited.set(file, source);
      const imports = source.matchAll(/from\s+["'](\.[^"']+)["']/g);
      for (const match of imports) {
        const candidate = resolve(dirname(file), match[1]);
        const resolved = [
          ...(extname(candidate) ? [candidate] : []),
          `${candidate}.ts`,
          `${candidate}.tsx`,
          resolve(candidate, "index.ts"),
        ].find(existsSync);
        if (resolved?.startsWith(resolve(root, "apps/worker/src"))) visit(resolved);
      }
    };
    visit(resolve(root, "apps/worker/src/bootstrap.ts"));
    const graph = [...visited.entries()]
      .map(([file, source]) => `${file}\n${source}`)
      .join("\n");

    expect(graph).not.toMatch(/RUN_LIVE_COSTON2/);
    expect(graph).not.toMatch(/from\s+["']\.\/live-gate["']/);
  });
});
