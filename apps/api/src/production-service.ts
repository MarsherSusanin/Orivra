import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  Coston2Web2JsonManifestV1Schema,
  NETWORK_CAPABILITIES_V1,
  ConsumerLabReportV1Schema,
  DiagnosticV1Schema,
  PreflightReportV1Schema,
  RunEventV1Schema,
  RunListPageV1Schema,
  RunProjectionV1Schema,
  ShareLinkV1Schema,
  SubmissionResponseV1Schema,
  Web2JsonManifestV1Schema,
  isCanonicalUint256Decimal,
  type RunStageNameV1,
  type RunEventV1,
} from "@proofline/contracts";
import {
  canonicalJson,
  canonicalSerializeProofBundle,
  canonicalSerializePreflightReport,
  createEvidenceReceipt,
  generateSafeWeb2JsonConsumer,
  projectRun,
  replayProofBundle,
} from "@proofline/domain";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { createAccountTokenService } from "./account-token-service";
import { digestOpaqueToken } from "./postgres";
import type { ApiQuotaPolicy } from "./bootstrap";
import {
  createPersistedWalletAuthService,
  viemWalletAuthPorts,
  type WalletAuthPorts,
} from "./wallet-session-service";

const PersistedAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const PersistedUint256Schema = z.string().refine(isCanonicalUint256Decimal);
const PersistedPreflightEvidenceV1Schema = z
  .object({
    version: z.literal("1"),
    canonicalUrl: z.string().url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.port === "" || url.port === "443") &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    }),
    requestBytes: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/),
    requestCalldata: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    quotedFeeWei: PersistedUint256Schema,
    network: z
      .object({
        chainId: z.literal(114),
        blockNumber: PersistedUint256Schema,
        registryAddress: PersistedAddressSchema,
        resolvedContracts: z
          .object({
            FdcHub: PersistedAddressSchema,
            FdcRequestFeeConfigurations: PersistedAddressSchema,
            FdcVerification: PersistedAddressSchema,
            Relay: PersistedAddressSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const canonicalVulnerableConsumer = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/// @notice Diagnostic fixture: proof integrity is checked, but the source URL is not.
contract CanonicalVulnerableWeb2JsonConsumer {
    error InvalidWeb2JsonProof();

    function consume(IWeb2Json.Proof calldata proof) external view returns (bytes memory) {
        if (!ContractRegistry.getFdcVerification().verifyWeb2Json(proof)) {
            revert InvalidWeb2JsonProof();
        }
        return proof.data.responseBody.abiEncodedData;
    }
}
`;

function fullUnifiedDiff(left: string, right: string, contractName: string) {
  const leftLines = left.trimEnd().split("\n");
  const rightLines = right.trimEnd().split("\n");
  return [
    "--- canonical-vulnerable",
    `+++ ${contractName}`,
    `@@ -1,${leftLines.length} +1,${rightLines.length} @@`,
    ...leftLines.map((line) => `-${line}`),
    ...rightLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function pathPrefixMatches(pathname: string, prefix: string) {
  return prefix === "/" || pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

function expectedQueryMatches(url: URL, expected: Record<string, string>) {
  return Object.entries(expected).every(
    ([key, value]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value,
  );
}

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

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw Object.assign(new Error("A bounded idempotency key is required"), {
      status: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  return value;
}

const RUN_STAGES = [
  "preflight",
  "request",
  "round",
  "proof",
  "verify",
  "consumer",
] as const satisfies readonly RunStageNameV1[];

type RunListCursor = { updatedAt: string; id: string };

function decodeRunListCursor(value: unknown): RunListCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      Object.keys(decoded).length !== 2 ||
      typeof decoded.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(decoded.updatedAt)) ||
      typeof decoded.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        decoded.id,
      )
    ) {
      throw new Error("invalid cursor");
    }
    return { updatedAt: new Date(decoded.updatedAt).toISOString(), id: decoded.id };
  } catch {
    throw Object.assign(new Error("Run list cursor is invalid"), {
      status: 400,
      code: "INVALID_RUN_LIST_CURSOR",
    });
  }
}

function encodeRunListCursor(value: RunListCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function runCurrentStage(
  stages: Record<RunStageNameV1, string>,
): RunStageNameV1 {
  return (
    RUN_STAGES.find((stage) => stages[stage] === "active" || stages[stage] === "failed") ??
    [...RUN_STAGES].reverse().find((stage) => stages[stage] === "completed") ??
    "preflight"
  );
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

function normalizePublicWebOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public web origin must be a valid HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Public web origin must be an HTTPS default-port root origin");
  }
  return url.origin;
}

function quotaSubjectDigest(domain: string, subject: string): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(domain, "utf8")
      .update(subject, "utf8")
      .digest(),
  );
}

function quotaDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function quotaRetryAfterSeconds(
  databaseNow: Date,
  windowEnd: Date,
  maximum: number,
): number {
  return Math.max(
    1,
    Math.min(maximum, Math.ceil((windowEnd.getTime() - databaseNow.getTime()) / 1_000)),
  );
}

function quotaFailure(
  status: 409 | 429,
  code: "PROJECT_RUN_QUOTA_EXHAUSTED" | "ACTIVE_LIVE_RUN_LIMIT_REACHED",
  retryAfterSeconds?: number,
): Error {
  return Object.assign(new Error("Run admission limit reached"), {
    status,
    code,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

export function createProductionProoflineService(input: {
  pool: Pool;
  tokenDigestKey: string;
  publicWebOrigin: string;
  walletAuthPorts?: WalletAuthPorts;
  quotaPolicy?: ApiQuotaPolicy;
}) {
  const quotaPolicy = input.quotaPolicy ?? (() => {
    if (process.env.NODE_ENV === "test") return null;
    throw new Error("Persisted API quota policy is required");
  })();
  const publicWebOrigin = normalizePublicWebOrigin(input.publicWebOrigin);
  const walletAuthService = createPersistedWalletAuthService({
    pool: input.pool,
    tokenDigestKey: input.tokenDigestKey,
    publicWebOrigin,
    ports: input.walletAuthPorts ?? viemWalletAuthPorts,
    quotaPolicy,
  });
  const accountTokenService = createAccountTokenService({
    pool: input.pool,
    tokenDigestKey: input.tokenDigestKey,
  });

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

  function assertSubmissionMode(
    manifest: { submission: { mode: string } },
    expectedMode: "wallet" | "relayer" | "replay",
  ): void {
    if (manifest.submission.mode !== expectedMode) {
      throw Object.assign(
        new Error(
          `Persisted submission mode ${manifest.submission.mode} does not authorize ${expectedMode}`,
        ),
        { status: 409, code: "SUBMISSION_MODE_MISMATCH" },
      );
    }
  }

  function assertCompletedPreflight(projection: unknown): void {
    const preflight =
      projection && typeof projection === "object"
        ? (projection as { stages?: { preflight?: unknown } }).stages?.preflight
        : undefined;
    if (preflight !== "completed") {
      throw Object.assign(new Error("Preflight evidence is not ready"), {
        status: 409,
        code: "PREFLIGHT_NOT_READY",
      });
    }
  }

  function submissionIntentConflict(message: string): Error {
    return Object.assign(new Error(message), {
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
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
      manifest: Coston2Web2JsonManifestV1Schema.parse(result.rows[0].manifest),
    };
  }

  async function loadMutableOwnedRun(context: Record<string, unknown>) {
    const run = await loadOwnedRun(context);
    assertMutableProjection(run.projection);
    return run;
  }

  async function loadVerifiedBundleBytes(
    context: Record<string, unknown>,
    codes: { pending: string; invalid: string },
  ): Promise<string> {
    const runId = requireRunId(context.runId);
    const result = await input.pool.query(
      `SELECT artifact.canonical_bytes, artifact.sha256
       FROM proofline_private.run_artifacts AS artifact
       JOIN proofline_private.runs AS run ON run.id = artifact.run_id
       WHERE artifact.run_id = $1 AND run.project_id = $2
         AND artifact.kind = 'proof-bundle'
       ORDER BY artifact.created_at DESC
       LIMIT 1`,
      [runId, context.projectId],
    );
    const row = result.rows[0];
    if (!result.rowCount || !row?.canonical_bytes || !row?.sha256) {
      throw Object.assign(new Error("Proof bundle is not available"), {
        status: 409,
        code: codes.pending,
      });
    }
    const bytes = Buffer.from(row.canonical_bytes);
    const stored = Buffer.from(row.sha256).toString("hex");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (stored !== actual) {
      throw Object.assign(new Error("Persisted proof bundle checksum mismatch"), {
        status: 500,
        code: codes.invalid,
      });
    }
    return bytes.toString("utf8");
  }

  async function findCommandIntent(
    projectId: unknown,
    idempotencyKey: unknown,
  ) {
    const result = await input.pool.query(
      `SELECT project_id, run_id, idempotency_key, kind, payload, id
       FROM proofline_private.run_commands
       WHERE project_id = $1 AND idempotency_key = $2`,
      [projectId, idempotencyKey],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  async function findSubmissionCommandByRun(runId: string) {
    const result = await input.pool.query(
      `SELECT project_id, run_id, idempotency_key, kind, payload, id
       FROM proofline_private.run_commands
       WHERE run_id = $1
         AND kind IN (
           'ATTACH_WALLET_TRANSACTION',
           'SUBMIT_RELAYER',
           'APPLY_REPLAY_EVIDENCE'
         )
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
    const expectedMode =
      kind === "SUBMIT_RELAYER"
        ? "relayer"
        : kind === "ATTACH_WALLET_TRANSACTION"
          ? "wallet"
          : kind === "APPLY_REPLAY_EVIDENCE"
            ? "replay"
            : null;
    if (expectedMode) assertSubmissionMode(owned.manifest, expectedMode);
    const existing = await findCommandIntent(
      context.projectId,
      context.idempotencyKey,
    );
    if (existing) {
      if (!sameIntent(existing, runId, kind, payload)) {
        throw submissionIntentConflict("Idempotency key command intent conflict");
      }
      return {
        accepted: true,
        runId,
        commandId: String(existing.id ?? ""),
      };
    }
    assertMutableProjection(owned.projection);
    if (expectedMode) assertCompletedPreflight(owned.projection);

    if (expectedMode) {
      const priorSubmission = await findSubmissionCommandByRun(runId);
      if (priorSubmission) {
        throw submissionIntentConflict(
          "Run already has one active submission authority",
        );
      }
    }

    let inserted;
    const commandId = randomUUID();
    try {
      inserted = await input.pool.query(
        `INSERT INTO proofline_private.run_commands
          (id, project_id, run_id, idempotency_key, kind, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (project_id, idempotency_key) DO NOTHING
         RETURNING project_id, run_id, idempotency_key, kind, payload, id`,
        [
          commandId,
          context.projectId,
          runId,
          context.idempotencyKey,
          kind,
          JSON.stringify(payload),
        ],
      );
    } catch (cause) {
      if (expectedMode && isUniqueViolation(cause)) {
        const racedSubmission = await findSubmissionCommandByRun(runId);
        if (racedSubmission) {
          throw submissionIntentConflict(
            "Run already has one active submission authority",
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
        throw submissionIntentConflict("Idempotency key command intent conflict");
      }
    }
    const accepted = inserted.rows[0] ?? (await findCommandIntent(
      context.projectId,
      context.idempotencyKey,
    ));
    return {
      accepted: true,
      runId,
      commandId: String(accepted?.id ?? (inserted.rowCount ? commandId : "")),
    };
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

  async function reserveProjectDailyQuota(
    client: PoolClient,
    projectId: string,
    policy: ApiQuotaPolicy,
  ): Promise<Date | undefined> {
    const subjectDigest = quotaSubjectDigest(
      "proofline:quota:project-run-day:v1\0",
      projectId,
    );
    const reserved = await client.query(
      `WITH quota_clock AS (
         SELECT date_trunc('milliseconds', clock_timestamp()) AS database_now
       ), quota_window AS (
         SELECT database_now,
                date_trunc('day', database_now, 'UTC') AS window_start,
                date_trunc('day', database_now, 'UTC') + interval '1 day' AS window_end
         FROM quota_clock
       )
       INSERT INTO proofline_private.quota_windows
         (quota_kind, subject_digest, window_start, window_end, limit_value, used_count)
       SELECT $1, $2, window_start, window_end, $3, 1
       FROM quota_window
       ON CONFLICT (quota_kind, subject_digest, window_start)
       DO UPDATE SET used_count = proofline_private.quota_windows.used_count + 1
       WHERE proofline_private.quota_windows.used_count <
             proofline_private.quota_windows.limit_value
       RETURNING used_count, limit_value, window_end,
                 (SELECT database_now FROM quota_window) AS database_now`,
      ["project_run_day", subjectDigest, policy.projectRunsPerUtcDay],
    );
    if (reserved.rowCount) {
      return quotaDate(reserved.rows[0]?.database_now);
    }
    const rejected = await client.query(
      `WITH quota_clock AS (
         SELECT date_trunc('milliseconds', clock_timestamp()) AS database_now
       )
       SELECT quota_clock.database_now, quota.window_end
       FROM quota_clock
       JOIN proofline_private.quota_windows AS quota
         ON quota.quota_kind = 'project_run_day'
        AND quota.subject_digest = $1
        AND quota.window_start = date_trunc('day', quota_clock.database_now, 'UTC')`,
      [subjectDigest],
    );
    const databaseNow = quotaDate(rejected.rows[0]?.database_now)!;
    const windowEnd = quotaDate(rejected.rows[0]?.window_end)!;
    throw quotaFailure(
      429,
      "PROJECT_RUN_QUOTA_EXHAUSTED",
      quotaRetryAfterSeconds(databaseNow, windowEnd, 86_400),
    );
  }

  async function enforceActiveLiveQuota(
    client: PoolClient,
    projectId: string,
    policy: ApiQuotaPolicy,
  ): Promise<void> {
    const subjectDigest = quotaSubjectDigest(
      "proofline:quota:project-active-live:v1\0",
      projectId,
    );
    const persistedPolicy = await client.query(
      `WITH quota_clock AS (
         SELECT date_trunc('milliseconds', clock_timestamp()) AS database_now
       ), quota_window AS (
         SELECT date_trunc('day', database_now, 'UTC') AS window_start,
                date_trunc('day', database_now, 'UTC') + interval '1 day' AS window_end
         FROM quota_clock
       )
       INSERT INTO proofline_private.quota_windows
         (quota_kind, subject_digest, window_start, window_end, limit_value, used_count)
       SELECT $1, $2, window_start, window_end, $3, 0
       FROM quota_window
       ON CONFLICT (quota_kind, subject_digest, window_start)
       DO UPDATE SET used_count = proofline_private.quota_windows.used_count
       RETURNING used_count, limit_value, window_end`,
      ["active_live", subjectDigest, policy.projectActiveLiveRuns],
    );
    let limitValue = Number(persistedPolicy.rows[0]?.limit_value);
    if (!Number.isSafeInteger(limitValue) || limitValue < 1) {
      const stored = await client.query(
        `SELECT limit_value
         FROM proofline_private.quota_windows
         WHERE quota_kind = 'active_live'
           AND subject_digest = $1
           AND window_start = date_trunc('day', clock_timestamp(), 'UTC')`,
        [subjectDigest],
      );
      limitValue = Number(stored.rows[0]?.limit_value);
    }
    if (!Number.isSafeInteger(limitValue) || limitValue < 1) {
      if (process.env.NODE_ENV !== "test") {
        throw new Error("Persisted active live-run policy is invalid");
      }
      limitValue = policy.projectActiveLiveRuns;
    }
    const active = await client.query(
      `SELECT count(*)::integer AS active_live_runs
       FROM proofline_private.runs
       WHERE project_id = $1
         AND manifest->'submission'->>'mode' IN ('wallet', 'relayer')
         AND COALESCE((projection->>'terminal')::boolean, false) = false`,
      [projectId],
    );
    const activeLiveRuns = Number(active.rows[0]?.active_live_runs);
    if (!Number.isSafeInteger(activeLiveRuns) || activeLiveRuns < 0) {
      throw new Error("Persisted active live-run count is invalid");
    }
    if (activeLiveRuns >= limitValue) {
      throw quotaFailure(409, "ACTIVE_LIVE_RUN_LIMIT_REACHED");
    }
  }

  return {
    ...walletAuthService,
    ...accountTokenService,
    async listNetworks() {
      return NETWORK_CAPABILITIES_V1;
    },

    async createRun(context: Record<string, unknown>) {
      const manifest = Web2JsonManifestV1Schema.parse(context.manifest);
      if (manifest.network !== "coston2") {
        throw Object.assign(new Error("Network capability is disabled"), {
          status: 409,
          code: "NETWORK_CAPABILITY_DISABLED",
        });
      }
      const requestFingerprint = fingerprint(manifest);
      const projectId = String(context.projectId ?? "").toLowerCase();
      requireIdempotencyKey(context.idempotencyKey);
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
          [projectId, context.idempotencyKey],
        );
        if (
          existing.rowCount === 1 &&
          Buffer.from(existing.rows[0].request_fingerprint).equals(
            requestFingerprint,
          )
        ) {
          return accepted(String(existing.rows[0].id));
        }
        throw Object.assign(new Error("Idempotency conflict"), {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
        });
      };
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `SELECT id, request_fingerprint
           FROM proofline_private.runs
           WHERE project_id = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [projectId, context.idempotencyKey],
        );
        if (existing.rowCount) {
          if (
            !Buffer.from(existing.rows[0].request_fingerprint).equals(
              requestFingerprint,
            )
          ) {
            throw Object.assign(new Error("Idempotency conflict"), {
              status: 409,
              code: "IDEMPOTENCY_CONFLICT",
            });
          }
          await client.query("COMMIT");
          return accepted(String(existing.rows[0].id));
        }

        let eventClock: Date | undefined;
        if (quotaPolicy) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [projectId],
          );
          const raced = await client.query(
            `SELECT id, request_fingerprint
             FROM proofline_private.runs
             WHERE project_id = $1 AND idempotency_key = $2
             FOR UPDATE`,
            [projectId, context.idempotencyKey],
          );
          if (raced.rowCount) {
            if (
              !Buffer.from(raced.rows[0].request_fingerprint).equals(
                requestFingerprint,
              )
            ) {
              throw Object.assign(new Error("Idempotency conflict"), {
                status: 409,
                code: "IDEMPOTENCY_CONFLICT",
              });
            }
            await client.query("COMMIT");
            return accepted(String(raced.rows[0].id));
          }
          eventClock = await reserveProjectDailyQuota(
            client,
            projectId,
            quotaPolicy,
          );
          if (manifest.submission.mode !== "replay") {
            await enforceActiveLiveQuota(client, projectId, quotaPolicy);
          }
        }

        const runId = randomUUID();
        const event: RunEventV1 = RunEventV1Schema.parse({
          version: "1",
          runId,
          sequence: 1,
          commandId: String(context.idempotencyKey),
          occurredAt: (eventClock ?? new Date()).toISOString(),
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
            projectId,
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
            projectId,
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

    async getPreflightReport(context: Record<string, unknown>) {
      const runId = requireRunId(context.runId);
      const result = await input.pool.query(
        `SELECT run.id, run.project_id, run.projection,
                artifact.canonical_bytes, artifact.sha256
         FROM proofline_private.runs AS run
         LEFT JOIN LATERAL (
           SELECT canonical_bytes, sha256
           FROM proofline_private.run_artifacts
           WHERE run_id = run.id AND kind = 'preflight-report-v1'
           LIMIT 1
         ) AS artifact ON true
         WHERE run.id = $1 AND run.project_id = $2
         LIMIT 1`,
        [runId, context.projectId],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error("Run not found"), { status: 404 });
      }
      const row = result.rows[0];
      if (row.canonical_bytes === null || row.canonical_bytes === undefined) {
        const projection =
          row.projection && typeof row.projection === "object"
            ? (row.projection as Record<string, unknown>)
            : {};
        const stages =
          projection.stages && typeof projection.stages === "object"
            ? (projection.stages as Record<string, unknown>)
            : {};
        const pending =
          projection.terminal !== true &&
          stages.preflight !== "completed" &&
          stages.preflight !== "failed";
        throw Object.assign(
          new Error(
            pending
              ? "Preflight report is still pending"
              : "Preflight report is unavailable for this run",
          ),
          {
            status: 409,
            code: pending
              ? "PREFLIGHT_REPORT_PENDING"
              : "PREFLIGHT_REPORT_UNAVAILABLE",
          },
        );
      }

      const invalid = () =>
        Object.assign(new Error("Persisted preflight report is invalid"), {
          status: 500,
          code: "PREFLIGHT_REPORT_INVALID",
        });
      try {
        if (!(row.canonical_bytes instanceof Uint8Array)) throw invalid();
        if (!(row.sha256 instanceof Uint8Array)) throw invalid();
        const canonicalBytes = Buffer.from(row.canonical_bytes);
        const storedDigest = Buffer.from(row.sha256);
        const actualDigest = createHash("sha256").update(canonicalBytes).digest();
        if (storedDigest.length !== 32 || !storedDigest.equals(actualDigest)) {
          throw invalid();
        }
        const decoded: unknown = JSON.parse(canonicalBytes.toString("utf8"));
        const report = PreflightReportV1Schema.parse(decoded);
        if (report.runId !== runId) throw invalid();
        if (
          canonicalSerializePreflightReport(report) !==
          canonicalBytes.toString("utf8")
        ) {
          throw invalid();
        }
        return report;
      } catch (cause) {
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          (cause as { code?: unknown }).code === "PREFLIGHT_REPORT_INVALID"
        ) {
          throw cause;
        }
        throw invalid();
      }
    },

    async listRuns(context: Record<string, unknown>) {
      const cursor = decodeRunListCursor(context.cursor);
      const limit = Number(context.limit ?? 20);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        throw Object.assign(new Error("Run list limit is invalid"), {
          status: 400,
          code: "INVALID_RUN_LIST_QUERY",
        });
      }
      const values: unknown[] = [context.projectId];
      const predicates = ["run.project_id = $1"];
      const status = context.status;
      const failedSql = `(run.projection ? 'terminalFailure' OR run.projection->'stages'->>'consumer' = 'failed')`;
      if (status === "active") {
        predicates.push(`COALESCE((run.projection->>'terminal')::boolean, false) = false`);
      } else if (status === "completed") {
        predicates.push(`COALESCE((run.projection->>'terminal')::boolean, false) = true`);
        predicates.push(`NOT ${failedSql}`);
      } else if (status === "failed") {
        predicates.push(failedSql);
      } else if (status !== undefined) {
        throw Object.assign(new Error("Run list status is invalid"), {
          status: 400,
          code: "INVALID_RUN_LIST_QUERY",
        });
      }
      if (cursor) {
        values.push(cursor.updatedAt, cursor.id);
        predicates.push(
          `(run.updated_at, run.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(limit + 1);
      const result = await input.pool.query(
        `SELECT run.id, run.manifest, run.projection, run.last_sequence,
                run.created_at, run.updated_at
         FROM proofline_private.runs AS run
         WHERE ${predicates.join(" AND ")}
         ORDER BY run.updated_at DESC, run.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const pageRows = result.rows.slice(0, limit);
      const runs = pageRows.map((row) => {
        const manifest = Coston2Web2JsonManifestV1Schema.parse(row.manifest);
        const projection = RunProjectionV1Schema.parse(row.projection);
        const hasFailedStage = RUN_STAGES.some(
          (stage) => projection.stages[stage] === "failed",
        );
        return {
          version: "1" as const,
          runId: String(row.id),
          network: manifest.network,
          sourceHost: new URL(manifest.request.url).hostname.toLowerCase(),
          submissionMode: manifest.submission.mode,
          currentStage: runCurrentStage(projection.stages),
          status: hasFailedStage
            ? ("failed" as const)
            : projection.terminal
              ? ("completed" as const)
              : ("active" as const),
          createdAt: new Date(String(row.created_at)).toISOString(),
          updatedAt: new Date(String(row.updated_at)).toISOString(),
          lastSequence: Number(row.last_sequence),
          resumable: !projection.terminal,
        };
      });
      const last = pageRows.at(-1);
      return RunListPageV1Schema.parse({
        version: "1",
        runs,
        ...(result.rows.length > limit && last
          ? {
              nextCursor: encodeRunListCursor({
                updatedAt: new Date(String(last.updated_at)).toISOString(),
                id: String(last.id),
              }),
            }
          : {}),
      });
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
      requireIdempotencyKey(context.idempotencyKey);
      const mode = context.mode;
      if (mode !== "wallet" && mode !== "relayer" && mode !== "replay") {
        throw Object.assign(new Error("Explicit submission mode is required"), {
          status: 400,
          code: "INVALID_SUBMISSION_MODE",
        });
      }
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
        const persistedManifest = Coston2Web2JsonManifestV1Schema.parse(
          row.manifest,
        );
        assertSubmissionMode(persistedManifest, "wallet");
        assertMutableProjection(row.projection);
        assertCompletedPreflight(row.projection);
        const requestStage =
          row.projection && typeof row.projection === "object"
            ? (row.projection as { stages?: { request?: unknown } }).stages
                ?.request
            : undefined;
        const priorSubmission = await findSubmissionCommandByRun(runId);
        if (requestStage !== "pending" || priorSubmission) {
          throw submissionIntentConflict(
            "Run already has one active submission authority",
          );
        }
        if (!row.canonical_bytes) {
          throw Object.assign(new Error("Preflight evidence is not ready"), {
            status: 409,
            code: "PREFLIGHT_NOT_READY",
          });
        }
        let persistedEvidence: unknown;
        try {
          persistedEvidence = JSON.parse(
            Buffer.from(row.canonical_bytes).toString("utf8"),
          );
        } catch {
          persistedEvidence = null;
        }
        const parsedEvidence =
          PersistedPreflightEvidenceV1Schema.safeParse(persistedEvidence);
        if (!parsedEvidence.success) {
          throw Object.assign(new Error("Persisted preflight evidence is invalid"), {
            status: 409,
            code: "PREFLIGHT_EVIDENCE_INVALID",
          });
        }
        const evidence = parsedEvidence.data;
        const quotedFeeWei = BigInt(evidence.quotedFeeWei);
        return SubmissionResponseV1Schema.parse({
          version: "1",
          runId,
          mode: "wallet",
          effectOwner: "wallet",
          transaction: {
            chainId: "0x72",
            to: evidence.network.resolvedContracts.FdcHub,
            data: evidence.requestCalldata,
            value: `0x${quotedFeeWei.toString(16)}`,
          },
        });
      }
      const owned = await loadOwnedRun(context);
      const runId = String(owned.id);
      assertSubmissionMode(owned.manifest, mode);
      const kind =
        mode === "relayer" ? "SUBMIT_RELAYER" : "APPLY_REPLAY_EVIDENCE";
      const payload = { idempotencyKey: context.idempotencyKey };
      const existing = await findCommandIntent(
        context.projectId,
        context.idempotencyKey,
      );
      if (existing) {
        if (!sameIntent(existing, runId, kind, payload)) {
          throw submissionIntentConflict("Idempotency key command intent conflict");
        }
        return SubmissionResponseV1Schema.parse({
          version: "1",
          runId,
          mode,
          effectOwner: mode === "relayer" ? "worker" : "none",
          commandId: String(existing.id),
        });
      }
      assertMutableProjection(owned.projection);
      assertCompletedPreflight(owned.projection);
      const accepted = await enqueue(context, kind, payload);
      return SubmissionResponseV1Schema.parse({
        version: "1",
        runId,
        mode,
        effectOwner: mode === "relayer" ? "worker" : "none",
        commandId: accepted.commandId,
      });
    },
    async attachTransaction(context: Record<string, unknown>) {
      requireIdempotencyKey(context.idempotencyKey);
      if (
        typeof context.transactionHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(context.transactionHash)
      ) {
        throw Object.assign(new Error("A valid wallet transaction hash is required"), {
          status: 400,
          code: "INVALID_WALLET_TRANSACTION",
        });
      }
      const accepted = await enqueue(context, "ATTACH_WALLET_TRANSACTION", {
        transactionHash: context.transactionHash,
      });
      return { accepted: true, runId: accepted.runId };
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

    async getConsumerLabReport(context: Record<string, unknown>) {
      const runId = requireRunId(context.runId);
      const result = await input.pool.query(
        `SELECT run.manifest,
                consumer.canonical_bytes AS consumer_bytes,
                safe.canonical_bytes AS safe_bytes,
                safe.sha256 AS safe_sha256,
                safe.metadata AS safe_metadata,
                proof.event_payload AS proof_event,
                terminal.event_payload AS consumer_event
         FROM proofline_private.runs AS run
         LEFT JOIN LATERAL (
           SELECT canonical_bytes FROM proofline_private.run_artifacts
           WHERE run_id = run.id AND kind = 'consumer-evidence'
           ORDER BY created_at DESC LIMIT 1
         ) AS consumer ON true
         LEFT JOIN LATERAL (
           SELECT canonical_bytes, sha256, metadata
           FROM proofline_private.run_artifacts
           WHERE run_id = run.id AND kind = 'safe-consumer'
           ORDER BY created_at DESC LIMIT 1
         ) AS safe ON true
         LEFT JOIN LATERAL (
           SELECT event_payload FROM proofline_private.run_events
           WHERE run_id = run.id AND event_type = 'PROOF_VERIFIED'
           ORDER BY sequence DESC LIMIT 1
         ) AS proof ON true
         LEFT JOIN LATERAL (
           SELECT event_payload FROM proofline_private.run_events
           WHERE run_id = run.id AND event_type = 'CONSUMER_VERIFIED'
           ORDER BY sequence DESC LIMIT 1
         ) AS terminal ON true
         WHERE run.id = $1 AND run.project_id = $2`,
        [runId, context.projectId],
      );
      if (!result.rowCount) throw Object.assign(new Error("Run not found"), { status: 404 });
      const row = result.rows[0];
      if (!row.consumer_bytes || !row.safe_bytes || !row.safe_sha256) {
        throw Object.assign(new Error("Consumer Lab evidence is not available"), {
          status: 409, code: "CONSUMER_LAB_PENDING",
        });
      }
      try {
        const manifest = Coston2Web2JsonManifestV1Schema.parse(row.manifest);
        const evidence = JSON.parse(Buffer.from(row.consumer_bytes).toString("utf8")) as Record<string, unknown>;
        const diagnostics = DiagnosticV1Schema.array().parse(evidence.diagnostics);
        const passed = evidence.passed === true;
        const proofEvent = RunEventV1Schema.parse(row.proof_event);
        const consumerEvent = RunEventV1Schema.parse(row.consumer_event);
        if (proofEvent.type !== "PROOF_VERIFIED" || consumerEvent.type !== "CONSUMER_VERIFIED") {
          throw new Error("Consumer Lab requires proof and terminal consumer events");
        }
        if (proofEvent.runId !== runId || consumerEvent.runId !== runId || proofEvent.sequence >= consumerEvent.sequence) {
          throw new Error("Consumer Lab lifecycle evidence does not belong to this ordered run");
        }
        const terminalDiagnostics = DiagnosticV1Schema.array().parse(
          consumerEvent.payload.diagnostics,
        );
        if (
          consumerEvent.payload.passed !== passed ||
          canonicalJson(terminalDiagnostics) !== canonicalJson(diagnostics)
        ) {
          throw new Error("Consumer artifact does not match terminal event");
        }
        const identity = evidence.consumer === "canonical-safe"
          ? "canonical-safe" as const
          : evidence.consumer === "canonical-vulnerable"
            ? "canonical-vulnerable" as const
            : (() => { throw new Error("Consumer identity is missing"); })();
        const diagnosticEvidence = diagnostics.map((item) => item.evidence);
        const requestUrl = typeof evidence.requestUrl === "string"
          ? evidence.requestUrl
          : diagnosticEvidence.find((item) => typeof item.requestUrl === "string")?.requestUrl;
        if (typeof requestUrl !== "string") throw new Error("Observed consumer URL is missing");
        const observedUrl = new URL(requestUrl);
        const missing = new Set<string>();
        for (const item of diagnosticEvidence) {
          if (Array.isArray(item.missingChecks)) {
            for (const value of item.missingChecks) if (typeof value === "string") missing.add(value);
          }
        }
        const notEnforcedInvariant = new Map([
          ["EXPECTED_HOST_NOT_ENFORCED", "host"],
          ["MISSING_CONSUMER_HOST_INVARIANT", "host"],
        ]);
        const mismatchInvariant = new Map([
          ["CONSUMER_SCHEME_MISMATCH", "scheme"],
          ["CONSUMER_HOST_MISMATCH", "host"],
          ["CONSUMER_PATH_MISMATCH", "path"],
          ["CONSUMER_QUERY_MISMATCH", "query"],
        ]);
        const mismatched = new Set<string>();
        for (const diagnostic of diagnostics) {
          const notEnforced = notEnforcedInvariant.get(diagnostic.code);
          if (notEnforced) missing.add(notEnforced);
          const mismatch = mismatchInvariant.get(diagnostic.code);
          if (mismatch) mismatched.add(mismatch);
        }
        const expectedQuery = new URLSearchParams(
          Object.entries(manifest.consumer.expectedQuery).sort(([left], [right]) => left.localeCompare(right)),
        ).toString();
        const observedQuery = observedUrl.searchParams.toString();
        const facts = [
          ["scheme", manifest.consumer.expectedScheme, observedUrl.protocol.replace(/:$/, ""), observedUrl.protocol.replace(/:$/, "") === manifest.consumer.expectedScheme],
          ["host", manifest.consumer.expectedHost, observedUrl.hostname, observedUrl.hostname === manifest.consumer.expectedHost],
          ["path", manifest.consumer.expectedPathPrefix, observedUrl.pathname, pathPrefixMatches(observedUrl.pathname, manifest.consumer.expectedPathPrefix)],
          ["query", expectedQuery, observedQuery, expectedQueryMatches(observedUrl, manifest.consumer.expectedQuery)],
        ] as const;
        const checks = facts.map(([invariant, expected, observed, matches]) => ({
          invariant, expected, observed,
          enforced: identity === "canonical-safe" && !missing.has(invariant),
          passed: identity === "canonical-safe" && !missing.has(invariant) && !mismatched.has(invariant) && matches,
        })) as [{ invariant: "scheme"; expected: string; observed: string; enforced: boolean; passed: boolean }, { invariant: "host"; expected: string; observed: string; enforced: boolean; passed: boolean }, { invariant: "path"; expected: string; observed: string; enforced: boolean; passed: boolean }, { invariant: "query"; expected: string; observed: string; enforced: boolean; passed: boolean }];
        const sourceBytes = Buffer.from(row.safe_bytes);
        const storedHash = Buffer.from(row.safe_sha256).toString("hex");
        const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
        if (storedHash !== actualHash) throw new Error("Safe consumer checksum mismatch");
        const source = sourceBytes.toString("utf8");
        const contractName = /contract\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(source)?.[1];
        if (!contractName) throw new Error("Safe consumer contract name is missing");
        const compilerVersion = row.safe_metadata?.compiler;
        const compileStatus = row.safe_metadata?.compileStatus;
        const compiledSourceSha256 = row.safe_metadata?.compiledSourceSha256;
        if (typeof compilerVersion !== "string" || compileStatus !== "passed" || compiledSourceSha256 !== `sha256:${actualHash}`) {
          throw new Error("Safe consumer compile evidence is missing");
        }
        const missingChecks = checks.filter((check) => !check.enforced || !check.passed).length;
        const diff = fullUnifiedDiff(canonicalVulnerableConsumer, source, contractName);
        return ConsumerLabReportV1Schema.parse({
          version: "1", runId, statement: "Valid proof ≠ trusted URL",
          proofValid: true, consumerIdentity: identity, passed,
          checks, diagnostics,
          safeConsumer: {
            identity: "canonical-safe", contractName, compilerVersion,
            compileStatus, sha256: `sha256:${actualHash}`, source, diff,
          },
          verdict: {
            state: passed && identity === "canonical-safe" && missingChecks === 0
              ? "safe-to-integrate" : "needs-fixes",
            missingChecks,
          },
        });
      } catch (cause) {
        if (cause && typeof cause === "object" && "status" in cause) throw cause;
        throw Object.assign(new Error("Persisted Consumer Lab evidence is invalid"), {
          status: 500, code: "CONSUMER_LAB_INVALID",
        });
      }
    },

    async getBundle(context: Record<string, unknown>) {
      return loadVerifiedBundleBytes(context, {
        pending: "PROOF_BUNDLE_PENDING",
        invalid: "PROOF_BUNDLE_INVALID",
      });
    },

    async getEvidenceReceipt(context: Record<string, unknown>) {
      try {
        const serialized = await loadVerifiedBundleBytes(context, {
          pending: "EVIDENCE_RECEIPT_PENDING",
          invalid: "EVIDENCE_RECEIPT_INVALID",
        });
        return createEvidenceReceipt(serialized);
      } catch (cause) {
        if (cause && typeof cause === "object" && "status" in cause) throw cause;
        throw Object.assign(new Error("Persisted receipt evidence is invalid"), {
          status: 500,
          code: "EVIDENCE_RECEIPT_INVALID",
        });
      }
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
      const shareUrl = new URL(`/runs/${runId}`, `${publicWebOrigin}/`);
      shareUrl.hash = `share=${raw}`;
      return ShareLinkV1Schema.parse({
        version: "1",
        runId,
        url: shareUrl.href,
      });
    },
  };
}
