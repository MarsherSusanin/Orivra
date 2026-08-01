// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Abi } from "viem";
import fdcHubAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcHub.sol/IFdcHub.json";
import {
  RUN_ID,
  OCCURRED_AT,
  exactTrustManifest,
  expectedCanonicalUrl,
  validDiagnostic,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { appendRunEvents, projectRun } from "@proofline/domain";
import * as workerModule from "../src/worker";

const REQUIRED_COMMANDS = [
  "RUN_PREFLIGHT",
  "SUBMIT_RELAYER",
  "BROADCAST_RELAYER_TRANSACTION",
  "ATTACH_WALLET_TRANSACTION",
  "POLL_TRANSACTION_RECEIPT",
  "POLL_RELAY_FINALIZATION",
  "FETCH_DA_PROOF",
  "VERIFY_PROOF",
  "VERIFY_CONSUMER",
  "BUILD_PROOF_BUNDLE",
] as const;

const transactionHash = `0x${"9".repeat(64)}`;
const proofHash = `0x${"a".repeat(64)}`;
const registryAddress = "0x2222222222222222222222222222222222222222";
const fdcHub = "0x3333333333333333333333333333333333333333";
const fdcVerification = "0x1111111111111111111111111111111111111111";
const relay = "0x4444444444444444444444444444444444444444";
const relayerManifest = {
  ...exactTrustManifest,
  submission: { ...exactTrustManifest.submission, mode: "relayer" as const },
};

function requestAttestationCalldata(requestBytes: `0x${string}`) {
  return encodeFunctionData({
    abi: fdcHubAbi as Abi,
    functionName: "requestAttestation",
    args: [requestBytes],
  });
}

function productionHandlerFactory(): (...args: any[]) => any {
  const factory = (workerModule as Record<string, unknown>)
    .createProductionCommandHandlers;
  expect(
    factory,
    "Slice 003 requires a concrete production command-handler registry",
  ).toEqual(expect.any(Function));
  return factory as (...args: any[]) => any;
}

function createFixture() {
  const trace: string[] = [];
  const state = {
    events: [
      {
        version: "1" as const,
        runId: RUN_ID,
        sequence: 1,
        commandId: "cmd_create",
        occurredAt: OCCURRED_AT,
        type: "RUN_CREATED" as const,
        payload: { manifest: relayerManifest },
      },
    ],
    artifacts: [] as Array<Record<string, unknown>>,
    relayerTransaction: null as null | Record<string, unknown>,
  };

  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId: RUN_ID,
      projectId: "11111111-1111-4111-8111-111111111111",
      manifest: relayerManifest,
      events: [...state.events],
      projection: projectRun(state.events),
      artifacts: [...state.artifacts],
    })),
    renewLease: vi.fn().mockResolvedValue(undefined),
    findRelayerTransaction: vi.fn(async () => state.relayerTransaction),
    persistRelayerTransaction: vi.fn(async (value: Record<string, unknown>) => {
      trace.push("persist-signed");
      state.relayerTransaction = {
        ...value,
        broadcastAttemptedAt: null,
        broadcastAt: null,
      };
    }),
    claimRelayerBroadcastAttempt: vi.fn(async () => {
      trace.push("claim-broadcast-attempt");
      if (state.relayerTransaction?.broadcastAttemptedAt) return false;
      state.relayerTransaction = {
        ...state.relayerTransaction,
        broadcastAttemptedAt: OCCURRED_AT,
      };
      return true;
    }),
    markRelayerBroadcast: vi.fn(async (_key: string, hash: string) => {
      trace.push("mark-broadcast");
      state.relayerTransaction = {
        ...state.relayerTransaction,
        transactionHash: hash,
        broadcastAt: OCCURRED_AT,
      };
    }),
  };

  const ports = {
    preflight: vi.fn(async () => {
      trace.push("preflight");
      const requestBytes = "0x574542324a534f4e";
      return {
        kind: "accepted",
        report: {
          ...structuredClone(validPreflightReport),
          requestIdentitySha256: `sha256:${createHash("sha256")
            .update(Buffer.from(requestBytes.slice(2), "hex"))
            .digest("hex")}`,
          fee: {
            quotedWei: "12345",
            capWei: relayerManifest.submission.feeCapWei,
            withinCap: true,
          },
        },
        submissionEvidence: {
          canonicalUrl: expectedCanonicalUrl,
          requestBytes,
          requestCalldata: requestAttestationCalldata(requestBytes),
          quotedFeeWei: 12_345n,
          network: {
            chainId: 114,
            blockNumber: validPreflightReport.registrySnapshot.blockNumber,
            registryAddress,
            resolvedContracts: {
              FdcHub: fdcHub,
              FdcRequestFeeConfigurations:
                validPreflightReport.registrySnapshot.resolvedContracts
                  .FdcRequestFeeConfigurations,
              FdcVerification: fdcVerification,
              Relay: relay,
            },
          },
        },
      };
    }),
    signRelayerTransaction: vi.fn(async () => {
      trace.push("sign-relayer");
      return {
        idempotencyKey: "submission-1",
        nonce: 7n,
        rawTransaction: "0x02f8signed",
        transactionHash,
        commandFingerprint: `sha256:${"b".repeat(64)}`,
        chainId: 114,
        target: fdcHub,
        calldata: requestAttestationCalldata("0x574542324a534f4e"),
        valueWei: 12_345n,
      };
    }),
    broadcastRawTransaction: vi.fn(async (raw: string) => {
      trace.push(`broadcast:${raw}`);
      return transactionHash;
    }),
    observeWalletTransaction: vi.fn(async () => {
      trace.push("observe-wallet-transaction");
      return {
        transactionHash,
        chainId: 114,
        target: fdcHub,
        calldata: requestAttestationCalldata("0x574542324a534f4e"),
        valueWei: 12_345n,
      };
    }),
    getTransactionReceipt: vi.fn(async () => {
      trace.push("receipt");
      return {
        transactionHash,
        blockHash: `0x${"c".repeat(64)}`,
        blockTimestamp: 1_747_308_251n,
      };
    }),
    getVotingConfiguration: vi.fn(async () => ({
      firstVotingRoundStartTs: 1_747_265_565n,
      votingEpochDurationSeconds: 90n,
      protocolId: 200,
    })),
    isRelayFinalized: vi.fn(async () => {
      trace.push("relay-finalized");
      return true;
    }),
    getRelayRoot: vi.fn(async () => `0x${"d".repeat(64)}`),
    fetchDaProof: vi.fn(async () => {
      trace.push("da-proof");
      return {
        response_hex: "0x1234abcd",
        attestation_type: "Web2Json",
        proof: [`0x${"e".repeat(64)}`],
        proofHash,
      };
    }),
    verifyProof: vi.fn(async () => {
      trace.push("verify-proof");
      return { verified: true, verificationContract: fdcVerification };
    }),
    verifyConsumer: vi.fn(async () => {
      trace.push("verify-consumer");
      return { passed: false, diagnostics: [validDiagnostic] };
    }),
  };

  const handlers = productionHandlerFactory()({
    repository,
    ports,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (command: Record<string, unknown>) => Promise<any>>;

  async function execute(
    kind: (typeof REQUIRED_COMMANDS)[number],
    payload: Record<string, unknown> = {},
  ) {
    const outcome = await handlers[kind]({
      id: `cmd_${kind.toLowerCase()}`,
      kind,
      runId: RUN_ID,
      attempts: 1,
      payload,
    });
    state.events = appendRunEvents(state.events, outcome.events ?? []);
    state.artifacts.push(...(outcome.artifacts ?? []));
    return outcome;
  }

  return { handlers, ports, repository, state, trace, execute };
}

describe("Slice 003 production command composition", () => {
  it("registers every command reachable from the API or another handler", () => {
    const fixture = createFixture();
    expect(Object.keys(fixture.handlers)).toEqual(
      expect.arrayContaining(REQUIRED_COMMANDS),
    );
    for (const kind of REQUIRED_COMMANDS) {
      expect(fixture.handlers[kind], `${kind} must not become an orphaned command`).toEqual(
        expect.any(Function),
      );
    }
  });

  it("emits the monotonic persisted lifecycle through fixture-backed ports", async () => {
    const fixture = createFixture();

    const preflight = await fixture.execute("RUN_PREFLIGHT");
    expect(preflight.nextCommands).toEqual([
      expect.objectContaining({ kind: "SUBMIT_RELAYER" }),
    ]);

    const prepared = await fixture.execute("SUBMIT_RELAYER", {
      idempotencyKey: "submission-1",
    });
    expect(prepared.nextCommands).toEqual([
      expect.objectContaining({ kind: "BROADCAST_RELAYER_TRANSACTION" }),
    ]);

    const broadcast = await fixture.execute("BROADCAST_RELAYER_TRANSACTION", {
      idempotencyKey: "submission-1",
    });
    expect(broadcast.nextCommands).toEqual([
      expect.objectContaining({ kind: "POLL_TRANSACTION_RECEIPT" }),
    ]);

    const receipt = await fixture.execute("POLL_TRANSACTION_RECEIPT", {
      transactionHash,
    });
    expect(receipt.nextCommands).toEqual([
      expect.objectContaining({ kind: "POLL_RELAY_FINALIZATION" }),
    ]);

    const relayOutcome = await fixture.execute("POLL_RELAY_FINALIZATION");
    expect(relayOutcome.nextCommands).toEqual([
      expect.objectContaining({ kind: "FETCH_DA_PROOF" }),
    ]);
    const proof = await fixture.execute("FETCH_DA_PROOF");
    expect(proof.nextCommands).toEqual([
      expect.objectContaining({ kind: "VERIFY_PROOF" }),
    ]);
    const verified = await fixture.execute("VERIFY_PROOF");
    expect(verified.nextCommands).toEqual([]);
    const consumer = await fixture.execute("VERIFY_CONSUMER", {
      consumer: "canonical-vulnerable",
    });
    expect(consumer.nextCommands).toEqual([
      expect.objectContaining({ kind: "BUILD_PROOF_BUNDLE" }),
    ]);
    await fixture.execute("BUILD_PROOF_BUNDLE");

    expect(fixture.state.events.map((event) => event.type)).toEqual([
      "RUN_CREATED",
      "PREFLIGHT_ACCEPTED",
      "REQUEST_SUBMITTED",
      "ROUND_FINALIZED",
      "PROOF_AVAILABLE",
      "PROOF_VERIFIED",
      "CONSUMER_VERIFIED",
    ]);
    expect(projectRun(fixture.state.events)).toMatchObject({
      terminal: true,
      stages: { consumer: "failed" },
    });
    expect(fixture.state.events.at(-1)).toMatchObject({
      type: "CONSUMER_VERIFIED",
      payload: { passed: false, diagnostics: [validDiagnostic] },
    });
    expect(fixture.ports.verifyConsumer).toHaveBeenCalledWith(
      expect.objectContaining({ consumer: "canonical-vulnerable" }),
    );
    expect(fixture.trace).toEqual([
      "preflight",
      "sign-relayer",
      "persist-signed",
      "claim-broadcast-attempt",
      "broadcast:0x02f8signed",
      "mark-broadcast",
      "receipt",
      "relay-finalized",
      "da-proof",
      "verify-proof",
      "verify-consumer",
    ]);
  });
});

describe("Slice 003 relayer recovery boundary", () => {
  it("reuses persisted signed identity and never signs a replacement", async () => {
    const fixture = createFixture();
    await fixture.execute("RUN_PREFLIGHT");
    await fixture.execute("SUBMIT_RELAYER", {
      idempotencyKey: "submission-1",
    });
    await fixture.execute("SUBMIT_RELAYER", {
      idempotencyKey: "submission-1",
    });

    expect(fixture.ports.signRelayerTransaction).toHaveBeenCalledOnce();
    expect(fixture.repository.persistRelayerTransaction).toHaveBeenCalledOnce();
    expect(fixture.state.relayerTransaction).toMatchObject({
      rawTransaction: "0x02f8signed",
      transactionHash,
      nonce: 7n,
    });
  });

  it("does not call the broadcaster after a successful marker is persisted", async () => {
    const fixture = createFixture();
    await fixture.execute("RUN_PREFLIGHT");
    await fixture.execute("SUBMIT_RELAYER", {
      idempotencyKey: "submission-1",
    });
    await fixture.execute("BROADCAST_RELAYER_TRANSACTION", {
      idempotencyKey: "submission-1",
    });

    await fixture.handlers.BROADCAST_RELAYER_TRANSACTION({
      id: "cmd_broadcast_recovery",
      kind: "BROADCAST_RELAYER_TRANSACTION",
      runId: RUN_ID,
      attempts: 2,
      payload: { idempotencyKey: "submission-1" },
    });

    expect(fixture.ports.broadcastRawTransaction).toHaveBeenCalledOnce();
    expect(fixture.repository.markRelayerBroadcast).toHaveBeenCalledOnce();
  });
});
