// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  makeBundleInput,
  validManifest,
} from "../../contracts/test/fixtures";
import { assertPublicIpAddress } from "../../fdc-coston2/src/safe-http";
import {
  canonicalSerializeProofBundle,
  generateSafeWeb2JsonConsumer,
  replayProofBundle,
} from "../src/index";
import { canonicalJson } from "../src/canonical-json";

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedProofHash(response: string): string {
  return `0x${sha256Hex(Buffer.from(response.slice(2), "hex"))}`;
}

function generatedConsumerHash(): string {
  return sha256Hex(
    generateSafeWeb2JsonConsumer(validManifest, {
      contractName: "ProoflineSafeWeb2JsonConsumer",
    }),
  );
}

function completeBundleContent() {
  const content = structuredClone(makeBundleInput());
  content.events[4] = {
    ...content.events[4],
    payload: { proofHash: expectedProofHash(content.proof.response) },
  };
  content.artifacts.safeConsumerSha256 = generatedConsumerHash();
  return content;
}

function checksumValidBytes(content: Record<string, unknown>): string {
  const checksum = `sha256:${sha256Hex(canonicalJson(content))}`;
  return canonicalJson({ ...content, checksum });
}

describe("Slice 005 fail-closed special-use IP policy", () => {
  it.each([
    "2001:2::1", // benchmarking
    "3fff::1", // documentation
    "2001:20::1", // ORCHIDv2
  ])("rejects globally-shaped special-use IPv6 address %s", (address) => {
    expect(() => assertPublicIpAddress(address)).toThrow(/public|SSRF|address/i);
  });

  it.each([
    "2001:db8::1",
    "2001:10::1",
    "2001::1",
    "64:ff9b::1",
    "2002:7f00:1::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("continues to reject representative reserved range %s", (address) => {
    expect(() => assertPublicIpAddress(address)).toThrow(/public|SSRF|address/i);
  });

  it("keeps native public IPv6 eligible", () => {
    expect(assertPublicIpAddress("2606:4700:4700::1111")).toBe(
      "2606:4700:4700::1111",
    );
  });
});

describe("Slice 005 canonical and evidence-complete replay", () => {
  it("rejects noncanonical pretty bytes even when their embedded checksum is valid", () => {
    const canonical = checksumValidBytes(completeBundleContent());
    const pretty = JSON.stringify(JSON.parse(canonical), null, 2);

    expect(() => replayProofBundle(pretty)).toThrow(/canonical|byte/i);
  });

  it("rejects a checksum-valid PROOF_AVAILABLE hash mismatch", () => {
    const content = completeBundleContent();
    content.events[4] = {
      ...content.events[4],
      payload: { proofHash: `0x${"b".repeat(64)}` },
    };

    expect(() => replayProofBundle(checksumValidBytes(content))).toThrow(
      /proof.*hash|PROOF_AVAILABLE/i,
    );
  });

  it("rejects missing or mismatched generated safe-consumer evidence", () => {
    const missing = completeBundleContent() as Record<string, any>;
    delete missing.artifacts.safeConsumerSha256;
    expect(() => replayProofBundle(checksumValidBytes(missing))).toThrow(
      /safe.*consumer|safeConsumer|artifact|evidence/i,
    );

    const mismatch = completeBundleContent();
    mismatch.artifacts.safeConsumerSha256 = "c".repeat(64);
    expect(() => replayProofBundle(checksumValidBytes(mismatch))).toThrow(
      /safe.*consumer|artifact|evidence/i,
    );
  });

  it("keeps canonical complete bytes replayable byte-for-byte", () => {
    const serialized = checksumValidBytes(completeBundleContent());
    const replayed = replayProofBundle(serialized);
    expect(canonicalSerializeProofBundle(replayed)).toBe(serialized);
  });

  it("does not report byteIdentical through a hardcoded production literal", async () => {
    const source = await readFile(
      new URL("../../../apps/api/src/production-service.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/byteIdentical\s*:\s*true\b/);
    expect(source).toMatch(/canonicalSerializeProofBundle|canonicalJson/);
  });
});

describe("Slice 005 generated URL query canonicalization", () => {
  it("compares the same encoded values emitted by URLSearchParams", () => {
    const manifest = {
      ...validManifest,
      consumer: {
        ...validManifest.consumer,
        expectedQuery: {
          phrase: "hello world",
          symbols: "a+b&c",
        },
      },
    };
    const generated = generateSafeWeb2JsonConsumer(manifest, {
      contractName: "EncodedQueryConsumer",
    });
    const encoded = new URLSearchParams(manifest.consumer.expectedQuery);

    expect(encoded.toString()).toBe("phrase=hello+world&symbols=a%2Bb%26c");
    expect(generated).toContain(
      'requireQueryValue(requestUrl, "phrase", "hello+world")',
    );
    expect(generated).toContain(
      'requireQueryValue(requestUrl, "symbols", "a%2Bb%26c")',
    );
    expect(generated).not.toContain(
      'requireQueryValue(requestUrl, "phrase", "hello world")',
    );
  });
});
