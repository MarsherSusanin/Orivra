// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { createProoflineApi } from "../src/app";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;

function request(runId: string, token = PROJECT_TOKEN, method = "GET") {
  return new Request(
    `https://api.proofline.test/v1/runs/${encodeURIComponent(runId)}/preflight`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "idempotency-key": "forbidden-write" } : {}),
      },
    },
  );
}

function harness() {
  const service = {
    getPreflightReport: vi.fn(async () => validPreflightReport),
  };
  const authenticate = vi.fn(async (token: string) => {
    if (token === PROJECT_TOKEN) {
      return { kind: "project" as const, projectId: "project_1" };
    }
    if (token === SHARE_TOKEN) {
      return { kind: "share" as const, projectId: "project_1", runId: RUN_ID };
    }
    return null;
  });
  return { service, api: createProoflineApi({ service, authenticate }) };
}

describe("GET /v1/runs/:id/preflight", () => {
  it("returns the persisted public report to its project", async () => {
    const fixture = harness();

    const response = await fixture.api.fetch(request(RUN_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validPreflightReport);
    expect(fixture.service.getPreflightReport).toHaveBeenCalledWith({
      projectId: "project_1",
      runId: RUN_ID,
      idempotencyKey: undefined,
    });
  });

  it("allows a read-only same-run share token", async () => {
    const fixture = harness();

    const response = await fixture.api.fetch(request(RUN_ID, SHARE_TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validPreflightReport);
    expect(fixture.service.getPreflightReport).toHaveBeenCalledOnce();
  });

  it("denies a share token for another run before service access", async () => {
    const fixture = harness();

    const response = await fixture.api.fetch(request("run_other", SHARE_TOKEN));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "SHARE_RUN_SCOPE" },
    });
    expect(fixture.service.getPreflightReport).not.toHaveBeenCalled();
  });

  it("never turns the report path into a share-token mutation surface", async () => {
    const fixture = harness();

    const response = await fixture.api.fetch(request(RUN_ID, SHARE_TOKEN, "POST"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      version: "1",
      error: { code: "SHARE_READ_ONLY" },
    });
    expect(fixture.service.getPreflightReport).not.toHaveBeenCalled();
  });
});
