// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Web2JsonManifestV1,
} from "../../packages/contracts/src";
import { validManifest } from "../../packages/contracts/test/fixtures";
import {
  createLiveSurfaceServices,
  type RunSurfaceServices,
} from "./run-surface";

const projectToken = `project_${"a".repeat(64)}`;
const runId = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";

type CreateRun = (context: {
  projectToken: string;
  manifest: Web2JsonManifestV1;
  idempotencyKey: string;
}) => Promise<{ status: "accepted"; runId: string; location: string }>;

function createRunPort(services: RunSurfaceServices): CreateRun {
  const createRun = (services as RunSurfaceServices & { createRun?: CreateRun })
    .createRun;
  expect(createRun, "RunSurfaceServices.createRun must be implemented").toBeTypeOf(
    "function",
  );
  return createRun!.bind(services);
}

function response(body: unknown, status = 202) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function live(storage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => null,
  setItem: () => undefined,
}) {
  return createLiveSurfaceServices({
    baseUrl: "https://api.proofline.test/api",
    projectToken,
    storage,
  });
}

function resumeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persisted run creation surface port", () => {
  it("authorizes the exact project token before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const createRun = createRunPort(live());

    await expect(
      createRun({
        projectToken: `project_${"b".repeat(64)}`,
        manifest: validManifest,
        idempotencyKey: "composer_123e4567-e89b-42d3-a456-426614174000",
      }),
    ).rejects.toThrow(/project token|required|authorize/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the exact manifest and stable idempotency key only to Proofline", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ status: "accepted", runId, location: `/v1/runs/${runId}` }),
    );
    vi.stubGlobal("fetch", fetch);
    const createRun = createRunPort(live());

    await expect(
      createRun({
        projectToken,
        manifest: validManifest,
        idempotencyKey: "composer_123e4567-e89b-42d3-a456-426614174000",
      }),
    ).resolves.toEqual({
      status: "accepted",
      runId,
      location: `/v1/runs/${runId}`,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.proofline.test/api/v1/runs");
    expect(url).not.toContain(new URL(validManifest.request.url).hostname);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Bearer ${projectToken}`,
    );
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "composer_123e4567-e89b-42d3-a456-426614174000",
    );
    expect(JSON.parse(String(init.body))).toEqual({ manifest: validManifest });
  });

  it.each([
    [
      "path traversal run id",
      { status: "accepted", runId: "../settings", location: "/v1/runs/../settings" },
    ],
    [
      "absolute response location",
      { status: "accepted", runId, location: "https://evil.example/runs/run_1" },
    ],
    [
      "mismatched response location",
      { status: "accepted", runId, location: "/v1/runs/run_other" },
    ],
    ["missing response fields", { status: "accepted" }],
  ])("rejects an invalid %s before navigation or resume persistence", async (_label, body) => {
    const resume = resumeStorage();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(
      createRunPort(live(resume.storage))({
        projectToken,
        manifest: validManifest,
        idempotencyKey: "composer_123e4567-e89b-42d3-a456-426614174000",
      }),
    ).rejects.toThrow(/run|response|contract|invalid/i);
    expect(resume.storage.setItem).not.toHaveBeenCalled();
    expect(resume.values.size).toBe(0);
  });
});
