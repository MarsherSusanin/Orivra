// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  makeBundleInput,
  validManifest,
} from "../../contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import {
  createPersistedActionRunClient,
  createProductionActionDependencies,
} from "../src/runtime";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const environment = {
  PROOFLINE_API_URL: "https://proofline.invalid/",
  PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
  GITHUB_REPOSITORY: "proofline/proofline",
  GITHUB_EVENT_NAME: "merge_group",
  GITHUB_SHA: "b".repeat(40),
  PROOFLINE_TREE_HASH: "c".repeat(40),
  GITHUB_WORKFLOW: "proofline-release",
  GITHUB_JOB: "proofline",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function terminalBundle() {
  return createProofBundle(makeBundleInput());
}

function clientHarness(input?: {
  bundle?: Record<string, any> | string;
  projection?: Record<string, unknown>;
  submission?: Array<{ status: number; body: unknown }>;
}) {
  let now = 0;
  let submissionAttempt = 0;
  const requests: Request[] = [];
  const sleep = vi.fn(async (milliseconds: number) => {
    now += milliseconds;
  });
  const bundleValue = input?.bundle ?? terminalBundle();
  const bundle =
    typeof bundleValue === "string"
      ? bundleValue
      : canonicalSerializeProofBundle(bundleValue as any);
  const checksum =
    typeof bundleValue === "string"
      ? `sha256:${"d".repeat(64)}`
      : String(bundleValue.checksum);
  const fetch = vi.fn(
    async (requestInput: string | URL | Request, init?: RequestInit) => {
      const request = new Request(requestInput, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/v1/runs") {
        return Response.json({ runId: RUN_ID }, { status: 202 });
      }
      if (request.method === "POST" && path.endsWith("/submissions")) {
        const selected =
          input?.submission?.[
            Math.min(submissionAttempt++, input.submission.length - 1)
          ];
        return selected
          ? Response.json(selected.body, { status: selected.status })
          : Response.json({ accepted: true }, { status: 202 });
      }
      if (request.method === "GET" && path === `/v1/runs/${RUN_ID}`) {
        return Response.json(
          input?.projection ?? {
            runId: RUN_ID,
            terminal: true,
            sequence: 7,
            broadcastCountAfterRecordedHash: 0,
          },
        );
      }
      if (request.method === "GET" && path.endsWith("/bundle")) {
        return new Response(bundle);
      }
      if (request.method === "POST" && path === "/v1/replays") {
        return Response.json({
          runId: RUN_ID,
          byteIdentical: true,
          checksum,
        });
      }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    },
  );
  const client = createPersistedActionRunClient({
    environment,
    fetch,
    clock: { now: () => now, sleep },
    files: { readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)) },
  });
  return { client, fetch, requests, sleep };
}

describe("Slice 007 Action terminal bundle validation coverage", () => {
  it("accepts a complete terminal consumer command graph", async () => {
    const bundle = terminalBundle();
    const fixture = clientHarness({ bundle });

    await expect(
      fixture.client.replayManifest("proofline.manifest.json"),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      checksum: bundle.checksum,
      persistedRun: { runId: RUN_ID, lastSequence: 7 },
    });
  });

  it.each([
    [
      "bundle run identity",
      (bundle: Record<string, any>) => ({ ...bundle, runId: "run_other" }),
    ],
    [
      "required event",
      (bundle: Record<string, any>) => ({
        ...bundle,
        events: bundle.events.filter(
          (event: any) => event.type !== "PROOF_VERIFIED",
        ),
      }),
    ],
    [
      "final event type",
      (bundle: Record<string, any>) => ({
        ...bundle,
        events: [...bundle.events, { type: "RELEASE_AUDIT" }],
      }),
    ],
    [
      "final event run",
      (bundle: Record<string, any>) => ({
        ...bundle,
        events: bundle.events.map((event: any, index: number) =>
          index === bundle.events.length - 1
            ? { ...event, runId: "run_other" }
            : event,
        ),
      }),
    ],
    [
      "failed consumer event",
      (bundle: Record<string, any>) => ({
        ...bundle,
        events: bundle.events.map((event: any) =>
          event.type === "CONSUMER_VERIFIED"
            ? { ...event, payload: { ...event.payload, passed: false } }
            : event,
        ),
      }),
    ],
    [
      "unverified proof",
      (bundle: Record<string, any>) => ({
        ...bundle,
        verification: { ...bundle.verification, proofVerified: false },
      }),
    ],
    [
      "unverified consumer",
      (bundle: Record<string, any>) => ({
        ...bundle,
        verification: { ...bundle.verification, consumerVerified: false },
      }),
    ],
  ])("rejects terminal bundle with invalid %s", async (_label, mutate) => {
    const fixture = clientHarness({
      bundle: JSON.stringify(
        mutate(structuredClone(terminalBundle()) as any),
      ),
    });
    await expect(
      fixture.client.replayManifest("proofline.manifest.json"),
    ).rejects.toThrow(/terminal consumer command graph/i);
  });

  it("rejects a projection sequence that does not match the terminal event", async () => {
    const fixture = clientHarness({
      bundle: terminalBundle(),
      projection: { runId: RUN_ID, terminal: true, sequence: 8 },
    });
    await expect(
      fixture.client.replayManifest("proofline.manifest.json"),
    ).rejects.toThrow(/terminal consumer command graph/i);
  });
});

describe("Slice 007 Action readiness mapping coverage", () => {
  it("retries only stable PREFLIGHT_NOT_READY and preserves one command identity", async () => {
    const fixture = clientHarness({
      bundle: terminalBundle(),
      submission: [
        {
          status: 404,
          body: { error: { code: "PREFLIGHT_NOT_READY" } },
        },
        { status: 202, body: { accepted: true } },
      ],
    });

    await expect(
      fixture.client.runLive({
        manifestPath: "proofline.manifest.json",
        timeoutMs: 10_000,
      }),
    ).resolves.toMatchObject({ runId: RUN_ID });
    const submissions = fixture.requests.filter((request) =>
      new URL(request.url).pathname.endsWith("/submissions"),
    );
    expect(submissions).toHaveLength(2);
    expect(submissions[0]?.headers.get("idempotency-key")).toBe(
      submissions[1]?.headers.get("idempotency-key"),
    );
    expect(fixture.sleep).toHaveBeenCalledWith(2_000);
  });

  it("stops readiness retries at the bounded deadline", async () => {
    const fixture = clientHarness({
      bundle: terminalBundle(),
      submission: [
        {
          status: 404,
          body: { code: "PREFLIGHT_NOT_READY" },
        },
      ],
    });

    await expect(
      fixture.client.runLive({
        manifestPath: "proofline.manifest.json",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "PREFLIGHT_NOT_READY",
    });
    expect(fixture.sleep).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not retry a different API failure", async () => {
    const fixture = clientHarness({
      bundle: terminalBundle(),
      submission: [
        {
          status: 409,
          body: { error: { code: "RUN_TERMINAL" } },
        },
      ],
    });

    await expect(
      fixture.client.runLive({
        manifestPath: "proofline.manifest.json",
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ status: 409, code: "RUN_TERMINAL" });
    expect(fixture.sleep).not.toHaveBeenCalled();
  });
});

describe("Slice 007 Action production custody coverage", () => {
  it("filters every private/secret key name and forwards no legacy custody fields", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const runLive = vi.fn(async (request) => request);
    const dependencies = createProductionActionDependencies({
      environment: {
        ...environment,
        PROOFLINE_COSTON2_PRIVATE_KEY: `0x${"1".repeat(64)}`,
        RELEASE_SECRET_KEY: "release-secret",
        SAFE_SETTING: "visible",
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

    expect(dependencies.env).toMatchObject({
      PROOFLINE_PROJECT_TOKEN: PROJECT_TOKEN,
      SAFE_SETTING: "visible",
    });
    expect(dependencies.env).not.toHaveProperty("PROOFLINE_COSTON2_PRIVATE_KEY");
    expect(dependencies.env).not.toHaveProperty("RELEASE_SECRET_KEY");
    await dependencies.client.runLive({ manifestPath: "proofline.manifest.json" });
    expect(runLive).toHaveBeenCalledWith({
      manifestPath: "proofline.manifest.json",
    });
  });
});
