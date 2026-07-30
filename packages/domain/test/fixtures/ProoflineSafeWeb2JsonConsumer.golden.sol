// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

contract ProoflineSafeWeb2JsonConsumer {
    string private constant EXPECTED_SCHEME = "https";
    string private constant EXPECTED_HOST = "api.example.com";
    string private constant EXPECTED_PATH_PREFIX = "/prices/";

    error InvalidWeb2JsonProof();

    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        string memory requestUrl = proof.data.requestBody.url;
        ProoflineUrlInvariant.requireScheme(requestUrl, EXPECTED_SCHEME);
        ProoflineUrlInvariant.requireHost(requestUrl, EXPECTED_HOST);
        ProoflineUrlInvariant.requirePathPrefix(requestUrl, EXPECTED_PATH_PREFIX);
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "currency", "USD");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "source", "primary");

        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) {
            revert InvalidWeb2JsonProof();
        }

        return proof.data.responseBody.abiEncodedData;
    }
}
