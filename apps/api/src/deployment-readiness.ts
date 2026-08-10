import {
  DeploymentReadinessV1Schema,
  type DeploymentReadinessV1,
} from "@proofline/contracts/deployment";
import {
  DEPLOYMENT_SCHEMA_CTE_SQL,
  DEPLOYMENT_SCHEMA_VERSION,
  isExactDeploymentSchema,
  type DeploymentIdentity,
  type DeploymentQueryPool,
  type DeploymentSchemaStatus,
} from "./deployment-lifecycle";

const WORKER_STALE_AFTER_SECONDS = 30;

const READINESS_SQL = `${DEPLOYMENT_SCHEMA_CTE_SQL}
SELECT
  schema_status.schema_version,
  schema_status.checksum_count,
  schema_status.checksum_match,
  (
    SELECT CASE
      WHEN heartbeat.last_heartbeat_at > clock_timestamp() THEN 'unavailable'
      WHEN heartbeat.last_heartbeat_at >=
        clock_timestamp() - interval '${WORKER_STALE_AFTER_SECONDS} seconds'
        THEN 'ready'
      ELSE 'stale'
    END
    FROM proofline_private.deployment_worker_heartbeats AS heartbeat
    WHERE heartbeat.deployment_id = $1
      AND heartbeat.release_tree_sha = $2
      AND heartbeat.stopped_at IS NULL
    ORDER BY heartbeat.last_heartbeat_at DESC
    LIMIT 1
  ) AS worker_state
FROM schema_status
WHERE $3::integer = 10
`;

function unavailable(): DeploymentReadinessV1 {
  return {
    version: "1",
    status: "not-ready",
    checks: {
      database: "unavailable",
      schema: "unavailable",
      worker: "unavailable",
    },
  };
}

export function createPostgresDeploymentReadiness(
  input: { pool: DeploymentQueryPool } & DeploymentIdentity,
): { check(): Promise<DeploymentReadinessV1> } {
  return {
    async check(): Promise<DeploymentReadinessV1> {
      try {
        const result = await input.pool.query(READINESS_SQL, [
          input.deploymentId,
          input.releaseTreeSha,
          DEPLOYMENT_SCHEMA_VERSION,
        ]);
        const row = result.rows[0];
        if (!row) return unavailable();
        const schemaStatus: DeploymentSchemaStatus = {
          schemaVersion: Number(row.schema_version),
          checksumCount: Number(row.checksum_count),
          checksumMatch: row.checksum_match === true,
        };
        if (!isExactDeploymentSchema(schemaStatus)) {
          return {
            version: "1",
            status: "not-ready",
            checks: {
              database: "ready",
              schema: "mismatch",
              worker: "unavailable",
            },
          };
        }
        const worker = row.worker_state === "ready" ||
            row.worker_state === "stale" ||
            row.worker_state === "missing"
          ? row.worker_state
          : row.worker_state === null || row.worker_state === undefined
          ? "missing"
          : "unavailable";
        return DeploymentReadinessV1Schema.parse({
          version: "1",
          status: worker === "ready" ? "ready" : "not-ready",
          checks: { database: "ready", schema: "ready", worker },
        });
      } catch {
        return unavailable();
      }
    },
  };
}
