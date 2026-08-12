import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
} from "../../packages/contracts/src/publication-runtime.mjs";
import {
  ApplicationRollbackAuthorizationV1Schema,
  ProductionDeploymentEvidenceV1Schema,
  canonicalSerializeProductionDeploymentEvidence,
} from "../../packages/contracts/src/production-promotion-runtime.mjs";

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

function rollbackFixtures(publication) {
  const currentPublicationBytes = Buffer.from(canonicalSerializePublicationEvidence(publication), "utf8");
  const priorPublication = PublicationEvidenceV1Schema.parse({
    ...publication,
    runId: "pub_01K2Q4P6R8T0V2X4Z6B8D0F2H5",
    publishedAt: "2026-08-01T00:00:00Z",
    frozenRelease: { ...publication.frozenRelease, frozenReleaseManifestSha256: sha("6") },
    images: publication.images.map((image, index) => {
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
  const priorPublicationBytes = Buffer.from(canonicalSerializePublicationEvidence(priorPublication), "utf8");
  const deployment = (source, sourceBytes, prior) => ProductionDeploymentEvidenceV1Schema.parse({
    version: "1", kind: "digitalocean-production-deployment-evidence", status: "passed",
    verification: "verified", productionClaim: true, producer: source.producer,
    publicationEvidenceSha256: digest(sourceBytes),
    stagingDeploymentEvidenceSha256: sha(prior ? "7" : "8"),
    frozenReleaseManifestSha256: source.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: sha(prior ? "9" : "0"),
    target: {
      version: "1", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
      deploymentId: prior ? "orivra-production-previous" : "orivra-production-primary",
      composeProject: prior ? "proofline-production-previous" : "proofline-production-primary",
      publicOrigin: prior ? "https://previous.orivra.xyz" : "https://orivra.xyz",
      dnsName: prior ? "previous.orivra.xyz" : "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha(prior ? "a" : "b") }, ingress: [80, 443],
    },
    run: {
      runId: prior ? "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H5" : "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      completedAt: prior ? "2026-08-01T01:00:00Z" : "2026-08-12T03:00:00Z",
    },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: source.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
    database: { volumeIdentitySha256: sha(prior ? "c" : "d"), migrationManifestSha256: sha("e"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
    checks: { exactDigestPull: { status: "passed" }, healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" }, spacesPitr: { restoreEvidenceSha256: sha("f"), status: "passed" }, liveCoston2: { runId: prior ? "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5" : "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", status: "persisted" } },
  });
  const currentDeployment = deployment(publication, currentPublicationBytes, false);
  const priorDeployment = deployment(priorPublication, priorPublicationBytes, true);
  const currentDeploymentBytes = Buffer.from(canonicalSerializeProductionDeploymentEvidence(currentDeployment), "utf8");
  const priorDeploymentBytes = Buffer.from(canonicalSerializeProductionDeploymentEvidence(priorDeployment), "utf8");
  const authorization = ApplicationRollbackAuthorizationV1Schema.parse({
    version: "1", kind: "application-rollback-authorization", status: "authorized", rollback: true,
    currentProductionDeploymentEvidenceSha256: digest(currentDeploymentBytes),
    priorProductionDeploymentEvidenceSha256: digest(priorDeploymentBytes),
    priorPublicationEvidenceSha256: digest(priorPublicationBytes),
    currentSchemaVersion: 10, priorMinimumCompatibleVersion: 10, priorMaximumCompatibleVersion: 10,
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-19T03:10:00Z", expiresAt: "2026-08-19T03:40:00Z",
  });
  const authorizationBytes = Buffer.from(canonicalJson(authorization), "utf8");
  return { authorization, authorizationBytes, currentPublicationBytes, priorPublication, priorPublicationBytes, currentDeploymentBytes, priorDeployment, priorDeploymentBytes };
}

const rollbackInput = (value) => ({
  rollbackAuthorizationBytes: value.authorizationBytes,
  expectedRollbackAuthorizationSha256: digest(value.authorizationBytes),
  currentProductionDeploymentEvidenceBytes: value.currentDeploymentBytes,
  expectedCurrentProductionDeploymentEvidenceSha256: digest(value.currentDeploymentBytes),
  currentPublicationEvidenceBytes: value.currentPublicationBytes,
  expectedCurrentPublicationEvidenceSha256: digest(value.currentPublicationBytes),
  priorProductionDeploymentEvidenceBytes: value.priorDeploymentBytes,
  expectedPriorProductionDeploymentEvidenceSha256: digest(value.priorDeploymentBytes),
  priorPublicationEvidenceBytes: value.priorPublicationBytes,
  expectedPriorPublicationEvidenceSha256: digest(value.priorPublicationBytes),
  now: "2026-08-19T03:20:00Z",
});

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

test("rollback applies exactly five prior immutable digests only from canonical authorization-bound evidence", async () => {
  const module = await runtime();
  const value = rollbackFixtures((await fixtures()).publication);
  const effects = [];
  const result = await module.runApplicationRollback({
    ...rollbackInput(value),
    apply: async (authority) => effects.push(authority),
  });
  assert.equal(result.status, "passed");
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].images, value.priorPublication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })));
  assert.equal(Object.isFrozen(effects[0]), true);
  assert.equal(Object.isFrozen(effects[0].images[0]), true);
});

test("rollback rejects object-only and forged latest authority before effect", async () => {
  const module = await runtime();
  const value = rollbackFixtures((await fixtures()).publication);
  let effects = 0;
  await assert.rejects(module.runApplicationRollback({
    currentSchemaVersion: 10,
    prior: {
      status: "passed", verification: "verified", productionClaim: true,
      schemaVersion: 10, minimumCompatibleVersion: 10, maximumCompatibleVersion: 10,
      publicationEvidenceSha256: sha("8"), deploymentEvidenceSha256: sha("9"),
      images: value.priorPublication.images.map(({ id, remoteRepository }) => ({ id, remoteReference: `${remoteRepository}:latest` })),
    },
    apply: async () => { effects += 1; },
  }), /PRODUCTION_ROLLBACK_INPUT_INVALID|PRODUCTION_ROLLBACK_FORBIDDEN|Production rollback/);
  assert.equal(effects, 0);
});

test("rollback rejects noncanonical, mismatched, expired and unbound handoffs before effect", async () => {
  const module = await runtime();
  const value = rollbackFixtures((await fixtures()).publication);
  const input = rollbackInput(value);
  const encoded = (entry) => Buffer.from(canonicalJson(entry), "utf8");
  const withAuthorization = (authorization) => {
    const rollbackAuthorizationBytes = encoded(authorization);
    return { ...input, rollbackAuthorizationBytes, expectedRollbackAuthorizationSha256: digest(rollbackAuthorizationBytes) };
  };
  const latestDeploymentBytes = encoded({
    ...value.priorDeployment,
    images: value.priorDeployment.images.map((image, index) => index === 0 ? { ...image, remoteReference: `${image.remoteRepository}:latest` } : image),
  });
  const invalidInputs = [
    { ...input, rollbackAuthorizationBytes: Buffer.from(JSON.stringify(value.authorization, null, 2)) },
    { ...input, expectedRollbackAuthorizationSha256: sha("0") },
    { ...input, expectedCurrentProductionDeploymentEvidenceSha256: sha("0") },
    { ...input, expectedCurrentPublicationEvidenceSha256: sha("0") },
    { ...input, expectedPriorProductionDeploymentEvidenceSha256: sha("0") },
    { ...input, expectedPriorPublicationEvidenceSha256: sha("0") },
    { ...input, now: "2026-08-19T03:40:01Z" },
    { ...input, priorProductionDeploymentEvidenceBytes: latestDeploymentBytes, expectedPriorProductionDeploymentEvidenceSha256: digest(latestDeploymentBytes) },
    withAuthorization({ ...value.authorization, priorPublicationEvidenceSha256: sha("0") }),
    withAuthorization({ ...value.authorization, operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H5" }),
    withAuthorization({ ...value.authorization, priorMinimumCompatibleVersion: 11 }),
  ];
  for (const invalid of invalidInputs) {
    let effects = 0;
    await assert.rejects(module.runApplicationRollback({ ...invalid, apply: async () => { effects += 1; } }), /PRODUCTION_ROLLBACK_INPUT_INVALID|PRODUCTION_ROLLBACK_FORBIDDEN|Production rollback/);
    assert.equal(effects, 0);
  }
});
