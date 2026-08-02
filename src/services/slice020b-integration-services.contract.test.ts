// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { makeBundleInput, RUN_ID } from "../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createEvidenceReceipt,
  createProofBundle,
} from "../../packages/domain/src";
import { createRunClient } from "./run-client";
import { createLiveSurfaceServices } from "./run-surface";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const bundle = canonicalSerializeProofBundle(createProofBundle(makeBundleInput()));
const receipt = createEvidenceReceipt(bundle);
const link = {
  version: "1",
  runId: RUN_ID,
  url: `https://proofline.test/runs/${RUN_ID}#share=${SHARE_TOKEN}`,
} as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requiredMethod(owner: object, name: string) {
  const method = (owner as Record<string, unknown>)[name];
  expect(method, `${name} must be exposed by the integration service`).toEqual(
    expect.any(Function),
  );
  if (typeof method !== "function") throw new Error(`${name} is missing`);
  return method.bind(owner) as (...args: any[]) => Promise<any>;
}

describe("Slice 020B browser integration service contracts", () => {
  it("parses receipt and share-link responses and preserves one idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(receipt))
      .mockResolvedValueOnce(response(link, 201));
    const client = createRunClient({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const getEvidenceReceipt = requiredMethod(client, "getEvidenceReceipt");
    const createShare = requiredMethod(client, "createShare");

    await expect(getEvidenceReceipt(RUN_ID)).resolves.toEqual(receipt);
    await expect(createShare(RUN_ID, `share-${RUN_ID}`)).resolves.toEqual(link);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.proofline.test/v1/runs/${RUN_ID}/receipt`,
      `https://api.proofline.test/v1/runs/${RUN_ID}/share`,
    ]);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("idempotency-key")).toBe(
      `share-${RUN_ID}`,
    );
  });

  it("allows share receipt reads but rejects share creation before fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(response(receipt));
    const services = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: SHARE_TOKEN,
      storage: { getItem: () => null, setItem: () => undefined },
      fetch,
    });
    const getEvidenceReceipt = requiredMethod(services, "getEvidenceReceipt");
    const createShare = requiredMethod(services, "createShare");
    const context = { runId: RUN_ID, projectToken: SHARE_TOKEN };

    await expect(getEvidenceReceipt(context)).resolves.toEqual(receipt);
    await expect(createShare({
      ...context,
      idempotencyKey: `share-${RUN_ID}`,
    })).rejects.toThrow(/project|read.only/i);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.method ?? "GET").toBe("GET");
  });

  it("fails closed when the receipt or share response belongs to another run", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ...receipt, runId: "run_other" }))
      .mockResolvedValueOnce(response({ ...link, runId: "run_other" }, 201));
    const client = createRunClient({
      baseUrl: "/api",
      projectToken: PROJECT_TOKEN,
      fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    await expect(requiredMethod(client, "getEvidenceReceipt")(RUN_ID)).rejects.toThrow(
      /receipt|contract|identity/i,
    );
    await expect(requiredMethod(client, "createShare")(RUN_ID, `share-${RUN_ID}`)).rejects.toThrow(
      /share|contract|identity/i,
    );
  });
});
