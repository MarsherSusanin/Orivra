import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { grantApplicationRoleMemberships } from "./db-role-bootstrap";

export const PROOFLINE_SCHEMA_VERSION = 10;
export const MIGRATION_ADVISORY_LOCK = -4_708_329_426_407_388_777n;
export const MIGRATION_STATEMENT_TIMEOUT_MS = 60_000;

const MANIFEST_FILENAME = "manifest.v1.json";
const TRANSACTION_PREFIX = "BEGIN;\n";
const TRANSACTION_SUFFIX = "\nCOMMIT;\n";

const MIGRATION_ERROR_MESSAGES = {
  MIGRATION_MANIFEST_INVALID: "Migration manifest is invalid",
  MIGRATION_LOCK_TIMEOUT: "Migration lock timed out",
  MIGRATION_HISTORY_UNVERIFIED: "Migration history is unverified",
  MIGRATION_CHECKSUM_MISMATCH: "Migration checksum does not match",
  MIGRATION_VERSION_GAP: "Migration history has a version gap",
  MIGRATION_DATABASE_AHEAD: "Database schema is ahead of this release",
  MIGRATION_APPLY_FAILED: "Migration application failed",
  MIGRATION_TARGET_MISMATCH: "Migration target verification failed",
} as const;

export type MigrationErrorCode = keyof typeof MIGRATION_ERROR_MESSAGES;

export class MigrationOperationError extends Error {
  readonly code: MigrationErrorCode;
  readonly version?: number;

  constructor(code: MigrationErrorCode, version?: number) {
    super(MIGRATION_ERROR_MESSAGES[code]);
    this.name = "MigrationOperationError";
    this.code = code;
    if (version !== undefined) this.version = version;
  }
}

type MigrationManifestEntry = {
  version: number;
  filename: string;
  sha256: string;
};

type MigrationManifest = {
  version: "1";
  lockKey: "-4708329426407388777";
  schema: {
    targetVersion: 10;
    minimumCompatibleVersion: 10;
    maximumCompatibleVersion: 10;
  };
  migrations: MigrationManifestEntry[];
};

export type VerifiedMigrationPlan = {
  manifest: Omit<MigrationManifest, "migrations">;
  migrations: Array<MigrationManifestEntry & { body: string }>;
};

type MigrationHistory = {
  schemaMigrationsExists?: boolean;
  checksumLedgerExists?: boolean;
  versions: number[];
  checksums: Array<MigrationManifestEntry>;
};

type QueryResult = {
  rowCount: number | null;
  rows: readonly Record<string, unknown>[];
};

type MigrationClient = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
};

type MigrationPool = {
  connect(): Promise<MigrationClient>;
};

type MigrationLogger = {
  info(value: Record<string, unknown>): void;
  error(value: Record<string, unknown>): void;
};

function migrationError(code: MigrationErrorCode, version?: number): MigrationOperationError {
  return new MigrationOperationError(code, version);
}

function manifestInvalid(): never {
  throw migrationError("MIGRATION_MANIFEST_INVALID");
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function parseMigrationManifest(value: unknown): MigrationManifest {
  if (!isExactObject(value, ["version", "lockKey", "schema", "migrations"])) {
    manifestInvalid();
  }
  if (value.version !== "1" || value.lockKey !== String(MIGRATION_ADVISORY_LOCK)) {
    manifestInvalid();
  }
  if (!isExactObject(value.schema, [
    "targetVersion",
    "minimumCompatibleVersion",
    "maximumCompatibleVersion",
  ])) {
    manifestInvalid();
  }
  if (
    value.schema.targetVersion !== PROOFLINE_SCHEMA_VERSION ||
    value.schema.minimumCompatibleVersion !== PROOFLINE_SCHEMA_VERSION ||
    value.schema.maximumCompatibleVersion !== PROOFLINE_SCHEMA_VERSION ||
    !Array.isArray(value.migrations) ||
    value.migrations.length !== PROOFLINE_SCHEMA_VERSION
  ) {
    manifestInvalid();
  }

  const migrations = value.migrations.map((entry, index) => {
    if (!isExactObject(entry, ["version", "filename", "sha256"])) {
      manifestInvalid();
    }
    const version = index + 1;
    if (
      entry.version !== version ||
      !Number.isInteger(entry.version) ||
      typeof entry.filename !== "string" ||
      !new RegExp(`^${String(version).padStart(3, "0")}_[a-z0-9_]+\\.sql$`).test(entry.filename) ||
      typeof entry.sha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      manifestInvalid();
    }
    return {
      version,
      filename: entry.filename,
      sha256: entry.sha256,
    };
  });

  return {
    version: "1",
    lockKey: "-4708329426407388777",
    schema: {
      targetVersion: PROOFLINE_SCHEMA_VERSION,
      minimumCompatibleVersion: PROOFLINE_SCHEMA_VERSION,
      maximumCompatibleVersion: PROOFLINE_SCHEMA_VERSION,
    },
    migrations,
  };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    manifestInvalid();
  }
}

export async function loadVerifiedMigrationPlan(input: {
  migrationsDirectory: string;
  pool?: unknown;
}): Promise<VerifiedMigrationPlan> {
  try {
    const manifestText = decodeUtf8(
      await readFile(join(input.migrationsDirectory, MANIFEST_FILENAME)),
    );
    const manifest = parseMigrationManifest(JSON.parse(manifestText));
    const expectedNames = [MANIFEST_FILENAME, ...manifest.migrations.map(({ filename }) => filename)]
      .sort();
    const actualNames = (await readdir(input.migrationsDirectory)).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      manifestInvalid();
    }

    const migrations = [] as VerifiedMigrationPlan["migrations"];
    for (const entry of manifest.migrations) {
      const bytes = await readFile(join(input.migrationsDirectory, entry.filename));
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const source = decodeUtf8(bytes);
      if (
        digest !== entry.sha256 ||
        !source.startsWith(TRANSACTION_PREFIX) ||
        !source.endsWith(TRANSACTION_SUFFIX)
      ) {
        manifestInvalid();
      }
      const body = source.slice(TRANSACTION_PREFIX.length, -TRANSACTION_SUFFIX.length);
      if (!body.trim() || /^(?:BEGIN|COMMIT|ROLLBACK);\s*$/im.test(body)) {
        manifestInvalid();
      }
      migrations.push({ ...entry, body });
    }

    const { migrations: _entries, ...authority } = manifest;
    return { manifest: authority, migrations };
  } catch (cause) {
    if (cause instanceof MigrationOperationError) throw cause;
    manifestInvalid();
  }
}

export function verifyMigrationHistory(
  plan: VerifiedMigrationPlan,
  history: MigrationHistory,
): { kind: "fresh" | "pending" | "current"; fromVersion: number } {
  const schemaExists = history.schemaMigrationsExists ?? true;
  const ledgerExists = history.checksumLedgerExists ?? true;
  if (!schemaExists && !ledgerExists) {
    if (history.versions.length !== 0 || history.checksums.length !== 0) {
      throw migrationError("MIGRATION_HISTORY_UNVERIFIED");
    }
    return { kind: "fresh", fromVersion: 0 };
  }
  if (!schemaExists || !ledgerExists) {
    throw migrationError("MIGRATION_HISTORY_UNVERIFIED");
  }

  const targetVersion = plan.manifest.schema.targetVersion;
  if (history.versions.some((version) => !Number.isInteger(version) || version > targetVersion)) {
    throw migrationError("MIGRATION_DATABASE_AHEAD");
  }
  for (let index = 0; index < history.versions.length; index += 1) {
    if (history.versions[index] !== index + 1) {
      throw migrationError("MIGRATION_VERSION_GAP");
    }
  }
  if (history.versions.length === 0 || history.checksums.length !== history.versions.length) {
    throw migrationError("MIGRATION_HISTORY_UNVERIFIED");
  }

  for (let index = 0; index < history.versions.length; index += 1) {
    const expected = plan.migrations[index];
    const actual = history.checksums[index];
    if (
      actual?.version !== expected?.version ||
      actual?.filename !== expected?.filename ||
      actual?.sha256 !== expected?.sha256
    ) {
      throw migrationError("MIGRATION_CHECKSUM_MISMATCH", expected?.version);
    }
  }

  const fromVersion = history.versions.length;
  return fromVersion === targetVersion
    ? { kind: "current", fromVersion }
    : { kind: "pending", fromVersion };
}

export function verifyMigrationTarget(
  plan: VerifiedMigrationPlan,
  history: Pick<MigrationHistory, "versions" | "checksums">,
): void {
  const verified = verifyMigrationHistory(plan, {
    schemaMigrationsExists: true,
    checksumLedgerExists: true,
    ...history,
  });
  if (verified.kind !== "current") {
    throw migrationError("MIGRATION_TARGET_MISMATCH");
  }
}

async function readMigrationHistory(
  client: MigrationClient,
  tablesKnownToExist = false,
): Promise<MigrationHistory> {
  let schemaMigrationsExists = tablesKnownToExist;
  let checksumLedgerExists = tablesKnownToExist;
  if (!tablesKnownToExist) {
    const existence = await client.query(`
SELECT
  to_regclass('proofline_private.schema_migrations')::text AS schema_migrations,
  to_regclass('proofline_private.migration_checksums')::text AS migration_checksums
`);
    const row = existence.rows[0] ?? {};
    schemaMigrationsExists = row.schema_migrations !== null && row.schema_migrations !== undefined;
    checksumLedgerExists = row.migration_checksums !== null && row.migration_checksums !== undefined;
  }
  if (!schemaMigrationsExists && !checksumLedgerExists) {
    return {
      schemaMigrationsExists,
      checksumLedgerExists,
      versions: [],
      checksums: [],
    };
  }

  const versions = schemaMigrationsExists
    ? await client.query(
      "SELECT version FROM proofline_private.schema_migrations ORDER BY version",
    )
    : { rows: [] };
  const checksums = checksumLedgerExists
    ? await client.query(`
SELECT
  migrations.version,
  checksums.filename,
  'sha256:' || encode(checksums.sha256, 'hex') AS sha256
FROM proofline_private.schema_migrations AS migrations
JOIN proofline_private.migration_checksums AS checksums USING (version)
ORDER BY migrations.version
`)
    : { rows: [] };
  return {
    schemaMigrationsExists,
    checksumLedgerExists,
    versions: versions.rows.map((row) => Number(row.version)),
    checksums: checksums.rows.map((row) => ({
      version: Number(row.version),
      filename: String(row.filename),
      sha256: String(row.sha256),
    })),
  };
}

async function insertChecksumLedger(
  client: MigrationClient,
  migrations: VerifiedMigrationPlan["migrations"],
): Promise<void> {
  if (migrations.length === 0) return;
  const values = migrations.flatMap(({ version, filename, sha256 }) => [
    version,
    filename,
    sha256,
  ]);
  const tuples = migrations.map((_, index) => {
    const offset = index * 3;
    return `($${offset + 1}, $${offset + 2}, decode(substring($${offset + 3} from 8), 'hex'))`;
  });
  await client.query(`
INSERT INTO proofline_private.migration_checksums (version, filename, sha256)
VALUES ${tuples.join(",\n       ")}
`, values);
}

const silentLogger: MigrationLogger = {
  info: () => undefined,
  error: () => undefined,
};

export async function runVerifiedMigrations(input: {
  pool: MigrationPool;
  plan: VerifiedMigrationPlan;
  logger?: MigrationLogger;
}): Promise<{ fromVersion: number; toVersion: number }> {
  const logger = input.logger ?? silentLogger;
  const client = await input.pool.connect();
  let locked = false;
  let transactionOpen = false;
  let result: { fromVersion: number; toVersion: number } | undefined;
  let failure: MigrationOperationError | undefined;

  try {
    await client.query(`SET statement_timeout = ${MIGRATION_STATEMENT_TIMEOUT_MS}`);
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK]);
      locked = true;
    } catch {
      throw migrationError("MIGRATION_LOCK_TIMEOUT");
    }

    const history = await readMigrationHistory(client);
    const state = verifyMigrationHistory(input.plan, history);
    if (state.kind === "current") {
      verifyMigrationTarget(input.plan, history);
      result = { fromVersion: state.fromVersion, toVersion: PROOFLINE_SCHEMA_VERSION };
    } else {
      await client.query("BEGIN");
      transactionOpen = true;
      const pending = input.plan.migrations.slice(state.fromVersion);
      for (const migration of pending) {
        logger.info({
          event: "MIGRATION_APPLYING",
          version: migration.version,
          filename: migration.filename,
        });
        await client.query(migration.body);
      }
      await insertChecksumLedger(client, pending);
      await grantApplicationRoleMemberships(client);
      const appliedHistory = await readMigrationHistory(client, true);
      verifyMigrationTarget(input.plan, appliedHistory);
      await client.query("COMMIT");
      transactionOpen = false;
      result = { fromVersion: state.fromVersion, toVersion: PROOFLINE_SCHEMA_VERSION };
      logger.info({
        event: "MIGRATION_COMPLETE",
        fromVersion: state.fromVersion,
        toVersion: PROOFLINE_SCHEMA_VERSION,
      });
    }
  } catch (cause) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }
    failure = cause instanceof MigrationOperationError
      ? cause
      : migrationError("MIGRATION_APPLY_FAILED");
    logger.error({
      event: "MIGRATION_FAILED",
      code: failure.code,
      ...(failure.version === undefined ? {} : { version: failure.version }),
    });
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK]);
      } catch {
        failure ??= migrationError("MIGRATION_APPLY_FAILED");
      }
    }
    client.release();
  }

  if (failure) throw failure;
  if (!result) throw migrationError("MIGRATION_APPLY_FAILED");
  return result;
}

export async function runProductionMigrations(input: {
  pool: MigrationPool;
  migrationsDirectory: string;
  logger?: MigrationLogger;
}): Promise<{ fromVersion: number; toVersion: number }> {
  const plan = await loadVerifiedMigrationPlan({
    migrationsDirectory: input.migrationsDirectory,
    pool: input.pool,
  });
  return runVerifiedMigrations({ pool: input.pool, plan, logger: input.logger });
}
