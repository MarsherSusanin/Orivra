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
  async function loadOwnedRun(context: Record<string, unknown>) {
    const runId = requireRunId(context.runId);
    const result = await input.pool.query(
      `SELECT id, project_id, manifest, projection, last_sequence
       FROM proofline_private.runs
       WHERE id = $1 AND project_id = $2`,
      [runId, context.projectId],
    );
    if (!result.rowCount) {
      throw Object.assign(new Error("Run not found"), { status: 404 });
    }
    return {
      ...result.rows[0],
      id: runId,
      manifest: Web2JsonManifestV1Schema.parse(result.rows[0].manifest),
    };
  }

  async function findCommandIntent(
    projectId: unknown,
    idempotencyKey: unknown,
  ) {
    const result = await input.pool.query(
      `SELECT project_id, run_id, idempotency_key, kind, payload
       FROM proofline_private.run_commands
       WHERE project_id = $1 AND idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  function sameIntent(
    existing: Record<string, unknown>,
    runId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): boolean {
    return (
      String(existing.run_id) === runId &&
      String(existing.kind) === kind &&
      JSON.stringify(existing.payload ?? {}) === JSON.stringify(payload)
    );
  }

  async function enqueue(
    context: Record<string, unknown>,
    kind: string,
    payload: Record<string, unknown> = {},
  ) {
    const owned = await loadOwnedRun(context);
    const runId = String(owned.id);
    const existing = await findCommandIntent(
      context.projectId,
      context.idempotencyKey,
    );
    if (existing) {
      if (!sameIntent(existing, runId, kind, payload)) {
        throw Object.assign(new Error("Idempotency key command intent conflict"), {
          status: 409,
        });
      }
      return { accepted: true, runId };
    }

    const inserted = await input.pool.query(
      `INSERT INTO proofline_private.run_commands
        (id, project_id, run_id, idempotency_key, kind, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (project_id, idempotency_key) DO NOTHING
       RETURNING project_id, run_id, idempotency_key, kind, payload`,
      [
        randomUUID(),
        context.projectId,
        runId,
        context.idempotencyKey,
        kind,
        JSON.stringify(payload),
      ],
    );
    if (!inserted.rowCount) {
      const raced = await findCommandIntent(
        context.projectId,
        context.idempotencyKey,
      );
      if (!raced || !sameIntent(raced, runId, kind, payload)) {
        throw Object.assign(new Error("Idempotency key command intent conflict"), {
          status: 409,
        });
      }
    }
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

    async createSubmission(context: Record<string, unknown>) {
      const mode = String(context.mode ?? "relayer");
      if (mode === "wallet") {
        const runId = requireRunId(context.runId);
        const result = await input.pool.query(
          `SELECT run.id, run.project_id, run.manifest,
                  artifact.kind, artifact.canonical_bytes, artifact.metadata
           FROM proofline_private.run_artifacts AS artifact
           JOIN proofline_private.runs AS run ON run.id = artifact.run_id
           WHERE run.id = $1 AND run.project_id = $2
             AND artifact.kind = 'preflight-evidence'
           ORDER BY artifact.created_at DESC
           LIMIT 1`,
          [runId, context.projectId],
        );
        if (!result.rowCount) {
          throw Object.assign(new Error("Run or preflight evidence not found"), {
            status: 404,
          });
        }
        const row = result.rows[0];
        const evidence = JSON.parse(
          Buffer.from(row.canonical_bytes).toString("utf8"),
        ) as Record<string, unknown>;
        const chainId = Number(evidence.chainId ?? 114);
        const fdcHub = String(
          evidence.fdcHub ??
            (evidence.network as any)?.resolvedContracts?.FdcHub ??
            "",
        );
        const requestCalldata = String(evidence.requestCalldata ?? "");
        const quotedFeeWei = BigInt(String(evidence.quotedFeeWei ?? "-1"));
        if (
          chainId !== 114 ||
          !/^0x[0-9a-fA-F]{40}$/.test(fdcHub) ||
          !/^0x(?:[0-9a-fA-F]{2})+$/.test(requestCalldata) ||
          quotedFeeWei < 0n
        ) {
          throw Object.assign(new Error("Persisted preflight evidence is invalid"), {
            status: 409,
          });
        }
        return {
          mode: "wallet",
          transaction: {
            chainId: "0x72",
            to: fdcHub,
            data: requestCalldata,
            value: `0x${quotedFeeWei.toString(16)}`,
          },
        };
      }
      if (mode !== "relayer") {
        throw Object.assign(new Error("Unsupported submission mode"), {
          status: 400,
        });
      }
      return enqueue(context, "SUBMIT_RELAYER", {
        idempotencyKey: context.idempotencyKey,
      });
    },
    attachTransaction(context: Record<string, unknown>) {
      return enqueue(context, "ATTACH_WALLET_TRANSACTION", {
        transactionHash: context.transactionHash,
      });
    },
    verifyConsumer(context: Record<string, unknown>) {
      return enqueue(context, "VERIFY_CONSUMER", {
        ...(context.consumer ? { consumer: context.consumer } : {}),
      });
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
      const owned = await loadOwnedRun(context);
      const runId = String(owned.id);
      const raw = `share_${randomBytes(32).toString("hex")}`;
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
