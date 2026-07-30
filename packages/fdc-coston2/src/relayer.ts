import { redactEvidence } from "./errors";

export interface RelayerSubmission {
  idempotencyKey: string;
  chainId: number;
  target: string;
  expectedTarget: string;
  calldata: string;
  expectedCalldata: string;
  valueWei: bigint;
  quotedFeeWei: bigint;
  projectFeeCapWei: bigint;
  globalFeeCapWei: bigint;
  quotaRemaining: number;
  balanceWei: bigint;
  balanceFloorWei: bigint;
}

export function validateRelayerSubmission<T extends RelayerSubmission>(input: T): T {
  if (input.chainId !== 114) throw new Error("Relayer chain must be Coston2 chain 114");
  if (input.target.toLowerCase() !== input.expectedTarget.toLowerCase()) {
    throw new Error("Relayer target must be the registry-resolved FdcHub");
  }
  if (input.calldata.toLowerCase() !== input.expectedCalldata.toLowerCase()) {
    throw new Error("Relayer calldata must match the stored request");
  }
  if (input.valueWei !== input.quotedFeeWei) {
    throw new Error("Relayer value must equal the exact registry fee quote");
  }
  if (input.valueWei > input.projectFeeCapWei) {
    throw new Error("Relayer fee exceeds the project fee cap");
  }
  if (input.valueWei > input.globalFeeCapWei) {
    throw new Error("Relayer fee exceeds the global fee cap");
  }
  if (input.quotaRemaining <= 0) throw new Error("Relayer quota is exhausted");
  if (input.balanceWei - input.valueWei < input.balanceFloorWei) {
    throw new Error("Insufficient relayer balance to preserve the balance floor");
  }
  return input;
}

export function redactRelayerAudit(value: unknown): unknown {
  return redactEvidence(value);
}

interface PersistedRelayerTransaction {
  nonce: bigint;
  rawTransaction: string;
  transactionHash: string;
}

interface RelayerRepository {
  findByIdempotencyKey(key: string): Promise<PersistedRelayerTransaction | null>;
  reserveNonce(command: RelayerSubmission): Promise<bigint>;
  persistSignedTransaction(
    key: string,
    value: PersistedRelayerTransaction,
  ): Promise<void>;
  markBroadcast(key: string, transactionHash: string): Promise<void>;
}

export function createRelayerExecutor(input: {
  repository: RelayerRepository;
  signer: {
    sign(
      transaction: RelayerSubmission & { nonce: bigint },
    ): Promise<{ rawTransaction: string; transactionHash: string }>;
  };
  broadcaster(rawTransaction: string): Promise<string>;
}) {
  async function broadcast(
    command: RelayerSubmission,
    persisted: PersistedRelayerTransaction,
    reused: boolean,
  ) {
    const reportedHash = await input.broadcaster(persisted.rawTransaction);
    if (reportedHash.toLowerCase() !== persisted.transactionHash.toLowerCase()) {
      throw new Error("Broadcast transaction hash mismatch");
    }
    if (!reused) {
      await input.repository.markBroadcast(
        command.idempotencyKey,
        persisted.transactionHash,
      );
    }
    return { ...persisted, reused };
  }

  return {
    async execute(commandValue: RelayerSubmission) {
      const command = validateRelayerSubmission(commandValue);
      const existing = await input.repository.findByIdempotencyKey(
        command.idempotencyKey,
      );
      if (existing) return broadcast(command, existing, true);

      const nonce = await input.repository.reserveNonce(command);
      const signed = await input.signer.sign({ ...command, nonce });
      const persisted = { nonce, ...signed };
      await input.repository.persistSignedTransaction(
        command.idempotencyKey,
        persisted,
      );
      return broadcast(command, persisted, false);
    },
  };
}
