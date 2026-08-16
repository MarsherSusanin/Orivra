import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runProductionSafeConsumerDeployment } from "../../../scripts/safe-consumer-registry-deployment-runtime.mjs";
import { compileSafeConsumerSolidity } from "./safe-consumer-solidity-authority";

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

function sha256(value: Uint8Array | string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function createCompiler() {
  const invariant = await readFile("/app/contracts/ProoflineUrlInvariant.sol", "utf8");
  return {
    async compileConsumer(input: Record<string, string>) {
      const compiled = compileSafeConsumerSolidity({
        source: input.source,
        invariantSource: invariant,
        contractName: input.contractName,
      });
      return {
        compiler: compiled.compiler,
        manifestSha256: input.manifestSha256,
        compiledSourceSha256: sha256(input.source),
        bytecode: compiled.bytecode,
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
