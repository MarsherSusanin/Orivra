// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeStagingDeploymentEvidence,
} from "@proofline/contracts/publication";

const PUBLICATION_SHA = "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10";
const sha = (digit: string) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const checksumBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const utf8 = (text: string) => new TextEncoder().encode(text);
const canonicalJson = (value: any): string => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;

async function feature(): Promise<Record<string, any>> {
  const path = "../src/production-promotion";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

async function fixtures() {
  const publicationFixture = JSON.parse(await readFile(
    new URL("../../../tests/fixtures/slice029b-publication-evidence.v1.json", import.meta.url), "utf8",
  ));
  const publicationEvidenceBytes = utf8(canonicalJson(publicationFixture));
  expect(checksumBytes(publicationEvidenceBytes)).toBe(PUBLICATION_SHA);
  const publication = PublicationEvidenceV1Schema.parse(publicationFixture);

  // This is an inert schema fixture. It is never written or described as hosted staging evidence.
  const staging = StagingDeploymentEvidenceV1Schema.parse({
    version: "1",
    kind: "digitalocean-staging-deployment-evidence",
    status: "passed",
    verification: "verified",
    stagingClaim: true,
    producer: publication.producer,
    publicationEvidenceSha256: PUBLICATION_SHA,
    frozenReleaseManifestSha256: publication.frozenRelease.frozenReleaseManifestSha256,
    target: {
      provider: "digitalocean",
      environment: "staging",
      deploymentId: "contract-staging-fixture",
      composeProject: "proofline-staging-contract-fixture",
      publicOrigin: "https://staging.invalid",
    },
    run: {
      runId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      completedAt: "2026-08-12T02:00:00Z",
      sshHostKeySha256: sha("a"),
    },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({
      id, remoteRepository, remoteReference, remoteDigest,
    })),
    checks: {
      exactDigestPull: { status: "passed" },
      migration: { migrationManifestSha256: sha("b"), targetVersion: 10, schemaVersion: 10, status: "passed" },
      healthz: { status: "passed" },
      readyz: { status: "passed" },
      workerHeartbeat: { status: "current" },
      hostedBrowserSmoke: { status: "passed" },
      spacesRestore: { restoreEvidenceSha256: sha("c"), status: "passed" },
      liveCoston2: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "passed" },
    },
  });
  const stagingEvidenceBytes = utf8(canonicalSerializeStagingDeploymentEvidence(staging));
  const target = {
    version: "1",
    kind: "digitalocean-production-target",
    provider: "digitalocean",
    environment: "production",
    deploymentId: "orivra-production-primary",
    composeProject: "proofline-production-primary",
    publicOrigin: "https://orivra.xyz",
    dnsName: "orivra.xyz",
    sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("d") },
    ingress: [80, 443],
  };
  const targetBytes = utf8(canonicalJson(target));
  const authorization = {
    version: "1",
    kind: "production-promotion-authorization",
    status: "authorized",
    promote: true,
    publicationEvidenceSha256: PUBLICATION_SHA,
    stagingDeploymentEvidenceSha256: checksumBytes(stagingEvidenceBytes),
    productionTargetSha256: checksumBytes(targetBytes),
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-12T02:10:00Z",
    expiresAt: "2026-08-12T02:40:00Z",
  };
  return {
    publication,
    publicationEvidenceBytes,
    staging,
    stagingEvidenceBytes,
    target,
    targetBytes,
    authorization,
    authorizationBytes: utf8(canonicalJson(authorization)),
  };
}

describe("Slice 029B production authority derivation", () => {
  it("parses exact canonical publication and staging evidence into one private immutable authority", async () => {
    const module = await feature();
    const input = await fixtures();
    const authority = module.verifyProductionPromotionHandoff({
      publicationEvidenceBytes: input.publicationEvidenceBytes,
      expectedPublicationEvidenceSha256: PUBLICATION_SHA,
      stagingDeploymentEvidenceBytes: input.stagingEvidenceBytes,
      expectedStagingDeploymentEvidenceSha256: checksumBytes(input.stagingEvidenceBytes),
      productionTargetBytes: input.targetBytes,
      promotionAuthorizationBytes: input.authorizationBytes,
      now: "2026-08-12T02:20:00Z",
    });
    expect(authority.publicationEvidenceSha256).toBe(PUBLICATION_SHA);
    expect(authority.images.map((image: any) => image.remoteReference)).toEqual(
      input.publication.images.map((image) => image.remoteReference),
    );
    expect(authority.staging.target.environment).toBe("staging");
    expect(authority.target.environment).toBe("production");
    expect(authority.target.composeProject).not.toBe(authority.staging.target.composeProject);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.images[0])).toBe(true);
  });

  it.each([
    ["wrong publication SHA", (value: any) => ({ ...value, expectedPublicationEvidenceSha256: sha("0") })],
    ["noncanonical publication", (value: any) => ({ ...value, publicationEvidenceBytes: utf8(JSON.stringify(value.publication, null, 2)) })],
    ["missing staging", (value: any) => ({ ...value, stagingDeploymentEvidenceBytes: undefined })],
    ["same staging target", (value: any) => ({ ...value, productionTargetBytes: utf8(canonicalJson({ ...value.target, composeProject: value.staging.target.composeProject })) })],
    ["expired authorization", (value: any) => ({ ...value, now: "2026-08-12T03:00:00Z" })],
  ])("rejects %s before production effect", async (_label, mutate) => {
    const module = await feature();
    const value = await fixtures();
    expect(() => module.verifyProductionPromotionHandoff(mutate({
      ...value,
      expectedPublicationEvidenceSha256: PUBLICATION_SHA,
      expectedStagingDeploymentEvidenceSha256: checksumBytes(value.stagingEvidenceBytes),
      productionTargetBytes: value.targetBytes,
      promotionAuthorizationBytes: value.authorizationBytes,
      now: "2026-08-12T02:20:00Z",
    }))).toThrow();
  });

  it("derives exact digest mapping, database-first order and the pre-effect checklist", async () => {
    const module = await feature();
    const value = await fixtures();
    const authority = module.verifyProductionPromotionHandoff({
      publicationEvidenceBytes: value.publicationEvidenceBytes,
      expectedPublicationEvidenceSha256: PUBLICATION_SHA,
      stagingDeploymentEvidenceBytes: value.stagingEvidenceBytes,
      expectedStagingDeploymentEvidenceSha256: checksumBytes(value.stagingEvidenceBytes),
      productionTargetBytes: value.targetBytes,
      promotionAuthorizationBytes: value.authorizationBytes,
      now: "2026-08-12T02:20:00Z",
    });
    const plan = module.createProductionPromotionPlan(authority);
    expect(plan.imageEnvironment).toEqual({
      PROOFLINE_CADDY_IMAGE: value.publication.images[0].remoteReference,
      PROOFLINE_WEB_IMAGE: value.publication.images[1].remoteReference,
      PROOFLINE_API_IMAGE: value.publication.images[2].remoteReference,
      PROOFLINE_WORKER_IMAGE: value.publication.images[3].remoteReference,
      PROOFLINE_POSTGRES_IMAGE: value.publication.images[4].remoteReference,
    });
    expect(plan.startOrder).toEqual([
      "postgres", "db-role-bootstrap", "migrator", "api", "worker", "web", "caddy",
    ]);
    expect(plan.preEffectChecks).toEqual([
      "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files",
      "spaces-authority", "replay-bundle", "safe-consumer", "live-coston2",
    ]);
    expect(plan.publicPorts).toEqual([80, 443]);
    expect(plan.privateHostPorts).toEqual({ api: [], worker: [], postgres: [] });
  });

  it("selects rollback only from prior verified publication/deployment evidence compatible with schema 10", async () => {
    const module = await feature();
    const value = await fixtures();
    const prior = {
      status: "passed",
      verification: "verified",
      productionClaim: true,
      schemaVersion: 10,
      minimumCompatibleVersion: 10,
      maximumCompatibleVersion: 10,
      publicationEvidenceSha256: sha("8"),
      deploymentEvidenceSha256: sha("9"),
      images: value.publication.images.map(({ id, remoteReference }) => ({ id, remoteReference })),
    };
    expect(module.selectSchemaCompatibleRollback({ currentSchemaVersion: 10, prior }).images).toEqual(prior.images);
    for (const invalid of [
      { ...prior, verification: "draft" },
      { ...prior, publicationEvidenceSha256: undefined },
      { ...prior, minimumCompatibleVersion: 11 },
    ]) expect(() => module.selectSchemaCompatibleRollback({ currentSchemaVersion: 10, prior: invalid })).toThrow();
  });
});
