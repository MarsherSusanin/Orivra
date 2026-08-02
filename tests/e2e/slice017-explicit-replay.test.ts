// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import { createHermeticProoflineSystem } from "../../apps/api/src/test-system";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;

function request(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${PROJECT_TOKEN}`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Slice 017 hermetic explicit replay confirmation", () => {
  it("stops after persisted preflight until one explicit replay submission", async () => {
    const system = createHermeticProoflineSystem({
      projectToken: PROJECT_TOKEN,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });
    const create = await system.api.fetch(request(
      "/v1/runs",
      "POST",
      {
        manifest: {
          ...validManifest,
          submission: { ...validManifest.submission, mode: "replay" },
        },
      },
      "slice017-create-replay",
    ));
    const { runId } = await create.json();

    await system.worker.drain();
    const beforeConfirmation = await (
      await system.api.fetch(request(`/v1/runs/${runId}`))
    ).json();
    expect(beforeConfirmation).toMatchObject({
      runId,
      stages: {
        preflight: "completed",
        request: "pending",
        round: "pending",
        proof: "pending",
      },
    });

    const confirmation = await system.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice017-confirm-replay",
    ));
    expect(confirmation.status).toBe(202);
    const confirmationBody = await confirmation.json();
    expect(confirmationBody).toMatchObject({
      version: "1",
      runId,
      mode: "replay",
      effectOwner: "none",
      commandId: expect.any(String),
    });

    await system.worker.drain();
    const afterConfirmation = await (
      await system.api.fetch(request(`/v1/runs/${runId}`))
    ).json();
    expect(afterConfirmation.stages).toMatchObject({
      preflight: "completed",
      request: "completed",
      round: "completed",
      proof: "completed",
      verify: "completed",
    });

    const retry = await system.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice017-confirm-replay",
    ));
    expect(await retry.json()).toMatchObject({
      commandId: confirmationBody.commandId,
    });
    await system.worker.drain();
    const replaySubmissionEvents = system.repository.events(runId).filter(
      (event) => event.type === "REQUEST_SUBMITTED",
    );
    expect(replaySubmissionEvents).toHaveLength(1);
    expect(system.adapters.broadcastCount).toBe(0);
  });
});
