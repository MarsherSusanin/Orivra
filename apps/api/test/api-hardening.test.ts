// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";

const projectToken = `project_${"a".repeat(64)}`;
const shareToken = `share_${"b".repeat(64)}`;
const runId = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";

function service() {
  return {
    createRun: vi.fn().mockResolvedValue({ runId, location: `/v1/runs/${runId}` }),
    replay: vi.fn().mockResolvedValue({ runId: "run_replay" }),
    getRun: vi.fn().mockResolvedValue({ runId }),
    listEvents: vi.fn().mockResolvedValue({ events: [], nextAfter: 0 }),
    createSubmission: vi.fn().mockResolvedValue({ accepted: true }),
    attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    verifyConsumer: vi.fn().mockResolvedValue({ accepted: true }),
    generateConsumer: vi.fn().mockResolvedValue({ source: "contract Safe {}" }),
    getBundle: vi.fn().mockResolvedValue({ runId }),
    createShare: vi.fn().mockResolvedValue({ token: shareToken }),
  };
}

function apiWith(
  servicePort = service(),
  authenticate = vi.fn(async (token: string) => {
    if (token === projectToken) {
      return { kind: "project" as const, projectId: "project_1" };
    }
    if (token === shareToken) {
      return { kind: "share" as const, projectId: "project_1", runId };
    }
    return null;
  }),
) {
  return { api: createProoflineApi({ service: servicePort, authenticate }), service: servicePort };
}

function request(
  path: string,
  input: {
    method?: "GET" | "POST";
    token?: string;
    body?: string;
    idempotencyKey?: string;
    contentType?: string;
  } = {},
) {
  const headers = new Headers({
    authorization: `Bearer ${input.token ?? projectToken}`,
    accept: "application/json",
  });
  if (input.contentType) headers.set("content-type", input.contentType);
  if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method: input.method ?? "GET",
    headers,
    body: input.body,
  });
}

describe("API malformed input and failure envelope", () => {
  it.each(["-1", "1.5", "9007199254740992", "not-a-number"])(
    "rejects invalid event cursor %s before calling the service",
    async (after) => {
      const { api, service: servicePort } = apiWith();
      const response = await api.fetch(
        request(`/v1/runs/${runId}/events?after=${after}`),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_EVENT_CURSOR" },
      });
      expect(servicePort.listEvents).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed JSON", "{"],
    ["JSON array", "[]"],
    ["JSON primitive", '"unsafe"'],
  ])("returns stable INVALID_JSON for %s", async (_name, body) => {
    const { api, service: servicePort } = apiWith();
    const response = await api.fetch(
      request("/v1/runs", {
        method: "POST",
        idempotencyKey: "create-1",
        contentType: "application/json",
        body,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "INVALID_JSON" },
    });
    expect(servicePort.createRun).not.toHaveBeenCalled();
  });

  it("ignores a non-JSON body instead of forwarding opaque bytes", async () => {
    const { api, service: servicePort } = apiWith();
    const response = await api.fetch(
      request(`/v1/runs/${runId}/consumer-verifications`, {
        method: "POST",
        idempotencyKey: "verify-1",
        contentType: "text/plain",
        body: "privateKey=unsafe",
      }),
    );
    expect(response.status).toBe(202);
    expect(servicePort.verifyConsumer).toHaveBeenCalledWith(
      expect.objectContaining({ runId, projectId: "project_1" }),
    );
    expect(servicePort.verifyConsumer.mock.calls[0][0]).not.toHaveProperty("privateKey");
  });

  it("rejects nested private-key fields in arrays", async () => {
    const { api, service: servicePort } = apiWith();
    const response = await api.fetch(
      request(`/v1/runs/${runId}/submissions`, {
        method: "POST",
        idempotencyKey: "submit-unsafe",
        contentType: "application/json",
        body: JSON.stringify({ values: [{ mnemonic: "do not forward" }] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(servicePort.createSubmission).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("do not forward");
  });

  it("maps explicit service rejection status without publishing its message", async () => {
    const servicePort = service();
    servicePort.getRun.mockRejectedValue(
      Object.assign(new Error("internal conflict detail"), { status: 409 }),
    );
    const response = await apiWith(servicePort).api.fetch(
      request(`/v1/runs/${runId}`),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      version: "1",
      error: { code: "REQUEST_FAILED", message: "Request rejected" },
    });
  });

  it.each([
    new Error("database password leaked"),
    Object.assign(new Error("invalid status"), { status: 700 }),
  ])("normalizes unexpected service failures to opaque 500", async (failure) => {
    const servicePort = service();
    servicePort.getRun.mockRejectedValue(failure);
    const response = await apiWith(servicePort).api.fetch(
      request(`/v1/runs/${runId}`),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/password|invalid status/i);
  });

  it("returns a stable 404 and never calls a similarly prefixed route", async () => {
    const { api, service: servicePort } = apiWith();
    const response = await api.fetch(request(`/v1/runs/${runId}/bundle/extra`));
    expect(response.status).toBe(404);
    expect(servicePort.getBundle).not.toHaveBeenCalled();
  });
});

describe("API bearer and share scopes", () => {
  it("rejects a well-shaped but unauthorized opaque token", async () => {
    const authenticate = vi.fn().mockResolvedValue(null);
    const response = await apiWith(service(), authenticate).api.fetch(
      request(`/v1/runs/${runId}`, { token: `project_${"c".repeat(64)}` }),
    );
    expect(response.status).toBe(401);
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it.each([
    `/v1/runs/${runId}`,
    `/v1/runs/${runId}/events?after=0`,
    `/v1/runs/${runId}/bundle`,
  ])("allows a share token to read its exact run at %s", async (path) => {
    const response = await apiWith().api.fetch(
      request(path, { token: shareToken }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects share mutation before requiring an idempotency key", async () => {
    const { api, service: servicePort } = apiWith();
    const response = await api.fetch(
      request(`/v1/runs/${runId}/share`, {
        method: "POST",
        token: shareToken,
        contentType: "application/json",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "SHARE_READ_ONLY" },
    });
    expect(servicePort.createShare).not.toHaveBeenCalled();
  });
});
