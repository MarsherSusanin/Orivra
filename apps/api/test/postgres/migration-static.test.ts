// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);

let sql: string;

beforeAll(async () => {
  sql = await readFile(migrationPath, "utf8");
});

describe("PostgreSQL canonical migration", () => {
  it("is transactional, schema-qualified, and creates every persistence boundary", () => {
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS proofline_private/i);

    for (const table of [
      "projects",
      "api_tokens",
      "runs",
      "run_events",
      "run_artifacts",
      "run_commands",
      "relayer_transactions",
      "share_tokens",
      "relayer_audit_events",
    ]) {
      expect(sql).toMatch(
        new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? proofline_private\\.${table}\\b`, "i"),
      );
    }
  });

  it("stores token digests and canonical artifact bytes but never raw tokens or private keys", () => {
    expect(sql).toMatch(/token_digest\s+bytea/i);
    expect(sql).toMatch(/canonical_bytes\s+bytea/i);
    expect(sql).toMatch(/sha256\s+bytea/i);
    expect(sql).not.toMatch(/\b(raw_token|private_key|authorization_header)\b/i);
  });

  it("enforces append-only event ordering and command/transaction idempotency", () => {
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*run_id\s*,\s*sequence\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*run_id\s*,\s*dedupe_key\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*project_id\s*,\s*idempotency_key\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*chain_id\s*,\s*(?:from_address|"from")\s*,\s*nonce\s*\)/i);
    expect(sql).toMatch(/CREATE (?:OR REPLACE )?FUNCTION .*prevent.*(?:update|delete)|append.only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON proofline_private\.run_events/i);
  });

  it("constrains chain data, JSON shapes, leases, and relayer lifecycle", () => {
    expect(sql).toMatch(/chain_id[^,\n]*CHECK[^,\n]*114/i);
    expect(sql).toMatch(/numeric\s*\(\s*78\s*,\s*0\s*\)/i);
    expect(sql).toMatch(/octet_length\s*\([^)]*\)\s*=\s*(?:20|32)/i);
    expect(sql).toMatch(/jsonb_typeof\s*\([^)]*\)\s*=\s*'object'/i);
    expect(sql).toMatch(/lease_token/i);
    expect(sql).toMatch(/lease_expires_at/i);
    expect(sql).toMatch(/raw_signed_transaction\s+bytea/i);
    expect(sql).toMatch(/transaction_hash\s+bytea/i);
  });

  it("has the partial and covering indexes needed by run reads and worker claims", () => {
    expect(sql).toMatch(/CREATE INDEX .*run_events.*run_id.*sequence/i);
    expect(sql).toMatch(/CREATE INDEX .*run_commands.*(?:available_at|created_at)/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'queued'/i);
    expect(sql).toMatch(/CREATE INDEX .*share_tokens.*token_digest/i);
  });

  it("revokes public access and grants API and worker roles least privilege", () => {
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA proofline_private FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA proofline_private FROM PUBLIC/i);
    expect(sql).toMatch(/proofline_api/i);
    expect(sql).toMatch(/proofline_worker/i);
    expect(sql).toMatch(/GRANT SELECT/i);
  });
});
