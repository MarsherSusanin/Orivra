import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  replayProofBundle,
} from "@proofline/domain";
import { runProoflineAction } from "./index";

type Environment = Record<string, string | undefined>;

const MAX_LIVE_TIMEOUT_MS = 600_000;

type LiveDeadline = {
  expiresAt: number;
  maxAttempts: number;
};

type ReleaseGateTimeoutError = Error & {
  code: "RELEASE_GATE_TIMEOUT";
  reason: "LIVE_GATE_DEADLINE_EXCEEDED";
  retryable: false;
};

function releaseGateTimeout(): ReleaseGateTimeoutError {
  return Object.assign(
    new Error(
      "Proofline live release gate timed out (LIVE_GATE_DEADLINE_EXCEEDED)",
    ),
    {
      code: "RELEASE_GATE_TIMEOUT" as const,
      reason: "LIVE_GATE_DEADLINE_EXCEEDED" as const,
      retryable: false as const,
    },
  );
}

function isReleaseGateTimeout(cause: unknown): cause is ReleaseGateTimeoutError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "RELEASE_GATE_TIMEOUT"
  );
}

function validateLiveTimeout(timeoutMs: number): number {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_LIVE_TIMEOUT_MS
  ) {
    throw new Error(
      `Invalid live timeout: expected a finite positive value in the range 1..${MAX_LIVE_TIMEOUT_MS} ms`,
    );
  }
  return timeoutMs;
}

function requiredGitIdentity(
  environment: Environment,
  name: "GITHUB_SHA" | "PROOFLINE_TREE_HASH",
): string {
  const value = environment[name];
  if (typeof value !== "string" || !/^[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be exactly 40 hexadecimal characters`);
  }
  return value;
}

export function observerActionEnvironment(
  environment: Environment,
): Environment {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !/(?:private|secret|verifier).*key|private_key/i.test(name),
    ),
  );
}

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

  function remainingTime(deadline: LiveDeadline): number {
    return deadline.expiresAt - input.clock.now();
  }

  function createDeadline(timeoutMs: number): LiveDeadline {
    const startedAt = input.clock.now();
    if (!Number.isFinite(startedAt)) {
      throw new Error("Proofline live monotonic clock returned an invalid value");
    }
    return {
      expiresAt: startedAt + timeoutMs,
      maxAttempts: Math.ceil(timeoutMs / 2_000) + 1,
    };
  }

  function assertDeadline(deadline: LiveDeadline): number {
    const remainingMs = remainingTime(deadline);
    if (!(remainingMs > 0)) throw releaseGateTimeout();
    return remainingMs;
  }

  const responseControllers = new WeakMap<Response, AbortController>();

  async function withinDeadline<T>(
    deadline: LiveDeadline,
    operation: (signal: AbortSignal) => Promise<T> | T,
    controller = new AbortController(),
  ): Promise<T> {
    const remainingMs = assertDeadline(deadline);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = releaseGateTimeout();
        reject(error);
        controller.abort(error);
      }, remainingMs);
    });

    try {
      const value = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        timeout,
      ]);
      assertDeadline(deadline);
      return value;
    } catch (cause) {
      if (isReleaseGateTimeout(cause) || remainingTime(deadline) <= 0) {
        throw releaseGateTimeout();
      }
      throw cause;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function sleepWithinDeadline(
    deadline: LiveDeadline,
    milliseconds: number,
  ): Promise<void> {
    const delay = Math.min(milliseconds, assertDeadline(deadline));
    await withinDeadline(deadline, () =>
      Promise.resolve(input.clock.sleep(delay)),
    );
  }

  async function request(
    path: string,
    init: RequestInit = {},
    command?: { mode: "replay" | "relayer"; operation: string },
    deadline?: LiveDeadline,
  ) {
    const { apiOrigin, projectToken } = apiConfiguration();
    const method = init.method ?? "GET";
    const fetchRequest = (signal?: AbortSignal) =>
      input.fetch(`${apiOrigin}${path}`, {
        ...init,
        ...(signal ? { signal } : {}),
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
    let response: Response;
    if (deadline) {
      const controller = new AbortController();
      response = await withinDeadline(deadline, fetchRequest, controller);
      responseControllers.set(response, controller);
    } else {
      response = await fetchRequest(init.signal ?? undefined);
    }
    if (!response.ok) {
      let code = "";
      try {
        const body = await responseJson(response, deadline);
        code = String(body.error?.code ?? body.code ?? "");
      } catch (cause) {
        if (isReleaseGateTimeout(cause)) throw cause;
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

  async function responseJson(
    response: Response,
    deadline?: LiveDeadline,
  ): Promise<Record<string, any>> {
    if (!deadline) return (await response.json()) as Record<string, any>;
    const controller = responseControllers.get(response);
    try {
      return (await withinDeadline(
        deadline,
        () => response.json(),
        controller,
      )) as Record<string, any>;
    } finally {
      responseControllers.delete(response);
    }
  }

  async function responseText(
    response: Response,
    deadline?: LiveDeadline,
  ): Promise<string> {
    if (!deadline) return response.text();
    const controller = responseControllers.get(response);
    try {
      return await withinDeadline(
        deadline,
        () => response.text(),
        controller,
      );
    } finally {
      responseControllers.delete(response);
    }
  }

  async function createRun(
    manifestPath: string,
    mode: "replay" | "relayer",
    deadline?: LiveDeadline,
  ) {
    const manifestSource = deadline
      ? await withinDeadline(deadline, () => input.files.readText(manifestPath))
      : await input.files.readText(manifestPath);
    const source = Web2JsonManifestV1Schema.parse(
      JSON.parse(manifestSource),
    );
    if (deadline) assertDeadline(deadline);
    const manifest = Web2JsonManifestV1Schema.parse({
      ...source,
      submission: { ...source.submission, mode },
    });
    const createdResponse = await request(
      "/v1/runs",
      {
        method: "POST",
        body: JSON.stringify({ manifest }),
      },
      { mode, operation: "create-run" },
      deadline,
    );
    const created = (await responseJson(
      createdResponse,
      deadline,
    )) as Record<string, unknown>;
    const runId = String(created.runId ?? "");
    if (!runId) throw new Error("Proofline API did not persist a run identity");
    return { runId, manifest };
  }

  async function waitForTerminalRun(
    runId: string,
    deadline: LiveDeadline,
    timeoutError: () => Error = releaseGateTimeout,
  ) {
    for (let attempt = 0; attempt < deadline.maxAttempts; attempt += 1) {
      const projectionResponse = await request(
        `/v1/runs/${encodeURIComponent(runId)}`,
        {},
        undefined,
        deadline,
      );
      const projection = (await responseJson(
        projectionResponse,
        deadline,
      )) as Record<string, unknown>;
      if (String(projection.runId ?? "") !== runId) {
        throw new Error("Persisted run projection identity mismatch");
      }
      if (projection.terminal === true) return projection;
      await sleepWithinDeadline(deadline, 2_000);
    }
    throw timeoutError();
  }

  async function waitForProofBoundary(runId: string, deadline: LiveDeadline) {
    for (let attempt = 0; attempt < deadline.maxAttempts; attempt += 1) {
      const projectionResponse = await request(
        `/v1/runs/${encodeURIComponent(runId)}`,
        {},
        undefined,
        deadline,
      );
      const projection = (await responseJson(
        projectionResponse,
        deadline,
      )) as Record<string, any>;
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
      await sleepWithinDeadline(deadline, 2_000);
    }
    throw releaseGateTimeout();
  }

  async function submitRelayerWhenReady(runId: string, deadline: LiveDeadline) {
    for (let attempt = 0; attempt < deadline.maxAttempts; attempt += 1) {
      try {
        const response = await request(
          `/v1/runs/${encodeURIComponent(runId)}/submissions`,
          {
            method: "POST",
            body: JSON.stringify({ mode: "relayer" }),
          },
          { mode: "relayer", operation: "submit-relayer" },
          deadline,
        );
        await responseText(response, deadline);
        return;
      } catch (cause) {
        if (
          !cause ||
          typeof cause !== "object" ||
          (cause as { code?: unknown }).code !== "PREFLIGHT_NOT_READY"
        ) {
          throw cause;
        }
        await sleepWithinDeadline(deadline, 2_000);
      }
    }
    throw releaseGateTimeout();
  }

  async function replayPersistedBundle(
    runId: string,
    mode: "replay" | "relayer",
    projection: Record<string, unknown>,
    deadline?: LiveDeadline,
  ) {
    const bundleResponse = await request(
      `/v1/runs/${encodeURIComponent(runId)}/bundle`,
      {},
      undefined,
      deadline,
    );
    const bundle = await responseText(bundleResponse, deadline);
    const replayResponse = await request(
      "/v1/replays",
      {
        method: "POST",
        body: JSON.stringify({ bundle }),
      },
      { mode, operation: "replay-bundle" },
      deadline,
    );
    const replay = (await responseJson(
      replayResponse,
      deadline,
    )) as Record<string, unknown>;
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
    if (!isDeepStrictEqual(bundle.manifest, manifest)) {
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
      const projection = await waitForTerminalRun(
        created.runId,
        createDeadline(60_000),
        () =>
          new Error(
            "Persisted Proofline run timed out before terminal evidence",
          ),
      );
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
      const timeoutMs = validateLiveTimeout(requestInput.timeoutMs);
      const commitHash = requiredGitIdentity(environment, "GITHUB_SHA");
      const treeHash = requiredGitIdentity(environment, "PROOFLINE_TREE_HASH");
      const deadline = createDeadline(timeoutMs);
      const created = await createRun(
        requestInput.manifestPath,
        "relayer",
        deadline,
      );
      await submitRelayerWhenReady(created.runId, deadline);
      const proofProjection = await waitForProofBoundary(
        created.runId,
        deadline,
      );
      if (proofProjection.terminal !== true) {
        const response = await request(
          `/v1/runs/${encodeURIComponent(created.runId)}/consumer-verifications`,
          {
            method: "POST",
            body: JSON.stringify({ consumer: "canonical-safe" }),
          },
          { mode: "relayer", operation: "verify-canonical-safe" },
          deadline,
        );
        await responseText(response, deadline);
      }
      const projection = await waitForTerminalRun(created.runId, deadline);
      const identity = persistedIdentity(projection);
      const replayed = await replayPersistedBundle(
        created.runId,
        "relayer",
        projection,
        deadline,
      );
      const submitted = replayed.decoded.events?.find(
        (event: any) => event?.type === "REQUEST_SUBMITTED",
      );
      const round = replayed.decoded.events?.find(
        (event: any) => event?.type === "ROUND_FINALIZED",
      );
      return {
        ...projection,
        commitHash,
        treeHash,
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
  const environment = observerActionEnvironment(input.environment);
  return {
    eventName: environment.GITHUB_EVENT_NAME ?? "",
    inputs: {
      manifest: input.core.getInput("manifest", { required: true }),
      mode: input.core.getInput("mode"),
    },
    env: environment,
    client: {
      replayManifest: input.replayManifest,
      runLive: input.runLive,
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
