import type {
  ConsumerLabReportV1,
  CreateRunResultV1,
  EvidenceReceiptV1,
  NetworkCapabilityV1,
  PreflightReportV1,
  RunListPageV1,
  SubmissionResponseV1,
  ShareLinkV1,
  Web2JsonManifestV1,
  WalletTransactionV1,
} from "../../packages/contracts/src";
import {
  ConsumerLabReportV1Schema,
  CreateRunResultV1Schema,
  EvidenceReceiptV1Schema,
  NETWORK_CAPABILITIES_V1,
  NetworkCapabilityV1Schema,
  PreflightReportV1Schema,
  SubmissionResponseV1Schema,
  ShareLinkV1Schema,
} from "../../packages/contracts/src";

const LAST_RUN_KEY = "proofline:last-run";
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const WALLET_BROADCAST_PENDING = "wallet-broadcast-pending";
const walletSubmissionFlights = new Map<
  string,
  Promise<{ transactionHash: string }>
>();
const walletRecoveryMemory = new WeakMap<object, Map<string, string>>();

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type RecoveryStoragePort = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
type FetchPort = typeof globalThis.fetch;

export type WalletTransaction = WalletTransactionV1;

export type Eip1193Provider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type RunClient = ReturnType<typeof createRunClient>;

export class ProoflineClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, input: {
    status: number;
    code: string;
    retryAfterSeconds?: number;
  }) {
    super(message);
    this.name = "ProoflineClientError";
    this.status = input.status;
    this.code = input.code;
    if (input.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = input.retryAfterSeconds;
    }
  }
}

function trimBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function sequenceKey(runId: string): string {
  return `proofline:${runId}:after`;
}

function walletRecoveryKey(runId: string, idempotencyKey: string): string {
  return `proofline:${encodeURIComponent(runId)}:wallet:${encodeURIComponent(idempotencyKey)}`;
}

function availableRecoveryStorage(
  provided: RecoveryStoragePort | undefined,
  owner: object,
): RecoveryStoragePort {
  if (provided) return provided;
  try {
    if (typeof globalThis.sessionStorage !== "undefined") {
      return globalThis.sessionStorage;
    }
  } catch {
    // The stable recovery error below owns denied browser storage access.
  }
  let memory = walletRecoveryMemory.get(owner);
  if (!memory) {
    memory = new Map<string, string>();
    walletRecoveryMemory.set(owner, memory);
  }
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

function proveRecoveryStorageWritable(
  storage: RecoveryStoragePort,
  recoveryKey: string,
): void {
  try {
    storage.setItem(recoveryKey, WALLET_BROADCAST_PENDING);
    if (storage.getItem(recoveryKey) !== WALLET_BROADCAST_PENDING) {
      throw new Error("Wallet recovery storage did not persist its probe");
    }
  } catch {
    throw new Error("Wallet recovery storage is not writable");
  }
}

function clearPendingWalletMarker(
  storage: RecoveryStoragePort,
  recoveryKey: string,
): void {
  if (storage.getItem(recoveryKey) === WALLET_BROADCAST_PENDING) {
    storage.removeItem(recoveryKey);
  }
}

function isUserRejectedProviderRequest(cause: unknown): boolean {
  if (cause && typeof cause === "object") {
    try {
      if ("code" in cause) {
        const code = (cause as { code?: unknown }).code;
        return code === 4001 || code === "4001";
      }
    } catch {
      return false;
    }
  }
  return cause instanceof Error && /user rejected/i.test(cause.message);
}

export const reconcileWalletSubmission = Object.freeze(
  (input: {
    runId: string;
    idempotencyKey: string;
    events: ReadonlyArray<{
      type: string;
      payload: Record<string, unknown>;
    }>;
    recoveryStorage: RecoveryStoragePort;
  }): { cleared: boolean; transactionHash?: string } => {
    const key = walletRecoveryKey(input.runId, input.idempotencyKey);
    const transactionHash = input.recoveryStorage.getItem(key);
    if (!transactionHash || !TRANSACTION_HASH.test(transactionHash)) {
      return { cleared: false };
    }
    const persisted = input.events.some(
      (event) =>
        event.type === "REQUEST_SUBMITTED" &&
        event.payload.mode === "wallet" &&
        event.payload.transactionHash === transactionHash,
    );
    if (!persisted) return { cleared: false, transactionHash };
    input.recoveryStorage.removeItem(key);
    return { cleared: true, transactionHash };
  },
);

function safeStorageSet(storage: StoragePort, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Persistence is a convenience. A browser privacy mode must not break a run.
  }
}

function safeStorageGet(storage: StoragePort, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function redact(message: string, projectToken: string): string {
  return message
    .split(projectToken)
    .join("[REDACTED]")
    .replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]")
    .replace(/0x[a-f0-9]{64}/gi, "[REDACTED]");
}

function safeErrorCode(value: unknown, status: number): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(value)
    ? value
    : `HTTP_${status}`;
}

async function responseError(
  response: Response,
  projectToken: string,
  surface?: "create-run",
): Promise<ProoflineClientError> {
  let detail = response.statusText || "Request failed";
  let code: unknown;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      code = record.code;
      if (typeof record.error === "string") detail = record.error;
      if (record.error && typeof record.error === "object") {
        const nested = record.error as Record<string, unknown>;
        code = nested.code ?? code;
        if (typeof nested.message === "string") detail = nested.message;
      }
      if (typeof record.message === "string") detail = record.message;
    }
  } catch {
    // Do not obscure the HTTP status when an upstream returns a non-JSON body.
  }
  if (surface === "create-run") {
    const dailyQuota =
      response.status === 429 && code === "PROJECT_RUN_QUOTA_EXHAUSTED";
    const activeLive =
      response.status === 409 && code === "ACTIVE_LIVE_RUN_LIMIT_REACHED";
    const rawRetryAfter = response.headers.get("retry-after");
    const retryAfterSeconds =
      dailyQuota &&
      rawRetryAfter !== null &&
      /^[1-9]\d*$/.test(rawRetryAfter) &&
      rawRetryAfter.length <= 5 &&
      Number(rawRetryAfter) <= 86_400
        ? Number(rawRetryAfter)
        : undefined;
    if (dailyQuota) {
      return new ProoflineClientError(
        "Proofline run creation is rate limited. Retry safely.",
        {
          status: response.status,
          code: "PROJECT_RUN_QUOTA_EXHAUSTED",
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      );
    }
    if (activeLive) {
      return new ProoflineClientError(
        "Proofline has reached the active live-run limit.",
        { status: response.status, code: "ACTIVE_LIVE_RUN_LIMIT_REACHED" },
      );
    }
    return new ProoflineClientError(
      "Proofline run creation failed.",
      { status: response.status, code: `HTTP_${response.status}` },
    );
  }
  return new ProoflineClientError(
    redact(`Proofline API ${response.status}: ${detail}`, projectToken),
    { status: response.status, code: safeErrorCode(code, response.status) },
  );
}

export function createRunClient(input: {
  baseUrl: string;
  projectToken: string;
  expectedWebOrigin?: string;
  fetch?: FetchPort;
  storage?: StoragePort;
}) {
  const baseUrl = trimBaseUrl(input.baseUrl);
  const fetchPort = input.fetch ?? globalThis.fetch.bind(globalThis);
  const storage = input.storage ?? globalThis.localStorage;
  const expectedWebOrigin = input.expectedWebOrigin ?? globalThis.location?.origin;
  let normalizedExpectedWebOrigin: string | undefined;
  if (expectedWebOrigin !== undefined) {
    try {
      normalizedExpectedWebOrigin = new URL(expectedWebOrigin).origin;
    } catch {
      throw new ProoflineClientError("The expected Proofline web origin is invalid", {
        status: 500,
        code: "SHARE_LINK_INVALID",
      });
    }
  }

  async function request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      raw?: boolean;
      errorSurface?: "create-run";
    } = {},
  ): Promise<T> {
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${input.projectToken}`,
    });
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

    let response: Response;
    try {
      response = await fetchPort(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ProoflineClientError(
        redact(`Proofline API transport error: ${message}`, input.projectToken),
        { status: 503, code: "TRANSPORT_UNAVAILABLE" },
      );
    }
    if (!response.ok) {
      throw await responseError(
        response,
        input.projectToken,
        options.errorSurface,
      );
    }
    if (options.raw) return (await response.text()) as T;
    return (await response.json()) as T;
  }

  async function confirmSubmission(
    runId: string,
    mode: "wallet" | "relayer" | "replay",
    idempotencyKey: string,
  ): Promise<SubmissionResponseV1> {
    const result = await request<unknown>(
      `/runs/${encodeURIComponent(runId)}/submissions`,
      {
        method: "POST",
        body: { mode },
        idempotencyKey,
      },
    );
    const parsed = SubmissionResponseV1Schema.safeParse(result);
    if (!parsed.success || parsed.data.runId !== runId || parsed.data.mode !== mode) {
      throw new ProoflineClientError(
        "Proofline returned an invalid submission response contract",
        { status: 502, code: "SUBMISSION_RESPONSE_INVALID" },
      );
    }
    return parsed.data;
  }

  return {
    listRuns(filters: {
      status?: "active" | "completed" | "failed";
      cursor?: string;
      limit?: number;
    } = {}) {
      const query = new URLSearchParams();
      if (filters.status) query.set("status", filters.status);
      if (filters.cursor) query.set("cursor", filters.cursor);
      if (filters.limit !== undefined) query.set("limit", String(filters.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<RunListPageV1>(`/runs${suffix}`);
    },

    async createRun(manifest: Web2JsonManifestV1, idempotencyKey: string) {
      const result = await request<unknown>("/runs", {
        method: "POST",
        body: { manifest },
        idempotencyKey,
        errorSurface: "create-run",
      });
      const parsed = CreateRunResultV1Schema.safeParse(result);
      if (!parsed.success) {
        throw new Error("Proofline returned an invalid create-run response contract");
      }
      const accepted: CreateRunResultV1 = parsed.data;
      safeStorageSet(storage, LAST_RUN_KEY, accepted.runId);
      safeStorageSet(storage, sequenceKey(accepted.runId), "0");
      return accepted;
    },

    getRun(runId: string) {
      return request<Record<string, unknown>>(`/runs/${encodeURIComponent(runId)}`);
    },

    async getPreflightReport(runId: string): Promise<PreflightReportV1> {
      const result = await request<unknown>(
        `/runs/${encodeURIComponent(runId)}/preflight`,
      );
      const parsed = PreflightReportV1Schema.safeParse(result);
      if (!parsed.success) {
        throw new ProoflineClientError(
          "Proofline returned an invalid preflight report contract",
          { status: 502, code: "PREFLIGHT_REPORT_INVALID" },
        );
      }
      return parsed.data;
    },

    async getConsumerLabReport(runId: string): Promise<ConsumerLabReportV1> {
      const result = await request<unknown>(`/runs/${encodeURIComponent(runId)}/consumer-lab`);
      const parsed = ConsumerLabReportV1Schema.safeParse(result);
      if (!parsed.success || parsed.data.runId !== runId) {
        throw new ProoflineClientError(
          "Proofline returned an invalid Consumer Lab report contract",
          { status: 502, code: "CONSUMER_LAB_INVALID" },
        );
      }
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(parsed.data.safeConsumer.source),
      );
      const actual = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const diffMatchesSource = parsed.data.safeConsumer.source
        .trimEnd()
        .split("\n")
        .every((line) => parsed.data.safeConsumer.diff.includes(`+${line}`));
      if (`sha256:${actual}` !== parsed.data.safeConsumer.sha256 || !diffMatchesSource) {
        throw new ProoflineClientError(
          "Consumer Lab artifact integrity check failed",
          { status: 502, code: "CONSUMER_LAB_ARTIFACT_INVALID" },
        );
      }
      return parsed.data;
    },

    async getEvidenceReceipt(runId: string): Promise<EvidenceReceiptV1> {
      const result = await request<unknown>(`/runs/${encodeURIComponent(runId)}/receipt`);
      const parsed = EvidenceReceiptV1Schema.safeParse(result);
      if (!parsed.success || parsed.data.runId !== runId) {
        throw new ProoflineClientError(
          "Proofline returned an invalid evidence receipt contract",
          { status: 502, code: "EVIDENCE_RECEIPT_INVALID" },
        );
      }
      return parsed.data;
    },

    async createShare(runId: string, idempotencyKey: string): Promise<ShareLinkV1> {
      const result = await request<unknown>(`/runs/${encodeURIComponent(runId)}/share`, {
        method: "POST",
        body: {},
        idempotencyKey,
      });
      const parsed = ShareLinkV1Schema.safeParse(result);
      let returnedOrigin: string | undefined;
      if (parsed.success) {
        try {
          returnedOrigin = new URL(parsed.data.url).origin;
        } catch {
          returnedOrigin = undefined;
        }
      }
      if (
        !parsed.success ||
        parsed.data.runId !== runId ||
        (normalizedExpectedWebOrigin !== undefined &&
          returnedOrigin !== normalizedExpectedWebOrigin)
      ) {
        throw new ProoflineClientError(
          "Proofline returned an invalid share-link contract",
          { status: 502, code: "SHARE_LINK_INVALID" },
        );
      }
      return parsed.data;
    },

    async events(runId: string, after: number) {
      const result = await request<{ events: unknown[]; nextAfter: number }>(
        `/runs/${encodeURIComponent(runId)}/events?after=${after}`,
      );
      if (Number.isSafeInteger(result.nextAfter) && result.nextAfter >= after) {
        safeStorageSet(storage, LAST_RUN_KEY, runId);
        safeStorageSet(storage, sequenceKey(runId), String(result.nextAfter));
      }
      return result;
    },

    confirmSubmission,

    async prepareSubmission(runId: string, idempotencyKey: string) {
      const result = await confirmSubmission(
        runId,
        "wallet",
        idempotencyKey,
      );
      if (result.mode !== "wallet") {
        throw new ProoflineClientError(
          "Proofline returned an invalid wallet submission response",
          { status: 502, code: "SUBMISSION_RESPONSE_INVALID" },
        );
      }
      return result.transaction;
    },

    attachTransaction(
      runId: string,
      transaction: { transactionHash: string },
      idempotencyKey: string,
    ) {
      return request<{ accepted: boolean }>(
        `/runs/${encodeURIComponent(runId)}/transactions`,
        {
          method: "POST",
          body: { transactionHash: transaction.transactionHash },
          idempotencyKey,
        },
      );
    },

    verifyConsumer(
      runId: string,
      idempotencyKey: string,
      consumer?: "canonical-vulnerable" | "canonical-safe",
    ) {
      return request<Record<string, unknown>>(
        `/runs/${encodeURIComponent(runId)}/consumer-verifications`,
        {
          method: "POST",
          body: consumer === undefined ? {} : { consumer },
          idempotencyKey,
        },
      );
    },

    generateConsumer(runId: string, idempotencyKey: string) {
      return request<{ source: string; sha256: string }>(
        `/runs/${encodeURIComponent(runId)}/artifacts/consumer`,
        { method: "POST", body: {}, idempotencyKey },
      );
    },

    bundle(runId: string) {
      return request<string>(`/runs/${encodeURIComponent(runId)}/bundle`, { raw: true });
    },

    replay(bundle: string, idempotencyKey: string) {
      try {
        JSON.parse(bundle);
      } catch {
        throw new Error("Proof bundle is not valid JSON");
      }
      return request<{ runId: string; byteIdentical: boolean }>("/replays", {
        method: "POST",
        body: { bundle },
        idempotencyKey,
      });
    },

    resume(): { runId: string; after: number } | null {
      const runId = safeStorageGet(storage, LAST_RUN_KEY);
      if (!runId) return null;
      const rawAfter = safeStorageGet(storage, sequenceKey(runId)) ?? "0";
      const after = Number(rawAfter);
      return {
        runId,
        after: Number.isSafeInteger(after) && after >= 0 ? after : 0,
      };
    },
  };
}

export function submitWithEip1193(input: {
  runId: string;
  idempotencyKey: string;
  provider: Eip1193Provider;
  client: Pick<RunClient, "prepareSubmission" | "attachTransaction">;
  networkCapability?: NetworkCapabilityV1;
  recoveryStorage?: RecoveryStoragePort;
}): Promise<{ transactionHash: string }> {
  const parsedCapability = NetworkCapabilityV1Schema.safeParse(
    input.networkCapability ?? NETWORK_CAPABILITIES_V1.networks[0],
  );
  if (
    !parsedCapability.success ||
    parsedCapability.data.web2JsonStatus !== "enabled"
  ) {
    return Promise.reject(
      new ProoflineClientError("Web2Json is unavailable on this network", {
        status: 409,
        code: "NETWORK_CAPABILITY_DISABLED",
      }),
    );
  }
  const expectedChainId = parsedCapability.data.wallet.chainIdHex.toLowerCase();
  const flightKey = `${input.runId}\u0000${input.idempotencyKey}`;
  const existingFlight = walletSubmissionFlights.get(flightKey);
  if (existingFlight) return existingFlight;

  const operation = (async () => {
    const recoveryStorage = availableRecoveryStorage(
      input.recoveryStorage,
      input.client,
    );
    const recoveryKey = walletRecoveryKey(input.runId, input.idempotencyKey);
    const recoveredHash = recoveryStorage.getItem(recoveryKey);
    if (recoveredHash !== null) {
      if (recoveredHash === WALLET_BROADCAST_PENDING) {
        throw new Error(
          "Wallet broadcast recovery is ambiguous; refusing to rebroadcast",
        );
      }
      if (!TRANSACTION_HASH.test(recoveredHash)) {
        recoveryStorage.removeItem(recoveryKey);
      } else {
        await input.client.attachTransaction(
          input.runId,
          { transactionHash: recoveredHash },
          input.idempotencyKey,
        );
        return { transactionHash: recoveredHash };
      }
    }

    const transaction = await input.client.prepareSubmission(
      input.runId,
      input.idempotencyKey,
    );
    if (transaction.chainId.toLowerCase() !== expectedChainId) {
      throw new Error("Wallet submission was prepared for a network other than Coston2");
    }

    proveRecoveryStorageWritable(recoveryStorage, recoveryKey);
    let accounts: unknown;
    try {
      await input.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expectedChainId }],
      });
      accounts = await input.provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
        throw new Error("The wallet did not return an account");
      }
    } catch (cause) {
      clearPendingWalletMarker(recoveryStorage, recoveryKey);
      throw cause;
    }

    let transactionHash: unknown;
    try {
      transactionHash = await input.provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            ...transaction,
            chainId: expectedChainId,
            from: (accounts as string[])[0],
          },
        ],
      });
    } catch (cause) {
      if (isUserRejectedProviderRequest(cause)) {
        clearPendingWalletMarker(recoveryStorage, recoveryKey);
      }
      throw cause;
    }
    if (typeof transactionHash !== "string" || !TRANSACTION_HASH.test(transactionHash)) {
      throw new Error("The wallet did not return a valid transaction hash");
    }

    recoveryStorage.setItem(recoveryKey, transactionHash);
    await input.client.attachTransaction(
      input.runId,
      { transactionHash },
      input.idempotencyKey,
    );
    return { transactionHash };
  })();
  walletSubmissionFlights.set(flightKey, operation);
  void operation.finally(() => {
    if (walletSubmissionFlights.get(flightKey) === operation) {
      walletSubmissionFlights.delete(flightKey);
    }
  }).catch(() => undefined);
  return operation;
}
