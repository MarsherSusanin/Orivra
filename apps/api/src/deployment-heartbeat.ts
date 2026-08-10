import { randomUUID } from "node:crypto";
import type { DeploymentIdentity } from "./deployment-lifecycle";

const HEARTBEAT_ERROR_CODE = "DEPLOYMENT_HEARTBEAT_FAILED";
const HEARTBEAT_ERROR_MESSAGE = "Deployment heartbeat failed";

type QueryResult = {
  rowCount: number | null;
  rows: readonly Record<string, unknown>[];
};

type HeartbeatQuery = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
};

type HeartbeatClient = HeartbeatQuery & { release(): void };

type HeartbeatPool = HeartbeatQuery & {
  connect?(): Promise<HeartbeatClient>;
};

export type DeploymentWorkerIdentity = DeploymentIdentity & Readonly<{
  workerInstanceId: string;
}>;

export class DeploymentHeartbeatError extends Error {
  readonly code = HEARTBEAT_ERROR_CODE;

  constructor() {
    super(HEARTBEAT_ERROR_MESSAGE);
    this.name = "DeploymentHeartbeatError";
  }
}

function heartbeatFailed(): never {
  throw new DeploymentHeartbeatError();
}

export function createDeploymentWorkerIdentity(
  identity: DeploymentIdentity,
): DeploymentWorkerIdentity {
  return Object.freeze({ ...identity, workerInstanceId: randomUUID() });
}

function exactValues(identity: DeploymentWorkerIdentity): readonly string[] {
  return [
    identity.deploymentId,
    identity.workerInstanceId,
    identity.releaseTreeSha,
  ];
}

export function createPostgresDeploymentHeartbeatStore(input: {
  pool: HeartbeatPool;
}) {
  return {
    async start(identity: DeploymentWorkerIdentity): Promise<void> {
      try {
        const result = await input.pool.query(`
INSERT INTO proofline_private.deployment_worker_heartbeats
  (deployment_id, worker_instance_id, release_tree_sha, started_at, last_heartbeat_at)
VALUES
  ($1, $2, $3,
   date_trunc('milliseconds', clock_timestamp()),
   date_trunc('milliseconds', clock_timestamp()))
`, exactValues(identity));
        if (result.rowCount !== 1) heartbeatFailed();
      } catch (cause) {
        if (cause instanceof DeploymentHeartbeatError) throw cause;
        heartbeatFailed();
      }
    },

    async refreshAndCleanup(identity: DeploymentWorkerIdentity): Promise<void> {
      if (!input.pool.connect) heartbeatFailed();
      const client = await input.pool.connect().catch(() => heartbeatFailed());
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const refreshed = await client.query(`
UPDATE proofline_private.deployment_worker_heartbeats
SET last_heartbeat_at = date_trunc('milliseconds', clock_timestamp())
WHERE deployment_id = $1
  AND worker_instance_id = $2
  AND release_tree_sha = $3
  AND stopped_at IS NULL
`, exactValues(identity));
        if (refreshed.rowCount !== 1) heartbeatFailed();
        await client.query(`
WITH expired AS (
  SELECT deployment_id, worker_instance_id
  FROM proofline_private.deployment_worker_heartbeats
  WHERE last_heartbeat_at < clock_timestamp() - interval '7 days'
    AND NOT (deployment_id = $1 AND worker_instance_id = $2)
  ORDER BY last_heartbeat_at, deployment_id, worker_instance_id
  FOR UPDATE SKIP LOCKED
  LIMIT 100
)
DELETE FROM proofline_private.deployment_worker_heartbeats AS heartbeat
USING expired
WHERE heartbeat.deployment_id = expired.deployment_id
  AND heartbeat.worker_instance_id = expired.worker_instance_id
`, exactValues(identity));
        await client.query("COMMIT");
        transactionOpen = false;
      } catch {
        if (transactionOpen) {
          await client.query("ROLLBACK").catch(() => undefined);
        }
        heartbeatFailed();
      } finally {
        client.release();
      }
    },

    async stop(identity: DeploymentWorkerIdentity): Promise<void> {
      try {
        const result = await input.pool.query(`
UPDATE proofline_private.deployment_worker_heartbeats
SET stopped_at = date_trunc('milliseconds', clock_timestamp())
WHERE deployment_id = $1
  AND worker_instance_id = $2
  AND release_tree_sha = $3
  AND stopped_at IS NULL
`, exactValues(identity));
        if (result.rowCount !== 1) heartbeatFailed();
      } catch (cause) {
        if (cause instanceof DeploymentHeartbeatError) throw cause;
        heartbeatFailed();
      }
    },
  };
}
