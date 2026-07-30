// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validDiagnostic } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111118";
const RUN_ID = "22222222-2222-4222-8222-222222222228";

function terminalProjection() {
  return {
    version: "1",
    runId: RUN_ID,
    sequence: 7,
    terminal: true,
    stages: {
      preflight: "completed",
      request: "completed",
      round: "completed",
      proof: "completed",
      verify: "completed",
      consumer: "failed",
    },
  };
}

function serviceForRow(row: Record<string, unknown>) {
  const pool = {
    query: vi.fn(async () => ({ rowCount: 1, rows: [row] })),
  };
  return {
    pool,
    service: createProductionProoflineService({
      pool: pool as any,
      tokenDigestKey: "slice-008-diagnostic-key",
      publicWebOrigin: "https://proofline.test",
    }),
  };
}

describe("Slice 008 API release truth", () => {
  it("returns the latest versioned consumer diagnostics and durable attempt count", async () => {
    const fixture = serviceForRow({
      projection: terminalProjection(),
      consumer_verified: false,
      consumer_diagnostics: [validDiagnostic],
      broadcast_attempt_count: 1,
    });

    await expect(
      fixture.service.getRun({ projectId: PROJECT_ID, runId: RUN_ID }),
    ).resolves.toMatchObject({
      runId: RUN_ID,
      terminal: true,
      consumerVerified: false,
      diagnostics: [validDiagnostic],
      broadcastAttemptCount: 1,
    });
    expect(fixture.pool.query.mock.calls[0]?.[0]).toMatch(
      /CONSUMER_VERIFIED[\s\S]*diagnostics/i,
    );
  });

  it("fails closed instead of publishing failed consumer state without valid evidence", async () => {
    const fixture = serviceForRow({
      projection: terminalProjection(),
      consumer_verified: false,
      consumer_diagnostics: null,
      broadcast_attempt_count: 1,
    });

    await expect(
      fixture.service.getRun({ projectId: PROJECT_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({
      code: "CONSUMER_DIAGNOSTICS_MISSING",
    });
  });
});
