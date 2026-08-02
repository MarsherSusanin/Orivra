import {
  SubmissionRequestV1Schema,
  Web2JsonManifestV1Schema,
} from "@proofline/contracts";
import { z } from "zod";

type AuthContext =
  | { kind: "project"; projectId: string }
  | { kind: "share"; projectId: string; runId: string };

interface ProoflineApiService {
  [method: string]: (...args: any[]) => Promise<any>;
}

const TOKEN_PATTERN = /^(?:project|share)_[a-f0-9]{64}$/i;
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
}) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const token = bearer(request);
      if (!token || !TOKEN_PATTERN.test(token)) {
        return error(401, "UNAUTHORIZED", "A valid opaque bearer token is required");
      }

      const auth = await input.authenticate(token);
      if (!auth) return error(401, "UNAUTHORIZED", "Bearer token is not authorized");

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
          return json(await input.service.createShare(context), 201);
        }
        return error(404, "NOT_FOUND", "Route not found");
      } catch (cause) {
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
        return error(
          Number.isInteger(status) && status >= 400 && status < 600 ? status : 500,
          /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(causeCode)
            ? causeCode
            : "REQUEST_FAILED",
          status === 500 ? "Request could not be completed" : "Request rejected",
        );
      }
    },
  };
}
