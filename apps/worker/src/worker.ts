import { normalizeFdcError, redactEvidence } from "@proofline/fdc-coston2";

interface ClaimedCommand {
  claimToken: string;
  command: {
    id: string;
    kind: string;
    runId?: string;
    attempts?: number;
    payload: Record<string, unknown>;
  };
}

interface WorkerRepository {
  claimNextCommand(): Promise<ClaimedCommand | null>;
  completeCommand(
    commandId: string,
    claimToken: string,
    result: unknown,
  ): Promise<unknown>;
  retryCommand(
    commandId: string,
    claimToken: string,
    failure: Record<string, unknown>,
  ): Promise<unknown>;
}

interface WorkerComposition {
  environment: string;
  mode: "live" | "replay";
  adapters: Record<string, { kind: string }>;
}

export function validateWorkerComposition(input: WorkerComposition): void {
  if (input.environment !== "production") return;
  if (input.mode !== "live") {
    throw new Error("Replay or simulator composition is forbidden in production");
  }
  for (const [name, adapter] of Object.entries(input.adapters)) {
    if (adapter.kind !== "live") {
      throw new Error(
        `Replay or simulator adapter ${name} is forbidden in production`,
      );
    }
  }
}

function safeFailure(cause: unknown, commandId: string): Record<string, unknown> {
  if (cause && typeof cause === "object" && "category" in cause) {
    const source = cause as Record<string, unknown>;
    return redactEvidence({
      category: source.category,
      retryable: source.retryable === true,
      message: source.message ?? "Worker command failed",
      commandId,
    }) as Record<string, unknown>;
  }
  return normalizeFdcError(cause, { commandId });
}

export function createRunWorker(input: {
  environment: string;
  mode: "live" | "replay";
  repository: WorkerRepository;
  handlers: Record<string, (command: ClaimedCommand["command"]) => Promise<unknown>>;
  logger: {
    info(value: unknown): void;
    error(value: unknown): void;
  };
  adapters?: Record<string, { kind: string }>;
}) {
  validateWorkerComposition({
    environment: input.environment,
    mode: input.mode,
    adapters: input.adapters ?? {},
  });

  return {
    async processOne(): Promise<boolean> {
      const claimed = await input.repository.claimNextCommand();
      if (!claimed) return false;
      const handler = input.handlers[claimed.command.kind];
      if (!handler) {
        const failure = {
          category: "configuration",
          retryable: false,
          message: "No handler registered for command",
          commandId: claimed.command.id,
        };
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error(failure);
        return true;
      }

      try {
        const result = await handler(claimed.command);
        await input.repository.completeCommand(
          claimed.command.id,
          claimed.claimToken,
          result,
        );
        input.logger.info({
          event: "WORKER_COMMAND_COMPLETED",
          commandId: claimed.command.id,
        });
      } catch (cause) {
        const failure = safeFailure(cause, claimed.command.id);
        await input.repository.retryCommand(
          claimed.command.id,
          claimed.claimToken,
          failure,
        );
        input.logger.error({
          event: "WORKER_COMMAND_FAILED",
          ...failure,
        });
      }
      return true;
    },
  };
}
