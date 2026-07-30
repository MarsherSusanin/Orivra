// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

/// @notice Canonical secure consumer for the repository Web2Json fixture.
contract CanonicalSafeWeb2JsonConsumer {
    error InvalidWeb2JsonProof();

    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        string memory requestUrl = proof.data.requestBody.url;
        ProoflineUrlInvariant.requireScheme(requestUrl, "https");
        ProoflineUrlInvariant.requireHost(requestUrl, "api.example.com");
        ProoflineUrlInvariant.requirePathPrefix(requestUrl, "/prices/");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "currency", "USD");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "source", "primary");

        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) {
            revert InvalidWeb2JsonProof();
        }
        return proof.data.responseBody.abiEncodedData;
    }
}
