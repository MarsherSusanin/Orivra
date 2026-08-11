// @vitest-environment node

import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const featurePath = fileURLToPath(new URL("../src/oci-release.ts", import.meta.url));
const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function bytes(value: unknown): Uint8Array {
  return encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
}

function fixture() {
  const configuration = bytes({ architecture: "amd64", os: "linux" });
  const layer = bytes("release-layer");
  const manifest = bytes({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: sha256(configuration),
      size: configuration.byteLength,
    },
    layers: [{
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: sha256(layer),
      size: layer.byteLength,
    }],
  });
  const imageManifestDigest = sha256(manifest);
  const index = bytes({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: imageManifestDigest,
      size: manifest.byteLength,
      platform: { architecture: "amd64", os: "linux" },
    }],
  });
  return {
    index,
    imageManifestDigest,
    blobs: new Map([
      [imageManifestDigest, manifest],
      [sha256(configuration), configuration],
      [sha256(layer), layer],
    ]),
  };
}

async function optionalModule(): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ `${pathToFileURL(featurePath).href}?red=028a`)
    .catch(() => ({}));
}

describe("Slice 028A pure OCI release derivation", () => {
  it("exports only the exact deterministic release operations", async () => {
    const module = await optionalModule();
    expect(Object.keys(module).sort()).toEqual([
      "createFrozenOciReleaseManifest",
      "createFrozenOciReleaseReceipt",
      "deriveCanonicalOciArchiveEntries",
      "inspectSinglePlatformOciLayout",
      "verifyFrozenOciReleaseHandoff",
    ].sort());
  });

  it("selects the exact single Linux/amd64 image manifest by raw digest", async () => {
    const module = await optionalModule();
    const input = fixture();
    expect(module.inspectSinglePlatformOciLayout(input)).toEqual({
      imageManifestDigest: input.imageManifestDigest,
      platform: "linux/amd64",
      reachableBlobDigests: [...input.blobs.keys()].sort(),
    });
  });

  it.each([
    ["ambiguous descriptor", (input: ReturnType<typeof fixture>) => {
      const index = JSON.parse(new TextDecoder().decode(input.index));
      index.manifests.push(index.manifests[0]);
      input.index = bytes(index);
    }],
    ["attestation instead of image", (input: ReturnType<typeof fixture>) => {
      const index = JSON.parse(new TextDecoder().decode(input.index));
      index.manifests[0].mediaType = "application/vnd.in-toto+json";
      input.index = bytes(index);
    }],
    ["wrong platform", (input: ReturnType<typeof fixture>) => {
      const index = JSON.parse(new TextDecoder().decode(input.index));
      index.manifests[0].platform.architecture = "arm64";
      input.index = bytes(index);
    }],
    ["manifest digest mismatch", (input: ReturnType<typeof fixture>) => {
      const manifest = input.blobs.get(input.imageManifestDigest)!;
      input.blobs.set(input.imageManifestDigest, bytes(`${new TextDecoder().decode(manifest)} `));
    }],
    ["unreferenced blob", (input: ReturnType<typeof fixture>) => {
      input.blobs.set(`sha256:${"f".repeat(64)}`, bytes("extra"));
    }],
  ])("rejects %s", async (_label, mutate) => {
    const module = await optionalModule();
    const input = fixture();
    mutate(input);
    expect(module.inspectSinglePlatformOciLayout).toBeTypeOf("function");
    expect(() => module.inspectSinglePlatformOciLayout(input)).toThrow();
  });

  it("derives byte-sorted canonical archive entries with fixed metadata", async () => {
    const module = await optionalModule();
    const input = fixture();
    const entries = module.deriveCanonicalOciArchiveEntries(input);
    expect(entries.map((entry: any) => entry.path)).toEqual(
      [...entries.map((entry: any) => entry.path)].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right))),
    );
    expect(entries.map((entry: any) => [entry.uid, entry.gid, entry.mtime, entry.mode]))
      .toEqual(entries.map(() => [0, 0, 0, 0o644]));
    expect(entries.map((entry: any) => entry.path)).toEqual([
      ...[...input.blobs.keys()].map((digest) => `blobs/sha256/${digest.slice(7)}`),
      "index.json",
      "oci-layout",
    ].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));
  });

  it("defensively copies archive bytes before returning immutable entries", async () => {
    const module = await optionalModule();
    const input = fixture();
    const entries = module.deriveCanonicalOciArchiveEntries(input);
    const indexEntry = entries.find((entry: any) => entry.path === "index.json");
    const first = indexEntry.bytes[0];
    input.index[0] ^= 0xff;
    expect(indexEntry.bytes[0]).toBe(first);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(indexEntry)).toBe(true);
  });

  it("creates and verifies a non-circular manifest handoff from exact bytes", async () => {
    const module = await optionalModule();
    const producer = { commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
    const manifestBytes = bytes({
      version: "1",
      kind: "frozen-oci-release-manifest",
      producer,
    });
    const archives = [
      { filename: "images/01-caddy.linux-amd64.oci.tar", bytes: bytes("archive") },
    ];
    const receipt = module.createFrozenOciReleaseReceipt({
      producer,
      manifestBytes,
      archives,
    });
    expect(receipt.frozenReleaseManifestSha256).toBe(sha256(manifestBytes));
    expect(receipt.artifacts.map((entry: any) => entry.filename)).not.toContain(
      "frozen-release-receipt.v1.json",
    );
    expect(module.verifyFrozenOciReleaseHandoff({
      manifestBytes,
      receipt,
      expectedProducer: producer,
      artifacts: new Map([
        ["frozen-release-manifest.v1.json", manifestBytes],
        [archives[0].filename, archives[0].bytes],
      ]),
    })).toBe(true);
  });

  it("rejects one changed archive without accepting manifest identity as archive identity", async () => {
    const module = await optionalModule();
    const producer = { commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
    const manifestBytes = bytes({
      version: "1",
      kind: "frozen-oci-release-manifest",
      producer,
    });
    const archives = [{ filename: "images/01-caddy.linux-amd64.oci.tar", bytes: bytes("archive") }];
    const receipt = module.createFrozenOciReleaseReceipt({
      producer,
      manifestBytes,
      archives,
    });
    expect(() => module.verifyFrozenOciReleaseHandoff({
      manifestBytes,
      receipt,
      expectedProducer: producer,
      artifacts: new Map([
        ["frozen-release-manifest.v1.json", manifestBytes],
        [archives[0].filename, bytes("changed")],
      ]),
    })).toThrow();
  });

  it("rejects a receipt producer that is not the independently expected source", async () => {
    const module = await optionalModule();
    const producer = { commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
    const manifestBytes = bytes({
      version: "1",
      kind: "frozen-oci-release-manifest",
      producer,
    });
    const archives = [{
      filename: "images/01-caddy.linux-amd64.oci.tar",
      bytes: bytes("archive"),
    }];
    const receipt = module.createFrozenOciReleaseReceipt({
      producer,
      manifestBytes,
      archives,
    });
    expect(() => module.verifyFrozenOciReleaseHandoff({
      manifestBytes,
      receipt,
      expectedProducer: { ...producer, treeSha: "c".repeat(40) },
      artifacts: new Map([
        ["frozen-release-manifest.v1.json", manifestBytes],
        [archives[0].filename, archives[0].bytes],
      ]),
    })).toThrow();
  });
});
