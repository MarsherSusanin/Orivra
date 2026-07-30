// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

type Factory = (input: Record<string, unknown>) => any;

async function exportedFactory(
  name: string,
): Promise<Factory> {
  const module = (await import("../src/live-runtime")) as unknown as Record<
    string,
    unknown
  >;
  const value = module[name];
  expect(
    value,
    `Slice 004 requires the public ${name} dependency-injection seam`,
  ).toEqual(expect.any(Function));
  if (typeof value !== "function") throw new Error(`Missing ${name}`);
  return value as Factory;
}

const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const TRANSACTION_HASH = `0x${"2".repeat(64)}`;
const BLOCK_HASH = `0x${"3".repeat(64)}`;
const FDC_HUB = "0x3333333333333333333333333333333333333333";
const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
const RELAY = "0x4444444444444444444444444444444444444444";

function liveEnvironment() {
  return {
    PROOFLINE_COSTON2_PRIVATE_KEY: PRIVATE_KEY,
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "100000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
    GITHUB_SHA: "a".repeat(40),
    PROOFLINE_TREE_HASH: "b".repeat(40),
  };
}

describe("Slice 004 live Coston2 adapter injection", () => {
  it("constructs production ports only from explicit, hermetic adapter factories", async () => {
    const createPorts = await exportedFactory("createLiveCoston2PipelinePorts");
    const publicClient = {};
    const walletClient = {};
    const daClient = {};
    const dependencies = {
      createPublicClient: vi.fn(() => publicClient),
      createWalletClient: vi.fn(() => walletClient),
      createDaClient: vi.fn(() => daClient),
      lookup: vi.fn(),
      dispatch: vi.fn(),
      transformJq: vi.fn(),
    };

    const ports = createPorts({
      environment: liveEnvironment(),
      verifier: { prepareRequest: vi.fn() },
      dependencies,
    });

    expect(ports).toEqual(
      expect.objectContaining({
        preflight: expect.any(Function),
        signRelayerTransaction: expect.any(Function),
        broadcastRawTransaction: expect.any(Function),
        getTransactionReceipt: expect.any(Function),
        fetchDaProof: expect.any(Function),
        verifyProof: expect.any(Function),
        verifyConsumer: expect.any(Function),
      }),
    );
    expect(dependencies.createPublicClient).toHaveBeenCalledOnce();
    expect(dependencies.createWalletClient).toHaveBeenCalledOnce();
    expect(dependencies.createDaClient).toHaveBeenCalledOnce();
  });

});
