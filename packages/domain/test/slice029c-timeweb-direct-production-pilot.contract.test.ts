// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PUBLICATION_SHA = "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10";
const sha = (digit: string) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const canonicalJson = (value: any): string => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const utf8 = (value: any) => new TextEncoder().encode(canonicalJson(value));
const checksum = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function feature(): Promise<Record<string, any>> {
  const path = "../src/production-promotion";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

async function fixture(transform: (publication: any) => any = (publication) => publication) {
  const historical = JSON.parse(await readFile(
    new URL("../../../tests/fixtures/slice029b-publication-evidence.v1.json", import.meta.url), "utf8",
  ));
  const publication = transform(structuredClone(historical));
  const publicationEvidenceBytes = utf8(publication);
  const publicationEvidenceSha256 = checksum(publicationEvidenceBytes);
  const objectStore = {
    version: "1", kind: "timeweb-s3-pilot-authority", provider: "timeweb-s3",
    endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet",
    pathStyle: true, authorityMode: "shared-pilot", credentialDelivery: "secret-files",
    qaProvider: "minio-only", swiftRuntime: false,
  };
  const target = {
    version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
    deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
    publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
    sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("1") }, ingress: [80, 443], objectStore,
  };
  const objectStoreBytes = utf8(objectStore);
  const targetBytes = utf8(target);
  const authorization = {
    version: "2", kind: "production-promotion-authorization", status: "authorized", promote: true,
    deploymentMode: "direct-pilot", publicationEvidenceSha256,
    productionTargetSha256: checksum(targetBytes), objectStoreAuthoritySha256: checksum(objectStoreBytes),
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
  };
  return { publication, publicationEvidenceBytes, publicationEvidenceSha256, objectStore, objectStoreBytes, target, targetBytes, authorization, authorizationBytes: utf8(authorization) };
}

const input = (value: any) => ({
  publicationEvidenceBytes: value.publicationEvidenceBytes,
  expectedPublicationEvidenceSha256: value.publicationEvidenceSha256,
  productionTargetBytes: value.targetBytes,
  expectedProductionTargetSha256: checksum(value.targetBytes),
  objectStoreAuthorityBytes: value.objectStoreBytes,
  expectedObjectStoreAuthoritySha256: checksum(value.objectStoreBytes),
  promotionAuthorizationBytes: value.authorizationBytes,
  expectedPromotionAuthorizationSha256: checksum(value.authorizationBytes),
  now: "2026-08-12T02:20:00Z",
});

describe("Slice 029C direct-production pilot authority", () => {
  it("derives one private direct-pilot authority without retaining staging input", async () => {
    const module = await feature();
    const value = await fixture();
    const authority = module.verifyDirectProductionPilotHandoff(input(value));
    expect(value.publicationEvidenceSha256).toBe(PUBLICATION_SHA);
    expect(authority.publicationEvidenceSha256).toBe(value.publicationEvidenceSha256);
    expect(authority.target.deploymentMode).toBe("direct-pilot");
    expect(authority.objectStore).toEqual(value.objectStore);
    expect(authority).not.toHaveProperty("staging");
    expect(authority.authorization).not.toHaveProperty("stagingDeploymentEvidenceSha256");
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.images[0])).toBe(true);
  });

  it("cross-binds a newly published five-image set and rejects historical publication authority", async () => {
    const module = await feature();
    const value = await fixture((publication) => ({
      ...publication,
      producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) },
      images: publication.images.map((image: any, index: number) => {
        const remoteDigest = sha(String.fromCharCode(97 + index));
        return { ...image, imageManifestDigest: remoteDigest, remoteDigest, remoteReference: `${image.remoteRepository}@${remoteDigest}` };
      }),
    }));
    expect(value.publicationEvidenceSha256).not.toBe(PUBLICATION_SHA);
    const authority = module.verifyDirectProductionPilotHandoff(input(value));
    expect(authority.images.map((image: any) => image.remoteReference)).toEqual(
      value.publication.images.map((image: any) => image.remoteReference),
    );
    expect(authority.images.map((image: any) => image.remoteReference)).not.toEqual(
      (await fixture()).publication.images.map((image: any) => image.remoteReference),
    );
    const historicalAuthorization = { ...value.authorization, publicationEvidenceSha256: PUBLICATION_SHA };
    const historicalAuthorizationBytes = utf8(historicalAuthorization);
    expect(() => module.verifyDirectProductionPilotHandoff({
      ...input(value),
      promotionAuthorizationBytes: historicalAuthorizationBytes,
      expectedPromotionAuthorizationSha256: checksum(historicalAuthorizationBytes),
    })).toThrow();
  });

  it("plans exact five digests, typed preflights and one deterministic two-consumer deployer before worker", async () => {
    const module = await feature();
    const value = await fixture();
    const authority = module.verifyDirectProductionPilotHandoff(input(value));
    const plan = module.createDirectProductionPilotPlan(authority);
    expect(plan.imageEnvironment).toEqual({
      PROOFLINE_CADDY_IMAGE: value.publication.images[0].remoteReference,
      PROOFLINE_WEB_IMAGE: value.publication.images[1].remoteReference,
      PROOFLINE_API_IMAGE: value.publication.images[2].remoteReference,
      PROOFLINE_WORKER_IMAGE: value.publication.images[3].remoteReference,
      PROOFLINE_POSTGRES_IMAGE: value.publication.images[4].remoteReference,
    });
    expect(plan.startOrder).toEqual([
      "postgres", "db-role-bootstrap", "migrator", "api", "safe-consumer-deployer",
      "write-safe-consumer-registry", "worker", "web", "caddy-candidate",
    ]);
    expect(plan.safeConsumerManifestOrder).toEqual([
      ["open-meteo-current-weather", "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8"],
      ["eth-usd", "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db"],
    ]);
    expect(plan.safeConsumerRegistryFile).toBe("/opt/orivra/evidence/safe-consumer-registry.v1.json");
    expect(plan.preEffectChecks).toEqual([
      "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files", "timeweb-s3-authority",
      "replay-bundle", "safe-consumer-manifests", "live-coston2",
    ]);
    expect(plan.publicPorts).toEqual([80, 443]);
    expect(plan.privateHostPorts).toEqual({ api: [], worker: [], postgres: [] });
  });

  it("rejects staging, noncanonical bytes, checksum substitution and expired direct authority before planning", async () => {
    const module = await feature();
    const value = await fixture();
    const stagingAuthorizationBytes = utf8({ ...value.authorization, stagingDeploymentEvidenceSha256: sha("9") });
    for (const invalid of [
      { ...input(value), stagingDeploymentEvidenceBytes: utf8({ status: "passed" }) },
      { ...input(value), promotionAuthorizationBytes: stagingAuthorizationBytes, expectedPromotionAuthorizationSha256: checksum(stagingAuthorizationBytes) },
      { ...input(value), publicationEvidenceBytes: new TextEncoder().encode(JSON.stringify(value.publication, null, 2)) },
      { ...input(value), expectedProductionTargetSha256: sha("0") },
      { ...input(value), expectedObjectStoreAuthoritySha256: sha("0") },
      { ...input(value), now: "2026-08-12T02:40:00Z" },
    ]) expect(() => module.verifyDirectProductionPilotHandoff(invalid)).toThrow();
  });
});
