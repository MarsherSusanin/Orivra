// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appendRunEvents, projectRun } from "../src/index";
import { makeRunEvents } from "../../contracts/test/fixtures";

const statusRank = {
  pending: 0,
  active: 1,
  completed: 2,
  failed: 2,
} as const;

describe("append-only run journal", () => {
  it("accepts a strictly sequenced lifecycle", () => {
    const events = makeRunEvents();
    expect(appendRunEvents([], events)).toEqual(events);
  });

  it("rejects gaps, duplicates, out-of-order events, and cross-run appends", () => {
    const events = makeRunEvents();
    expect(() => appendRunEvents(events.slice(0, 1), [{ ...events[1], sequence: 3 }])).toThrow(
      /expected sequence 2/i,
    );
    expect(() => appendRunEvents(events.slice(0, 2), [{ ...events[2], sequence: 2 }])).toThrow(
      /expected sequence 3/i,
    );
    expect(() => appendRunEvents(events.slice(0, 1), [{ ...events[1], runId: "run_other" }])).toThrow(
      /run id/i,
    );
  });

  it("reapplying one idempotent command appends no duplicate side effect", () => {
    const events = makeRunEvents();
    const journal = appendRunEvents([], events.slice(0, 3));
    const repeatedCommandEvent = { ...events[2], sequence: 4 };

    expect(appendRunEvents(journal, [repeatedCommandEvent])).toEqual(journal);
  });

  it("rejects reuse of an idempotency key for a different side effect", () => {
    const events = makeRunEvents();
    const journal = appendRunEvents([], events.slice(0, 3));
    const conflictingEvent = {
      ...events[3],
      sequence: 4,
      commandId: events[2].commandId,
    };

    expect(() => appendRunEvents(journal, [conflictingEvent])).toThrow(
      /idempotency|command.*conflict/i,
    );
  });

  it("retains strict order for every non-empty lifecycle prefix", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: makeRunEvents().length }), (length) => {
        const events = makeRunEvents().slice(0, length);
        const journal = appendRunEvents([], events);
        expect(journal.map(({ sequence }) => sequence)).toEqual(
          Array.from({ length }, (_, index) => index + 1),
        );
      }),
    );
  });

  it("rejects every adjacent order inversion", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: makeRunEvents().length - 2 }), (index) => {
        const events = makeRunEvents();
        [events[index], events[index + 1]] = [events[index + 1], events[index]];
        expect(() => appendRunEvents([], events)).toThrow(/expected sequence/i);
      }),
    );
  });
});

describe("run projection", () => {
  it("advances all six stages monotonically to a terminal consumer state", () => {
    const events = makeRunEvents();
    const projections = events.map((_, index) => projectRun(events.slice(0, index + 1)));

    for (let index = 1; index < projections.length; index += 1) {
      for (const stage of ["preflight", "request", "round", "proof", "verify", "consumer"] as const) {
        expect(statusRank[projections[index].stages[stage]]).toBeGreaterThanOrEqual(
          statusRank[projections[index - 1].stages[stage]],
        );
      }
    }

    expect(projections.at(-1)).toMatchObject({
      sequence: 7,
      terminal: true,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "completed",
        proof: "completed",
        verify: "completed",
        consumer: "completed",
      },
    });
  });

  it("rejects any event after an accepted terminal state", () => {
    const events = makeRunEvents();
    const postTerminal = {
      ...events[5],
      sequence: 8,
      commandId: "cmd_after_terminal",
    };

    expect(() => projectRun([...events, postTerminal])).toThrow(/terminal/i);
    expect(() => appendRunEvents(events, [postTerminal])).toThrow(/terminal/i);
  });

  it("fails closed when a stage is skipped", () => {
    const events = makeRunEvents();
    expect(() => projectRun([events[0], { ...events[2], sequence: 2 }])).toThrow(
      /preflight|transition/i,
    );
  });
});
