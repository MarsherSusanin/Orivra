// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";

type Factory = (input: Record<string, unknown>) => any;

async function exportedFactory(name: string): Promise<Factory> {
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

  it("runs the live gate through the staged ports without a second RPC lifecycle", async () => {
    const createRuntime = await exportedFactory("createLiveCoston2Runtime");
    const trace: string[] = [];
    const ports = {
      preflight: vi.fn(async () => {
        trace.push("preflight");
        return {
          canonicalUrl: "https://api.example.com/v1/price?symbol=ETHUSD",
          requestBytes: "0x574542324a534f4e",
          requestCalldata: "0xfeedcafe",
          quotedFeeWei: 12_345n,
          network: {
            chainId: 114,
            registryAddress: "0x2222222222222222222222222222222222222222",
            resolvedContracts: {
              FdcHub: FDC_HUB,
              FdcVerification: FDC_VERIFICATION,
              Relay: RELAY,
            },
          },
        };
      }),
      signRelayerTransaction: vi.fn(async () => {
        trace.push("sign");
        return {
          rawTransaction: "0x02f8",
          transactionHash: TRANSACTION_HASH,
        };
      }),
      broadcastRawTransaction: vi.fn(async () => {
        trace.push("broadcast");
        return TRANSACTION_HASH;
      }),
      getTransactionReceipt: vi.fn(async () => {
        trace.push("receipt");
        return {
          transactionHash: TRANSACTION_HASH,
          blockHash: BLOCK_HASH,
          blockTimestamp: 1_747_308_251n,
        };
      }),
      getVotingConfiguration: vi.fn(async () => ({
        firstVotingRoundStartTs: 1_747_265_565n,
        votingEpochDurationSeconds: 90n,
        protocolId: 200,
      })),
      isRelayFinalized: vi.fn(async () => true),
      getRelayRoot: vi.fn(async () => `0x${"4".repeat(64)}`),
      fetchDaProof: vi.fn(async () => ({
        response_hex: "0x1234",
        attestation_type: "Web2Json",
        proof: [],
      })),
      verifyProof: vi.fn(async () => ({
        verified: true,
        verificationContract: FDC_VERIFICATION,
      })),
      verifyConsumer: vi.fn(async () => ({ passed: true, diagnostics: [] })),
    };
    const portsFactory = vi.fn(() => ports);
    const forbiddenNetwork = vi.fn(async () => {
      throw new Error("Live network is forbidden in the hermetic contract suite");
    });
    vi.stubGlobal("fetch", forbiddenNetwork);

    try {
      const runtime = createRuntime({
        environment: liveEnvironment(),
        portsFactory,
        clock: { now: () => 1_747_308_251_000, sleep: vi.fn() },
      });
      const result = await runtime.execute({
        manifest: validManifest,
        projectToken: `project_${"5".repeat(64)}`,
        privateKey: PRIVATE_KEY,
        verifier: { prepareRequest: vi.fn() },
        timeoutMs: 600_000,
      });

      expect(portsFactory).toHaveBeenCalledOnce();
      expect(trace).toEqual(["preflight", "sign", "broadcast", "receipt"]);
      expect(ports.verifyProof).toHaveBeenCalledOnce();
      expect(ports.verifyConsumer).toHaveBeenCalledOnce();
      expect(ports.broadcastRawTransaction).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        transactionHash: TRANSACTION_HASH,
        consumerVerified: true,
        broadcastCountAfterRecordedHash: 0,
      });
      expect(forbiddenNetwork).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
