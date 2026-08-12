import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OPEN_METEO = "sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const REGISTRY_PATH = "/opt/orivra/evidence/safe-consumer-registry.v1.json";
const DEPLOYMENT_EVIDENCE_PATH = "/opt/orivra/evidence/safe-consumer-deployment-evidence.v1.json";
const CANARY_STATE_ROOT = "/var/lib/orivra/production-canary";
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;

async function productionDeploymentEvidenceV2() {
  const publication = JSON.parse(await readFile(
    resolve(root, "tests/fixtures/slice029b-publication-evidence.v1.json"),
    "utf8",
  ));
  const objectStore = {
    version: "1", kind: "timeweb-s3-pilot-authority", provider: "timeweb-s3",
    endpoint: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet",
    pathStyle: true, authorityMode: "shared-pilot", credentialDelivery: "secret-files",
    qaProvider: "minio-only", swiftRuntime: false,
  };
  const safeConsumers = {
    version: "1", kind: "safe-consumer-registry", chainId: 114,
    entries: [
      { templateId: "open-meteo-current-weather", revision: 1, manifestSha256: OPEN_METEO, consumerAddress: "0x1111111111111111111111111111111111111111" },
      { templateId: "eth-usd", revision: 1, manifestSha256: ETH_USD, consumerAddress: "0x2222222222222222222222222222222222222222" },
    ],
  };
  return {
    version: "2", kind: "digitalocean-production-deployment-evidence",
    status: "passed", verification: "verified", productionClaim: true,
    producer: publication.producer,
    publicationEvidenceSha256: "sha256:1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10",
    frozenReleaseManifestSha256: publication.frozenRelease.frozenReleaseManifestSha256,
    promotionAuthorizationSha256: sha("promotion-authorization"),
    preflightEvidenceSha256: sha("production-pilot-preflight"),
    target: {
      version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
      deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
      publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("ssh-host-key") }, ingress: [80, 443], objectStore,
    },
    run: { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T03:00:01Z" },
    pullCredential: { registry: "ghcr.io", access: "read-only" },
    images: publication.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({ id, remoteRepository, remoteReference, remoteDigest })),
    topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
    database: { migrationManifestSha256: sha("migration"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
    objectStore,
    safeConsumers,
    checks: {
      exactDigestPull: { status: "passed" }, readyz: { status: "passed" },
      workerHeartbeat: { status: "current" },
      timewebPitr: { status: "passed", restoreEvidenceSha256: sha("restore"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
      liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO, ETH_USD] },
    },
    cutover: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: "2026-08-12T03:00:00Z" },
  };
}

async function deploymentRuntime() {
  return import("../../scripts/safe-consumer-registry-deployment-runtime.mjs").catch(() => ({}));
}

async function canaryRuntime() {
  return import("../../scripts/production-canary-resume-runtime.mjs").catch(() => ({}));
}

function createDeploymentAdapters(overrides = {}) {
  const state = { compile: [], estimates: [], deploy: [], receipts: [], code: [], publications: [] };
  const addresses = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ];
  return {
    state,
    compiler: {
      compileConsumer: async (input) => {
        state.compile.push(input);
        assert.equal(input.solcVersion, "0.8.36");
        assert.equal(input.importAuthority, "official-coston2-contract-registry");
        assert.match(input.source, /@flarenetwork\/flare-periphery-contracts\/coston2\/ContractRegistry\.sol/);
        return {
          compiler: "solc-0.8.36",
          manifestSha256: input.manifestSha256,
          compiledSourceSha256: sha(input.source),
          bytecode: `0x60${state.compile.length}0`,
        };
      },
    },
    relayer: {
      deriveAccount: async ({ privateKeyBytes }) => {
        assert.equal(privateKeyBytes.byteLength, 32);
        return { address: "0x3333333333333333333333333333333333333333" };
      },
      getChainId: async () => 114,
      getBalanceWei: async () => "1000000000000000000",
      estimateDeploymentCostWei: async (input) => {
        state.estimates.push(input);
        return "2000000000000000";
      },
      sendDeployment: async (input) => {
        state.deploy.push(input);
        return { transactionHash: `0x${String(state.deploy.length + 4).repeat(64)}` };
      },
      waitForReceipt: async ({ transactionHash }) => {
        state.receipts.push(transactionHash);
        const index = state.receipts.length - 1;
        return { status: "success", transactionHash, blockNumber: String(index + 100), contractAddress: addresses[index] };
      },
      getCode: async ({ address }) => {
        state.code.push(address);
        return "0x60006000";
      },
    },
    publication: {
      publishCanonicalPair: async (input) => {
        state.publications.push(input);
        return { status: "passed", atomic: true };
      },
    },
    ...overrides,
  };
}

async function withSecret(run) {
  const directory = await mkdtemp(join(tmpdir(), "orivra-029c-consumer-deploy-"));
  const secretFile = join(directory, "relayer-key");
  await writeFile(secretFile, Buffer.alloc(32, 0x11), { mode: 0o400 });
  await chmod(secretFile, 0o400);
  try {
    return await run({ directory, secretFile });
  } finally {
    await chmod(secretFile, 0o600).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

test("production deploys the two exact built-ins through pinned official Coston2 compilation before atomic evidence publication", async () => {
  const module = await deploymentRuntime();
  assert.equal(typeof module.runProductionSafeConsumerDeployment, "function");
  await withSecret(async ({ secretFile }) => {
    const adapters = createDeploymentAdapters();
    const result = await module.runProductionSafeConsumerDeployment({
      relayerPrivateKeyFile: secretFile,
      clock: { now: () => "2026-08-12T04:00:00Z" },
      compiler: adapters.compiler,
      relayer: adapters.relayer,
      publication: adapters.publication,
    });
    assert.equal((await lstat(secretFile)).mode & 0o777, 0o400);
    assert.deepEqual(adapters.state.compile.map(({ templateId, manifestSha256, contractName }) => [templateId, manifestSha256, contractName]), [
      ["open-meteo-current-weather", OPEN_METEO, "OrivraOpenMeteoCurrentWeatherConsumer"],
      ["eth-usd", ETH_USD, "OrivraEthUsdConsumer"],
    ]);
    assert.deepEqual(adapters.state.deploy.map(({ templateId }) => templateId), ["open-meteo-current-weather", "eth-usd"]);
    assert.equal(adapters.state.receipts.length, 2);
    assert.equal(adapters.state.code.length, 2);
    assert.equal(adapters.state.estimates.length, 2);
    assert.equal(adapters.state.publications.length, 1);
    const publication = adapters.state.publications[0];
    assert.deepEqual(publication.files.map(({ path, mode }) => [path, mode]), [
      [DEPLOYMENT_EVIDENCE_PATH, 0o400],
      [REGISTRY_PATH, 0o400],
    ]);
    assert.equal(publication.commitMarker, REGISTRY_PATH);
    assert.equal(publication.noReplace, true);
    assert.equal(Buffer.from(publication.registryBytes).toString("utf8"), canonicalJson(result.registry));
    assert.equal(Buffer.from(publication.deploymentEvidenceBytes).toString("utf8"), canonicalJson(result.deploymentEvidence));
    assert.deepEqual(result.registry.entries.map(({ manifestSha256 }) => manifestSha256), [OPEN_METEO, ETH_USD]);
    assert.doesNotMatch(JSON.stringify(result), /privateKey|relayer-key|1111111111111111111111111111111111111111111111111111111111111111/i);
  });
});

test("consumer deployment fails closed for secret, compiler, chain, balance, receipt, bytecode and duplicate-address faults", async () => {
  const module = await deploymentRuntime();
  assert.equal(typeof module.runProductionSafeConsumerDeployment, "function");
  await withSecret(async ({ directory, secretFile }) => {
    const symlinkPath = join(directory, "relayer-key-link");
    await symlink(secretFile, symlinkPath);
    const cases = [
      { name: "relative-secret", secret: "relative-key", expectedDeploys: 0 },
      { name: "symlink-secret", secret: symlinkPath, expectedDeploys: 0 },
      { name: "wrong-mode", prepare: () => chmod(secretFile, 0o600), expectedDeploys: 0 },
      { name: "manifest", compiler: { compileConsumer: async (input) => ({ compiler: "solc-0.8.36", manifestSha256: OPEN_METEO, compiledSourceSha256: sha(input.source), bytecode: "0x6000" }) }, expectedDeploys: 0 },
      { name: "compiler", compiler: { compileConsumer: async () => { throw new Error("compile failed"); } }, expectedDeploys: 0 },
      { name: "chain", relayer: { getChainId: async () => 1 }, expectedDeploys: 0 },
      { name: "balance", relayer: { getBalanceWei: async () => "1" }, expectedDeploys: 0 },
      { name: "receipt", relayer: { waitForReceipt: async () => ({ status: "reverted" }) }, expectedDeploys: 1 },
      { name: "bytecode", relayer: { getCode: async () => "0x" }, expectedDeploys: 1 },
      { name: "duplicate-address", relayer: { waitForReceipt: async ({ transactionHash }) => ({ status: "success", transactionHash, blockNumber: "100", contractAddress: "0x1111111111111111111111111111111111111111" }) }, expectedDeploys: 2 },
    ];
    for (const entry of cases) {
      await chmod(secretFile, 0o400);
      await entry.prepare?.();
      const defaults = createDeploymentAdapters();
      const compiler = entry.compiler ?? defaults.compiler;
      const relayer = { ...defaults.relayer, ...(entry.relayer ?? {}) };
      await assert.rejects(module.runProductionSafeConsumerDeployment({
        relayerPrivateKeyFile: entry.secret ?? secretFile,
        clock: { now: () => "2026-08-12T04:00:00Z" },
        compiler,
        relayer,
        publication: defaults.publication,
      }), /SAFE_CONSUMER_DEPLOYMENT_INVALID|Safe consumer deployment failed/);
      assert.equal(defaults.state.deploy.length, entry.expectedDeploys, entry.name);
      assert.equal(defaults.state.publications.length, 0, entry.name);
    }
  });
});

test("root-owned systemd oneshot and timer expose only the fixed canary resume entrypoint", async () => {
  const [service, timer, canaryCli, packageJson, runbook] = await Promise.all([
    readFile(resolve(root, "deploy/systemd/orivra-production-canary.service"), "utf8").catch(() => ""),
    readFile(resolve(root, "deploy/systemd/orivra-production-canary.timer"), "utf8").catch(() => ""),
    readFile(resolve(root, "scripts/resume-production-canary.mjs"), "utf8").catch(() => ""),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "docs/runbook.md"), "utf8"),
  ]);
  assert.match(service, /^\[Unit\][\s\S]*^\[Service\][\s\S]*^Type=oneshot$/m);
  assert.match(service, /^User=root$/m);
  assert.match(service, /^Group=root$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, new RegExp(`^ExecStart=/usr/bin/node /opt/orivra/current/scripts/resume-production-canary\\.mjs --state-root ${CANARY_STATE_ROOT}$`, "m"));
  assert.match(service, new RegExp(`^ReadWritePaths=${CANARY_STATE_ROOT}$`, "m"));
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.doesNotMatch(service, /EnvironmentFile|PRIVATE_KEY|TOKEN|SECRET|caller.*time/i);
  assert.match(timer, /^\[Timer\][\s\S]*^OnBootSec=1min$[\s\S]*^OnUnitActiveSec=1min$[\s\S]*^Persistent=true$[\s\S]*^RandomizedDelaySec=0$/m);
  assert.match(timer, /^Unit=orivra-production-canary\.service$/m);
  assert.equal(packageJson.scripts?.["production:canary:resume"], "node scripts/resume-production-canary.mjs --state-root /var/lib/orivra/production-canary");
  assert.match(canaryCli, /runProductionCanarySystemdTick/);
  assert.doesNotMatch(canaryCli, /status\s*:\s*["']passed|privateKey|secretAccessKey/i);
  assert.match(runbook, /install -o root -g root -m 0644[\s\S]*orivra-production-canary\.(?:service|timer)/i);
});

test("direct-pilot CLI accepts only absolute file-backed authority and invokes the real adapter boundary without secret output", async () => {
  const source = await readFile(resolve(root, "scripts/timeweb-direct-production-pilot-cli.mjs"), "utf8").catch(() => "");
  const module = await import("../../scripts/timeweb-direct-production-pilot-cli.mjs").catch(() => ({}));
  assert.equal(typeof module.runTimewebDirectProductionPilotCli, "function");
  assert.match(source, /runTimewebDirectProductionPilot/);
  assert.match(source, /createProductionPilotAdapters/);
  assert.doesNotMatch(source, /status\s*:\s*["']passed|privateKey\s*:|secretAccessKey\s*:/i);
  const calls = [];
  const adapterInputs = [];
  const output = [];
  const fileArguments = [
    ["--publication-evidence", "/opt/orivra/evidence/publication-evidence.v1.json"],
    ["--publication-evidence-sha256-file", "/opt/orivra/evidence/publication-evidence.v1.sha256"],
    ["--production-target", "/opt/orivra/authority/production-target.v2.json"],
    ["--production-target-sha256-file", "/opt/orivra/authority/production-target.v2.sha256"],
    ["--object-store-authority", "/opt/orivra/authority/timeweb-s3-pilot-authority.v1.json"],
    ["--object-store-authority-sha256-file", "/opt/orivra/authority/timeweb-s3-pilot-authority.v1.sha256"],
    ["--promotion-authorization", "/opt/orivra/authority/production-promotion-authorization.v2.json"],
    ["--promotion-authorization-sha256-file", "/opt/orivra/authority/production-promotion-authorization.v2.sha256"],
    ["--run", "/opt/orivra/authority/production-run.v1.json"],
    ["--ghcr-pull-token-file", "/opt/orivra/secrets/ghcr-pull-token"],
    ["--ssh-private-key-file", "/opt/orivra/secrets/production-ssh-key"],
    ["--timeweb-access-key-file", "/opt/orivra/secrets/timeweb-access-key"],
    ["--timeweb-secret-key-file", "/opt/orivra/secrets/timeweb-secret-key"],
    ["--backup-encryption-key-file", "/opt/orivra/secrets/backup-encryption-key"],
  ];
  const argv = fileArguments.flat();
  const result = await module.runTimewebDirectProductionPilotCli({
    argv,
    stdout: { write: (value) => output.push(String(value)) },
    createAdapters: async (input) => { adapterInputs.push(input); return { kind: "real-production-pilot-adapters" }; },
    runPilot: async (input) => { calls.push(input); return { status: "canary-pending", runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4" }; },
  });
  assert.equal(result.status, "canary-pending");
  assert.equal(calls.length, 1);
  assert.equal(adapterInputs.length, 1);
  assert.equal(calls[0].adapters.kind, "real-production-pilot-adapters");
  assert.doesNotMatch(source, /digitalocean-token-file|digitalOceanToken/);
  assert.deepEqual(calls[0].authorityFiles, {
    publicationEvidence: "/opt/orivra/evidence/publication-evidence.v1.json",
    publicationEvidenceSha256: "/opt/orivra/evidence/publication-evidence.v1.sha256",
    productionTarget: "/opt/orivra/authority/production-target.v2.json",
    productionTargetSha256: "/opt/orivra/authority/production-target.v2.sha256",
    objectStoreAuthority: "/opt/orivra/authority/timeweb-s3-pilot-authority.v1.json",
    objectStoreAuthoritySha256: "/opt/orivra/authority/timeweb-s3-pilot-authority.v1.sha256",
    promotionAuthorization: "/opt/orivra/authority/production-promotion-authorization.v2.json",
    promotionAuthorizationSha256: "/opt/orivra/authority/production-promotion-authorization.v2.sha256",
    run: "/opt/orivra/authority/production-run.v1.json",
  });
  assert.deepEqual(adapterInputs[0].secretFiles, {
    ghcrPullToken: "/opt/orivra/secrets/ghcr-pull-token",
    sshPrivateKey: "/opt/orivra/secrets/production-ssh-key",
    timewebAccessKey: "/opt/orivra/secrets/timeweb-access-key",
    timewebSecretKey: "/opt/orivra/secrets/timeweb-secret-key",
    backupEncryptionKey: "/opt/orivra/secrets/backup-encryption-key",
  });
  assert.equal(output.join(""), `${canonicalJson(result)}\n`);
  assert.doesNotMatch(output.join(""), /\/run\/secrets|token|private-key|access-key|secret-key/i);
  for (const [flag] of fileArguments) {
    const invalid = [...argv];
    invalid[invalid.indexOf(flag) + 1] = "relative-file";
    await assert.rejects(module.runTimewebDirectProductionPilotCli({
      argv: invalid,
      stdout: { write: () => {} },
      createAdapters: async () => { throw new Error("must not create adapters"); },
      runPilot: async () => { throw new Error("must not run"); },
    }), /PRODUCTION_PILOT_CLI_INVALID|absolute file/i);
  }
  await assert.rejects(module.runTimewebDirectProductionPilotCli({
    argv: [...argv, "--timeweb-secret", "forbidden-value"],
    stdout: { write: () => {} },
    createAdapters: async () => ({}),
    runPilot: async () => ({}),
  }), /PRODUCTION_PILOT_CLI_INVALID|unknown argument/i);
});

test("systemd resume trusts only the host clock, appends one due checkpoint atomically and cannot promote early", async () => {
  const module = await canaryRuntime();
  assert.equal(typeof module.runProductionCanarySystemdTick, "function");
  const contracts = await import("../../packages/contracts/src/production-promotion-runtime.mjs");
  const deployment = await productionDeploymentEvidenceV2();
  assert.deepEqual(contracts.ProductionDeploymentEvidenceV2Schema.parse(deployment), deployment);
  const deploymentText = contracts.canonicalSerializeProductionDeploymentEvidenceV2(deployment);
  const deploymentEvidenceBytes = Buffer.from(deploymentText, "utf8");
  const expectedDeploymentEvidenceSha256 = `sha256:${createHash("sha256").update(deploymentEvidenceBytes).digest("hex")}`;
  const cutover = "2026-08-12T03:00:00Z";
  const checkpoints = [{ id: "cutover", dueAt: cutover, observedAt: cutover, sha256: sha("cutover") }];
  const appended = [];
  const promotions = [];
  const cleanup = [];
  let now = "2026-08-12T03:14:59Z";
  const invoke = (extra = {}) => module.runProductionCanarySystemdTick({
    stateRoot: CANARY_STATE_ROOT,
    deploymentEvidenceBytes,
    expectedDeploymentEvidenceSha256,
    clock: { now: () => now },
    loadCanonicalState: async () => structuredClone(checkpoints),
    observe: async ({ id, dueAt }) => ({ id, dueAt, observedAt: now, status: "passed" }),
    appendCheckpoint: async (entry) => {
      appended.push(entry);
      checkpoints.push({ id: entry.id, dueAt: entry.dueAt, observedAt: entry.observedAt, sha256: entry.sha256 });
    },
    appendPromotionEvidence: async (entry) => { promotions.push(entry); return { status: "passed", sha256: entry.sha256 }; },
    cleanupStage: async (path) => cleanup.push(path),
    ...extra,
  });
  assert.equal((await invoke()).status, "not-due");
  assert.equal(appended.length, 0);
  await assert.rejects(invoke({ callerNow: "2026-08-13T03:00:00Z" }), /CANARY_CLOCK_INVALID|host clock/i);
  assert.equal(appended.length, 0);
  now = "2026-08-12T03:15:00Z";
  assert.equal((await invoke()).checkpointId, "post-cutover-15m");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].mode, 0o400);
  assert.equal(appended[0].noReplace, true);
  assert.match(appended[0].path, new RegExp(`^${CANARY_STATE_ROOT}/checkpoints/01-post-cutover-15m\\.json$`));
  now = "2026-08-12T03:14:59Z";
  await assert.rejects(invoke(), /CANARY_CLOCK_SKEW|host clock/i);
  now = "2026-08-13T02:59:59Z";
  assert.equal((await invoke()).checkpointId, "post-cutover-1h");
  assert.equal(promotions.length, 0);
  now = "2026-08-13T03:00:00Z";
  await assert.rejects(invoke({
    loadCanonicalState: async () => structuredClone(checkpoints),
    appendCheckpoint: async () => undefined,
    appendPromotionEvidence: async () => ({ status: "recorded-for-test" }),
  }), /CANARY_PROMOTION_EVIDENCE_INVALID|promotion evidence/i);
  assert.equal(promotions.length, 0);
  assert.equal((await invoke()).checkpointId, "post-cutover-24h");
  assert.equal(promotions.length, 1);
  assert.equal(promotions[0].mode, 0o400);
  assert.equal(promotions[0].noReplace, true);
  const promotionText = Buffer.from(promotions[0].bytes).toString("utf8");
  const promotion = contracts.ProductionPromotionEvidenceV2Schema.parse(JSON.parse(promotionText));
  assert.equal(contracts.canonicalSerializeProductionPromotionEvidenceV2(promotion), promotionText);
  assert.equal(promotion.status, "passed");
  assert.equal(promotion.promotionClaim, true);
  assert.equal(promotion.productionDeploymentEvidenceSha256, expectedDeploymentEvidenceSha256);
  assert.equal(promotions[0].sha256, `sha256:${createHash("sha256").update(promotions[0].bytes).digest("hex")}`);
  const beforeFailure = checkpoints.length;
  await assert.rejects(invoke({
    loadCanonicalState: async () => checkpoints.slice(0, 1),
    appendCheckpoint: async () => { throw new Error("atomic append failed"); },
  }), /CANARY_CHECKPOINT_WRITE_FAILED|atomic append failed/);
  assert.equal(checkpoints.length, beforeFailure);
  assert.ok(cleanup.length > 0);
});
