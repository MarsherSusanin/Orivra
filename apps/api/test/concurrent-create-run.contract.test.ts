// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const projectId = "11111111-1111-4111-8111-111111111111";

function concurrentPool() {
  let stored:
    | { id: string; request_fingerprint: Uint8Array }
    | undefined;
  let initialSelects = 0;
  let releaseInitial!: () => void;
  const bothSelected = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });

  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    if (/SELECT id, request_fingerprint[\s\S]+FOR UPDATE/i.test(text)) {
      if (stored) return { rowCount: 1, rows: [stored] };
      initialSelects += 1;
      if (initialSelects === 2) releaseInitial();
      await bothSelected;
      return { rowCount: 0, rows: [] };
    }
    if (/INSERT INTO proofline_private\.runs/i.test(text)) {
      if (stored) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint: "runs_project_id_idempotency_key_key",
        });
      }
      stored = {
        id: String(values[0]),
        request_fingerprint: new Uint8Array(values[3] as Uint8Array),
      };
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  });

  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return {
    pool: { connect, query } as any,
    get stored() {
      return stored;
    },
  };
}

function service(pool: any) {
  return createProductionProoflineService({
    pool,
    tokenDigestKey: "slice-005-digest-key",
    publicWebOrigin: "https://proofline.test",
  });
}

describe("Slice 005 concurrent createRun idempotency", () => {
  it("resolves identical concurrent intent to the same persisted run", async () => {
    const harness = concurrentPool();
    const production = service(harness.pool);
    const context = {
      projectId,
      idempotencyKey: "concurrent-create-1",
      manifest: validManifest,
    };

    const results = await Promise.all([
      production.createRun(context),
      production.createRun(structuredClone(context)),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      status: "accepted",
      runId: harness.stored?.id,
    });
  });

  it("maps a concurrent conflicting intent to 409 instead of leaking 23505", async () => {
    const harness = concurrentPool();
    const production = service(harness.pool);
    const conflictingManifest = {
      ...validManifest,
      consumer: {
        ...validManifest.consumer,
        expectedHost: "mirror.example.net",
      },
    };

    const results = await Promise.allSettled([
      production.createRun({
        projectId,
        idempotencyKey: "concurrent-create-conflict",
        manifest: validManifest,
      }),
      production.createRun({
        projectId,
        idempotencyKey: "concurrent-create-conflict",
        manifest: conflictingManifest,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ status: 409 });
    expect(String(rejected?.reason?.message)).not.toMatch(/23505|unique constraint/i);
  });
});
