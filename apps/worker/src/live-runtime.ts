import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import {
  isCanonicalUint256Decimal,
  Web2JsonAbiParameterV1Schema,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  createDaClient,
  createFdcError,
  createSafeHttpFetcher,
  runWeb2JsonPreflight,
  validateRelayerSubmission,
  type PreflightPorts,
  type RawDaProof,
} from "@proofline/fdc-coston2";
import { diagnoseConsumerRequest } from "@proofline/domain";
import { first as jqFirst } from "jq-wasm/inline";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fdcHubAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcHub.sol/IFdcHub.json";
import fdcVerificationAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcVerification.sol/IFdcVerification.json";
import feeConfigurationsAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcRequestFeeConfigurations.sol/IFdcRequestFeeConfigurations.json";
import flareSystemsManagerAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFlareSystemsManager.sol/IFlareSystemsManager.json";
import registryAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFlareContractRegistry.sol/IFlareContractRegistry.json";
import relayAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IRelay.sol/IRelay.json";

const REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;
const DEFAULT_RPC = "https://coston2-api.flare.network/ext/C/rpc";
const DEFAULT_DA =
  "https://ctn2-data-availability.flare.network";
const ONE_MIB = 1024 * 1024;

const coston2 = {
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_RPC] } },
} as const;

interface LiveEnvironment {
  [name: string]: string | undefined;
}

interface LivePipelineDependencies {
  createPublicClient(input: Record<string, unknown>): any;
  createWalletClient(input: Record<string, unknown>): any;
  createDaClient(input: { endpoint: string; timeoutMs?: number }): {
    getProof(votingRoundId: bigint, requestBytes: string): Promise<RawDaProof>;
  };
  lookup(
    hostname: string,
    options?: { signal?: AbortSignal },
  ): Promise<Array<{ address: string; family: 4 | 6 }>>;
  dispatch(input: {
    url: URL;
    pinnedAddress: string;
    signal: AbortSignal;
    maxResponseBytes: number;
  }): ReturnType<typeof httpsDispatch>;
  transformJq(value: unknown, query: string): Promise<unknown>;
}

const defaultPipelineDependencies: LivePipelineDependencies = {
  createPublicClient: (input) => createPublicClient(input as never),
  createWalletClient: (input) => createWalletClient(input as never),
  createDaClient,
  lookup: async (hostname, options) => {
    const resolution = lookup(hostname, { all: true, verbatim: true });
    const aborted = new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(options.signal?.reason),
        { once: true },
      );
    });
    return (await Promise.race([resolution, aborted])).map((answer) => ({
      address: answer.address,
      family: answer.family as 4 | 6,
    }));
  },
  dispatch: httpsDispatch,
  transformJq: async (value, query) => jqFirst(value as never, query),
};

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

function canonicalAbiParameters(signature: string) {
  let descriptor: unknown;
  try {
    descriptor = JSON.parse(signature);
  } catch {
    throw new Error("Web2Json ABI descriptor must be valid JSON");
  }
  return [Web2JsonAbiParameterV1Schema.parse(descriptor)] as readonly AbiParameter[];
}

function normalizeConnectedAddress(address: string | undefined): string {
  return address?.startsWith("::ffff:") ? address.slice(7) : address ?? "";
}

function httpsDispatch(input: {
  url: URL;
  pinnedAddress: string;
  signal: AbortSignal;
  maxResponseBytes: number;
}) {
  return new Promise<{
    status: number;
    connectedAddress: string;
    headers: Record<string, string | undefined>;
    body: Uint8Array;
  }>((resolve, reject) => {
    const request = httpsRequest(
      input.url,
      {
        method: "GET",
        signal: input.signal,
        servername: input.url.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(
            null,
            input.pinnedAddress,
            input.pinnedAddress.includes(":") ? 6 : 4,
          );
        },
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > input.maxResponseBytes) {
            request.destroy(
              new Error(`Web2Json response exceeds ${input.maxResponseBytes} bytes`),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers = Object.fromEntries(
            Object.entries(response.headers).map(([key, value]) => [
              key.toLowerCase(),
              Array.isArray(value) ? value.join(",") : value,
            ]),
          );
          resolve({
            status: response.statusCode ?? 0,
            connectedAddress: normalizeConnectedAddress(
              response.socket.remoteAddress,
            ),
            headers,
            body: new Uint8Array(Buffer.concat(chunks)),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function calculateMerkleRoot(proof: RawDaProof): Hex {
  let node = keccak256(proof.response_hex as Hex);
  for (const siblingValue of proof.proof) {
    const sibling = siblingValue as Hex;
    const pair =
      node.toLowerCase() < sibling.toLowerCase()
        ? ([node, sibling] as const)
        : ([sibling, node] as const);
    node = keccak256(concatHex(pair));
  }
  return node;
}

function responseParameter(): AbiParameter {
  const verifier = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }> | undefined;
  const proof = verifier?.inputs[0];
  if (!proof || proof.type !== "tuple" || !("components" in proof)) {
    throw new Error("Official FdcVerification ABI has no Web2Json proof tuple");
  }
  const data = proof.components.find((component) => component.name === "data");
  if (!data) throw new Error("Official Web2Json proof ABI has no response data");
  return data;
}

function decodeProof(proof: RawDaProof) {
  const [data] = decodeAbiParameters(
    [responseParameter()],
    proof.response_hex as Hex,
  );
  return { merkleProof: proof.proof as readonly Hex[], data };
}

function consumerAbi(): Abi {
  const verifier = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }>;
  return [
    {
      type: "function",
      name: "consume",
      stateMutability: "view",
      inputs: verifier.inputs,
      outputs: [{ name: "", type: "bytes" }],
    },
  ] as Abi;
}

const PIPELINE_CONTRACT_NAMES = [
  "FdcHub",
  "FdcRequestFeeConfigurations",
  "FlareSystemsManager",
  "Relay",
  "FdcVerification",
] as const;

type PipelineContractName = (typeof PIPELINE_CONTRACT_NAMES)[number];
type PipelineContracts = Record<PipelineContractName, Address>;

function positiveBigInt(environment: LiveEnvironment, name: string): bigint {
  const value = required(environment, name);
  if (!isCanonicalUint256Decimal(value)) {
    throw Object.assign(new Error(`${name} must be an unsigned canonical uint256 integer`), {
      kind: "configuration",
    });
  }
  return BigInt(value);
}

function positiveInteger(
  environment: LiveEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw Object.assign(new Error(`${name} must be a positive integer`), {
      kind: "configuration",
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw Object.assign(
      new Error(`${name} must not exceed ${maximum}`),
      { kind: "configuration" },
    );
  }
  return value;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createFdcError(
      "schema-invalid",
      "PERSISTED_EVIDENCE_INVALID",
      `${label} is not a persisted evidence object`,
      false,
      { label },
    );
  }
  return value as Record<string, unknown>;
}

function relayerPolicyFromEvidence(value: unknown) {
  const policy = recordValue(value, "relayer policy");
  try {
    const projectFeeCapWei = BigInt(String(policy.projectFeeCapWei ?? "-1"));
    const globalFeeCapWei = BigInt(String(policy.globalFeeCapWei ?? "-1"));
    const quotaRemaining = Number(policy.quotaRemaining);
    const balanceFloorWei = BigInt(String(policy.balanceFloorWei ?? "-1"));
    if (
      !isCanonicalUint256Decimal(projectFeeCapWei.toString()) ||
      !isCanonicalUint256Decimal(globalFeeCapWei.toString()) ||
      !Number.isInteger(quotaRemaining) ||
      quotaRemaining <= 0 ||
      !isCanonicalUint256Decimal(balanceFloorWei.toString())
    ) {
      throw new Error("invalid policy values");
    }
    return {
      projectFeeCapWei,
      globalFeeCapWei,
      quotaRemaining,
      balanceFloorWei,
    };
  } catch {
    throw createFdcError(
      "schema-invalid",
      "RELAYER_POLICY_EVIDENCE_INVALID",
      "Persisted relayer policy evidence is invalid",
      false,
      {},
    );
  }
}

function transactionIsMissing(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = String((cause as { name?: unknown }).name ?? "");
  const message = String((cause as { message?: unknown }).message ?? "");
  return (
    name === "TransactionNotFoundError" ||
    name === "TransactionReceiptNotFoundError" ||
    name === "WaitForTransactionReceiptTimeoutError" ||
    /\btransaction(?: receipt)?\b.*\bnot found\b/i.test(message) ||
    /^not found$/i.test(message)
  );
}

function rawProofFromEvidence(value: unknown): RawDaProof {
  const evidence = recordValue(value, "proof evidence");
  const proof = recordValue(evidence.proof, "proof payload");
  const response = proof.response;
  const merkleProof = proof.merkleProof;
  const attestationType = evidence.attestationType;
  if (
    typeof response !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(response) ||
    !Array.isArray(merkleProof) ||
    !merkleProof.every(
      (item) => typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item),
    ) ||
    typeof attestationType !== "string"
  ) {
    throw createFdcError(
      "schema-invalid",
      "PERSISTED_PROOF_INVALID",
      "Persisted proof evidence is not a canonical raw DA proof",
      false,
      {},
    );
  }
  return {
    response_hex: response,
    proof: merkleProof as string[],
    attestation_type: attestationType,
  };
}

function relayerFingerprint(value: {
  runId: string;
  idempotencyKey: string;
  target: string;
  calldata: string;
  valueWei: bigint;
}): string {
  const canonical = JSON.stringify({
    runId: value.runId,
    idempotencyKey: value.idempotencyKey,
    chainId: 114,
    target: value.target.toLowerCase(),
    calldata: value.calldata.toLowerCase(),
    valueWei: value.valueWei.toString(),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Live, restart-safe ports for the persisted command graph. Every operation is
 * independently reconstructible from the command plus durable run evidence;
 * no in-memory result is required by a later worker lease.
 */
export function createLiveCoston2PipelinePorts(input: {
  environment: LiveEnvironment;
  verifier: PreflightPorts["verifier"];
  dependencies?: Partial<LivePipelineDependencies>;
}) {
  const environment = input.environment;
  const dependencies: LivePipelineDependencies = {
    ...defaultPipelineDependencies,
    ...input.dependencies,
  };
  const rpcUrl = environment.PROOFLINE_COSTON2_RPC_URL ?? DEFAULT_RPC;
  const daEndpoint = environment.PROOFLINE_COSTON2_DA_URL ?? DEFAULT_DA;
  const account = privateKeyToAccount(
    required(environment, "PROOFLINE_COSTON2_PRIVATE_KEY") as Hex,
  );
  const globalFeeCapWei = positiveBigInt(
    environment,
    "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
  );
  const balanceFloorWei = positiveBigInt(
    environment,
    "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
  );
  const receiptPollTimeoutMs = positiveInteger(
    environment,
    "PROOFLINE_RECEIPT_POLL_TIMEOUT_MS",
    25_000,
    30_000,
  );
  const daTimeoutMs = positiveInteger(
    environment,
    "PROOFLINE_DA_TIMEOUT_MS",
    15_000,
    30_000,
  );
  const publicClient = dependencies.createPublicClient({
    chain: coston2,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
  });
  const walletClient = dependencies.createWalletClient({
    account,
    chain: coston2,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
  });
  const da = dependencies.createDaClient({
    endpoint: daEndpoint,
    timeoutMs: daTimeoutMs,
  });
  const read = (
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
    blockNumber?: bigint,
  ) =>
    publicClient.readContract({
      address,
      abi,
      functionName,
      args,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    } as never);
  const resolveContracts = async (
    blockNumber?: bigint,
  ): Promise<PipelineContracts> =>
    Object.fromEntries(
      await Promise.all(
        PIPELINE_CONTRACT_NAMES.map(async (name) => [
          name,
          getAddress(
            String(
              await read(
                REGISTRY_ADDRESS,
                registryAbi as Abi,
                "getContractAddressByName",
                [name],
                blockNumber,
              ),
            ),
          ),
        ]),
      ),
    ) as PipelineContracts;

  return {
    async preflight({
      manifest,
      runId,
    }: {
      manifest: Web2JsonManifestV1;
      runId: string;
    }) {
      const blockNumber = (await publicClient.getBlockNumber()) as bigint;
      const addresses = await resolveContracts(blockNumber);
      const networkSnapshot = {
        chainId: 114 as const,
        blockNumber: blockNumber.toString(),
        registryAddress: REGISTRY_ADDRESS,
        resolvedContracts: {
          FdcHub: addresses.FdcHub,
          FdcRequestFeeConfigurations:
            addresses.FdcRequestFeeConfigurations,
          FdcVerification: addresses.FdcVerification,
          Relay: addresses.Relay,
        },
      };
      const safeFetcher = createSafeHttpFetcher({
        lookup: dependencies.lookup,
        dispatch: dependencies.dispatch,
        timeoutMs: 15_000,
        maxResponseBytes: ONE_MIB,
      });
      const outcome = await runWeb2JsonPreflight({
        runId,
        manifest,
        samples: 5,
        fdcHub: addresses.FdcHub,
        networkSnapshot,
        safeFetcher,
        transformJq: dependencies.transformJq,
        abiEncode: (value, signature) =>
          encodeAbiParameters(canonicalAbiParameters(signature), [value]),
        verifier: {
          prepareRequest: async (canonicalManifest) => {
            return input.verifier.prepareRequest(canonicalManifest);
          },
        },
        feeOracle: {
          quote: async ({ requestBytes }) =>
            (await read(
              addresses.FdcRequestFeeConfigurations,
              feeConfigurationsAbi as Abi,
              "getRequestFee",
              [requestBytes],
              blockNumber,
            )) as bigint,
        },
      });
      if (outcome.kind === "blocked") {
        return outcome;
      }
      const requestCalldata = encodeFunctionData({
        abi: fdcHubAbi as Abi,
        functionName: "requestAttestation",
        args: [outcome.submissionEvidence.requestBytes as Hex],
      });
      const network = {
        chainId: 114 as const,
        blockNumber: blockNumber.toString(),
        registryAddress: REGISTRY_ADDRESS,
        resolvedContracts: {
          FdcHub: addresses.FdcHub,
          FdcRequestFeeConfigurations:
            addresses.FdcRequestFeeConfigurations,
          FdcVerification: addresses.FdcVerification,
          Relay: addresses.Relay,
        },
      };
      return {
        ...outcome,
        submissionEvidence: {
          ...outcome.submissionEvidence,
          requestCalldata,
          network,
        },
      };
    },

    async signRelayerTransaction(value: Record<string, unknown>) {
      const addresses = await resolveContracts();
      const manifest = value.manifest as Web2JsonManifestV1;
      const runId = String(value.runId ?? "");
      const idempotencyKey = String(value.idempotencyKey ?? "");
      const target = getAddress(String(value.target ?? ""));
      const calldata = String(value.calldata ?? "") as Hex;
      const valueWei = BigInt(String(value.valueWei ?? "-1"));
      const policy = relayerPolicyFromEvidence(value.policy);
      if (
        !isCanonicalUint256Decimal(valueWei.toString()) ||
        policy.projectFeeCapWei !==
          BigInt(manifest.submission.feeCapWei) ||
        policy.globalFeeCapWei !== globalFeeCapWei ||
        policy.balanceFloorWei !== balanceFloorWei
      ) {
        throw createFdcError(
          "configuration",
          "RELAYER_POLICY_CONFIGURATION_DRIFT",
          "Persisted relayer policy does not match the active worker configuration",
          false,
          {},
        );
      }
      const balanceWei = await publicClient.getBalance({ address: account.address });
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const prepared = await publicClient.prepareTransactionRequest({
        account,
        chain: coston2,
        to: target,
        data: calldata,
        value: valueWei,
        nonce,
      });
      validateRelayerSubmission({
        idempotencyKey,
        chainId: Number(value.chainId),
        target,
        expectedTarget: addresses.FdcHub,
        calldata,
        expectedCalldata: calldata,
        valueWei,
        quotedFeeWei: valueWei,
        projectFeeCapWei: policy.projectFeeCapWei,
        globalFeeCapWei: policy.globalFeeCapWei,
        quotaRemaining: policy.quotaRemaining,
        balanceWei,
        balanceFloorWei: policy.balanceFloorWei,
        gasLimit: prepared.gas as bigint,
        maxFeePerGasWei: (prepared.maxFeePerGas ?? prepared.gasPrice) as bigint,
      });
      const rawTransaction = await walletClient.signTransaction(prepared);
      return {
        projectId: String(value.projectId ?? ""),
        runId,
        idempotencyKey,
        nonce: BigInt(nonce),
        rawTransaction,
        transactionHash: keccak256(rawTransaction),
        commandFingerprint: relayerFingerprint({
          runId,
          idempotencyKey,
          target,
          calldata,
          valueWei,
        }),
        chainId: 114,
        target,
        calldata,
        valueWei,
        fromAddress: account.address,
        broadcastAt: null,
      };
    },

    async broadcastRawTransaction(rawTransaction: string) {
      return publicClient.sendRawTransaction({
        serializedTransaction: rawTransaction as Hex,
      });
    },

    deriveTransactionHash(rawTransaction: string) {
      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(rawTransaction)) {
        throw new Error("Raw signed transaction must be canonical hexadecimal bytes");
      }
      return keccak256(rawTransaction as Hex);
    },

    async resolveRecordedTransaction(transactionHash: string) {
      try {
        await publicClient.getTransaction({ hash: transactionHash as Hex });
        return true;
      } catch (cause) {
        if (transactionIsMissing(cause)) return false;
        throw createFdcError(
          "transport",
          "RELAYER_TRANSACTION_LOOKUP_FAILED",
          "Unable to determine whether the persisted relayer transaction is on-chain",
          true,
          { transactionHash },
        );
      }
    },

    async observeWalletTransaction(value: Record<string, unknown>) {
      const transactionHash = String(value.transactionHash ?? "") as Hex;
      const [transaction, chainId] = await Promise.all([
        publicClient.getTransaction({ hash: transactionHash }),
        publicClient.getChainId(),
      ]);
      if (!transaction.to) throw new Error("Wallet transaction target is required");
      return {
        transactionHash,
        chainId,
        target: transaction.to,
        calldata: transaction.input,
        valueWei: transaction.value,
      };
    },

    async getTransactionReceipt(value: Record<string, unknown>) {
      const transactionHash = String(value.transactionHash ?? "") as Hex;
      try {
        const receipt =
          typeof publicClient.waitForTransactionReceipt === "function"
            ? await publicClient.waitForTransactionReceipt({
                hash: transactionHash,
                pollingInterval: 2_000,
                timeout: receiptPollTimeoutMs,
              })
            : await publicClient.getTransactionReceipt({
                hash: transactionHash,
              });
        if (receipt.status !== "success") {
          throw createFdcError(
            "transport",
            "REQUEST_TRANSACTION_REVERTED",
            "FdcHub requestAttestation transaction reverted",
            false,
            { transactionHash },
          );
        }
        const block = await publicClient.getBlock({ blockHash: receipt.blockHash });
        return {
          transactionHash,
          blockHash: receipt.blockHash,
          blockTimestamp: block.timestamp,
        };
      } catch (cause) {
        if (cause && typeof cause === "object" && "category" in cause) throw cause;
        if (!transactionIsMissing(cause)) {
          throw createFdcError(
            "transport",
            "REQUEST_RECEIPT_LOOKUP_FAILED",
            "FdcHub request transaction receipt lookup failed",
            true,
            { transactionHash },
          );
        }
        throw createFdcError(
          "not-finalized",
          "REQUEST_RECEIPT_PENDING",
          "FdcHub request transaction receipt is not available yet",
          true,
          { transactionHash },
        );
      }
    },

    async getVotingConfiguration() {
      const addresses = await resolveContracts();
      const [firstVotingRoundStartTs, votingEpochDurationSeconds, protocolId] =
        await Promise.all([
          read(
            addresses.FlareSystemsManager,
            flareSystemsManagerAbi as Abi,
            "firstVotingRoundStartTs",
          ) as Promise<bigint>,
          read(
            addresses.FlareSystemsManager,
            flareSystemsManagerAbi as Abi,
            "votingEpochDurationSeconds",
          ) as Promise<bigint>,
          read(
            addresses.FdcVerification,
            fdcVerificationAbi as Abi,
            "fdcProtocolId",
          ) as Promise<number>,
        ]);
      return {
        firstVotingRoundStartTs,
        votingEpochDurationSeconds,
        protocolId: Number(protocolId),
      };
    },

    async isRelayFinalized(value: Record<string, unknown>) {
      const addresses = await resolveContracts();
      return Boolean(
        await read(addresses.Relay, relayAbi as Abi, "isFinalized", [
          BigInt(String(value.protocolId)),
          BigInt(String(value.votingRound)),
        ]),
      );
    },

    async getRelayRoot(value: Record<string, unknown>) {
      const addresses = await resolveContracts();
      return String(
        await read(addresses.Relay, relayAbi as Abi, "merkleRoots", [
          BigInt(String(value.protocolId)),
          BigInt(String(value.votingRound)),
        ]),
      );
    },

    async fetchDaProof(value: Record<string, unknown>) {
      return da.getProof(
        BigInt(String(value.votingRound)),
        String(value.requestBytes),
      );
    },

    async verifyProof(value: Record<string, unknown>) {
      const proof = rawProofFromEvidence(value.proof);
      const evidence = recordValue(value.proof, "proof evidence");
      const relayRoot = String(evidence.relayRoot ?? "") as Hex;
      if (calculateMerkleRoot(proof).toLowerCase() !== relayRoot.toLowerCase()) {
        return {
          verified: false,
          verificationContract: String(value.fdcVerification),
        };
      }
      const verificationContract = getAddress(String(value.fdcVerification));
      const verified = Boolean(
        await read(
          verificationContract,
          fdcVerificationAbi as Abi,
          "verifyWeb2Json",
          [decodeProof(proof)],
        ),
      );
      return { verified, verificationContract };
    },

    async verifyConsumer(value: Record<string, unknown>) {
      const proof = rawProofFromEvidence(value.proof);
      const decoded = decodeProof(proof);
      const manifest = value.manifest as Web2JsonManifestV1;
      const requestUrl = String(
        (decoded.data as { requestBody: { url: string } }).requestBody.url,
      );
      const diagnostics = diagnoseConsumerRequest(manifest, requestUrl);
      if (diagnostics.length > 0) return { passed: false, diagnostics };
      if (value.consumer === "canonical-vulnerable") {
        return {
          passed: false,
          diagnostics: [
            {
              version: "1" as const,
              code: "MISSING_CONSUMER_HOST_INVARIANT",
              severity: "warning" as const,
              confidence: "high" as const,
              summary:
                "The canonical vulnerable consumer verifies the proof but does not enforce the expected source URL.",
              evidence: {
                consumer: "canonical-vulnerable",
                missingChecks: ["scheme", "host", "path", "query"],
                requestUrl,
              },
              remediation:
                "Use the generated safe consumer and enforce scheme, host, path, and query before trusting response data.",
            },
          ],
        };
      }
      const safeConsumer = getAddress(
        required(environment, "PROOFLINE_SAFE_CONSUMER_ADDRESS"),
      );
      await read(safeConsumer, consumerAbi(), "consume", [decoded]);
      return { passed: true, diagnostics: [] };
    },
  };
}
