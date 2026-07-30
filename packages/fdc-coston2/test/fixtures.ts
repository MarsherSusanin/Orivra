import { validManifest } from "../../contracts/test/fixtures";

export const WEB2JSON_BYTES32 =
  "0x576562324a736f6e000000000000000000000000000000000000000000000000";
export const PUBLIC_WEB2_BYTES32 =
  "0x5075626c69635765623200000000000000000000000000000000000000000000";
export const REQUEST_BYTES = "0x1234abcd";
export const FDC_HUB = "0x3333333333333333333333333333333333333333";
export const FDC_VERIFICATION = "0x1111111111111111111111111111111111111111";
export const RELAY = "0x4444444444444444444444444444444444444444";
export const REGISTRY = "0x2222222222222222222222222222222222222222";

export const verifierPayload = {
  attestationType: WEB2JSON_BYTES32,
  sourceId: PUBLIC_WEB2_BYTES32,
  requestBody: {
    url: validManifest.request.url,
    httpMethod: "GET",
    headers: "{}",
    queryParams: JSON.stringify(validManifest.request.query),
    body: "{}",
    postProcessJq: validManifest.request.jq,
    abiSignature: validManifest.request.abiSignature,
  },
};

export const daProofFixture = {
  response_hex: "0x1234",
  attestation_type: "Web2Json",
  proof: [
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ],
};
