// @vitest-environment node

import { MockAgent, setGlobalDispatcher } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import { createHermeticProoflineSystem } from "../../apps/api/src/test-system";

const projectToken = "project_" + "a".repeat(64);
const noNetwork = new MockAgent();

beforeAll(() => {
  noNetwork.disableNetConnect();
  setGlobalDispatcher(noNetwork);
});

afterAll(async () => {
  await noNetwork.close();
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${projectToken}`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("hermetic Web2Json vertical replay", () => {
  it("persists create → proof → consumer diagnostic → codegen → bundle → byte-identical replay", async () => {
    const system = createHermeticProoflineSystem({
      projectToken,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });

    const create = await system.api.fetch(
      request(
        "/v1/runs",
        "POST",
        { manifest: { ...validManifest, submission: { ...validManifest.submission, mode: "replay" } } },
        "create-replay",
      ),
    );
    expect(create.status).toBe(202);
    const { runId } = await create.json();

    await expect(system.worker.drain()).resolves.toMatchObject({
      processed: expect.any(Number),
      idle: true,
    });
    const projectionResponse = await system.api.fetch(request(`/v1/runs/${runId}`));
    expect(await projectionResponse.json()).toMatchObject({
      runId,
      stages: {
        preflight: "completed",
        request: "completed",
        round: "completed",
        proof: "completed",
        verify: "completed",
        consumer: "active",
      },
    });

    const verify = await system.api.fetch(
      request(
        `/v1/runs/${runId}/consumer-verifications`,
        "POST",
        { consumer: "canonical-vulnerable" },
        "verify-consumer",
      ),
    );
    expect(verify.status).toBe(202);
    await system.worker.drain();
    const verifiedRun = await (
      await system.api.fetch(request(`/v1/runs/${runId}`))
    ).json();
    expect(verifiedRun.stages.consumer).toBe("failed");
    expect(verifiedRun.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CONSUMER_HOST_MISMATCH" }),
      ]),
    );

    const codegen = await system.api.fetch(
      request(
        `/v1/runs/${runId}/artifacts/consumer`,
        "POST",
        { contractName: "ProoflineSafeConsumer" },
        "generate-consumer",
      ),
    );
    expect(codegen.status).toBe(201);
    const artifact = await codegen.json();
    expect(artifact.source).toContain("requireHost");
    expect(artifact.compilation).toMatchObject({ success: true });

    const bundleResponse = await system.api.fetch(request(`/v1/runs/${runId}/bundle`));
    expect(bundleResponse.status).toBe(200);
    const canonicalBundle = await bundleResponse.text();
    expect(canonicalBundle).not.toMatch(/project_aaaa|private.?key|authorization/i);

    const replay = await system.api.fetch(
      request("/v1/replays", "POST", { bundle: canonicalBundle }, "replay-bundle"),
    );
    expect(replay.status).toBe(201);
    const replayEvidence = await replay.json();
    expect(replayEvidence).toMatchObject({ byteIdentical: true });
    expect(replayEvidence.canonicalBundle).toBe(canonicalBundle);
  });

  it("survives API/worker reconstruction without duplicating an already attached tx hash", async () => {
    const first = createHermeticProoflineSystem({
      projectToken,
      fixture: "web2json-wallet",
      persistentDatabaseId: "restart-fixture",
    });
    const created = await (
      await first.api.fetch(
        request("/v1/runs", "POST", { manifest: validManifest }, "create-wallet"),
      )
    ).json();
    const runId = created.runId;
    await first.api.fetch(
      request(
        `/v1/runs/${runId}/transactions`,
        "POST",
        {
          transactionHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        "attach-wallet-tx",
      ),
    );

    const restarted = createHermeticProoflineSystem({
      projectToken,
      fixture: "web2json-wallet",
      persistentDatabaseId: "restart-fixture",
    });
    await restarted.worker.drain();
    expect(restarted.adapters.broadcastCount).toBe(0);
    expect(restarted.repository.events(runId).filter((event) => event.type === "REQUEST_SUBMITTED")).toHaveLength(1);
  });
});
