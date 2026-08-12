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
  OCCURRED_AT,
  RUN_ID,
  exactTrustManifest,
  expectedCanonicalUrl,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalizeManifestUrl,
  getWeb2JsonTemplateDetail,
  projectRun,
} from "@proofline/domain";
import { createLiveCoston2PipelinePorts } from "../src/live-runtime";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";
import { testLiveCoston2RuntimeConfig } from "./live-runtime-config.fixture";
import { testSafeConsumerRegistry } from "./safe-consumer-registry.fixture";

const ADDRESSES = {
  FdcHub: "0x3333333333333333333333333333333333333333",
  FdcRequestFeeConfigurations: "0x6666666666666666666666666666666666666666",
  FlareSystemsManager: "0x7777777777777777777777777777777777777777",
  Relay: "0x4444444444444444444444444444444444444444",
  FdcVerification: "0x1111111111111111111111111111111111111111",
} as const;
const TRANSACTION_HASH = `0x${"2".repeat(64)}`;
const BLOCK_HASH = `0x${"3".repeat(64)}`;
const registryTemplate = getWeb2JsonTemplateDetail("eth-usd");
if (!registryTemplate) throw new Error("ETH/USD registry template fixture is missing");
const registryManifest = registryTemplate.manifest;
const registryConsumer = testSafeConsumerRegistry.entries.find(
  (entry) => entry.manifestSha256 === registryTemplate.template.manifestSha256,
);
if (!registryConsumer) throw new Error("ETH/USD safe-consumer fixture is missing");
const registryCanonicalUrl = canonicalizeManifestUrl(registryManifest);

function encodedResponse(url = expectedCanonicalUrl, manifest = validManifest): Hex {
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
          postProcessJq: manifest.request.jq,
          abiSignature: manifest.request.abiSignature,
        },
        responseBody: { abiEncodedData: "0x" },
      },
    ],
  );
}

function relayerSigningInput(
  policyOverride: Partial<{
    projectFeeCapWei: bigint;
    globalFeeCapWei: bigint;
    quotaRemaining: number;
    balanceFloorWei: bigint;
  }> = {},
) {
  return {
    projectId: "project-1",
    runId: "run_ports",
    idempotencyKey: "submission-1",
    manifest: validManifest,
    chainId: 114,
    target: ADDRESSES.FdcHub,
    calldata: "0xfeedcafe",
    valueWei: 12_345n,
    policy: {
      projectFeeCapWei: BigInt(validManifest.submission.feeCapWei),
      globalFeeCapWei: 20_000_000_000_000_000n,
      quotaRemaining: 1,
      balanceFloorWei: 1_000n,
      ...policyOverride,
    },
  };
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
    getBlockNumber: vi.fn(async () => 12_345_678n),
    getBalance: vi.fn(async () => 1_000_000n),
    getTransactionCount: vi.fn(async () => 7),
    prepareTransactionRequest: vi.fn(async (value) => ({
      ...value,
      gas: 21_000n,
      maxFeePerGas: 1n,
    })),
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
    runtimeConfig: testLiveCoston2RuntimeConfig(),
    verifier,
    dependencies,
  });
  return { ports, publicClient, walletClient, daClient, dependencies, verifier };
}

async function composedRelayerSubmission(quotaRemaining: number) {
  const live = harness();
  const manifest = {
    ...exactTrustManifest,
    submission: {
      ...exactTrustManifest.submission,
      mode: "relayer" as const,
    },
  };
  const state = {
    events: [
      {
        version: "1" as const,
        runId: RUN_ID,
        sequence: 1,
        commandId: "command_create",
        occurredAt: OCCURRED_AT,
        type: "RUN_CREATED" as const,
        payload: { manifest },
      },
    ] as any[],
    artifacts: [] as any[],
  };
  const loadRelayerPolicy = vi.fn(async () => ({
    projectFeeCapWei: BigInt(manifest.submission.feeCapWei),
    globalFeeCapWei: 20_000_000_000_000_000n,
    quotaRemaining,
    balanceFloorWei: 1_000n,
  }));
  const completeCommand = vi.fn();
  const retryCommand = vi.fn();
  const persistRelayerTransaction = vi.fn();
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: RUN_ID,
      projectId: "11111111-1111-4111-8111-111111111111",
      manifest,
      events: [...state.events],
      projection: projectRun(state.events),
      artifacts: [...state.artifacts],
    })),
    loadRelayerPolicy,
    findRelayerTransactionByRun: vi.fn().mockResolvedValue(null),
    findRelayerTransaction: vi.fn().mockResolvedValue(null),
    persistRelayerTransaction,
    markRelayerBroadcast: vi.fn(),
    claimNextCommand: vi.fn().mockResolvedValueOnce({
      claimToken: "claim_zero_quota",
      command: {
        id: "command_submit_relayer",
        kind: "SUBMIT_RELAYER",
        runId: RUN_ID,
        attempts: 1,
        payload: { idempotencyKey: "submission-zero-quota" },
      },
    }),
    completeCommand,
    retryCommand,
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: live.ports,
    clock: { now: () => OCCURRED_AT },
  });
  const preflight = await handlers.RUN_PREFLIGHT({
    id: "command_preflight",
    kind: "RUN_PREFLIGHT",
    runId: RUN_ID,
    attempts: 1,
    payload: {},
  });
  state.events.push(...(preflight.events ?? []));
  state.artifacts.push(...(preflight.artifacts ?? []));

  const worker = createRunWorker({
    environment: "production",
    mode: "live",
    adapters: {
      coston2: { kind: "live" },
      pipeline: { kind: "live" },
    },
    repository,
    handlers,
    logger: { info: vi.fn(), error: vi.fn() },
  });
  await worker.processOne();
  return {
    ...live,
    state,
    repository,
    loadRelayerPolicy,
    completeCommand,
    retryCommand,
    persistRelayerTransaction,
  };
}

describe("live Coston2 pipeline port coverage", () => {
  it("runs registry-backed preflight and relayer signing through injected adapters", async () => {
    const fixture = harness();
    const preflight = await fixture.ports.preflight({
      manifest: exactTrustManifest,
      runId: "run_ports",
    });
    expect(preflight).toMatchObject({
      kind: "accepted",
      report: {
        verdict: "ready",
        canonicalUrl: expectedCanonicalUrl,
      },
      submissionEvidence: {
        canonicalUrl: expectedCanonicalUrl,
        requestBytes: "0x574542324a534f4e",
        quotedFeeWei: 12_345n,
        network: {
          chainId: 114,
          blockNumber: "12345678",
          resolvedContracts: {
            FdcHub: ADDRESSES.FdcHub,
            FdcRequestFeeConfigurations: ADDRESSES.FdcRequestFeeConfigurations,
            FdcVerification: ADDRESSES.FdcVerification,
            Relay: ADDRESSES.Relay,
          },
        },
      },
    });
    expect(preflight).not.toHaveProperty("canonicalUrl");
    expect(preflight).not.toHaveProperty("requestBytes");
    expect(preflight).not.toHaveProperty("quotedFeeWei");
    expect(preflight).not.toHaveProperty("network");
    expect(fixture.dependencies.dispatch).toHaveBeenCalledTimes(5);
    expect(fixture.dependencies.transformJq).toHaveBeenCalledTimes(5);

    const signed = await fixture.ports.signRelayerTransaction(
      relayerSigningInput(),
    );
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

  it("accepts zero remaining as persisted policy evidence and delegates exhaustion to the validator", async () => {
    const fixture = harness();

    await expect(
      fixture.ports.signRelayerTransaction(
        relayerSigningInput({ quotaRemaining: 0 }),
      ),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "RELAYER_QUOTA_EXHAUSTED",
      retryable: false,
    });
    expect(fixture.walletClient.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", relayerSigningInput({ quotaRemaining: -1 })],
    ["noninteger", relayerSigningInput({ quotaRemaining: 0.5 })],
    [
      "malformed",
      {
        ...relayerSigningInput(),
        policy: {
          ...relayerSigningInput().policy,
          quotaRemaining: "not-a-number",
        },
      },
    ],
  ])("rejects %s persisted relayer policy evidence before nonce or signing", async (_label, input) => {
    const fixture = harness();

    await expect(
      fixture.ports.signRelayerTransaction(input as any),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: "RELAYER_POLICY_EVIDENCE_INVALID",
      retryable: false,
    });
    expect(fixture.publicClient.getBalance).not.toHaveBeenCalled();
    expect(fixture.publicClient.getTransactionCount).not.toHaveBeenCalled();
    expect(fixture.walletClient.signTransaction).not.toHaveBeenCalled();
  });

  it("terminalizes composed zero-quota submission before signing or broadcast effects", async () => {
    const fixture = await composedRelayerSubmission(0);
    const policyArtifact = fixture.state.artifacts.find(
      (artifact) => artifact.kind === "relayer-policy",
    );

    expect(fixture.loadRelayerPolicy).toHaveBeenCalledExactlyOnceWith(
      "11111111-1111-4111-8111-111111111111",
      BigInt(exactTrustManifest.submission.feeCapWei),
    );
    expect(
      JSON.parse(
        new TextDecoder().decode(policyArtifact?.canonicalBytes),
      ),
    ).toMatchObject({ version: "1", quotaRemaining: 0 });
    expect(fixture.retryCommand).toHaveBeenCalledExactlyOnceWith(
      "command_submit_relayer",
      "claim_zero_quota",
      expect.objectContaining({
        category: "configuration",
        code: "RELAYER_QUOTA_EXHAUSTED",
        retryable: false,
        terminal: true,
      }),
    );
    expect(fixture.completeCommand).not.toHaveBeenCalled();
    expect(fixture.persistRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.walletClient.signTransaction).not.toHaveBeenCalled();
    expect(fixture.publicClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("keeps the composed positive-quota submission path green", async () => {
    const fixture = await composedRelayerSubmission(1);

    expect(fixture.loadRelayerPolicy).toHaveBeenCalledOnce();
    expect(fixture.retryCommand).not.toHaveBeenCalled();
    expect(fixture.completeCommand).toHaveBeenCalledExactlyOnceWith(
      "command_submit_relayer",
      "claim_zero_quota",
      expect.objectContaining({
        nextCommands: [
          expect.objectContaining({ kind: "BROADCAST_RELAYER_TRANSACTION" }),
        ],
      }),
    );
    expect(fixture.persistRelayerTransaction).toHaveBeenCalledOnce();
    expect(fixture.walletClient.signTransaction).toHaveBeenCalledOnce();
    expect(fixture.publicClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects persisted relayer policy drift before wallet effects", async () => {
    const fixture = harness();

    await expect(
      fixture.ports.signRelayerTransaction(
        relayerSigningInput({ globalFeeCapWei: 1n }),
      ),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "RELAYER_POLICY_CONFIGURATION_DRIFT",
      retryable: false,
    });
    expect(fixture.publicClient.getBalance).not.toHaveBeenCalled();
    expect(fixture.publicClient.getTransactionCount).not.toHaveBeenCalled();
    expect(fixture.walletClient.signTransaction).not.toHaveBeenCalled();
  });

  it("pins every registry resolution and fee quote to one explicit block snapshot", async () => {
    const fixture = harness();

    const outcome = await fixture.ports.preflight({
      manifest: exactTrustManifest,
      runId: "run_snapshot_contract",
    }) as any;

    expect(fixture.publicClient.getBlockNumber).toHaveBeenCalledOnce();
    const snapshotReads = fixture.publicClient.readContract.mock.calls
      .map(([request]) => request)
      .filter((request) =>
        request.functionName === "getContractAddressByName" ||
        request.functionName === "getRequestFee",
      );
    expect(snapshotReads).toHaveLength(6);
    expect(snapshotReads.every((request) => request.blockNumber === 12_345_678n)).toBe(true);
    expect(outcome.report).toMatchObject({
      registrySnapshot: {
        chainId: 114,
        blockNumber: "12345678",
        registryAddress: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
        resolvedContracts: {
          FdcHub: ADDRESSES.FdcHub,
          FdcRequestFeeConfigurations: ADDRESSES.FdcRequestFeeConfigurations,
          FdcVerification: ADDRESSES.FdcVerification,
          Relay: ADDRESSES.Relay,
        },
      },
    });
  });

  it("returns a Trust-blocked preflight without constructing submission evidence", async () => {
    const fixture = harness();

    await expect(
      fixture.ports.preflight({
        manifest: validManifest,
        runId: "run_trust_blocked",
      }),
    ).resolves.toMatchObject({
      kind: "blocked",
      report: {
        verdict: "blocked",
        blockers: ["PREFLIGHT_TRUST_QUERY_MISMATCH"],
      },
    });
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
      proof: { response: encodedResponse(url, registryManifest), merkleProof: [] },
      attestationType: "Web2Json",
      relayRoot: "0x",
    });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence("https://mirror.invalid/prices/eth"),
        manifest: registryManifest,
        consumer: registryConsumer.consumerAddress,
      }),
    ).resolves.toMatchObject({ passed: false, diagnostics: expect.any(Array) });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence(registryCanonicalUrl),
        manifest: registryManifest,
        consumer: "canonical-vulnerable",
      }),
    ).resolves.toMatchObject({
      passed: false,
      diagnostics: [expect.objectContaining({ code: "MISSING_CONSUMER_HOST_INVARIANT" })],
    });
    await expect(
      fixture.ports.verifyConsumer({
        proof: evidence(registryCanonicalUrl),
        manifest: registryManifest,
        consumer: registryConsumer.consumerAddress,
      }),
    ).resolves.toEqual({
      passed: true,
      diagnostics: [],
      requestUrl: registryCanonicalUrl,
    });
    expect(
      fixture.publicClient.readContract.mock.calls.some(
        ([request]) => request.functionName === "consume" &&
          request.address === registryConsumer.consumerAddress,
      ),
    ).toBe(true);
  });
});
