import solc from "solc";

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

export function compileSafeConsumerSolidity(input: {
  source: string;
  invariantSource: string;
  contractName: string;
}) {
  if (solc.version().split("+")[0] !== "0.8.36") {
    throw new Error("Pinned Solidity compiler is unavailable");
  }
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "ProoflineSafeWeb2JsonConsumer.sol": { content: input.source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "none", appendCBOR: false },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  }), {
    import(path: string) {
      if (path.endsWith("/IWeb2Json.sol")) return { contents: iWeb2Json };
      if (path.endsWith("/ContractRegistry.sol")) return { contents: registry };
      if (path.endsWith("ProoflineUrlInvariant.sol")) return { contents: input.invariantSource };
      return { error: "Unsupported production Solidity import" };
    },
  }));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length > 0) throw new Error("Generated safe consumer failed Solidity compilation");
  const compiled = output.contracts?.["ProoflineSafeWeb2JsonConsumer.sol"]?.[input.contractName]?.evm;
  const bytecode = compiled?.bytecode?.object;
  const runtimeBytecode = compiled?.deployedBytecode?.object;
  if (typeof bytecode !== "string" || bytecode.length === 0) {
    throw new Error("Generated safe consumer bytecode is missing");
  }
  if (typeof runtimeBytecode !== "string" || runtimeBytecode.length === 0) {
    throw new Error("Generated safe consumer runtime bytecode is missing");
  }
  return {
    compiler: "solc-0.8.36" as const,
    bytecode: `0x${bytecode}` as const,
    runtimeBytecode: `0x${runtimeBytecode}` as const,
  };
}
