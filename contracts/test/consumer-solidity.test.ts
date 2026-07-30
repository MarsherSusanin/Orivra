// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const paths = {
  invariant: fileURLToPath(new URL("ProoflineUrlInvariant.sol", root)),
  vulnerable: fileURLToPath(new URL("CanonicalVulnerableWeb2JsonConsumer.sol", root)),
  safe: fileURLToPath(new URL("CanonicalSafeWeb2JsonConsumer.sol", root)),
};

let invariant: string;
let vulnerable: string;
let safe: string;

beforeAll(async () => {
  [invariant, vulnerable, safe] = await Promise.all([
    readFile(paths.invariant, "utf8"),
    readFile(paths.vulnerable, "utf8"),
    readFile(paths.safe, "utf8"),
  ]);
});

const iWeb2JsonStub = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
interface IWeb2Json {
    struct RequestBody { string url; }
    struct ResponseBody { bytes abiEncodedData; }
    struct Response { RequestBody requestBody; ResponseBody responseBody; }
    struct Proof { Response data; bytes32[] merkleProof; }
}
`;

const registryStub = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {IWeb2Json} from "./IWeb2Json.sol";
interface IFdcVerification {
    function verifyWeb2Json(IWeb2Json.Proof calldata proof) external view returns (bool);
}
library ContractRegistry {
    function getFdcVerification() internal pure returns (IFdcVerification result) {
        assembly { result := 1 }
    }
}
`;

function compile(sources: Record<string, string>) {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: Object.fromEntries(
          Object.entries(sources).map(([name, content]) => [name, { content }]),
        ),
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  return output;
}

describe("canonical Web2Json consumer pair", () => {
  it("keeps the vulnerable consumer intentionally proof-only for diagnostic acceptance", () => {
    expect(vulnerable).toContain("verifyWeb2Json");
    expect(vulnerable).not.toMatch(
      /requireScheme|requireHost|requirePathPrefix|requireQueryValue/,
    );
  });

  it("enforces scheme, host, path, and query before accepting the valid proof", () => {
    const checks = [
      safe.indexOf("requireScheme"),
      safe.indexOf("requireHost"),
      safe.indexOf("requirePathPrefix"),
      safe.indexOf("requireQueryValue"),
    ];
    const verification = safe.indexOf("verifyWeb2Json");
    expect(checks.every((index) => index >= 0)).toBe(true);
    expect(checks).toEqual([...checks].sort((a, b) => a - b));
    expect(Math.max(...checks)).toBeLessThan(verification);
    expect(safe).toContain("ContractRegistry.getFdcVerification()");
    expect(safe).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it("compiles invariant library plus vulnerable and safe consumers with Solidity 0.8.25+", () => {
    const output = compile({
      "contracts/ProoflineUrlInvariant.sol": invariant,
      "contracts/CanonicalVulnerableWeb2JsonConsumer.sol": vulnerable,
      "contracts/CanonicalSafeWeb2JsonConsumer.sol": safe,
      "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol":
        iWeb2JsonStub,
      "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol":
        registryStub,
    });
    const errors = (output.errors ?? []).filter(
      (error: { severity: string }) => error.severity === "error",
    );
    expect(errors).toEqual([]);
    expect(
      output.contracts["contracts/CanonicalSafeWeb2JsonConsumer.sol"],
    ).toHaveProperty("CanonicalSafeWeb2JsonConsumer");
  });
});
