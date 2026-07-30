import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  RunEventV1Schema,
  Web2JsonManifestV1Schema,
  type RunEventV1,
} from "@proofline/contracts";
import {
  generateSafeWeb2JsonConsumer,
  projectRun,
  replayProofBundle,
} from "@proofline/domain";
import type { Pool } from "pg";
import { digestOpaqueToken } from "./postgres";

function fingerprint(value: unknown): Buffer {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest();
}

function requireRunId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw Object.assign(new Error("Run id is required"), { status: 400 });
  }
  return value;
}

export function createProductionProoflineService(input: {
  pool: Pool;
  tokenDigestKey: string;
  publicWebOrigin: string;
}) {
  async function enqueue(context: Record<string, unknown>, kind: string) {
    const runId = requireRunId(context.runId);
    await input.pool.query(
      `INSERT INTO proofline_private.run_commands
        (id, project_id, run_id, idempotency_key, kind, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (project_id, idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        context.projectId,
        runId,
        context.idempotencyKey,
        kind,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(context).filter(
              ([key]) =>
                !["projectId", "runId", "idempotencyKey"].includes(key),
            ),
          ),
        ),
      ],
    );
    return { accepted: true, runId };
  }

  return {
    async createRun(context: Record<string, unknown>) {
      const manifest = Web2JsonManifestV1Schema.parse(context.manifest);
      const requestFingerprint = fingerprint(manifest);
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `SELECT id, request_fingerprint
           FROM proofline_private.runs
           WHERE project_id = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [context.projectId, context.idempotencyKey],
        );
        if (existing.rowCount) {
          if (
            !Buffer.from(existing.rows[0].request_fingerprint).equals(
              requestFingerprint,
            )
          ) {
            throw Object.assign(new Error("Idempotency conflict"), {
              status: 409,
            });
          }
          await client.query("COMMIT");
          const runId = String(existing.rows[0].id);
          return {
            status: "accepted",
            runId,
            location: `/v1/runs/${runId}`,
          };
        }

        const runId = randomUUID();
        const event: RunEventV1 = RunEventV1Schema.parse({
          version: "1",
          runId,
          sequence: 1,
          commandId: String(context.idempotencyKey),
          occurredAt: new Date().toISOString(),
          type: "RUN_CREATED",
          payload: { manifest },
        });
        const projection = projectRun([event]);
        await client.query(
          `INSERT INTO proofline_private.runs
            (id, project_id, idempotency_key, request_fingerprint, manifest, projection, last_sequence)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 1)`,
          [
            runId,
            context.projectId,
            context.idempotencyKey,
            requestFingerprint,
            JSON.stringify(manifest),
            JSON.stringify(projection),
          ],
        );
        await client.query(
          `INSERT INTO proofline_private.run_events
            (run_id, sequence, dedupe_key, event_type, event_payload, occurred_at)
           VALUES ($1, 1, $2, 'RUN_CREATED', $3::jsonb, $4)`,
          [
            runId,
            context.idempotencyKey,
            JSON.stringify(event),
            event.occurredAt,
          ],
        );
        await client.query(
          `INSERT INTO proofline_private.run_commands
            (id, project_id, run_id, idempotency_key, kind, payload)
           VALUES ($1, $2, $3, $4, 'RUN_PREFLIGHT', '{}'::jsonb)`,
          [
            randomUUID(),
            context.projectId,
            runId,
            `${context.idempotencyKey}:preflight`,
          ],
        );
        await client.query("COMMIT");
        return {
          status: "accepted",
          runId,
          location: `/v1/runs/${runId}`,
        };
      } catch (cause) {
        await client.query("ROLLBACK");
        throw cause;
      } finally {
        client.release();
      }
    },

    async getRun(context: Record<string, unknown>) {
      const result = await input.pool.query(
        `SELECT projection
         FROM proofline_private.runs
         WHERE id = $1 AND project_id = $2`,
        [requireRunId(context.runId), context.projectId],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Run not found"), { status: 404 });
      }
      return result.rows[0].projection;
    },

    async listEvents(context: Record<string, unknown>) {
      const result = await input.pool.query(
        `SELECT event_payload
         FROM proofline_private.run_events AS event
         JOIN proofline_private.runs AS run ON run.id = event.run_id
         WHERE event.run_id = $1
           AND run.project_id = $2
           AND event.sequence > $3
         ORDER BY event.sequence
         LIMIT 1000`,
        [requireRunId(context.runId), context.projectId, context.after],
      );
      const events = result.rows.map((row) =>
        RunEventV1Schema.parse(row.event_payload),
      );
      return {
        events,
        nextAfter: events.at(-1)?.sequence ?? Number(context.after ?? 0),
      };
    },

    createSubmission(context: Record<string, unknown>) {
      return enqueue(context, `SUBMIT_${String(context.mode ?? "relayer").toUpperCase()}`);
    },
    attachTransaction(context: Record<string, unknown>) {
      return enqueue(context, "ATTACH_WALLET_TRANSACTION");
    },
    verifyConsumer(context: Record<string, unknown>) {
      return enqueue(context, "VERIFY_CONSUMER");
    },

    async generateConsumer(context: Record<string, unknown>) {
      const result = await input.pool.query(
        `SELECT manifest FROM proofline_private.runs
         WHERE id = $1 AND project_id = $2`,
        [requireRunId(context.runId), context.projectId],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Run not found"), { status: 404 });
      }
      return {
        source: generateSafeWeb2JsonConsumer(result.rows[0].manifest, {
          contractName:
            typeof context.contractName === "string"
              ? context.contractName
              : "ProoflineSafeWeb2JsonConsumer",
        }),
      };
    },

    async getBundle(context: Record<string, unknown>) {
      const result = await input.pool.query(
        `SELECT canonical_bytes
         FROM proofline_private.run_artifacts AS artifact
         JOIN proofline_private.runs AS run ON run.id = artifact.run_id
         WHERE artifact.run_id = $1 AND run.project_id = $2
           AND artifact.kind = 'proof-bundle'
         ORDER BY artifact.created_at DESC
         LIMIT 1`,
        [requireRunId(context.runId), context.projectId],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Proof bundle is not available"), {
          status: 409,
        });
      }
      return JSON.parse(Buffer.from(result.rows[0].canonical_bytes).toString("utf8"));
    },

    async replay(context: Record<string, unknown>) {
      const bundle = replayProofBundle(String(context.bundle ?? ""));
      return { runId: bundle.runId, byteIdentical: true, checksum: bundle.checksum };
    },

    async createShare(context: Record<string, unknown>) {
      const raw = `share_${randomBytes(32).toString("hex")}`;
      const runId = requireRunId(context.runId);
      await input.pool.query(
        `INSERT INTO proofline_private.share_tokens
          (id, project_id, run_id, token_digest, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          context.projectId,
          runId,
          digestOpaqueToken(raw, input.tokenDigestKey),
          context.expiresAt ?? null,
        ],
      );
      return {
        token: raw,
        url: `${input.publicWebOrigin.replace(/\/+$/, "")}/runs/${runId}?share=${raw}`,
      };
    },
  };
}
