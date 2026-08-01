// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveSurfaceServices } from "./run-surface";

const projectToken = `project_${"c".repeat(64)}`;
const runId = "run_hydration_truth";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
) {
  return {
    sequence,
    type,
    payload,
    occurredAt: `2026-08-02T01:00:0${sequence}.000Z`,
  };
}

async function hydrate(projection: unknown, events: unknown[]) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(projection))
    .mockResolvedValueOnce(response({ events, nextAfter: events.length }));
  vi.stubGlobal("fetch", fetch);
  const services = createLiveSurfaceServices({
    baseUrl: "https://api.proofline.test",
    projectToken,
    storage: { getItem: () => null, setItem: () => undefined },
  });
  return services.hydrateRun!({ runId, projectToken, after: 0 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("diagnostics evidence trust boundary", () => {
  it.each([
    ["absent", { stages: { consumer: "pending" } }, []],
    ["projection empty before verification", { stages: { consumer: "pending" }, diagnostics: [] }, []],
    ["malformed projection", { stages: { consumer: "failed" }, diagnostics: "invalid" }, []],
    [
      "malformed persisted event",
      { stages: { consumer: "completed" } },
      [event(1, "CONSUMER_VERIFIED", { passed: true, diagnostics: [{ code: 42 }] })],
    ],
  ])("keeps diagnostics unavailable for %s evidence", async (_label, projection, events) => {
    const hydrated = await hydrate(projection, events as unknown[]);
    expect(hydrated.diagnostics).toBeUndefined();
  });

  it("returns an explicit empty list only for completed persisted verification evidence", async () => {
    const hydrated = await hydrate(
      { stages: { consumer: "completed" } },
      [event(1, "CONSUMER_VERIFIED", { passed: true, diagnostics: [] })],
    );
    expect(hydrated.diagnostics).toEqual([]);
  });
});

describe("hydrated submission identity", () => {
  it("preserves an explicit projection submission mode", async () => {
    const hydrated = await hydrate(
      { stages: {}, submissionMode: "relayer" },
      [],
    );
    expect(hydrated).toMatchObject({ submissionMode: "relayer" });
  });

  it("derives submission mode from the persisted manifest when projection omits it", async () => {
    const hydrated = await hydrate(
      { stages: {} },
      [event(1, "RUN_CREATED", {
        manifest: {
          attestationType: "Web2Json",
          network: "coston2",
          submission: { mode: "replay" },
        },
      })],
    );
    expect(hydrated).toMatchObject({ submissionMode: "replay" });
  });
});
