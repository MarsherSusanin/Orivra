import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendRunEvents, projectRun } from "@proofline/domain";
import {
  Coston2Web2JsonManifestV1Schema,
  NormalizedFdcErrorSchema,
  RecoveryErrorV1Schema,
  RunEventV1Schema,
  RunRecoveryV1Schema,
  type RunEventV1,
} from "@proofline/contracts";

export function digestOpaqueToken(rawToken: string, digestKey: string): Uint8Array {
  return new Uint8Array(
    createHmac("sha256", digestKey).update(rawToken, "utf8").digest(),
  );
}

function relayerQuotaExhausted() {
  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category: "configuration",
    code: "RELAYER_QUOTA_EXHAUSTED",
    message: "Relayer quota is exhausted",
    retryable: false,
    evidence: {},
  });
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
    RETURNING id, run_id, kind, attempts, available_at, last_error
  `,
  renewLease: `
    UPDATE proofline_private.run_commands
    SET lease_expires_at = now() + $3::interval,
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

interface RelayerPolicyConfig {
  globalFeeCapWei: bigint;
  balanceFloorWei: bigint;
  dailyProjectQuota: number;
}

function hexBytes(value: string, bytes?: number): Uint8Array {
  const pattern = bytes
    ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`)
    : /^0x(?:[0-9a-fA-F]{2})+$/;
  if (!pattern.test(value)) throw new Error("Expected canonical hexadecimal bytes");
  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}

function bytesHex(value: unknown): string {
  if (!(value instanceof Uint8Array)) throw new Error("Expected persisted bytes");
  return `0x${Buffer.from(value).toString("hex")}`;
}

function digestHexBytes(value: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(hexBytes(value)).digest());
}

function hydrateRelayerTransaction(row: Record<string, unknown>) {
  return {
    runId: String(row.run_id),
    idempotencyKey: String(row.idempotency_key),
    chainId: Number(row.chain_id),
    fromAddress: bytesHex(row.from_address),
    nonce: BigInt(String(row.nonce)),
    target: bytesHex(row.target_address),
    calldataHash: Buffer.from(row.calldata_hash as Uint8Array).toString("hex"),
    valueWei: BigInt(String(row.value_wei)),
    rawTransaction: bytesHex(row.raw_signed_transaction),
    transactionHash: bytesHex(row.transaction_hash),
    commandFingerprint: `sha256:${Buffer.from(
      row.command_fingerprint as Uint8Array,
    ).toString("hex")}`,
    broadcastAt: row.broadcast_at
      ? new Date(String(row.broadcast_at)).toISOString()
      : null,
    broadcastAttemptedAt: row.broadcast_attempted_at
      ? new Date(String(row.broadcast_attempted_at)).toISOString()
      : null,
  };
}

function failureStage(commandKind: unknown) {
  const kind = String(commandKind ?? "");
  if (kind === "RUN_PREFLIGHT") return "preflight" as const;
  if (
    kind === "SUBMIT_RELAYER" ||
    kind === "BROADCAST_RELAYER_TRANSACTION" ||
    kind === "ATTACH_WALLET_TRANSACTION" ||
    kind === "APPLY_REPLAY_EVIDENCE"
  ) {
    return "request" as const;
  }
  if (
    kind === "POLL_TRANSACTION_RECEIPT" ||
    kind === "POLL_RELAY_FINALIZATION"
  ) {
    return "round" as const;
  }
  if (kind === "FETCH_DA_PROOF") return "proof" as const;
  if (kind === "VERIFY_PROOF") return "verify" as const;
  if (kind === "VERIFY_CONSUMER" || kind === "BUILD_PROOF_BUNDLE") {
    return "consumer" as const;
  }
  return "preflight" as const;
}

function recoveryCheckpoint(commandKind: unknown) {
  const kind = String(commandKind ?? "");
  if (kind === "RUN_PREFLIGHT") return "preflight" as const;
  if (
    kind === "SUBMIT_RELAYER" ||
    kind === "BROADCAST_RELAYER_TRANSACTION" ||
    kind === "ATTACH_WALLET_TRANSACTION" ||
    kind === "APPLY_REPLAY_EVIDENCE"
  ) return "submission" as const;
  if (kind === "POLL_TRANSACTION_RECEIPT") return "transaction-receipt" as const;
  if (kind === "POLL_RELAY_FINALIZATION") return "relay-finalization" as const;
  if (kind === "FETCH_DA_PROOF") return "da-proof" as const;
  if (kind === "VERIFY_PROOF") return "proof-verification" as const;
  return "consumer-verification" as const;
}

function preservedEvidence(events: readonly RunEventV1[]) {
  const evidence: Array<
    "preflight" | "transaction" | "round" | "proof" | "verification" | "consumer"
  > = [];
  if (events.some((event) => event.type === "PREFLIGHT_ACCEPTED")) evidence.push("preflight");
  if (events.some((event) => event.type === "REQUEST_SUBMITTED")) evidence.push("transaction");
  if (events.some((event) => event.type === "ROUND_FINALIZED")) evidence.push("round");
  if (events.some((event) => event.type === "PROOF_AVAILABLE")) evidence.push("proof");
  if (events.some((event) => event.type === "PROOF_VERIFIED")) evidence.push("verification");
  if (events.some((event) => event.type === "CONSUMER_VERIFIED")) evidence.push("consumer");
  return evidence;
}

function terminalError(failure: Record<string, unknown>) {
  const categories = new Set([
    "configuration",
    "transport",
    "timeout",
    "not-finalized",
    "consensus-miss",
    "schema-invalid",
    "proof-invalid",
    "consumer-invariant",
  ]);
  return NormalizedFdcErrorSchema.parse({
    version: "1",
    category: categories.has(String(failure.category))
      ? failure.category
      : "configuration",
    code:
      typeof failure.code === "string" &&
      /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(failure.code)
        ? failure.code
        : "WORKER_COMMAND_FAILED",
    message:
      typeof failure.message === "string" && failure.message.length > 0
        ? failure.message
        : "Worker command failed",
    retryable: false,
    evidence:
      failure.evidence && typeof failure.evidence === "object"
        ? failure.evidence
        : {},
  });
}

function recoveryError(
  failure: Record<string, unknown>,
  retryable: boolean,
) {
  const error = terminalError(failure);
  const source = failure.evidence && typeof failure.evidence === "object"
    ? failure.evidence as Record<string, unknown>
    : {};
  const evidence: Record<string, unknown> = {};
  if (typeof source.stage === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(source.stage)) {
    evidence.stage = source.stage;
  }
  if (typeof source.attempt === "number" && Number.isInteger(source.attempt) && source.attempt >= 0) {
    evidence.attempt = source.attempt;
  }
  if (typeof source.retryAfterSeconds === "number" && Number.isFinite(source.retryAfterSeconds) && source.retryAfterSeconds >= 0) {
    evidence.retryAfterSeconds = source.retryAfterSeconds;
  }
  if (typeof source.votingRound === "number" && Number.isInteger(source.votingRound) && source.votingRound >= 0) {
    evidence.votingRound = source.votingRound;
  }
  const commandId = typeof failure.commandId === "string"
    ? failure.commandId
    : typeof source.commandId === "string"
      ? source.commandId
      : undefined;
  if (commandId) evidence.commandId = commandId;
  if (typeof source.originalCode === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(source.originalCode)) {
    evidence.originalCode = source.originalCode;
  }
  return RecoveryErrorV1Schema.parse({
    ...error,
    message: "Worker command failed",
    retryable,
    evidence,
  });
}

function terminalRetrySafety(failure: Record<string, unknown>) {
  const category = String(failure.category ?? "");
  const code = String(failure.code ?? "");
  return category === "consensus-miss" ||
    category === "proof-invalid" ||
    /(?:REVERTED|CONSENSUS_MISS|PROOF_INVALID)/.test(code)
    ? "new-run-required" as const
    : "operator-review" as const;
}

function eventDedupeKey(event: RunEventV1): string {
  if (
    event.type === "STAGE_WAITING" ||
    event.type === "STAGE_RETRY_SCHEDULED" ||
    event.type === "RUN_RESUMED"
  ) {
    return `${event.commandId}:${event.type}:${event.payload.attempt}`;
  }
  return event.commandId;
}

function unresolvedRecoveryEvent(
  events: readonly RunEventV1[],
  commandId: string,
) {
  let unresolved: Extract<
    RunEventV1,
    { type: "STAGE_WAITING" | "STAGE_RETRY_SCHEDULED" }
  > | undefined;
  for (const event of events) {
    if (
      event.type !== "STAGE_WAITING" &&
      event.type !== "STAGE_RETRY_SCHEDULED" &&
      event.type !== "RUN_RESUMED"
    ) {
      unresolved = undefined;
      continue;
    }
    if (event.commandId !== commandId) continue;
    if (event.type === "RUN_RESUMED") unresolved = undefined;
    else unresolved = event;
  }
  return unresolved;
}

function latestRecoveryEvent(
  events: readonly RunEventV1[],
  commandId: string,
) {
  let latest: Extract<
    RunEventV1,
    { type: "STAGE_WAITING" | "STAGE_RETRY_SCHEDULED" | "RUN_RESUMED" }
  > | undefined;
  for (const event of events) {
    if (
      event.type !== "STAGE_WAITING" &&
      event.type !== "STAGE_RETRY_SCHEDULED" &&
      event.type !== "RUN_RESUMED"
    ) {
      latest = undefined;
      continue;
    }
    if (event.commandId === commandId) latest = event;
  }
  return latest;
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
    eventDedupeKey(event),
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

export function createPostgresCommandRepository(input: {
  pool: SqlPool;
  relayerPolicy?: RelayerPolicyConfig;
}) {
  return {
    async loadRelayerPolicy(
      projectId: string,
      manifestFeeCapWei: bigint,
    ) {
      const policy = input.relayerPolicy;
      if (!policy) {
        throw new Error("Relayer policy configuration is required");
      }
      if (
        manifestFeeCapWei < 0n ||
        policy.globalFeeCapWei < 0n ||
        policy.balanceFloorWei < 0n ||
        !Number.isInteger(policy.dailyProjectQuota) ||
        policy.dailyProjectQuota <= 0
      ) {
        throw new Error("Relayer policy configuration is invalid");
      }
      const client = await input.pool.connect();
      try {
        const used = await client.query(
          `SELECT count(*)::integer AS used
           FROM proofline_private.relayer_transactions AS relayer
           JOIN proofline_private.runs AS run ON run.id = relayer.run_id
           WHERE run.project_id = $1
             AND relayer.created_at >= date_trunc('day', now())`,
          [projectId],
        );
        const usedToday = Number(used.rows[0]?.used ?? 0);
        return {
          projectFeeCapWei: manifestFeeCapWei,
          globalFeeCapWei: policy.globalFeeCapWei,
          quotaRemaining: Math.max(0, policy.dailyProjectQuota - usedToday),
          balanceFloorWei: policy.balanceFloorWei,
        };
      } finally {
        client.release();
      }
    },

    async findRelayerTransaction(idempotencyKey: string) {
      const client = await input.pool.connect();
      try {
        const result = await client.query(
          `SELECT run_id, idempotency_key, chain_id, from_address, nonce,
                  target_address, calldata_hash, value_wei,
                  raw_signed_transaction, transaction_hash,
                  command_fingerprint, broadcast_attempted_at, broadcast_at
           FROM proofline_private.relayer_transactions
           WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        const row = result.rows[0];
        if (!row) return null;
        return hydrateRelayerTransaction(row);
      } finally {
        client.release();
      }
    },

    async findRelayerTransactionByRun(runId: string) {
      const client = await input.pool.connect();
      try {
        const result = await client.query(
          `SELECT run_id, idempotency_key, chain_id, from_address, nonce,
                  target_address, calldata_hash, value_wei,
                  raw_signed_transaction, transaction_hash,
                  command_fingerprint, broadcast_attempted_at, broadcast_at
           FROM proofline_private.relayer_transactions
           WHERE run_id = $1`,
          [runId],
        );
        const row = result.rows[0];
        return row ? hydrateRelayerTransaction(row) : null;
      } finally {
        client.release();
      }
    },

    async persistRelayerTransaction(value: {
      projectId?: string;
      runId?: string;
      idempotencyKey: string;
      chainId: number;
      fromAddress?: string;
      nonce: bigint;
      target: string;
      calldata: string;
      valueWei: bigint;
      rawTransaction: string;
      transactionHash: string;
      commandFingerprint?: string;
      policy?: {
        projectFeeCapWei: bigint;
        globalFeeCapWei: bigint;
        quotaRemaining: number;
        balanceFloorWei: bigint;
      };
    }): Promise<void> {
      if (
        !value.projectId ||
        !value.runId ||
        !value.fromAddress ||
        !value.commandFingerprint
      ) {
        throw new Error("Persisted relayer identity is incomplete");
      }
      if (value.chainId !== 114 || value.valueWei < 0n || value.nonce < 0n) {
        throw new Error("Persisted relayer chain identity is invalid");
      }
      const fingerprint = value.commandFingerprint.replace(/^sha256:/, "");
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
        throw new Error("Persisted relayer command fingerprint is invalid");
      }
      if (
        value.policy &&
        (value.policy.projectFeeCapWei < value.valueWei ||
          value.policy.globalFeeCapWei < value.valueWei ||
          value.policy.balanceFloorWei < 0n)
      ) {
        throw new Error("Persisted relayer policy rejects this transaction");
      }
      if (
        value.policy &&
        (!Number.isInteger(value.policy.quotaRemaining) ||
          value.policy.quotaRemaining <= 0)
      ) {
        throw relayerQuotaExhausted();
      }
      const matches = (row: Record<string, unknown> | undefined) =>
        Boolean(
          row &&
            String(row.run_id) === value.runId &&
            String(row.idempotency_key) === value.idempotencyKey &&
            Number(row.chain_id) === value.chainId &&
            BigInt(String(row.nonce)) === value.nonce &&
            bytesHex(row.target_address).toLowerCase() ===
              value.target.toLowerCase() &&
            Buffer.from(row.calldata_hash as Uint8Array).equals(
              Buffer.from(digestHexBytes(value.calldata)),
            ) &&
            Buffer.from(row.command_fingerprint as Uint8Array).toString("hex") ===
              fingerprint &&
            BigInt(String(row.value_wei)) === value.valueWei &&
            bytesHex(row.raw_signed_transaction).toLowerCase() ===
              value.rawTransaction.toLowerCase() &&
            bytesHex(row.transaction_hash).toLowerCase() ===
              value.transactionHash.toLowerCase(),
        );
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [value.runId],
        );
        if (value.policy && input.relayerPolicy) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
            [value.projectId],
          );
        }
        const prior = await client.query(
          `SELECT run_id, chain_id, nonce, target_address, calldata_hash,
                  command_fingerprint, value_wei, raw_signed_transaction,
                  transaction_hash, idempotency_key
           FROM proofline_private.relayer_transactions
           WHERE idempotency_key = $1 OR run_id = $2`,
          [value.idempotencyKey, value.runId],
        );
        if (prior.rows[0]) {
          if (!matches(prior.rows[0])) {
            throw new Error("Persisted relayer idempotency identity conflict");
          }
          await client.query("COMMIT");
          return;
        }
        if (value.policy && input.relayerPolicy) {
          const usage = await client.query(
            `SELECT count(*)::integer AS used
             FROM proofline_private.relayer_transactions AS relayer
             JOIN proofline_private.runs AS run ON run.id = relayer.run_id
             WHERE run.project_id = $1
               AND relayer.created_at >= date_trunc('day', now())`,
            [value.projectId],
          );
          const usedToday = Number(usage.rows[0]?.used ?? 0);
          if (usedToday >= input.relayerPolicy.dailyProjectQuota) {
            throw relayerQuotaExhausted();
          }
        }
        const inserted = await client.query(
          `INSERT INTO proofline_private.relayer_transactions
            (id, run_id, idempotency_key, chain_id, from_address, nonce,
             target_address, calldata_hash, command_fingerprint, value_wei,
             raw_signed_transaction, transaction_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            randomUUID(),
            value.runId,
            value.idempotencyKey,
            value.chainId,
            hexBytes(value.fromAddress, 20),
            value.nonce.toString(),
            hexBytes(value.target, 20),
            digestHexBytes(value.calldata),
            new Uint8Array(Buffer.from(fingerprint, "hex")),
            value.valueWei.toString(),
            hexBytes(value.rawTransaction),
            hexBytes(value.transactionHash, 32),
          ],
        );
        if (inserted.rowCount !== 1) {
          const existing = await client.query(
            `SELECT run_id, chain_id, nonce, target_address, calldata_hash,
                    command_fingerprint, value_wei, raw_signed_transaction,
                    transaction_hash, idempotency_key
             FROM proofline_private.relayer_transactions
             WHERE idempotency_key = $1 OR run_id = $2`,
            [value.idempotencyKey, value.runId],
          );
          if (!matches(existing.rows[0])) {
            throw new Error("Persisted relayer idempotency identity conflict");
          }
        } else {
          await client.query(
            `INSERT INTO proofline_private.relayer_audit_events
              (id, project_id, run_id, event_type, evidence)
             VALUES ($1, $2, $3, 'RELAYER_TRANSACTION_SIGNED', $4::jsonb)`,
            [
              randomUUID(),
              value.projectId,
              value.runId,
              JSON.stringify({
                idempotencyKey: value.idempotencyKey,
                chainId: value.chainId,
                fromAddress: value.fromAddress,
                nonce: value.nonce.toString(),
                target: value.target,
                calldataHash: Buffer.from(digestHexBytes(value.calldata)).toString(
                  "hex",
                ),
                valueWei: value.valueWei.toString(),
                transactionHash: value.transactionHash,
                commandFingerprint: value.commandFingerprint,
              }),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async claimRelayerBroadcastAttempt(
      idempotencyKey: string,
      transactionHash: string,
    ): Promise<boolean> {
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `UPDATE proofline_private.relayer_transactions
           SET broadcast_attempted_at = now()
           WHERE idempotency_key = $1
             AND transaction_hash = $2
             AND broadcast_attempted_at IS NULL
             AND broadcast_at IS NULL
           RETURNING id, run_id`,
          [idempotencyKey, hexBytes(transactionHash, 32)],
        );
        if (claimed.rowCount !== 1) {
          await client.query("COMMIT");
          return false;
        }
        await client.query(
          `INSERT INTO proofline_private.relayer_audit_events
            (id, project_id, run_id, event_type, evidence)
           SELECT $1, run.project_id, relayer.run_id,
                  'RELAYER_TRANSACTION_BROADCAST_ATTEMPT', $3::jsonb
           FROM proofline_private.relayer_transactions AS relayer
           JOIN proofline_private.runs AS run ON run.id = relayer.run_id
           WHERE relayer.idempotency_key = $2`,
          [
            randomUUID(),
            idempotencyKey,
            JSON.stringify({ idempotencyKey, transactionHash }),
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async markRelayerBroadcast(
      idempotencyKey: string,
      transactionHash: string,
    ): Promise<void> {
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE proofline_private.relayer_transactions
           SET broadcast_at = now()
           WHERE idempotency_key = $1
             AND transaction_hash = $2
             AND broadcast_attempted_at IS NOT NULL
             AND broadcast_at IS NULL
           RETURNING id`,
          [idempotencyKey, hexBytes(transactionHash, 32)],
        );
        if (result.rowCount !== 1) {
          const existing = await client.query(
            `SELECT transaction_hash, broadcast_at
             FROM proofline_private.relayer_transactions
             WHERE idempotency_key = $1`,
            [idempotencyKey],
          );
          const row = existing.rows[0];
          if (
            !row?.broadcast_at ||
            bytesHex(row.transaction_hash).toLowerCase() !==
              transactionHash.toLowerCase()
          ) {
            throw new Error("Relayer broadcast marker identity conflict");
          }
        } else {
          await client.query(
            `INSERT INTO proofline_private.relayer_audit_events
              (id, project_id, run_id, event_type, evidence)
             SELECT $1, run.project_id, relayer.run_id,
                    'RELAYER_TRANSACTION_BROADCAST', $3::jsonb
             FROM proofline_private.relayer_transactions AS relayer
             JOIN proofline_private.runs AS run ON run.id = relayer.run_id
             WHERE relayer.idempotency_key = $2`,
            [
              randomUUID(),
              idempotencyKey,
              JSON.stringify({ idempotencyKey, transactionHash }),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async loadRunExecutionContext(runId: string) {
      const client = await input.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const run = await client.query(
          `SELECT id, project_id, manifest, projection, last_sequence
           FROM proofline_private.runs
           WHERE id = $1`,
          [runId],
        );
        if (run.rowCount !== 1) throw new Error("Run execution context not found");
        const events = await client.query(
          `SELECT event_payload
           FROM proofline_private.run_events
           WHERE run_id = $1
           ORDER BY sequence`,
          [runId],
        );
        const artifacts = await client.query(
          `SELECT id, run_id, kind, canonical_bytes, sha256, metadata
           FROM proofline_private.run_artifacts
           WHERE run_id = $1
           ORDER BY created_at, id`,
          [runId],
        );
        await client.query("COMMIT");
        const row = run.rows[0];
        const journal = events.rows.map((item) =>
          RunEventV1Schema.parse(item.event_payload),
        );
        return {
          runId: String(row.id),
          projectId: String(row.project_id),
          manifest: Coston2Web2JsonManifestV1Schema.parse(row.manifest),
          projection: projectRun(journal),
          events: journal,
          artifacts: artifacts.rows.map((item) => ({
            id: String(item.id),
            runId: String(item.run_id),
            kind: String(item.kind),
            canonicalBytes:
              item.canonical_bytes instanceof Uint8Array
                ? new Uint8Array(item.canonical_bytes)
                : new Uint8Array(),
            sha256:
              item.sha256 instanceof Uint8Array
                ? new Uint8Array(item.sha256)
                : new Uint8Array(),
            metadata:
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {},
          })),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async renewLease(
      commandId: string,
      claimToken: string,
      interval = "30 seconds",
    ): Promise<void> {
      const client = await input.pool.connect();
      try {
        const result = await client.query(POSTGRES_QUERIES.renewLease, [
          commandId,
          claimToken,
          interval,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Command lease is stale; renewal rejected");
        }
      } finally {
        client.release();
      }
    },

    async claimNextCommand() {
      const client = await input.pool.connect();
      const claimToken = randomUUID();
      try {
        await client.query("BEGIN");
        const result = await client.query(POSTGRES_QUERIES.claimNextCommand, [
          claimToken,
          "30 seconds",
        ]);
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const attempts = Number(row.attempts);
        if (attempts > 1) {
          const prior = await client.query(POSTGRES_QUERIES.loadEvents, [
            String(row.run_id),
          ]);
          const events = prior.rows.map((item) =>
            RunEventV1Schema.parse(item.event_payload),
          );
          const latestRecovery = unresolvedRecoveryEvent(
            events,
            String(row.id),
          );
          const latest = latestRecovery ?? latestRecoveryEvent(
            events,
            String(row.id),
          );
          const stage = latest?.payload.stage ?? failureStage(row.kind);
          const resumeFrom = latest?.payload.resumeFrom ?? recoveryCheckpoint(row.kind);
          const evidence = latest?.payload.preservedEvidence ?? preservedEvidence(events);
          let resumeSequence = events.length + 1;
          if (
            !latestRecovery &&
            ((latest?.type === "RUN_RESUMED" &&
              latest.payload.attempt === attempts - 1) ||
              (!latest && attempts === 2))
          ) {
            const occurredAt = new Date().toISOString();
            await appendEventInTransaction(
              client,
              RunEventV1Schema.parse({
                version: "1",
                runId: String(row.run_id),
                sequence: resumeSequence,
                commandId: String(row.id),
                occurredAt,
                type: "STAGE_RETRY_SCHEDULED",
                payload: {
                  version: "1",
                  state: "retryable",
                  stage,
                  attempt: attempts - 1,
                  retryAfter: occurredAt,
                  resumeFrom,
                  preservedEvidence: evidence,
                  updatedAt: occurredAt,
                  error: {
                    version: "1",
                    category: "timeout",
                    code: "COMMAND_LEASE_EXPIRED",
                    message: "Command lease expired before completion",
                    retryable: true,
                    evidence: { attempt: attempts - 1, commandId: String(row.id) },
                  },
                  retrySafety: "same-command",
                },
              }),
            );
            resumeSequence += 1;
          }
          if (
            latest?.type === "STAGE_WAITING" ||
            latest?.type === "STAGE_RETRY_SCHEDULED" ||
            latest?.type === "RUN_RESUMED" ||
            (!latest && attempts === 2)
          ) {
            await appendEventInTransaction(
              client,
              RunEventV1Schema.parse({
                version: "1",
                runId: String(row.run_id),
                sequence: resumeSequence,
                commandId: String(row.id),
                occurredAt: new Date().toISOString(),
                type: "RUN_RESUMED",
                payload: {
                  stage,
                  attempt: attempts,
                  resumeFrom,
                  preservedEvidence: evidence,
                },
              }),
            );
          }
        }
        await client.query("COMMIT");
        return {
          claimToken,
          command: {
            id: String(row.id),
            kind: String(row.kind),
            runId: String(row.run_id),
            attempts,
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
            nextCommands?: Array<{
              id: string;
              projectId: string;
              runId: string;
              idempotencyKey: string;
              kind: string;
              payload: Record<string, unknown>;
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
          for (const command of result.nextCommands ?? []) {
            await client.query(
              `INSERT INTO proofline_private.run_commands
                (id, project_id, run_id, idempotency_key, kind, payload)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (project_id, idempotency_key) DO NOTHING`,
              [
                command.id,
                command.projectId,
                command.runId,
                command.idempotencyKey,
                command.kind,
                JSON.stringify(command.payload),
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
        await client.query("BEGIN");
        const result = await client.query(POSTGRES_QUERIES.retryCommand, [
          commandId,
          claimToken,
          failure.retryable === true,
          JSON.stringify(failure),
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Command lease is stale; retry rejected");
        }
        const runId = result.rows[0]?.run_id;
        const retryAttempt = Number(result.rows[0]?.attempts);
        const retryAvailableAt = new Date(String(result.rows[0]?.available_at));
        if (
          failure.retryable === true &&
          typeof runId === "string" &&
          Number.isInteger(retryAttempt) &&
          retryAttempt > 0 &&
          Number.isFinite(retryAvailableAt.getTime())
        ) {
          const prior = await client.query(POSTGRES_QUERIES.loadEvents, [runId]);
          const events = prior.rows.map((row) =>
            RunEventV1Schema.parse(row.event_payload),
          );
          const attempt = retryAttempt;
          const retryAfter = retryAvailableAt.toISOString();
          const state = failure.recoveryState === "waiting" ||
            failure.category === "not-finalized"
            ? "waiting"
            : "retryable";
          const recovery = RunRecoveryV1Schema.parse({
            version: "1",
            state,
            stage: failureStage(result.rows[0]?.kind),
            attempt,
            retryAfter,
            resumeFrom: recoveryCheckpoint(result.rows[0]?.kind),
            preservedEvidence: preservedEvidence(events),
            updatedAt: new Date().toISOString(),
            error: recoveryError(failure, true),
            retrySafety: state === "waiting" &&
              failureStage(result.rows[0]?.kind) !== "preflight"
              ? "observe-only"
              : "same-command",
          });
          await appendEventInTransaction(
            client,
            RunEventV1Schema.parse({
              version: "1",
              runId,
              sequence: events.length + 1,
              commandId,
              occurredAt: recovery.updatedAt,
              type: state === "waiting"
                ? "STAGE_WAITING"
                : "STAGE_RETRY_SCHEDULED",
              payload: recovery,
            }),
          );
        }
        if (failure.terminal === true && typeof runId === "string") {
          const locked = await client.query(POSTGRES_QUERIES.lockRun, [runId]);
          if (locked.rowCount !== 1) {
            throw new Error("Terminal failure run is missing");
          }
          const projection = locked.rows[0]?.projection;
          const alreadyTerminal =
            projection &&
            typeof projection === "object" &&
            (projection as { terminal?: unknown }).terminal === true;
          if (!alreadyTerminal) {
            const sequence = Number(locked.rows[0]?.last_sequence ?? 0) + 1;
            const prior = await client.query(POSTGRES_QUERIES.loadEvents, [runId]);
            const events = prior.rows.map((row) =>
              RunEventV1Schema.parse(row.event_payload),
            );
            const error = terminalError(failure);
            const terminalRecoveryError = recoveryError(failure, false);
            const updatedAt = new Date().toISOString();
            const terminalEvent = RunEventV1Schema.parse({
              version: "1",
              runId,
              sequence,
              commandId,
              occurredAt: updatedAt,
              type: "RUN_FAILED",
              payload: {
                stage: failureStage(result.rows[0]?.kind),
                error,
                recovery: {
                  version: "1",
                  state: "terminal",
                  stage: failureStage(result.rows[0]?.kind),
                  attempt: Math.max(1, Number(result.rows[0]?.attempts ?? 1)),
                  resumeFrom: recoveryCheckpoint(result.rows[0]?.kind),
                  preservedEvidence: preservedEvidence(events),
                  updatedAt,
                  error: terminalRecoveryError,
                  retrySafety: terminalRetrySafety(failure),
                },
              },
            });
            await appendEventInTransaction(client, terminalEvent);
          }
          await client.query(
            `UPDATE proofline_private.run_commands
             SET status = 'cancelled',
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 updated_at = now()
             WHERE run_id = $1
               AND id <> $2
               AND status IN ('queued', 'leased')`,
            [runId, commandId],
          );
        }
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
