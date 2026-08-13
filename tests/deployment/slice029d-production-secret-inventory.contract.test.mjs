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
  assert.match(pitr, /runDefaultTimewebProductionPitr[\s\S]*validateSecretInventory\s*\(\s*\{\s*environment\s*\}/);
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
