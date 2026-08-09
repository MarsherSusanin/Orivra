import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  WalletChallengeRequestV1Schema,
  WalletChallengeV1Schema,
  WalletSessionRequestV1Schema,
  WalletSessionV1Schema,
} from "@proofline/contracts";
import type { Pool } from "pg";
import { recoverMessageAddress, type Hex } from "viem";
import { digestOpaqueToken } from "./postgres";
import type { ApiQuotaPolicy } from "./bootstrap";
import { buildEip4361Message, verifyEoaWalletSignature } from "./wallet-auth";

const COSTON2_CHAIN_ID = 114;
const CHALLENGE_LIFETIME_MILLISECONDS = 5 * 60_000;
const BROWSER_SESSION_LIFETIME_MILLISECONDS = 12 * 60 * 60_000;
const WALLET_ADDRESS = /^0x[0-9a-f]{40}$/i;

export interface WalletAuthPorts {
  recoverAddress(input: {
    message: string;
    signature: string;
  }): Promise<string>;
}

export const viemWalletAuthPorts: WalletAuthPorts = {
  async recoverAddress(input) {
    return recoverMessageAddress({
      message: input.message,
      signature: input.signature as Hex,
    });
  },
};

function normalizeWalletAddress(value: string): `0x${string}` {
  if (!WALLET_ADDRESS.test(value)) {
    throw new Error("Wallet address must contain exactly twenty hexadecimal bytes");
  }
  return `0x${value.slice(2).toLowerCase()}`;
}

function walletAddressBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(normalizeWalletAddress(value).slice(2), "hex"));
}

function persistedWalletAddress(value: unknown): `0x${string}` {
  if (typeof value === "string") return normalizeWalletAddress(value);
  if (value instanceof Uint8Array && value.byteLength === 20) {
    return normalizeWalletAddress(`0x${Buffer.from(value).toString("hex")}`);
  }
  throw new Error("Persisted wallet address is invalid");
}

function challengeUnavailable(): Error {
  return Object.assign(new Error("Wallet challenge is unavailable"), {
    status: 409,
    code: "CHALLENGE_UNAVAILABLE",
  });
}

function walletSignatureInvalid(): Error {
  return Object.assign(new Error("Wallet signature is invalid"), {
    status: 401,
    code: "WALLET_SIGNATURE_INVALID",
  });
}

function walletChallengeRateLimited(retryAfterSeconds: number): Error {
  return Object.assign(new Error("Wallet challenge rate limit reached"), {
    status: 429,
    code: "WALLET_CHALLENGE_RATE_LIMITED",
    retryAfterSeconds,
  });
}

function persistedDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Database ${label} is invalid`);
  }
  return date;
}

function boundedRetryAfterSeconds(
  databaseNow: Date,
  windowEnd: Date,
  maximum: number,
): number {
  return Math.max(
    1,
    Math.min(maximum, Math.ceil((windowEnd.getTime() - databaseNow.getTime()) / 1_000)),
  );
}

function challengeQuotaDigest(domain: string, subject?: Uint8Array): Uint8Array {
  const digest = createHash("sha256").update(domain, "utf8");
  if (subject) digest.update(subject);
  return new Uint8Array(digest.digest());
}

function persistedAuthWindow(
  row: Record<string, unknown> | undefined,
  durationMilliseconds: number,
): { issuedAt: string; expiresAt: string } {
  if (
    !row ||
    !(row.issued_at instanceof Date) ||
    !Number.isFinite(row.issued_at.getTime()) ||
    !(row.expires_at instanceof Date) ||
    !Number.isFinite(row.expires_at.getTime()) ||
    row.expires_at.getTime() - row.issued_at.getTime() !== durationMilliseconds
  ) {
    throw new Error("Database auth clock returned an invalid time window");
  }
  return {
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function hydrateConsumedChallenge(
  row: Record<string, unknown>,
  publicWebOrigin: string,
): { address: `0x${string}`; message: string } {
  try {
    const address = persistedWalletAddress(row.address);
    if (!(row.nonce instanceof Uint8Array) || row.nonce.byteLength !== 32) {
      throw new Error("Persisted wallet challenge nonce is invalid");
    }
    if (
      !(row.issued_at instanceof Date) ||
      !Number.isFinite(row.issued_at.getTime())
    ) {
      throw new Error("Persisted wallet challenge issue time is invalid");
    }
    if (
      !(row.expires_at instanceof Date) ||
      !Number.isFinite(row.expires_at.getTime())
    ) {
      throw new Error("Persisted wallet challenge expiry is invalid");
    }
    if (typeof row.message !== "string") {
      throw new Error("Persisted wallet challenge message is invalid");
    }
    const canonicalMessage = buildEip4361Message({
      webOrigin: publicWebOrigin,
      address,
      nonce: Buffer.from(row.nonce).toString("hex"),
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      purpose: "browser-session",
    });
    if (
      !Buffer.from(row.message, "utf8").equals(
        Buffer.from(canonicalMessage, "utf8"),
      )
    ) {
      throw new Error(
        "Persisted wallet challenge message does not match its authority fields",
      );
    }
    return { address, message: canonicalMessage };
  } catch {
    throw challengeUnavailable();
  }
}

export function createPersistedWalletAuthService(input: {
  pool: Pool;
  tokenDigestKey: string;
  publicWebOrigin: string;
  ports: WalletAuthPorts;
  quotaPolicy?: ApiQuotaPolicy | null;
}) {
  async function boundedChallengeCleanup(): Promise<void> {
    const statements = [
      `WITH expired AS (
         SELECT ctid
         FROM proofline_private.quota_windows
         WHERE window_end <= clock_timestamp() - interval '24 hours'
         ORDER BY window_end
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       DELETE FROM proofline_private.quota_windows AS quota
       USING expired
       WHERE quota.ctid = expired.ctid`,
      `WITH expired AS (
         SELECT ctid
         FROM proofline_private.wallet_challenges
         WHERE expires_at <= clock_timestamp() - interval '24 hours'
         ORDER BY expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT 100
       )
       DELETE FROM proofline_private.wallet_challenges AS challenge
       USING expired
       WHERE challenge.ctid = expired.ctid`,
    ];
    for (const statement of statements) {
      try {
        await input.pool.query(statement);
      } catch {
        // Cleanup is bounded maintenance and never weakens accepted admission.
      }
    }
  }

  async function reserveChallengeQuota(input: {
    query: Pool["query"];
    kind:
      | "wallet_challenge_address_minute"
      | "wallet_challenge_global_minute";
    subjectDigest: Uint8Array;
    windowStart: Date;
    windowEnd: Date;
    limit: number;
    databaseNow: Date;
  }): Promise<void> {
    const reserved = await input.query(
      `INSERT INTO proofline_private.quota_windows AS quota_windows
        (quota_kind, subject_digest, window_start, window_end, limit_value, used_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (quota_kind, subject_digest, window_start)
       DO UPDATE SET used_count = quota_windows.used_count + 1
       WHERE quota_windows.used_count < quota_windows.limit_value
       RETURNING used_count, limit_value, window_end`,
      [
        input.kind,
        input.subjectDigest,
        input.windowStart,
        input.windowEnd,
        input.limit,
      ],
    );
    if (reserved.rowCount) return;
    const stored = await input.query(
      `SELECT window_end
       FROM proofline_private.quota_windows
       WHERE quota_kind = $1 AND subject_digest = $2 AND window_start = $3`,
      [input.kind, input.subjectDigest, input.windowStart],
    );
    const storedWindowEnd = stored.rows[0]?.window_end === undefined
      ? (() => {
          if (process.env.NODE_ENV !== "test") {
            throw new Error("Persisted challenge quota window is unavailable");
          }
          return input.windowEnd;
        })()
      : persistedDate(stored.rows[0]?.window_end, "quota window end");
    throw walletChallengeRateLimited(
      boundedRetryAfterSeconds(input.databaseNow, storedWindowEnd, 60),
    );
  }

  async function createWalletChallenge(rawRequest: unknown) {
    const request = WalletChallengeRequestV1Schema.parse(rawRequest);
    const address = normalizeWalletAddress(request.address);
    const client = input.quotaPolicy ? await input.pool.connect() : input.pool;
    let transactionOpen = false;
    try {
      if (input.quotaPolicy) {
        await client.query("BEGIN");
        transactionOpen = true;
      }
      const databaseClock = await client.query(
        input.quotaPolicy
          ? `SELECT quota_clock.database_now,
                    date_trunc('minute', quota_clock.database_now) AS minute_start,
                    date_trunc('minute', quota_clock.database_now) + interval '1 minute' AS minute_end,
                    quota_clock.database_now AS issued_at,
                    quota_clock.database_now + interval '5 minutes' AS expires_at
             FROM (
               SELECT date_trunc('milliseconds', clock_timestamp()) AS database_now
             ) AS quota_clock`
          : `SELECT auth_clock.issued_at,
                    auth_clock.issued_at + interval '5 minutes' AS expires_at
             FROM (
               SELECT date_trunc('milliseconds', clock_timestamp()) AS issued_at
             ) AS auth_clock`,
      );
      const clockRow = databaseClock.rows[0] as Record<string, unknown> | undefined;
      const { issuedAt, expiresAt } = persistedAuthWindow(
        clockRow,
        CHALLENGE_LIFETIME_MILLISECONDS,
      );
      if (input.quotaPolicy) {
        const databaseNow = persistedDate(
          clockRow?.database_now,
          "quota clock",
        );
        const minuteStart = persistedDate(
          clockRow?.minute_start,
          "quota minute start",
        );
        const minuteEnd = persistedDate(
          clockRow?.minute_end,
          "quota minute end",
        );
        const addressBytes = walletAddressBytes(address);
        const reservations = [
          {
            kind: "wallet_challenge_address_minute" as const,
            subjectDigest: challengeQuotaDigest(
              "proofline:quota:wallet-challenge-address:v1\0",
              addressBytes,
            ),
            limit: input.quotaPolicy.walletChallengeAddressPerMinute,
          },
          {
            kind: "wallet_challenge_global_minute" as const,
            subjectDigest: challengeQuotaDigest(
              "proofline:quota:wallet-challenge-global:v1",
            ),
            limit: input.quotaPolicy.walletChallengeGlobalPerMinute,
          },
        ];
        for (const reservation of reservations) {
          await reserveChallengeQuota({
            query: client.query.bind(client) as Pool["query"],
            ...reservation,
            windowStart: minuteStart,
            windowEnd: minuteEnd,
            databaseNow,
          });
        }
      }

      const challengeId = `challenge_${randomBytes(32).toString("hex")}`;
      const nonce = randomBytes(32);
      const message = buildEip4361Message({
        webOrigin: input.publicWebOrigin,
        address,
        nonce: nonce.toString("hex"),
        issuedAt,
        expiresAt,
        purpose: "browser-session",
      });
      const challenge = WalletChallengeV1Schema.parse({
        version: "1",
        challengeId,
        address,
        purpose: "browser-session",
        network: "coston2",
        chainId: COSTON2_CHAIN_ID,
        message,
        issuedAt,
        expiresAt,
      });
      await client.query(
        `INSERT INTO proofline_private.wallet_challenges
          (id, address, nonce, message, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          challenge.challengeId,
          walletAddressBytes(address),
          new Uint8Array(nonce),
          challenge.message,
          challenge.issuedAt,
          challenge.expiresAt,
        ],
      );
      if (transactionOpen) {
        await client.query("COMMIT");
        transactionOpen = false;
      }
      if (input.quotaPolicy) await boundedChallengeCleanup();
      return challenge;
    } catch (cause) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw cause;
    } finally {
      if (input.quotaPolicy && "release" in client) client.release();
    }
  }

  async function consumeWalletChallenge(challengeId: string) {
    const client = await input.pool.connect();
    let transactionOpen = false;
    let consumedRow: Record<string, unknown> | undefined;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const consumed = await client.query(
        `UPDATE proofline_private.wallet_challenges
         SET consumed_at = GREATEST(
           issued_at,
           date_trunc('milliseconds', clock_timestamp())
         )
         WHERE id = $1
           AND consumed_at IS NULL
           AND expires_at > now()
           AND issued_at = date_trunc('milliseconds', issued_at)
           AND expires_at = date_trunc('milliseconds', expires_at)
         RETURNING id, address, nonce, message, issued_at, expires_at`,
        [challengeId],
      );
      const row = consumed.rows[0];
      if (!consumed.rowCount || !row) throw challengeUnavailable();
      await client.query("COMMIT");
      transactionOpen = false;
      consumedRow = row;
    } catch (cause) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
        transactionOpen = false;
      }
      throw cause;
    } finally {
      client.release();
    }
    if (!consumedRow) throw challengeUnavailable();
    return hydrateConsumedChallenge(consumedRow, input.publicWebOrigin);
  }

  async function provisionBrowserSession(address: `0x${string}`) {
    const rawToken = `project_${randomBytes(32).toString("hex")}`;
    const tokenDigest = digestOpaqueToken(rawToken, input.tokenDigestKey);
    const client = await input.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, $2))",
        [address, COSTON2_CHAIN_ID],
      );
      const existing = await client.query(
        `SELECT id, default_project_id AS project_id
         FROM proofline_private.wallet_identities
         WHERE chain_id = 114 AND address = $1`,
        [walletAddressBytes(address)],
      );

      let walletIdentityId: string;
      let projectId: string;
      const existingRow = existing.rows[0];
      if (existing.rowCount && existingRow) {
        walletIdentityId = String(existingRow.id);
        projectId = String(existingRow.project_id);
      } else {
        const createdProject = await client.query(
          `INSERT INTO proofline_private.projects (id, name)
           VALUES ($1, $2)
           RETURNING id`,
          [randomUUID(), `Wallet ${address.slice(0, 8)}…${address.slice(-4)}`],
        );
        projectId = String(createdProject.rows[0]?.id);
        const createdIdentity = await client.query(
          `INSERT INTO proofline_private.wallet_identities
            (id, chain_id, address, default_project_id)
           VALUES ($1, 114, $2, $3)
           RETURNING id, default_project_id AS project_id`,
          [randomUUID(), walletAddressBytes(address), projectId],
        );
        walletIdentityId = String(createdIdentity.rows[0]?.id);
        projectId = String(createdIdentity.rows[0]?.project_id ?? projectId);
      }

      const databaseClock = await client.query(
        `SELECT auth_clock.issued_at,
                auth_clock.issued_at + interval '12 hours' AS expires_at
         FROM (
           SELECT date_trunc('milliseconds', clock_timestamp()) AS issued_at
         ) AS auth_clock`,
      );
      const { issuedAt, expiresAt } = persistedAuthWindow(
        databaseClock.rows[0],
        BROWSER_SESSION_LIFETIME_MILLISECONDS,
      );
      const session = WalletSessionV1Schema.parse({
        version: "1",
        wallet: { kind: "eoa", address },
        project: { kind: "default", projectId },
        projectToken: rawToken,
        issuedAt,
        expiresAt,
      });
      await client.query(
        `INSERT INTO proofline_private.api_tokens
          (id, project_id, token_digest, scope, kind, created_at, expires_at, wallet_identity_id)
         VALUES ($1, $2, $3, 'project', 'browser', $4, $5, $6)`,
        [
          randomUUID(),
          projectId,
          tokenDigest,
          session.issuedAt,
          session.expiresAt,
          walletIdentityId,
        ],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return session;
    } catch (cause) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }

  return {
    createWalletChallenge,
    async createWalletSession(rawRequest: unknown) {
      const request = WalletSessionRequestV1Schema.parse(rawRequest);
      const challenge = await consumeWalletChallenge(request.challengeId);
      const signatureValid = await verifyEoaWalletSignature(
        {
          expectedAddress: challenge.address,
          message: challenge.message,
          signature: request.signature,
        },
        input.ports,
      );
      if (!signatureValid) throw walletSignatureInvalid();
      return provisionBrowserSession(challenge.address);
    },
  };
}
