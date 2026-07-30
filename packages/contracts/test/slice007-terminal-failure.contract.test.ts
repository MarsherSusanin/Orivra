// @vitest-environment node

import { describe, expect, it } from "vitest";
import { RunEventV1Schema } from "../src/index";
import { appendRunEvents, projectRun } from "../../domain/src/index";
import {
  OCCURRED_AT,
  RUN_ID,
  makeRunEvents,
} from "./fixtures";

const terminalError = {
  version: "1" as const,
  category: "not-finalized" as const,
  code: "COMMAND_RETRY_EXHAUSTED",
  message: "Relay did not finalize within the bounded retry budget.",
  retryable: false,
  evidence: {
    commandId: "command_relay",
    originalCode: "RELAY_FINALIZATION_PENDING",
    votingRound: 42_871,
  },
};

function failedEvent(sequence = 4) {
  return {
    version: "1" as const,
    runId: RUN_ID,
    sequence,
    commandId: "command_relay",
    occurredAt: OCCURRED_AT,
    type: "RUN_FAILED" as const,
    payload: {
      stage: "round" as const,
      error: terminalError,
    },
  };
}

describe("Slice 007 versioned terminal failure journal", () => {
  it("publishes RUN_FAILED as a strict versioned RunEventV1 variant", () => {
    expect(RunEventV1Schema.safeParse(failedEvent()).success).toBe(true);
    expect(
      RunEventV1Schema.safeParse({
        ...failedEvent(),
        payload: { stage: "round", error: terminalError, unexpected: true },
      }).success,
    ).toBe(false);
  });

  it("rebuilds terminal failure and failed stage solely from ordered events", () => {
    const prior = makeRunEvents().slice(0, 3);
    const rebuilt = projectRun([...prior, failedEvent()] as any) as any;

    expect(rebuilt).toMatchObject({
      version: "1",
      runId: RUN_ID,
      sequence: 4,
      terminal: true,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "failed",
      },
      terminalFailure: {
        stage: "round",
        error: terminalError,
      },
    });
  });

  it("makes a failed journal immutable to every later lifecycle event", () => {
    const prior = makeRunEvents().slice(0, 3);
    const journal = [...prior, failedEvent()];
    const later = {
      ...makeRunEvents()[2],
      sequence: 5,
      commandId: "command_after_failure",
    };

    expect(() => appendRunEvents(journal as any, [later] as any)).toThrow(
      /terminal|failed|immutable|after/i,
    );
  });
});
