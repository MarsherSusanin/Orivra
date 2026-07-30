// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { createVM } from "@ethereumjs/vm";
import solc from "solc";
import { encodeFunctionData, type Abi, type Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";

const invariantPath = fileURLToPath(
  new URL("../ProoflineUrlInvariant.sol", import.meta.url),
);

const harnessSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

contract QueryInvariantHarness {
    function enforce(string calldata requestUrl) external pure returns (bool) {
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "currency", "USD");
        return true;
    }
}
`;

function compileHarness(invariant: string): { abi: Abi; runtime: Hex } {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: {
          "contracts/ProoflineUrlInvariant.sol": { content: invariant },
          "contracts/QueryInvariantHarness.sol": { content: harnessSource },
        },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
          outputSelection: {
            "*": { "*": ["abi", "evm.deployedBytecode.object"] },
          },
        },
      }),
    ),
  );
  const errors = (output.errors ?? []).filter(
    (error: { severity: string }) => error.severity === "error",
  );
  expect(errors).toEqual([]);
  const harness =
    output.contracts["contracts/QueryInvariantHarness.sol"]
      .QueryInvariantHarness;
  return {
    abi: harness.abi,
    runtime: `0x${harness.evm.deployedBytecode.object}`,
  };
}

describe("Slice 007 exact query cardinality in a real offline EVM", () => {
  let abi: Abi;
  let runtime: Uint8Array;
  let vm: Awaited<ReturnType<typeof createVM>>;

  beforeAll(async () => {
    const compiled = compileHarness(await readFile(invariantPath, "utf8"));
    abi = compiled.abi;
    runtime = hexToBytes(compiled.runtime);
    vm = await createVM();
  });

  async function execute(requestUrl: string) {
    const data = encodeFunctionData({
      abi,
      functionName: "enforce",
      args: [requestUrl],
    });
    return vm.evm.runCode({
      code: runtime,
      data: hexToBytes(data),
      gasLimit: 2_000_000n,
      isStatic: true,
      to: createAddressFromString(
        "0x0000000000000000000000000000000000000200",
      ),
    });
  }

  it("accepts exactly one matching expected query pair", async () => {
    const result = await execute(
      "https://api.example.com/prices/eth?currency=USD&source=primary",
    );
    expect(result.exceptionError).toBeUndefined();
    expect(result.returnValue.byteLength).toBeGreaterThan(0);
  });

  it.each([
    "https://api.example.com/prices/eth?currency=USD&currency=EUR",
    "https://api.example.com/prices/eth?currency=EUR&currency=USD",
  ])("rejects an ambiguous duplicate expected query key: %s", async (requestUrl) => {
    const result = await execute(requestUrl);
    expect(result.exceptionError?.error).toBe("revert");
    expect(result.returnValue.byteLength).toBeGreaterThanOrEqual(4);
  });
});
