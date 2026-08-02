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

const STAGE_NAMES = [
  "preflight",
  "request",
  "round",
  "proof",
  "verify",
  "consumer",
] as const;

function commandEffect(event: RunEventV1): string {
  return canonicalJson({ runId: event.runId, type: event.type, payload: event.payload });
}

function isTerminal(events: readonly RunEventV1[]): boolean {
  const type = events.at(-1)?.type;
  return type === "CONSUMER_VERIFIED" || type === "RUN_FAILED";
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
      throw new Error(`Idempotency command conflict for ${event.commandId}`);
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
      throw new Error("Cannot append an event after a terminal run state");
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
  const stages: Record<string, RunStageStatusV1> = Object.fromEntries(
    STAGE_NAMES.map((stage) => [stage, "pending"] as const),
  );

  const completedCount = Math.max(0, count - 1);
  for (let index = 0; index < completedCount; index += 1) {
    stages[STAGE_NAMES[index]] = "completed";
  }
  // Accepted preflight is a deliberate confirmation boundary: request remains
  // pending until an explicit wallet, relayer, or replay submission exists.
  if (count >= 1 && count <= STAGE_NAMES.length && count !== 2) {
    stages[STAGE_NAMES[count - 1]] = "active";
  }
  return stages;
}

function failedStages(stage: (typeof STAGE_NAMES)[number]) {
  const failedAt = STAGE_NAMES.indexOf(stage);
  return Object.fromEntries(
    STAGE_NAMES.map((name, index) => [
      name,
      index < failedAt ? "completed" : index === failedAt ? "failed" : "pending",
    ]),
  ) as Record<string, RunStageStatusV1>;
}

export function projectRun(eventValues: readonly RunEventV1[]): RunProjectionV1 {
  if (eventValues.length === 0) {
    throw new Error("A run projection requires RUN_CREATED");
  }

  const events: RunEventV1[] = [];
  let runId: string | undefined;
  for (let index = 0; index < eventValues.length; index += 1) {
    if (isTerminal(events)) {
      throw new Error("Cannot project events after a terminal run state");
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
    if (event.type !== "RUN_FAILED" && event.type !== expectedType) {
      throw new Error(
        `Invalid lifecycle transition: expected ${expectedType}, received ${event.type}`,
      );
    }
    events.push(event);
  }

  const last = events.at(-1)!;
  const failed = last.type === "RUN_FAILED";
  const terminal = failed || last.type === "CONSUMER_VERIFIED";
  const stages = failed
    ? failedStages(last.payload.stage)
    : completedStages(events.length);
  if (last.type === "CONSUMER_VERIFIED") {
    stages.consumer = last.payload.passed ? "completed" : "failed";
  }

  return RunProjectionV1Schema.parse({
    version: "1",
    runId: runId!,
    sequence: last.sequence,
    terminal,
    stages,
    ...(failed ? { terminalFailure: last.payload } : {}),
  });
}
