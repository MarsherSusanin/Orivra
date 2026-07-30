import { createHash } from "node:crypto";
import type { Web2JsonManifestV1 } from "@proofline/contracts";
import {
  calculateVotingRoundId,
  createFdcError,
  pollRelayFinalization,
  type RawDaProof,
} from "@proofline/fdc-coston2";
import { createLiveCoston2PipelinePorts } from "./live-runtime";

export interface LiveGateEvidence {
  commitHash: string;
  treeHash: string;
  runId: string;
  transactionHash: string;
  votingRound: string;
  proofChecksum: string;
  consumerVerified: boolean;
  broadcastCountAfterRecordedHash: number;
}

export interface LiveGateRuntime {
  kind: "live";
  execute(input: {
    manifest: Web2JsonManifestV1;
    projectToken: string;
    privateKey: string;
    verifier: {
      prepareRequest(
        input: Web2JsonManifestV1,
      ): Promise<{ requestBytes: string }>;
    };
    timeoutMs: number;
  }): Promise<LiveGateEvidence>;
}

type LiveEnvironment = Record<string, string | undefined>;

function required(environment: LiveEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw Object.assign(
      new Error(`Live runtime configuration is missing ${name}`),
      { kind: "configuration" },
    );
  }
  return value;
}

function deadlineError(operation: string) {
  return createFdcError(
    "timeout",
    "LIVE_GATE_DEADLINE_EXCEEDED",
    `Live Coston2 ${operation} exceeded the bounded gate deadline`,
    false,
    { operation },
  );
}

async function bounded<T>(
  operation: string,
  promise: Promise<T>,
  remainingMs: number,
): Promise<T> {
  if (remainingMs <= 0) throw deadlineError(operation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(deadlineError(operation)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createLiveCoston2Runtime(input: {
  environment: LiveEnvironment;
  portsFactory?: typeof createLiveCoston2PipelinePorts;
  clock?: {
    now(): number;
    sleep(ms: number): Promise<void> | void;
  };
}): LiveGateRuntime {
  const environment = input.environment;
  const portsFactory = input.portsFactory ?? createLiveCoston2PipelinePorts;
  const clock = input.clock ?? {
    now: Date.now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  return {
    kind: "live",
    async execute(execution): Promise<LiveGateEvidence> {
      const commitHash = required(environment, "GITHUB_SHA");
      const treeHash = required(environment, "PROOFLINE_TREE_HASH");
      if (!/^project_[a-f0-9]{64}$/i.test(execution.projectToken)) {
        throw Object.assign(new Error("Live runtime project token is invalid"), {
          kind: "configuration",
        });
      }
      const deadlineAt = clock.now() + execution.timeoutMs;
      const remaining = () => deadlineAt - clock.now();
      const ports = portsFactory({
        environment: {
          ...environment,
          PROOFLINE_COSTON2_PRIVATE_KEY: execution.privateKey,
        },
        verifier: execution.verifier,
      });
      const provisionalRunId = `run_live_${createHash("sha256")
        .update(`${commitHash}:${treeHash}`)
        .digest("hex")
        .slice(0, 24)}`;
      const preflight = await bounded(
        "preflight",
        ports.preflight({
          manifest: execution.manifest,
          runId: provisionalRunId,
        }),
        remaining(),
      );
      const idempotencyKey = `live-${commitHash}-${treeHash}`;
      const signed = await bounded(
        "requestAttestation signing",
        ports.signRelayerTransaction({
          projectId: "live-gate",
          runId: provisionalRunId,
          idempotencyKey,
          manifest: execution.manifest,
          chainId: 114,
          target: preflight.network.resolvedContracts.FdcHub,
          calldata: preflight.requestCalldata,
          valueWei: preflight.quotedFeeWei,
        }),
        remaining(),
      );
      const transactionHash = await bounded(
        "requestAttestation broadcast",
        ports.broadcastRawTransaction(signed.rawTransaction),
        remaining(),
      );
      if (
        signed.transactionHash &&
        signed.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
      ) {
        throw createFdcError(
          "transport",
          "RELAYER_TRANSACTION_HASH_MISMATCH",
          "The RPC returned a different transaction hash than the signed payload",
          false,
          { transactionHash },
        );
      }
      const receipt = await bounded(
        "transaction receipt",
        ports.getTransactionReceipt({ transactionHash }),
        remaining(),
      );
      const votingConfiguration = await bounded(
        "voting configuration",
        ports.getVotingConfiguration(),
        remaining(),
      );
      const votingRoundId = calculateVotingRoundId({
        blockTimestamp: receipt.blockTimestamp,
        firstVotingRoundStartTs:
          votingConfiguration.firstVotingRoundStartTs,
        votingEpochDurationSeconds:
          votingConfiguration.votingEpochDurationSeconds,
      });
      await pollRelayFinalization({
        votingRoundId,
        isFinalized: async (round) =>
          ports.isRelayFinalized({
            runId: provisionalRunId,
            votingRound: round,
            protocolId: votingConfiguration.protocolId,
          }),
        clock: {
          now: clock.now,
          sleep: async (ms) => {
            await clock.sleep(ms);
          },
        },
        pollIntervalMs: 5_000,
        timeoutMs: Math.max(1, remaining()),
      });

      let proof: RawDaProof | undefined;
      while (!proof && remaining() > 0) {
        try {
          proof = await bounded(
            "Data Availability proof",
            ports.fetchDaProof({
              runId: provisionalRunId,
              votingRound: votingRoundId,
              requestBytes: preflight.requestBytes,
            }),
            Math.min(30_000, remaining()),
          );
        } catch (cause) {
          const retryable =
            cause &&
            typeof cause === "object" &&
            "retryable" in cause &&
            (cause as { retryable: unknown }).retryable === true;
          if (!retryable) throw cause;
          await clock.sleep(Math.min(5_000, Math.max(0, remaining())));
        }
      }
      if (!proof) throw deadlineError("Data Availability proof");

      const relayRoot = await bounded(
        "Relay root",
        ports.getRelayRoot({
          runId: provisionalRunId,
          votingRound: votingRoundId,
          protocolId: votingConfiguration.protocolId,
        }),
        remaining(),
      );
      const proofHash = `0x${createHash("sha256")
        .update(Buffer.from(proof.response_hex.slice(2), "hex"))
        .digest("hex")}`;
      const proofEvidence = {
        version: "1",
        proof: {
          votingRound: votingRoundId.toString(),
          merkleProof: proof.proof,
          response: proof.response_hex,
        },
        attestationType: proof.attestation_type,
        relayRoot,
        proofHash,
      };
      const verification = await bounded(
        "FdcVerification.verifyWeb2Json",
        ports.verifyProof({
          runId: provisionalRunId,
          proof: proofEvidence,
          fdcVerification:
            preflight.network.resolvedContracts.FdcVerification,
        }),
        remaining(),
      );
      if (!verification.verified) {
        throw createFdcError(
          "proof-invalid",
          "PROOF_ONCHAIN_REJECTED",
          "FdcVerification.verifyWeb2Json rejected the proof",
          false,
          { votingRoundId: votingRoundId.toString() },
        );
      }
      const consumer = await bounded(
        "safe consumer eth_call",
        ports.verifyConsumer({
          runId: provisionalRunId,
          manifest: execution.manifest,
          proof: proofEvidence,
          consumer: "canonical-safe",
        }),
        remaining(),
      );
      if (!consumer.passed) {
        throw createFdcError(
          "consumer-invariant",
          "CONSUMER_INVARIANT_REJECTED",
          "The generated safe consumer rejected the proof",
          false,
          {
            diagnosticCodes: consumer.diagnostics.map(
              (diagnostic) => diagnostic.code,
            ),
          },
        );
      }

      return {
        commitHash,
        treeHash,
        runId: `run_live_${transactionHash.slice(2, 26)}`,
        transactionHash,
        votingRound: votingRoundId.toString(),
        proofChecksum: `sha256:${proofHash.slice(2)}`,
        consumerVerified: true,
        broadcastCountAfterRecordedHash: 0,
      };
    },
  };
}
