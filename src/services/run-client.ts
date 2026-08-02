import type {
  CreateRunResultV1,
  PreflightReportV1,
  RunListPageV1,
  Web2JsonManifestV1,
} from "../../packages/contracts/src";
import {
  CreateRunResultV1Schema,
  PreflightReportV1Schema,
} from "../../packages/contracts/src";

const LAST_RUN_KEY = "proofline:last-run";
const COSTON2_CHAIN_ID = "0x72";
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type FetchPort = typeof globalThis.fetch;

export type WalletTransaction = {
  chainId: "0x72";
  from?: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
};

export type Eip1193Provider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type RunClient = ReturnType<typeof createRunClient>;

export class ProoflineClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, input: { status: number; code: string }) {
    super(message);
    this.name = "ProoflineClientError";
    this.status = input.status;
    this.code = input.code;
  }
}

function trimBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function sequenceKey(runId: string): string {
  return `proofline:${runId}:after`;
}

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
  return new ProoflineClientError(
    redact(`Proofline API ${response.status}: ${detail}`, projectToken),
    { status: response.status, code: safeErrorCode(code, response.status) },
  );
}

export function createRunClient(input: {
  baseUrl: string;
  projectToken: string;
  fetch?: FetchPort;
  storage?: StoragePort;
}) {
  const baseUrl = trimBaseUrl(input.baseUrl);
  const fetchPort = input.fetch ?? globalThis.fetch.bind(globalThis);
  const storage = input.storage ?? globalThis.localStorage;

  async function request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      raw?: boolean;
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
    if (!response.ok) throw await responseError(response, input.projectToken);
    if (options.raw) return (await response.text()) as T;
    return (await response.json()) as T;
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

    async prepareSubmission(runId: string, idempotencyKey: string) {
      const result = await request<
        WalletTransaction | { mode: "wallet"; transaction: WalletTransaction }
      >(
        `/runs/${encodeURIComponent(runId)}/submissions`,
        {
          method: "POST",
          body: { mode: "wallet" },
          idempotencyKey,
        },
      );
      return "transaction" in result ? result.transaction : result;
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

export async function submitWithEip1193(input: {
  runId: string;
  idempotencyKey: string;
  provider: Eip1193Provider;
  client: Pick<RunClient, "prepareSubmission" | "attachTransaction">;
}) {
  const transaction = await input.client.prepareSubmission(
    input.runId,
    input.idempotencyKey,
  );
  if (transaction.chainId.toLowerCase() !== COSTON2_CHAIN_ID) {
    throw new Error("Wallet submission was prepared for a network other than Coston2");
  }

  await input.provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: COSTON2_CHAIN_ID }],
  });
  const accounts = await input.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("The wallet did not return an account");
  }

  const transactionHash = await input.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        ...transaction,
        chainId: COSTON2_CHAIN_ID,
        from: accounts[0],
      },
    ],
  });
  if (typeof transactionHash !== "string" || !TRANSACTION_HASH.test(transactionHash)) {
    throw new Error("The wallet did not return a valid transaction hash");
  }

  await input.client.attachTransaction(
    input.runId,
    { transactionHash },
    input.idempotencyKey,
  );
  return { transactionHash };
}
