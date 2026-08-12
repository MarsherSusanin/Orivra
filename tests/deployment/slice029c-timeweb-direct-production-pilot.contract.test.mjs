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

async function fixture() {
  const publication = JSON.parse(await readFile(resolve(root, "tests/fixtures/slice029b-publication-evidence.v1.json"), "utf8"));
  const publicationEvidenceBytes = bytes(publication);
  assert.equal(digest(publicationEvidenceBytes), PUBLICATION_SHA);
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
    deploymentMode: "direct-pilot", publicationEvidenceSha256: PUBLICATION_SHA,
    productionTargetSha256: digest(productionTargetBytes), objectStoreAuthoritySha256: digest(objectStoreAuthorityBytes),
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
  };
  return { publication, publicationEvidenceBytes, objectStore, objectStoreAuthorityBytes, target, productionTargetBytes, authorization, promotionAuthorizationBytes: bytes(authorization) };
}

const fileInputs = Object.freeze({
  doApiTokenFile: "/private/credentials/digitalocean-token",
  ghcrPullTokenFile: "/private/credentials/ghcr-read-token",
  sshPrivateKeyFile: "/private/credentials/orivra-production-ssh",
  timewebS3AccessKeyFile: "/private/credentials/timeweb-s3-access-key",
  timewebS3SecretKeyFile: "/private/credentials/timeweb-s3-secret-key",
  backupEncryptionKeyFile: "/private/credentials/backup-libsodium-key",
  productionSecretRoot: "/opt/orivra/secrets",
  replayBundleFile: "/opt/orivra/evidence/replay/proof-bundle.json",
  replayPreflightReportFile: "/opt/orivra/evidence/replay/preflight-report.json",
  backupEvidenceFile: "/opt/orivra/evidence/recovery/backup-evidence.v1.json",
  safeConsumerRegistryFile: "/opt/orivra/evidence/safe-consumer-registry.v1.json",
});

const commonInput = (value) => ({
  publicationEvidenceBytes: value.publicationEvidenceBytes,
  expectedPublicationEvidenceSha256: PUBLICATION_SHA,
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
  "read-only-ghcr": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", registry: "ghcr.io", access: "read-only" },
  "secret-files": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", fileIds: Object.keys(fileInputs).sort(), valuesExposed: false },
  "timeweb-s3-authority": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", authoritySha256: digest(value.objectStoreAuthorityBytes), authorityMode: "shared-pilot" },
  "replay-bundle": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", bundleSha256: sha("2"), reportSha256: sha("3") },
  "safe-consumer-manifests": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", manifests: [["open-meteo-current-weather", OPEN_METEO], ["eth-usd", ETH_USD]] },
  "live-coston2": { version: "1", kind: "production-pilot-preflight-observation", check: id, status: "passed", chainId: 114, authorization: "configured" },
}[id]);

const registry = {
  version: "1", kind: "safe-consumer-registry", chainId: 114,
  entries: [
    { templateId: "open-meteo-current-weather", revision: 1, manifestSha256: OPEN_METEO, consumerAddress: "0x1111111111111111111111111111111111111111" },
    { templateId: "eth-usd", revision: 1, manifestSha256: ETH_USD, consumerAddress: "0x2222222222222222222222222222222222222222" },
  ],
};

test("direct pilot rejects generic status-only preflight before one production effect", async () => {
  const module = await runtime();
  const value = await fixture();
  let effects = 0;
  await assert.rejects(module.runTimewebDirectProductionPilot({
    ...commonInput(value),
    clock: { now: () => "2026-08-12T02:20:00Z" },
    preflightAdapter: { verify: async () => ({ status: "passed" }) },
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
    inspectFile: async (path) => ({ isFile: () => path !== fileInputs.productionSecretRoot, isDirectory: () => path === fileInputs.productionSecretRoot, isSymbolicLink: () => false, mode: path === fileInputs.productionSecretRoot ? 0o40500 : 0o100400, size: 32 }),
    preflightAdapter: { verify: async (id) => preflight(value, id) },
    productionAdapter: { provision: async () => ({ owned: true, deploymentId: value.target.deploymentId, sshHost: value.target.sshEndpoint.host }), applyFirewall: async () => events.push("firewall") },
    sshAdapter: { openPinnedSession: async () => ({ observedHostKeySha256: sha("1"), run: async (command) => {
      events.push(command.id);
      if (command.id === "inspect-local-digests") return { status: "passed", images: value.publication.images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) };
      if (command.id === "migrator") return { status: "passed", migrationManifestSha256: sha("4"), targetVersion: 10, schemaVersion: 10 };
      if (command.id === "safe-consumer-deployer") return { status: "passed", registry, deployments: registry.entries.map((entry, index) => ({ ...entry, transactionHash: `0x${String(index + 3).repeat(64)}` })) };
      if (command.id === "write-safe-consumer-registry") return { status: "passed", path: fileInputs.safeConsumerRegistryFile, mode: 0o400, registrySha256: digest(bytes(registry)) };
      if (command.id === "readyz-real-heartbeat") return { status: "passed", readyz: { status: "passed" }, workerHeartbeat: { status: "current" } };
      if (command.id === "timeweb-pitr-production") return { status: "passed", restoreEvidenceSha256: sha("5"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 };
      if (command.id === "persisted-live-coston2") return { status: "passed", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] };
      return { status: "passed" };
    }, close: async () => events.push("close") }) },
    appendProductionEvidence: async (entry) => { deploymentEntry = entry; events.push("append-deployment"); },
    cutoverAdapter: { activateCaddy: async ({ publicOrigin }) => { events.push("caddy-cutover"); return { status: "passed", publicOrigin, activatedAt: "2026-08-12T03:00:00Z" }; } },
    checkpointStore: { append: async (entry) => events.push(`checkpoint:${entry.id}`) },
  });
  assert.equal(result.status, "canary-pending");
  assert.deepEqual(events.slice(events.indexOf("migrator"), events.indexOf("start-worker") + 1), [
    "migrator", "start-api", "safe-consumer-deployer", "write-safe-consumer-registry", "start-worker",
  ]);
  assert.ok(events.indexOf("append-deployment") < events.indexOf("caddy-cutover"));
  assert.ok(events.indexOf("caddy-cutover") < events.indexOf("checkpoint:cutover"));
  const deployment = JSON.parse(Buffer.from(deploymentEntry.bytes).toString("utf8"));
  assert.equal(deployment.version, "2");
  assert.deepEqual(deployment.safeConsumers, registry);
  assert.equal(deployment.objectStore.authorityMode, "shared-pilot");
  assert.equal(deployment.stagingDeploymentEvidenceSha256, undefined);
});

test("24-hour canary resumes from append-only checkpoints and cannot terminal-pass early", async () => {
  const module = await runtime();
  const value = await fixture();
  const state = [{ id: "cutover", observedAt: "2026-08-12T03:00:00Z" }];
  const promotions = [];
  let now = "2026-08-12T03:00:01Z";
  let observations = 0;
  const invoke = () => module.resumeTimewebProductionCanary({
    deploymentEvidenceBytes: bytes({ version: "2", kind: "test-bound-deployment", publicationEvidenceSha256: PUBLICATION_SHA }),
    expectedDeploymentEvidenceSha256: sha("6"),
    clock: { now: () => now },
    checkpointStore: { load: async () => structuredClone(state), append: async (entry) => state.push(entry) },
    observe: async ({ id, dueAt }) => {
      observations += 1;
      return {
        version: "2", kind: "production-canary-checkpoint", id, dueAt, observedAt: now, status: "passed",
        checks: {
          healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
          objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
          diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
          liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"] },
        },
      };
    },
    appendPromotionEvidence: async (entry) => promotions.push(entry),
  });
  assert.equal((await invoke()).status, "canary-pending");
  assert.equal(observations, 0);
  assert.equal(promotions.length, 0);
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
  assert.equal(promotion.canary.durationSeconds, 86400);
  assert.deepEqual(promotion.canary.checkpoints.map(({ id }) => id), ["cutover", "post-cutover-15m", "post-cutover-1h", "post-cutover-24h"]);
});
