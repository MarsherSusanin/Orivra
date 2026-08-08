// @vitest-environment node

import { MockAgent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  exactTrustManifest,
  validPreflightReport,
} from "../../contracts/test/fixtures";
import { runWeb2JsonPreflight } from "../src/preflight";
import { createWeb2JsonVerifierClient } from "../src/verifier";
import { FDC_HUB, REQUEST_BYTES, verifierPayload } from "./fixtures";

const agents: MockAgent[] = [];

afterEach(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  agents.length = 0;
});

function flareManifest() {
  return { ...structuredClone(exactTrustManifest), network: "flare" as const };
}

describe("Slice 022 Coston2 preflight boundary", () => {
  it("rejects Flare before fetch, transform, verifier, registry-backed fee, or any other port effect", async () => {
    const ports = {
      safeFetcher: { getJson: vi.fn(async () => ({ price: 2500 })) },
      transformJq: vi.fn(async () => ({ value: 2_500_000_000 })),
      abiEncode: vi.fn(() => "0x1234"),
      verifier: {
        prepareRequest: vi.fn(async () => ({ requestBytes: REQUEST_BYTES })),
      },
      feeOracle: { quote: vi.fn(async () => 12_345n) },
    };

    const error = await runWeb2JsonPreflight(
      {
        runId: RUN_ID,
        manifest: flareManifest(),
        samples: 5,
        fdcHub: FDC_HUB,
        networkSnapshot: validPreflightReport.registrySnapshot,
        ...ports,
      } as never,
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(ports.safeFetcher.getJson).not.toHaveBeenCalled();
    expect(ports.transformJq).not.toHaveBeenCalled();
    expect(ports.abiEncode).not.toHaveBeenCalled();
    expect(ports.verifier.prepareRequest).not.toHaveBeenCalled();
    expect(ports.feeOracle.quote).not.toHaveBeenCalled();
    expect(String(error)).toMatch(/Coston2/i);
  });

  it("rejects Flare before the verifier HTTP request", async () => {
    const agent = new MockAgent();
    agents.push(agent);
    agent.disableNetConnect();
    agent
      .get("https://verifier.example")
      .intercept({
        path: "/verifier/web2/Web2Json/prepareRequest",
        method: "POST",
        body: JSON.stringify(verifierPayload),
      })
      .reply(200, { status: "VALID", abiEncodedRequest: REQUEST_BYTES });

    const client = createWeb2JsonVerifierClient({
      endpoint: "https://verifier.example",
      apiKey: "verifier-secret",
      dispatcher: agent,
    });

    const error = await client.prepareRequest(flareManifest()).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(agent.pendingInterceptors()).toHaveLength(1);
    expect(String(error)).toMatch(/Coston2/i);
  });
});
