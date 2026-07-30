// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSafeWeb2JsonConsumer } from "../src/index";
import { validManifest } from "../../contracts/test/fixtures";

const goldenPath = fileURLToPath(
  new URL("./fixtures/ProoflineSafeWeb2JsonConsumer.golden.sol", import.meta.url),
);

describe("safe Web2Json consumer code generation", () => {
  it("matches the reviewed Solidity golden file byte-for-byte", () => {
    const generated = generateSafeWeb2JsonConsumer(validManifest, {
      contractName: "ProoflineSafeWeb2JsonConsumer",
    });
    expect(generated).toBe(readFileSync(goldenPath, "utf8"));
  });

  it("enforces URL invariants before invoking FdcVerification", () => {
    const generated = generateSafeWeb2JsonConsumer(validManifest, {
      contractName: "ProoflineSafeWeb2JsonConsumer",
    });
    const scheme = generated.indexOf("requireScheme(requestUrl, EXPECTED_SCHEME)");
    const host = generated.indexOf("requireHost(requestUrl, EXPECTED_HOST)");
    const path = generated.indexOf("requirePathPrefix(requestUrl, EXPECTED_PATH_PREFIX)");
    const query = generated.indexOf('requireQueryValue(requestUrl, "currency", "USD")');
    const proof = generated.indexOf("verifyWeb2Json(proof)");

    expect(scheme).toBeGreaterThan(-1);
    expect(host).toBeGreaterThan(scheme);
    expect(path).toBeGreaterThan(host);
    expect(query).toBeGreaterThan(path);
    expect(proof).toBeGreaterThan(query);
    expect(generated).not.toContain("0x1111111111111111111111111111111111111111");
    expect(generated).toContain("ContractRegistry.getFdcVerification()");
  });

  it("rejects unsafe Solidity identifiers instead of interpolating them", () => {
    expect(() =>
      generateSafeWeb2JsonConsumer(validManifest, {
        contractName: "Consumer { selfdestruct(payable(msg.sender)); }",
      }),
    ).toThrow(/contract name/i);
  });
});
