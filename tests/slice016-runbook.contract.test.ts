// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runbookPath = new URL("../docs/runbook.md", import.meta.url);

describe("Slice 016 operational runbook contract", () => {
  it("documents all four PostgreSQL migrations in executable order", async () => {
    const runbook = await readFile(runbookPath, "utf8");
    const migrations = [
      "apps/api/db/migrations/001_initial.sql",
      "apps/api/db/migrations/002_one_active_submission.sql",
      "apps/api/db/migrations/003_run_discovery.sql",
      "apps/api/db/migrations/004_preflight_report.sql",
    ];
    const positions = migrations.map((migration) => runbook.indexOf(migration));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("marks the replay preflight sidecar path as required worker configuration", async () => {
    const runbook = await readFile(runbookPath, "utf8");
    const requiredSection = runbook.slice(
      runbook.indexOf("Обязательная конфигурация:"),
      runbook.indexOf("Дополнительная конфигурация:"),
    );
    expect(requiredSection).toContain("PROOFLINE_REPLAY_BUNDLE_PATH");
    expect(requiredSection).toContain(
      "PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH",
    );
  });
});
