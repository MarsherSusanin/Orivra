// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const projectToken = "project_" + "a".repeat(64);
const shareToken = "share_" + "b".repeat(64);
const runId = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";

function jsonRequest(
  path: string,
  {
    method = "GET",
    token = projectToken,
    body,
    idempotencyKey,
  }: {
    method?: string;
    token?: string | null;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createHarness() {
  const service = {
    createRun: vi.fn().mockResolvedValue({
      status: "accepted",
      runId,
      location: `/v1/runs/${runId}`,
    }),
    getRun: vi.fn().mockResolvedValue({ version: "1", runId, sequence: 1 }),
    listRuns: vi.fn().mockResolvedValue({
      version: "1",
      runs: [],
      nextCursor: "eyJ1cGRhdGVkQXQiOiIyMDI2LTA4LTAyIn0",
    }),
    listEvents: vi.fn().mockResolvedValue({ events: [], nextAfter: 0 }),
    createSubmission: vi.fn().mockResolvedValue({
      version: "1",
      runId,
      mode: "wallet",
      effectOwner: "wallet",
      transaction: {
        chainId: "0x72",
        to: "0x3333333333333333333333333333333333333333",
        data: "0xfeedcafe",
        value: "0x3039",
      },
    }),
    attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    verifyConsumer: vi.fn().mockResolvedValue({ accepted: true }),
    generateConsumer: vi.fn().mockResolvedValue({ artifactId: "artifact_safe" }),
    getConsumerLabReport: vi.fn().mockResolvedValue({ version: "1", runId }),
    getBundle: vi.fn().mockResolvedValue({ version: "1", runId, checksum: `sha256:${"a".repeat(64)}` }),
    replay: vi.fn().mockResolvedValue({ runId: "run_replay", byteIdentical: true }),
    createShare: vi.fn().mockResolvedValue({
      version: "1",
      runId,
      url: `https://proofline.test/runs/${runId}#share=${shareToken}`,
    }),
  };
  const authenticate = vi.fn(async (rawToken: string) => {
    if (rawToken === projectToken) {
      return { kind: "project" as const, projectId: "project_1" };
    }
    if (rawToken === shareToken) {
      return { kind: "share" as const, projectId: "project_1", runId };
    }
    return null;
  });
  return {
    service,
    api: createProoflineApi({ service, authenticate }),
  };
}

describe("Proofline v1 API routing", () => {
  it("serves Consumer Lab evidence to project and run-scoped share readers", async () => {
    const { api, service } = createHarness();
    for (const token of [projectToken, shareToken]) {
      const response = await api.fetch(jsonRequest(`/v1/runs/${runId}/consumer-lab`, { token }));
      expect(response.status).toBe(200);
    }
    expect(service.getConsumerLabReport).toHaveBeenCalledTimes(2);
  });
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("creates an idempotent run with project auth and starts preflight", async () => {
    const response = await harness.api.fetch(
      jsonRequest("/v1/runs", {
        method: "POST",
        idempotencyKey: "create-fixture-run",
        body: { manifest: validManifest },
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/v1/runs/${runId}`);
    expect(await response.json()).toMatchObject({ runId, status: "accepted" });
    expect(harness.service.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        idempotencyKey: "create-fixture-run",
        manifest: validManifest,
      }),
    );
  });

  it("lists project runs without requiring idempotency and forwards validated filters", async () => {
    const cursor = "eyJ1cGRhdGVkQXQiOiIyMDI2LTA4LTAyIn0";
    const response = await harness.api.fetch(
      jsonRequest(`/v1/runs?status=active&cursor=${cursor}&limit=7`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: "1",
      runs: [],
      nextCursor: cursor,
    });
    expect(harness.service.listRuns).toHaveBeenCalledWith({
      projectId: "project_1",
      status: "active",
      cursor,
      limit: 7,
    });
  });

  it("defaults the project run page to 20 items", async () => {
    const response = await harness.api.fetch(jsonRequest("/v1/runs"));

    expect(response.status).toBe(200);
    expect(harness.service.listRuns).toHaveBeenCalledWith({
      projectId: "project_1",
      status: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it.each([
    ["unknown status", "status=pending"],
    ["blank cursor", "cursor=%20"],
    ["structured cursor", "cursor=updated_at%3Dsecret"],
    ["zero limit", "limit=0"],
    ["limit above the cap", "limit=51"],
    ["fractional limit", "limit=1.5"],
    ["duplicate filters", "status=active&status=failed"],
  ])("fails closed for an invalid run-list %s", async (_caseName, query) => {
    const response = await harness.api.fetch(jsonRequest(`/v1/runs?${query}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "INVALID_RUN_LIST_QUERY" },
    });
    expect(harness.service.listRuns).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", `/v1/runs/${runId}`, "getRun"],
    ["GET", `/v1/runs/${runId}/events?after=4`, "listEvents"],
    ["POST", `/v1/runs/${runId}/submissions`, "createSubmission"],
    ["POST", `/v1/runs/${runId}/transactions`, "attachTransaction"],
    ["POST", `/v1/runs/${runId}/consumer-verifications`, "verifyConsumer"],
    ["POST", `/v1/runs/${runId}/artifacts/consumer`, "generateConsumer"],
    ["GET", `/v1/runs/${runId}/bundle`, "getBundle"],
    ["POST", "/v1/replays", "replay"],
    ["POST", `/v1/runs/${runId}/share`, "createShare"],
  ])("routes %s %s to %s", async (method, path, serviceMethod) => {
    const response = await harness.api.fetch(
      jsonRequest(path, {
        method,
        body:
          method !== "POST"
            ? undefined
            : serviceMethod === "createSubmission"
              ? { mode: "wallet" }
              : {},
        idempotencyKey: method === "POST" ? "command-idem" : undefined,
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(harness.service[serviceMethod as keyof typeof harness.service]).toHaveBeenCalledOnce();
    if (serviceMethod === "listEvents") {
      expect(harness.service.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({ after: 4 }),
      );
    }
  });
});

describe("API authentication, share, and secret boundaries", () => {
  it("denies project enumeration to a run-scoped share token", async () => {
    const { api, service } = createHarness();
    const response = await api.fetch(jsonRequest("/v1/runs", { token: shareToken }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "SHARE_READ_ONLY" },
    });
    expect(service.listRuns).not.toHaveBeenCalled();
  });

  it("requires a bearer project token for every mutation", async () => {
    const { api } = createHarness();
    for (const [path, body] of [
      ["/v1/runs", { manifest: validManifest }],
      [`/v1/runs/${runId}/submissions`, { mode: "relayer" }],
      [`/v1/runs/${runId}/consumer-verifications`, {}],
    ] as const) {
      const response = await api.fetch(
        jsonRequest(path, { method: "POST", token: null, body }),
      );
      expect(response.status).toBe(401);
    }
  });

  it("allows a share token to read only its run and never mutate or cross runs", async () => {
    const { api, service } = createHarness();
    expect(
      (
        await api.fetch(
          jsonRequest(`/v1/runs/${runId}`, { token: shareToken }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api.fetch(
          jsonRequest(`/v1/runs/${runId}/events?after=0`, { token: shareToken }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api.fetch(
          jsonRequest("/v1/runs/run_other", { token: shareToken }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api.fetch(
          jsonRequest(`/v1/runs/${runId}/consumer-verifications`, {
            method: "POST",
            token: shareToken,
            body: {},
          }),
        )
      ).status,
    ).toBe(403);
    expect(service.verifyConsumer).not.toHaveBeenCalled();
  });

  it("rejects private keys at the HTTP boundary and does not forward them to a service", async () => {
    const { api, service } = createHarness();
    const response = await api.fetch(
      jsonRequest(`/v1/runs/${runId}/submissions`, {
        method: "POST",
        body: { mode: "wallet", privateKey: "0xdeadbeef" },
        idempotencyKey: "unsafe",
      }),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("deadbeef");
    expect(service.createSubmission).not.toHaveBeenCalled();
  });

  it("requires 256-bit opaque tokens and an idempotency key on command endpoints", async () => {
    const { api } = createHarness();
    expect(
      (
        await api.fetch(
          jsonRequest("/v1/runs", {
            method: "POST",
            token: "short",
            idempotencyKey: "create",
            body: { manifest: validManifest },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await api.fetch(
          jsonRequest(`/v1/runs/${runId}/submissions`, {
            method: "POST",
            body: { mode: "wallet" },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("uses stable JSON errors and never leaks supplied bearer material", async () => {
    const { api } = createHarness();
    const response = await api.fetch(
      jsonRequest("/v1/runs/missing", { token: "project_" + "x".repeat(64) }),
    );
    expect([401, 404]).toContain(response.status);
    expect(response.headers.get("content-type")).toMatch(/application\/json/i);
    expect(await response.text()).not.toContain("x".repeat(64));
  });
});
