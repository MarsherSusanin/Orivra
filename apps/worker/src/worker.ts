import { createHash, randomUUID } from "node:crypto";
import {
  type DiagnosticV1,
  type RunEventV1,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  generateSafeWeb2JsonConsumer,
  projectRun,
} from "@proofline/domain";
import { calculateVotingRoundId } from "@proofline/fdc-coston2";
import { normalizeFdcError, redactEvidence } from "@proofline/fdc-coston2";

interface ClaimedCommand {
  claimToken: string;
  command: {
    id: string;
    kind: string;
    runId?: string;
    attempts?: number;
    payload: Record<string, unknown>;
  };
}

interface WorkerRepository {
  claimNextCommand(): Promise<ClaimedCommand | null>;
  completeCommand(
    commandId: string,
    claimToken: string,
    result: unknown,
  ): Promise<unknown>;
  retryCommand(
    commandId: string,
    claimToken: string,
    failure: Record<string, unknown>,
  ): Promise<unknown>;
  renewLease?(
    commandId: string,
    claimToken: string,
    interval: string,
  ): Promise<unknown>;
}

interface WorkerComposition {
  environment: string;
  mode: "live" | "replay";
  adapters: Record<string, { kind: string }>;
}

export function validateWorkerComposition(input: WorkerComposition): void {
  if (input.environment !== "production") return;
  if (input.mode !== "live") {
    throw new Error("Replay or simulator composition is forbidden in production");
  }
  for (const [name, adapter] of Object.entries(input.adapters)) {
    if (adapter.kind !== "live") {
      throw new Error(
        `Replay or simulator adapter ${name} is forbidden in production`,
      );
    }
  }
}

function safeFailure(cause: unknown, commandId: string): Record<string, unknown> {
  if (cause && typeof cause === "object" && "category" in cause) {
    const source = cause as Record<string, unknown>;
    return redactEvidence({
      category: source.category,
      retryable: source.retryable === true,
      message: source.message ?? "Worker command failed",
      commandId,
    }) as Record<string, unknown>;
  }
  return normalizeFdcError(cause, { commandId });
}

export function createRunWorker(input: {
  environment: string;
  mode: "live" | "replay";
  repository: WorkerRepository;
  handlers: Record<string, (command: ClaimedCommand["command"]) => Promise<unknown>>;
  logger: {
    info(value: unknown): void;
    error(value: unknown): void;
  };
  adapters?: Record<string, { kind: string }>;
}) {
  validateWorkerComposition({
    environment: input.environment,
    mode: input.mode,
    adapters: input.adapters ?? {},
  });

  return {
    async processOne(): Promise<boolean> {
      const claimed = await input.repository.claimNextCommand();
      if (!claimed) return false;
      const handler = input.handlers[claimed.command.kind];
      if (!handler) {
        const failure = {
          category: "configuration",
          retryable: false,
          message: "No handler registered for command",
          commandId: claimed.command.id,
        };
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error(failure);
        return true;
      }

      try {
        if (input.repository.renewLease) {
          await input.repository.renewLease(
            claimed.command.id,
            claimed.claimToken,
            "30 seconds",
          );
        }
        const result = await handler(claimed.command);
        await input.repository.completeCommand(
          claimed.command.id,
          claimed.claimToken,
          result,
        );
        input.logger.info({
          event: "WORKER_COMMAND_COMPLETED",
          commandId: claimed.command.id,
        });
      } catch (cause) {
        const failure = safeFailure(cause, claimed.command.id);
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error({
          event: "WORKER_COMMAND_FAILED",
          ...failure,
        });
      }
      return true;
    },
  };
}

type ProductionCommand = ClaimedCommand["command"] & { runId: string };

interface PersistedArtifact {
  id?: string;
  runId?: string;
  kind: string;
  canonicalBytes?: Uint8Array;
  canonical_bytes?: Uint8Array;
  sha256?: Uint8Array | string;
  metadata?: Record<string, unknown>;
}

interface RunExecutionContext {
  runId: string;
  projectId: string;
  manifest: Web2JsonManifestV1;
  events: RunEventV1[];
  projection: ReturnType<typeof projectRun>;
  artifacts: PersistedArtifact[];
}

interface PersistedRelayerTransaction {
  idempotencyKey: string;
  nonce: bigint;
  rawTransaction: string;
  transactionHash: string;
  commandFingerprint?: string;
  chainId: number;
  target: string;
  calldata?: string;
  calldataHash?: string;
  valueWei: bigint;
  fromAddress?: string;
  runId?: string;
  broadcastAt?: string | null;
}

function sha256HexBytes(value: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new Error("Expected canonical hexadecimal calldata");
  }
  return createHash("sha256")
    .update(Buffer.from(value.slice(2), "hex"))
    .digest("hex");
}

function assertRelayerIdentity(
  persisted: PersistedRelayerTransaction,
  expected: {
    runId: string;
    idempotencyKey: string;
    target: string;
    calldata: string;
    valueWei: bigint;
  },
): void {
  const calldataMatches = persisted.calldata
    ? sameHex(persisted.calldata, expected.calldata)
    : persisted.calldataHash === sha256HexBytes(expected.calldata);
  if (
    persisted.chainId !== 114 ||
    persisted.idempotencyKey !== expected.idempotencyKey ||
    (persisted.runId !== undefined && persisted.runId !== expected.runId) ||
    !sameHex(persisted.target, expected.target) ||
    !calldataMatches ||
    persisted.valueWei !== expected.valueWei
  ) {
    throw new Error("Persisted relayer command identity conflict");
  }
}

interface ProductionPipelineRepository {
  loadRunExecutionContext(runId: string): Promise<RunExecutionContext>;
  renewLease?(commandId: string, claimToken: string, interval: string): Promise<unknown>;
  findRelayerTransaction(
    idempotencyKey: string,
  ): Promise<PersistedRelayerTransaction | null>;
  persistRelayerTransaction(value: PersistedRelayerTransaction): Promise<unknown>;
  markRelayerBroadcast(
    idempotencyKey: string,
    transactionHash: string,
  ): Promise<unknown>;
}

interface ProductionPipelinePorts {
  preflight(input: {
    manifest: Web2JsonManifestV1;
    runId: string;
  }): Promise<{
    canonicalUrl: string;
    requestBytes: string;
    requestCalldata: string;
    quotedFeeWei: bigint;
    network: {
      chainId: 114;
      registryAddress: string;
      resolvedContracts: {
        FdcHub: string;
        FdcVerification: string;
        Relay: string;
      };
    };
  }>;
  signRelayerTransaction(input: Record<string, unknown>): Promise<PersistedRelayerTransaction>;
  broadcastRawTransaction(rawTransaction: string): Promise<string>;
  observeWalletTransaction(input: Record<string, unknown>): Promise<{
    transactionHash: string;
    chainId: number;
    target: string;
    calldata: string;
    valueWei: bigint;
  }>;
  getTransactionReceipt(input: Record<string, unknown>): Promise<{
    transactionHash: string;
    blockHash: string;
    blockTimestamp: bigint;
  }>;
  getVotingConfiguration(input: Record<string, unknown>): Promise<{
    firstVotingRoundStartTs: bigint;
    votingEpochDurationSeconds: bigint;
    protocolId: number;
  }>;
  isRelayFinalized(input: Record<string, unknown>): Promise<boolean>;
  getRelayRoot(input: Record<string, unknown>): Promise<string>;
  fetchDaProof(input: Record<string, unknown>): Promise<{
    response_hex: string;
    attestation_type: string;
    proof: string[];
    proofHash?: string;
  }>;
  verifyProof(input: Record<string, unknown>): Promise<{
    verified: boolean;
    verificationContract: string;
  }>;
  verifyConsumer(input: Record<string, unknown>): Promise<{
    passed: boolean;
    diagnostics: DiagnosticV1[];
  }>;
}

interface CommandOutcome {
  events?: RunEventV1[];
  artifacts?: PersistedArtifact[];
  nextCommands?: Array<{
    id: string;
    projectId: string;
    runId: string;
    idempotencyKey: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function canonicalEvidence(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function sha256Bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifact(
  runId: string,
  kind: string,
  value: unknown,
  metadata: Record<string, unknown> = {},
): PersistedArtifact {
  const canonicalBytes = canonicalEvidence(value);
  return {
    id: randomUUID(),
    runId,
    kind,
    canonicalBytes,
    sha256: sha256Bytes(canonicalBytes),
    metadata,
  };
}

function artifactBytes(value: PersistedArtifact): Uint8Array {
  const bytes = value.canonicalBytes ?? value.canonical_bytes;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`Persisted ${value.kind} artifact has no canonical bytes`);
  }
  return bytes;
}

function artifactValue<T>(context: RunExecutionContext, kind: string): T {
  const found = [...context.artifacts].reverse().find((item) => item.kind === kind);
  if (!found) throw new Error(`Persisted ${kind} evidence is required`);
  return JSON.parse(decoder.decode(artifactBytes(found))) as T;
}

function hasEvent(context: RunExecutionContext, type: RunEventV1["type"]): boolean {
  return context.events.some((event) => event.type === type);
}

function event(
  context: RunExecutionContext,
  command: ProductionCommand,
  type: RunEventV1["type"],
  payload: Record<string, unknown>,
  occurredAt: string,
): RunEventV1 {
  return {
    version: "1",
    runId: context.runId,
    sequence: context.events.length + 1,
    commandId: command.id,
    occurredAt,
    type,
    payload,
  } as RunEventV1;
}

function child(
  context: RunExecutionContext,
  kind: string,
  payload: Record<string, unknown> = {},
) {
  return {
    id: randomUUID(),
    projectId: context.projectId,
    runId: context.runId,
    idempotencyKey: `${context.runId}:${kind.toLowerCase()}`,
    kind,
    payload,
  };
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function preflightEvidence(context: RunExecutionContext) {
  return artifactValue<{
    canonicalUrl: string;
    requestBytes: string;
    requestCalldata: string;
    quotedFeeWei: string;
    network: {
      chainId: 114;
      registryAddress: string;
      resolvedContracts: {
        FdcHub: string;
        FdcVerification: string;
        Relay: string;
      };
    };
  }>(context, "preflight-evidence");
}

/**
 * Assemble export bytes exclusively from the append-only journal and immutable
 * artifacts. Artifact metadata is deliberately ignored because it may contain
 * operational audit fields that are not part of the public proof bundle.
 */
export async function assemblePersistedProofBundle(input: {
  runId: string;
  manifest: Web2JsonManifestV1;
  events: RunEventV1[];
  artifacts: PersistedArtifact[];
}) {
  projectRun(input.events);
  const context = {
    runId: input.runId,
    projectId: "bundle-assembly",
    manifest: input.manifest,
    events: input.events,
    projection: projectRun(input.events),
    artifacts: input.artifacts,
  };
  const preflight = artifactValue<{
    requestBytes: string;
    network: {
      chainId: 114;
      registryAddress: string;
      resolvedContracts: {
        FdcHub: string;
        FdcVerification: string;
        Relay: string;
      };
    };
  }>(context, "preflight-evidence");
  const proofEvidence = artifactValue<{
    proof: {
      votingRound: number;
      merkleProof: string[];
      response: string;
    };
    proofVerified?: boolean;
  }>(context, "proof-evidence");
  const safeConsumer = [...input.artifacts]
    .reverse()
    .find((item) => item.kind === "safe-consumer");
  if (!safeConsumer) throw new Error("Persisted safe-consumer evidence is required");
  const safeConsumerSha256 =
    typeof safeConsumer.sha256 === "string"
      ? safeConsumer.sha256.replace(/^sha256:/, "")
      : sha256Hex(artifactBytes(safeConsumer));
  const consumer = [...input.events]
    .reverse()
    .find((item) => item.type === "CONSUMER_VERIFIED");
  if (consumer?.type !== "CONSUMER_VERIFIED") {
    throw new Error("Persisted consumer verification event is required");
  }
  const proofVerified =
    proofEvidence.proofVerified ??
    input.events.some((item) => item.type === "PROOF_VERIFIED");
  const bundle = createProofBundle({
    version: "1",
    runId: input.runId,
    manifest: input.manifest,
    events: input.events,
    requestBytes: preflight.requestBytes,
    network: preflight.network,
    proof: proofEvidence.proof,
    verification: {
      proofVerified,
      consumerVerified: consumer.payload.passed,
      diagnostics: consumer.payload.diagnostics,
    },
    artifacts: { safeConsumerSha256 },
  });
  const canonicalBytes = encoder.encode(canonicalSerializeProofBundle(bundle));
  return {
    bundle,
    canonicalBytes,
    artifact: {
      id: randomUUID(),
      runId: input.runId,
      kind: "proof-bundle",
      canonicalBytes,
      sha256: sha256Bytes(canonicalBytes),
      metadata: { version: "1", checksum: bundle.checksum },
    },
  };
}

export function createProductionCommandHandlers(input: {
  repository: ProductionPipelineRepository;
  ports: ProductionPipelinePorts;
  clock: { now(): string };
}) {
  const load = (command: ProductionCommand) =>
    input.repository.loadRunExecutionContext(command.runId);

  const handlers: Record<
    string,
    (command: ProductionCommand) => Promise<CommandOutcome>
  > = {
    async RUN_PREFLIGHT(command) {
      const context = await load(command);
      if (hasEvent(context, "PREFLIGHT_ACCEPTED")) return { nextCommands: [] };
      const prepared = await input.ports.preflight({
        manifest: context.manifest,
        runId: context.runId,
      });
      const evidence = {
        version: "1",
        canonicalUrl: prepared.canonicalUrl,
        requestBytes: prepared.requestBytes,
        requestCalldata: prepared.requestCalldata,
        quotedFeeWei: prepared.quotedFeeWei.toString(),
        network: prepared.network,
      };
      return {
        events: [
          event(
            context,
            command,
            "PREFLIGHT_ACCEPTED",
            {
              canonicalUrl: prepared.canonicalUrl,
              requestBytes: prepared.requestBytes,
              quotedFeeWei: prepared.quotedFeeWei.toString(),
            },
            input.clock.now(),
          ),
        ],
        artifacts: [artifact(context.runId, "preflight-evidence", evidence)],
        nextCommands: [],
      };
    },

    async SUBMIT_RELAYER(command) {
      const context = await load(command);
      const idempotencyKey = String(
        command.payload.idempotencyKey ?? command.id,
      );
      const preflight = preflightEvidence(context);
      const expected = {
        runId: context.runId,
        idempotencyKey,
        target: preflight.network.resolvedContracts.FdcHub,
        calldata: preflight.requestCalldata,
        valueWei: BigInt(preflight.quotedFeeWei),
      };
      let persisted = await input.repository.findRelayerTransaction(
        idempotencyKey,
      );
      if (!persisted) {
        persisted = await input.ports.signRelayerTransaction({
          runId: context.runId,
          projectId: context.projectId,
          idempotencyKey,
          chainId: 114,
          target: expected.target,
          calldata: expected.calldata,
          valueWei: expected.valueWei,
          manifest: context.manifest,
        });
        assertRelayerIdentity(persisted, expected);
        await input.repository.persistRelayerTransaction({
          ...persisted,
          runId: context.runId,
          idempotencyKey,
        });
      }
      assertRelayerIdentity(persisted, expected);
      return {
        nextCommands: [
          child(context, "BROADCAST_RELAYER_TRANSACTION", {
            idempotencyKey,
          }),
        ],
      };
    },

    async BROADCAST_RELAYER_TRANSACTION(command) {
      const context = await load(command);
      const idempotencyKey = String(command.payload.idempotencyKey ?? "");
      const persisted = await input.repository.findRelayerTransaction(
        idempotencyKey,
      );
      if (!persisted) throw new Error("Persisted signed relayer transaction is required");
      if (!persisted.broadcastAt) {
        const reportedHash = await input.ports.broadcastRawTransaction(
          persisted.rawTransaction,
        );
        if (!sameHex(reportedHash, persisted.transactionHash)) {
          throw new Error("Broadcast transaction hash mismatch");
        }
        await input.repository.markRelayerBroadcast(
          idempotencyKey,
          persisted.transactionHash,
        );
      }
      const events = hasEvent(context, "REQUEST_SUBMITTED")
        ? []
        : [
            event(
              context,
              command,
              "REQUEST_SUBMITTED",
              {
                mode: "relayer",
                transactionHash: persisted.transactionHash,
              },
              input.clock.now(),
            ),
          ];
      return {
        events,
        nextCommands: [
          child(context, "POLL_TRANSACTION_RECEIPT", {
            transactionHash: persisted.transactionHash,
          }),
        ],
      };
    },

    async ATTACH_WALLET_TRANSACTION(command) {
      const context = await load(command);
      const preflight = preflightEvidence(context);
      const observed = await input.ports.observeWalletTransaction({
        transactionHash: command.payload.transactionHash,
        runId: context.runId,
      });
      if (
        observed.chainId !== 114 ||
        !sameHex(observed.target, preflight.network.resolvedContracts.FdcHub) ||
        !sameHex(observed.calldata, preflight.requestCalldata) ||
        observed.valueWei !== BigInt(preflight.quotedFeeWei)
      ) {
        throw new Error("Wallet transaction does not match persisted preflight intent");
      }
      return {
        events: hasEvent(context, "REQUEST_SUBMITTED")
          ? []
          : [
              event(
                context,
                command,
                "REQUEST_SUBMITTED",
                {
                  mode: "wallet",
                  transactionHash: observed.transactionHash,
                },
                input.clock.now(),
              ),
            ],
        nextCommands: [
          child(context, "POLL_TRANSACTION_RECEIPT", {
            transactionHash: observed.transactionHash,
          }),
        ],
      };
    },

    async POLL_TRANSACTION_RECEIPT(command) {
      const context = await load(command);
      if (hasEvent(context, "ROUND_FINALIZED")) {
        return { nextCommands: [child(context, "POLL_RELAY_FINALIZATION")] };
      }
      const receipt = await input.ports.getTransactionReceipt({
        transactionHash: command.payload.transactionHash,
        runId: context.runId,
      });
      const voting = await input.ports.getVotingConfiguration({
        runId: context.runId,
      });
      const votingRound = calculateVotingRoundId({
        blockTimestamp: receipt.blockTimestamp,
        firstVotingRoundStartTs: voting.firstVotingRoundStartTs,
        votingEpochDurationSeconds: voting.votingEpochDurationSeconds,
      });
      const evidence = {
        version: "1",
        ...receipt,
        blockTimestamp: receipt.blockTimestamp.toString(),
        votingRound: Number(votingRound),
        protocolId: voting.protocolId,
      };
      return {
        events: [
          event(
            context,
            command,
            "ROUND_FINALIZED",
            { votingRound: Number(votingRound) },
            input.clock.now(),
          ),
        ],
        artifacts: [artifact(context.runId, "receipt-evidence", evidence)],
        nextCommands: [
          child(context, "POLL_RELAY_FINALIZATION", {
            votingRound: Number(votingRound),
            protocolId: voting.protocolId,
          }),
        ],
      };
    },

    async POLL_RELAY_FINALIZATION(command) {
      const context = await load(command);
      const round = context.events.find((item) => item.type === "ROUND_FINALIZED");
      if (round?.type !== "ROUND_FINALIZED") {
        throw new Error("Voting round evidence is required before Relay polling");
      }
      const receipt = artifactValue<{ protocolId: number }>(
        context,
        "receipt-evidence",
      );
      const finalized = await input.ports.isRelayFinalized({
        votingRound: round.payload.votingRound,
        protocolId: receipt.protocolId,
        runId: context.runId,
      });
      if (!finalized) {
        throw Object.assign(new Error("Relay voting round is not finalized"), {
          category: "not-finalized",
          retryable: true,
        });
      }
      return {
        artifacts: [
          artifact(context.runId, "relay-evidence", {
            version: "1",
            votingRound: round.payload.votingRound,
            protocolId: receipt.protocolId,
            finalized: true,
          }),
        ],
        nextCommands: [child(context, "FETCH_DA_PROOF")],
      };
    },

    async FETCH_DA_PROOF(command) {
      const context = await load(command);
      if (hasEvent(context, "PROOF_AVAILABLE")) {
        return { nextCommands: [child(context, "VERIFY_PROOF")] };
      }
      const round = context.events.find((item) => item.type === "ROUND_FINALIZED");
      if (round?.type !== "ROUND_FINALIZED") throw new Error("Voting round is required");
      const preflight = preflightEvidence(context);
      const receipt = artifactValue<{ protocolId: number }>(
        context,
        "receipt-evidence",
      );
      const proof = await input.ports.fetchDaProof({
        runId: context.runId,
        votingRound: round.payload.votingRound,
        requestBytes: preflight.requestBytes,
      });
      const relayRoot = await input.ports.getRelayRoot({
        runId: context.runId,
        votingRound: round.payload.votingRound,
        protocolId: receipt.protocolId,
      });
      const proofHash =
        proof.proofHash ??
        `0x${createHash("sha256")
          .update(Buffer.from(proof.response_hex.slice(2), "hex"))
          .digest("hex")}`;
      return {
        events: [
          event(
            context,
            command,
            "PROOF_AVAILABLE",
            { proofHash },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "proof-evidence", {
            version: "1",
            proof: {
              votingRound: round.payload.votingRound,
              merkleProof: proof.proof,
              response: proof.response_hex,
            },
            attestationType: proof.attestation_type,
            relayRoot,
            proofHash,
          }),
        ],
        nextCommands: [child(context, "VERIFY_PROOF")],
      };
    },

    async VERIFY_PROOF(command) {
      const context = await load(command);
      if (hasEvent(context, "PROOF_VERIFIED")) {
        return { nextCommands: [child(context, "VERIFY_CONSUMER")] };
      }
      const preflight = preflightEvidence(context);
      const proof = artifactValue<Record<string, unknown>>(context, "proof-evidence");
      const verified = await input.ports.verifyProof({
        runId: context.runId,
        proof,
        fdcVerification: preflight.network.resolvedContracts.FdcVerification,
      });
      if (!verified.verified) {
        throw Object.assign(new Error("FdcVerification rejected the proof"), {
          category: "proof-invalid",
          retryable: false,
        });
      }
      return {
        events: [
          event(
            context,
            command,
            "PROOF_VERIFIED",
            { verificationContract: verified.verificationContract },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "verification-evidence", {
            version: "1",
            proofVerified: true,
            verificationContract: verified.verificationContract,
          }),
        ],
        nextCommands: [child(context, "VERIFY_CONSUMER")],
      };
    },

    async VERIFY_CONSUMER(command) {
      const context = await load(command);
      if (hasEvent(context, "CONSUMER_VERIFIED")) {
        return { nextCommands: [child(context, "BUILD_PROOF_BUNDLE")] };
      }
      const proof = artifactValue<Record<string, unknown>>(context, "proof-evidence");
      const result = await input.ports.verifyConsumer({
        runId: context.runId,
        manifest: context.manifest,
        proof,
        consumer: command.payload.consumer ?? "canonical-vulnerable",
      });
      const safeSource = generateSafeWeb2JsonConsumer(context.manifest, {
        contractName: "ProoflineSafeWeb2JsonConsumer",
      });
      const safeBytes = encoder.encode(safeSource);
      return {
        events: [
          event(
            context,
            command,
            "CONSUMER_VERIFIED",
            { passed: result.passed, diagnostics: result.diagnostics },
            input.clock.now(),
          ),
        ],
        artifacts: [
          artifact(context.runId, "consumer-evidence", {
            version: "1",
            passed: result.passed,
            diagnostics: result.diagnostics,
          }),
          {
            id: randomUUID(),
            runId: context.runId,
            kind: "safe-consumer",
            canonicalBytes: safeBytes,
            sha256: sha256Hex(safeBytes),
            metadata: { compiler: "solc-0.8.36" },
          },
        ],
        nextCommands: [child(context, "BUILD_PROOF_BUNDLE")],
      };
    },

    async BUILD_PROOF_BUNDLE(command) {
      const context = await load(command);
      if (context.artifacts.some((item) => item.kind === "proof-bundle")) {
        return { artifacts: [], nextCommands: [] };
      }
      const assembled = await assemblePersistedProofBundle(context);
      return { artifacts: [assembled.artifact], nextCommands: [] };
    },
  };

  return handlers;
}
