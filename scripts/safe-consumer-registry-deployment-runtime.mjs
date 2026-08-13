import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  SafeConsumerDeploymentEvidenceV1Schema,
  canonicalSerializeSafeConsumerDeploymentEvidence,
  canonicalSerializeSafeConsumerRegistry,
  checksumSafeConsumerRegistry,
} from "../packages/contracts/src/production-promotion-runtime.mjs";

const OPEN_METEO = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const REGISTRY_PATH = "/opt/orivra/evidence/safe-consumer-registry.v1.json";
const EVIDENCE_PATH = "/opt/orivra/evidence/safe-consumer-deployment-evidence.v1.json";
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TRANSACTION = /^0x[a-fA-F0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;

const builtins = Object.freeze([
  Object.freeze({
    templateId: "open-meteo-current-weather",
    revision: 1,
    manifestSha256: OPEN_METEO,
    contractName: "OrivraOpenMeteoCurrentWeatherConsumer",
    expectedScheme: "https",
    expectedHost: "api.open-meteo.com",
    expectedPathPrefix: "/v1/forecast",
    expectedQuery: Object.freeze({ current: "temperature_2m", forecast_days: "1", latitude: "52.52", longitude: "13.41", temperature_unit: "celsius", timezone: "UTC" }),
  }),
  Object.freeze({
    templateId: "eth-usd",
    revision: 1,
    manifestSha256: ETH_USD,
    contractName: "OrivraEthUsdConsumer",
    expectedScheme: "https",
    expectedHost: "api.coinbase.com",
    expectedPathPrefix: "/v2/prices/ETH-USD/spot",
    expectedQuery: Object.freeze({}),
  }),
]);

function failure(cause) {
  return Object.assign(new Error("Safe consumer deployment failed"), {
    name: "SafeConsumerDeploymentError",
    code: "SAFE_CONSUMER_DEPLOYMENT_INVALID",
    cause,
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sourceFor(entry) {
  const queryChecks = Object.entries(entry.expectedQuery).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) =>
    `        ProoflineUrlInvariant.requireQueryValue(requestUrl, ${JSON.stringify(new URLSearchParams([[key, value]]).toString().split("=")[0])}, ${JSON.stringify(new URLSearchParams([[key, value]]).toString().split("=").slice(1).join("="))});`).join("\n");
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

contract ${entry.contractName} {
    error InvalidWeb2JsonProof();
    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        string memory requestUrl = proof.data.requestBody.url;
        ProoflineUrlInvariant.requireScheme(requestUrl, ${JSON.stringify(entry.expectedScheme)});
        ProoflineUrlInvariant.requireHost(requestUrl, ${JSON.stringify(entry.expectedHost)});
        ProoflineUrlInvariant.requirePathPrefix(requestUrl, ${JSON.stringify(entry.expectedPathPrefix)});
${queryChecks}
        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) revert InvalidWeb2JsonProof();
        return proof.data.responseBody.abiEncodedData;
    }
}
`;
}

async function readPrivateKey(path) {
  let handle;
  try {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new Error("path");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 32 || stat.size > 68) throw new Error("metadata");
    const raw = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(raw, 0, raw.length, 0);
    if (bytesRead !== raw.length) throw new Error("short read");
    const text = raw.toString("utf8").trim();
    const normalized = raw.length === 32 ? Buffer.from(raw) : /^0x[a-fA-F0-9]{64}$/.test(text) ? Buffer.from(text.slice(2), "hex") : undefined;
    raw.fill(0);
    if (!normalized || normalized.length !== 32) throw new Error("key");
    return normalized;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validCompiled(value, manifestSha256) {
  return value && value.compiler === "solc-0.8.36" && value.manifestSha256 === manifestSha256 &&
    /^sha256:[a-f0-9]{64}$/.test(value.compiledSourceSha256 ?? "") && /^0x[a-fA-F0-9]+$/.test(value.bytecode ?? "") && value.bytecode.length > 4;
}

export async function runProductionSafeConsumerDeployment(input) {
  let privateKeyBytes;
  try {
    if (!input?.compiler?.compileConsumer || !input?.relayer || !input?.publication?.publishCanonicalPair) throw new Error("adapters");
    const completedAt = input.clock?.now?.();
    if (typeof completedAt !== "string" || !Number.isFinite(Date.parse(completedAt))) throw new Error("clock");
    privateKeyBytes = await readPrivateKey(input.relayerPrivateKeyFile);
    const account = await input.relayer.deriveAccount({ privateKeyBytes });
    if (!account || !ADDRESS.test(account.address ?? "") || /^0x0{40}$/.test(account.address)) throw new Error("account");
    const compiled = [];
    for (const entry of builtins) {
      const source = sourceFor(entry);
      const value = await input.compiler.compileConsumer({
        templateId: entry.templateId,
        revision: entry.revision,
        manifestSha256: entry.manifestSha256,
        contractName: entry.contractName,
        source,
        solcVersion: "0.8.36",
        importAuthority: "official-coston2-contract-registry",
      });
      if (!validCompiled(value, entry.manifestSha256)) throw new Error("compiler");
      compiled.push(Object.freeze({ entry, source, value }));
    }
    if (await input.relayer.getChainId() !== 114) throw new Error("chain");
    const estimates = [];
    for (const item of compiled) {
      const estimated = await input.relayer.estimateDeploymentCostWei({ account, bytecode: item.value.bytecode });
      if (!DECIMAL.test(estimated ?? "")) throw new Error("estimate");
      estimates.push(BigInt(estimated));
    }
    const requiredBalance = estimates.reduce((sum, value) => sum + value, 0n);
    const balanceText = await input.relayer.getBalanceWei({ address: account.address });
    if (!DECIMAL.test(balanceText ?? "") || BigInt(balanceText) < requiredBalance) throw new Error("balance");
    const deployments = [];
    for (const item of compiled) {
      const sent = await input.relayer.sendDeployment({
        templateId: item.entry.templateId,
        manifestSha256: item.entry.manifestSha256,
        contractName: item.entry.contractName,
        account,
        bytecode: item.value.bytecode,
      });
      if (!TRANSACTION.test(sent?.transactionHash ?? "")) throw new Error("transaction");
      const receipt = await input.relayer.waitForReceipt({ transactionHash: sent.transactionHash });
      if (receipt?.status !== "success" || receipt.transactionHash !== sent.transactionHash || !DECIMAL.test(receipt.blockNumber ?? "") ||
        !ADDRESS.test(receipt.contractAddress ?? "") || /^0x0{40}$/.test(receipt.contractAddress)) throw new Error("receipt");
      const code = await input.relayer.getCode({ address: receipt.contractAddress });
      if (!/^0x[a-fA-F0-9]+$/.test(code ?? "") || code === "0x") throw new Error("bytecode");
      deployments.push({
        templateId: item.entry.templateId,
        revision: 1,
        manifestSha256: item.entry.manifestSha256,
        consumerAddress: receipt.contractAddress,
        contractName: item.entry.contractName,
        compiledSourceSha256: item.value.compiledSourceSha256,
        bytecodeSha256: sha256(Buffer.from(item.value.bytecode.slice(2), "hex")),
        transactionHash: sent.transactionHash,
        blockNumber: receipt.blockNumber,
        runtimeCodeSha256: sha256(Buffer.from(code.slice(2), "hex")),
      });
    }
    if (deployments[0].consumerAddress.toLowerCase() === deployments[1].consumerAddress.toLowerCase()) throw new Error("duplicate address");
    const registry = {
      version: "1", kind: "safe-consumer-registry", chainId: 114,
      entries: deployments.map(({ templateId, revision, manifestSha256, consumerAddress }) => ({ templateId, revision, manifestSha256, consumerAddress })),
    };
    const deploymentEvidence = SafeConsumerDeploymentEvidenceV1Schema.parse({
      version: "1", kind: "safe-consumer-deployment-evidence", status: "passed", chainId: 114,
      compiler: { name: "solc", version: "0.8.36", importAuthority: "official-coston2-contract-registry" },
      relayer: { address: account.address, balanceBeforeWei: balanceText, requiredBalanceWei: requiredBalance.toString() },
      registrySha256: checksumSafeConsumerRegistry(registry), deployments, completedAt,
    });
    const registryBytes = Buffer.from(canonicalSerializeSafeConsumerRegistry(registry), "utf8");
    const deploymentEvidenceBytes = Buffer.from(canonicalSerializeSafeConsumerDeploymentEvidence(deploymentEvidence), "utf8");
    await input.publication.publishCanonicalPair({
      files: [
        { path: EVIDENCE_PATH, bytes: deploymentEvidenceBytes, mode: 0o400 },
        { path: REGISTRY_PATH, bytes: registryBytes, mode: 0o400 },
      ],
      deploymentEvidenceBytes,
      registryBytes,
      commitMarker: REGISTRY_PATH,
      noReplace: true,
    });
    return Object.freeze({ registry: Object.freeze(registry), deploymentEvidence: Object.freeze(deploymentEvidence) });
  } catch (cause) {
    if (cause?.code === "SAFE_CONSUMER_DEPLOYMENT_INVALID") throw cause;
    throw failure(cause);
  } finally {
    privateKeyBytes?.fill(0);
  }
}
