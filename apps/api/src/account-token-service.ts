import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  AccountTokenCreateRequestV1Schema,
  AccountTokenCreatedV1Schema,
  AccountTokenRevokedV1Schema,
  AccountTokenSummaryV1Schema,
  AccountV1Schema,
} from "@proofline/contracts/wallet-auth";
import type { Pool } from "pg";
import { digestOpaqueToken } from "./postgres";

const TOKEN_ISSUANCE_KEY = /^token_issue_[a-f0-9]{64}$/;
const PUBLIC_TOKEN_ID = /^token_([a-f0-9]{32})$/;

function accountError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

function digestEvidence(
  digestKey: string,
  domain: string,
  value: string,
): Uint8Array {
  return new Uint8Array(
    createHmac("sha256", digestKey)
      .update(domain, "utf8")
      .update("\0", "utf8")
      .update(value, "utf8")
      .digest(),
  );
}

function persistedAddress(value: unknown): `0x${string}` {
  if (!(value instanceof Uint8Array) || value.byteLength !== 20) {
    throw new Error("Persisted account wallet address is invalid");
  }
  return `0x${Buffer.from(value).toString("hex")}`;
}

function persistedTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Persisted account token timestamp is invalid");
  }
  return value.toISOString();
}

function publicTokenId(value: unknown): string {
  const uuid = String(value).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    throw new Error("Persisted account token id is invalid");
  }
  return `token_${uuid.replaceAll("-", "")}`;
}

function privateTokenUuid(value: unknown): string {
  const matched = PUBLIC_TOKEN_ID.exec(String(value));
  if (!matched) {
    throw accountError(404, "ACCOUNT_TOKEN_NOT_FOUND", "Account token not found");
  }
  const hex = matched[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tokenSummary(row: Record<string, unknown>) {
  return AccountTokenSummaryV1Schema.parse({
    version: "1",
    tokenId: publicTokenId(row.id),
    kind: row.kind,
    label: row.label,
    createdAt: persistedTimestamp(row.created_at),
    expiresAt: persistedTimestamp(row.expires_at),
    revokedAt:
      row.revoked_at === null ? null : persistedTimestamp(row.revoked_at),
  });
}

function fingerprintMatches(left: unknown, right: Uint8Array): boolean {
  return (
    left instanceof Uint8Array &&
    left.byteLength === right.byteLength &&
    Buffer.from(left).equals(Buffer.from(right))
  );
}

function issuanceOutcome(
  row: Record<string, unknown> | undefined,
  fingerprint: Uint8Array,
): never {
  if (!row || !(row.issuance_fingerprint instanceof Uint8Array)) {
    throw new Error("Persisted account token issuance evidence is invalid");
  }
  if (fingerprintMatches(row.issuance_fingerprint, fingerprint)) {
    throw accountError(
      409,
      "ACCOUNT_TOKEN_SECRET_ALREADY_ISSUED",
      "Account token secret was already issued",
    );
  }
  throw accountError(409, "IDEMPOTENCY_CONFLICT", "Idempotency intent conflict");
}

function isIssuanceUniqueViolation(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      (value as { code?: unknown }).code === "23505" &&
      (!((value as { constraint?: unknown }).constraint) ||
        (value as { constraint?: unknown }).constraint ===
          "api_tokens_account_issuance_key_unique"),
  );
}

export function createAccountTokenService(input: {
  pool: Pool;
  tokenDigestKey: string;
}) {
  async function findIssuance(
    query: Pool["query"],
    projectId: string,
    issuanceKeyDigest: Uint8Array,
  ) {
    const result = await query(
      `SELECT issuance_fingerprint
       FROM proofline_private.api_tokens
       WHERE project_id = $1
         AND issuance_key_digest = $2
         AND kind IN ('cli', 'action')
       LIMIT 1`,
      [projectId, issuanceKeyDigest],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  return {
    async getAccount(context: { projectId: string }) {
      const identity = await input.pool.query(
        `SELECT id, address, default_project_id AS project_id
         FROM proofline_private.wallet_identities
         WHERE default_project_id = $1
         LIMIT 1`,
        [context.projectId],
      );
      const identityRow = identity.rows[0] as Record<string, unknown> | undefined;
      if (!identity.rowCount || !identityRow) {
        throw accountError(404, "ACCOUNT_NOT_FOUND", "Account not found");
      }
      const tokens = await input.pool.query(
        `SELECT id, kind, label, created_at, expires_at, revoked_at
         FROM proofline_private.api_tokens
         WHERE project_id = $1
           AND wallet_identity_id = $2
           AND kind IN ('cli', 'action')
         ORDER BY created_at DESC, id DESC`,
        [context.projectId, identityRow.id],
      );
      return AccountV1Schema.parse({
        version: "1",
        wallet: { kind: "eoa", address: persistedAddress(identityRow.address) },
        project: { kind: "default", projectId: identityRow.project_id },
        tokens: tokens.rows.map((row) => tokenSummary(row)),
      });
    },

    async createAccountToken(rawContext: Record<string, unknown>) {
      const request = AccountTokenCreateRequestV1Schema.parse({
        version: rawContext.version,
        kind: rawContext.kind,
        label: rawContext.label,
        expiresInDays: rawContext.expiresInDays,
      });
      const projectId = String(rawContext.projectId ?? "");
      const idempotencyKey = String(rawContext.idempotencyKey ?? "");
      if (!TOKEN_ISSUANCE_KEY.test(idempotencyKey)) {
        throw accountError(400, "INVALID_IDEMPOTENCY_KEY", "Invalid issuance key");
      }
      const issuanceKeyDigest = digestEvidence(
        input.tokenDigestKey,
        "proofline-account-token-issuance-key-v1",
        idempotencyKey,
      );
      const issuanceFingerprint = digestEvidence(
        input.tokenDigestKey,
        "proofline-account-token-intent-v1",
        JSON.stringify({
          version: request.version,
          kind: request.kind,
          label: request.label,
          expiresInDays: request.expiresInDays,
        }),
      );
      const client = await input.pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const existing = await findIssuance(
          client.query.bind(client) as Pool["query"],
          projectId,
          issuanceKeyDigest,
        );
        if (existing) issuanceOutcome(existing, issuanceFingerprint);

        const identity = await client.query(
          `SELECT id
           FROM proofline_private.wallet_identities
           WHERE default_project_id = $1
           LIMIT 1`,
          [projectId],
        );
        const identityRow = identity.rows[0];
        if (!identity.rowCount || !identityRow) {
          throw accountError(404, "ACCOUNT_NOT_FOUND", "Account not found");
        }
        const clock = await client.query(
          `SELECT auth_clock.created_at,
                  auth_clock.created_at + make_interval(days => $1::integer) AS expires_at
           FROM (
             SELECT date_trunc('milliseconds', clock_timestamp()) AS created_at
           ) AS auth_clock`,
          [request.expiresInDays],
        );
        const clockRow = clock.rows[0] as Record<string, unknown> | undefined;
        const createdAt = persistedTimestamp(clockRow?.created_at);
        const expiresAt = persistedTimestamp(clockRow?.expires_at);
        if (
          Date.parse(expiresAt) - Date.parse(createdAt) !==
          request.expiresInDays * 86_400_000
        ) {
          throw new Error("Database account token clock returned an invalid window");
        }

        const rawToken = `project_${randomBytes(32).toString("hex")}`;
        const inserted = await client.query(
          `INSERT INTO proofline_private.api_tokens
            (id, project_id, token_digest, scope, kind, label, created_at, expires_at,
             wallet_identity_id, issuance_key_digest, issuance_fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, kind, label, created_at, expires_at, revoked_at`,
          [
            randomUUID(),
            projectId,
            digestOpaqueToken(rawToken, input.tokenDigestKey),
            "project",
            request.kind,
            request.label,
            createdAt,
            expiresAt,
            identityRow.id,
            issuanceKeyDigest,
            issuanceFingerprint,
          ],
        );
        const item = tokenSummary(inserted.rows[0]);
        const response = AccountTokenCreatedV1Schema.parse({
          version: "1",
          token: rawToken,
          item,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        return response;
      } catch (cause) {
        if (transactionOpen) {
          await client.query("ROLLBACK");
          transactionOpen = false;
        }
        if (isIssuanceUniqueViolation(cause)) {
          const existing = await findIssuance(
            client.query.bind(client) as Pool["query"],
            projectId,
            issuanceKeyDigest,
          );
          issuanceOutcome(existing, issuanceFingerprint);
        }
        throw cause;
      } finally {
        client.release();
      }
    },

    async revokeAccountToken(context: { projectId: string; tokenId: string }) {
      const tokenUuid = privateTokenUuid(context.tokenId);
      const revoked = await input.pool.query(
        `UPDATE proofline_private.api_tokens
         SET revoked_at = COALESCE(
           revoked_at,
           date_trunc('milliseconds', clock_timestamp())
         )
         WHERE id = $1
           AND project_id = $2
           AND kind IN ('cli', 'action')
         RETURNING id, revoked_at`,
        [tokenUuid, context.projectId],
      );
      if (!revoked.rowCount) {
        throw accountError(404, "ACCOUNT_TOKEN_NOT_FOUND", "Account token not found");
      }
      return AccountTokenRevokedV1Schema.parse({
        version: "1",
        tokenId: publicTokenId(revoked.rows[0]?.id),
        revoked: true,
      });
    },

    async revokeCurrentWalletSession(context: {
      projectId: string;
      tokenId: string;
      walletIdentityId: string;
    }) {
      const revoked = await input.pool.query(
        `UPDATE proofline_private.api_tokens
         SET revoked_at = date_trunc('milliseconds', clock_timestamp())
         WHERE id = $1
           AND project_id = $2
           AND wallet_identity_id = $3
           AND kind = 'browser'
           AND revoked_at IS NULL
         RETURNING id, revoked_at`,
        [context.tokenId, context.projectId, context.walletIdentityId],
      );
      if (!revoked.rowCount) {
        throw accountError(401, "UNAUTHORIZED", "Browser session is unavailable");
      }
    },
  };
}
