import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SECRET_ROOT = "/opt/orivra/secrets";

const expected = Object.freeze({
  PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE: ["postgres_admin_database_url", 1000],
  PROOFLINE_MIGRATOR_DATABASE_URL_FILE: ["migrator_database_url", 1000],
  PROOFLINE_API_DATABASE_URL_FILE: ["api_database_url", 1000],
  PROOFLINE_API_TOKEN_DIGEST_KEY_FILE: ["api_token_digest_key", 1000],
  PROOFLINE_WORKER_DATABASE_URL_FILE: ["worker_database_url", 1000],
  PROOFLINE_WORKER_VERIFIER_API_KEY_FILE: ["worker_verifier_api_key", 1000],
  PROOFLINE_WORKER_COSTON2_PRIVATE_KEY_FILE: ["worker_coston2_private_key", 1000],
  PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE: ["recording_importer_database_url", 1000],
  PROOFLINE_BACKUP_BOOTSTRAP_DATABASE_URL_FILE: ["backup_bootstrap_database_url", 1000],
  PROOFLINE_POSTGRES_PASSWORD_FILE: ["postgres_password", 999],
  PROOFLINE_BACKUP_DATABASE_URL_FILE: ["backup_database_url", 999],
  PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE: ["backup_writer_access_key_id", 999],
  PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE: ["backup_writer_secret_access_key", 999],
  PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE: ["backup_reader_access_key_id", 999],
  PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE: ["backup_reader_secret_access_key", 999],
  PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE: ["backup_retention_access_key_id", 999],
  PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE: ["backup_retention_secret_access_key", 999],
  PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE: ["backup_encryption_key", 999],
});

const environment = Object.freeze(Object.fromEntries(Object.entries(expected).map(([name, [basename]]) => [
  name, `${SECRET_ROOT}/${basename}`,
])));

const rootStatus = (overrides = {}) => ({
  isDirectory: () => true,
  isSymbolicLink: () => false,
  mode: 0o40500,
  uid: 0,
  gid: 0,
  ...overrides,
});

const fileRecord = (name, overrides = {}) => {
  const [, uid] = expected[name];
  const sharedAccess = name.endsWith("_ACCESS_KEY_ID_FILE");
  const sharedSecret = name.endsWith("_SECRET_ACCESS_KEY_FILE");
  const sharedDatabase = name.includes("BACKUP_") && name.endsWith("DATABASE_URL_FILE");
  const bytes = Buffer.from(sharedAccess ? "shared-access" : sharedSecret ? "shared-secret" : sharedDatabase ? "shared-database" : `value-${name}`, "utf8");
  return {
    bytes,
    status: {
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o100400,
      uid,
      gid: uid,
      size: bytes.length,
      dev: 1,
      ino: Object.keys(expected).indexOf(name) + 1,
      ...(overrides.status ?? {}),
    },
    ...overrides,
  };
};

async function feature() {
  return import(`../../scripts/timeweb-production-secret-inventory.mjs?contract=${Date.now()}-${Math.random()}`).catch(() => ({}));
}

test("validates the exact private production secret inventory and shared byte authority before effects", async () => {
  const module = await feature();
  assert.deepEqual(module.TIMEWEB_PRODUCTION_SECRET_FILE_AUTHORITY, expected);
  assert.equal(Object.isFrozen(module.TIMEWEB_PRODUCTION_SECRET_FILE_AUTHORITY), true);
  assert.ok(Object.values(module.TIMEWEB_PRODUCTION_SECRET_FILE_AUTHORITY).every(Object.isFrozen));
  let effects = 0;
  const result = await module.validateTimewebProductionSecretInventory({
    environment,
    inspectSecretRoot: async () => rootStatus(),
    captureSecretFile: async (path, name) => fileRecord(name),
    effect: async () => { effects += 1; },
  });
  assert.deepEqual(result, { status: "passed", secretRoot: SECRET_ROOT, fileCount: 18, authorityMode: "split-uid-private" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(effects, 0);
});

test("rejects root, path, ownership, mode and shared-byte deviations before Docker", async () => {
  const module = await feature();
  const failures = [
    { name: "root-mode", root: rootStatus({ mode: 0o40700 }) },
    { name: "root-owner", root: rootStatus({ uid: 1000, gid: 1000 }) },
    { name: "caller-path", env: { ...environment, PROOFLINE_API_DATABASE_URL_FILE: "/tmp/api" } },
    { name: "duplicate-path", env: { ...environment, PROOFLINE_API_DATABASE_URL_FILE: environment.PROOFLINE_MIGRATOR_DATABASE_URL_FILE } },
    { name: "duplicate-inode", target: "PROOFLINE_API_DATABASE_URL_FILE", record: { status: { dev: 1, ino: 2 } } },
    { name: "file-mode", target: "PROOFLINE_API_DATABASE_URL_FILE", record: { status: { mode: 0o100600 } } },
    { name: "file-owner", target: "PROOFLINE_POSTGRES_PASSWORD_FILE", record: { status: { uid: 0, gid: 0 } } },
    { name: "symlink", target: "PROOFLINE_BACKUP_DATABASE_URL_FILE", record: { status: { isFile: () => false, isSymbolicLink: () => true } } },
    { name: "database-mismatch", target: "PROOFLINE_BACKUP_BOOTSTRAP_DATABASE_URL_FILE", record: { bytes: Buffer.from("different") } },
    { name: "access-mismatch", target: "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE", record: { bytes: Buffer.from("different") } },
    { name: "secret-mismatch", target: "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE", record: { bytes: Buffer.from("different") } },
  ];
  for (const entry of failures) {
    let effects = 0;
    await assert.rejects(module.validateTimewebProductionSecretInventory({
      environment: entry.env ?? environment,
      inspectSecretRoot: async () => entry.root ?? rootStatus(),
      captureSecretFile: async (path, name) => fileRecord(name, name === entry.target ? entry.record : {}),
      effect: async () => { effects += 1; },
    }), (cause) => cause?.code === "TIMEWEB_PRODUCTION_SECRET_INVENTORY_INVALID" && !JSON.stringify(cause).includes("shared-secret"));
    assert.equal(effects, 0, entry.name);
  }
});

test("uses O_NOFOLLOW capture and validates in every production entry before Docker", async () => {
  const [inventory, host, wrapper, pilotBackup, daily, live, canary, pitr] = await Promise.all([
    readFile(resolve(root, "scripts/timeweb-production-secret-inventory.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-host-command.mjs"), "utf8"),
    readFile(resolve(root, "scripts/compose-production.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-pilot-backup.mjs"), "utf8"),
    readFile(resolve(root, "scripts/run-timeweb-daily-backup.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-live-runs.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-canary-observation.mjs"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-pitr.mjs"), "utf8"),
  ]);
  assert.match(inventory, /O_NOFOLLOW/);
  assert.match(inventory, /handle\.stat\s*\(/);
  assert.match(inventory, /status\.uid[\s\S]*status\.gid/);
  assert.match(inventory, /timingSafeEqual/);
  for (const [name, source] of Object.entries({ host, pilotBackup, daily, canary })) {
    assert.match(source, /validateTimewebProductionSecretInventory\s*\(/, name);
  }
  assert.match(live, /validateSecretInventory\s*\(\s*\{\s*environment\s*\}/);
  assert.match(pitr, /runDefaultTimewebProductionPitr[\s\S]*validateSecretInventory\s*\(\s*\{\s*environment:\s*effectEnvironment\s*\}/);
  assert.match(pitr, /runSelectedTimewebProductionPitr[\s\S]*validateSecretInventory\s*\(\s*\{\s*environment:\s*effectEnvironment\s*\}/);
  assert.match(pitr, /switchAndObserveProductionWalArchive[\s\S]*validateSecretInventory\s*\(\s*\{\s*environment:\s*effectEnvironment\s*\}/);
  assert.match(wrapper, /validateSecretInventory\s*\(\s*\{\s*environment:/);
});

test("blocks the exported default PITR runner before its first phase when inventory is invalid", async () => {
  const module = await import(`../../scripts/timeweb-production-pitr.mjs?inventory=${Date.now()}-${Math.random()}`);
  let effects = 0;
  await assert.rejects(module.runDefaultTimewebProductionPitr({
    productionRunId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    runner: async () => { effects += 1; return { status: "passed" }; },
    validateSecretInventory: async () => { throw Object.assign(new Error("inventory"), { code: "TIMEWEB_PRODUCTION_SECRET_INVENTORY_INVALID" }); },
  }), /TIMEWEB_PRODUCTION_PITR_FAILED|inventory/i);
  assert.equal(effects, 0);
});

test("blocks selected PITR and WAL switch exports before their first effect when inventory is invalid", async () => {
  const module = await import(`../../scripts/timeweb-production-pitr.mjs?selected-inventory=${Date.now()}-${Math.random()}`);
  const invalidInventory = async () => {
    throw Object.assign(new Error("inventory"), { code: "TIMEWEB_PRODUCTION_SECRET_INVENTORY_INVALID" });
  };
  let selectedEffects = 0;
  await assert.rejects(module.runSelectedTimewebProductionPitr({
    productionRunId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    backupEvidenceBytes: Buffer.from("{}"),
    archivePendingAgeSeconds: 0,
    runner: async () => { selectedEffects += 1; return { status: "passed" }; },
    validateSecretInventory: invalidInventory,
  }), /TIMEWEB_PRODUCTION_PITR_FAILED|inventory/i);
  assert.equal(selectedEffects, 0);

  let walEffects = 0;
  await assert.rejects(module.switchAndObserveProductionWalArchive({
    validateSecretInventory: invalidInventory,
    switchWal: async () => { walEffects += 1; return { status: "passed" }; },
    observeWal: async () => { walEffects += 1; return { status: "passed" }; },
  }), /inventory/i);
  assert.equal(walEffects, 0);
});

test("binds one frozen validated environment to all twelve PITR effect and cleanup envelopes", async () => {
  const module = await import(`../../scripts/timeweb-production-pitr.mjs?bound-environment=${Date.now()}-${Math.random()}`);
  const validation = await import(`../../scripts/backup-evidence-validation.mjs?bound-environment=${Date.now()}-${Math.random()}`);
  const sha = (value) => `sha256:${value.repeat(64)}`;
  const entries = [{
    key: "basebackups_005/base_00000001000000000000000A/tar_partitions/part_001.tar.lz4",
    size: 1,
    sha256: sha("6"),
  }];
  const inventory = { entries, objectCount: 1, totalBytes: 1 };
  const evidence = {
    version: "1",
    kind: "base-backup",
    producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40), postgresImageDigest: sha("c"), walGVersion: "v3.0.8" },
    database: { slot: "production", systemIdentifier: "7532076200787175519", postgresMajor: 17, schemaVersion: 10, migrationCount: 10, migrationManifestSha256: sha("d") },
    storage: { provider: "timeweb-s3", endpointOrigin: "https://s3.twcstorage.ru", region: "ru-1", addressing: "path-style", authorityMode: "shared-pilot", bucket: "orivra-backet", prefix: "s3://orivra-backet/proofline/v1/production/7532076200787175519", encryption: "wal-g-libsodium", encryptionKeyIdSha256: sha("e") },
    backup: { id: "base_00000001000000000000000A", startedAt: "2026-08-12T03:00:00.000000Z", completedAt: "2026-08-12T03:01:00.000000Z", startLsn: "0/A000028", stopLsn: "0/B0001F8", startWalSegment: "00000001000000000000000A", stopWalSegment: "00000001000000000000000B", timeline: 1 },
    inventory: { ...inventory, canonicalSha256: validation.sha256(Buffer.from(validation.canonicalJson(inventory), "utf8")) },
    status: "completed",
  };
  const backupEvidenceBytes = Buffer.from(validation.canonicalJson(evidence), "utf8");
  const sourceEnvironment = { PROOFLINE_SENTINEL: "verified" };
  const calls = [];
  const validateSecretInventory = async ({ environment: received }) => {
    assert.notEqual(received, sourceEnvironment);
    assert.equal(Object.isFrozen(received), true);
    assert.equal(received.PROOFLINE_SENTINEL, "verified");
    sourceEnvironment.PROOFLINE_SENTINEL = "mutated-after-validation";
  };
  const resultFor = (input) => {
    if (input.phase === "create-base-backup") return { status: "passed" };
    if (input.phase === "switch-wal-after-backup") return { status: "passed", switchedWalSegment: "00000001000000000000000B" };
    if (input.phase === "observe-switched-wal-archived") return { status: "passed", source: "postgres-archive-status", switchedWalSegment: "00000001000000000000000B", archivePendingAgeSeconds: 0 };
    if (input.phase === "select-backup") return { status: "passed", backupId: evidence.backup.id, encrypted: true, backupCompletedAt: evidence.backup.completedAt, lastArchivedAt: evidence.backup.completedAt, systemIdentifier: evidence.database.systemIdentifier, timeline: 1 };
    if (input.phase === "create-fresh-volume") return { status: "passed", wasAbsent: true, volumeId: `proofline-pitr-${input.productionRunId}` };
    if (input.phase === "restore-selected-backup") return { status: "passed", backupId: input.selected.backupId, volumeId: input.volumeId };
    if (input.phase === "verify-restored-database") return { status: "passed", schemaVersion: 10, restoreEvidenceSha256: sha("f") };
    if (input.phase === "remove-fresh-volume") return { status: "passed", removed: true };
    throw new Error("phase");
  };
  const runner = async (input) => { calls.push(input); return resultFor(input); };
  await module.runDefaultTimewebProductionPitr({
    productionRunId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    runner,
    environment: sourceEnvironment,
    validateSecretInventory,
    clock: { now: () => "2026-08-12T03:02:00Z" },
  });
  sourceEnvironment.PROOFLINE_SENTINEL = "verified";
  await module.runSelectedTimewebProductionPitr({
    productionRunId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    backupEvidenceBytes,
    archivePendingAgeSeconds: 0,
    runner,
    environment: sourceEnvironment,
    validateSecretInventory,
    clock: { now: () => "2026-08-12T03:02:00Z" },
  });
  assert.equal(calls.length, 12);
  const defaultBound = calls[0].environment;
  const selectedBound = calls[8].environment;
  assert.ok(calls.slice(0, 8).every(({ environment: received }) => received === defaultBound));
  assert.ok(calls.slice(8).every(({ environment: received }) => received === selectedBound));
  assert.notEqual(defaultBound, selectedBound);
  assert.equal(defaultBound.PROOFLINE_SENTINEL, "verified");
  assert.equal(selectedBound.PROOFLINE_SENTINEL, "verified");
  assert.equal(Object.isFrozen(defaultBound), true);
  assert.equal(Object.isFrozen(selectedBound), true);
});
