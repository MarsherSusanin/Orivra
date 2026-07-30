// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);

describe("Slice 008 broadcast-attempt migration contract", () => {
  it("persists an attempt separately from RPC acceptance and grants only the narrow update", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /relayer_transactions[\s\S]*broadcast_attempt(?:ed)?_at\s+timestamptz/i,
    );
    expect(sql).toMatch(/RELAYER_(?:TRANSACTION_)?BROADCAST_ATTEMPT/i);
    expect(sql).toMatch(
      /GRANT\s+UPDATE\s*\(\s*broadcast_attempt(?:ed)?_at\s*,\s*broadcast_at\s*\)/i,
    );
  });
});
