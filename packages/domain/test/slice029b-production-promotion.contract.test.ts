// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
} from "@proofline/contracts/publication";
import {
  ApplicationRollbackAuthorizationV1Schema,
  ProductionDeploymentEvidenceV1Schema,
  canonicalSerializeProductionDeploymentEvidence,
} from "@proofline/contracts/production-promotion";

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

function rollbackFixtures(publication: any) {
  const currentPublicationBytes = utf8(canonicalSerializePublicationEvidence(publication));
  const priorPublication = PublicationEvidenceV1Schema.parse({
    ...publication,
    runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H5",
    publishedAt: "2026-08-01T00:00:00Z",
    frozenRelease: { ...publication.frozenRelease, frozenReleaseManifestSha256: sha("6") },
    images: publication.images.map((image: any, index: number) => {
      const remoteDigest = sha(String(9 - index));
      return {
        ...image,
        archiveSha256: sha(String.fromCharCode(97 + index)),
        imageManifestDigest: remoteDigest,
        remoteDigest,
        remoteReference: `${image.remoteRepository}@${remoteDigest}`,
      };
    }),
  });
  const priorPublicationBytes = utf8(canonicalSerializePublicationEvidence(priorPublication));
  const deployment = (source: any, sourceBytes: Uint8Array, prior: boolean) => ProductionDeploymentEvidenceV1Schema.parse({
    version: "1",
    kind: "digitalocean-production-deployment-evidence",
    status: "passed",
    verification: "verified",
    productionClaim: true,
    producer: source.producer,
    publicationEvidenceSha256: checksumBytes(sourceBytes),
    stagingDeploymentEvidenceSha256: sha(prior ? "7" : "8"),
    frozenReleaseManifestSha256: source.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: sha(prior ? "9" : "0"),
    target: {
      version: "1",
      kind: "digitalocean-production-target",
      provider: "digitalocean",
      environment: "production",
      deploymentId: prior ? "orivra-production-previous" : "orivra-production-primary",
      composeProject: prior ? "proofline-production-previous" : "proofline-production-primary",
      publicOrigin: prior ? "https://previous.orivra.xyz" : "https://orivra.xyz",
      dnsName: prior ? "previous.orivra.xyz" : "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha(prior ? "a" : "b") },
      ingress: [80, 443],
    },
    run: {
      runId: prior ? "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H5" : "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      completedAt: prior ? "2026-08-01T01:00:00Z" : "2026-08-12T03:00:00Z",
    },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: source.images.map(({ id, remoteRepository, remoteReference, remoteDigest }: any) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
    database: { volumeIdentitySha256: sha(prior ? "c" : "d"), migrationManifestSha256: sha("e"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
    checks: { exactDigestPull: { status: "passed" }, healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" }, spacesPitr: { restoreEvidenceSha256: sha("f"), status: "passed" }, liveCoston2: { runId: prior ? "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5" : "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "persisted" } },
  });
  const currentDeployment = deployment(publication, currentPublicationBytes, false);
  const priorDeployment = deployment(priorPublication, priorPublicationBytes, true);
  const currentDeploymentBytes = utf8(canonicalSerializeProductionDeploymentEvidence(currentDeployment));
  const priorDeploymentBytes = utf8(canonicalSerializeProductionDeploymentEvidence(priorDeployment));
  const authorization = ApplicationRollbackAuthorizationV1Schema.parse({
    version: "1", kind: "application-rollback-authorization", status: "authorized", rollback: true,
    currentProductionDeploymentEvidenceSha256: checksumBytes(currentDeploymentBytes),
    priorProductionDeploymentEvidenceSha256: checksumBytes(priorDeploymentBytes),
    priorPublicationEvidenceSha256: checksumBytes(priorPublicationBytes),
    currentSchemaVersion: 10, priorMinimumCompatibleVersion: 10, priorMaximumCompatibleVersion: 10,
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-19T03:10:00Z", expiresAt: "2026-08-19T03:40:00Z",
  });
  const authorizationBytes = utf8(canonicalJson(authorization));
  return {
    authorization, authorizationBytes,
    currentPublication: publication, currentPublicationBytes,
    priorPublication, priorPublicationBytes,
    currentDeployment, currentDeploymentBytes,
    priorDeployment, priorDeploymentBytes,
  };
}

const rollbackInput = (value: any) => ({
  rollbackAuthorizationBytes: value.authorizationBytes,
  expectedRollbackAuthorizationSha256: checksumBytes(value.authorizationBytes),
  currentProductionDeploymentEvidenceBytes: value.currentDeploymentBytes,
  expectedCurrentProductionDeploymentEvidenceSha256: checksumBytes(value.currentDeploymentBytes),
  currentPublicationEvidenceBytes: value.currentPublicationBytes,
  expectedCurrentPublicationEvidenceSha256: checksumBytes(value.currentPublicationBytes),
  priorProductionDeploymentEvidenceBytes: value.priorDeploymentBytes,
  expectedPriorProductionDeploymentEvidenceSha256: checksumBytes(value.priorDeploymentBytes),
  priorPublicationEvidenceBytes: value.priorPublicationBytes,
  expectedPriorPublicationEvidenceSha256: checksumBytes(value.priorPublicationBytes),
  now: "2026-08-19T03:20:00Z",
});

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
    ["malformed publication", (value: any) => ({ ...value, publicationEvidenceBytes: utf8("{") })],
    ["missing staging", (value: any) => ({ ...value, stagingDeploymentEvidenceBytes: undefined })],
    ["wrong staging SHA", (value: any) => ({ ...value, expectedStagingDeploymentEvidenceSha256: sha("0") })],
    ["same staging target", (value: any) => ({ ...value, productionTargetBytes: utf8(canonicalJson({ ...value.target, composeProject: value.staging.target.composeProject })) })],
    ["expired authorization", (value: any) => ({ ...value, now: "2026-08-12T03:00:00Z" })],
    ["invalid clock", (value: any) => ({ ...value, now: "not-a-time" })],
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

  it("rejects a schema-valid production target that aliases the staging origin", async () => {
    const module = await feature();
    const value = await fixtures();
    const target = { ...value.target, publicOrigin: value.staging.target.publicOrigin, dnsName: "staging.invalid" };
    const targetBytes = utf8(canonicalJson(target));
    const authorization = {
      ...value.authorization,
      productionTargetSha256: checksumBytes(targetBytes),
    };
    expect(() => module.verifyProductionPromotionHandoff({
      publicationEvidenceBytes: value.publicationEvidenceBytes,
      expectedPublicationEvidenceSha256: PUBLICATION_SHA,
      stagingDeploymentEvidenceBytes: value.stagingEvidenceBytes,
      expectedStagingDeploymentEvidenceSha256: checksumBytes(value.stagingEvidenceBytes),
      productionTargetBytes: targetBytes,
      promotionAuthorizationBytes: utf8(canonicalJson(authorization)),
      now: "2026-08-12T02:20:00Z",
    })).toThrow();
  });

  it("rejects non-authority values before planning", async () => {
    const module = await feature();
    expect(() => module.createProductionPromotionPlan({ images: [] })).toThrow();
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

  it("derives one private immutable rollback authority from five canonical byte handoffs", async () => {
    const module = await feature();
    const value = rollbackFixtures((await fixtures()).publication);
    const authority = module.selectSchemaCompatibleRollback(rollbackInput(value));
    expect(authority.authorization.operatorId).toBe(value.authorization.operatorId);
    expect(authority.currentDeployment).toEqual(value.currentDeployment);
    expect(authority.priorDeployment).toEqual(value.priorDeployment);
    expect(authority.priorPublication).toEqual(value.priorPublication);
    expect(authority.images).toEqual(value.priorPublication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }: any) => ({
      id, remoteRepository, remoteReference, remoteDigest,
    })));
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.images[0])).toBe(true);
  });

  it("rejects object-only, noncanonical, expired, unbound and mutable rollback inputs", async () => {
    const module = await feature();
    const value = rollbackFixtures((await fixtures()).publication);
    const input = rollbackInput(value);
    const encoded = (entry: any) => utf8(canonicalJson(entry));
    const withAuthorization = (authorization: any) => {
      const rollbackAuthorizationBytes = encoded(authorization);
      return { ...input, rollbackAuthorizationBytes, expectedRollbackAuthorizationSha256: checksumBytes(rollbackAuthorizationBytes) };
    };
    const forgedPublication = {
      ...value.priorPublication,
      images: value.priorPublication.images.map((image: any, index: number) => index === 0 ? {
        ...image,
        imageManifestDigest: sha("4"), remoteDigest: sha("4"),
        remoteReference: `${image.remoteRepository}@${sha("4")}`,
      } : image),
    };
    const forgedPublicationBytes = encoded(forgedPublication);
    const latestDeployment = {
      ...value.priorDeployment,
      images: value.priorDeployment.images.map((image: any, index: number) => index === 0
        ? { ...image, remoteReference: `${image.remoteRepository}:latest` }
        : image),
    };
    const latestDeploymentBytes = encoded(latestDeployment);
    const reorderedDeploymentBytes = encoded({
      ...value.priorDeployment,
      images: [...value.priorDeployment.images].reverse(),
    });
    const invalidInputs = [
      {
        currentSchemaVersion: 10,
        prior: {
          status: "passed", verification: "verified", productionClaim: true,
          schemaVersion: 10, minimumCompatibleVersion: 10, maximumCompatibleVersion: 10,
          publicationEvidenceSha256: sha("8"), deploymentEvidenceSha256: sha("9"),
          images: value.priorPublication.images.map(({ id, remoteRepository }: any) => ({ id, remoteReference: `${remoteRepository}:latest` })),
        },
      },
      { ...input, rollbackAuthorizationBytes: utf8(JSON.stringify(value.authorization, null, 2)) },
      { ...input, expectedRollbackAuthorizationSha256: sha("0") },
      { ...input, now: "2026-08-19T03:40:01Z" },
      { ...input, priorPublicationEvidenceBytes: forgedPublicationBytes, expectedPriorPublicationEvidenceSha256: checksumBytes(forgedPublicationBytes) },
      { ...input, priorProductionDeploymentEvidenceBytes: latestDeploymentBytes, expectedPriorProductionDeploymentEvidenceSha256: checksumBytes(latestDeploymentBytes) },
      { ...input, priorProductionDeploymentEvidenceBytes: reorderedDeploymentBytes, expectedPriorProductionDeploymentEvidenceSha256: checksumBytes(reorderedDeploymentBytes) },
      withAuthorization({ ...value.authorization, priorPublicationEvidenceSha256: sha("0") }),
      withAuthorization({ ...value.authorization, operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H5" }),
      withAuthorization({ ...value.authorization, priorMinimumCompatibleVersion: 11 }),
    ];
    for (const invalid of invalidInputs) expect(() => module.selectSchemaCompatibleRollback(invalid)).toThrow();
  });
});
