// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createProoflineApi } from "../src/app";
import { POSTGRES_QUERIES } from "../src/postgres";

const projectToken = `project_${"a".repeat(64)}`;
const runId = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const transactionHash = `0x${"b".repeat(64)}`;

function service() {
  return {
    createRun: vi.fn().mockResolvedValue({ runId, location: `/v1/runs/${runId}` }),
    replay: vi.fn().mockResolvedValue({ runId }),
    getRun: vi.fn().mockResolvedValue({ runId }),
    listEvents: vi.fn().mockResolvedValue({ events: [], nextAfter: 0 }),
    createSubmission: vi.fn().mockResolvedValue({ accepted: true }),
    attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    verifyConsumer: vi.fn().mockResolvedValue({ accepted: true }),
    generateConsumer: vi.fn().mockResolvedValue({ source: "contract Safe {}" }),
    getBundle: vi.fn().mockResolvedValue({ runId }),
    createShare: vi.fn().mockResolvedValue({ token: `share_${"c".repeat(64)}` }),
  };
}

function request(path: string, body: unknown) {
  return new Request(`https://api.proofline.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${projectToken}`,
      "content-type": "application/json",
      "idempotency-key": "remediation-contract-1",
    },
    body: JSON.stringify(body),
  });
}

function api() {
  const servicePort = service();
  return {
    service: servicePort,
    api: createProoflineApi({
      service: servicePort,
      authenticate: vi.fn().mockResolvedValue({
        kind: "project" as const,
        projectId: "project_1",
      }),
    }),
  };
}

describe("verifier remediation: command leases", () => {
  it("reclaims queued commands and expired leases with SKIP LOCKED", () => {
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(POSTGRES_QUERIES.claimNextCommand).toMatch(
      /status\s*=\s*'queued'[\s\S]+OR[\s\S]+status\s*=\s*'leased'[\s\S]+lease_expires_at\s*<=\s*now\(\)/i,
    );
  });

  it("prevents an expired or stale claim from retrying a command", () => {
    expect(POSTGRES_QUERIES.retryCommand).toMatch(/lease_token\s*=\s*\$2::uuid/i);
    expect(POSTGRES_QUERIES.retryCommand).toMatch(/lease_expires_at\s*>\s*now\(\)/i);
  });
});

describe("verifier remediation: strict endpoint schemas", () => {
  it.each([
    [
      `/v1/runs/${runId}/submissions`,
      { mode: "wallet", signer: `0x${"d".repeat(64)}` },
      "createSubmission",
      "INVALID_REQUEST_BODY",
    ],
    [
      `/v1/runs/${runId}/transactions`,
      { transactionHash, rawTransaction: "0x02f8private" },
      "attachTransaction",
      "INVALID_REQUEST_BODY",
    ],
    [
      `/v1/runs/${runId}/consumer-verifications`,
      { mnemonicWords: ["never", "forward"] },
      "verifyConsumer",
      "PRIVATE_KEY_FORBIDDEN",
    ],
  ])("rejects unknown or secret-bearing fields at %s", async (path, body, method, code) => {
    const ports = api();
    const response = await ports.api.fetch(request(path, body));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: { code },
    });
    expect(ports.service[method as keyof typeof ports.service]).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("02f8private");
  });

  it("allows exactly one validated transaction hash and no signing material", async () => {
    const ports = api();
    const response = await ports.api.fetch(
      request(`/v1/runs/${runId}/transactions`, { transactionHash }),
    );
    expect(response.status).toBe(202);
    expect(ports.service.attachTransaction).toHaveBeenCalledWith({
      projectId: "project_1",
      runId,
      idempotencyKey: "remediation-contract-1",
      transactionHash,
    });
  });
});

describe("verifier remediation: least-privilege migration", () => {
  it("does not grant the worker blanket UPDATE access to every private table", async () => {
    const sql = await readFile(
      new URL("../db/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );
    expect(sql).not.toMatch(
      /GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s+ON\s+ALL\s+TABLES[\s\S]+proofline_worker/i,
    );
    expect(sql).toMatch(/GRANT[\s\S]+run_commands[\s\S]+TO proofline_worker/i);
    const workerGrants = sql
      .split(";")
      .filter((statement) => /\bTO\s+proofline_worker\b/i.test(statement));
    for (const statement of workerGrants) {
      if (/\bUPDATE\b/i.test(statement)) {
        expect(statement).not.toMatch(
          /\b(?:projects|api_tokens|share_tokens|run_events|run_artifacts)\b/i,
        );
      }
    }
  });
});
