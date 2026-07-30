// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { runProoflineAction } from "../src/index";
import {
  createPersistedActionRunClient,
  runActionEntry,
} from "../src/runtime";

const checksum = `sha256:${"a".repeat(64)}`;

type Scenario = {
  create?: Record<string, unknown>;
  projections?: Record<string, unknown>[];
  bundle?: string;
  replay?: Record<string, unknown>;
  rejectedPath?: string;
};

function persistedClient(scenario: Scenario = {}) {
  let now = 0;
  let projectionIndex = 0;
  const sleep = vi.fn(async (milliseconds: number) => {
    now += milliseconds;
  });
  const defaultProjection = {
    runId: "run_action",
    terminal: true,
    sequence: 7,
  };
  const bundle =
    scenario.bundle ??
    JSON.stringify({
      version: "1",
      runId: "run_action",
      events: [],
      proof: { votingRound: 42 },
      verification: { consumerVerified: true },
    });
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === scenario.rejectedPath) {
        return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 503 });
      }
      if (request.method === "POST" && path === "/v1/runs") {
        return Response.json(scenario.create ?? { runId: "run_action" }, {
          status: 202,
        });
      }
      if (request.method === "POST" && path.endsWith("/submissions")) {
        return Response.json({ accepted: true }, { status: 202 });
      }
      if (request.method === "GET" && path === "/v1/runs/run_action") {
        const projections = scenario.projections ?? [defaultProjection];
        return Response.json(
          projections[Math.min(projectionIndex++, projections.length - 1)],
        );
      }
      if (request.method === "GET" && path.endsWith("/bundle")) {
        return new Response(bundle);
      }
      if (request.method === "POST" && path === "/v1/replays") {
        return Response.json(
          scenario.replay ?? {
            runId: "run_action",
            byteIdentical: true,
            checksum,
          },
        );
      }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    },
  );
  const client = createPersistedActionRunClient({
    environment: {
      PROOFLINE_API_URL: "https://proofline.invalid/",
      PROOFLINE_PROJECT_TOKEN: `project_${"b".repeat(64)}`,
      GITHUB_SHA: "c".repeat(40),
      PROOFLINE_TREE_HASH: "d".repeat(40),
    },
    fetch,
    clock: { now: () => now, sleep },
    files: { readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)) },
  });
  return { client, fetch, sleep };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Slice 005 persisted Action client failure boundaries", () => {
  it.each([
    [{ PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}` }, "PROOFLINE_API_URL"],
    [{ PROOFLINE_API_URL: "https://proofline.invalid" }, "PROOFLINE_PROJECT_TOKEN"],
    [
      {
        PROOFLINE_API_URL: "   ",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      },
      "PROOFLINE_API_URL",
    ],
  ])("requires complete trimmed configuration %#", (environment, name) => {
    expect(() =>
      createPersistedActionRunClient({
        environment,
        fetch: vi.fn(),
        clock: { now: vi.fn(), sleep: vi.fn() },
        files: { readText: vi.fn() },
      }),
    ).toThrow(name);
  });

  it("reports a rejected API method, path, and status", async () => {
    const { client } = persistedClient({ rejectedPath: "/v1/runs" });

    await expect(client.replayManifest("manifest.json")).rejects.toThrow(
      /POST \/v1\/runs \(503\)/,
    );
  });

  it("rejects a create response without a persisted run id", async () => {
    const { client } = persistedClient({ create: {} });

    await expect(client.replayManifest("manifest.json")).rejects.toThrow(
      /persist a run identity/i,
    );
  });

  it.each([
    ["different", { runId: "run_other", terminal: true, sequence: 7 }],
    ["missing", { terminal: true, sequence: 7 }],
  ])("rejects a projection with %s run identity", async (_label, projection) => {
    const { client } = persistedClient({ projections: [projection] });

    await expect(client.replayManifest("manifest.json")).rejects.toThrow(
      /projection identity mismatch/i,
    );
  });

  it("polls nonterminal state with the injected clock before returning durable state", async () => {
    const { client, sleep } = persistedClient({
      projections: [
        { runId: "run_action", terminal: false, sequence: 1 },
        { runId: "run_action", terminal: true, sequence: 7 },
      ],
    });

    await expect(client.replayManifest("manifest.json")).resolves.toMatchObject({
      persistedRun: { runId: "run_action", lastSequence: 7 },
    });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2_000);
  });

  it("bounds a persisted run that never reaches terminal evidence", async () => {
    const { client, sleep } = persistedClient({
      projections: [{ runId: "run_action", terminal: false, sequence: 1 }],
    });

    await expect(client.replayManifest("manifest.json")).rejects.toMatchObject({
      code: "RELEASE_GATE_TIMEOUT",
      reason: "LIVE_GATE_DEADLINE_EXCEEDED",
      retryable: false,
    });
    expect(sleep).toHaveBeenCalled();
    expect(
      sleep.mock.calls.flat().reduce((total, value) => total + value, 0),
    ).toBeLessThanOrEqual(60_000);
  });

  it.each([
    [
      "run identity",
      { replay: { runId: "run_other", byteIdentical: true, checksum } },
      /identity is not byte-identical/i,
    ],
    [
      "missing run identity",
      { replay: { byteIdentical: true, checksum } },
      /identity is not byte-identical/i,
    ],
    [
      "byte comparison",
      { replay: { runId: "run_action", byteIdentical: false, checksum } },
      /identity is not byte-identical/i,
    ],
    [
      "checksum",
      { replay: { runId: "run_action", byteIdentical: true, checksum: "bad" } },
      /checksum is invalid/i,
    ],
    [
      "missing checksum",
      { replay: { runId: "run_action", byteIdentical: true } },
      /checksum is invalid/i,
    ],
    [
      "bundle JSON",
      {
        bundle: "not-json",
        replay: { runId: "run_action", byteIdentical: true, checksum },
      },
      /not valid JSON/i,
    ],
  ] as const)("fails closed for invalid persisted replay %s", async (_label, scenario, error) => {
    const { client } = persistedClient(scenario);

    await expect(client.replayManifest("manifest.json")).rejects.toThrow(error);
  });

  it("rejects terminal state without a positive journal sequence", async () => {
    const { client } = persistedClient({
      projections: [{ runId: "run_action", terminal: true, sequence: 0 }],
    });

    await expect(client.replayManifest("manifest.json")).rejects.toThrow(
      /identity is incomplete/i,
    );
  });
});

describe("Slice 005 persisted Action evidence fallbacks", () => {
  it("derives live evidence from persisted submission and round events", async () => {
    const transactionHash = `0x${"e".repeat(64)}`;
    const { client } = persistedClient({
      projections: [
        {
          runId: "run_action",
          terminal: true,
          sequence: 7,
          broadcastCountAfterRecordedHash: 0,
        },
      ],
      bundle: JSON.stringify({
        events: [
          { type: "REQUEST_SUBMITTED", payload: { transactionHash } },
          { type: "ROUND_FINALIZED", payload: { votingRound: 42871 } },
        ],
        proof: { votingRound: 999 },
        verification: { consumerVerified: true },
      }),
    });

    await expect(
      client.runLive({ manifestPath: "manifest.json", timeoutMs: 600_000 }),
    ).resolves.toMatchObject({
      transactionHash,
      votingRound: "42871",
      proofChecksum: checksum,
      consumerVerified: true,
      persistedRun: { runId: "run_action", lastSequence: 7 },
    });
  });

  it("falls back to the persisted proof round when no round event exists", async () => {
    const { client } = persistedClient({
      projections: [
        {
          runId: "run_action",
          terminal: true,
          sequence: 7,
          transactionHash: `0x${"f".repeat(64)}`,
          consumerVerified: true,
        },
      ],
      bundle: JSON.stringify({
        events: [],
        proof: { votingRound: 77 },
        verification: { consumerVerified: false },
      }),
    });

    await expect(
      client.runLive({ manifestPath: "manifest.json", timeoutMs: 600_000 }),
    ).resolves.toMatchObject({ votingRound: "77", proofChecksum: checksum });
  });
});

describe("Slice 005 Action public evidence validation", () => {
  it.each([
    ["run id", { runId: "", checksum }],
    ["checksum", { runId: "run_pr", checksum: "invalid" }],
  ])("fails a PR with invalid %s evidence", async (_label, result) => {
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: "manifest.json" },
        env: {},
        client: {
          replayManifest: vi.fn().mockResolvedValue(result),
          runLive: vi.fn(),
        },
        artifacts,
      }),
    ).resolves.toBe(1);
    expect(artifacts.upload).not.toHaveBeenCalled();
  });

  it("accepts complete production evidence through the default Action entry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const setExitCode = vi.fn();
    const setFailed = vi.fn();
    const upload = vi.fn();

    await expect(
      runActionEntry({
        dependencies: {
          eventName: "pull_request",
          inputs: { manifest: "manifest.json" },
          env: {},
          client: {
            replayManifest: vi.fn().mockResolvedValue({
              runId: "run_pr",
              checksum,
              persistedRun: { runId: "run_pr", lastSequence: 7 },
            }),
            runLive: vi.fn(),
          },
          artifacts: { writeSummary: vi.fn(), upload },
        },
        setFailed,
        setExitCode,
      }),
    ).resolves.toBe(0);
    expect(setExitCode).toHaveBeenCalledWith(0);
    expect(setFailed).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledOnce();
  });

  it("rejects live evidence with a nonpositive persisted journal sequence", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };

    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "manifest.json" },
        env: {
          PROOFLINE_PROJECT_TOKEN: `project_${"e".repeat(64)}`,
          PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"f".repeat(64)}`,
        },
        client: {
          replayManifest: vi.fn(),
          runLive: vi.fn().mockResolvedValue({
            commitHash: "1".repeat(40),
            treeHash: "2".repeat(40),
            runId: "run_live",
            transactionHash: `0x${"3".repeat(64)}`,
            votingRound: "42871",
            proofChecksum: checksum,
            consumerVerified: true,
            broadcastCountAfterRecordedHash: 0,
            persistedRun: { runId: "run_live", lastSequence: 0 },
          }),
        },
        artifacts,
      }),
    ).resolves.toBe(1);
    expect(artifacts.upload).not.toHaveBeenCalled();
  });
});
