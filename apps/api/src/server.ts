import { createServer } from "node:http";
import { Pool } from "pg";
import { createProoflineApi } from "./app";
import { digestOpaqueToken } from "./postgres";
import { createProductionProoflineService } from "./production-service";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const pool = new Pool({
  connectionString: required("DATABASE_URL"),
  max: Number(process.env.PROOFLINE_API_DB_POOL_SIZE ?? 10),
  idleTimeoutMillis: 30_000,
});
const tokenDigestKey = required("PROOFLINE_TOKEN_DIGEST_KEY");
const service = createProductionProoflineService({
  pool,
  tokenDigestKey,
  publicWebOrigin: process.env.PROOFLINE_WEB_ORIGIN ?? "https://proofline.example",
});
const api = createProoflineApi({
  service,
  async authenticate(rawToken) {
    const digest = digestOpaqueToken(rawToken, tokenDigestKey);
    const result = await pool.query(
      `SELECT 'project' AS kind, project_id, NULL::uuid AS run_id
       FROM proofline_private.api_tokens
       WHERE token_digest = $1 AND revoked_at IS NULL
       UNION ALL
       SELECT 'share' AS kind, project_id, run_id
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
      : { kind: "project" as const, projectId: String(row.project_id) };
  },
});

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}

const server = createServer(async (request, response) => {
  const origin = `http://${request.headers.host ?? `127.0.0.1:${port}`}`;
  const body: Uint8Array[] = [];
  for await (const chunk of request) body.push(chunk as Uint8Array);
  const apiResponse = await api.fetch(
    new Request(new URL(request.url ?? "/", origin), {
      method: request.method,
      headers: request.headers as HeadersInit,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : Buffer.concat(body),
    }),
  );
  response.writeHead(
    apiResponse.status,
    Object.fromEntries(apiResponse.headers.entries()),
  );
  response.end(Buffer.from(await apiResponse.arrayBuffer()));
});

server.listen(port, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
