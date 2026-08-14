import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runProductionSafeConsumerDeployment } from "../../../scripts/safe-consumer-registry-deployment-runtime.mjs";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const CANONICAL_EVIDENCE_ROOT = "/opt/orivra/evidence";
const EVIDENCE_ROOT = process.env.PROOFLINE_SAFE_CONSUMER_DEPLOYER_STAGE_DIR ?? "/run/proofline/safe-consumer-stage";
const KEY_FILE = "/run/secrets/worker_coston2_private_key";
const chain = {
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const iWeb2Json = `// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
interface IWeb2Json {
  struct RequestBody { string url; string httpMethod; string headers; string queryParams; string body; string postProcessJq; string abiSignature; }
  struct ResponseBody { bytes abiEncodedData; }
  struct Response { bytes32 attestationType; bytes32 sourceId; uint64 votingRound; uint64 lowestUsedTimestamp; RequestBody requestBody; ResponseBody responseBody; }
  struct Proof { bytes32[] merkleProof; Response data; }
}`;
const registry = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {IWeb2Json} from "./IWeb2Json.sol";
interface IFlareContractRegistry { function getContractAddressByHash(bytes32 nameHash) external view returns(address); }
interface IFdcVerification { function verifyWeb2Json(IWeb2Json.Proof calldata proof) external view returns (bool); }
library ContractRegistry {
  IFlareContractRegistry internal constant REGISTRY = IFlareContractRegistry(0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019);
  function getFdcVerification() internal view returns (IFdcVerification) {
    return IFdcVerification(REGISTRY.getContractAddressByHash(keccak256(abi.encode("FdcVerification"))));
  }
}`;

function sha256(value: Uint8Array | string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function createCompiler() {
  const invariant = await readFile("/app/contracts/ProoflineUrlInvariant.sol", "utf8");
  if (solc.version().split("+")[0] !== "0.8.36") throw new Error("Pinned Solidity compiler is unavailable");
  return {
    async compileConsumer(input: Record<string, string>) {
      const standardInput = {
        language: "Solidity",
        sources: { "ProoflineSafeWeb2JsonConsumer.sol": { content: input.source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          metadata: { bytecodeHash: "none", appendCBOR: false },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      };
      const output = JSON.parse(solc.compile(JSON.stringify(standardInput), {
        import(path: string) {
          if (path.endsWith("/IWeb2Json.sol")) return { contents: iWeb2Json };
          if (path.endsWith("/ContractRegistry.sol")) return { contents: registry };
          if (path.endsWith("ProoflineUrlInvariant.sol")) return { contents: invariant };
          return { error: "Unsupported production Solidity import" };
        },
      }));
      const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
      if (errors.length) throw new Error("Production safe consumer compilation failed");
      const bytecode = output.contracts?.["ProoflineSafeWeb2JsonConsumer.sol"]?.[input.contractName]?.evm?.bytecode?.object;
      if (typeof bytecode !== "string" || !bytecode.length) throw new Error("Production safe consumer bytecode is missing");
      return {
        compiler: "solc-0.8.36",
        manifestSha256: input.manifestSha256,
        compiledSourceSha256: sha256(input.source),
        bytecode: `0x${bytecode}`,
      };
    },
  };
}

function createRelayer() {
  let account: ReturnType<typeof privateKeyToAccount>;
  const publicClient = createPublicClient({ chain, transport: http(process.env.PROOFLINE_COSTON2_RPC_URL ?? RPC, { timeout: 15_000, retryCount: 0 }) });
  return {
    async deriveAccount({ privateKeyBytes }: { privateKeyBytes: Uint8Array }) {
      account = privateKeyToAccount(`0x${Buffer.from(privateKeyBytes).toString("hex")}` as Hex);
      return { address: account.address };
    },
    async getChainId() { return publicClient.getChainId(); },
    async getBalanceWei({ address }: { address: Address }) { return (await publicClient.getBalance({ address })).toString(); },
    async estimateDeploymentCostWei({ bytecode }: { bytecode: Hex }) {
      const gas = await publicClient.estimateGas({ account: account.address, data: bytecode });
      const fees = await publicClient.estimateFeesPerGas();
      return (gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n)).toString();
    },
    async sendDeployment({ bytecode }: { bytecode: Hex }) {
      const wallet = createWalletClient({ account, chain, transport: http(process.env.PROOFLINE_COSTON2_RPC_URL ?? RPC, { timeout: 15_000, retryCount: 0 }) });
      return { transactionHash: await wallet.sendTransaction({ account, chain, data: bytecode, to: undefined }) };
    },
    async waitForReceipt({ transactionHash }: { transactionHash: Hex }) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 2, timeout: 120_000 });
      return { status: receipt.status, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), contractAddress: receipt.contractAddress };
    },
    async getCode({ address }: { address: Address }) { return (await publicClient.getBytecode({ address })) ?? "0x"; },
  };
}

async function publishCanonicalPair(input: { files: Array<{ path: string; bytes: Uint8Array; mode: number }>; commitMarker: string; noReplace: boolean }) {
  if (!input.noReplace || input.commitMarker !== `${CANONICAL_EVIDENCE_ROOT}/safe-consumer-registry.v1.json` ||
    !EVIDENCE_ROOT.startsWith("/run/proofline/") || EVIDENCE_ROOT.includes("\0")) throw new Error("Safe consumer evidence publication is invalid");
  await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const created: string[] = [];
  try {
    const stagedFiles = input.files.map((file) => ({ ...file, path: `${EVIDENCE_ROOT}/${file.path.split("/").at(-1)}` }));
    for (const file of stagedFiles) {
      await lstat(file.path).then(
        () => { throw new Error("Safe consumer evidence already exists"); },
        (cause: NodeJS.ErrnoException) => {
          if (cause.code !== "ENOENT") throw cause;
        },
      );
    }
    for (const file of stagedFiles) {
      const stage = `${file.path}.stage`;
      const handle = await open(stage, "wx", 0o600);
      try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
      await chmod(stage, file.mode);
      await link(stage, file.path);
      created.push(file.path);
      await rm(stage);
    }
    return { status: "passed", atomic: true };
  } catch (cause) {
    for (const path of created) await rm(path, { force: true });
    for (const file of input.files) await rm(`${EVIDENCE_ROOT}/${file.path.split("/").at(-1)}.stage`, { force: true });
    throw cause;
  }
}

const result = await runProductionSafeConsumerDeployment({
  relayerPrivateKeyFile: process.env.PROOFLINE_COSTON2_PRIVATE_KEY_FILE ?? KEY_FILE,
  clock: { now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
  compiler: await createCompiler(),
  relayer: createRelayer(),
  publication: { publishCanonicalPair },
});
process.stdout.write(`${JSON.stringify({ status: "passed" })}\n`);
