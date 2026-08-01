// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../db/migrations/004_preflight_report.sql", import.meta.url),
);

let sql: string;

beforeAll(async () => {
  sql = await readFile(migrationPath, "utf8");
});

describe("Slice 016A preflight report migration", () => {
  it("is transactional, idempotent and records schema version 4", () => {
    expect(sql).toMatch(/\bBEGIN\b/i);
    expect(sql).toMatch(/\bCOMMIT\b/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(
      /INSERT INTO proofline_private\.schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(4\)[\s\S]*ON CONFLICT/i,
    );
  });

  it("allows at most one immutable public preflight report artifact per run", () => {
    expect(sql).toMatch(/ON\s+proofline_private\.run_artifacts\s*\(\s*run_id\s*\)/i);
    expect(sql).toMatch(/WHERE\s+kind\s*=\s*'preflight-report-v1'/i);
    expect(sql).not.toMatch(/DELETE\s+FROM|UPDATE\s+proofline_private\.run_artifacts/i);
  });
});
