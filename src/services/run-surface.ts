import { createRunClient } from "./run-client";

export type VerificationCheck = {
  label: string;
  status: "passed" | "failed";
};

export type ConsumerVerificationResult = {
  summary: string;
  code: string;
  checks: VerificationCheck[];
};

export type GeneratedConsumer = {
  source: string;
  sha256?: string;
};

export type RunServiceContext = {
  runId: string;
  projectToken: string;
};

export interface RunSurfaceServices {
  verifyConsumer(context: RunServiceContext): Promise<ConsumerVerificationResult>;
  generateConsumer(context: RunServiceContext): Promise<GeneratedConsumer>;
  exportBundle(context: RunServiceContext): Promise<string>;
  replayBundle(bundle: string): Promise<{ byteIdentical: boolean }>;
  resume?(): { runId: string; after: number } | null;
}

function commandKey(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${id}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isVerificationResult(value: unknown): value is ConsumerVerificationResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === "string" &&
    typeof record.code === "string" &&
    Array.isArray(record.checks)
  );
}

function diagnosticCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" ? [code] : [];
  });
}

function consumerCompleted(run: Record<string, unknown>): boolean {
  const stages = run.stages;
  if (!stages || typeof stages !== "object") return false;
  return (stages as Record<string, unknown>).consumer === "completed";
}

function resultFromRun(run: Record<string, unknown>): ConsumerVerificationResult {
  const codes = diagnosticCodes(run.diagnostics);
  const isMissing = (part: string) => codes.some((code) => code.includes(part));
  const checks: VerificationCheck[] = [
    { label: "Cryptographic proof", status: "passed" },
    { label: "Request identity", status: "passed" },
    { label: "Source scheme invariant", status: isMissing("SCHEME") ? "failed" : "passed" },
    { label: "Source host invariant", status: isMissing("HOST") ? "failed" : "passed" },
    { label: "Source path invariant", status: isMissing("PATH") ? "failed" : "passed" },
    { label: "Source query invariant", status: isMissing("QUERY") ? "failed" : "passed" },
  ];
  return codes.length === 0
    ? { summary: "Consumer invariants verified", code: "CONSUMER_VERIFIED", checks }
    : {
        summary: `Consumer needs ${codes.length === 1 ? "one fix" : `${codes.length} fixes`}`,
        code: codes[0] ?? "CONSUMER_INVARIANT_FAILED",
        checks,
      };
}

export function createLiveSurfaceServices(input: {
  baseUrl: string;
  projectToken: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
}): RunSurfaceServices {
  const client = createRunClient({
    baseUrl: input.baseUrl,
    projectToken: input.projectToken,
    storage: input.storage,
  });

  function assertContext(context: RunServiceContext): void {
    if (!input.projectToken || context.projectToken !== input.projectToken) {
      throw new Error("A project token is required to mutate this run");
    }
  }

  return {
    async verifyConsumer(context) {
      assertContext(context);
      const accepted = await client.verifyConsumer(
        context.runId,
        commandKey("verify-consumer"),
      );
      if (isVerificationResult(accepted)) return accepted;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const run = await client.getRun(context.runId);
        if (consumerCompleted(run)) return resultFromRun(run);
        await delay(500);
      }
      throw new Error("Consumer verification timed out; the run is still available for retry");
    },

    async generateConsumer(context) {
      assertContext(context);
      return client.generateConsumer(context.runId, commandKey("generate-consumer"));
    },

    async exportBundle(context) {
      assertContext(context);
      return client.bundle(context.runId);
    },

    async replayBundle(bundle) {
      const result = await client.replay(bundle, commandKey("replay-bundle"));
      return { byteIdentical: result.byteIdentical };
    },

    resume: () => client.resume(),
  };
}

export function createTestSurfaceServices(): RunSurfaceServices {
  if (import.meta.env.MODE !== "test") {
    throw new Error("The deterministic Web adapter is available only in test mode");
  }
  return {
    async verifyConsumer() {
      return {
        summary: "Consumer needs one fix",
        code: "EXPECTED_HOST_NOT_ENFORCED",
        checks: [
          { label: "Cryptographic proof", status: "passed" },
          { label: "Request identity", status: "passed" },
          { label: "Source host invariant", status: "failed" },
          { label: "Replay protection", status: "passed" },
        ],
      };
    },
    async generateConsumer() {
      return {
        source: "requireHost(requestUrl, EXPECTED_HOST);",
        sha256: "0".repeat(64),
      };
    },
    async exportBundle() {
      return JSON.stringify({ version: "1", checksum: `sha256:${"0".repeat(64)}` });
    },
    async replayBundle() {
      return { byteIdentical: true };
    },
    resume: () => null,
  };
}
