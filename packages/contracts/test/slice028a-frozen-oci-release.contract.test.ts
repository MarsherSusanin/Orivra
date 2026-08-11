// @vitest-environment node

import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const releaseFeature = fileURLToPath(new URL("../src/release.ts", import.meta.url));
const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const commit = (value: string) => value.repeat(40).slice(0, 40);

const imageInputs = [
  ["caddy", "proofline/caddy", "images/01-caddy.linux-amd64.oci.tar", "1"],
  ["web", "proofline/web", "images/02-web.linux-amd64.oci.tar", "2"],
  ["api", "proofline/api", "images/03-api.linux-amd64.oci.tar", "3"],
  ["worker", "proofline/worker", "images/04-worker.linux-amd64.oci.tar", "4"],
  [
    "postgres-recovery",
    "proofline/postgres-recovery",
    "images/05-postgres-recovery.linux-amd64.oci.tar",
    "5",
  ],
] as const;

const manifest = {
  version: "1",
  kind: "frozen-oci-release-manifest",
  producer: {
    commitSha: commit("a"),
    treeSha: commit("b"),
    sourceSnapshotSha256: sha("c"),
    sourceDateEpoch: 1_754_870_400,
    verification: "verified",
    releaseClaim: true,
  },
  database: {
    migrationManifestPath: "apps/api/db/migrations/manifest.v1.json",
    migrationManifestSha256: sha("d"),
    targetVersion: 10,
    minimumCompatibleVersion: 10,
    maximumCompatibleVersion: 10,
  },
  action: {
    metadataPath: "packages/action/action.yml",
    metadataSha256: sha("e"),
    artifactPath: "packages/action/dist/index.js",
    artifactSha256: sha("f"),
  },
  recovery: {
    walGVersion: "v3.0.8",
    walGReleaseLockPath: "docker/wal-g-release.v1.json",
    walGReleaseLockSha256: sha("6"),
    walGReceiptSha256: sha("7"),
    walGBinarySha256: sha("8"),
  },
  images: imageInputs.map(([id, repository, archiveFilename, digit], index) => {
    const imageManifestDigest = sha(digit);
    return {
      id,
      repository,
      reference: `${repository}@${imageManifestDigest}`,
      platform: "linux/amd64",
      archiveFilename,
      archiveFormat: "oci-image-layout-v1.0.0+ustar",
      archiveSizeBytes: 1024 + index,
      archiveSha256: sha(index === 4 ? "0" : String(9 - index)),
      imageManifestDigest,
    };
  }),
};

const artifacts = [
  {
    filename: "frozen-release-manifest.v1.json",
    sizeBytes: 4096,
    sha256: sha("a"),
  },
  ...manifest.images.map((image) => ({
    filename: image.archiveFilename,
    sizeBytes: image.archiveSizeBytes,
    sha256: image.archiveSha256,
  })),
];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

type ReleaseArtifact = { filename: string; sizeBytes: number; sha256: string };

function inventoryChecksum(value: ReadonlyArray<ReleaseArtifact>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

const receipt = {
  version: "1",
  kind: "frozen-oci-release-receipt",
  status: "passed",
  verification: "verified",
  releaseClaim: true,
  producer: {
    commitSha: manifest.producer.commitSha,
    treeSha: manifest.producer.treeSha,
  },
  frozenReleaseManifestSha256: artifacts[0].sha256,
  artifacts,
  artifactInventorySha256: inventoryChecksum(artifacts),
};

function receiptWithArtifacts(candidateArtifacts: ReadonlyArray<ReleaseArtifact>) {
  return {
    ...receipt,
    artifacts: candidateArtifacts,
    artifactInventorySha256: inventoryChecksum(candidateArtifacts),
  };
}

async function optionalReleaseModule(): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ `${pathToFileURL(releaseFeature).href}?red=028a`)
    .catch(() => ({}));
}

describe("Slice 028A frozen OCI release contracts", () => {
  it("exports the exact cycle-free release feature runtime", async () => {
    const module = await optionalReleaseModule();
    expect(Object.keys(module).sort()).toEqual([
      "FrozenOciReleaseManifestV1Schema",
      "FrozenOciReleaseReceiptV1Schema",
      "canonicalSerializeFrozenOciReleaseManifest",
      "canonicalSerializeFrozenOciReleaseReceipt",
      "checksumFrozenOciReleaseManifest",
      "checksumReleaseArtifactInventory",
    ].sort());
  });

  it("accepts only the exact five-image manifest and preserves tuple order", async () => {
    const module = await optionalReleaseModule();
    const parsed = module.FrozenOciReleaseManifestV1Schema.parse(manifest);
    expect(parsed).toEqual(manifest);
    expect(parsed.images.map((image: any) => image.id)).toEqual(
      imageInputs.map(([id]) => id),
    );
    expect(parsed.images.map((image: any) => image.repository)).toEqual(
      imageInputs.map(([, repository]) => repository),
    );
  });

  it("keeps archive bytes distinct from immutable image-manifest identity", async () => {
    const module = await optionalReleaseModule();
    const parsed = module.FrozenOciReleaseManifestV1Schema.parse(manifest);
    for (const image of parsed.images) {
      expect(image.archiveSha256).not.toBe(image.imageManifestDigest);
      expect(image.reference).toBe(`${image.repository}@${image.imageManifestDigest}`);
    }
  });

  it.each([
    ["unknown root field", { ...manifest, extra: true }],
    ["dirty producer", { ...manifest, producer: { ...manifest.producer, verification: "draft" } }],
    ["same commit and tree", { ...manifest, producer: { ...manifest.producer, treeSha: manifest.producer.commitSha } }],
    ["reordered images", { ...manifest, images: [manifest.images[1], manifest.images[0], ...manifest.images.slice(2)] }],
    ["mutable reference", { ...manifest, images: manifest.images.map((image, index) => index === 0 ? { ...image, reference: `${image.repository}:latest` } : image) }],
    ["archive digest reused as manifest digest", { ...manifest, images: manifest.images.map((image, index) => index === 0 ? { ...image, imageManifestDigest: image.archiveSha256, reference: `${image.repository}@${image.archiveSha256}` } : image) }],
    ["widened schema range", { ...manifest, database: { ...manifest.database, minimumCompatibleVersion: 9 } }],
  ])("rejects %s", async (_label, candidate) => {
    const module = await optionalReleaseModule();
    expect(module.FrozenOciReleaseManifestV1Schema?.parse).toBeTypeOf("function");
    expect(() => module.FrozenOciReleaseManifestV1Schema.parse(candidate)).toThrow();
  });

  it("serializes and checksums the manifest as exact canonical UTF-8", async () => {
    const module = await optionalReleaseModule();
    expect(module.canonicalSerializeFrozenOciReleaseManifest(manifest)).toBe(
      canonicalJson(manifest),
    );
    expect(module.checksumFrozenOciReleaseManifest(manifest)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("accepts one non-circular receipt whose inventory excludes itself", async () => {
    const module = await optionalReleaseModule();
    expect(module.FrozenOciReleaseReceiptV1Schema.parse(receipt)).toEqual(receipt);
    expect(receipt.artifacts.map((artifact) => artifact.filename)).not.toContain(
      "frozen-release-receipt.v1.json",
    );
    expect(module.checksumReleaseArtifactInventory(receipt.artifacts)).toBe(
      receipt.artifactInventorySha256,
    );
    expect(module.canonicalSerializeFrozenOciReleaseReceipt(receipt)).toBe(
      canonicalJson(receipt),
    );
  });

  it.each([
    ["unknown receipt field", { ...receipt, extra: true }],
    ["receipt self-reference", receiptWithArtifacts([...receipt.artifacts, { filename: "frozen-release-receipt.v1.json", sizeBytes: 1, sha256: sha("1") }])],
    ["unsorted inventory", receiptWithArtifacts([receipt.artifacts[1], receipt.artifacts[0], ...receipt.artifacts.slice(2)])],
    ["missing archive", receiptWithArtifacts(receipt.artifacts.slice(0, -1))],
    ["manifest checksum not bound to its inventory entry", { ...receipt, frozenReleaseManifestSha256: sha("0") }],
  ])("rejects %s before handoff", async (_label, candidate) => {
    const module = await optionalReleaseModule();
    expect(module.FrozenOciReleaseReceiptV1Schema?.parse).toBeTypeOf("function");
    expect(() => module.FrozenOciReleaseReceiptV1Schema.parse(candidate)).toThrow();
  });
});
