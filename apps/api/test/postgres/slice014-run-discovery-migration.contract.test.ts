// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../db/migrations/003_run_discovery.sql", import.meta.url),
);

let sql = "";

beforeAll(async () => {
  sql = await readFile(migrationPath, "utf8");
});

describe("Slice 014 run discovery migration", () => {
  it("is additive, transactional, idempotent, and records version 3", () => {
    expect(sql).toMatch(/\bBEGIN\b[\s\S]*\bCOMMIT\b/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(/schema_migrations\s*\(version\)[\s\S]*VALUES\s*\(3\)/i);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i);
  });

  it("matches the project and stable pagination order exactly", () => {
    expect(sql).toMatch(
      /ON proofline_private\.runs\s*\(\s*project_id\s*,\s*updated_at DESC\s*,\s*id DESC\s*\)/i,
    );
  });
});
