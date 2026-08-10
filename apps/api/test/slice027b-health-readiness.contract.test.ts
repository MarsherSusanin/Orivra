// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";

const DEPLOYMENT_ID = `deployment_${"a".repeat(64)}`;
const TREE = "b".repeat(40);
const HEALTH_BYTES = '{"version":"1","status":"ok"}';
const READY_BYTES = '{"version":"1","status":"ready","checks":{"database":"ready","schema":"ready","worker":"ready"}}';

function request(path: string, input: {
  method?: string;
  authorization?: string;
  origin?: string;
} = {}) {
  const headers = new Headers();
  if (input.authorization) headers.set("authorization", input.authorization);
  if (input.origin) headers.set("origin", input.origin);
  return new Request(`https://api.proofline.test${path}`, {
    method: input.method ?? "GET",
    headers,
  });
}

function harness(check = vi.fn(async () => ({
  version: "1",
  status: "ready",
  checks: { database: "ready", schema: "ready", worker: "ready" },
}))) {
  const service = new Proxy({}, {
    get: () => vi.fn(() => {
      throw new Error("service must be unreachable");
    }),
  }) as Record<string, any>;
  const authenticate = vi.fn(async () => {
    throw new Error("auth must be unreachable");
  });
  return {
    check,
    authenticate,
    api: createProoflineApi({
      service,
      authenticate,
      publicWebOrigin: "https://proofline.example",
      deploymentReadiness: { check },
    } as any),
  };
}

function expectOperationalHeaders(response: Response, byteLength: number) {
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("content-length")).toBe(String(byteLength));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  for (const name of [
    "etag",
    "access-control-allow-origin",
    "vary",
    "www-authenticate",
  ]) expect(response.headers.get(name)).toBeNull();
}

async function readinessModule(): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL("../src/deployment-readiness.ts", import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

describe("Slice 027B anonymous health and readiness HTTP boundary", () => {
  it("serves exact process-only health bytes before bearer, CORS, readiness and service I/O", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request("/healthz", {
      authorization: "Bearer hostile-secret",
      origin: "https://proofline.example",
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HEALTH_BYTES);
    expectOperationalHeaders(response, Buffer.byteLength(HEALTH_BYTES));
    expect(fixture.check).not.toHaveBeenCalled();
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it("serves exact ready bytes after one bounded readiness check without auth/service", async () => {
    const fixture = harness();
    const response = await fixture.api.fetch(request("/readyz", {
      authorization: `Bearer project_${"c".repeat(64)}`,
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(READY_BYTES);
    expectOperationalHeaders(response, Buffer.byteLength(READY_BYTES));
    expect(fixture.check).toHaveBeenCalledOnce();
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "database unavailable",
      { database: "unavailable", schema: "unavailable", worker: "unavailable" },
    ],
    [
      "schema mismatch",
      { database: "ready", schema: "mismatch", worker: "unavailable" },
    ],
    [
      "worker missing",
      { database: "ready", schema: "ready", worker: "missing" },
    ],
    [
      "worker stale",
      { database: "ready", schema: "ready", worker: "stale" },
    ],
  ] as const)("returns one exact bounded 503 for %s", async (_label, checks) => {
    const fixture = harness(vi.fn(async () => ({
      version: "1",
      status: "not-ready",
      checks,
    })));
    const expected = JSON.stringify({ version: "1", status: "not-ready", checks });
    const response = await fixture.api.fetch(request("/readyz"));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(expected);
    expectOperationalHeaders(response, Buffer.byteLength(expected));
    expect(fixture.authenticate).not.toHaveBeenCalled();
  });

  it("normalizes a private PostgreSQL failure to all-unavailable without cause leakage", async () => {
    const raw = "postgres://secret@db.invalid/proofline /tmp/private.sock";
    const fixture = harness(vi.fn(async () => {
      throw new Error(raw);
    }));
    const response = await fixture.api.fetch(request("/readyz"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      version: "1",
      status: "not-ready",
      checks: {
        database: "unavailable",
        schema: "unavailable",
        worker: "unavailable",
      },
    });
    expect(text).not.toContain(raw);
    expectOperationalHeaders(response, Buffer.byteLength(text));
  });

  it.each(["HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])(
    "returns bounded 405 and Allow GET for %s without CORS or authority I/O",
    async (method) => {
      for (const path of ["/healthz", "/readyz"]) {
        const fixture = harness();
        const response = await fixture.api.fetch(request(path, {
          method,
          origin: "https://proofline.example",
        }));
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET");
        expect(await response.json()).toEqual({
          version: "1",
          error: { code: "METHOD_NOT_ALLOWED", message: "Request rejected" },
        });
        expectOperationalHeaders(
          response,
          Number(response.headers.get("content-length")),
        );
        expect(fixture.check).not.toHaveBeenCalled();
        expect(fixture.authenticate).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["/healthz?full=1", "/readyz?worker=true"])(
    "treats query variant as bounded 404: %s",
    async (path) => {
      const fixture = harness();
      const response = await fixture.api.fetch(request(path));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        version: "1",
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
      expectOperationalHeaders(
        response,
        Number(response.headers.get("content-length")),
      );
      expect(fixture.check).not.toHaveBeenCalled();
      expect(fixture.authenticate).not.toHaveBeenCalled();
    },
  );
});

describe("Slice 027B PostgreSQL readiness and startup schema gate", () => {
  it("binds exact deployment/tree and classifies a current DB-clock worker row", async () => {
    const module = await readinessModule();
    expect(module.createPostgresDeploymentReadiness).toBeTypeOf("function");
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        schema_version: 10,
        checksum_count: 10,
        checksum_match: true,
        worker_state: "ready",
      }],
    }));
    const readiness = module.createPostgresDeploymentReadiness({
      pool: { query },
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
    });
    await expect(readiness.check()).resolves.toEqual({
      version: "1",
      status: "ready",
      checks: { database: "ready", schema: "ready", worker: "ready" },
    });
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/migration_checksums/);
    expect(sql).toMatch(/deployment_worker_heartbeats/);
    expect(sql).toMatch(/clock_timestamp\(\)/);
    expect(sql).toMatch(/interval\s+'30 seconds'/i);
    expect(values).toEqual([DEPLOYMENT_ID, TREE, 10]);
  });

  it.each([
    ["missing", null, "missing"],
    ["stale", "stale", "stale"],
    ["wrong release", "missing", "missing"],
  ] as const)("keeps exact schema ready but reports worker %s", async (_label, rowState, expected) => {
    const module = await readinessModule();
    expect(module.createPostgresDeploymentReadiness).toBeTypeOf("function");
    const readiness = module.createPostgresDeploymentReadiness({
      pool: { query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{
          schema_version: 10,
          checksum_count: 10,
          checksum_match: true,
          worker_state: rowState,
        }],
      })) },
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
    });
    await expect(readiness.check()).resolves.toEqual({
      version: "1",
      status: "not-ready",
      checks: { database: "ready", schema: "ready", worker: expected },
    });
  });

  it("validates schema before API listen and worker claims, with no implicit migration", async () => {
    const [apiSource, workerSource] = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../../worker/src/bootstrap.ts", import.meta.url), "utf8"),
    ]);
    const apiGate = apiSource.indexOf("verifyDeploymentSchema");
    const apiListen = apiSource.indexOf("server.listen");
    expect(apiGate).toBeGreaterThanOrEqual(0);
    expect(apiListen).toBeGreaterThan(apiGate);
    const workerGate = workerSource.indexOf("verifyDeploymentSchema");
    const workerComposition = workerSource.indexOf("createProductionWorker");
    expect(workerGate).toBeGreaterThanOrEqual(0);
    expect(workerComposition).toBeGreaterThan(workerGate);
    expect(`${apiSource}\n${workerSource}`).not.toMatch(/runProductionMigrations|db:bootstrap-roles/);
  });
});
