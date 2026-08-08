import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { createProoflineApi } from "./app";
import { digestOpaqueToken } from "./postgres";
import { createProductionProoflineService } from "./production-service";

type Environment = Record<string, string | undefined>;

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
  const service = createProductionProoflineService({
    pool,
    tokenDigestKey,
    publicWebOrigin,
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
  return { api, pool, port: parsePort(environment.PORT) };
}

export function createNodeRequestHandler(input: {
  api: { fetch(request: Request): Promise<Response> };
  port: number;
}) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const origin = `http://${request.headers.host ?? `127.0.0.1:${input.port}`}`;
    const body: Uint8Array[] = [];
    for await (const chunk of request) body.push(chunk as Uint8Array);
    const bufferedBody = Buffer.concat(body);
    const apiResponse = await input.api.fetch(
      new Request(new URL(request.url ?? "/", origin), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body:
          request.method === "GET" ||
          request.method === "HEAD" ||
          bufferedBody.byteLength === 0
            ? undefined
            : bufferedBody,
      }),
    );
    response.writeHead(
      apiResponse.status,
      Object.fromEntries(apiResponse.headers.entries()),
    );
    response.end(Buffer.from(await apiResponse.arrayBuffer()));
  };
}

export async function startProductionApi(
  environment: Environment = process.env,
): Promise<void> {
  const production = createProductionApi({ environment });
  const server = createServer(
    createNodeRequestHandler({
      api: production.api,
      port: production.port,
    }),
  );
  server.listen(production.port, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void production.pool.end().finally(() => process.exit(0));
      });
    });
  }
}
