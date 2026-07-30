// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  type Abi,
  type Hex,
} from "viem";
import fdcVerificationAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcVerification.sol/IFdcVerification.json";
import {
  expectedCanonicalUrl,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { createLiveCoston2PipelinePorts } from "../src/live-runtime";

const ADDRESSES = {
  FdcHub: "0x3333333333333333333333333333333333333333",
  FdcRequestFeeConfigurations: "0x6666666666666666666666666666666666666666",
  FlareSystemsManager: "0x7777777777777777777777777777777777777777",
  Relay: "0x4444444444444444444444444444444444444444",
  FdcVerification: "0x1111111111111111111111111111111111111111",
} as const;
const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const TRANSACTION_HASH = `0x${"2".repeat(64)}`;
const BLOCK_HASH = `0x${"3".repeat(64)}`;

function environment(override: Record<string, string | undefined> = {}) {
  return {
    PROOFLINE_COSTON2_PRIVATE_KEY: PRIVATE_KEY,
    PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "20000000000000000",
    PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "1000",
    PROOFLINE_SAFE_CONSUMER_ADDRESS:
      "0x5555555555555555555555555555555555555555",
    PROOFLINE_COSTON2_RPC_URL: "https://rpc.invalid",
    PROOFLINE_COSTON2_DA_URL: "https://da.invalid",
    ...override,
  };
}

function encodedResponse(url = expectedCanonicalUrl): Hex {
  const verify = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }>;
  const proof = verify.inputs[0] as any;
  const data = proof.components.find((component: any) => component.name === "data");
  return encodeAbiParameters(
    [data],
    [
      {
        attestationType: `0x${"0".repeat(64)}`,
        sourceId: `0x${"1".repeat(64)}`,
        votingRound: 42n,
        lowestUsedTimestamp: 1n,
        requestBody: {
          url,
          httpMethod: "GET",
          headers: "{}",
          queryParams: "{}",
          body: "{}",
          postProcessJq: validManifest.request.jq,
          abiSignature: validManifest.request.abiSignature,
        },
        responseBody: { abiEncodedData: "0x" },
      },
    ],
  );
}

function harness() {
  const readContract = vi.fn(async (request: any) => {
    const name = request.functionName;
    if (name === "getContractAddressByName") {
      return ADDRESSES[request.args[0] as keyof typeof ADDRESSES];
    }
    if (name === "getRequestFee") return 12_345n;
    if (name === "firstVotingRoundStartTs") return 1_747_265_565n;
    if (name === "votingEpochDurationSeconds") return 90n;
    if (name === "fdcProtocolId") return 200;
    if (name === "isFinalized") return true;
    if (name === "merkleRoots") return `0x${"4".repeat(64)}`;
    if (name === "verifyWeb2Json") return true;
    if (name === "consume") return "0x";
    throw new Error(`Unexpected readContract ${name}`);
  });
  const publicClient = {
    readContract,
    getBalance: vi.fn(async () => 1_000_000n),
    getTransactionCount: vi.fn(async () => 7),
    prepareTransactionRequest: vi.fn(async (value) => value),
    sendRawTransaction: vi.fn(async () => TRANSACTION_HASH),
    getTransaction: vi.fn(async () => ({
      to: ADDRESSES.FdcHub,
      input: "0xfeedcafe",
      value: 12_345n,
    })),
    getChainId: vi.fn(async () => 114),
    getTransactionReceipt: vi.fn(async () => ({
      status: "success",
      blockHash: BLOCK_HASH,
    })),
    getBlock: vi.fn(async () => ({ timestamp: 1_747_308_251n })),
  };
  const walletClient = {
    signTransaction: vi.fn(async () => "0x02f8"),
  };
  const daClient = {
    getProof: vi.fn(async () => ({
      response_hex: "0x1234",
      attestation_type: "Web2Json",
      proof: [],
    })),
  };
  const dependencies = {
    createPublicClient: vi.fn(() => publicClient),
    createWalletClient: vi.fn(() => walletClient),
    createDaClient: vi.fn(() => daClient),
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
    dispatch: vi.fn(async () => ({
      status: 200,
      connectedAddress: "93.184.216.34",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode('{"price":1}'),
    })),
    transformJq: vi.fn(async () => ({ value: 1 })),
  };
  const verifier = {
    prepareRequest: vi.fn(async () => ({ requestBytes: "0x574542324a534f4e" })),
  };
  const ports = createLiveCoston2PipelinePorts({
    environment: environment(),
    verifier,
    dependencies,
  });
  return { ports, publicClient, walletClient, daClient, dependencies, verifier };
}

describe("live Coston2 pipeline port coverage", () => {
  it.each([
    ["private key", { PROOFLINE_COSTON2_PRIVATE_KEY: "" }],
    ["global cap", { PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI: "not-a-number" }],
    ["balance floor", { PROOFLINE_RELAYER_BALANCE_FLOOR_WEI: "-1" }],
  ])("rejects invalid %s before constructing clients", (_label, override) => {
    const createPublicClient = vi.fn();
    expect(() =>
      createLiveCoston2PipelinePorts({
        environment: environment(override),
        verifier: { prepareRequest: vi.fn() },
        dependencies: { createPublicClient },
      }),
    ).toThrow(/configuration|missing|unsigned/i);
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("runs registry-backed preflight and relayer signing through injected adapters", async () => {
    const fixture = harness();
    const preflight = await fixture.ports.preflight({
      manifest: validManifest,
      runId: "run_ports",
    });
    expect(preflight).toMatchObject({
      canonicalUrl: expectedCanonicalUrl,
      requestBytes: "0x574542324a534f4e",
      quotedFeeWei: 12_345n,
      network: {
        chainId: 114,
        resolvedContracts: {
          FdcHub: ADDRESSES.FdcHub,
          FdcVerification: ADDRESSES.FdcVerification,
          Relay: ADDRESSES.Relay,
        },
      },
    });
    expect(fixture.dependencies.dispatch).toHaveBeenCalledTimes(5);
    expect(fixture.dependencies.transformJq).toHaveBeenCalledTimes(5);

    const signed = await fixture.ports.signRelayerTransaction({
      projectId: "project-1",
      runId: "run_ports",
      idempotencyKey: "submission-1",
      manifest: validManifest,
      chainId: 114,
      target: ADDRESSES.FdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
    });
    expect(signed).toMatchObject({
      projectId: "project-1",
      runId: "run_ports",
      nonce: 7n,
      rawTransaction: "0x02f8",
      chainId: 114,
      fromAddress: expect.stringMatching(/^0x[0-9A-Fa-f]{40}$/),
      commandFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      broadcastAt: null,
    });
    await expect(fixture.ports.broadcastRawTransaction("0x02f8")).resolves.toBe(
      TRANSACTION_HASH,
    );
  });

  it("observes wallet, receipt, voting, Relay, and DA success paths", async () => {
    const fixture = harness();
    await expect(
      fixture.ports.observeWalletTransaction({ transactionHash: TRANSACTION_HASH }),
    ).resolves.toEqual({
      transactionHash: TRANSACTION_HASH,
      chainId: 114,
      target: ADDRESSES.FdcHub,
      calldata: "0xfeedcafe",
      valueWei: 12_345n,
    });
    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash: TRANSACTION_HASH }),
    ).resolves.toEqual({
      transactionHash: TRANSACTION_HASH,
      blockHash: BLOCK_HASH,
      blockTimestamp: 1_747_308_251n,
    });
    await expect(fixture.ports.getVotingConfiguration()).resolves.toEqual({
      firstVotingRoundStartTs: 1_747_265_565n,
      votingEpochDurationSeconds: 90n,
      protocolId: 200,
    });
    await expect(
      fixture.ports.isRelayFinalized({ protocolId: 200, votingRound: 42 }),
    ).resolves.toBe(true);
    await expect(
      fixture.ports.getRelayRoot({ protocolId: 200, votingRound: 42 }),
    ).resolves.toBe(`0x${"4".repeat(64)}`);
    await expect(
      fixture.ports.fetchDaProof({ votingRound: 42, requestBytes: "0x1234" }),
    ).resolves.toMatchObject({ response_hex: "0x1234" });
  });

  it("normalizes missing targets, pending receipts, and reverted receipts", async () => {
    const fixture = harness();
    fixture.publicClient.getTransaction.mockResolvedValueOnce({
      to: null,
      input: "0x",
      value: 0n,
    });
    await expect(
      fixture.ports.observeWalletTransaction({ transactionHash: TRANSACTION_HASH }),
    ).rejects.toThrow(/target/i);

    fixture.publicClient.getTransactionReceipt.mockRejectedValueOnce(
      new Error("not found"),
    );
    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash: TRANSACTION_HASH }),
    ).rejects.toMatchObject({
      category: "not-finalized",
      code: "REQUEST_RECEIPT_PENDING",
      retryable: true,
    });

    fixture.publicClient.getTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
      blockHash: BLOCK_HASH,
    });
    await expect(
      fixture.ports.getTransactionReceipt({ transactionHash: TRANSACTION_HASH }),
    ).rejects.toMatchObject({
      category: "transport",
      code: "REQUEST_TRANSACTION_REVERTED",
      retryable: false,
    });
  });

  it.each([null, [], { proof: "bad" }, { proof: { response: "0x1" } }])(
    "rejects malformed persisted proof evidence %j",
    async (proof) => {
      const fixture = harness();
      await expect(
        fixture.ports.verifyProof({
          proof,
          fdcVerification: ADDRESSES.FdcVerification,
        }),
      ).rejects.toMatchObject({ category: "schema-invalid" });
    },
  );

  it("checks local Merkle integrity before the on-chain verifier", async () => {
    const fixture = harness();
    const response = encodedResponse();
    const evidence = {
      proof: { response, merkleProof: [] },
      attestationType: "Web2Json",
      relayRoot: `0x${"f".repeat(64)}`,
    };
    await expect(
      fixture.ports.verifyProof({
        proof: evidence,
        fdcVerification: ADDRESSES.FdcVerification,
      }),
    ).resolves.toEqual({
      verified: false,
      verificationContract: ADDRESSES.FdcVerification,
    });
    expect(
      fixture.publicClient.readContract.mock.calls.some(
        ([request]) => request.functionName === "verifyWeb2Json",
      ),
    ).toBe(false);

    evidence.relayRoot = keccak256(response);
    await expect(
      fixture.ports.verifyProof({
        proof: evidence,
        fdcVerification: ADDRESSES.FdcVerification,
      }),
    ).resolves.toEqual({
      verified: true,
      verificationContract: ADDRESSES.FdcVerification,
    });
  });

  it("diagnoses wrong URLs, the vulnerable consumer, and calls the safe consumer", async () => {
    const fixture = harness();
    const evidence = (url: string) => ({
      proof: { response: encodedResponse(url), merkleProof: [] },
      attestationType: "Web2Json",
      relayRoot: "0x",
    });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence("https://mirror.invalid/prices/eth"),
        manifest: validManifest,
        consumer: "safe",
      }),
    ).resolves.toMatchObject({ passed: false, diagnostics: expect.any(Array) });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence(expectedCanonicalUrl),
        manifest: validManifest,
        consumer: "canonical-vulnerable",
      }),
    ).resolves.toMatchObject({
      passed: false,
      diagnostics: [expect.objectContaining({ code: "MISSING_CONSUMER_HOST_INVARIANT" })],
    });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence(expectedCanonicalUrl),
        manifest: validManifest,
        consumer: "safe",
      }),
    ).resolves.toEqual({ passed: true, diagnostics: [] });
    expect(
      fixture.publicClient.readContract.mock.calls.some(
        ([request]) => request.functionName === "consume",
      ),
    ).toBe(true);
  });
});
