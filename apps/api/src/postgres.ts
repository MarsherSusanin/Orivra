import { createHmac, randomUUID } from "node:crypto";
import { appendRunEvents, projectRun } from "@proofline/domain";
import { RunEventV1Schema, type RunEventV1 } from "@proofline/contracts";

export function digestOpaqueToken(rawToken: string, digestKey: string): Uint8Array {
  return new Uint8Array(
    createHmac("sha256", digestKey).update(rawToken, "utf8").digest(),
  );
}

export const POSTGRES_QUERIES = {
  claimNextCommand: `
    WITH candidate AS (
      SELECT id
      FROM proofline_private.run_commands
      WHERE (
        status = 'queued' AND available_at <= now()
      ) OR (
        status = 'leased' AND lease_expires_at <= now()
      )
      ORDER BY available_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE proofline_private.run_commands AS command
    SET status = 'leased',
        lease_token = $1,
        lease_expires_at = now() + $2::interval,
        attempts = attempts + 1
    FROM candidate
    WHERE command.id = candidate.id
    RETURNING command.*
  `,
  lockRun:
    "SELECT last_sequence, projection FROM proofline_private.runs WHERE id = $1 FOR UPDATE",
  loadEvents:
    "SELECT event_payload FROM proofline_private.run_events WHERE run_id = $1 ORDER BY sequence",
  insertEvent: `
    INSERT INTO proofline_private.run_events
      (run_id, sequence, dedupe_key, event_type, event_payload, occurred_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  `,
  updateProjection: `
    UPDATE proofline_private.runs
    SET projection = $2::jsonb, last_sequence = $3, updated_at = now()
    WHERE id = $1
  `,
  completeCommand: `
    UPDATE proofline_private.run_commands
    SET status = 'succeeded',
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = $1
      AND lease_token = $2::uuid
      AND status = 'leased'
      AND lease_expires_at > now()
    RETURNING id
  `,
  retryCommand: `
    UPDATE proofline_private.run_commands
    SET status = CASE WHEN $3::boolean THEN 'queued' ELSE 'dead' END,
        available_at = CASE
          WHEN $3::boolean THEN now() + make_interval(secs => LEAST(300, (2 ^ LEAST(attempts, 8))::integer))
          ELSE available_at
        END,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = $4::jsonb,
        updated_at = now()
    WHERE id = $1
      AND lease_token = $2::uuid
      AND status = 'leased'
      AND lease_expires_at > now()
    RETURNING id
  `,
} as const;

interface QueryResult {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
}

interface SqlClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface SqlPool {
  connect(): Promise<SqlClient>;
}

async function appendEventInTransaction(
  client: SqlClient,
  event: RunEventV1,
): Promise<void> {
  const locked = await client.query(POSTGRES_QUERIES.lockRun, [event.runId]);
  if (locked.rowCount !== 1) throw new Error("Run sequence conflict: run not found");
  const lastSequence = Number(locked.rows[0]?.last_sequence ?? 0);
  const prior = await client.query(POSTGRES_QUERIES.loadEvents, [event.runId]);
  const existing = prior.rows.map((row) =>
    RunEventV1Schema.parse(row.event_payload),
  );
  const journal = appendRunEvents(existing, [event]);
  if (journal.length === existing.length) return;
  if (lastSequence !== event.sequence - 1) {
    throw new Error(
      `Run sequence conflict: expected ${lastSequence + 1}, received ${event.sequence}`,
    );
  }
  await client.query(POSTGRES_QUERIES.insertEvent, [
    event.runId,
    event.sequence,
    event.commandId,
    event.type,
    JSON.stringify(event),
    event.occurredAt,
  ]);
  const projection = projectRun(journal);
  await client.query(POSTGRES_QUERIES.updateProjection, [
    event.runId,
    JSON.stringify(projection),
    event.sequence,
  ]);
}

export function createPostgresRunRepository(input: {
  pool: SqlPool;
  tokenDigestKey: string;
}) {
  return {
    digestToken(rawToken: string) {
      return digestOpaqueToken(rawToken, input.tokenDigestKey);
    },
    async appendEvent(event: RunEventV1): Promise<void> {
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        await appendEventInTransaction(client, RunEventV1Schema.parse(event));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createPostgresCommandRepository(input: { pool: SqlPool }) {
  return {
    async claimNextCommand() {
      const client = await input.pool.connect();
      const claimToken = randomUUID();
      try {
        await client.query("BEGIN");
        const result = await client.query(POSTGRES_QUERIES.claimNextCommand, [
          claimToken,
          "30 seconds",
        ]);
        await client.query("COMMIT");
        const row = result.rows[0];
        if (!row) return null;
        return {
          claimToken,
          command: {
            id: String(row.id),
            kind: String(row.kind),
            runId: String(row.run_id),
            attempts: Number(row.attempts),
            payload:
              row.payload && typeof row.payload === "object"
                ? (row.payload as Record<string, unknown>)
                : {},
          },
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeCommand(
      commandId: string,
      claimToken: string,
      output?: unknown,
    ): Promise<void> {
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        if (output && typeof output === "object") {
          const result = output as {
            events?: unknown[];
            artifacts?: Array<{
              id: string;
              runId: string;
              kind: string;
              canonicalBytes: Uint8Array;
              sha256: Uint8Array;
              metadata?: Record<string, unknown>;
            }>;
          };
          for (const event of result.events ?? []) {
            await appendEventInTransaction(client, RunEventV1Schema.parse(event));
          }
          for (const artifact of result.artifacts ?? []) {
            await client.query(
              `INSERT INTO proofline_private.run_artifacts
                (id, run_id, kind, canonical_bytes, sha256, metadata)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (run_id, kind, sha256) DO NOTHING`,
              [
                artifact.id,
                artifact.runId,
                artifact.kind,
                artifact.canonicalBytes,
                artifact.sha256,
                JSON.stringify(artifact.metadata ?? {}),
              ],
            );
          }
        }
        const result = await client.query(POSTGRES_QUERIES.completeCommand, [
          commandId,
          claimToken,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Command lease is stale; completion rejected");
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async retryCommand(
      commandId: string,
      claimToken: string,
      failure: Record<string, unknown>,
    ): Promise<void> {
      const client = await input.pool.connect();
      try {
        const result = await client.query(POSTGRES_QUERIES.retryCommand, [
          commandId,
          claimToken,
          failure.retryable === true,
          JSON.stringify(failure),
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Command lease is stale; retry rejected");
        }
      } finally {
        client.release();
      }
    },
  };
}
