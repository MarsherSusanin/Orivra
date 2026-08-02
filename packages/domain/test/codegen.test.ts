// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  generateSafeWeb2JsonConsumer,
  replayProofBundle,
} from "../src/index";
import {
  exactTrustManifest,
  makeBundleInput,
  validManifest,
} from "../../contracts/test/fixtures";

const goldenPath = fileURLToPath(
  new URL("./fixtures/ProoflineSafeWeb2JsonConsumer.golden.sol", import.meta.url),
);

function compareCodePointSequences(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

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

  it("generates byte-identical consumer evidence regardless of query insertion order", () => {
    const currencyFirst = {
      ...exactTrustManifest,
      consumer: {
        ...exactTrustManifest.consumer,
        expectedQuery: {
          currency: "USD",
          source: "primary",
          window: "1h",
        },
      },
    };
    const sourceFirst = {
      ...exactTrustManifest,
      consumer: {
        ...exactTrustManifest.consumer,
        expectedQuery: {
          window: "1h",
          source: "primary",
          currency: "USD",
        },
      },
    };
    const contractName = "ProoflineSafeWeb2JsonConsumer";
    const currencyFirstSource = generateSafeWeb2JsonConsumer(currencyFirst, {
      contractName,
    });
    const sourceFirstSource = generateSafeWeb2JsonConsumer(sourceFirst, {
      contractName,
    });
    const canonicalKeys = Object.keys(currencyFirst.consumer.expectedQuery).sort(
      compareCodePointSequences,
    );

    expect(canonicalKeys).toEqual(["currency", "source", "window"]);
    expect(
      canonicalKeys.map((key) =>
        currencyFirstSource.indexOf(`requireQueryValue(requestUrl, "${key}"`),
      ),
    ).toEqual(
      canonicalKeys
        .map((key) =>
          currencyFirstSource.indexOf(`requireQueryValue(requestUrl, "${key}"`),
        )
        .sort((left, right) => left - right),
    );
    expect(sourceFirstSource).toBe(currencyFirstSource);

    const currencyFirstSha256 = createHash("sha256")
      .update(currencyFirstSource)
      .digest("hex");
    const sourceFirstSha256 = createHash("sha256")
      .update(sourceFirstSource)
      .digest("hex");
    expect(sourceFirstSha256).toBe(currencyFirstSha256);

    const bundles = [currencyFirst, sourceFirst].map((manifest) => {
      const input = structuredClone(makeBundleInput());
      input.manifest = manifest;
      input.events[0] = {
        ...input.events[0],
        payload: { manifest },
      };
      return createProofBundle(input);
    });
    expect(bundles[1].artifacts.safeConsumerSha256).toBe(
      bundles[0].artifacts.safeConsumerSha256,
    );
    expect(bundles[0].artifacts.safeConsumerSha256).toBe(currencyFirstSha256);
    for (const bundle of bundles) {
      const serialized = canonicalSerializeProofBundle(bundle);
      expect(() => replayProofBundle(serialized)).not.toThrow();
    }
  });
});
