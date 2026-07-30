import { Pool } from "pg";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import { createPostgresCommandRepository } from "@proofline/api/src/postgres";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import {
  createLiveCoston2PipelinePorts,
  createLiveCoston2Runtime,
} from "./live-runtime";
import {
  createProductionCommandHandlers,
  createRunWorker,
  type WorkerCommand,
} from "./worker";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the live worker`);
  return value;
}

const pool = new Pool({
  connectionString: required("DATABASE_URL"),
  max: Number(process.env.PROOFLINE_WORKER_DB_POOL_SIZE ?? 4),
  idleTimeoutMillis: 30_000,
});
const runtime = createLiveCoston2Runtime({ environment: process.env });
const verifier = createWeb2JsonVerifierClient({
  endpoint:
    process.env.PROOFLINE_VERIFIER_URL ??
    "https://fdc-verifiers-testnet.flare.network",
  apiKey: required("PROOFLINE_VERIFIER_API_KEY"),
});
const projectToken = required("PROOFLINE_PROJECT_TOKEN");
const privateKey = required("PROOFLINE_COSTON2_PRIVATE_KEY");
const repository = createPostgresCommandRepository({ pool });
const pipelinePorts = createLiveCoston2PipelinePorts({
  environment: process.env,
  verifier,
});
const rawPipelineHandlers = createProductionCommandHandlers({
  repository,
  ports: pipelinePorts,
  clock: { now: () => new Date().toISOString() },
});
const pipelineHandlers: Record<
  string,
  (command: WorkerCommand) => Promise<unknown>
> = {};
for (const [kind, handler] of Object.entries(rawPipelineHandlers)) {
  pipelineHandlers[kind] = (command) => {
    if (!command.runId) {
      throw new Error(`Persisted ${kind} command has no run id`);
    }
    return handler({ ...command, runId: command.runId });
  };
}
const logger = {
  info: (value: unknown) => console.info(JSON.stringify(value)),
  error: (value: unknown) => console.error(JSON.stringify(value)),
};
const worker = createRunWorker({
  environment: process.env.NODE_ENV ?? "production",
  mode: "live",
  repository,
  adapters: { coston2: runtime, pipeline: { kind: "live" } },
  logger,
  handlers: {
    ...pipelineHandlers,
    RUN_LIVE_COSTON2: async (command) => {
      const manifest = Web2JsonManifestV1Schema.parse(command.payload.manifest);
      return runtime.execute({
        manifest,
        projectToken,
        privateKey,
        verifier,
        timeoutMs: 600_000,
      });
    },
  },
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

while (!stopping) {
  const processed = await worker.processOne();
  if (!processed) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
await pool.end();
