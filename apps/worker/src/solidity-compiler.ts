import solc from "solc";

const web2JsonStub = `pragma solidity ^0.8.25;
interface IWeb2Json {
  struct RequestBody { string url; }
  struct ResponseBody { bytes abiEncodedData; }
  struct Response { RequestBody requestBody; ResponseBody responseBody; }
  struct Proof { Response data; bytes32[] merkleProof; }
}`;

const registryStub = `pragma solidity ^0.8.25;
import {IWeb2Json} from "./IWeb2Json.sol";
interface IFdcVerification { function verifyWeb2Json(IWeb2Json.Proof calldata proof) external view returns (bool); }
library ContractRegistry { function getFdcVerification() internal pure returns (IFdcVerification value) { assembly { value := 1 } } }`;

const invariantStub = `pragma solidity ^0.8.25;
library ProoflineUrlInvariant {
  function requireScheme(string memory, string memory) internal pure {}
  function requireHost(string memory, string memory) internal pure {}
  function requirePathPrefix(string memory, string memory) internal pure {}
  function requireQueryValue(string memory, string memory, string memory) internal pure {}
}`;

export function compileGeneratedConsumer(source: string) {
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "ProoflineSafeWeb2JsonConsumer.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  }), {
    import(path: string) {
      if (path.endsWith("IWeb2Json.sol")) return { contents: web2JsonStub };
      if (path.endsWith("ContractRegistry.sol")) return { contents: registryStub };
      if (path.endsWith("ProoflineUrlInvariant.sol")) return { contents: invariantStub };
      return { error: `Unsupported Solidity import: ${path}` };
    },
  }));
  const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === "error");
  if (errors.length > 0) throw new Error("Generated safe consumer failed Solidity compilation");
  return { compiler: `solc-${solc.version().split("+")[0]}`, compileStatus: "passed" as const };
}
