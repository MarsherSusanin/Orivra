import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import { runProoflineAction } from "./index";

type Environment = Record<string, string | undefined>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Proofline Action configuration requires ${name}`);
  }
  return value;
}

function persistedIdentity(run: Record<string, unknown>) {
  const runId = String(run.runId ?? "");
  const lastSequence = Number(run.sequence);
  if (!runId || !Number.isSafeInteger(lastSequence) || lastSequence < 1) {
    throw new Error("Persisted Proofline run identity is incomplete");
  }
  return { runId, lastSequence };
}

export function createPersistedActionRunClient(input: {
  environment: Environment;
  fetch: typeof globalThis.fetch;
  clock: { now(): number; sleep(ms: number): Promise<void> | void };
  files: { readText(path: string): Promise<string> };
}) {
  const environment = input.environment;
  const apiOrigin = required(environment, "PROOFLINE_API_URL").replace(
    /\/+$/,
    "",
  );
  const projectToken = required(environment, "PROOFLINE_PROJECT_TOKEN");
  let commandSequence = 0;

  async function request(path: string, init: RequestInit = {}) {
    const method = init.method ?? "GET";
    const response = await input.fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${projectToken}`,
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "idempotency-key": `action-${input.clock.now()}-${++commandSequence}`,
            }
          : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Proofline API rejected ${method} ${path} (${response.status})`,
      );
    }
    return response;
  }

  async function createRun(manifestPath: string, mode: "replay" | "relayer") {
    const source = Web2JsonManifestV1Schema.parse(
      JSON.parse(await input.files.readText(manifestPath)),
    );
    const manifest = Web2JsonManifestV1Schema.parse({
      ...source,
      submission: { ...source.submission, mode },
    });
    const created = (await request("/v1/runs", {
      method: "POST",
      body: JSON.stringify({ manifest }),
    }).then((response) => response.json())) as Record<string, unknown>;
    const runId = String(created.runId ?? "");
    if (!runId) throw new Error("Proofline API did not persist a run identity");
    return { runId, manifest };
  }

  async function waitForTerminalRun(runId: string, timeoutMs: number) {
    const startedAt = input.clock.now();
    const maxAttempts = Math.ceil(timeoutMs / 2_000) + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const projection = (await request(
        `/v1/runs/${encodeURIComponent(runId)}`,
      ).then((response) => response.json())) as Record<string, unknown>;
      if (String(projection.runId ?? "") !== runId) {
        throw new Error("Persisted run projection identity mismatch");
      }
      if (projection.terminal === true) return projection;
      const remainingMs = timeoutMs - (input.clock.now() - startedAt);
      if (remainingMs <= 0) break;
      await input.clock.sleep(Math.min(2_000, remainingMs));
    }
    throw new Error("Persisted Proofline run timed out before terminal evidence");
  }

  async function replayPersistedBundle(runId: string) {
    const bundle = await request(
      `/v1/runs/${encodeURIComponent(runId)}/bundle`,
    ).then((response) => response.text());
    const replay = (await request("/v1/replays", {
      method: "POST",
      body: JSON.stringify({ bundle }),
    }).then((response) => response.json())) as Record<string, unknown>;
    if (String(replay.runId ?? "") !== runId || replay.byteIdentical !== true) {
      throw new Error("Persisted bundle replay identity is not byte-identical");
    }
    const checksum = String(replay.checksum ?? "");
    if (!/^sha256:[a-f0-9]{64}$/.test(checksum)) {
      throw new Error("Persisted bundle replay checksum is invalid");
    }
    let decoded: Record<string, any> = {};
    try {
      decoded = JSON.parse(bundle) as Record<string, any>;
    } catch {
      throw new Error("Persisted bundle response is not valid JSON");
    }
    return { bundle, decoded, replay, checksum };
  }

  return {
    async replayManifest(manifestPath: string) {
      const created = await createRun(manifestPath, "replay");
      const projection = await waitForTerminalRun(created.runId, 60_000);
      const replayed = await replayPersistedBundle(created.runId);
      return {
        ...replayed.replay,
        runId: created.runId,
        checksum: replayed.checksum,
        persistedRun: persistedIdentity(projection),
      };
    },

    async runLive(requestInput: {
      manifestPath: string;
      timeoutMs: number;
    }) {
      const created = await createRun(requestInput.manifestPath, "relayer");
      await request(
        `/v1/runs/${encodeURIComponent(created.runId)}/submissions`,
        {
          method: "POST",
          body: JSON.stringify({ mode: "relayer" }),
        },
      );
      const projection = await waitForTerminalRun(
        created.runId,
        Math.min(600_000, Math.max(1, requestInput.timeoutMs)),
      );
      const replayed = await replayPersistedBundle(created.runId);
      const submitted = replayed.decoded.events?.find(
        (event: any) => event?.type === "REQUEST_SUBMITTED",
      );
      const round = replayed.decoded.events?.find(
        (event: any) => event?.type === "ROUND_FINALIZED",
      );
      return {
        ...projection,
        commitHash: environment.GITHUB_SHA,
        treeHash: environment.PROOFLINE_TREE_HASH,
        runId: created.runId,
        transactionHash:
          projection.transactionHash ?? submitted?.payload?.transactionHash,
        votingRound: String(
          projection.votingRound ??
            round?.payload?.votingRound ??
            replayed.decoded.proof?.votingRound ??
            "",
        ),
        proofChecksum: projection.proofChecksum ?? replayed.checksum,
        consumerVerified:
          projection.consumerVerified ??
          replayed.decoded.verification?.consumerVerified,
        broadcastCountAfterRecordedHash:
          projection.broadcastCountAfterRecordedHash,
        persistedRun: persistedIdentity(projection),
      };
    },
  };
}

export function createProductionActionDependencies(input: {
  environment: Environment;
  core: {
    getInput(name: string, options?: { required?: boolean }): string;
    setFailed(message: string): void;
    writeSummary(markdown: string): void | Promise<void>;
  };
  replayManifest(path: string): Promise<{ runId: string; checksum: string }>;
  runLive(input: Record<string, unknown>): Promise<any>;
  uploadJson(name: string, value: unknown): void | Promise<void>;
}) {
  const environment = input.environment;
  return {
    eventName: environment.GITHUB_EVENT_NAME ?? "",
    inputs: {
      manifest: input.core.getInput("manifest", { required: true }),
      mode: input.core.getInput("mode"),
    },
    env: environment,
    client: {
      replayManifest: input.replayManifest,
      runLive(request: Record<string, unknown>) {
        return input.runLive({
          ...request,
          projectToken: environment.PROOFLINE_PROJECT_TOKEN ?? "",
          privateKey: environment.PROOFLINE_COSTON2_PRIVATE_KEY ?? "",
          verifierApiKey: environment.PROOFLINE_VERIFIER_API_KEY ?? "",
        });
      },
    },
    artifacts: {
      writeSummary: input.core.writeSummary,
      upload: input.uploadJson,
    },
  };
}

export async function runActionEntry(input: {
  dependencies: Record<string, unknown>;
  runAction?: typeof runProoflineAction;
  setFailed(message: string): void;
  setExitCode(code: number): void;
}): Promise<number> {
  try {
    const result = await (input.runAction ?? runProoflineAction)(
      input.dependencies as never,
    );
    if (result !== 0) input.setFailed("Proofline release gate failed");
    input.setExitCode(result);
    return result;
  } catch {
    input.setFailed(
      "Proofline release gate failed without publishable detail",
    );
    input.setExitCode(1);
    return 1;
  }
}
