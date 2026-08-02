// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validManifest } from "../../packages/contracts/test/fixtures";
import { createHermeticProoflineSystem } from "../../apps/api/src/test-system";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const TX_HASH = `0x${"9".repeat(64)}`;

type Mode = "wallet" | "relayer" | "replay";

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

function system(id: string) {
  return createHermeticProoflineSystem({
    projectToken: PROJECT_TOKEN,
    fixture: "web2json-wallet",
    persistentDatabaseId: `slice017-addendum-${id}`,
  });
}

async function createRun(
  fixture: ReturnType<typeof createHermeticProoflineSystem>,
  mode: Mode,
  idempotencyKey: string,
) {
  const response = await fixture.api.fetch(request(
    "/v1/runs",
    "POST",
    {
      manifest: {
        ...validManifest,
        submission: { ...validManifest.submission, mode },
      },
    },
    idempotencyKey,
  ));
  expect(response.status).toBe(202);
  return String((await response.json()).runId);
}

async function expectConflict(response: Response, code: string) {
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code },
  });
}

describe("Slice 017 hermetic production-parity authority", () => {
  it("enforces persisted mode before accepting a wallet attachment", async () => {
    const fixture = system("mode");
    const runId = await createRun(fixture, "relayer", "create-relayer-mode");
    await fixture.worker.drain();

    const response = await fixture.api.fetch(request(
      `/v1/runs/${runId}/transactions`,
      "POST",
      { transactionHash: TX_HASH },
      "wallet-on-relayer",
    ));
    await expectConflict(response, "SUBMISSION_MODE_MISMATCH");
    expect(
      fixture.repository.events(runId).some(
        (event) => event.type === "REQUEST_SUBMITTED",
      ),
    ).toBe(false);
  });

  it("keeps one submission authority across different idempotency keys", async () => {
    const fixture = system("authority");
    const runId = await createRun(fixture, "relayer", "create-relayer-authority");
    await fixture.worker.drain();

    const first = await fixture.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "relayer" },
      "first-authority",
    ));
    expect(first.status).toBe(202);
    const second = await fixture.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "relayer" },
      "competing-authority",
    ));
    await expectConflict(second, "SUBMISSION_INTENT_CONFLICT");
  });

  it("does not consume wallet dedupe before completed preflight", async () => {
    const fixture = system("readiness");
    const runId = await createRun(fixture, "wallet", "create-wallet-readiness");
    const attach = () => fixture.api.fetch(request(
      `/v1/runs/${runId}/transactions`,
      "POST",
      { transactionHash: TX_HASH },
      "same-wallet-attachment",
    ));

    await expectConflict(await attach(), "PREFLIGHT_NOT_READY");
    await fixture.worker.drain();
    expect((await attach()).status).toBe(202);
    expect(
      fixture.repository.events(runId).filter(
        (event) => event.type === "REQUEST_SUBMITTED",
      ),
    ).toHaveLength(1);
  });

  it("rejects a new submission authority after the run is terminal", async () => {
    const fixture = system("terminal");
    const runId = await createRun(fixture, "relayer", "create-relayer-terminal");
    await fixture.worker.drain();
    expect((await fixture.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "relayer" },
      "terminal-first-authority",
    ))).status).toBe(202);
    await fixture.worker.drain();
    expect((await fixture.api.fetch(request(
      `/v1/runs/${runId}/consumer-verifications`,
      "POST",
      { consumer: "canonical-safe" },
      "terminal-consumer",
    ))).status).toBe(202);
    await fixture.worker.drain();

    const projection = await (
      await fixture.api.fetch(request(`/v1/runs/${runId}`))
    ).json();
    expect(projection.terminal).toBe(true);
    await expectConflict(await fixture.api.fetch(request(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "relayer" },
      "terminal-competing-authority",
    )), "RUN_TERMINAL");
  });
});
