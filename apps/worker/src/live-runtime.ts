import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { Web2JsonManifestV1 } from "@proofline/contracts";
import {
  calculateVotingRoundId,
  createDaClient,
  createFdcError,
  createSafeHttpFetcher,
  pollRelayFinalization,
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
  parseAbiParameters,
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
import type {
  LiveGateEvidence,
  LiveGateRuntime,
} from "./live-gate";

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

function canonicalAbiParameters(signature: string) {
  const trimmed = signature.trim();
  const normalized =
    trimmed.startsWith("{") && trimmed.endsWith("}")
      ? `(${trimmed.slice(1, -1)})`
      : trimmed;
  return parseAbiParameters(normalized);
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
  if (!/^[0-9]+$/.test(value)) {
    throw Object.assign(new Error(`${name} must be an unsigned integer`), {
      kind: "configuration",
    });
  }
  return BigInt(value);
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
}) {
  const environment = input.environment;
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
  const publicClient = createPublicClient({
    chain: coston2,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
  });
  const walletClient = createWalletClient({
    account,
    chain: coston2,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
  });
  const da = createDaClient({ endpoint: daEndpoint });
  const read = (
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    publicClient.readContract({
      address,
      abi,
      functionName,
      args,
    } as never);
  const resolveContracts = async (): Promise<PipelineContracts> =>
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
              ),
            ),
          ),
        ]),
      ),
    ) as PipelineContracts;

  return {
    async preflight({ manifest }: { manifest: Web2JsonManifestV1; runId: string }) {
      const addresses = await resolveContracts();
      const safeFetcher = createSafeHttpFetcher({
        lookup: async (hostname) =>
          (await lookup(hostname, { all: true, verbatim: true })).map(
            (answer) => ({
              address: answer.address,
              family: answer.family as 4 | 6,
            }),
          ),
        dispatch: (request) => httpsDispatch(request),
        timeoutMs: 15_000,
        maxResponseBytes: ONE_MIB,
      });
      const prepared = await runWeb2JsonPreflight({
        manifest,
        samples: 5,
        fdcHub: addresses.FdcHub,
        safeFetcher,
        transformJq: async (value, query) => jqFirst(value as never, query),
        abiEncode: (value, signature) =>
          encodeAbiParameters(canonicalAbiParameters(signature), [value]),
        verifier: input.verifier,
        feeOracle: {
          quote: async ({ requestBytes }) =>
            (await read(
              addresses.FdcRequestFeeConfigurations,
              feeConfigurationsAbi as Abi,
              "getRequestFee",
              [requestBytes],
            )) as bigint,
        },
      });
      const requestCalldata = encodeFunctionData({
        abi: fdcHubAbi as Abi,
        functionName: "requestAttestation",
        args: [prepared.requestBytes as Hex],
      });
      return {
        canonicalUrl: prepared.canonicalUrl,
        requestBytes: prepared.requestBytes,
        requestCalldata,
        quotedFeeWei: prepared.quotedFeeWei,
        network: {
          chainId: 114 as const,
          registryAddress: REGISTRY_ADDRESS,
          resolvedContracts: {
            FdcHub: addresses.FdcHub,
            FdcVerification: addresses.FdcVerification,
            Relay: addresses.Relay,
          },
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
      const balanceWei = await publicClient.getBalance({ address: account.address });
      validateRelayerSubmission({
        idempotencyKey,
        chainId: Number(value.chainId),
        target,
        expectedTarget: addresses.FdcHub,
        calldata,
        expectedCalldata: calldata,
        valueWei,
        quotedFeeWei: valueWei,
        projectFeeCapWei: BigInt(manifest.submission.feeCapWei),
        globalFeeCapWei,
        quotaRemaining: 1,
        balanceWei,
        balanceFloorWei,
      });
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
        const receipt = await publicClient.getTransactionReceipt({
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

export function createLiveCoston2Runtime(input: {
  environment: LiveEnvironment;
}): LiveGateRuntime {
  const environment = input.environment;
  return {
    kind: "live",
    async execute(execution): Promise<LiveGateEvidence> {
      const rpcUrl = environment.PROOFLINE_COSTON2_RPC_URL ?? DEFAULT_RPC;
      const daEndpoint = environment.PROOFLINE_COSTON2_DA_URL ?? DEFAULT_DA;
      const safeConsumer = getAddress(
        required(environment, "PROOFLINE_SAFE_CONSUMER_ADDRESS"),
      );
      const commitHash = required(environment, "GITHUB_SHA");
      const treeHash = required(environment, "PROOFLINE_TREE_HASH");
      if (!/^project_[a-f0-9]{64}$/i.test(execution.projectToken)) {
        throw Object.assign(new Error("Live runtime project token is invalid"), {
          kind: "configuration",
        });
      }
      const account = privateKeyToAccount(execution.privateKey as Hex);
      const publicClient = createPublicClient({
        chain: coston2,
        transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
      });
      const walletClient = createWalletClient({
        account,
        chain: coston2,
        transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
      });
      const deadlineAt = Date.now() + execution.timeoutMs;
      const remaining = () => deadlineAt - Date.now();
      const read = (address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) =>
        publicClient.readContract({
          address,
          abi,
          functionName,
          args,
        } as never);

      const contractNames = [
        "FdcHub",
        "FdcRequestFeeConfigurations",
        "FlareSystemsManager",
        "Relay",
        "FdcVerification",
      ] as const;
      const addresses = Object.fromEntries(
        await Promise.all(
          contractNames.map(async (name) => [
            name,
            getAddress(
              String(
                await bounded(
                  `registry resolution for ${name}`,
                  read(
                    REGISTRY_ADDRESS,
                    registryAbi as Abi,
                    "getContractAddressByName",
                    [name],
                  ),
                  remaining(),
                ),
              ),
            ),
          ]),
        ),
      ) as Record<(typeof contractNames)[number], Address>;

      const safeFetcher = createSafeHttpFetcher({
        lookup: async (hostname) =>
          (await lookup(hostname, { all: true, verbatim: true })).map(
            (answer) => ({
              address: answer.address,
              family: answer.family as 4 | 6,
            }),
          ),
        dispatch: (request) => httpsDispatch(request),
        timeoutMs: Math.min(15_000, Math.max(1, remaining())),
        maxResponseBytes: ONE_MIB,
      });
      const preflight = await bounded(
        "preflight",
        runWeb2JsonPreflight({
          manifest: execution.manifest,
          samples: 5,
          fdcHub: addresses.FdcHub,
          safeFetcher,
          transformJq: async (value, query) => jqFirst(value as never, query),
          abiEncode: (value, signature) =>
            encodeAbiParameters(canonicalAbiParameters(signature), [value]),
          verifier: execution.verifier,
          feeOracle: {
            quote: async ({ requestBytes }) =>
              (await read(
                addresses.FdcRequestFeeConfigurations,
                feeConfigurationsAbi as Abi,
                "getRequestFee",
                [requestBytes],
              )) as bigint,
          },
        }),
        remaining(),
      );

      const requestData = encodeFunctionData({
        abi: fdcHubAbi as Abi,
        functionName: "requestAttestation",
        args: [preflight.requestBytes as Hex],
      });
      const transactionHash = await bounded(
        "requestAttestation broadcast",
        walletClient.sendTransaction({
          account,
          chain: coston2,
          to: addresses.FdcHub,
          data: requestData,
          value: preflight.quotedFeeWei,
        }),
        remaining(),
      );
      // After this durable hash exists, the runtime only polls/reads. No code
      // path below can call sendTransaction, which is the no-rebroadcast gate.
      const receipt = await bounded(
        "transaction receipt",
        publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          timeout: Math.min(remaining(), 120_000),
          pollingInterval: 2_000,
        }),
        remaining(),
      );
      const block = await bounded(
        "receipt block",
        publicClient.getBlock({ blockHash: receipt.blockHash }),
        remaining(),
      );
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
      const votingRoundId = calculateVotingRoundId({
        blockTimestamp: block.timestamp,
        firstVotingRoundStartTs,
        votingEpochDurationSeconds,
      });
      await pollRelayFinalization({
        votingRoundId,
        isFinalized: async (round) =>
          Boolean(
            await read(
              addresses.Relay,
              relayAbi as Abi,
              "isFinalized",
              [BigInt(protocolId), round],
            ),
          ),
        clock: {
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        pollIntervalMs: 5_000,
        timeoutMs: Math.max(1, remaining()),
      });

      const da = createDaClient({ endpoint: daEndpoint });
      let proof: RawDaProof | undefined;
      while (!proof && remaining() > 0) {
        try {
          proof = await bounded(
            "Data Availability proof",
            da.getProof(votingRoundId, preflight.requestBytes),
            Math.min(30_000, remaining()),
          );
        } catch (cause) {
          const retryable =
            cause &&
            typeof cause === "object" &&
            "retryable" in cause &&
            (cause as { retryable: unknown }).retryable === true;
          if (!retryable) throw cause;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(5_000, Math.max(0, remaining()))),
          );
        }
      }
      if (!proof) throw deadlineError("Data Availability proof");

      const relayRoot = String(
        await bounded(
          "Relay root",
          read(addresses.Relay, relayAbi as Abi, "merkleRoots", [
            BigInt(protocolId),
            votingRoundId,
          ]),
          remaining(),
        ),
      ) as Hex;
      const calculatedRoot = calculateMerkleRoot(proof);
      if (calculatedRoot.toLowerCase() !== relayRoot.toLowerCase()) {
        throw createFdcError(
          "proof-invalid",
          "PROOF_MERKLE_ROOT_MISMATCH",
          "Raw DA proof does not match the finalized Relay root",
          false,
          { votingRoundId: votingRoundId.toString() },
        );
      }
      const decodedProof = decodeProof(proof);
      const proofVerified = Boolean(
        await bounded(
          "FdcVerification.verifyWeb2Json",
          read(
            addresses.FdcVerification,
            fdcVerificationAbi as Abi,
            "verifyWeb2Json",
            [decodedProof],
          ),
          remaining(),
        ),
      );
      if (!proofVerified) {
        throw createFdcError(
          "proof-invalid",
          "PROOF_ONCHAIN_REJECTED",
          "FdcVerification.verifyWeb2Json rejected the proof",
          false,
          { votingRoundId: votingRoundId.toString() },
        );
      }

      const requestUrl = String(
        (decodedProof.data as { requestBody: { url: string } }).requestBody.url,
      );
      const diagnostics = diagnoseConsumerRequest(
        execution.manifest,
        requestUrl,
      );
      if (diagnostics.length > 0) {
        throw createFdcError(
          "consumer-invariant",
          "CONSUMER_INVARIANT_REJECTED",
          "The proof URL violates the manifest consumer invariants",
          false,
          { diagnosticCodes: diagnostics.map((item) => item.code) },
        );
      }
      await bounded(
        "safe consumer eth_call",
        read(safeConsumer, consumerAbi(), "consume", [decodedProof]),
        remaining(),
      );

      return {
        commitHash,
        treeHash,
        runId: `run_live_${transactionHash.slice(2, 26)}`,
        transactionHash,
        votingRound: votingRoundId.toString(),
        proofChecksum: `sha256:${createHash("sha256")
          .update(Buffer.from(proof.response_hex.slice(2), "hex"))
          .digest("hex")}`,
        consumerVerified: true,
        broadcastCountAfterRecordedHash: 0,
      };
    },
  };
}
