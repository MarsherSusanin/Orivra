// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import {
  OCCURRED_AT,
  PROJECT_COMMAND_ID,
  RUN_ID,
} from "./fixtures";

const retryableRecovery = {
  version: "1",
  state: "retryable",
  stage: "preflight",
  attempt: 2,
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

function exportedSchema(name: string) {
  const schema = (Contracts as Record<string, unknown>)[name] as
    | { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } }
    | undefined;
  expect(schema, `${name} must be a public schema`).toBeDefined();
  if (!schema) throw new Error(`${name} is missing`);
  return schema;
}

describe("Slice 018 public recovery contract", () => {
  it("publishes a strict, evidence-bounded RunRecoveryV1", () => {
    const schema = exportedSchema("RunRecoveryV1Schema");
    expect(schema.parse(retryableRecovery)).toEqual(retryableRecovery);
    expect(schema.safeParse({ ...retryableRecovery, attempt: 0 }).success).toBe(false);
    expect(
      schema.safeParse({ ...retryableRecovery, preservedEvidence: ["proof", "proof"] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...retryableRecovery,
        privateUrl: "https://user:secret@example.test/source?token=private",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...retryableRecovery,
        error: {
          ...retryableRecovery.error,
          evidence: {
            nested: {
              stack: "private stack",
              privateUrl: "https://example.test/?token=secret",
            },
          },
        },
      }).success,
    ).toBe(false);
    for (const message of [
      `Bearer project_${"a".repeat(64)}`,
      "https://127.0.0.1/private?token=secret",
      "Error: upstream failed\n    at verifier (/private/app.ts:42:1)",
      `private key 0x${"b".repeat(64)}`,
    ]) {
      expect(
        schema.safeParse({
          ...retryableRecovery,
          error: { ...retryableRecovery.error, message },
        }).success,
      ).toBe(false);
    }
  });

  it("requires terminal recovery to omit retryAfter and name a safe continuation", () => {
    const schema = exportedSchema("RunRecoveryV1Schema");
    const terminal = {
      ...retryableRecovery,
      state: "terminal",
      stage: "proof",
      resumeFrom: "da-proof",
      preservedEvidence: ["preflight", "transaction", "receipt", "round"],
      retrySafety: "new-run-required",
      error: {
        ...retryableRecovery.error,
        category: "consensus-miss",
        code: "FDC_CONSENSUS_MISS",
        retryable: false,
      },
    };
    delete (terminal as { retryAfter?: string }).retryAfter;
    expect(schema.parse(terminal)).toEqual(terminal);
    expect(
      schema.safeParse({ ...terminal, retryAfter: "2026-08-03T02:01:00.000Z" })
        .success,
    ).toBe(false);
  });

  it.each([
    ["STAGE_WAITING", { ...retryableRecovery, state: "waiting" }],
    ["STAGE_RETRY_SCHEDULED", retryableRecovery],
    [
      "RUN_RESUMED",
      {
        stage: "preflight",
        attempt: 3,
        resumeFrom: "preflight",
        preservedEvidence: [],
      },
    ],
  ])("publishes strict %s journal evidence", (type, payload) => {
    const parsed = Contracts.RunEventV1Schema.parse({
      version: "1",
      runId: RUN_ID,
      sequence: 2,
      commandId: PROJECT_COMMAND_ID,
      occurredAt: OCCURRED_AT,
      type,
      payload,
    });
    expect(parsed.type).toBe(type);
  });
});
