import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  DiagnosticV1Schema,
  RunEventV1Schema,
  Web2JsonManifestV1Schema,
  type RunEventV1,
} from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
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

function isUniqueViolation(value: unknown): value is {
  code: "23505";
  constraint?: string;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      (value as { code?: unknown }).code === "23505",
  );
}

export function createProductionProoflineService(input: {
  pool: Pool;
  tokenDigestKey: string;
  publicWebOrigin: string;
}) {
  function assertMutableProjection(projection: unknown): void {
    if (
      projection &&
      typeof projection === "object" &&
      (projection as { terminal?: unknown }).terminal === true
    ) {
      throw Object.assign(new Error("Terminal runs are immutable"), {
        status: 409,
        code: "RUN_TERMINAL",
      });
    }
  }

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

  async function loadMutableOwnedRun(context: Record<string, unknown>) {
    const run = await loadOwnedRun(context);
    assertMutableProjection(run.projection);
    return run;
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

  async function findRelayerCommandByRun(runId: string) {
    const result = await input.pool.query(
      `SELECT project_id, run_id, idempotency_key, kind, payload
       FROM proofline_private.run_commands
       WHERE run_id = $1
         AND kind = 'SUBMIT_RELAYER'
         AND status <> 'cancelled'
       LIMIT 1`,
      [runId],
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
    assertMutableProjection(owned.projection);

    if (kind === "SUBMIT_RELAYER") {
      const priorRelayerCommand = await findRelayerCommandByRun(runId);
      if (priorRelayerCommand) {
        throw Object.assign(
          new Error("Run already has one relayer submission command"),
          { status: 409, code: "RELAYER_SUBMISSION_EXISTS" },
        );
      }
    }

    let inserted;
    try {
      inserted = await input.pool.query(
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
    } catch (cause) {
      if (kind === "SUBMIT_RELAYER" && isUniqueViolation(cause)) {
        const racedRelayerCommand = await findRelayerCommandByRun(runId);
        if (racedRelayerCommand) {
          throw Object.assign(
            new Error("Run already has one relayer submission command"),
            { status: 409, code: "RELAYER_SUBMISSION_EXISTS" },
          );
        }
      }
      throw cause;
    }
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

  async function persistCompletedIntent(
    context: Record<string, unknown>,
    runId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (
      typeof context.idempotencyKey !== "string" ||
      context.idempotencyKey.length === 0
    ) {
      return;
    }
    const existing = await findCommandIntent(
      context.projectId,
      context.idempotencyKey,
    );
    if (existing) {
      if (!sameIntent(existing, runId, kind, payload)) {
        throw Object.assign(
          new Error("Idempotency key derived-product intent conflict"),
          { status: 409 },
        );
      }
      return;
    }
    const inserted = await input.pool.query(
      `INSERT INTO proofline_private.run_commands
        (id, project_id, run_id, idempotency_key, kind, payload, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'succeeded')
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
        throw Object.assign(
          new Error("Idempotency key derived-product intent conflict"),
          { status: 409 },
        );
      }
    }
  }

  return {
    async createRun(context: Record<string, unknown>) {
      const manifest = Web2JsonManifestV1Schema.parse(context.manifest);
      const requestFingerprint = fingerprint(manifest);
      const client = await input.pool.connect();
      const accepted = (runId: string) => ({
        status: "accepted" as const,
        runId,
        location: `/v1/runs/${runId}`,
      });
      const reconcile = async () => {
        const existing = await client.query(
          `SELECT id, request_fingerprint
           FROM proofline_private.runs
           WHERE project_id = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [context.projectId, context.idempotencyKey],
        );
        if (
          existing.rowCount === 1 &&
          Buffer.from(existing.rows[0].request_fingerprint).equals(
            requestFingerprint,
          )
        ) {
          return accepted(String(existing.rows[0].id));
        }
        throw Object.assign(new Error("Idempotency conflict"), { status: 409 });
      };
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
          return accepted(String(existing.rows[0].id));
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
        return accepted(runId);
      } catch (cause) {
        await client.query("ROLLBACK");
        if (isUniqueViolation(cause)) {
          return await reconcile();
        }
        throw cause;
      } finally {
        client.release();
      }
    },

    async getRun(context: Record<string, unknown>) {
      const result = await input.pool.query(
        `SELECT projection,
                (
                  SELECT event_payload->'payload'->>'transactionHash'
                  FROM proofline_private.run_events
                  WHERE run_id = run.id AND event_type = 'REQUEST_SUBMITTED'
                  ORDER BY sequence DESC
                  LIMIT 1
                ) AS transaction_hash,
                (
                  SELECT event_payload->'payload'->>'votingRound'
                  FROM proofline_private.run_events
                  WHERE run_id = run.id AND event_type = 'ROUND_FINALIZED'
                  ORDER BY sequence DESC
                  LIMIT 1
                ) AS voting_round,
                (
                  SELECT (event_payload->'payload'->>'passed')::boolean
                  FROM proofline_private.run_events
                  WHERE run_id = run.id AND event_type = 'CONSUMER_VERIFIED'
                  ORDER BY sequence DESC
                  LIMIT 1
                ) AS consumer_verified,
                (
                  SELECT event_payload->'payload'->'diagnostics'
                  FROM proofline_private.run_events
                  WHERE run_id = run.id AND event_type = 'CONSUMER_VERIFIED'
                  ORDER BY sequence DESC
                  LIMIT 1
                ) AS consumer_diagnostics,
                (
                  SELECT metadata->>'checksum'
                  FROM proofline_private.run_artifacts
                  WHERE run_id = run.id AND kind = 'proof-bundle'
                  ORDER BY created_at DESC
                  LIMIT 1
                ) AS proof_checksum,
                (
                  SELECT count(*)::integer
                  FROM proofline_private.relayer_audit_events
                  WHERE run_id = run.id
                    AND event_type = 'RELAYER_TRANSACTION_BROADCAST_ATTEMPT'
                ) AS broadcast_attempt_count,
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM proofline_private.relayer_transactions
                  WHERE run_id = run.id AND broadcast_at IS NOT NULL
                ) THEN GREATEST((
                  SELECT count(*)::integer
                  FROM proofline_private.relayer_audit_events
                  WHERE run_id = run.id
                    AND event_type = 'RELAYER_TRANSACTION_BROADCAST'
                ) - 1, 0) END AS broadcast_count_after_recorded_hash
         FROM proofline_private.runs AS run
         WHERE run.id = $1 AND run.project_id = $2`,
        [requireRunId(context.runId), context.projectId],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Run not found"), { status: 404 });
      }
      const row = result.rows[0];
      let diagnostics: unknown;
      if (typeof row.consumer_verified === "boolean") {
        const parsed = DiagnosticV1Schema.array().safeParse(
          row.consumer_diagnostics,
        );
        if (
          !parsed.success ||
          (row.consumer_verified === false && parsed.data.length === 0)
        ) {
          throw Object.assign(
            new Error(
              "Consumer result is missing valid versioned diagnostic evidence",
            ),
            { status: 500, code: "CONSUMER_DIAGNOSTICS_MISSING" },
          );
        }
        diagnostics = parsed.data;
      }
      const releaseEvidence = {
        ...(typeof row.transaction_hash === "string"
          ? { transactionHash: row.transaction_hash }
          : {}),
        ...(row.voting_round !== undefined && row.voting_round !== null
          ? { votingRound: String(row.voting_round) }
          : {}),
        ...(typeof row.consumer_verified === "boolean"
          ? { consumerVerified: row.consumer_verified, diagnostics }
          : {}),
        ...(typeof row.proof_checksum === "string"
          ? { proofChecksum: row.proof_checksum }
          : {}),
        ...(Number.isInteger(row.broadcast_count_after_recorded_hash)
          ? {
              broadcastCountAfterRecordedHash:
                row.broadcast_count_after_recorded_hash,
            }
          : {}),
        ...(Number.isInteger(row.broadcast_attempt_count)
          ? { broadcastAttemptCount: row.broadcast_attempt_count }
          : {}),
      };
      return { ...row.projection, ...releaseEvidence };
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
          `SELECT run.id, run.project_id, run.manifest, run.projection,
                  artifact.kind, artifact.canonical_bytes, artifact.metadata
           FROM proofline_private.runs AS run
           LEFT JOIN LATERAL (
             SELECT kind, canonical_bytes, metadata
             FROM proofline_private.run_artifacts
             WHERE run_id = run.id AND kind = 'preflight-evidence'
             ORDER BY created_at DESC
             LIMIT 1
           ) AS artifact ON true
           WHERE run.id = $1 AND run.project_id = $2
           LIMIT 1`,
          [runId, context.projectId],
        );
        if (!result.rowCount) {
          throw Object.assign(new Error("Run or preflight evidence not found"), {
            status: 404,
            code: "PREFLIGHT_NOT_READY",
          });
        }
        const row = result.rows[0];
        assertMutableProjection(row.projection);
        if (!row.canonical_bytes) {
          throw Object.assign(new Error("Preflight evidence is not ready"), {
            status: 404,
            code: "PREFLIGHT_NOT_READY",
          });
        }
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
      const owned = await loadOwnedRun(context);
      const runId = String(owned.id);
      const payload = { idempotencyKey: context.idempotencyKey };
      const existing = await findCommandIntent(
        context.projectId,
        context.idempotencyKey,
      );
      if (existing) {
        if (!sameIntent(existing, runId, "SUBMIT_RELAYER", payload)) {
          throw Object.assign(
            new Error("Idempotency key command intent conflict"),
            { status: 409 },
          );
        }
        return { accepted: true, runId };
      }
      assertMutableProjection(owned.projection);
      const priorRelayerCommand = await findRelayerCommandByRun(runId);
      if (
        priorRelayerCommand &&
        String(priorRelayerCommand.idempotency_key) ===
          `${runId}:submit_relayer`
      ) {
        return { accepted: true, runId };
      }
      const preflightStage = (owned.projection as any)?.stages?.preflight;
      if (preflightStage !== undefined && preflightStage !== "completed") {
        throw Object.assign(new Error("Preflight evidence is not ready"), {
          status: 404,
          code: "PREFLIGHT_NOT_READY",
        });
      }
      return enqueue(context, "SUBMIT_RELAYER", payload);
    },
    attachTransaction(context: Record<string, unknown>) {
      return enqueue(context, "ATTACH_WALLET_TRANSACTION", {
        transactionHash: context.transactionHash,
      });
    },
    verifyConsumer(context: Record<string, unknown>) {
      if (
        context.consumer !== "canonical-vulnerable" &&
        context.consumer !== "canonical-safe"
      ) {
        throw Object.assign(
          new Error("Consumer verification requires an explicit canonical consumer"),
          { status: 400, code: "CONSUMER_INTENT_REQUIRED" },
        );
      }
      return enqueue(context, "VERIFY_CONSUMER", {
        consumer: context.consumer,
      });
    },

    async generateConsumer(context: Record<string, unknown>) {
      const owned = await loadOwnedRun(context);
      const runId = String(owned.id);
      const contractName =
        typeof context.contractName === "string"
          ? context.contractName
          : "ProoflineSafeWeb2JsonConsumer";
      await persistCompletedIntent(context, runId, "GENERATE_CONSUMER", {
        contractName,
      });
      return {
        source: generateSafeWeb2JsonConsumer(owned.manifest, {
          contractName,
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
      const inputBytes = String(context.bundle ?? "");
      const bundle = replayProofBundle(inputBytes);
      const replayedBytes = canonicalSerializeProofBundle(bundle);
      return {
        runId: bundle.runId,
        byteIdentical: replayedBytes === inputBytes,
        checksum: bundle.checksum,
      };
    },

    async createShare(context: Record<string, unknown>) {
      const owned = await loadOwnedRun(context);
      const runId = String(owned.id);
      const payload = {
        ...(typeof context.expiresAt === "string"
          ? { expiresAt: context.expiresAt }
          : {}),
      };
      await persistCompletedIntent(context, runId, "CREATE_SHARE", payload);
      const raw =
        typeof context.idempotencyKey === "string" &&
        context.idempotencyKey.length > 0
          ? `share_${createHmac("sha256", input.tokenDigestKey)
              .update(
                JSON.stringify({
                  version: "1",
                  projectId: context.projectId,
                  runId,
                  idempotencyKey: context.idempotencyKey,
                  payload,
                }),
              )
              .digest("hex")}`
          : `share_${randomBytes(32).toString("hex")}`;
      await input.pool.query(
        `INSERT INTO proofline_private.share_tokens
          (id, project_id, run_id, token_digest, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (token_digest) DO NOTHING`,
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
