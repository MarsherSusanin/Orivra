import manifest from "../db/migrations/manifest.v1.json";

export const DEPLOYMENT_SCHEMA_VERSION = 10;

const DEPLOYMENT_ID_PATTERN = /^deployment_[a-f0-9]{64}$/;
const RELEASE_TREE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SCHEMA_ERROR_CODE = "DEPLOYMENT_SCHEMA_INVALID";
const SCHEMA_ERROR_MESSAGE = "Deployment schema verification failed";

type QueryResult = {
  rowCount: number | null;
  rows: readonly Record<string, unknown>[];
};

export type DeploymentQueryPool = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
};

export type DeploymentIdentity = Readonly<{
  deploymentId: string;
  releaseTreeSha: string;
}>;

export type DeploymentSchemaStatus = Readonly<{
  schemaVersion: number;
  checksumCount: number;
  checksumMatch: boolean;
}>;

export class DeploymentSchemaVerificationError extends Error {
  readonly code = SCHEMA_ERROR_CODE;

  constructor() {
    super(SCHEMA_ERROR_MESSAGE);
    this.name = "DeploymentSchemaVerificationError";
  }
}

function schemaInvalid(): never {
  throw new DeploymentSchemaVerificationError();
}

function manifestEntries(): Array<{
  version: number;
  filename: string;
  sha256: string;
}> {
  const entries = manifest.migrations;
  if (
    manifest.version !== "1" ||
    manifest.schema.targetVersion !== DEPLOYMENT_SCHEMA_VERSION ||
    manifest.schema.minimumCompatibleVersion !== DEPLOYMENT_SCHEMA_VERSION ||
    manifest.schema.maximumCompatibleVersion !== DEPLOYMENT_SCHEMA_VERSION ||
    entries.length !== DEPLOYMENT_SCHEMA_VERSION
  ) {
    schemaInvalid();
  }
  for (const [index, entry] of entries.entries()) {
    if (
      entry.version !== index + 1 ||
      !new RegExp(`^${String(entry.version).padStart(3, "0")}_[a-z0-9_]+\\.sql$`)
        .test(entry.filename) ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      schemaInvalid();
    }
  }
  return entries;
}

const EXPECTED_LEDGER_VALUES_SQL = manifestEntries()
  .map(({ version, filename, sha256 }) =>
    `(${version}, '${filename}', decode('${sha256.slice("sha256:".length)}', 'hex'))`
  )
  .join(",\n    ");

export const DEPLOYMENT_SCHEMA_CTE_SQL = `
WITH expected(version, filename, sha256) AS (
  VALUES
    ${EXPECTED_LEDGER_VALUES_SQL}
), actual AS (
  SELECT
    COALESCE(migrations.version, checksums.version) AS version,
    migrations.version AS applied_version,
    checksums.filename,
    checksums.sha256
  FROM proofline_private.schema_migrations AS migrations
  FULL JOIN proofline_private.migration_checksums AS checksums
    ON checksums.version = migrations.version
), schema_status AS (
  SELECT
    COALESCE((SELECT MAX(version) FROM proofline_private.schema_migrations), 0)::integer
      AS schema_version,
    (SELECT COUNT(*) FROM proofline_private.migration_checksums)::integer
      AS checksum_count,
    NOT EXISTS (
      SELECT 1
      FROM expected
      FULL JOIN actual USING (version)
      WHERE expected.version IS NULL
         OR actual.version IS NULL
         OR actual.applied_version IS NULL
         OR expected.filename IS DISTINCT FROM actual.filename
         OR expected.sha256 IS DISTINCT FROM actual.sha256
    ) AS checksum_match
)
`;

export const DEPLOYMENT_SCHEMA_STATUS_SQL = `${DEPLOYMENT_SCHEMA_CTE_SQL}
SELECT schema_version, checksum_count, checksum_match
FROM schema_status
WHERE $1::integer = 10
`;

export function parseDeploymentIdentity(
  environment: Record<string, string | undefined>,
  _boundary?: unknown,
): DeploymentIdentity {
  const deploymentId = environment.PROOFLINE_DEPLOYMENT_ID?.trim() ?? "";
  const releaseTreeSha = environment.PROOFLINE_RELEASE_TREE_SHA?.trim() ?? "";
  if (
    !DEPLOYMENT_ID_PATTERN.test(deploymentId) ||
    !RELEASE_TREE_SHA_PATTERN.test(releaseTreeSha)
  ) {
    throw new Error("Deployment identity or release configuration is invalid");
  }
  return Object.freeze({ deploymentId, releaseTreeSha });
}

function parseSchemaStatus(row: Record<string, unknown> | undefined): DeploymentSchemaStatus {
  if (!row) schemaInvalid();
  const schemaVersion = Number(row.schema_version);
  const checksumCount = Number(row.checksum_count);
  if (!Number.isInteger(schemaVersion) || !Number.isInteger(checksumCount)) {
    schemaInvalid();
  }
  return {
    schemaVersion,
    checksumCount,
    checksumMatch: row.checksum_match === true,
  };
}

export function isExactDeploymentSchema(status: DeploymentSchemaStatus): boolean {
  return status.schemaVersion === DEPLOYMENT_SCHEMA_VERSION &&
    status.checksumCount === DEPLOYMENT_SCHEMA_VERSION &&
    status.checksumMatch;
}

export async function readDeploymentSchemaStatus(
  pool: DeploymentQueryPool,
): Promise<DeploymentSchemaStatus> {
  try {
    const result = await pool.query(DEPLOYMENT_SCHEMA_STATUS_SQL, [
      DEPLOYMENT_SCHEMA_VERSION,
    ]);
    return parseSchemaStatus(result.rows[0]);
  } catch (cause) {
    if (cause instanceof DeploymentSchemaVerificationError) throw cause;
    schemaInvalid();
  }
}

export async function verifyDeploymentSchema(input: {
  pool: DeploymentQueryPool;
}): Promise<void> {
  const status = await readDeploymentSchemaStatus(input.pool);
  if (!isExactDeploymentSchema(status)) schemaInvalid();
}
