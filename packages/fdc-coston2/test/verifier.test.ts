// @vitest-environment node

import { MockAgent } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import {
  createWeb2JsonVerifierClient,
  toBytes32Utf8,
} from "../src/verifier";
import {
  PUBLIC_WEB2_BYTES32,
  REQUEST_BYTES,
  WEB2JSON_BYTES32,
  verifierPayload,
} from "./fixtures";

const agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents.length = 0;
});

describe("Web2Json verifier preparation", () => {
  it("right-pads canonical attestation type and source ids to bytes32", () => {
    expect(toBytes32Utf8("Web2Json")).toBe(WEB2JSON_BYTES32);
    expect(toBytes32Utf8("PublicWeb2")).toBe(PUBLIC_WEB2_BYTES32);
    expect(() => toBytes32Utf8("x".repeat(33))).toThrow(/32 bytes/i);
  });

  it("sends the exact official safe-GET payload and accepts only VALID hex request bytes", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    const pool = agent.get("https://verifier.example");
    pool
      .intercept({
        path: "/verifier/web2/Web2Json/prepareRequest",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "verifier-secret",
        },
        body: JSON.stringify(verifierPayload),
      })
      .reply(200, { status: "VALID", abiEncodedRequest: REQUEST_BYTES });

    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example",
      apiKey: "verifier-secret",
      dispatcher: agent,
    });

    await expect(client.prepareRequest(validManifest)).resolves.toEqual({
      requestBytes: REQUEST_BYTES,
      attestationType: WEB2JSON_BYTES32,
      sourceId: PUBLIC_WEB2_BYTES32,
    });
    agent.assertNoPendingInterceptors();
  });

  it.each([
    [{ status: "INVALID", abiEncodedRequest: REQUEST_BYTES }, "INVALID"],
    [{ status: "VALID", abiEncodedRequest: "not-hex" }, "hex"],
    [{ status: "VALID" }, "schema"],
  ])("fails closed on verifier response %j", async (reply, evidence) => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    const pool = agent.get("https://verifier.example");
    pool
      .intercept({
        path: "/verifier/web2/Web2Json/prepareRequest",
        method: "POST",
      })
      .reply(200, reply);

    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example",
      apiKey: "verifier-secret",
      dispatcher: agent,
    });

    await expect(client.prepareRequest(validManifest)).rejects.toMatchObject({
      category: "schema-invalid",
      evidence: expect.objectContaining({ verifierStatus: expect.anything() }),
    });
    await expect(Promise.resolve(evidence)).resolves.toBeTruthy();
  });

  it("never includes verifier credentials in normalized transport errors", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example",
      apiKey: "top-secret-api-key",
      dispatcher: agent,
    });

    const error = await client.prepareRequest(validManifest).catch((cause) => cause);
    expect(JSON.stringify(error)).not.toContain("top-secret-api-key");
    expect(error).toMatchObject({ category: "transport", retryable: true });
  });
});
