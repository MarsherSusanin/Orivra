// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  makeBundleInput,
} from "../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import { runProoflineAction } from "../packages/action/src/index";
import { createPersistedActionRunClient } from "../packages/action/src/runtime";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const liveTestPath = resolve(repositoryRoot, "tests/live/coston2.live.test.ts");
const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const TRANSACTION_HASH = `0x${"9".repeat(64)}`;

afterEach(() => {
  vi.unstubAllEnvs();
});

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function documentedLiveGraph(): Map<string, string> {
  const visited = new Map<string, string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    const contents = readFileSync(path, "utf8");
    visited.set(path, contents);
    for (const match of contents.matchAll(
      /(?:from\s+|import\s*\()["'](\.[^"']+)["']/g,
    )) {
      const candidate = resolve(dirname(path), match[1]);
      const resolved = [
        ...(extname(candidate) ? [candidate] : []),
        `${candidate}.ts`,
        `${candidate}.tsx`,
        resolve(candidate, "index.ts"),
      ].find(existsSync);
      if (resolved?.startsWith(repositoryRoot)) visit(resolved);
    }
  };

  visit(liveTestPath);
  visit(resolve(repositoryRoot, "packages/action/src/entry.ts"));
  return visited;
}

function persistedLiveHarness(broadcastCountAfterRecordedHash: number) {
  const input = makeBundleInput();
  const manifest = {
    ...input.manifest,
    submission: { ...input.manifest.submission, mode: "relayer" as const },
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
          mode: "relayer" as const,
          transactionHash: TRANSACTION_HASH,
        },
      };
    }
    return event;
  });
  const bundle = createProofBundle({ ...input, manifest, events });
  const serializedBundle = canonicalSerializeProofBundle(bundle);
  const requests: Request[] = [];
  const replayedBundleBodies: string[] = [];
  let projectionReads = 0;
  const environment = {
    PROOFLINE_API_URL: "https://proofline.invalid",
    PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
    PROOFLINE_LIVE_MANIFEST: "proofline.manifest.json",
    GITHUB_EVENT_NAME: "merge_group",
    GITHUB_SHA: "b".repeat(40),
    PROOFLINE_TREE_HASH: "c".repeat(40),
  };
  const client = createPersistedActionRunClient({
    environment,
    fetch: vi.fn(async (requestInput: string | URL | Request, init?: RequestInit) => {
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
        projectionReads += 1;
        if (projectionReads === 1) {
          return Response.json({
            runId: RUN_ID,
            terminal: false,
            sequence: 6,
            proofVerified: true,
            stages: { verify: "completed" },
          });
        }
        return Response.json({
          runId: RUN_ID,
          terminal: true,
          sequence: events.length,
          transactionHash: TRANSACTION_HASH,
          votingRound: String(bundle.proof.votingRound),
          proofChecksum: bundle.checksum,
          consumerVerified: true,
          broadcastCountAfterRecordedHash,
        });
      }
      if (
        request.method === "POST" &&
        path === `/v1/runs/${RUN_ID}/consumer-verifications`
      ) {
        return Response.json({ accepted: true }, { status: 202 });
      }
      if (request.method === "GET" && path === `/v1/runs/${RUN_ID}/bundle`) {
        return new Response(serializedBundle, {
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && path === "/v1/replays") {
        const body = (await request.json()) as { bundle?: unknown };
        replayedBundleBodies.push(String(body.bundle ?? ""));
        return Response.json({
          runId: RUN_ID,
          checksum: bundle.checksum,
          byteIdentical: body.bundle === serializedBundle,
        });
      }
      throw new Error(`Unexpected persisted live request ${request.method} ${path}`);
    }),
    clock: { now: () => 1_000, sleep: vi.fn() },
    files: {
      readText: vi.fn().mockResolvedValue(JSON.stringify(manifest)),
    },
  });

  return {
    client,
    environment,
    requests,
    replayedBundleBodies,
    serializedBundle,
  };
}

describe("Slice 012 documented persisted live gate", () => {
  it("routes npm test:live:coston2 through the persisted Action HTTP client", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      scripts?: Record<string, string>;
    };
    const liveConfig = source("vitest.live.config.ts");
    const liveTest = readFileSync(liveTestPath, "utf8");

    expect(packageJson.scripts?.["test:live:coston2"]).toMatch(
      /vitest\s+run\s+--config\s+vitest\.live\.config\.ts/,
    );
    expect(liveConfig).toMatch(/tests\/live\/\*\*\/\*\.test\.ts/);
    expect(
      liveTest.includes("createPersistedActionRunClient"),
      "the documented live runner must construct the production persisted client",
    ).toBe(true);
    expect(
      /packages\/action\/src\/runtime/.test(liveTest),
      "the documented live runner must import the Action HTTP runtime",
    ).toBe(true);
    expect(
      /apps\/worker|live-gate/.test(liveTest),
      "the documented live runner cannot import a direct worker orchestrator",
    ).toBe(false);
  });

  it("requires observer-only runner configuration and no worker custody secret", () => {
    const liveTest = readFileSync(liveTestPath, "utf8");
    const configured = liveTest.match(/const\s+configured\s*=([\s\S]*?);/)?.[1] ?? "";
    const required = [
      "PROOFLINE_API_URL",
      "PROOFLINE_PROJECT_TOKEN",
      "PROOFLINE_LIVE_MANIFEST",
      "GITHUB_SHA",
      "PROOFLINE_TREE_HASH",
    ];
    const forbidden = [
      "PROOFLINE_COSTON2_PRIVATE_KEY",
      "PROOFLINE_VERIFIER_API_KEY",
    ];

    for (const name of required) {
      expect
        .soft(
          configured.includes(`process.env.${name}`),
          `${name} must gate the documented live runner`,
        )
        .toBe(true);
    }
    for (const name of forbidden) {
      expect
        .soft(
          configured.includes(name),
          `${name} belongs only to the deployed worker`,
        )
        .toBe(false);
    }
  });

  it("removes the obsolete direct gate and forbids direct signing or broadcast in the release graph", () => {
    const obsoleteFiles = [
      "apps/worker/src/live-gate.ts",
      "apps/worker/src/live-gate-runtime.ts",
      "apps/worker/test/live-gate-hardening.test.ts",
    ];
    for (const path of obsoleteFiles) {
      expect.soft(existsSync(resolve(repositoryRoot, path)), `${path} must be deleted`).toBe(
        false,
      );
    }

    const staleConsumers = [
      "tests/production-surfaces.contract.test.ts",
      "apps/worker/test/live-runtime-adapter.contract.test.ts",
    ];
    for (const path of staleConsumers) {
      expect
        .soft(
          /live-gate(?:-runtime)?|runLiveCoston2Gate|createLiveCoston2Runtime/.test(
            source(path),
          ),
          `${path} must stop importing the obsolete gate`,
        )
        .toBe(false);
    }

    const graph = [...documentedLiveGraph().entries()];
    const matchingPaths = (pattern: RegExp) =>
      graph
        .filter(([path, contents]) => pattern.test(`${path}\n${contents}`))
        .map(([path]) => path.slice(repositoryRoot.length));
    expect(
      matchingPaths(/apps\/worker\/src\/live-gate|live-gate-runtime/),
    ).toEqual([]);
    expect(matchingPaths(/\bsignRelayerTransaction\s*\(/)).toEqual([]);
    expect(matchingPaths(/\bbroadcastRawTransaction\s*\(/)).toEqual([]);
  });
});

describe("Slice 012 persisted evidence controls", () => {
  it("publishes only same-run positive-sequence evidence after byte-identical bundle replay", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const harness = persistedLiveHarness(0);
    const evidence = await harness.client.runLive({
      manifestPath: harness.environment.PROOFLINE_LIVE_MANIFEST,
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });

    expect(evidence).toMatchObject({
      runId: RUN_ID,
      persistedRun: { runId: RUN_ID, lastSequence: 7 },
      broadcastCountAfterRecordedHash: 0,
      consumerVerified: true,
    });
    expect(harness.replayedBundleBodies).toEqual([harness.serializedBundle]);
    expect(
      harness.requests.map(
        (request) => `${request.method} ${new URL(request.url).pathname}`,
      ),
    ).toEqual([
      "POST /v1/runs",
      `POST /v1/runs/${RUN_ID}/submissions`,
      `GET /v1/runs/${RUN_ID}`,
      `POST /v1/runs/${RUN_ID}/consumer-verifications`,
      `GET /v1/runs/${RUN_ID}`,
      `GET /v1/runs/${RUN_ID}/bundle`,
      "POST /v1/replays",
    ]);

    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: harness.environment.PROOFLINE_LIVE_MANIFEST },
        env: harness.environment,
        client: { replayManifest: vi.fn(), runLive: vi.fn().mockResolvedValue(evidence) },
        artifacts,
      }),
    ).resolves.toBe(0);
    expect(artifacts.upload).toHaveBeenCalledWith(
      "proofline-live-evidence",
      evidence,
    );
  });

  it("derives the post-hash broadcast count from projection and rejects a nonzero value", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const harness = persistedLiveHarness(2);
    const evidence = await harness.client.runLive({
      manifestPath: harness.environment.PROOFLINE_LIVE_MANIFEST,
      network: "coston2",
      timeoutMs: 600_000,
      rebroadcastAfterTransactionHash: false,
    });
    expect(evidence.broadcastCountAfterRecordedHash).toBe(2);

    const artifacts = { writeSummary: vi.fn(), upload: vi.fn() };
    await expect(
      runProoflineAction({
        eventName: "merge_group",
        inputs: { manifest: harness.environment.PROOFLINE_LIVE_MANIFEST },
        env: harness.environment,
        client: { replayManifest: vi.fn(), runLive: vi.fn().mockResolvedValue(evidence) },
        artifacts,
      }),
    ).resolves.toBe(1);
    expect(artifacts.upload).not.toHaveBeenCalled();
  });
});
