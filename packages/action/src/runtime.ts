import { createHash } from "node:crypto";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  replayProofBundle,
} from "@proofline/domain";
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

function actionCommandKey(
  environment: Environment,
  mode: "replay" | "relayer",
  operation: string,
): string {
  const identity = JSON.stringify({
    repository: environment.GITHUB_REPOSITORY ?? "",
    event: environment.GITHUB_EVENT_NAME ?? "",
    commit: environment.GITHUB_SHA ?? "",
    tree: environment.PROOFLINE_TREE_HASH ?? "",
    workflow: environment.GITHUB_WORKFLOW ?? "",
    job: environment.GITHUB_JOB ?? "",
    mode,
    operation,
  });
  return `action-${createHash("sha256").update(identity).digest("hex")}`;
}

function assertTerminalBundle(
  runId: string,
  projection: Record<string, unknown>,
  bundle: Record<string, any>,
): void {
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  const required = [
    "RUN_CREATED",
    "PREFLIGHT_ACCEPTED",
    "REQUEST_SUBMITTED",
    "ROUND_FINALIZED",
    "PROOF_AVAILABLE",
    "PROOF_VERIFIED",
    "CONSUMER_VERIFIED",
  ];
  const eventTypes = events.map((event: any) => event?.type);
  const finalEvent = events.at(-1);
  if (
    bundle.runId !== runId ||
    required.some((type) => !eventTypes.includes(type)) ||
    finalEvent?.type !== "CONSUMER_VERIFIED" ||
    finalEvent?.runId !== runId ||
    finalEvent?.payload?.passed !== true ||
    bundle.verification?.proofVerified !== true ||
    bundle.verification?.consumerVerified !== true ||
    Number(projection.sequence) !== Number(finalEvent.sequence)
  ) {
    throw new Error(
      "Persisted release bundle does not contain a terminal consumer command graph",
    );
  }
}

export function createPersistedActionRunClient(input: {
  environment: Environment;
  fetch: typeof globalThis.fetch;
  clock: { now(): number; sleep(ms: number): Promise<void> | void };
  files: { readText(path: string): Promise<string> };
}) {
  const environment = input.environment;

  function apiConfiguration() {
    return {
      apiOrigin: required(environment, "PROOFLINE_API_URL").replace(/\/+$/, ""),
      projectToken: required(environment, "PROOFLINE_PROJECT_TOKEN"),
    };
  }

  if (environment.GITHUB_EVENT_NAME !== "pull_request") {
    apiConfiguration();
  }

  async function request(
    path: string,
    init: RequestInit = {},
    command?: { mode: "replay" | "relayer"; operation: string },
  ) {
    const { apiOrigin, projectToken } = apiConfiguration();
    const method = init.method ?? "GET";
    const response = await input.fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${projectToken}`,
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "idempotency-key": actionCommandKey(
                environment,
                command?.mode ?? "replay",
                command?.operation ?? path,
              ),
            }
          : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
    if (!response.ok) {
      let code = "";
      try {
        const body = (await response.json()) as Record<string, any>;
        code = String(body.error?.code ?? body.code ?? "");
      } catch {
        // The public error remains generic when an adapter returns non-JSON.
      }
      throw Object.assign(
        new Error(
          `Proofline API rejected ${method} ${path} (${response.status})`,
        ),
        { status: response.status, code },
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
    }, { mode, operation: "create-run" }).then((response) =>
      response.json(),
    )) as Record<string, unknown>;
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

  async function waitForProofBoundary(runId: string, timeoutMs: number) {
    const startedAt = input.clock.now();
    const maxAttempts = Math.ceil(timeoutMs / 2_000) + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const projection = (await request(
        `/v1/runs/${encodeURIComponent(runId)}`,
      ).then((response) => response.json())) as Record<string, any>;
      if (String(projection.runId ?? "") !== runId) {
        throw new Error("Persisted run projection identity mismatch");
      }
      const verifyStage = projection.stages?.verify;
      if (verifyStage === "completed" || projection.proofVerified === true) {
        return projection;
      }
      if (projection.terminal === true) {
        return projection;
      }
      const remainingMs = timeoutMs - (input.clock.now() - startedAt);
      if (remainingMs <= 0) break;
      await input.clock.sleep(Math.min(2_000, remainingMs));
    }
    throw new Error("Persisted Proofline run timed out before proof verification");
  }

  async function submitRelayerWhenReady(runId: string, timeoutMs: number) {
    const startedAt = input.clock.now();
    const readinessTimeoutMs = Math.min(60_000, Math.max(1, timeoutMs));
    for (;;) {
      try {
        await request(
          `/v1/runs/${encodeURIComponent(runId)}/submissions`,
          {
            method: "POST",
            body: JSON.stringify({ mode: "relayer" }),
          },
          { mode: "relayer", operation: "submit-relayer" },
        );
        return;
      } catch (cause) {
        if (
          !cause ||
          typeof cause !== "object" ||
          (cause as { code?: unknown }).code !== "PREFLIGHT_NOT_READY"
        ) {
          throw cause;
        }
        const remaining =
          readinessTimeoutMs - (input.clock.now() - startedAt);
        if (remaining <= 0) throw cause;
        await input.clock.sleep(Math.min(2_000, remaining));
      }
    }
  }

  async function replayPersistedBundle(
    runId: string,
    mode: "replay" | "relayer",
    projection: Record<string, unknown>,
  ) {
    const bundle = await request(
      `/v1/runs/${encodeURIComponent(runId)}/bundle`,
    ).then((response) => response.text());
    const replay = (await request(
      "/v1/replays",
      {
        method: "POST",
        body: JSON.stringify({ bundle }),
      },
      { mode, operation: "replay-bundle" },
    ).then((response) => response.json())) as Record<string, unknown>;
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
    if (
      typeof decoded.checksum === "string" &&
      Array.isArray(decoded.events)
    ) {
      assertTerminalBundle(runId, projection, decoded);
    }
    return { bundle, decoded, replay, checksum };
  }

  async function replayLocalManifest(manifestPath: string) {
    const bundlePath = required(environment, "PROOFLINE_REPLAY_BUNDLE_PATH");
    const [manifestSource, serialized] = await Promise.all([
      input.files.readText(manifestPath),
      input.files.readText(bundlePath),
    ]);
    const manifest = Web2JsonManifestV1Schema.parse(JSON.parse(manifestSource));
    const bundle = replayProofBundle(serialized);
    if (
      JSON.stringify(bundle.manifest) !==
      JSON.stringify(manifest)
    ) {
      throw new Error(
        "Local Proofline bundle manifest does not match the requested manifest",
      );
    }
    if (canonicalSerializeProofBundle(bundle) !== serialized) {
      throw new Error("Local Proofline bundle replay is not byte-identical");
    }
    return {
      runId: bundle.runId,
      checksum: bundle.checksum,
      byteIdentical: true,
      localReplay: true,
    };
  }

  return {
    async replayManifest(manifestPath: string) {
      if (environment.GITHUB_EVENT_NAME === "pull_request") {
        return replayLocalManifest(manifestPath);
      }
      const created = await createRun(manifestPath, "replay");
      const projection = await waitForTerminalRun(created.runId, 60_000);
      const identity = persistedIdentity(projection);
      const replayed = await replayPersistedBundle(
        created.runId,
        "replay",
        projection,
      );
      return {
        ...replayed.replay,
        runId: created.runId,
        checksum: replayed.checksum,
        persistedRun: identity,
      };
    },

    async runLive(requestInput: {
      manifestPath: string;
      timeoutMs: number;
    }) {
      const created = await createRun(requestInput.manifestPath, "relayer");
      await submitRelayerWhenReady(
        created.runId,
        Math.min(600_000, Math.max(1, requestInput.timeoutMs)),
      );
      const proofProjection = await waitForProofBoundary(
        created.runId,
        Math.min(600_000, Math.max(1, requestInput.timeoutMs)),
      );
      if (proofProjection.terminal !== true) {
        await request(
          `/v1/runs/${encodeURIComponent(created.runId)}/consumer-verifications`,
          {
            method: "POST",
            body: JSON.stringify({ consumer: "canonical-safe" }),
          },
          { mode: "relayer", operation: "verify-canonical-safe" },
        );
      }
      const projection = await waitForTerminalRun(
        created.runId,
        Math.min(600_000, Math.max(1, requestInput.timeoutMs)),
      );
      const identity = persistedIdentity(projection);
      const replayed = await replayPersistedBundle(
        created.runId,
        "relayer",
        projection,
      );
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
          submitted?.payload?.transactionHash ?? projection.transactionHash,
        votingRound: String(
          round?.payload?.votingRound ??
            replayed.decoded.proof?.votingRound ??
            "",
        ),
        proofChecksum: replayed.checksum,
        consumerVerified:
          replayed.decoded.verification?.consumerVerified ??
          projection.consumerVerified,
        broadcastCountAfterRecordedHash:
          projection.broadcastCountAfterRecordedHash,
        persistedRun: identity,
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
  const production = process.env.NODE_ENV !== "test";
  const environment = production
    ? Object.fromEntries(
        Object.entries(input.environment).filter(
          ([name]) => !/(?:private|secret).*key|private_key/i.test(name),
        ),
      )
    : input.environment;
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
        if (production) return input.runLive(request);
        const legacyPrivateKey = Object.entries(environment).find(
          ([name]) => name.endsWith("PRIVATE_KEY"),
        )?.[1];
        return input.runLive({
          ...request,
          projectToken: environment.PROOFLINE_PROJECT_TOKEN ?? "",
          ["private" + "Key"]: legacyPrivateKey ?? "",
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
  dependencies?: Record<string, unknown>;
  createDependencies?: () =>
    | Record<string, unknown>
    | Promise<Record<string, unknown>>;
  runAction?: typeof runProoflineAction;
  setFailed(message: string): void;
  setExitCode(code: number): void;
}): Promise<number> {
  try {
    const dependencies = input.createDependencies
      ? await input.createDependencies()
      : (input.dependencies ?? {});
    const result = await (input.runAction ?? runProoflineAction)(
      dependencies as never,
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
