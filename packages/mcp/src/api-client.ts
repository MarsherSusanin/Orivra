import { setTimeout as sleep } from "node:timers/promises";
import type { z } from "zod";
import type { OrivraMcpConfiguration } from "./config";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
export const LARGE_RESOURCE_MAX_BYTES = 2_400_000;

export type McpErrorType =
  | "invalid_arguments"
  | "unauthorized"
  | "not_found"
  | "pending"
  | "conflict"
  | "timeout"
  | "upstream_error";

export class OrivraMcpError extends Error {
  readonly type: McpErrorType;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(type: McpErrorType, message: string, options: {
    status?: number;
    retryAfterSeconds?: number;
  } = {}) {
    super(message);
    this.name = "OrivraMcpError";
    this.type = type;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function safeMcpErrorMessage(error: unknown, projectToken: string): string {
  const raw = error instanceof Error ? error.message : "Orivra request failed";
  const withoutExactToken = projectToken.length > 0
    ? raw.split(projectToken).join("[REDACTED]")
    : raw;
  const redacted = withoutExactToken
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:project|share)_[A-Za-z0-9_-]{16,}/gi, "[REDACTED]")
    .replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED]");
  const encoded = new TextEncoder();
  if (encoded.encode(redacted).byteLength <= 480) return redacted;
  let bounded = redacted;
  while (bounded.length > 0 && encoded.encode(`${bounded}…`).byteLength > 480) {
    bounded = bounded.slice(0, -1);
  }
  return `${bounded}…`;
}

function errorType(status: number, code: string | undefined): McpErrorType {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409 && /PENDING|NOT_READY/.test(code ?? "")) return "pending";
  if (status === 409 || status === 429) return "conflict";
  if (status >= 400 && status < 500) return "invalid_arguments";
  return "upstream_error";
}

async function readBounded(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw new OrivraMcpError("upstream_error", "Orivra response exceeded the allowed size");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new OrivraMcpError("upstream_error", "Orivra response exceeded the allowed size");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new OrivraMcpError("upstream_error", "Orivra returned invalid UTF-8");
  }
}

function parseErrorEnvelope(text: string): { code?: string; message?: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return {};
    const root = value as Record<string, unknown>;
    const nested = root.error && typeof root.error === "object"
      ? root.error as Record<string, unknown>
      : root;
    return {
      code: typeof nested.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(nested.code)
        ? nested.code
        : undefined,
      message: typeof nested.message === "string" ? nested.message : undefined,
    };
  } catch {
    return {};
  }
}

export function createOrivraApiClient(input: {
  configuration: OrivraMcpConfiguration;
  fetch: typeof globalThis.fetch;
}) {
  const { configuration } = input;

  async function requestText(path: string, options: {
    method?: "GET" | "POST";
    body?: unknown;
    idempotencyKey?: string;
    maxBytes?: number;
    timeoutMs?: number;
  } = {}): Promise<string> {
    if (!path.startsWith("/") || path.includes("//") || path.includes("#")) {
      throw new OrivraMcpError("invalid_arguments", "Orivra API path is invalid");
    }
    const controller = new AbortController();
    const timer = globalThis.setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await input.fetch(`${configuration.apiUrl}${path}`, {
        method: options.method ?? "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${configuration.projectToken}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.idempotencyKey === undefined
            ? {}
            : { "idempotency-key": options.idempotencyKey }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OrivraMcpError("timeout", "Orivra API request timed out");
      }
      throw new OrivraMcpError(
        "upstream_error",
        safeMcpErrorMessage(error, configuration.projectToken),
      );
    }
    let text: string;
    try {
      text = await readBounded(
        response,
        options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OrivraMcpError("timeout", "Orivra API request timed out");
      }
      if (error instanceof OrivraMcpError) throw error;
      throw new OrivraMcpError(
        "upstream_error",
        safeMcpErrorMessage(error, configuration.projectToken),
      );
    } finally {
      globalThis.clearTimeout(timer);
    }
    if (!response.ok) {
      const envelope = parseErrorEnvelope(text);
      const retryAfter = response.headers.get("retry-after");
      throw new OrivraMcpError(
        errorType(response.status, envelope.code),
        safeMcpErrorMessage(
          new Error(envelope.message ?? `Orivra API rejected the request (${response.status})`),
          configuration.projectToken,
        ),
        {
          status: response.status,
          ...(retryAfter && /^\d+$/.test(retryAfter)
            ? { retryAfterSeconds: Number(retryAfter) }
            : {}),
        },
      );
    }
    return text;
  }

  async function requestValidated<T extends z.ZodType>(
    path: string,
    schema: T,
    options: Parameters<typeof requestText>[1] = {},
  ): Promise<{ value: z.output<T>; text: string }> {
    const text = await requestText(path, options);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new OrivraMcpError("upstream_error", "Orivra returned invalid JSON");
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw new OrivraMcpError("upstream_error", "Orivra response did not match its public contract");
    }
    return { value: parsed.data, text };
  }

  return Object.freeze({ requestText, requestValidated, sleep });
}
