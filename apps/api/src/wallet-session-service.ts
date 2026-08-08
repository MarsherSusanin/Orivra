import { randomBytes, randomUUID } from "node:crypto";
import {
  WalletChallengeRequestV1Schema,
  WalletChallengeV1Schema,
  WalletSessionRequestV1Schema,
  WalletSessionV1Schema,
} from "@proofline/contracts";
import type { Pool } from "pg";
import { recoverMessageAddress, type Hex } from "viem";
import { digestOpaqueToken } from "./postgres";
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
}) {
  async function createWalletChallenge(rawRequest: unknown) {
    const request = WalletChallengeRequestV1Schema.parse(rawRequest);
    const address = normalizeWalletAddress(request.address);
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + CHALLENGE_LIFETIME_MILLISECONDS,
    );
    const challengeId = `challenge_${randomBytes(32).toString("hex")}`;
    const nonce = randomBytes(32);
    const message = buildEip4361Message({
      webOrigin: input.publicWebOrigin,
      address,
      nonce: nonce.toString("hex"),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
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
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    await input.pool.query(
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
    return challenge;
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
         SET consumed_at = now()
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
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + BROWSER_SESSION_LIFETIME_MILLISECONDS,
    );
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

      await client.query(
        `INSERT INTO proofline_private.api_tokens
          (id, project_id, token_digest, scope, kind, expires_at, wallet_identity_id)
         VALUES ($1, $2, $3, 'project', 'browser', $4, $5)`,
        [
          randomUUID(),
          projectId,
          tokenDigest,
          expiresAt.toISOString(),
          walletIdentityId,
        ],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return WalletSessionV1Schema.parse({
        version: "1",
        wallet: { kind: "eoa", address },
        project: { kind: "default", projectId },
        projectToken: rawToken,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
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
