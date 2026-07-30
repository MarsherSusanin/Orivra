import { request, type Dispatcher } from "undici";
import { createFdcError, normalizeFdcError } from "./errors";

export const COSTON2_CHAIN_ID = 114 as const;

interface ContractReader {
  readContract(input: {
    address: string;
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

export async function resolveCoston2Contracts(input: {
  registryAddress: string;
  reader: ContractReader;
}) {
  const names = ["FdcHub", "FdcVerification", "Relay"] as const;
  const entries = await Promise.all(
    names.map(async (name) => [
      name,
      await input.reader.readContract({
        address: input.registryAddress,
        functionName: "getContractAddressByName",
        args: [name],
      }),
    ]),
  );
  return {
    chainId: COSTON2_CHAIN_ID,
    registryAddress: input.registryAddress,
    resolvedContracts: Object.fromEntries(entries) as Record<(typeof names)[number], string>,
  };
}

export async function quoteAttestationFee(input: {
  requestBytes: string;
  fdcHub: string;
  reader: ContractReader;
}): Promise<bigint> {
  const value = await input.reader.readContract({
    address: input.fdcHub,
    functionName: "getRequestFee",
    args: [input.requestBytes],
  });
  if (typeof value !== "bigint") {
    throw createFdcError(
      "schema-invalid",
      "FEE_QUOTE_INVALID",
      "FdcHub fee quote must be bigint",
      false,
      { valueType: typeof value },
    );
  }
  return value;
}

export function buildWalletSubmissionTransaction(input: {
  from: string;
  requestBytes: string;
  feeWei: bigint;
  fdcHub: string;
  encodeRequestAttestation(requestBytes: string): string;
}) {
  return {
    chainId: "0x72",
    from: input.from,
    to: input.fdcHub,
    data: input.encodeRequestAttestation(input.requestBytes),
    value: `0x${input.feeWei.toString(16)}`,
  };
}

export function calculateVotingRoundId(input: {
  blockTimestamp: bigint;
  firstVotingRoundStartTs: bigint;
  votingEpochDurationSeconds: bigint;
}): bigint {
  if (
    input.votingEpochDurationSeconds <= 0n ||
    input.blockTimestamp < input.firstVotingRoundStartTs
  ) {
    throw new Error("Invalid Flare system timing or voting epoch duration");
  }
  return (
    (input.blockTimestamp - input.firstVotingRoundStartTs) /
    input.votingEpochDurationSeconds
  );
}

export async function pollRelayFinalization(input: {
  votingRoundId: bigint;
  isFinalized(votingRoundId: bigint): Promise<boolean>;
  clock: { now(): number; sleep(ms: number): Promise<void> };
  pollIntervalMs: number;
  timeoutMs: number;
}) {
  const startedAt = input.clock.now();
  while (input.clock.now() - startedAt < input.timeoutMs) {
    if (await input.isFinalized(input.votingRoundId)) {
      return {
        votingRoundId: input.votingRoundId,
        finalizedAtMs: input.clock.now(),
      };
    }
    await input.clock.sleep(input.pollIntervalMs);
  }
  throw createFdcError(
    "not-finalized",
    "RELAY_FINALIZATION_TIMEOUT",
    "Relay did not finalize the voting round before the bounded timeout",
    true,
    {
      votingRoundId: input.votingRoundId.toString(),
      timeoutMs: input.timeoutMs,
    },
  );
}

export interface RawDaProof {
  response_hex: string;
  attestation_type: string;
  proof: string[];
}

function parseDaProof(value: unknown): RawDaProof {
  const record = value as Record<string, unknown>;
  if (
    !record ||
    typeof record.response_hex !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(record.response_hex) ||
    typeof record.attestation_type !== "string" ||
    !Array.isArray(record.proof) ||
    !record.proof.every(
      (item) => typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item),
    )
  ) {
    throw createFdcError(
      "schema-invalid",
      "DA_RESPONSE_INVALID",
      "Data Availability response does not match the raw proof schema",
      false,
      { operation: "proof-by-request-round-raw" },
    );
  }
  return {
    response_hex: record.response_hex,
    attestation_type: record.attestation_type,
    proof: record.proof as string[],
  };
}

export function createDaClient(input: { endpoint: string; dispatcher?: Dispatcher }) {
  return {
    async getProof(votingRoundId: bigint, requestBytes: string): Promise<RawDaProof> {
      try {
        const response = await request(
          `${input.endpoint.replace(/\/+$/, "")}/api/v1/fdc/proof-by-request-round-raw`,
          {
            method: "POST",
            dispatcher: input.dispatcher,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              votingRoundId: votingRoundId.toString(),
              requestBytes,
            }),
          },
        );
        return parseDaProof(await response.body.json());
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "category" in error
        ) {
          throw error;
        }
        throw normalizeFdcError(error, {
          operation: "getRawDaProof",
          endpoint: input.endpoint,
          votingRoundId: votingRoundId.toString(),
        });
      }
    },
  };
}

export async function verifyWeb2JsonProof(input: {
  proof: RawDaProof;
  relayRoot: string;
  calculateMerkleRoot(proof: RawDaProof): string;
  onchainVerify(call: {
    address: string;
    functionName: "verifyWeb2Json";
    proof: RawDaProof;
  }): Promise<boolean>;
  fdcVerification: string;
}) {
  const calculatedRoot = input.calculateMerkleRoot(input.proof);
  if (calculatedRoot.toLowerCase() !== input.relayRoot.toLowerCase()) {
    throw createFdcError(
      "proof-invalid",
      "PROOF_MERKLE_ROOT_MISMATCH",
      "Local proof integrity does not match the Relay root",
      false,
      { expectedRoot: input.relayRoot, calculatedRoot },
    );
  }
  const onchainVerified = await input.onchainVerify({
    address: input.fdcVerification,
    functionName: "verifyWeb2Json",
    proof: input.proof,
  });
  if (!onchainVerified) {
    throw createFdcError(
      "proof-invalid",
      "PROOF_ONCHAIN_REJECTED",
      "FdcVerification.verifyWeb2Json rejected the proof",
      false,
      { verificationContract: input.fdcVerification },
    );
  }
  return { localIntegrity: true, onchainVerified: true };
}
