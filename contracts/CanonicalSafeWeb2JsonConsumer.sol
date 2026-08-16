// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ProoflineUrlInvariant} from "./ProoflineUrlInvariant.sol";

/// @notice Canonical secure consumer for the Open-Meteo current-weather template.
contract CanonicalSafeWeb2JsonConsumer {
    error InvalidWeb2JsonProof();

    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        string memory requestUrl = proof.data.requestBody.url;
        ProoflineUrlInvariant.requireScheme(requestUrl, "https");
        ProoflineUrlInvariant.requireHost(requestUrl, "api.open-meteo.com");
        ProoflineUrlInvariant.requirePath(requestUrl, "/v1/forecast");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "current", "temperature_2m");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "forecast_days", "1");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "latitude", "52.52");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "longitude", "13.41");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "temperature_unit", "celsius");
        ProoflineUrlInvariant.requireQueryValue(requestUrl, "timezone", "UTC");

        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) {
            revert InvalidWeb2JsonProof();
        }
        return proof.data.responseBody.abiEncodedData;
    }
}
