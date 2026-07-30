import {
  RunEventV1Schema,
  RunProjectionV1Schema,
  type RunEventTypeV1,
  type RunEventV1,
  type RunProjectionV1,
  type RunStageStatusV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";

const LIFECYCLE: readonly RunEventTypeV1[] = [
  "RUN_CREATED",
  "PREFLIGHT_ACCEPTED",
  "REQUEST_SUBMITTED",
  "ROUND_FINALIZED",
  "PROOF_AVAILABLE",
  "PROOF_VERIFIED",
  "CONSUMER_VERIFIED",
];

function commandEffect(event: RunEventV1): string {
  return canonicalJson({ runId: event.runId, type: event.type, payload: event.payload });
}

function isTerminal(events: readonly RunEventV1[]): boolean {
  return events.at(-1)?.type === "CONSUMER_VERIFIED";
}

export function appendRunEvents(
  existing: readonly RunEventV1[],
  additions: readonly RunEventV1[],
): RunEventV1[] {
  const journal = existing.map((event) => RunEventV1Schema.parse(event));
  if (journal.length > 0) {
    projectRun(journal);
  }

  const expectedRunId = journal[0]?.runId ?? additions[0]?.runId;
  const commands = new Map<string, RunEventV1>();
  for (const event of journal) {
    const priorCommand = commands.get(event.commandId);
    if (priorCommand !== undefined) {
      const suffix =
        commandEffect(priorCommand) === commandEffect(event) ? "duplicate" : "conflict";
      throw new Error(`Idempotency command ${suffix} for ${event.commandId}`);
    }
    commands.set(event.commandId, event);
  }

  for (const candidateValue of additions) {
    const candidate = RunEventV1Schema.parse(candidateValue);
    if (expectedRunId !== undefined && candidate.runId !== expectedRunId) {
      throw new Error(`Run id mismatch: expected ${expectedRunId}, received ${candidate.runId}`);
    }

    const priorCommand = commands.get(candidate.commandId);
    if (priorCommand !== undefined) {
      if (commandEffect(priorCommand) === commandEffect(candidate)) {
        continue;
      }
      throw new Error(`Idempotency command conflict for ${candidate.commandId}`);
    }

    if (isTerminal(journal)) {
      throw new Error("Cannot append an event after the terminal consumer state");
    }

    const expectedSequence = journal.length + 1;
    if (candidate.sequence !== expectedSequence) {
      throw new Error(
        `Expected sequence ${expectedSequence}, received ${candidate.sequence}`,
      );
    }

    journal.push(candidate);
    commands.set(candidate.commandId, candidate);
    projectRun(journal);
  }

  return journal;
}

function completedStages(count: number): Record<string, RunStageStatusV1> {
  const stageNames = ["preflight", "request", "round", "proof", "verify", "consumer"];
  const stages: Record<string, RunStageStatusV1> = Object.fromEntries(
    stageNames.map((stage) => [stage, "pending"] as const),
  );

  const completedCount = Math.max(0, count - 1);
  for (let index = 0; index < completedCount; index += 1) {
    stages[stageNames[index]] = "completed";
  }
  if (count >= 1 && count <= stageNames.length) {
    stages[stageNames[count - 1]] = "active";
  }
  return stages;
}

export function projectRun(eventValues: readonly RunEventV1[]): RunProjectionV1 {
  if (eventValues.length === 0) {
    throw new Error("A run projection requires RUN_CREATED");
  }

  const events: RunEventV1[] = [];
  let runId: string | undefined;
  for (let index = 0; index < eventValues.length; index += 1) {
    if (isTerminal(events)) {
      throw new Error("Cannot project events after the terminal consumer state");
    }

    const event = RunEventV1Schema.parse(eventValues[index]);
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(`Expected sequence ${expectedSequence}, received ${event.sequence}`);
    }
    if (runId !== undefined && event.runId !== runId) {
      throw new Error(`Run id mismatch: expected ${runId}, received ${event.runId}`);
    }
    runId ??= event.runId;

    const expectedType = LIFECYCLE[index];
    if (event.type !== expectedType) {
      throw new Error(
        `Invalid lifecycle transition: expected ${expectedType ?? "terminal"}, received ${event.type}`,
      );
    }
    events.push(event);
  }

  const last = events.at(-1)!;
  const terminal = last.type === "CONSUMER_VERIFIED";
  const stages = completedStages(events.length);
  if (terminal) {
    stages.consumer = last.payload.passed ? "completed" : "failed";
  }

  return RunProjectionV1Schema.parse({
    version: "1",
    runId: runId!,
    sequence: last.sequence,
    terminal,
    stages,
  });
}
