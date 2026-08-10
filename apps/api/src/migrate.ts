import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  MigrationOperationError,
  runProductionMigrations,
} from "./migration-runner";
import {
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from "./deployment-secrets";

const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);
const expectedMigrationsSuffix = "/apps/api/db/migrations";

export async function runMigrationEntry(
  environment: DeploymentEnvironment = process.env,
): Promise<{ fromVersion: number; toVersion: number }> {
  if (!migrationsDirectory.endsWith(expectedMigrationsSuffix)) {
    throw new MigrationOperationError("MIGRATION_MANIFEST_INVALID");
  }
  const resolvedEnvironment = await resolveDeploymentEnvironment(
    "migration-runner",
    environment,
  );
  const pool = new Pool({
    connectionString: resolvedEnvironment.DATABASE_URL,
    max: 1,
  });
  try {
    return await runProductionMigrations({ pool, migrationsDirectory });
  } finally {
    await pool.end();
  }
}

function boundedMigrationCode(value: unknown): string {
  return value instanceof MigrationOperationError
    ? value.code
    : "MIGRATION_APPLY_FAILED";
}

try {
  await runMigrationEntry();
} catch (error) {
  const code = boundedMigrationCode(error);
  console.error(JSON.stringify({ event: "MIGRATION_FAILED", code }));
  process.exitCode = 1;
}
