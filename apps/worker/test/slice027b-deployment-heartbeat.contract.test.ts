// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const DEPLOYMENT_ID = `deployment_${"a".repeat(64)}`;
const TREE = "b".repeat(40);
const INSTANCE = "11111111-1111-4111-8111-111111111110";

async function optionalApiModule(name: string): Promise<Record<string, any>> {
  const path = pathToFileURL(fileURLToPath(
    new URL(`../../api/src/${name}.ts`, import.meta.url),
  )).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Slice 027B persisted production worker deployment heartbeat", () => {
  it.each([
    [{ PROOFLINE_DEPLOYMENT_ID: "deployment_bad", PROOFLINE_RELEASE_TREE_SHA: TREE }],
    [{ PROOFLINE_DEPLOYMENT_ID: DEPLOYMENT_ID.toUpperCase(), PROOFLINE_RELEASE_TREE_SHA: TREE }],
    [{ PROOFLINE_DEPLOYMENT_ID: DEPLOYMENT_ID, PROOFLINE_RELEASE_TREE_SHA: "b".repeat(39) }],
    [{ PROOFLINE_DEPLOYMENT_ID: DEPLOYMENT_ID, PROOFLINE_RELEASE_TREE_SHA: "B".repeat(40) }],
  ])("rejects malformed deployment identity before a pool or heartbeat effect", async (environment) => {
    const module = await optionalApiModule("deployment-schema");
    expect(module.parseDeploymentIdentity).toBeTypeOf("function");
    const pool = { query: vi.fn() };
    expect(() => module.parseDeploymentIdentity(environment, { pool })).toThrow(/deployment|release|configuration/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("creates one DB-clock millisecond heartbeat row only after the schema gate", async () => {
    const module = await optionalApiModule("deployment-heartbeat");
    expect(module.createPostgresDeploymentHeartbeatStore).toBeTypeOf("function");
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    });
    const store = module.createPostgresDeploymentHeartbeatStore({ pool: { query } });
    await store.start({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
      workerInstanceId: INSTANCE,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(calls[0].sql).toMatch(/INSERT INTO proofline_private\.deployment_worker_heartbeats/i);
    expect(calls[0].sql).toMatch(/date_trunc\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);
    expect(calls[0].values).toEqual([DEPLOYMENT_ID, INSTANCE, TREE]);
  });

  it("refreshes and performs one bounded seven-day cleanup transaction excluding itself", async () => {
    const module = await optionalApiModule("deployment-heartbeat");
    expect(module.createPostgresDeploymentHeartbeatStore).toBeTypeOf("function");
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rowCount: /UPDATE/i.test(sql) ? 1 : 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const store = module.createPostgresDeploymentHeartbeatStore({
      pool: { connect: vi.fn(async () => client) },
    });
    await store.refreshAndCleanup({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
      workerInstanceId: INSTANCE,
    });
    const sql = calls.join("\n");
    expect(calls.some((value) => /^\s*BEGIN/i.test(value))).toBe(true);
    expect(sql).toMatch(/UPDATE proofline_private\.deployment_worker_heartbeats/i);
    expect(sql).toMatch(/last_heartbeat_at\s*=\s*date_trunc\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);
    expect(sql).toMatch(/interval\s+'7 days'/i);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/LIMIT\s+100/i);
    expect(sql).toMatch(/worker_instance_id\s*<>|NOT\s*\([^)]*worker_instance_id/i);
    expect(calls.some((value) => /^\s*COMMIT/i.test(value))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("marks only its exact row stopped with the PostgreSQL clock on graceful shutdown", async () => {
    const module = await optionalApiModule("deployment-heartbeat");
    expect(module.createPostgresDeploymentHeartbeatStore).toBeTypeOf("function");
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    const store = module.createPostgresDeploymentHeartbeatStore({ pool: { query } });
    await store.stop({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
      workerInstanceId: INSTANCE,
    });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE proofline_private\.deployment_worker_heartbeats/i);
    expect(sql).toMatch(/stopped_at\s*=\s*date_trunc\(\s*'milliseconds'\s*,\s*clock_timestamp\(\)\s*\)/i);
    expect(sql).toMatch(/stopped_at\s+IS NULL/i);
    expect(values).toEqual([DEPLOYMENT_ID, INSTANCE, TREE]);
  });

  it("uses a fresh random startup UUID and never a run/command/lease identity", async () => {
    const module = await optionalApiModule("deployment-heartbeat");
    expect(module.createDeploymentWorkerIdentity).toBeTypeOf("function");
    const first = module.createDeploymentWorkerIdentity({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
    });
    const second = module.createDeploymentWorkerIdentity({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
    });
    expect(first).toMatchObject({ deploymentId: DEPLOYMENT_ID, releaseTreeSha: TREE });
    expect(first.workerInstanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(second.workerInstanceId).not.toBe(first.workerInstanceId);
    expect(Object.keys(first).sort()).toEqual([
      "deploymentId",
      "releaseTreeSha",
      "workerInstanceId",
    ]);
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      deploymentId: DEPLOYMENT_ID,
      releaseTreeSha: TREE,
      workerInstanceId: first.workerInstanceId,
    });
    const collectKeys = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(collectKeys);
      if (value === null || typeof value !== "object") return [];
      return Object.entries(value).flatMap(([key, nested]) => [
        key,
        ...collectKeys(nested),
      ]);
    };
    const forbidden = new Set([
      "runId",
      "commandId",
      "claim",
      "claimId",
      "lease",
      "leaseOwner",
      "leaseExpiresAt",
    ]);
    expect(collectKeys({ first, second }).filter((key) => forbidden.has(key)))
      .toEqual([]);
  });

  it("starts only after full worker composition and lifecycle coordination, then refreshes every 10 seconds", async () => {
    const source = await readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function startProductionWorker");
    const body = source.slice(start);
    const secrets = body.indexOf("resolveDeploymentEnvironment");
    const verifier = body.indexOf("createWeb2JsonVerifierClient");
    const schema = body.indexOf("verifyDeploymentSchema");
    const worker = body.indexOf("createProductionWorker");
    const lifecycle = body.indexOf('for (const signal of ["SIGINT", "SIGTERM"]');
    const heartbeatStart = body.indexOf("heartbeatStore.start");
    const claimLoop = body.indexOf("runWorkerLoop");
    const heartbeatStop = body.indexOf("heartbeatStore.stop");
    expect(secrets).toBeGreaterThanOrEqual(0);
    expect(verifier).toBeGreaterThan(secrets);
    expect(schema).toBeGreaterThan(verifier);
    expect(worker).toBeGreaterThan(schema);
    expect(lifecycle).toBeGreaterThan(worker);
    expect(heartbeatStart).toBeGreaterThan(lifecycle);
    expect(claimLoop).toBeGreaterThan(heartbeatStart);
    expect(heartbeatStop).toBeGreaterThan(claimLoop);
    expect(body).toMatch(/await heartbeatStore\.start\([^;]+;\s*await runWorkerLoop\(/s);
    expect(source).toMatch(/10_000|10000/);
    expect(source).not.toMatch(/renewLease[^\n]*deployment|command[^\n]*heartbeat[^\n]*deployment/i);
  });

  it("stops new claims after heartbeat loss, lets the current bounded command settle, then rejects", async () => {
    vi.useFakeTimers();
    const module = await import("../src/bootstrap");
    const heartbeat = {
      start: vi.fn(async () => undefined),
      refreshAndCleanup: vi.fn()
        .mockRejectedValueOnce(new Error("private heartbeat database failure")),
      stop: vi.fn(async () => undefined),
    };
    let finishCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      finishCurrent = resolve;
    });
    const processOne = vi.fn(async () => {
      await current;
      return true;
    });
    const operation = module.runWorkerLoop({
      processOne,
      // The accepted pre-027B loop would otherwise spin forever after the
      // first deferred command resolves because it does not observe heartbeat
      // failure. Bound that negative control at a second claim; the frozen
      // assertion below still requires the corrected loop to stop at one.
      shouldStop: () => processOne.mock.calls.length >= 2,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      idleDelayMs: 1_000,
      deploymentHeartbeat: heartbeat,
      heartbeatIntervalMs: 10_000,
    } as any);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(processOne).toHaveBeenCalledOnce();
    finishCurrent();
    await expect(operation).rejects.toMatchObject({
      code: "DEPLOYMENT_HEARTBEAT_FAILED",
    });
    expect(processOne).toHaveBeenCalledOnce();
    expect(heartbeat.stop).not.toHaveBeenCalled();
  });

  it("marks stopped before closing the pool on a graceful process stop", async () => {
    const source = await readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8");
    const stopped = source.lastIndexOf(".stop(");
    const poolEnd = source.lastIndexOf("pool.end");
    expect(stopped).toBeGreaterThanOrEqual(0);
    expect(poolEnd).toBeGreaterThan(stopped);
  });

  it("contains no heartbeat-only command, sidecar, dummy credential or test fallback", async () => {
    const sources = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../../api/src/deployment-heartbeat.ts", import.meta.url), "utf8")
        .catch(() => ""),
    ]);
    expect(sources.join("\n")).not.toMatch(/heartbeat-only|sidecar|dummy|fixture|test adapter|NODE_ENV\s*===?\s*["']test/i);
  });
});
