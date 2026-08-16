// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID,
  makeRunEvents,
} from "../../../../packages/contracts/test/fixtures";
import {
  POSTGRES_QUERIES,
  createPostgresCommandRepository,
} from "../../src/postgres";

const CLAIM = "11111111-1111-4111-8111-111111111111";
const COMMAND = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const RETRY_AT = "2026-08-03T02:00:16.000Z";

function result(rows: Array<Record<string, unknown>> = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function repositoryWith(
  query: (text: string, values?: readonly unknown[]) => Promise<ReturnType<typeof result>>,
) {
  const client = { query: vi.fn(query), release: vi.fn() };
  return {
    repository: createPostgresCommandRepository({
      pool: { connect: vi.fn().mockResolvedValue(client) },
    }),
    client,
  };
}

function insertedEvents(client: { query: ReturnType<typeof vi.fn> }) {
  return client.query.mock.calls
    .filter(([text]) => String(text) === POSTGRES_QUERIES.insertEvent)
    .map(([, values]) => JSON.parse(String(values?.[4])) as Record<string, unknown>);
}

describe("Slice 018 PostgreSQL recovery journal", () => {
  it.each([
    ["not-finalized", "REQUEST_RECEIPT_PENDING", "STAGE_WAITING", "waiting"],
    ["transport", "VERIFIER_TRANSPORT_FAILED", "STAGE_RETRY_SCHEDULED", "retryable"],
  ])(
    "atomically appends %s recovery before releasing a retry lease",
    async (category, code, eventType, state) => {
      const created = makeRunEvents()[0];
      const fixture = repositoryWith(async (text) => {
        if (text === POSTGRES_QUERIES.retryCommand) {
          return result([{
            id: COMMAND,
            run_id: RUN_ID,
            kind: category === "not-finalized" ? "POLL_TRANSACTION_RECEIPT" : "RUN_PREFLIGHT",
            attempts: 1,
            available_at: new Date(RETRY_AT),
          }], 1);
        }
        if (text === POSTGRES_QUERIES.lockRun) {
          return result([{
            last_sequence: 1,
            projection: {
              version: "1",
              runId: RUN_ID,
              sequence: 1,
              terminal: false,
              stages: {
                preflight: "active",
                request: "pending",
                round: "pending",
                proof: "pending",
                verify: "pending",
                consumer: "pending",
              },
            },
          }], 1);
        }
        if (text === POSTGRES_QUERIES.loadEvents) {
          return result([{ event_payload: created }], 1);
        }
        if (/FROM proofline_private\.run_artifacts/i.test(text)) return result([], 0);
        return result([], 1);
      });

      await fixture.repository.retryCommand(COMMAND, CLAIM, {
        category,
        code,
        message: "Worker command failed",
        retryable: true,
        evidence: {},
      });

      expect(insertedEvents(fixture.client)).toEqual([
        expect.objectContaining({
          runId: RUN_ID,
          commandId: COMMAND,
          type: eventType,
          payload: expect.objectContaining({
            version: "1",
            state,
            attempt: 1,
            retryAfter: RETRY_AT,
            error: expect.objectContaining({ code }),
          }),
        }),
      ]);
      const insert = fixture.client.query.mock.calls.find(
        ([text]) => String(text) === POSTGRES_QUERIES.insertEvent,
      );
      expect(insert?.[1]?.[2]).toBe(`${COMMAND}:${eventType}:1`);
      expect(fixture.client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    },
  );

  it("records RUN_RESUMED in the same claim transaction before returning work", async () => {
    const created = makeRunEvents()[0];
    const scheduled = {
      version: "1",
      runId: RUN_ID,
      sequence: 2,
      commandId: COMMAND,
      occurredAt: "2026-08-03T02:00:00.000Z",
      type: "STAGE_RETRY_SCHEDULED",
      payload: {
        version: "1",
        state: "retryable",
        stage: "preflight",
        attempt: 1,
        retryAfter: RETRY_AT,
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
      },
    };
    const fixture = repositoryWith(async (text) => {
      if (text === POSTGRES_QUERIES.claimNextCommand) {
        return result([{
          id: COMMAND,
          project_id: PROJECT,
          run_id: RUN_ID,
          kind: "RUN_PREFLIGHT",
          attempts: 2,
          payload: {},
          last_error: scheduled.payload.error,
        }], 1);
      }
      if (text === POSTGRES_QUERIES.lockRun) {
        return result([{
          last_sequence: 2,
          projection: { version: "1", runId: RUN_ID, sequence: 2, terminal: false },
        }], 1);
      }
      if (text === POSTGRES_QUERIES.loadEvents) {
        return result([
          { event_payload: created },
          { event_payload: scheduled },
        ], 2);
      }
      return result([], 1);
    });

    const claimed = await fixture.repository.claimNextCommand();
    expect(claimed?.command).toMatchObject({ id: COMMAND, attempts: 2 });
    expect(insertedEvents(fixture.client)).toEqual([
      expect.objectContaining({
        commandId: COMMAND,
        type: "RUN_RESUMED",
        payload: expect.objectContaining({ attempt: 2, resumeFrom: "preflight" }),
      }),
    ]);
    const statements = fixture.client.query.mock.calls.map(([text]) => String(text));
    expect(statements.indexOf(POSTGRES_QUERIES.insertEvent)).toBeLessThan(
      statements.indexOf("COMMIT"),
    );
  });

  it("audits an expired first lease before resuming attempt two", async () => {
    const storedEvents = [makeRunEvents()[0]] as Record<string, unknown>[];
    let lastSequence = 1;
    const fixture = repositoryWith(async (text, values) => {
      if (text === POSTGRES_QUERIES.claimNextCommand) return result([{
        id: COMMAND, project_id: PROJECT, run_id: RUN_ID, kind: "RUN_PREFLIGHT",
        attempts: 2, payload: {}, last_error: null,
      }], 1);
      if (text === POSTGRES_QUERIES.loadEvents) return result(
        storedEvents.map((event_payload) => ({ event_payload })),
        storedEvents.length,
      );
      if (text === POSTGRES_QUERIES.lockRun) return result([{
        last_sequence: lastSequence,
        projection: { version: "1", runId: RUN_ID, sequence: lastSequence, terminal: false },
      }], 1);
      if (text === POSTGRES_QUERIES.insertEvent) {
        storedEvents.push(JSON.parse(String(values?.[4])) as Record<string, unknown>);
        return result([], 1);
      }
      if (text === POSTGRES_QUERIES.updateProjection) {
        lastSequence = Number(values?.[2]);
        return result([], 1);
      }
      return result([], 1);
    });

    await expect(fixture.repository.claimNextCommand()).resolves.toMatchObject({
      command: { id: COMMAND, attempts: 2 },
    });
    expect(insertedEvents(fixture.client)).toEqual([
      expect.objectContaining({
        type: "STAGE_RETRY_SCHEDULED",
        payload: expect.objectContaining({ attempt: 1 }),
      }),
      expect.objectContaining({
        type: "RUN_RESUMED",
        payload: expect.objectContaining({ attempt: 2 }),
      }),
    ]);
  });

  it("audits an expired attempt-two lease before resuming attempt three", async () => {
    const created = makeRunEvents()[0];
    const scheduled = {
      version: "1", runId: RUN_ID, sequence: 2, commandId: COMMAND,
      occurredAt: "2026-08-03T02:00:00.000Z", type: "STAGE_RETRY_SCHEDULED",
      payload: {
        version: "1", state: "retryable", stage: "preflight", attempt: 1,
        retryAfter: RETRY_AT, resumeFrom: "preflight", preservedEvidence: [],
        updatedAt: "2026-08-03T02:00:00.000Z",
        error: { version: "1", category: "transport", code: "VERIFIER_TRANSPORT_FAILED", message: "Worker command failed", retryable: true, evidence: {} },
        retrySafety: "same-command",
      },
    };
    const resumed = {
      version: "1", runId: RUN_ID, sequence: 3, commandId: COMMAND,
      occurredAt: "2026-08-03T02:00:16.000Z", type: "RUN_RESUMED",
      payload: { stage: "preflight", attempt: 2, resumeFrom: "preflight", preservedEvidence: [] },
    };
    const storedEvents = [created, scheduled, resumed] as Record<string, unknown>[];
    let lastSequence = 3;
    const fixture = repositoryWith(async (text, values) => {
      if (text === POSTGRES_QUERIES.claimNextCommand) return result([{
        id: COMMAND, project_id: PROJECT, run_id: RUN_ID, kind: "RUN_PREFLIGHT",
        attempts: 3, payload: {}, last_error: scheduled.payload.error,
      }], 1);
      if (text === POSTGRES_QUERIES.loadEvents) return result(
        storedEvents.map((event_payload) => ({ event_payload })),
        storedEvents.length,
      );
      if (text === POSTGRES_QUERIES.lockRun) return result([{
        last_sequence: lastSequence,
        projection: { version: "1", runId: RUN_ID, sequence: lastSequence, terminal: false },
      }], 1);
      if (text === POSTGRES_QUERIES.insertEvent) {
        storedEvents.push(JSON.parse(String(values?.[4])) as Record<string, unknown>);
        return result([], 1);
      }
      if (text === POSTGRES_QUERIES.updateProjection) {
        lastSequence = Number(values?.[2]);
        return result([], 1);
      }
      return result([], 1);
    });

    await expect(fixture.repository.claimNextCommand()).resolves.toMatchObject({
      command: { id: COMMAND, attempts: 3 },
    });
    expect(insertedEvents(fixture.client)).toEqual([
      expect.objectContaining({
        commandId: COMMAND,
        type: "STAGE_RETRY_SCHEDULED",
        payload: expect.objectContaining({
          attempt: 2,
          error: expect.objectContaining({ code: "COMMAND_LEASE_EXPIRED" }),
        }),
      }),
      expect.objectContaining({
        commandId: COMMAND,
        type: "RUN_RESUMED",
        payload: expect.objectContaining({ attempt: 3, resumeFrom: "preflight" }),
      }),
    ]);
    expect(fixture.client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("reclaims deployed-consumer observations without mutating terminal run evidence", async () => {
    const fixture = repositoryWith(async (text) => {
      if (text === POSTGRES_QUERIES.claimNextCommand) return result([{
        id: COMMAND,
        project_id: PROJECT,
        run_id: RUN_ID,
        kind: "VERIFY_DEPLOYED_CONSUMER",
        attempts: 2,
        payload: { version: "1", chainId: 114, address: "0x1111111111111111111111111111111111111111" },
        last_error: null,
      }], 1);
      return result([], 1);
    });

    await expect(fixture.repository.claimNextCommand()).resolves.toMatchObject({
      command: { id: COMMAND, kind: "VERIFY_DEPLOYED_CONSUMER", attempts: 2 },
    });
    const statements = fixture.client.query.mock.calls.map(([text]) => String(text));
    expect(statements).not.toContain(POSTGRES_QUERIES.loadEvents);
    expect(statements).not.toContain(POSTGRES_QUERIES.insertEvent);
    expect(statements).not.toContain(POSTGRES_QUERIES.updateProjection);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("retries or exhausts deployed-consumer observations without failing or cancelling the terminal run", async () => {
    const fixture = repositoryWith(async (text) => {
      if (text === POSTGRES_QUERIES.retryCommand) return result([{
        id: COMMAND,
        run_id: RUN_ID,
        kind: "VERIFY_DEPLOYED_CONSUMER",
        attempts: 3,
        available_at: new Date(RETRY_AT),
      }], 1);
      return result([], 1);
    });

    await fixture.repository.retryCommand(COMMAND, CLAIM, {
      category: "transport",
      code: "COSTON2_RPC_UNAVAILABLE",
      message: "Read-only observation failed",
      retryable: false,
      terminal: true,
      evidence: {},
    });

    const statements = fixture.client.query.mock.calls.map(([text]) => String(text));
    expect(statements).not.toContain(POSTGRES_QUERIES.loadEvents);
    expect(statements).not.toContain(POSTGRES_QUERIES.lockRun);
    expect(statements).not.toContain(POSTGRES_QUERIES.insertEvent);
    expect(statements).not.toContain(POSTGRES_QUERIES.updateProjection);
    expect(statements.some((text) => /SET status = 'cancelled'/i.test(text))).toBe(false);
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
