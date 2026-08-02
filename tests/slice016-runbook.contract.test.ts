// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runbookPath = new URL("../docs/runbook.md", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);

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

  it("separates hermetic Node replay from real browser product verification", async () => {
    const [runbook, readme] = await Promise.all([
      readFile(runbookPath, "utf8"),
      readFile(readmePath, "utf8"),
    ]);
    const e2eSection = runbook.slice(
      runbook.indexOf("npm run test:e2e") - 160,
      runbook.indexOf("## 8. Sites package"),
    );

    expect(e2eSection).toMatch(/hermetic|\u0433\u0435\u0440\u043c\u0435\u0442\u0438\u0447/i);
    expect(e2eSection).toMatch(/Node[\s\S]*API[\s\S]*worker[\s\S]*replay/i);
    expect(e2eSection).toMatch(
      /does not prove|does not satisfy|\u043d\u0435 (?:\u0434\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442|\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442|\u0437\u0430\u043c\u0435\u043d\u044f\u0435\u0442)[\s\S]*browser/i,
    );
    expect(e2eSection).toMatch(/Product Integration Verification/i);
    expect(e2eSection).toMatch(
      /desktop[\s\S]*mobile[\s\S]*axe[\s\S]*console[\s\S]*network/i,
    );
    expect(e2eSection).toMatch(
      /cannot be marked PASS|\u043d\u0435\u043b\u044c\u0437\u044f[\s\S]*PASS[\s\S]*test:e2e/i,
    );

    expect(readme).not.toMatch(
      /\|\s*`npm run test:e2e`\s*\|\s*Browser acceptance\s*\|/i,
    );
    expect(readme).toMatch(
      /`npm run test:e2e`[\s\S]{0,240}(?:hermetic|\u0433\u0435\u0440\u043c\u0435\u0442\u0438\u0447)[\s\S]{0,240}(?:Node|replay)/i,
    );
    expect(readme).toMatch(/Product Integration Verification/i);
  });
});
