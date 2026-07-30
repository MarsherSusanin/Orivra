// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createVM } from "@ethereumjs/vm";
import { createAddressFromString, hexToBytes } from "@ethereumjs/util";
import solc from "solc";
import { encodeFunctionData, type Abi, type Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import { generateSafeWeb2JsonConsumer } from "../../packages/domain/src/codegen";

const invariantPath = fileURLToPath(
  new URL("../ProoflineUrlInvariant.sol", import.meta.url),
);
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
    function getFdcVerification() internal pure returns (IFdcVerification) {
        return IFdcVerification(address(0x100));
    }
}
`;

const verifierStub = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
contract MockFdcVerification is IFdcVerification {
    function verifyWeb2Json(
        IWeb2Json.Proof calldata proof
    ) external pure returns (bool) {
        return proof.merkleProof.length == 1 &&
            proof.merkleProof[0] == bytes32(uint256(1));
    }
}
`;

function compileRuntime(invariant: string): {
  consumerAbi: Abi;
  consumerRuntime: Hex;
  verifierRuntime: Hex;
} {
  const generated = generateSafeWeb2JsonConsumer(validManifest, {
    contractName: "GeneratedBehaviorConsumer",
  });
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: {
          "contracts/ProoflineUrlInvariant.sol": { content: invariant },
          "contracts/GeneratedBehaviorConsumer.sol": {
            content: generated,
          },
          "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol": {
            content: iWeb2JsonStub,
          },
          "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol":
            { content: registryStub },
          "contracts/MockFdcVerification.sol": { content: verifierStub },
        },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
          outputSelection: {
            "*": {
              "*": ["abi", "evm.deployedBytecode.object"],
            },
          },
        },
      }),
    ),
  );
  const errors = (output.errors ?? []).filter(
    (error: { severity: string }) => error.severity === "error",
  );
  expect(errors).toEqual([]);

  const consumer =
    output.contracts["contracts/GeneratedBehaviorConsumer.sol"]
      .GeneratedBehaviorConsumer;
  const verifier =
    output.contracts["contracts/MockFdcVerification.sol"].MockFdcVerification;
  expect(consumer.evm.deployedBytecode.object).toMatch(/^[0-9a-f]+$/i);
  expect(verifier.evm.deployedBytecode.object).toMatch(/^[0-9a-f]+$/i);
  return {
    consumerAbi: consumer.abi,
    consumerRuntime: `0x${consumer.evm.deployedBytecode.object}`,
    verifierRuntime: `0x${verifier.evm.deployedBytecode.object}`,
  };
}

describe("generated consumer invariants execute in a real offline EVM", () => {
  let consumerAbi: Abi;
  let consumerRuntime: Uint8Array;
  let vm: Awaited<ReturnType<typeof createVM>>;

  beforeAll(async () => {
    const invariant = await readFile(invariantPath, "utf8");
    const compiled = compileRuntime(invariant);
    consumerAbi = compiled.consumerAbi;
    consumerRuntime = hexToBytes(compiled.consumerRuntime);
    vm = await createVM();
    await vm.stateManager.putCode(
      createAddressFromString("0x0000000000000000000000000000000000000100"),
      hexToBytes(compiled.verifierRuntime),
    );
  });

  async function execute(requestUrl: string, proofValid: boolean) {
    const data = encodeFunctionData({
      abi: consumerAbi,
      functionName: "consume",
      args: [
        {
          data: {
            requestBody: { url: requestUrl },
            responseBody: { abiEncodedData: "0x50524f4f464c494e45" },
          },
          merkleProof: proofValid
            ? [`0x${"0".repeat(63)}1`]
            : [],
        },
      ],
    });
    return vm.evm.runCode({
      code: consumerRuntime,
      data: hexToBytes(data),
      gasLimit: 10_000_000n,
      isStatic: true,
      to: createAddressFromString(
        "0x0000000000000000000000000000000000000200",
      ),
    });
  }

  it("accepts the exact trusted URL only when proof verification succeeds", async () => {
    const result = await execute(
      "https://api.example.com/prices/eth?currency=USD&source=primary",
      true,
    );

    expect(result.exceptionError).toBeUndefined();
    expect(result.returnValue.byteLength).toBeGreaterThan(0);
  });

  it.each([
    [
      "wrong scheme",
      "http://api.example.com/prices/eth?currency=USD&source=primary",
      true,
    ],
    [
      "wrong host",
      "https://attacker.example/prices/eth?currency=USD&source=primary",
      true,
    ],
    [
      "wrong path",
      "https://api.example.com/admin/eth?currency=USD&source=primary",
      true,
    ],
    [
      "wrong query",
      "https://api.example.com/prices/eth?currency=EUR&source=primary",
      true,
    ],
    [
      "invalid proof",
      "https://api.example.com/prices/eth?currency=USD&source=primary",
      false,
    ],
  ])("reverts for %s", async (_case, requestUrl, proofValid) => {
    const result = await execute(requestUrl, proofValid);
    expect(result.exceptionError?.error).toBe("revert");
    expect(result.returnValue.byteLength).toBeGreaterThanOrEqual(4);
  });
});
