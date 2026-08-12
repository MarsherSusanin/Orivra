import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeStagingDeploymentEvidence,
} from "../../packages/contracts/src/publication-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLICATION_SHA = "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10";
const sha = (digit) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const bytes = (value) => Buffer.from(canonicalJson(value), "utf8");

async function runtime() {
  return import("../../scripts/digitalocean-production-promotion-runtime.mjs").catch(() => ({}));
}

async function fixtures() {
  const publicationFixture = JSON.parse(await readFile(resolve(root, "tests/fixtures/slice029b-publication-evidence.v1.json"), "utf8"));
  const publicationEvidenceBytes = bytes(publicationFixture);
  assert.equal(digest(publicationEvidenceBytes), PUBLICATION_SHA);
  const publication = PublicationEvidenceV1Schema.parse(publicationFixture);
  // Schema-valid inert fixture only; it is not written as hosted staging evidence.
  const staging = StagingDeploymentEvidenceV1Schema.parse({
    version: "1", kind: "digitalocean-staging-deployment-evidence", status: "passed",
    verification: "verified", stagingClaim: true, producer: publication.producer,
    publicationEvidenceSha256: PUBLICATION_SHA,
    frozenReleaseManifestSha256: publication.frozenRelease.frozenReleaseManifestSha256,
    target: { provider: "digitalocean", environment: "staging", deploymentId: "contract-staging-fixture", composeProject: "proofline-staging-contract-fixture", publicOrigin: "https://staging.invalid" },
    run: { runId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T02:00:00Z", sshHostKeySha256: sha("a") },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    checks: {
      exactDigestPull: { status: "passed" },
      migration: { migrationManifestSha256: sha("b"), targetVersion: 10, schemaVersion: 10, status: "passed" },
      healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" }, hostedBrowserSmoke: { status: "passed" },
      spacesRestore: { restoreEvidenceSha256: sha("c"), status: "passed" },
      liveCoston2: { runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "passed" },
    },
  });
  const stagingDeploymentEvidenceBytes = Buffer.from(canonicalSerializeStagingDeploymentEvidence(staging), "utf8");
  const target = {
    version: "1", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
    deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
    publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
    sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("d") }, ingress: [80, 443],
  };
  const authorization = {
    version: "1", kind: "production-promotion-authorization", status: "authorized", promote: true,
    publicationEvidenceSha256: PUBLICATION_SHA,
    stagingDeploymentEvidenceSha256: digest(stagingDeploymentEvidenceBytes),
    productionTargetSha256: digest(bytes(target)),
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
  };
  return { publication, publicationEvidenceBytes, staging, stagingDeploymentEvidenceBytes, target, authorization };
}

const productionFiles = Object.freeze({
  doApiTokenFile: "/private/credentials/digitalocean-token",
  ghcrPullTokenFile: "/private/credentials/ghcr-read-token",
  sshPrivateKeyFile: "/private/credentials/orivra-production-ssh",
  productionSecretRoot: "/opt/orivra/secrets",
  replayBundleFile: "/opt/orivra/evidence/replay/proof-bundle.json",
  replayPreflightReportFile: "/opt/orivra/evidence/replay/preflight-report.json",
  backupEvidenceFile: "/opt/orivra/evidence/recovery/backup-evidence.v1.json",
});

function commonInput(value) {
  return {
    publicationEvidenceBytes: value.publicationEvidenceBytes,
    expectedPublicationEvidenceSha256: PUBLICATION_SHA,
    stagingDeploymentEvidenceBytes: value.stagingDeploymentEvidenceBytes,
    expectedStagingDeploymentEvidenceSha256: digest(value.stagingDeploymentEvidenceBytes),
    productionTargetBytes: bytes(value.target),
    promotionAuthorizationBytes: bytes(value.authorization),
    runBytes: bytes({ runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: value.authorization.operatorId, completedAt: "2026-08-12T03:00:00Z" }),
    fileInputs: productionFiles,
    now: "2026-08-12T02:20:00Z",
  };
}

test("029B requires the exact publication checkpoint and real canonical staging evidence before any effect", async () => {
  const module = await runtime();
  const value = await fixtures();
  for (const delta of [
    { stagingDeploymentEvidenceBytes: undefined },
    { expectedPublicationEvidenceSha256: sha("0") },
    { publicationEvidenceBytes: Buffer.from(JSON.stringify(value.publication, null, 2)) },
    { stagingDeploymentEvidenceBytes: Buffer.from(JSON.stringify(value.staging, null, 2)) },
  ]) {
    let effects = 0;
    await assert.rejects(module.runDigitalOceanProductionPromotion({
      ...commonInput(value), ...delta,
      productionAdapter: { provision: async () => { effects += 1; } },
      appendProductionEvidence: async () => { effects += 1; },
      appendPromotionEvidence: async () => { effects += 1; },
    }), /PRODUCTION_PROMOTION_INPUT_INVALID|Production promotion input is invalid/);
    assert.equal(effects, 0);
  }
});

test("production preflight validates distinct target, DNS, pinned SSH, read-only GHCR and every file authority before provisioning", async () => {
  const module = await runtime();
  const value = await fixtures();
  const base = commonInput(value);
  const required = [
    "dns-target", "ssh-host-key", "read-only-ghcr", "secret-files", "spaces-authority",
    "replay-bundle", "safe-consumer", "live-coston2",
  ];
  for (const missing of required) {
    let effects = 0;
    await assert.rejects(module.runDigitalOceanProductionPromotion({
      ...base,
      preflightAdapter: { verify: async (name) => name === missing ? { status: "failed" } : { status: "passed" } },
      inspectFile: async () => ({ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, mode: 0o100400, size: 32 }),
      productionAdapter: { provision: async () => { effects += 1; } },
    }), /PRODUCTION_PREFLIGHT_FAILED|Production preflight failed/);
    assert.equal(effects, 0, `${missing} must fail before provisioning`);
  }
});

test("database-first production uses five exact digests and appends deployment then terminal seven-day evidence", async () => {
  const module = await runtime();
  const value = await fixtures();
  const commands = [];
  const appends = [];
  const session = {
    observedHostKeySha256: value.target.sshEndpoint.hostKeySha256,
    run: async (command) => {
      commands.push(command);
      if (command.id === "inspect-local-digests") return { status: "passed", images: value.publication.images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) };
      if (command.id === "migrator") return { status: "passed", migrationManifestSha256: sha("b"), targetVersion: 10, schemaVersion: 10 };
      if (command.id === "readyz-real-heartbeat") return { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current" } };
      if (command.id === "spaces-pitr-production") return { status: "passed", restoreEvidenceSha256: sha("c"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 };
      if (command.id === "persisted-live-coston2") return { status: "passed", runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", persisted: true };
      if (command.id.startsWith("canary-")) return { status: "passed", observedAt: command.observedAt };
      return { status: "passed" };
    },
    close: async () => commands.push({ id: "close-session" }),
  };
  const result = await module.runDigitalOceanProductionPromotion({
    ...commonInput(value),
    preflightAdapter: { verify: async () => ({ status: "passed" }) },
    inspectFile: async (path) => ({ isFile: () => path !== productionFiles.productionSecretRoot, isDirectory: () => path === productionFiles.productionSecretRoot, isSymbolicLink: () => false, mode: path === productionFiles.productionSecretRoot ? 0o40500 : 0o100400, size: 32 }),
    productionAdapter: {
      provision: async () => ({ owned: true, deploymentId: "orivra-production-primary", sshHost: "72.56.81.28" }),
      applyFirewall: async ({ ingress }) => assert.deepEqual(ingress, [80, 443]),
    },
    sshAdapter: { openPinnedSession: async () => session },
    appendProductionEvidence: async (entry) => appends.push(entry),
    appendPromotionEvidence: async (entry) => appends.push(entry),
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(commands.slice(0, 9).map(({ id }) => id), [
    "install-read-only-pull-credential", "pull-exact-digests", "inspect-local-digests",
    "start-postgres", "db-role-bootstrap", "migrator", "start-api", "start-worker", "start-web",
  ]);
  assert.deepEqual(commands.find(({ id }) => id === "pull-exact-digests").imageReferences,
    value.publication.images.map(({ id, remoteReference }) => ({ id, remoteReference })));
  assert.equal(appends[0].filename, "production-deployment-evidence.v1.json");
  assert.equal(appends[1].filename, "production-promotion-evidence.v1.json");
  const promotion = JSON.parse(Buffer.from(appends[1].bytes).toString("utf8"));
  assert.equal(promotion.canary.durationSeconds, 604800);
  assert.equal(promotion.canary.checkpoints.at(-1).id, "post-cutover-7d");
});

test("a pre-cutover failure cleans only the run-owned candidate and writes no PASS evidence", async () => {
  const module = await runtime();
  const value = await fixtures();
  const events = [];
  await assert.rejects(module.runDigitalOceanProductionPromotion({
    ...commonInput(value),
    preflightAdapter: { verify: async () => ({ status: "passed" }) },
    inspectFile: async (path) => ({ isFile: () => path !== productionFiles.productionSecretRoot, isDirectory: () => path === productionFiles.productionSecretRoot, isSymbolicLink: () => false, mode: path === productionFiles.productionSecretRoot ? 0o40500 : 0o100400, size: 32 }),
    productionAdapter: { provision: async () => ({ owned: true, deploymentId: "candidate-production", sshHost: "72.56.81.28" }), applyFirewall: async () => {} },
    sshAdapter: { openPinnedSession: async () => ({ observedHostKeySha256: value.target.sshEndpoint.hostKeySha256, run: async () => { throw new Error("migrator failed"); }, close: async () => events.push("close") }) },
    appendProductionEvidence: async () => events.push("deployment-pass"),
    appendPromotionEvidence: async () => events.push("promotion-pass"),
    teardownCandidate: async ({ deploymentId }) => events.push(`teardown:${deploymentId}`),
  }), /DIGITALOCEAN_PRODUCTION_FAILED|DigitalOcean production promotion failed/);
  assert.deepEqual(events, ["close", "teardown:candidate-production"]);
});

test("rollback rejects missing, unverified or schema-incompatible prior evidence before effect", async () => {
  const module = await runtime();
  let effects = 0;
  const prior = { status: "passed", verification: "verified", productionClaim: true, schemaVersion: 10, minimumCompatibleVersion: 10, maximumCompatibleVersion: 10, publicationEvidenceSha256: sha("8"), deploymentEvidenceSha256: sha("9") };
  for (const candidate of [undefined, { ...prior, verification: "draft" }, { ...prior, minimumCompatibleVersion: 11 }]) {
    await assert.rejects(module.runApplicationRollback({ currentSchemaVersion: 10, prior: candidate, apply: async () => { effects += 1; } }), /PRODUCTION_ROLLBACK_FORBIDDEN|Production rollback is forbidden/);
  }
  assert.equal(effects, 0);
});
