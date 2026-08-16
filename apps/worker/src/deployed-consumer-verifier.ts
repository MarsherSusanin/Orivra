import { createHash } from "node:crypto";
import { DeployedConsumerEvidenceV1Schema, type DeployedConsumerEvidenceV1 } from "@proofline/contracts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTECODE = /^0x(?:[0-9a-fA-F]{2})*$/;
const EIP_1167 = /^0x363d3d373d3d3d363d73[0-9a-fA-F]{40}5af43d82803e903d91602b57fd5bf3$/;

function digest(bytecode: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(bytecode.slice(2), "hex")).digest("hex")}`;
}

export function classifyDeployedConsumerObservation(input: {
  runId: string;
  commandId: string;
  chainId?: number;
  address: string;
  observedAt: string;
  blockNumber: string;
  registryAddress: string;
  expectedRegistryAddress?: string;
  observedRuntimeBytecode: string;
  expectedRuntimeBytecode: string;
  sourceSha256: string;
  compilerVersion: string;
}): DeployedConsumerEvidenceV1 {
  if ((input.chainId ?? 114) !== 114) throw new Error("Observed consumer chain must be Coston2 chain 114");
  if (!ADDRESS.test(input.address) || !ADDRESS.test(input.registryAddress)) throw new Error("Observed consumer address authority is invalid");
  if (input.expectedRegistryAddress && input.registryAddress.toLowerCase() !== input.expectedRegistryAddress.toLowerCase()) {
    throw new Error("Observed Coston2 registry authority does not match persisted evidence");
  }
  if (!BYTECODE.test(input.observedRuntimeBytecode) || !BYTECODE.test(input.expectedRuntimeBytecode) || input.expectedRuntimeBytecode === "0x") {
    throw new Error("Observed or expected runtime bytecode is invalid");
  }
  const observedDigest = input.observedRuntimeBytecode === "0x" ? null : digest(input.observedRuntimeBytecode);
  const expectedDigest = digest(input.expectedRuntimeBytecode);
  const status = input.observedRuntimeBytecode === "0x" ? "unavailable" as const :
    EIP_1167.test(input.observedRuntimeBytecode) ? "proxy-unsupported" as const :
      observedDigest === expectedDigest ? "verified" as const : "mismatched" as const;
  const code = status === "unavailable" ? "DEPLOYED_CONSUMER_CODE_UNAVAILABLE" :
    status === "proxy-unsupported" ? "DEPLOYED_CONSUMER_PROXY_UNSUPPORTED" :
      "DEPLOYED_CONSUMER_BYTECODE_MISMATCH";
  return DeployedConsumerEvidenceV1Schema.parse({
    version: "1",
    runId: input.runId,
    commandId: input.commandId,
    chainId: 114,
    address: input.address,
    status,
    observedAt: input.observedAt,
    blockNumber: input.blockNumber,
    registryAddress: input.registryAddress,
    codeSizeBytes: (input.observedRuntimeBytecode.length - 2) / 2,
    observedRuntimeBytecodeSha256: observedDigest,
    expectedRuntimeBytecodeSha256: expectedDigest,
    sourceSha256: input.sourceSha256,
    compilerVersion: input.compilerVersion,
    diagnostics: status === "verified" ? [] : [{
      version: "1",
      code,
      severity: status === "unavailable" ? "warning" : "error",
      confidence: "high",
      summary: status === "unavailable" ? "No deployed runtime bytecode was observed at this Coston2 address." :
        status === "proxy-unsupported" ? "The address contains a minimal proxy, whose implementation authority is not supported." :
          "Observed deployed bytecode does not match the canonical generated consumer.",
      evidence: { address: input.address, blockNumber: input.blockNumber },
      remediation: status === "proxy-unsupported" ? "Verify a directly deployed consumer or add an explicit supported proxy model." :
        "Verify the exact deployment artifact before integration.",
    }],
  });
}
