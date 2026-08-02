// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { runProoflineAction } from "../src/index";

type PersistedClientFactory = (input: Record<string, unknown>) => {
  replayManifest(path: string): Promise<Record<string, unknown>>;
  runLive(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

async function loadPersistedClientFactory(): Promise<PersistedClientFactory> {
  const runtime = (await import("../src/runtime")) as Record<string, unknown>;
  const factory = runtime.createPersistedActionRunClient;
  expect(
    factory,
    "The production Action needs a public, injectable persisted-run client",
  ).toEqual(expect.any(Function));
  if (typeof factory !== "function") {
    throw new Error("Missing createPersistedActionRunClient");
  }
  return factory as PersistedClientFactory;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Action persisted release path", () => {
  it("creates and replays a Web2Json manifest through the persisted API client", async () => {
    const createClient = await loadPersistedClientFactory();
    const requests: Request[] = [];
    let submissionAttempts = 0;
    const checksum = `sha256:${"a".repeat(64)}`;
    const bundle = `{"version":"1","runId":"run_pr","checksum":"${checksum}"}`;
    const client = createClient({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"b".repeat(64)}`,
      },
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (request.method === "POST" && path === "/v1/runs") {
          return Response.json({ runId: "run_pr" }, { status: 202 });
        }
        if (
          request.method === "POST" &&
          path === "/v1/runs/run_pr/submissions"
        ) {
          submissionAttempts += 1;
          if (submissionAttempts === 1) {
            return Response.json(
              { error: { code: "PREFLIGHT_NOT_READY" } },
              { status: 404 },
            );
          }
          return Response.json({
            version: "1",
            runId: "run_pr",
            mode: "replay",
            effectOwner: "none",
            commandId: "command_replay",
          }, { status: 202 });
        }
        if (request.method === "GET" && path === "/v1/runs/run_pr") {
          return Response.json({
            runId: "run_pr",
            terminal: true,
            sequence: 7,
          });
        }
        if (request.method === "GET" && path === "/v1/runs/run_pr/bundle") {
          return new Response(bundle, {
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && path === "/v1/replays") {
          return Response.json({
            runId: "run_pr",
            checksum,
            byteIdentical: true,
          });
        }
        throw new Error(`Unexpected Action request ${request.method} ${path}`);
      }),
      clock: { now: vi.fn(() => 1_000), sleep: vi.fn() },
      files: {
        readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)),
      },
    });

    await expect(client.replayManifest("proofline.manifest.json")).resolves.toMatchObject({
      runId: "run_pr",
      checksum,
      persistedRun: { runId: "run_pr", lastSequence: 7 },
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /v1/runs",
      "POST /v1/runs/run_pr/submissions",
      "POST /v1/runs/run_pr/submissions",
      "GET /v1/runs/run_pr",
      "GET /v1/runs/run_pr/bundle",
      "POST /v1/replays",
    ]);
    await expect(requests[0]!.json()).resolves.toMatchObject({
      manifest: {
        attestationType: "Web2Json",
        submission: { mode: "replay" },
      },
    });
    const submissions = requests.filter(
      (request) =>
        request.method === "POST" &&
        new URL(request.url).pathname === "/v1/runs/run_pr/submissions",
    );
    expect(submissions).toHaveLength(2);
    await expect(Promise.all(submissions.map((request) => request.clone().json())))
      .resolves.toEqual([{ mode: "replay" }, { mode: "replay" }]);
    expect(submissions[0]?.headers.get("idempotency-key")).toMatch(
      /^action-[a-f0-9]{64}$/,
    );
    expect(submissions[1]?.headers.get("idempotency-key")).toBe(
      submissions[0]?.headers.get("idempotency-key"),
    );
    expect(
      requests.some((request) =>
        /\/transactions$/.test(new URL(request.url).pathname),
      ),
    ).toBe(false);
    expect(
      requests.every(
        (request) => new URL(request.url).origin === "https://proofline.invalid",
      ),
    ).toBe(true);
  });

  it("runs merge/live through the persisted run and submission API", async () => {
    const createClient = await loadPersistedClientFactory();
    const requests: Request[] = [];
    const checksum = `sha256:${"4".repeat(64)}`;
    const manifest = {
      ...validManifest,
      submission: { ...validManifest.submission, mode: "relayer" as const },
    };
    const client = createClient({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"5".repeat(64)}`,
        GITHUB_SHA: "a".repeat(40),
        PROOFLINE_TREE_HASH: "b".repeat(40),
      },
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (request.method === "POST" && path === "/v1/runs") {
          return Response.json({ runId: "run_live" }, { status: 202 });
        }
        if (
          request.method === "POST" &&
          path === "/v1/runs/run_live/submissions"
        ) {
          return Response.json({ accepted: true }, { status: 202 });
        }
        if (request.method === "GET" && path === "/v1/runs/run_live") {
          return Response.json({
            runId: "run_live",
            terminal: true,
            sequence: 7,
            transactionHash: `0x${"6".repeat(64)}`,
            votingRound: "42871",
            proofChecksum: checksum,
            consumerVerified: true,
            broadcastCountAfterRecordedHash: 0,
          });
        }
        if (request.method === "GET" && path === "/v1/runs/run_live/bundle") {
          return new Response(
            `{"version":"1","runId":"run_live","checksum":"${checksum}"}`,
            { headers: { "content-type": "application/json" } },
          );
        }
        if (request.method === "POST" && path === "/v1/replays") {
          return Response.json({
            runId: "run_live",
            checksum,
            byteIdentical: true,
          });
        }
        throw new Error(`Unexpected Action request ${request.method} ${path}`);
      }),
      clock: { now: vi.fn(() => 2_000), sleep: vi.fn() },
      files: { readText: vi.fn().mockResolvedValue(JSON.stringify(manifest)) },
    });

    await expect(
      client.runLive({
        manifestPath: "proofline.manifest.json",
        network: "coston2",
        timeoutMs: 600_000,
        rebroadcastAfterTransactionHash: false,
      }),
    ).resolves.toMatchObject({
      runId: "run_live",
      transactionHash: `0x${"6".repeat(64)}`,
      persistedRun: { runId: "run_live", lastSequence: 7 },
    });
    expect(
      requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "POST /v1/runs",
        "POST /v1/runs/run_live/submissions",
        "GET /v1/runs/run_live",
      ]),
    );
  });

  it("rejects PR replay evidence without the same persisted run identity", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };

    await expect(
      runProoflineAction({
        eventName: "pull_request",
        inputs: { manifest: "proofline.manifest.json" },
        env: {},
        client: {
          replayManifest: vi.fn().mockResolvedValue({
            runId: "run_pr",
            checksum: `sha256:${"c".repeat(64)}`,
            persistedRun: { runId: "run_synthetic", lastSequence: 7 },
          }),
          runLive: vi.fn(),
        },
        artifacts,
      }),
    ).resolves.toBe(1);
    expect(artifacts.upload).not.toHaveBeenCalled();
  });

  it("rejects merge evidence whose run identity exists only in synthetic memory", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };

    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: "proofline.manifest.json" },
        env: {
          PROOFLINE_PROJECT_TOKEN: `project_${"d".repeat(64)}`,
          PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"e".repeat(64)}`,
          GITHUB_SHA: "f".repeat(40),
          PROOFLINE_TREE_HASH: "1".repeat(40),
        },
        client: {
          replayManifest: vi.fn(),
          runLive: vi.fn().mockResolvedValue({
            commitHash: "f".repeat(40),
            treeHash: "1".repeat(40),
            runId: "run_live",
            transactionHash: `0x${"2".repeat(64)}`,
            votingRound: "42871",
            proofChecksum: `sha256:${"3".repeat(64)}`,
            consumerVerified: true,
            broadcastCountAfterRecordedHash: 0,
            persistedRun: { runId: "run_synthetic", lastSequence: 7 },
          }),
        },
        artifacts,
      }),
    ).resolves.toBe(1);
    expect(artifacts.upload).not.toHaveBeenCalled();
  });
});
