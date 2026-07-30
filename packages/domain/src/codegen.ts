import {
  Web2JsonManifestV1Schema,
  type Web2JsonManifestV1,
} from "@proofline/contracts";

export interface SafeConsumerOptions {
  contractName: string;
}

function solidityString(value: string): string {
  return JSON.stringify(value);
}

function urlSearchParamPair(key: string, value: string): [string, string] {
  const encoded = new URLSearchParams([[key, value]]).toString();
  const separator = encoded.indexOf("=");
  return [encoded.slice(0, separator), encoded.slice(separator + 1)];
}

export function generateSafeWeb2JsonConsumer(
  manifestValue: Web2JsonManifestV1,
  options: SafeConsumerOptions,
): string {
  const manifest = Web2JsonManifestV1Schema.parse(manifestValue);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.contractName)) {
    throw new Error("Contract name must be a safe Solidity identifier");
  }

  const queryChecks = Object.entries(manifest.consumer.expectedQuery)
    .map(([key, value]) => {
      const [encodedKey, encodedValue] = urlSearchParamPair(key, value);
      return `        ProoflineUrlInvariant.requireQueryValue(requestUrl, ${solidityString(encodedKey)}, ${solidityString(encodedValue)});`;
    })
    .join("\n");

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

contract ${options.contractName} {
    string private constant EXPECTED_SCHEME = ${solidityString(manifest.consumer.expectedScheme)};
    string private constant EXPECTED_HOST = ${solidityString(manifest.consumer.expectedHost.toLowerCase().replace(/\.+$/, ""))};
    string private constant EXPECTED_PATH_PREFIX = ${solidityString(manifest.consumer.expectedPathPrefix)};

    error InvalidWeb2JsonProof();

    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        string memory requestUrl = proof.data.requestBody.url;
        ProoflineUrlInvariant.requireScheme(requestUrl, EXPECTED_SCHEME);
        ProoflineUrlInvariant.requireHost(requestUrl, EXPECTED_HOST);
        ProoflineUrlInvariant.requirePathPrefix(requestUrl, EXPECTED_PATH_PREFIX);
${queryChecks}

        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) {
            revert InvalidWeb2JsonProof();
        }

        return proof.data.responseBody.abiEncodedData;
    }
}
`;
}
