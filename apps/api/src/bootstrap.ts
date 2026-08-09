import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { createProoflineApi } from "./app";
import { digestOpaqueToken } from "./postgres";
import { createProductionProoflineService } from "./production-service";

type Environment = Record<string, string | undefined>;

export interface ApiQuotaPolicy {
  walletChallengeAddressPerMinute: number;
  walletChallengeGlobalPerMinute: number;
  projectRunsPerUtcDay: number;
  projectActiveLiveRuns: number;
}

const DEFAULT_API_QUOTA_POLICY: Readonly<ApiQuotaPolicy> = Object.freeze({
  walletChallengeAddressPerMinute: 5,
  walletChallengeGlobalPerMinute: 300,
  projectRunsPerUtcDay: 100,
  projectActiveLiveRuns: 3,
});

const PUBLIC_AUTH_BODY_LIMIT_BYTES = 8 * 1_024;
const PUBLIC_AUTH_BODY_DEADLINE_MS = 10_000;
const PUBLIC_AUTH_PATHS = new Set([
  "/v1/auth/wallet/challenges",
  "/v1/auth/wallet/sessions",
]);

type DirectAuthRejection = Readonly<{
  status: number;
  code: string;
}>;

const AUTH_ORIGIN_FORBIDDEN: DirectAuthRejection = {
  status: 403,
  code: "AUTH_ORIGIN_FORBIDDEN",
};
const UNSUPPORTED_CONTENT_ENCODING: DirectAuthRejection = {
  status: 415,
  code: "UNSUPPORTED_CONTENT_ENCODING",
};
const INVALID_REQUEST_BODY: DirectAuthRejection = {
  status: 400,
  code: "INVALID_REQUEST_BODY",
};
const REQUEST_BODY_TOO_LARGE: DirectAuthRejection = {
  status: 413,
  code: "REQUEST_BODY_TOO_LARGE",
};
const REQUEST_BODY_TIMEOUT: DirectAuthRejection = {
  status: 408,
  code: "REQUEST_BODY_TIMEOUT",
};

class AuthBodyReadError extends Error {
  constructor(readonly rejection: DirectAuthRejection) {
    super(rejection.code);
    this.name = "AuthBodyReadError";
  }
}

const QUOTA_ENVIRONMENT = {
  walletChallengeAddressPerMinute: {
    name: "PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT",
    maximum: 60,
  },
  walletChallengeGlobalPerMinute: {
    name: "PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT",
    maximum: 10_000,
  },
  projectRunsPerUtcDay: {
    name: "PROOFLINE_PROJECT_RUN_DAILY_LIMIT",
    maximum: 10_000,
  },
  projectActiveLiveRuns: {
    name: "PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT",
    maximum: 100,
  },
} as const;

function boundedCanonicalLimit(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} quota limit must be a canonical positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} quota limit must be between 1 and ${maximum}`);
  }
  return parsed;
}

export function parseApiQuotaPolicy(environment: Environment): ApiQuotaPolicy {
  const policy: ApiQuotaPolicy = {
    walletChallengeAddressPerMinute: boundedCanonicalLimit(
      environment[QUOTA_ENVIRONMENT.walletChallengeAddressPerMinute.name],
      DEFAULT_API_QUOTA_POLICY.walletChallengeAddressPerMinute,
      QUOTA_ENVIRONMENT.walletChallengeAddressPerMinute.name,
      QUOTA_ENVIRONMENT.walletChallengeAddressPerMinute.maximum,
    ),
    walletChallengeGlobalPerMinute: boundedCanonicalLimit(
      environment[QUOTA_ENVIRONMENT.walletChallengeGlobalPerMinute.name],
      DEFAULT_API_QUOTA_POLICY.walletChallengeGlobalPerMinute,
      QUOTA_ENVIRONMENT.walletChallengeGlobalPerMinute.name,
      QUOTA_ENVIRONMENT.walletChallengeGlobalPerMinute.maximum,
    ),
    projectRunsPerUtcDay: boundedCanonicalLimit(
      environment[QUOTA_ENVIRONMENT.projectRunsPerUtcDay.name],
      DEFAULT_API_QUOTA_POLICY.projectRunsPerUtcDay,
      QUOTA_ENVIRONMENT.projectRunsPerUtcDay.name,
      QUOTA_ENVIRONMENT.projectRunsPerUtcDay.maximum,
    ),
    projectActiveLiveRuns: boundedCanonicalLimit(
      environment[QUOTA_ENVIRONMENT.projectActiveLiveRuns.name],
      DEFAULT_API_QUOTA_POLICY.projectActiveLiveRuns,
      QUOTA_ENVIRONMENT.projectActiveLiveRuns.name,
      QUOTA_ENVIRONMENT.projectActiveLiveRuns.maximum,
    ),
  };
  if (
    policy.walletChallengeGlobalPerMinute <
    policy.walletChallengeAddressPerMinute
  ) {
    throw new Error(
      "Global wallet challenge quota limit must be at least the address limit",
    );
  }
  return policy;
}

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function createProductionApi(input: {
  environment: Environment;
  pool?: Pool;
}) {
  const environment = input.environment;
  const pool =
    input.pool ??
    new Pool({
      connectionString: required(environment, "DATABASE_URL"),
      max: Number(environment.PROOFLINE_API_DB_POOL_SIZE ?? 10),
      idleTimeoutMillis: 30_000,
    });
  const tokenDigestKey = required(environment, "PROOFLINE_TOKEN_DIGEST_KEY");
  const publicWebOrigin = required(environment, "PROOFLINE_WEB_ORIGIN");
  const quotaPolicy = parseApiQuotaPolicy(environment);
  const service = createProductionProoflineService({
    pool,
    tokenDigestKey,
    publicWebOrigin,
    quotaPolicy,
  });
  const api = createProoflineApi({
    service,
    publicWebOrigin,
    async authenticate(rawToken) {
      const digest = digestOpaqueToken(rawToken, tokenDigestKey);
      const result = await pool.query(
        `SELECT 'project' AS kind, project_id, NULL::uuid AS run_id,
                kind AS credential_kind, id AS token_id, wallet_identity_id
         FROM proofline_private.api_tokens
         WHERE token_digest = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         UNION ALL
         SELECT 'share' AS kind, project_id, run_id,
                NULL::text AS credential_kind, NULL::uuid AS token_id,
                NULL::uuid AS wallet_identity_id
         FROM proofline_private.share_tokens
         WHERE token_digest = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
         LIMIT 1`,
        [digest],
      );
      const row = result.rows[0];
      if (!row) return null;
      return row.kind === "share"
        ? {
            kind: "share" as const,
            projectId: String(row.project_id),
            runId: String(row.run_id),
          }
        : {
            kind: "project" as const,
            projectId: String(row.project_id),
            ...(row.credential_kind === "browser" ||
            row.credential_kind === "cli" ||
            row.credential_kind === "action" ||
            row.credential_kind === "legacy"
              ? { credentialKind: row.credential_kind }
              : {}),
            ...(row.credential_kind === "browser" &&
            row.token_id !== null &&
            row.wallet_identity_id !== null
              ? {
                  tokenId: String(row.token_id),
                  walletIdentityId: String(row.wallet_identity_id),
                }
              : {}),
          };
    },
  });
  return {
    api,
    pool,
    port: parsePort(environment.PORT),
    publicWebOrigin: new URL(publicWebOrigin).origin,
  };
}

function configuredNodeUrl(
  requestTarget: string | undefined,
  port: number,
): URL {
  const base = new URL(`http://127.0.0.1:${port}`);
  const parsed = new URL(requestTarget ?? "/", base);
  return new URL(`${parsed.pathname}${parsed.search}`, base);
}

function legacyNodeUrl(
  request: IncomingMessage,
  port: number,
): URL {
  const origin = `http://${request.headers.host ?? `127.0.0.1:${port}`}`;
  return new URL(request.url ?? "/", origin);
}

function isPublicAuthPost(request: IncomingMessage, url: URL): boolean {
  return request.method === "POST" && PUBLIC_AUTH_PATHS.has(url.pathname);
}

function privateCorsHeaders(
  request: IncomingMessage,
  publicWebOrigin: string,
): Record<string, string> {
  return request.headers.origin === publicWebOrigin
    ? {
        "access-control-allow-origin": publicWebOrigin,
        vary: "Origin",
      }
    : {};
}

function directAuthRejection(
  request: IncomingMessage,
  response: ServerResponse,
  publicWebOrigin: string,
  rejection: DirectAuthRejection,
): void {
  const closeConnection = () => {
    if (request.socket && !request.socket.destroyed) {
      request.socket.end();
    } else if (!request.destroyed) {
      request.destroy();
    }
  };
  if (
    request.aborted ||
    response.destroyed ||
    response.writableEnded
  ) {
    closeConnection();
    return;
  }

  const body = Buffer.from(JSON.stringify({
    version: "1",
    error: { code: rejection.code, message: "Request rejected" },
  }));
  response.writeHead(rejection.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    connection: "close",
    ...privateCorsHeaders(request, publicWebOrigin),
  });

  if (typeof response.once === "function") {
    response.once("finish", closeConnection);
    response.once("close", closeConnection);
    response.end(body);
  } else {
    response.end(body);
    closeConnection();
  }
}

function authHeaderRejection(
  request: IncomingMessage,
  publicWebOrigin: string,
): DirectAuthRejection | null {
  if (request.headers.origin !== publicWebOrigin) {
    return AUTH_ORIGIN_FORBIDDEN;
  }
  if (request.headers["content-encoding"] !== undefined) {
    return UNSUPPORTED_CONTENT_ENCODING;
  }

  const transferEncoding = request.headers["transfer-encoding"];
  if (
    transferEncoding !== undefined &&
    (Array.isArray(transferEncoding) ||
      transferEncoding.toLowerCase() !== "chunked")
  ) {
    return INVALID_REQUEST_BODY;
  }

  const contentLength = request.headers["content-length"];
  if (
    contentLength !== undefined &&
    (Array.isArray(contentLength) ||
      BigInt(contentLength) > BigInt(PUBLIC_AUTH_BODY_LIMIT_BYTES))
  ) {
    return REQUEST_BODY_TOO_LARGE;
  }
  return null;
}

async function readBoundedAuthBody(
  request: IncomingMessage,
  deadlineAt: number,
): Promise<Buffer> {
  const iterator = request[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const remainingMs = deadlineAt - performance.now();
    if (remainingMs <= 0) {
      throw new AuthBodyReadError(REQUEST_BODY_TIMEOUT);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), remainingMs);
    });
    const next = Promise.resolve(iterator.next()).then(
      (result) => ({ kind: "next" as const, result }),
      (cause) => ({ kind: "error" as const, cause }),
    );
    const outcome = await Promise.race([next, timeout]);
    if (timer !== undefined) clearTimeout(timer);

    if (outcome.kind === "timeout") {
      throw new AuthBodyReadError(REQUEST_BODY_TIMEOUT);
    }
    if (outcome.kind === "error") throw outcome.cause;
    if (outcome.result.done) break;

    const chunk = outcome.result.value as Uint8Array;
    totalBytes += chunk.byteLength;
    if (totalBytes > PUBLIC_AUTH_BODY_LIMIT_BYTES) {
      throw new AuthBodyReadError(REQUEST_BODY_TOO_LARGE);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

export function createNodeRequestHandler(input: {
  api: { fetch(request: Request): Promise<Response> };
  port: number;
  publicWebOrigin?: string;
  authBodyDeadlineMs?: number;
}) {
  if (input.publicWebOrigin === undefined && process.env.NODE_ENV !== "test") {
    throw new Error("publicWebOrigin is required for the production Node bridge");
  }
  if (
    input.authBodyDeadlineMs !== undefined &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new Error("The auth body deadline is fixed in production");
  }
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const deadlineAt =
      performance.now() +
      (input.authBodyDeadlineMs ?? PUBLIC_AUTH_BODY_DEADLINE_MS);
    const url = input.publicWebOrigin === undefined
      ? legacyNodeUrl(request, input.port)
      : configuredNodeUrl(request.url, input.port);
    const guardedAuth =
      input.publicWebOrigin !== undefined && isPublicAuthPost(request, url);

    if (guardedAuth) {
      const rejection = authHeaderRejection(request, input.publicWebOrigin!);
      if (rejection !== null) {
        directAuthRejection(
          request,
          response,
          input.publicWebOrigin!,
          rejection,
        );
        return;
      }
    }

    if (request.headers.expect?.toLowerCase() === "100-continue") {
      response.writeContinue();
    }

    const body: Uint8Array[] = [];
    let bufferedBody: Buffer;
    try {
      if (guardedAuth) {
        bufferedBody = await readBoundedAuthBody(request, deadlineAt);
      } else {
        for await (const chunk of request) body.push(chunk as Uint8Array);
        bufferedBody = Buffer.concat(body);
      }
    } catch (cause) {
      if (!guardedAuth) throw cause;
      directAuthRejection(
        request,
        response,
        input.publicWebOrigin!,
        cause instanceof AuthBodyReadError
          ? cause.rejection
          : INVALID_REQUEST_BODY,
      );
      return;
    }

    const apiResponse = await input.api.fetch(
      new Request(url, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body:
          request.method === "GET" ||
          request.method === "HEAD" ||
          bufferedBody.byteLength === 0
            ? undefined
            : new Uint8Array(bufferedBody),
      }),
    );
    response.writeHead(
      apiResponse.status,
      Object.fromEntries(apiResponse.headers.entries()),
    );
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
  };
}

export function createProductionNodeServer(input: {
  api: { fetch(request: Request): Promise<Response> };
  port: number;
  publicWebOrigin: string;
}): Server {
  const server = createServer();
  const handler = createNodeRequestHandler(input);
  server.on("request", handler);
  server.on("checkContinue", handler);
  return server;
}

export async function startProductionApi(
  environment: Environment = process.env,
): Promise<void> {
  const production = createProductionApi({ environment });
  const server = createProductionNodeServer({
    api: production.api,
    port: production.port,
    publicWebOrigin: production.publicWebOrigin,
  });
  server.listen(production.port, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void production.pool.end().finally(() => process.exit(0));
      });
    });
  }
}
