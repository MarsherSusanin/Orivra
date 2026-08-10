// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createPostgresDeploymentHeartbeatStore,
  type DeploymentWorkerIdentity,
} from "../src/deployment-heartbeat";

const IDENTITY: DeploymentWorkerIdentity = Object.freeze({
  deploymentId: `deployment_${"a".repeat(64)}`,
  releaseTreeSha: "b".repeat(40),
  workerInstanceId: "11111111-1111-4111-8111-111111111110",
});

function expectFixedHeartbeatFailure(operation: Promise<unknown>) {
  return expect(operation).rejects.toMatchObject({
    name: "DeploymentHeartbeatError",
    code: "DEPLOYMENT_HEARTBEAT_FAILED",
    message: "Deployment heartbeat failed",
  });
}

describe("Slice 027B deployment heartbeat failure authority", () => {
  it.each([
    ["start", "returns no inserted row", async () => ({ rowCount: 0, rows: [] })],
    ["start", "rejects with a private cause", async () => {
      throw new Error("postgres://private-password@db.invalid/start");
    }],
    ["stop", "returns no updated row", async () => ({ rowCount: 0, rows: [] })],
    ["stop", "rejects with a private cause", async () => {
      throw new Error("postgres://private-password@db.invalid/stop");
    }],
  ] as const)(
    "normalizes %s when the query %s",
    async (operation, _outcome, queryImplementation) => {
      const query = vi.fn(queryImplementation);
      const store = createPostgresDeploymentHeartbeatStore({ pool: { query } });
      const result = operation === "start"
        ? store.start(IDENTITY)
        : store.stop(IDENTITY);

      await expectFixedHeartbeatFailure(result);
      await result.catch((error: unknown) => {
        expect(String(error)).not.toContain("private-password");
      });
      expect(query).toHaveBeenCalledOnce();
    },
  );

  it("rolls back and releases when the current heartbeat row disappears", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/^\s*UPDATE/i.test(sql)) return { rowCount: 0, rows: [] };
        if (/^\s*ROLLBACK/i.test(sql)) {
          throw new Error("private rollback cause");
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const store = createPostgresDeploymentHeartbeatStore({
      pool: {
        query: vi.fn(),
        connect: vi.fn(async () => client),
      },
    });

    await expectFixedHeartbeatFailure(store.refreshAndCleanup(IDENTITY));
    expect(calls.some((sql) => /^\s*BEGIN/i.test(sql))).toBe(true);
    expect(calls.some((sql) => /^\s*ROLLBACK/i.test(sql))).toBe(true);
    expect(calls.some((sql) => /^\s*COMMIT/i.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    ["has no connect capability", {}],
    ["cannot acquire a client", {
      connect: vi.fn(async () => {
        throw new Error("postgres://private-password@db.invalid/connect");
      }),
    }],
  ] as const)("fails closed when the pool %s", async (_label, pool) => {
    const store = createPostgresDeploymentHeartbeatStore({
      pool: { query: vi.fn(), ...pool },
    });

    await expectFixedHeartbeatFailure(store.refreshAndCleanup(IDENTITY));
  });
});
