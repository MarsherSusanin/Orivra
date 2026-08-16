import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSafeConsumerSolidity } from "./safe-consumer-solidity-authority";

const invariantSource = readFileSync(
  resolve(process.cwd(), "contracts/ProoflineUrlInvariant.sol"),
  "utf8",
);

export function compileGeneratedConsumer(source: string) {
  const contractName = /contract\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(source)?.[1];
  if (!contractName) throw new Error("Generated safe consumer contract name is missing");
  const compiled = compileSafeConsumerSolidity({ source, invariantSource, contractName });
  const compiledSourceSha256 = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  return {
    compiler: compiled.compiler,
    compileStatus: "passed" as const,
    compiledSourceSha256,
    runtimeBytecode: compiled.runtimeBytecode,
    runtimeBytecodeSha256: `sha256:${createHash("sha256").update(Buffer.from(compiled.runtimeBytecode.slice(2), "hex")).digest("hex")}`,
  };
}
