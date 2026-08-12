// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PublicationEvidenceV1Schema } from "../src/publication";

const PUBLICATION_SHA = "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10";
const sha = (digit: string) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const canonicalJson = (value: any): string => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const checksum = (value: any) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

async function feature(): Promise<Record<string, any>> {
  const path = "../src/production-promotion";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

async function exactPublication() {
  const fixture = JSON.parse(await readFile(new URL("../../../tests/fixtures/slice029b-publication-evidence.v1.json", import.meta.url), "utf8"));
  const bytes = Buffer.from(canonicalJson(fixture), "utf8");
  expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(PUBLICATION_SHA);
  const value = PublicationEvidenceV1Schema.parse(fixture);
  expect(bytes.toString("utf8")).toBe(canonicalJson(value));
  return { bytes, value };
}

const productionTarget = {
  version: "1",
  kind: "digitalocean-production-target",
  provider: "digitalocean",
  environment: "production",
  deploymentId: "orivra-production-primary",
  composeProject: "proofline-production-primary",
  publicOrigin: "https://orivra.xyz",
  dnsName: "orivra.xyz",
  sshEndpoint: {
    host: "72.56.81.28",
    port: 22,
    hostKeySha256: sha("a"),
  },
  ingress: [80, 443],
};

const promotionAuthorization = {
  version: "1",
  kind: "production-promotion-authorization",
  status: "authorized",
  promote: true,
  publicationEvidenceSha256: PUBLICATION_SHA,
  stagingDeploymentEvidenceSha256: sha("b"),
  productionTargetSha256: checksum(productionTarget),
  operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
  authorizedAt: "2026-08-12T02:00:00Z",
  expiresAt: "2026-08-12T02:30:00Z",
};

function productionEvidence(publication: any) {
  return {
    version: "1",
    kind: "digitalocean-production-deployment-evidence",
    status: "passed",
    verification: "verified",
    productionClaim: true,
    producer: publication.producer,
    publicationEvidenceSha256: PUBLICATION_SHA,
    stagingDeploymentEvidenceSha256: promotionAuthorization.stagingDeploymentEvidenceSha256,
    frozenReleaseManifestSha256: publication.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: checksum(promotionAuthorization),
    target: productionTarget,
    run: {
      runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: promotionAuthorization.operatorId,
      completedAt: "2026-08-12T03:00:00Z",
    },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }: any) => ({
      id, remoteRepository, remoteReference, remoteDigest,
    })),
    topology: {
      publicService: "caddy",
      publicPorts: [80, 443],
      privateServices: ["web", "api", "worker", "postgres"],
      forbiddenPublicPorts: [5432, 8080],
      dockerSocketMounted: false,
    },
    database: {
      volumeIdentitySha256: sha("c"),
      migrationManifestSha256: sha("d"),
      targetVersion: 10,
      schemaVersion: 10,
      roleBootstrap: { status: "passed" },
      migration: { status: "passed" },
    },
    checks: {
      exactDigestPull: { status: "passed" },
      healthz: { status: "passed" },
      readyz: { status: "passed" },
      workerHeartbeat: { status: "current" },
      spacesPitr: { restoreEvidenceSha256: sha("e"), status: "passed" },
      liveCoston2: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "persisted" },
    },
  };
}

function promotionEvidence(deploymentEvidence: any) {
  const startedAt = "2026-08-12T03:05:00Z";
  const completedAt = "2026-08-19T03:05:00Z";
  return {
    version: "1",
    kind: "digitalocean-production-promotion-evidence",
    status: "passed",
    verification: "verified",
    promotionClaim: true,
    producer: deploymentEvidence.producer,
    publicationEvidenceSha256: PUBLICATION_SHA,
    productionDeploymentEvidenceSha256: checksum(deploymentEvidence),
    runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    operatorId: promotionAuthorization.operatorId,
    startedAt,
    completedAt,
    canary: {
      durationSeconds: 604800,
      checkpoints: [
        ["pre-cutover", "2026-08-12T03:05:00Z"],
        ["post-cutover-15m", "2026-08-12T03:20:00Z"],
        ["post-cutover-1h", "2026-08-12T04:05:00Z"],
        ["post-cutover-24h", "2026-08-13T03:05:00Z"],
        ["post-cutover-72h", "2026-08-15T03:05:00Z"],
        ["post-cutover-7d", completedAt],
      ].map(([id, observedAt]) => ({ id, observedAt, status: "passed" })),
    },
  };
}

describe("Slice 029B production promotion contracts", () => {
  it("exports one cycle-free production promotion feature through root identity", async () => {
    const [module, root] = await Promise.all([feature(), import("../src/index")]);
    const names = [
      "ProductionTargetV1Schema",
      "ProductionPromotionAuthorizationV1Schema",
      "ProductionDeploymentEvidenceV1Schema",
      "ProductionPromotionEvidenceV1Schema",
      "ApplicationRollbackAuthorizationV1Schema",
      "canonicalSerializeProductionTarget",
      "canonicalSerializeProductionPromotionAuthorization",
      "canonicalSerializeProductionDeploymentEvidence",
      "canonicalSerializeProductionPromotionEvidence",
      "checksumProductionTarget",
      "checksumProductionPromotionAuthorization",
      "checksumProductionDeploymentEvidence",
      "checksumProductionPromotionEvidence",
    ];
    expect(Object.keys(module).sort()).toEqual(names.sort());
    for (const name of names) expect(root[name]).toBe(module[name]);
  });

  it("binds authorization to the exact published bytes, staging evidence and a production-only target", async () => {
    const module = await feature();
    await exactPublication();
    expect(module.ProductionTargetV1Schema.parse(productionTarget)).toEqual(productionTarget);
    expect(module.ProductionPromotionAuthorizationV1Schema.parse(promotionAuthorization)).toEqual(promotionAuthorization);
    expect(module.checksumProductionTarget(productionTarget)).toBe(checksum(productionTarget));
    expect(module.checksumProductionPromotionAuthorization(promotionAuthorization)).toBe(checksum(promotionAuthorization));
    expect(module.canonicalSerializeProductionTarget(productionTarget)).toBe(canonicalJson(productionTarget));
    expect(module.canonicalSerializeProductionPromotionAuthorization(promotionAuthorization)).toBe(canonicalJson(promotionAuthorization));
  });

  it("accepts exact production deployment and terminal seven-day canary evidence", async () => {
    const module = await feature();
    const { value: publication } = await exactPublication();
    const deployment = productionEvidence(publication);
    const promotion = promotionEvidence(deployment);
    expect(module.ProductionDeploymentEvidenceV1Schema.parse(deployment)).toEqual(deployment);
    expect(module.ProductionPromotionEvidenceV1Schema.parse(promotion)).toEqual(promotion);
    expect(module.canonicalSerializeProductionDeploymentEvidence(deployment)).toBe(canonicalJson(deployment));
    expect(module.checksumProductionDeploymentEvidence(deployment)).toBe(checksum(deployment));
    expect(module.canonicalSerializeProductionPromotionEvidence(promotion)).toBe(canonicalJson(promotion));
    expect(module.checksumProductionPromotionEvidence(promotion)).toBe(checksum(promotion));
    expect(promotion.canary.checkpoints.at(-1)).toEqual({
      id: "post-cutover-7d", observedAt: promotion.completedAt, status: "passed",
    });
  });

  it("rejects noncanonical production origins and nonterminal canary intervals", async () => {
    const module = await feature();
    const { value: publication } = await exactPublication();
    for (const publicOrigin of ["https://user@orivra.xyz", "https://orivra.xyz/path", "not a url"]) {
      expect(() => module.ProductionTargetV1Schema.parse({ ...productionTarget, publicOrigin })).toThrow();
    }
    const deployment = productionEvidence(publication);
    const promotion = promotionEvidence(deployment);
    expect(() => module.ProductionPromotionEvidenceV1Schema.parse({
      ...promotion,
      completedAt: "2026-08-19T03:04:59Z",
    })).toThrow();
  });

  it.each([
    ["staging target", { ...productionTarget, environment: "staging" }],
    ["staging project", { ...productionTarget, composeProject: "proofline-staging-primary" }],
    ["public database port", { ...productionTarget, ingress: [80, 443, 5432] }],
    ["mutable image", (publication: any) => ({ ...productionEvidence(publication), images: productionEvidence(publication).images.map((image: any, index: number) => index === 0 ? { ...image, remoteReference: `${image.remoteRepository}:latest` } : image) })],
    ["missing PITR", (publication: any) => ({ ...productionEvidence(publication), checks: { ...productionEvidence(publication).checks, spacesPitr: undefined } })],
  ])("rejects %s without broadening production authority", async (_label, value) => {
    const module = await feature();
    const { value: publication } = await exactPublication();
    const candidate = typeof value === "function" ? value(publication) : value;
    const schema = typeof value === "function" ? module.ProductionDeploymentEvidenceV1Schema : module.ProductionTargetV1Schema;
    expect(() => schema.parse(candidate)).toThrow();
  });

  it("keeps rollback a separate schema-compatible authorization", async () => {
    const module = await feature();
    const rollback = {
      version: "1",
      kind: "application-rollback-authorization",
      status: "authorized",
      rollback: true,
      currentProductionDeploymentEvidenceSha256: sha("1"),
      priorProductionDeploymentEvidenceSha256: sha("2"),
      priorPublicationEvidenceSha256: sha("3"),
      currentSchemaVersion: 10,
      priorMinimumCompatibleVersion: 10,
      priorMaximumCompatibleVersion: 10,
      operatorId: promotionAuthorization.operatorId,
      authorizedAt: "2026-08-19T03:10:00Z",
      expiresAt: "2026-08-19T03:40:00Z",
    };
    expect(module.ApplicationRollbackAuthorizationV1Schema.parse(rollback)).toEqual(rollback);
    expect(() => module.ApplicationRollbackAuthorizationV1Schema.parse({
      ...rollback, priorMinimumCompatibleVersion: 11,
    })).toThrow();
  });
});
