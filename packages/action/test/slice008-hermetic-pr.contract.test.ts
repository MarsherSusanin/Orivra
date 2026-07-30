// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeBundleInput,
  validManifest,
} from "../../contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import { runProoflineAction } from "../src/index";
import { createPersistedActionRunClient } from "../src/runtime";

function localBundle() {
  const input = makeBundleInput();
  const manifest = {
    ...input.manifest,
    submission: { ...input.manifest.submission, mode: "replay" as const },
  };
  const events = input.events.map((event) =>
    event.type === "RUN_CREATED"
      ? { ...event, payload: { manifest } }
      : event,
  );
  return createProofBundle({ ...input, manifest, events });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = 0;
});

describe("Slice 008 local pull-request replay", () => {
  it("verifies the checked-in canonical bundle with zero fetch calls and no credentials", async () => {
    const bundle = localBundle();
    const serialized = canonicalSerializeProofBundle(bundle);
    const fetch = vi.fn(async () => {
      throw new Error("PR replay attempted forbidden network I/O");
    });
    const files = {
      readText: vi.fn(async (path: string) => {
        if (path === "proofline.manifest.json") {
          return JSON.stringify(bundle.manifest);
        }
        if (path === "fixtures/proofline.bundle.json") return serialized;
        throw new Error(`Unexpected local Action path ${path}`);
      }),
    };

    const client = createPersistedActionRunClient({
      environment: {
        GITHUB_EVENT_NAME: "pull_request",
        PROOFLINE_REPLAY_BUNDLE_PATH: "fixtures/proofline.bundle.json",
      },
      fetch,
      clock: { now: () => 1_000, sleep: vi.fn() },
      files,
    });
    const replay = await client.replayManifest("proofline.manifest.json");

    expect(replay).toMatchObject({
      runId: bundle.runId,
      checksum: bundle.checksum,
      localReplay: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(files.readText).toHaveBeenCalledWith("proofline.manifest.json");
    expect(files.readText).toHaveBeenCalledWith(
      "fixtures/proofline.bundle.json",
    );

    vi.stubEnv("NODE_ENV", "production");
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: "proofline.manifest.json" },
        env: {},
        client: {
          replayManifest: vi.fn(async () => replay as any),
          runLive: vi.fn(),
        },
        artifacts,
      }),
    ).resolves.toBe(0);
    expect(artifacts.upload).toHaveBeenCalledWith(
      "proofline-replay-evidence",
      expect.objectContaining({ localReplay: true }),
    );
  });

  it("rejects a locally valid bundle whose manifest differs from the requested manifest", async () => {
    const bundle = localBundle();
    const serialized = canonicalSerializeProofBundle(bundle);
    const mismatched = {
      ...bundle.manifest,
      consumer: {
        ...bundle.manifest.consumer,
        expectedHost: "mirror.example.net",
      },
    };
    const fetch = vi.fn();
    const client = createPersistedActionRunClient({
      environment: {
        GITHUB_EVENT_NAME: "pull_request",
        PROOFLINE_REPLAY_BUNDLE_PATH: "fixtures/proofline.bundle.json",
      },
      fetch,
      clock: { now: () => 1_000, sleep: vi.fn() },
      files: {
        readText: vi.fn(async (path: string) =>
          path.endsWith(".manifest.json")
            ? JSON.stringify(mismatched)
            : serialized,
        ),
      },
    });

    await expect(
      client.replayManifest("proofline.manifest.json"),
    ).rejects.toThrow(/manifest|match/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Slice 008 merge queue consumer ownership", () => {
  it("requests canonical-safe explicitly after proof verification", async () => {
    const requests: Request[] = [];
    const liveManifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode: "relayer" as const },
    };
    const source = makeBundleInput();
    const runId = "run_slice008_live";
    const liveEvents = source.events.map((event) => ({
      ...event,
      runId,
      payload:
        event.type === "RUN_CREATED"
          ? { manifest: liveManifest }
          : event.payload,
    }));
    const bundle = createProofBundle({
      ...source,
      runId,
      manifest: liveManifest,
      events: liveEvents,
    });
    let projectionRead = 0;
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (request.method === "POST" && path === "/v1/runs") {
          return Response.json({ runId }, { status: 202 });
        }
        if (
          request.method === "POST" &&
          path === `/v1/runs/${runId}/submissions`
        ) {
          return Response.json({ accepted: true }, { status: 202 });
        }
        if (
          request.method === "POST" &&
          path === `/v1/runs/${runId}/consumer-verifications`
        ) {
          return Response.json({ accepted: true }, { status: 202 });
        }
        if (request.method === "GET" && path === `/v1/runs/${runId}`) {
          projectionRead += 1;
          if (projectionRead === 1) {
            return Response.json({
              runId,
              sequence: 6,
              terminal: false,
              stages: { verify: "completed", consumer: "active" },
            });
          }
          return Response.json({
            runId,
            sequence: 7,
            terminal: true,
            transactionHash: `0x${"6".repeat(64)}`,
            votingRound: "42871",
            proofChecksum: bundle.checksum,
            consumerVerified: true,
            broadcastAttemptCount: 1,
          });
        }
        if (
          request.method === "GET" &&
          path === `/v1/runs/${runId}/bundle`
        ) {
          return new Response(canonicalSerializeProofBundle(bundle));
        }
        if (request.method === "POST" && path === "/v1/replays") {
          return Response.json({
            runId,
            checksum: bundle.checksum,
            byteIdentical: true,
          });
        }
        throw new Error(`Unexpected request ${request.method} ${path}`);
      },
    );
    const client = createPersistedActionRunClient({
      environment: {
        GITHUB_EVENT_NAME: "merge_group",
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"5".repeat(64)}`,
        GITHUB_SHA: "a".repeat(40),
        PROOFLINE_TREE_HASH: "b".repeat(40),
      },
      fetch,
      clock: {
        now: vi.fn(() => projectionRead * 2_000),
        sleep: vi.fn(),
      },
      files: {
        readText: vi.fn(async () => JSON.stringify(liveManifest)),
      },
    });

    await expect(
      client.runLive({
        manifestPath: "proofline.manifest.json",
        timeoutMs: 600_000,
      }),
    ).resolves.toMatchObject({ runId, consumerVerified: true });
    const consumerRequest = requests.find(
      (request) =>
        request.method === "POST" &&
        new URL(request.url).pathname.endsWith("/consumer-verifications"),
    );
    expect(consumerRequest).toBeDefined();
    await expect(consumerRequest!.json()).resolves.toEqual({
      consumer: "canonical-safe",
    });
  });
});

describe("Slice 008 Action entry failure boundary", () => {
  it("catches dependency construction errors and publishes one redacted failure", async () => {
    const setFailed = vi.fn();
    const write = vi.fn(async () => undefined);
    vi.stubEnv("GITHUB_EVENT_NAME", "pull_request");
    vi.stubEnv("PROOFLINE_API_URL", "");
    vi.stubEnv("PROOFLINE_PROJECT_TOKEN", "");
    vi.stubEnv("PROOFLINE_REPLAY_BUNDLE_PATH", "");
    vi.doMock("@actions/core", () => ({
      getInput: vi.fn((name: string) =>
        name === "manifest" ? "proofline.manifest.json" : "",
      ),
      setFailed,
      summary: { addRaw: vi.fn(() => ({ write })) },
    }));
    vi.doMock("@actions/artifact", () => ({
      DefaultArtifactClient: class {
        uploadArtifact = vi.fn();
      },
    }));

    await expect(import("../src/entry")).resolves.toBeDefined();
    expect(setFailed).toHaveBeenCalledOnce();
    const published = JSON.stringify(setFailed.mock.calls);
    expect(published).toMatch(/release gate failed/i);
    expect(published).not.toMatch(
      /PROOFLINE_API_URL|PROOFLINE_PROJECT_TOKEN|at\s+\S+:\d+|stack/i,
    );
  });
});
