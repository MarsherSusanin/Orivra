import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLICATION_SHA = "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10";
const OPEN_METEO = "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const SAFE_CONSUMER_REGISTRY_OUTPUT =
  "/opt/orivra/evidence/safe-consumer-registry.v1.json";
const COSTON2_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const COSTON2_DA_URL = "https://ctn2-data-availability.flare.network";
const RELAYER_ADDRESS = "0x3333333333333333333333333333333333333333";
const TIMEWEB_CAPABILITIES = ["PUT", "HEAD", "LIST", "GET", "DELETE"]
  .map((operation) => ({ operation, status: "passed" }));
const CLOCK_CHECK = Object.freeze({
  status: "synchronized", source: "production-host",
  maximumSkewSeconds: 5, observedSkewSeconds: 0,
});
const sha = (digit) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const bytes = (value) => Buffer.from(canonicalJson(value), "utf8");
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function runtime() {
  return import("../../scripts/digitalocean-production-promotion-runtime.mjs").catch(() => ({}));
}

async function fixture(transform = (publication) => publication) {
  const historical = JSON.parse(await readFile(resolve(root, "tests/fixtures/slice029b-publication-evidence.v1.json"), "utf8"));
  const publication = transform(structuredClone(historical));
  const publicationEvidenceBytes = bytes(publication);
  const publicationEvidenceSha256 = digest(publicationEvidenceBytes);
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
  const objectStoreAuthorityBytes = bytes(objectStore);
  const productionTargetBytes = bytes(target);
  const authorization = {
    version: "2", kind: "production-promotion-authorization", status: "authorized", promote: true,
    deploymentMode: "direct-pilot", publicationEvidenceSha256,
    productionTargetSha256: digest(productionTargetBytes), objectStoreAuthoritySha256: digest(objectStoreAuthorityBytes),
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
  };
  return { publication, publicationEvidenceBytes, publicationEvidenceSha256, objectStore, objectStoreAuthorityBytes, target, productionTargetBytes, authorization, promotionAuthorizationBytes: bytes(authorization) };
}

const fileInputs = Object.freeze({
  ghcrPullTokenFile: "/private/credentials/ghcr-read-token",
  sshPrivateKeyFile: "/private/credentials/orivra-production-ssh",
  timewebS3AccessKeyFile: "/private/credentials/timeweb-s3-access-key",
  timewebS3SecretKeyFile: "/private/credentials/timeweb-s3-secret-key",
  backupEncryptionKeyFile: "/private/credentials/backup-libsodium-key",
  productionSecretRoot: "/opt/orivra/secrets",
  replayBundleFile: "/opt/orivra/evidence/replay/proof-bundle.json",
  replayPreflightReportFile: "/opt/orivra/evidence/replay/preflight-report.json",
  backupEvidenceFile: "/opt/orivra/evidence/recovery/backup-evidence.v1.json",
});

const commonInput = (value) => ({
  publicationEvidenceBytes: value.publicationEvidenceBytes,
  expectedPublicationEvidenceSha256: value.publicationEvidenceSha256,
  productionTargetBytes: value.productionTargetBytes,
  expectedProductionTargetSha256: digest(value.productionTargetBytes),
  objectStoreAuthorityBytes: value.objectStoreAuthorityBytes,
  expectedObjectStoreAuthoritySha256: digest(value.objectStoreAuthorityBytes),
  promotionAuthorizationBytes: value.promotionAuthorizationBytes,
  expectedPromotionAuthorizationSha256: digest(value.promotionAuthorizationBytes),
  runBytes: bytes({ runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: value.authorization.operatorId }),
  fileInputs,
  now: "2026-08-12T02:20:00Z",
});

const preflight = (value, id) => ({
  "dns-target": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", dnsName: value.target.dnsName, addresses: ["72.56.81.28"] },
  "ssh-host-key": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", host: value.target.sshEndpoint.host, port: 22, expectedHostKeySha256: sha("1"), observedHostKeySha256: sha("1") },
  "read-only-ghcr": {
    version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed",
    registry: "ghcr.io", access: "read-only",
    images: value.publication.images.map(({ id: imageId, remoteReference, remoteDigest }) => ({ id: imageId, remoteReference, remoteDigest })),
  },
  "secret-files": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", fileIds: Object.keys(fileInputs).sort(), valuesExposed: false },
  "timeweb-s3-authority": {
    version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed",
    authoritySha256: digest(value.objectStoreAuthorityBytes), authorityMode: "shared-pilot",
    endpoint: value.objectStore.endpoint, region: value.objectStore.region, bucket: value.objectStore.bucket,
    pathStyle: value.objectStore.pathStyle, capabilities: structuredClone(TIMEWEB_CAPABILITIES),
  },
  "replay-bundle": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", bundleSha256: sha("2"), reportSha256: sha("3") },
  "safe-consumer-manifests": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", manifests: [["open-meteo-current-weather", OPEN_METEO], ["eth-usd", ETH_USD]] },
  "live-coston2": {
    version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed",
    chainId: 114, rpcUrl: COSTON2_RPC_URL, dataAvailabilityUrl: COSTON2_DA_URL,
    relayerAddress: RELAYER_ADDRESS, balanceWei: "1000000000000000000", authorization: "configured",
  },
}[id]);

const registry = {
  version: "1", kind: "safe-consumer-registry", chainId: 114,
  entries: [
    { templateId: "open-meteo-current-weather", revision: 1, manifestSha256: OPEN_METEO, consumerAddress: "0x1111111111111111111111111111111111111111" },
    { templateId: "eth-usd", revision: 1, manifestSha256: ETH_USD, consumerAddress: "0x2222222222222222222222222222222222222222" },
  ],
};

const canaryChecks = Object.freeze({
  healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
  objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
  diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
  liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"] },
  clock: CLOCK_CHECK,
});

const checkpoint = (id, dueAt, observedAt = dueAt) => ({
  version: "2", kind: "production-canary-checkpoint", id, dueAt, observedAt,
  status: "passed", checks: structuredClone(canaryChecks),
});

function productionDeploymentEvidenceV2(value) {
  return {
    version: "2", kind: "digitalocean-production-deployment-evidence",
    status: "passed", verification: "verified", productionClaim: true,
    producer: value.publication.producer,
    publicationEvidenceSha256: value.publicationEvidenceSha256,
    frozenReleaseManifestSha256: value.publication.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: digest(value.promotionAuthorizationBytes),
    preflightEvidenceSha256: sha("6"), target: value.target,
    run: { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: value.authorization.operatorId, completedAt: "2026-08-12T03:00:01Z" },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: value.publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
    database: { migrationManifestSha256: sha("7"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
    objectStore: value.objectStore, safeConsumers: registry,
    checks: {
      exactDigestPull: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
      timewebPitr: { status: "passed", restoreEvidenceSha256: sha("8"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
      liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] },
    },
    cutover: { status: "passed", publicOrigin: value.target.publicOrigin, activatedAt: "2026-08-12T03:00:00Z" },
  };
}

test("direct pilot rejects generic status-only preflight before one production effect", async () => {
  const module = await runtime();
  const value = await fixture();
  const without = (field, observation) => Object.fromEntries(
    Object.entries(observation).filter(([key]) => key !== field),
  );
  const cases = [
    ["status-only", null, () => ({ status: "passed" })],
    ["missing GHCR image inventory", "read-only-ghcr", (observation) => without("images", observation)],
    ["extra GHCR image", "read-only-ghcr", (observation) => ({ ...observation, images: [...observation.images, observation.images[0]] })],
    ["reordered GHCR images", "read-only-ghcr", (observation) => ({ ...observation, images: [...observation.images].reverse() })],
    ["mismatched GHCR digest", "read-only-ghcr", (observation) => ({ ...observation, images: observation.images.map((image, index) => index ? image : { ...image, remoteDigest: sha("0") }) })],
    ["missing Timeweb capabilities", "timeweb-s3-authority", (observation) => without("capabilities", observation)],
    ["extra Timeweb capability", "timeweb-s3-authority", (observation) => ({ ...observation, capabilities: [...observation.capabilities, { operation: "COPY", status: "passed" }] })],
    ["failed Timeweb capability", "timeweb-s3-authority", (observation) => ({ ...observation, capabilities: observation.capabilities.map((capability) => capability.operation === "GET" ? { ...capability, status: "failed" } : capability) })],
    ["mismatched Timeweb endpoint", "timeweb-s3-authority", (observation) => ({ ...observation, endpoint: "https://example.invalid" })],
    ["missing Coston2 RPC", "live-coston2", (observation) => without("rpcUrl", observation)],
    ["extra Coston2 field", "live-coston2", (observation) => ({ ...observation, privateKey: "forbidden" })],
    ["mismatched Coston2 chain", "live-coston2", (observation) => ({ ...observation, chainId: 1 })],
    ["mismatched Coston2 RPC", "live-coston2", (observation) => ({ ...observation, rpcUrl: "https://example.invalid/rpc" })],
    ["non-decimal Coston2 balance", "live-coston2", (observation) => ({ ...observation, balanceWei: "1e18" })],
  ];
  for (const [label, targetId, mutate] of cases) {
    let effects = 0;
    await assert.rejects(module.runTimewebDirectProductionPilot({
      ...commonInput(value),
      clock: { now: () => "2026-08-12T02:20:00Z" },
      preflightAdapter: { verify: async (id) => targetId === null || id === targetId
        ? mutate(preflight(value, id))
        : preflight(value, id) },
      productionAdapter: { provision: async () => { effects += 1; } },
    }), /PRODUCTION_PREFLIGHT_INVALID|Production pilot preflight is invalid/, label);
    assert.equal(effects, 0, label);
  }
});

test("direct pilot rejects historical GHCR observations against newly published canonical evidence", async () => {
  const module = await runtime();
  const historical = await fixture();
  assert.equal(historical.publicationEvidenceSha256, PUBLICATION_SHA);
  const current = await fixture((publication) => ({
    ...publication,
    producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) },
    images: publication.images.map((image, index) => {
      const remoteDigest = sha(String.fromCharCode(97 + index));
      return { ...image, imageManifestDigest: remoteDigest, remoteDigest, remoteReference: `${image.remoteRepository}@${remoteDigest}` };
    }),
  }));
  assert.notEqual(current.publicationEvidenceSha256, PUBLICATION_SHA);
  let effects = 0;
  await assert.rejects(module.runTimewebDirectProductionPilot({
    ...commonInput(current),
    clock: { now: () => "2026-08-12T02:20:00Z" },
    preflightAdapter: { verify: async (id) => id === "read-only-ghcr"
      ? preflight(historical, id)
      : preflight(current, id) },
    productionAdapter: { provision: async () => { effects += 1; } },
  }), /PRODUCTION_PREFLIGHT_INVALID|Production pilot preflight is invalid/);
  assert.equal(effects, 0);
});

test("direct pilot deploys exactly two manifest-bound consumers and writes the registry before worker", async () => {
  const module = await runtime();
  const value = await fixture();
  const events = [];
  let deploymentEntry;
  const result = await module.runTimewebDirectProductionPilot({
    ...commonInput(value),
    clock: { now: () => "2026-08-12T03:00:00Z" },
    inspectFile: async (path) => {
      if (path === SAFE_CONSUMER_REGISTRY_OUTPUT) {
        events.push("registry-output-absent");
        return null;
      }
      return { isFile: () => path !== fileInputs.productionSecretRoot, isDirectory: () => path === fileInputs.productionSecretRoot, isSymbolicLink: () => false, mode: path === fileInputs.productionSecretRoot ? 0o40500 : 0o100400, size: 32 };
    },
    preflightAdapter: { verify: async (id) => preflight(value, id) },
    productionAdapter: { provision: async () => { events.push("provision"); return { owned: true, deploymentId: value.target.deploymentId, sshHost: value.target.sshEndpoint.host }; }, applyFirewall: async () => events.push("firewall") },
    sshAdapter: { openPinnedSession: async () => ({ observedHostKeySha256: sha("1"), run: async (command) => {
      events.push(command.id);
      if (command.id === "inspect-local-digests") return { status: "passed", images: value.publication.images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) };
      if (command.id === "migrator") return { status: "passed", migrationManifestSha256: sha("4"), targetVersion: 10, schemaVersion: 10 };
      if (command.id === "safe-consumer-deployer") return { status: "passed", registry, deployments: registry.entries.map((entry, index) => ({ ...entry, transactionHash: `0x${String(index + 3).repeat(64)}` })) };
      if (command.id === "write-safe-consumer-registry") return { status: "passed", path: SAFE_CONSUMER_REGISTRY_OUTPUT, mode: 0o400, noReplace: true, registrySha256: digest(bytes(registry)) };
      if (command.id === "readyz-real-heartbeat") return { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current" } };
      if (command.id === "timeweb-pitr-production") return { status: "passed", restoreEvidenceSha256: sha("5"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 };
      if (command.id === "persisted-live-coston2") return { status: "passed", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] };
      return { status: "passed" };
    }, close: async () => events.push("close") }) },
    appendProductionEvidence: async (entry) => { deploymentEntry = entry; events.push("append-deployment"); },
    cutoverAdapter: {
      activateCaddy: async ({ publicOrigin }) => { events.push("caddy-cutover"); return { status: "passed", publicOrigin, activatedAt: "2026-08-12T03:00:00Z" }; },
      observeExternalHttps: async ({ publicOrigin }) => { events.push("external-https"); return { status: "passed", publicOrigin, observedAt: "2026-08-12T03:00:01Z" }; },
      rollbackCaddy: async () => events.push("rollback-caddy"),
    },
    checkpointStore: { append: async (entry) => events.push(`checkpoint:${entry.id}`) },
  });
  assert.equal(result.status, "canary-pending");
  assert.equal(Object.hasOwn(fileInputs, "doApiTokenFile"), false);
  assert.equal(Object.hasOwn(fileInputs, "safeConsumerRegistryFile"), false);
  assert.notEqual(events.indexOf("registry-output-absent"), -1);
  assert.ok(events.indexOf("registry-output-absent") < events.indexOf("provision"));
  assert.ok(events.indexOf("registry-output-absent") < events.indexOf("safe-consumer-deployer"));
  assert.deepEqual(events.slice(events.indexOf("migrator"), events.indexOf("start-worker") + 1), [
    "migrator", "start-api", "safe-consumer-deployer", "write-safe-consumer-registry", "start-worker",
  ]);
  assert.ok(events.indexOf("caddy-cutover") < events.indexOf("external-https"));
  assert.ok(events.indexOf("external-https") < events.indexOf("checkpoint:cutover"));
  assert.ok(events.indexOf("checkpoint:cutover") < events.indexOf("append-deployment"));
  assert.equal(events.includes("rollback-caddy"), false);
  const deployment = JSON.parse(Buffer.from(deploymentEntry.bytes).toString("utf8"));
  assert.equal(deployment.version, "2");
  assert.deepEqual(deployment.cutover, {
    status: "passed", publicOrigin: value.target.publicOrigin,
    activatedAt: "2026-08-12T03:00:00Z",
  });
  const contracts = await import("../../packages/contracts/src/production-promotion-runtime.mjs").catch(() => ({}));
  assert.deepEqual(contracts.ProductionDeploymentEvidenceV2Schema.parse(deployment), deployment);
  assert.equal(contracts.canonicalSerializeProductionDeploymentEvidenceV2(deployment), Buffer.from(deploymentEntry.bytes).toString("utf8"));
  assert.throws(() => contracts.ProductionDeploymentEvidenceV2Schema.parse({ ...deployment, cutover: { ...deployment.cutover, status: "failed" } }));
  assert.throws(() => contracts.ProductionDeploymentEvidenceV2Schema.parse({ ...deployment, cutover: { ...deployment.cutover, publicOrigin: "https://evil.invalid" } }));
  assert.deepEqual(deployment.safeConsumers, registry);
  assert.equal(deployment.objectStore.authorityMode, "shared-pilot");
  assert.equal(deployment.stagingDeploymentEvidenceSha256, undefined);
});

test("post-cutover observation, checkpoint and deployment-evidence failures roll Caddy back with zero deployment PASS", async () => {
  const module = await runtime();
  const value = await fixture();
  for (const failingPhase of ["external-https", "checkpoint", "deployment-evidence"]) {
    const events = [];
    const deploymentPass = [];
    await assert.rejects(module.runTimewebDirectProductionPilot({
      ...commonInput(value),
      clock: { now: () => "2026-08-12T03:00:00Z" },
      inspectFile: async (path) => path === SAFE_CONSUMER_REGISTRY_OUTPUT ? null : ({ isFile: () => path !== fileInputs.productionSecretRoot, isDirectory: () => path === fileInputs.productionSecretRoot, isSymbolicLink: () => false, mode: path === fileInputs.productionSecretRoot ? 0o40500 : 0o100400, size: 32 }),
      preflightAdapter: { verify: async (id) => preflight(value, id) },
      productionAdapter: { provision: async () => ({ owned: true, deploymentId: value.target.deploymentId, sshHost: value.target.sshEndpoint.host }), applyFirewall: async () => undefined },
      sshAdapter: { openPinnedSession: async () => ({ observedHostKeySha256: sha("1"), run: async (command) => {
        if (command.id === "inspect-local-digests") return { status: "passed", images: value.publication.images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) };
        if (command.id === "migrator") return { status: "passed", migrationManifestSha256: sha("4"), targetVersion: 10, schemaVersion: 10 };
        if (command.id === "safe-consumer-deployer") return { status: "passed", registry, deployments: registry.entries.map((entry, index) => ({ ...entry, transactionHash: `0x${String(index + 3).repeat(64)}` })) };
        if (command.id === "write-safe-consumer-registry") return { status: "passed", path: SAFE_CONSUMER_REGISTRY_OUTPUT, mode: 0o400, noReplace: true, registrySha256: digest(bytes(registry)) };
        if (command.id === "readyz-real-heartbeat") return { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current" } };
        if (command.id === "timeweb-pitr-production") return { status: "passed", restoreEvidenceSha256: sha("5"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 };
        if (command.id === "persisted-live-coston2") return { status: "passed", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] };
        return { status: "passed" };
      }, close: async () => undefined }) },
      cutoverAdapter: {
        activateCaddy: async ({ publicOrigin }) => { events.push("caddy-cutover"); return { status: "passed", publicOrigin, activatedAt: "2026-08-12T03:00:00Z" }; },
        observeExternalHttps: async ({ publicOrigin }) => {
          events.push("external-https");
          if (failingPhase === "external-https") throw new Error("external HTTPS failed");
          return { status: "passed", publicOrigin, observedAt: "2026-08-12T03:00:01Z" };
        },
        rollbackCaddy: async () => events.push("rollback-caddy"),
      },
      checkpointStore: { append: async () => {
        events.push("checkpoint");
        if (failingPhase === "checkpoint") throw new Error("checkpoint failed");
      } },
      appendProductionEvidence: async (entry) => {
        events.push("append-deployment");
        if (failingPhase === "deployment-evidence") throw new Error("deployment evidence failed");
        deploymentPass.push(entry);
      },
    }), /DigitalOcean production promotion failed|PRODUCTION_/);
    assert.equal(events[0] === "caddy-cutover" || events.includes("caddy-cutover"), true, failingPhase);
    assert.equal(events.at(-1), "rollback-caddy", failingPhase);
    assert.equal(events.filter((entry) => entry === "rollback-caddy").length, 1, failingPhase);
    assert.equal(deploymentPass.length, 0, failingPhase);
  }
});

test("24-hour canary resumes from append-only checkpoints and cannot terminal-pass early", async () => {
  const module = await runtime();
  const value = await fixture();
  const contracts = await import("../../packages/contracts/src/production-promotion-runtime.mjs").catch(() => ({}));
  const deployment = productionDeploymentEvidenceV2(value);
  assert.deepEqual(contracts.ProductionDeploymentEvidenceV2Schema.parse(deployment), deployment);
  const deploymentText = contracts.canonicalSerializeProductionDeploymentEvidenceV2(deployment);
  const deploymentEvidenceBytes = Buffer.from(deploymentText, "utf8");
  const expectedDeploymentEvidenceSha256 = digest(deploymentEvidenceBytes);
  const state = [checkpoint("cutover", "2026-08-12T03:00:00Z")];
  assert.deepEqual(contracts.ProductionCanaryCheckpointV2Schema.parse(state[0]), state[0]);
  const promotions = [];
  let now = "2026-08-12T03:00:01Z";
  let observations = 0;
  const invoke = (overrides = {}) => module.resumeTimewebProductionCanary({
    deploymentEvidenceBytes,
    expectedDeploymentEvidenceSha256,
    clock: { now: () => now },
    checkpointStore: { load: async () => structuredClone(state), append: async (entry) => {
      const parsed = contracts.ProductionCanaryCheckpointV2Schema.parse(entry);
      assert.equal(contracts.canonicalSerializeProductionCanaryCheckpointV2(parsed), canonicalJson(entry));
      state.push(parsed);
    } },
    observe: async ({ id, dueAt }) => {
      observations += 1;
      return checkpoint(id, dueAt, now);
    },
    appendPromotionEvidence: async (entry) => promotions.push(entry),
    ...overrides,
  });
  await assert.rejects(invoke({
    deploymentEvidenceBytes: bytes({ version: "2", kind: "test-bound-deployment", publicationEvidenceSha256: PUBLICATION_SHA }),
    expectedDeploymentEvidenceSha256: digest(bytes({ version: "2", kind: "test-bound-deployment", publicationEvidenceSha256: PUBLICATION_SHA })),
  }), /PRODUCTION_DEPLOYMENT_EVIDENCE_INVALID|deployment evidence/i);
  assert.equal(promotions.length, 0);
  assert.equal((await invoke()).status, "canary-pending");
  assert.equal(observations, 0);
  assert.equal(promotions.length, 0);
  now = "2026-08-12T03:15:00Z";
  await assert.rejects(invoke({
    observe: async ({ id, dueAt }) => ({
      ...checkpoint(id, dueAt, now),
      checks: { ...structuredClone(canaryChecks), clock: { ...CLOCK_CHECK, observedSkewSeconds: 6 } },
    }),
  }), /CANARY_CLOCK_SKEW|CANARY_CHECKPOINT_INVALID|clock synchronization/i);
  assert.equal(state.length, 1);
  for (const [clock, expectedId] of [
    ["2026-08-12T03:15:00Z", "post-cutover-15m"],
    ["2026-08-12T04:00:00Z", "post-cutover-1h"],
    ["2026-08-13T03:00:00Z", "post-cutover-24h"],
  ]) {
    now = clock;
    const result = await invoke();
    assert.equal(state.at(-1).id, expectedId);
    assert.equal(result.status, expectedId === "post-cutover-24h" ? "passed" : "canary-pending");
  }
  assert.equal(promotions.length, 1);
  const promotion = JSON.parse(Buffer.from(promotions[0].bytes).toString("utf8"));
  assert.deepEqual(contracts.ProductionPromotionEvidenceV2Schema.parse(promotion), promotion);
  assert.equal(contracts.canonicalSerializeProductionPromotionEvidenceV2(promotion), Buffer.from(promotions[0].bytes).toString("utf8"));
  assert.equal(promotion.status, "passed");
  assert.equal(promotion.promotionClaim, true);
  assert.equal(promotion.productionDeploymentEvidenceSha256, expectedDeploymentEvidenceSha256);
  assert.equal(promotion.canary.durationSeconds, 86400);
  assert.deepEqual(promotion.canary.checkpoints.map(({ id }) => id), ["cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h"]);
});
