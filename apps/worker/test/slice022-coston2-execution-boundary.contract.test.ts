// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  exactTrustManifest,
} from "../../../packages/contracts/test/fixtures";
import { createLiveCoston2PipelinePorts } from "../src/live-runtime";
import { createProductionCommandHandlers } from "../src/worker";

const PRIVATE_KEY = `0x${"1".repeat(64)}`;

function flareManifest() {
  return { ...structuredClone(exactTrustManifest), network: "flare" as const };
}

function liveEnvironment() {
  return {
    PROOFLINE_COSTON2_PRIVATE_KEY: PRIVATE_KEY,
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "100000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
  };
}

describe("Slice 022 production worker Coston2 boundary", () => {
  it("rejects a persisted Flare command before the production preflight port", async () => {
    const preflight = vi.fn();
    const handlers = createProductionCommandHandlers({
      repository: {
        loadRunExecutionContext: vi.fn(async () => ({
          runId: RUN_ID,
          projectId: "11111111-1111-4111-8111-111111111111",
          manifest: flareManifest(),
          events: [],
          projection: {},
          artifacts: [],
        })),
      },
      ports: { preflight },
      clock: { now: () => OCCURRED_AT },
    } as never);

    const error = await handlers
      .RUN_PREFLIGHT({
        id: "cmd_flare_preflight",
        kind: "RUN_PREFLIGHT",
        runId: RUN_ID,
        attempts: 1,
        payload: {},
      })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );
    expect(preflight).not.toHaveBeenCalled();
    expect(String(error)).toMatch(/Coston2/i);
  });

  it("rejects Flare at the live adapter entry before RPC, registry, verifier, source, or DA effects", async () => {
    const getBlockNumber = vi.fn(async () => {
      throw new Error("unexpected RPC effect");
    });
    const verifier = { prepareRequest: vi.fn() };
    const lookup = vi.fn();
    const dispatch = vi.fn();
    const getProof = vi.fn();
    const createDaClient = vi.fn(() => ({ getProof }));
    const ports = createLiveCoston2PipelinePorts({
      environment: liveEnvironment(),
      verifier,
      dependencies: {
        createPublicClient: vi.fn(() => ({ getBlockNumber })),
        createWalletClient: vi.fn(() => ({})),
        createDaClient,
        lookup,
        dispatch,
        transformJq: vi.fn(),
      },
    });

    const error = await ports
      .preflight({ manifest: flareManifest(), runId: RUN_ID })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );
    expect(getBlockNumber).not.toHaveBeenCalled();
    expect(verifier.prepareRequest).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(getProof).not.toHaveBeenCalled();
    expect(String(error)).toMatch(/Coston2/i);
  });
});
