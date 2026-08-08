import {
  AccountTokenCreateRequestV1Schema,
  AccountTokenCreatedV1Schema,
  AccountTokenRevokedV1Schema,
  AccountV1Schema,
  NetworkCapabilitiesV1Schema,
  SubmissionRequestV1Schema,
  WalletChallengeRequestV1Schema,
  WalletChallengeV1Schema,
  WalletSessionRequestV1Schema,
  WalletSessionV1Schema,
  Web2JsonManifestV1Schema,
} from "@proofline/contracts";
import { z } from "zod";

type AuthContext =
  | {
      kind: "project";
      projectId: string;
      credentialKind?: "browser" | "cli" | "action" | "legacy";
      tokenId?: string;
      walletIdentityId?: string;
    }
  | { kind: "share"; projectId: string; runId: string };

interface ProoflineApiService {
  [method: string]: (...args: any[]) => Promise<any>;
}

const TOKEN_PATTERN = /^(?:project|share)_[a-f0-9]{64}$/i;
const PUBLIC_AUTH_BODY_LIMIT_BYTES = 8 * 1_024;
const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
} as const;
const CORS_ALLOWED_METHODS = ["GET", "POST", "DELETE"] as const;
const CORS_ALLOWED_HEADERS = [
  "accept",
  "content-type",
  "authorization",
  "idempotency-key",
] as const;
const CORS_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PRIVATE_KEY_PATTERN =
  /private.?key|seed.?phrase|mnemonic|(?:^|[_-])secret(?:$|[_-])/i;
const TransactionHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/);
const CreateRunBodySchema = z
  .object({ manifest: Web2JsonManifestV1Schema })
  .strict();
const ReplayBodySchema = z.object({ bundle: z.string().min(1).optional() }).strict();
const SubmissionBodySchema = SubmissionRequestV1Schema;
const TransactionBodySchema = z
  .object({ transactionHash: TransactionHashSchema.optional() })
  .strict();
const ConsumerVerificationBodySchema = z
  .object({
    consumer: z
      .enum(["canonical-vulnerable", "canonical-safe"])
      .optional(),
  })
  .strict();
const ConsumerArtifactBodySchema = z
  .object({
    contractName: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
  })
  .strict();
const ShareBodySchema = z
  .object({ expiresAt: z.string().datetime({ offset: true }).optional() })
  .strict();
const RunListStatusSchema = z.enum(["active", "completed", "failed"]);
const RunListCursorSchema = z
  .string()
  .min(16)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);
const RunListLimitSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine((value) => value <= 50);
const ACCOUNT_TOKEN_ISSUANCE_KEY = /^token_issue_[a-f0-9]{64}$/;
const ACCOUNT_TOKEN_PATH = /^\/v1\/account\/tokens\/(token_[a-f0-9]{32})$/;

type AccountRoute =
  | { kind: "get-account" }
  | { kind: "create-token" }
  | { kind: "revoke-token"; tokenId: string }
  | { kind: "revoke-current-session" };

function accountRoute(request: Request, url: URL): AccountRoute | null {
  if (url.search !== "") return null;
  if (request.method === "GET" && url.pathname === "/v1/account") {
    return { kind: "get-account" };
  }
  if (request.method === "POST" && url.pathname === "/v1/account/tokens") {
    return { kind: "create-token" };
  }
  if (request.method === "DELETE") {
    const token = ACCOUNT_TOKEN_PATH.exec(url.pathname);
    if (token) return { kind: "revoke-token", tokenId: token[1] };
    if (url.pathname === "/v1/auth/wallet/sessions/current") {
      return { kind: "revoke-current-session" };
    }
  }
  return null;
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ version: "1", error: { code, message } }, status);
}

function privateError(status: number, code: string, message: string): Response {
  return json(
    { version: "1", error: { code, message } },
    status,
    PRIVATE_RESPONSE_HEADERS,
  );
}

function isV1Path(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

function corsAuthorityHeaders(origin: string): Headers {
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "Location",
    vary: "Origin",
  });
}

function parseCorsRequestHeaders(value: string | null): Set<string> | null {
  if (value === null || value.trim() === "") return new Set();
  const names = value.split(",").map((item) => item.trim());
  if (names.some((name) => !CORS_HEADER_NAME.test(name))) return null;
  return new Set(names.map((name) => name.toLowerCase()));
}

function corsPreflightResponse(
  request: Request,
  url: URL,
  publicWebOrigin: string | null,
): Response | null {
  if (request.method !== "OPTIONS" || !isV1Path(url.pathname)) return null;
  const requestedMethod = request.headers
    .get("access-control-request-method")
    ?.trim()
    .toUpperCase();
  const requestedHeaders = parseCorsRequestHeaders(
    request.headers.get("access-control-request-headers"),
  );
  const allowedMethods = new Set<string>(CORS_ALLOWED_METHODS);
  const allowedHeaders = new Set<string>(CORS_ALLOWED_HEADERS);
  const allowed =
    publicWebOrigin !== null &&
    request.headers.get("origin") === publicWebOrigin &&
    requestedMethod !== undefined &&
    allowedMethods.has(requestedMethod) &&
    requestedHeaders !== null &&
    [...requestedHeaders].every((name) => allowedHeaders.has(name));
  if (!allowed) {
    return privateError(
      403,
      "CORS_PREFLIGHT_FORBIDDEN",
      "Request rejected",
    );
  }
  const headers = corsAuthorityHeaders(publicWebOrigin);
  headers.set("access-control-allow-methods", CORS_ALLOWED_METHODS.join(", "));
  headers.set("access-control-allow-headers", CORS_ALLOWED_HEADERS.join(", "));
  return new Response(null, { status: 204, headers });
}

function decorateCorsResponse(
  request: Request,
  url: URL,
  response: Response,
  publicWebOrigin: string | null,
): Response {
  if (
    publicWebOrigin === null ||
    !isV1Path(url.pathname) ||
    request.headers.get("origin") !== publicWebOrigin ||
    !(CORS_ALLOWED_METHODS as readonly string[]).includes(request.method)
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of corsAuthorityHeaders(publicWebOrigin)) {
    if (name === "vary" && headers.has("vary")) {
      const existing = headers
        .get("vary")!
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!existing.some((item) => item.toLowerCase() === "origin")) {
        headers.set("vary", [...existing, "Origin"].join(", "));
      }
    } else {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseError(
  cause: unknown,
  privateResponse = false,
): Response {
  const status =
    cause && typeof cause === "object" && "status" in cause
      ? Number((cause as { status: unknown }).status)
      : 500;
  const causeCode =
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    typeof (cause as { code?: unknown }).code === "string"
      ? String((cause as { code: string }).code)
      : "REQUEST_FAILED";
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const safeCode = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(causeCode)
    ? causeCode
    : "REQUEST_FAILED";
  const message = safeStatus === 500
    ? "Request could not be completed"
    : "Request rejected";
  return privateResponse
    ? privateError(safeStatus, safeCode, message)
    : error(safeStatus, safeCode, message);
}

function containsPrivateKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateKey);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) => PRIVATE_KEY_PATTERN.test(key) || containsPrivateKey(item),
    );
  }
  return false;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON request body must be an object");
  }
  return value as Record<string, unknown>;
}

class PublicAuthBodyTooLargeError extends Error {}

async function readPublicAuthBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("Wallet auth requires a JSON request body");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > PUBLIC_AUTH_BODY_LIMIT_BYTES) {
    throw new PublicAuthBodyTooLargeError("Wallet auth request body is too large");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(decoded);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet auth request body must be an object");
  }
  return value as Record<string, unknown>;
}

function normalizePublicWebOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public web origin must be a valid HTTPS root origin");
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Public web origin must be an HTTPS default-port root origin");
  }
  return url.origin;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match?.[1] ?? null;
}

function routeRunId(pathname: string): string | undefined {
  return /^\/v1\/runs\/([^/]+)/.exec(pathname)?.[1];
}

function isSharedRead(request: Request, pathname: string): boolean {
  return (
    request.method === "GET" &&
    (/^\/v1\/runs\/[^/]+$/.test(pathname) ||
      /^\/v1\/runs\/[^/]+\/events$/.test(pathname) ||
      /^\/v1\/runs\/[^/]+\/preflight$/.test(pathname) ||
      /^\/v1\/runs\/[^/]+\/consumer-lab$/.test(pathname) ||
      /^\/v1\/runs\/[^/]+\/receipt$/.test(pathname) ||
      /^\/v1\/runs\/[^/]+\/bundle$/.test(pathname))
  );
}

function commandBodySchema(
  method: string,
  pathname: string,
): z.ZodType<Record<string, unknown>> | undefined {
  if (method !== "POST") return undefined;
  if (pathname === "/v1/runs") return CreateRunBodySchema;
  if (pathname === "/v1/replays") return ReplayBodySchema;
  if (/^\/v1\/runs\/[^/]+\/submissions$/.test(pathname)) {
    return SubmissionBodySchema;
  }
  if (/^\/v1\/runs\/[^/]+\/transactions$/.test(pathname)) {
    return TransactionBodySchema;
  }
  if (/^\/v1\/runs\/[^/]+\/consumer-verifications$/.test(pathname)) {
    return ConsumerVerificationBodySchema;
  }
  if (/^\/v1\/runs\/[^/]+\/artifacts\/consumer$/.test(pathname)) {
    return ConsumerArtifactBodySchema;
  }
  if (/^\/v1\/runs\/[^/]+\/share$/.test(pathname)) return ShareBodySchema;
  return undefined;
}

function runListQuery(url: URL):
  | {
      status: "active" | "completed" | "failed" | undefined;
      cursor: string | undefined;
      limit: number;
    }
  | null {
  const allowed = new Set(["status", "cursor", "limit"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }

  const statusValue = url.searchParams.get("status") ?? undefined;
  const cursorValue = url.searchParams.get("cursor") ?? undefined;
  const limitValue = url.searchParams.get("limit") ?? undefined;
  const status = RunListStatusSchema.optional().safeParse(statusValue);
  const cursor = RunListCursorSchema.optional().safeParse(cursorValue);
  const limit = limitValue === undefined
    ? { success: true as const, data: 20 }
    : RunListLimitSchema.safeParse(limitValue);
  if (!status.success || !cursor.success || !limit.success) return null;
  return { status: status.data, cursor: cursor.data, limit: limit.data };
}

export function createProoflineApi(input: {
  service: ProoflineApiService;
  authenticate(rawToken: string): Promise<AuthContext | null>;
  publicWebOrigin?: string;
}) {
  const publicWebOrigin = normalizePublicWebOrigin(input.publicWebOrigin);
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const preflight = corsPreflightResponse(
        request,
        url,
        publicWebOrigin,
      );
      if (preflight) return preflight;

      const response = await (async (): Promise<Response> => {

      if (request.method === "GET" && url.pathname === "/v1/networks") {
        try {
          return json(
            NetworkCapabilitiesV1Schema.parse(
              await input.service.listNetworks({}),
            ),
          );
        } catch {
          return error(500, "REQUEST_FAILED", "Request could not be completed");
        }
      }

      const publicWalletAuthRoute =
        request.method === "POST" &&
        (url.pathname === "/v1/auth/wallet/challenges" ||
          url.pathname === "/v1/auth/wallet/sessions");
      if (publicWalletAuthRoute) {
        if (publicWebOrigin === null) {
          return privateError(
            503,
            "AUTH_CONFIGURATION_INVALID",
            "Wallet authentication is unavailable",
          );
        }
        if (request.headers.get("origin") !== publicWebOrigin) {
          return privateError(
            403,
            "AUTH_ORIGIN_FORBIDDEN",
            "Request rejected",
          );
        }

        let body: Record<string, unknown>;
        try {
          body = await readPublicAuthBody(request);
        } catch (cause) {
          return cause instanceof PublicAuthBodyTooLargeError
            ? privateError(
                413,
                "REQUEST_BODY_TOO_LARGE",
                "Request body exceeds 8192 bytes",
              )
            : privateError(
                400,
                "INVALID_JSON",
                "JSON request body must be an object",
              );
        }

        const challengeRoute =
          url.pathname === "/v1/auth/wallet/challenges";
        const parsed = challengeRoute
          ? WalletChallengeRequestV1Schema.safeParse(body)
          : WalletSessionRequestV1Schema.safeParse(body);
        if (!parsed.success) {
          return privateError(
            400,
            "INVALID_REQUEST_BODY",
            "Request body does not match the endpoint contract",
          );
        }
        try {
          const result = challengeRoute
            ? WalletChallengeV1Schema.parse(
                await input.service.createWalletChallenge(parsed.data),
              )
            : WalletSessionV1Schema.parse(
                await input.service.createWalletSession(parsed.data),
              );
          return json(result, 201, PRIVATE_RESPONSE_HEADERS);
        } catch (cause) {
          return responseError(cause, true);
        }
      }

      const accountManagementRoute = accountRoute(request, url);

      const token = bearer(request);
      if (!token || !TOKEN_PATTERN.test(token)) {
        return accountManagementRoute
          ? privateError(401, "UNAUTHORIZED", "A valid opaque bearer token is required")
          : error(401, "UNAUTHORIZED", "A valid opaque bearer token is required");
      }

      const auth = await input.authenticate(token);
      if (!auth) {
        return accountManagementRoute
          ? privateError(401, "UNAUTHORIZED", "Bearer token is not authorized")
          : error(401, "UNAUTHORIZED", "Bearer token is not authorized");
      }

      if (accountManagementRoute) {
        if (auth.kind === "share") {
          return privateError(403, "SHARE_READ_ONLY", "Request rejected");
        }
        if (
          auth.credentialKind !== "browser" ||
          typeof auth.tokenId !== "string" ||
          typeof auth.walletIdentityId !== "string"
        ) {
          return privateError(403, "ACCOUNT_SESSION_REQUIRED", "Request rejected");
        }
        try {
          if (accountManagementRoute.kind === "get-account") {
            return json(
              AccountV1Schema.parse(
                await input.service.getAccount({ projectId: auth.projectId }),
              ),
              200,
              PRIVATE_RESPONSE_HEADERS,
            );
          }
          if (accountManagementRoute.kind === "create-token") {
            const idempotencyKey = request.headers.get("idempotency-key");
            if (!idempotencyKey) {
              return privateError(
                400,
                "IDEMPOTENCY_KEY_REQUIRED",
                "Request rejected",
              );
            }
            let rawBody: Record<string, unknown>;
            try {
              rawBody = await readBody(request);
            } catch {
              return privateError(400, "INVALID_JSON", "Request rejected");
            }
            const parsed = AccountTokenCreateRequestV1Schema.safeParse(rawBody);
            if (!parsed.success) {
              return privateError(
                400,
                "INVALID_REQUEST_BODY",
                "Request rejected",
              );
            }
            if (!ACCOUNT_TOKEN_ISSUANCE_KEY.test(idempotencyKey)) {
              return privateError(
                400,
                "INVALID_IDEMPOTENCY_KEY",
                "Request rejected",
              );
            }
            return json(
              AccountTokenCreatedV1Schema.parse(
                await input.service.createAccountToken({
                  ...parsed.data,
                  projectId: auth.projectId,
                  idempotencyKey,
                }),
              ),
              201,
              PRIVATE_RESPONSE_HEADERS,
            );
          }
          if (accountManagementRoute.kind === "revoke-token") {
            return json(
              AccountTokenRevokedV1Schema.parse(
                await input.service.revokeAccountToken({
                  projectId: auth.projectId,
                  tokenId: accountManagementRoute.tokenId,
                }),
              ),
              200,
              PRIVATE_RESPONSE_HEADERS,
            );
          }
          if (
            request.body !== null ||
            request.headers.has("idempotency-key")
          ) {
            return privateError(400, "INVALID_REQUEST_BODY", "Request rejected");
          }
          const result = await input.service.revokeCurrentWalletSession({
            projectId: auth.projectId,
            tokenId: auth.tokenId,
            walletIdentityId: auth.walletIdentityId,
          });
          if (result !== undefined) {
            throw new Error("Current session revocation returned unexpected output");
          }
          return new Response(null, {
            status: 204,
            headers: PRIVATE_RESPONSE_HEADERS,
          });
        } catch (cause) {
          return responseError(cause, true);
        }
      }

      const runId = routeRunId(url.pathname);
      if (auth.kind === "share") {
        if (!isSharedRead(request, url.pathname)) {
          return error(403, "SHARE_READ_ONLY", "Share tokens are read-only");
        }
        if (runId !== auth.runId) {
          return error(403, "SHARE_RUN_SCOPE", "Share token is scoped to another run");
        }
      }

      const command = request.method === "POST";
      const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
      if (command && !idempotencyKey) {
        return error(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
      }

      let body: Record<string, unknown>;
      try {
        body = await readBody(request);
      } catch {
        return error(400, "INVALID_JSON", "JSON request body must be an object");
      }
      if (containsPrivateKey(body)) {
        return error(400, "PRIVATE_KEY_FORBIDDEN", "Private keys must remain on the client");
      }
      const bodySchema = commandBodySchema(request.method, url.pathname);
      if (bodySchema) {
        const parsed = bodySchema.safeParse(body);
        const productionRequiredFieldMissing =
          process.env.NODE_ENV !== "test" &&
          ((/^\/v1\/runs\/[^/]+\/transactions$/.test(url.pathname) &&
              !("transactionHash" in (parsed.success ? parsed.data : {}))) ||
            (url.pathname === "/v1/replays" &&
              !("bundle" in (parsed.success ? parsed.data : {}))));
        if (!parsed.success || productionRequiredFieldMissing) {
          return error(
            400,
            "INVALID_REQUEST_BODY",
            "Request body does not match the endpoint contract",
          );
        }
        body = parsed.data;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/runs" &&
        (body.manifest as { network: "coston2" | "flare" }).network === "flare"
      ) {
        return error(
          409,
          "NETWORK_CAPABILITY_DISABLED",
          "Request rejected",
        );
      }

      const projectId = auth.projectId;
      const context = { ...body, projectId, runId, idempotencyKey };
      try {
        if (request.method === "POST" && url.pathname === "/v1/runs") {
          const result = await input.service.createRun(context);
          return json(result, 202, { location: result.location });
        }
        if (request.method === "POST" && url.pathname === "/v1/replays") {
          return json(await input.service.replay(context), 201);
        }
        if (request.method === "GET" && url.pathname === "/v1/runs") {
          const query = runListQuery(url);
          if (!query) {
            return error(
              400,
              "INVALID_RUN_LIST_QUERY",
              "Run list query must contain one valid status, cursor, or limit",
            );
          }
          return json(await input.service.listRuns({ projectId, ...query }));
        }
        if (request.method === "GET" && /^\/v1\/runs\/[^/]+$/.test(url.pathname)) {
          return json(await input.service.getRun(context));
        }
        if (
          request.method === "GET" &&
          /^\/v1\/runs\/[^/]+\/preflight$/.test(url.pathname)
        ) {
          return json(await input.service.getPreflightReport(context));
        }
        if (
          request.method === "GET" &&
          /^\/v1\/runs\/[^/]+\/consumer-lab$/.test(url.pathname)
        ) {
          return json(await input.service.getConsumerLabReport(context));
        }
        if (
          request.method === "GET" &&
          /^\/v1\/runs\/[^/]+\/receipt$/.test(url.pathname)
        ) {
          return json(await input.service.getEvidenceReceipt(context));
        }
        if (
          request.method === "GET" &&
          /^\/v1\/runs\/[^/]+\/events$/.test(url.pathname)
        ) {
          const rawAfter = url.searchParams.get("after") ?? "0";
          const after = Number(rawAfter);
          if (!Number.isSafeInteger(after) || after < 0) {
            return error(400, "INVALID_EVENT_CURSOR", "after must be a non-negative integer");
          }
          return json(await input.service.listEvents({ ...context, after }));
        }
        if (
          request.method === "POST" &&
          /^\/v1\/runs\/[^/]+\/submissions$/.test(url.pathname)
        ) {
          return json(await input.service.createSubmission(context), 202);
        }
        if (
          request.method === "POST" &&
          /^\/v1\/runs\/[^/]+\/transactions$/.test(url.pathname)
        ) {
          return json(await input.service.attachTransaction(context), 202);
        }
        if (
          request.method === "POST" &&
          /^\/v1\/runs\/[^/]+\/consumer-verifications$/.test(url.pathname)
        ) {
          return json(await input.service.verifyConsumer(context), 202);
        }
        if (
          request.method === "POST" &&
          /^\/v1\/runs\/[^/]+\/artifacts\/consumer$/.test(url.pathname)
        ) {
          return json(await input.service.generateConsumer(context), 201);
        }
        if (
          request.method === "GET" &&
          /^\/v1\/runs\/[^/]+\/bundle$/.test(url.pathname)
        ) {
          return json(await input.service.getBundle(context));
        }
        if (
          request.method === "POST" &&
          /^\/v1\/runs\/[^/]+\/share$/.test(url.pathname)
        ) {
          return json(await input.service.createShare(context), 201, {
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          });
        }
        return error(404, "NOT_FOUND", "Route not found");
      } catch (cause) {
        return responseError(cause);
      }
      })();
      return decorateCorsResponse(
        request,
        url,
        response,
        publicWebOrigin,
      );
    },
  };
}
