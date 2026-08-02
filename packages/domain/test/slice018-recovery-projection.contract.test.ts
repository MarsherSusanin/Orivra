// @vitest-environment node

import { describe, expect, it } from "vitest";
import { makeRunEvents } from "../../contracts/test/fixtures";
import { appendRunEvents, projectRun } from "../src/index";

const created = makeRunEvents()[0];
const recovery = {
  version: "1",
  state: "retryable",
  stage: "preflight",
  attempt: 1,
  retryAfter: "2026-08-03T02:00:15.000Z",
  resumeFrom: "preflight",
  preservedEvidence: [],
  updatedAt: "2026-08-03T02:00:00.000Z",
  error: {
    version: "1",
    category: "transport",
    code: "VERIFIER_TRANSPORT_FAILED",
    message: "Worker command failed",
    retryable: true,
    evidence: {},
  },
  retrySafety: "same-command",
} as const;

function annotation(
  sequence: number,
  type: "STAGE_WAITING" | "STAGE_RETRY_SCHEDULED" | "RUN_RESUMED",
  payload: Record<string, unknown>,
) {
  return {
    version: "1",
    runId: created.runId,
    sequence,
    commandId: "command_preflight",
    occurredAt: `2026-08-03T02:00:0${sequence}.000Z`,
    type,
    payload,
  } as any;
}

describe("Slice 018 recovery projection", () => {
  it("interleaves retry evidence without advancing the six-stage lifecycle", () => {
    const scheduled = annotation(2, "STAGE_RETRY_SCHEDULED", recovery);
    const projection = projectRun([created, scheduled]);
    expect(projection).toMatchObject({
      sequence: 2,
      terminal: false,
      stages: { preflight: "active", request: "pending" },
      recovery,
    });

    const resumed = annotation(3, "RUN_RESUMED", {
      stage: "preflight",
      attempt: 2,
      resumeFrom: "preflight",
      preservedEvidence: [],
    });
    expect(projectRun([created, scheduled, resumed])).toMatchObject({
      sequence: 3,
      terminal: false,
      stages: { preflight: "active", request: "pending" },
    });
    expect(projectRun([created, scheduled, resumed])).not.toHaveProperty("recovery");
  });

  it("rejects regressing attempts and recovery annotations after terminal state", () => {
    const waiting = annotation(2, "STAGE_WAITING", {
      ...recovery,
      state: "waiting",
      attempt: 2,
    });
    const regressed = annotation(3, "STAGE_RETRY_SCHEDULED", recovery);
    expect(() => projectRun([created, waiting, regressed])).toThrow(/attempt|monotonic/i);

    const failed = {
      ...makeRunEvents()[1],
      sequence: 3,
      commandId: "command_terminal",
      type: "RUN_FAILED" as const,
      payload: {
        stage: "preflight" as const,
        error: { ...recovery.error, retryable: false },
      },
    };
    expect(() => appendRunEvents([created, waiting, failed] as any, [
      annotation(4, "RUN_RESUMED", {
        stage: "preflight",
        attempt: 3,
        resumeFrom: "preflight",
        preservedEvidence: [],
      }),
    ])).toThrow(/terminal/i);
  });

  it("treats a failed consumer invariant as product evidence, not recovery", () => {
    const events = makeRunEvents();
    events[6] = {
      ...events[6],
      payload: {
        passed: false,
        diagnostics: [{
          version: "1",
          code: "MISSING_CONSUMER_HOST_INVARIANT",
          severity: "warning",
          confidence: "high",
          summary: "Expected host is not enforced",
          evidence: { missingChecks: ["host"] },
          remediation: "Use the generated safe consumer.",
        }],
      },
    };
    const projection = projectRun(events);
    expect(projection).toMatchObject({
      terminal: true,
      stages: { consumer: "failed" },
    });
    expect(projection).not.toHaveProperty("terminalFailure");
    expect(projection).not.toHaveProperty("recovery");
  });
});
