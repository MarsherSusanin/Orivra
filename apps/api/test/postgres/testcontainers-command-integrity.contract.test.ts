// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validManifest } from "../../../../packages/contracts/test/fixtures";
import {
  createPostgresCommandRepository,
} from "../../src/postgres";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);
const PROJECT_A = "11111111-1111-4111-8111-111111111117";
const PROJECT_B = "22222222-2222-4222-8222-222222222227";
const PROJECT_C = "33333333-3333-4333-8333-333333333337";
const PROJECT_D = "44444444-4444-4444-8444-444444444447";

describe.runIf(enabled)("Slice 007 real PostgreSQL command integrity", () => {
  let container: StartedTestContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_PASSWORD: "proofline",
        POSTGRES_USER: "proofline",
        POSTGRES_DB: "proofline",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start();
    pool = new pg.Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: "proofline",
      password: "proofline",
      database: "proofline",
    });
    await pool.query(await readFile(migrationPath, "utf8"));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("enforces one immutable relayer transaction identity per run", async () => {
    const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
      [PROJECT_A, "Slice 007 relayer uniqueness"],
    );
    await pool.query(
      `INSERT INTO proofline_private.runs
        (id, project_id, idempotency_key, request_fingerprint, manifest, projection, last_sequence)
       VALUES ($1, $2, 'create-relayer-unique', $3, $4::jsonb, '{}'::jsonb, 0)`,
      [runId, PROJECT_A, Buffer.alloc(32, 1), JSON.stringify(validManifest)],
    );

    const insert = (input: {
      id: string;
      key: string;
      nonce: string;
      hashByte: number;
    }) =>
      pool.query(
        `INSERT INTO proofline_private.relayer_transactions
          (id, run_id, idempotency_key, chain_id, from_address, nonce,
           target_address, calldata_hash, command_fingerprint, value_wei,
           raw_signed_transaction, transaction_hash)
         VALUES ($1, $2, $3, 114, $4, $5, $6, $7, $8, 12345, $9, $10)`,
        [
          input.id,
          runId,
          input.key,
          Buffer.alloc(20, input.hashByte),
          input.nonce,
          Buffer.alloc(20, input.hashByte + 1),
          Buffer.alloc(32, input.hashByte + 2),
          Buffer.alloc(32, input.hashByte + 3),
          Buffer.from([input.hashByte]),
          Buffer.alloc(32, input.hashByte + 4),
        ],
      );

    await insert({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7",
      key: "relayer-a",
      nonce: "1",
      hashByte: 1,
    });
    await expect(
      insert({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
        key: "relayer-b",
        nonce: "2",
        hashByte: 11,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("keeps create-run idempotency and conflict semantics on real PostgreSQL", async () => {
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
      [PROJECT_B, "Slice 007 API idempotency"],
    );
    const service = createProductionProoflineService({
      pool,
      tokenDigestKey: "slice-007-testcontainers-key",
      publicWebOrigin: "https://proofline.test",
    });
    const context = {
      projectId: PROJECT_B,
      idempotencyKey: "real-pg-create",
      manifest: validManifest,
    };

    const first = await service.createRun(context);
    await expect(service.createRun(structuredClone(context))).resolves.toEqual(first);
    await expect(
      service.createRun({
        ...context,
        manifest: {
          ...validManifest,
          consumer: {
            ...validManifest.consumer,
            expectedHost: "mirror.example.net",
          },
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reclaims an expired lease after repository restart and resumes from durable evidence", async () => {
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
      [PROJECT_C, "Slice 007 restart resume"],
    );
    const service = createProductionProoflineService({
      pool,
      tokenDigestKey: "slice-007-testcontainers-key",
      publicWebOrigin: "https://proofline.test",
    });
    const created = await service.createRun({
      projectId: PROJECT_C,
      idempotencyKey: "restart-create",
      manifest: validManifest,
    });
    await pool.query(
      `UPDATE proofline_private.run_commands
       SET status = 'cancelled'
       WHERE run_id <> $1 AND status IN ('queued', 'leased')`,
      [created.runId],
    );

    const repositoryBeforeRestart = createPostgresCommandRepository({ pool });
    const firstClaim = await repositoryBeforeRestart.claimNextCommand();
    expect(firstClaim).toMatchObject({
      command: {
        runId: created.runId,
        attempts: 1,
        kind: "RUN_PREFLIGHT",
      },
    });
    await pool.query(
      `UPDATE proofline_private.run_commands
       SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [firstClaim?.command.id],
    );

    const repositoryAfterRestart = createPostgresCommandRepository({ pool });
    const reclaimed = await repositoryAfterRestart.claimNextCommand();
    expect(reclaimed).toMatchObject({
      command: {
        id: firstClaim?.command.id,
        runId: created.runId,
        attempts: 2,
      },
    });

    const canonicalBytes = new TextEncoder().encode(
      JSON.stringify({ version: "1", requestBytes: "0x574542324a534f4e" }),
    );
    const sha256 = new Uint8Array(createHash("sha256").update(canonicalBytes).digest());
    await repositoryAfterRestart.completeCommand(
      reclaimed!.command.id,
      reclaimed!.claimToken,
      {
        events: [
          {
            version: "1",
            runId: created.runId,
            sequence: 2,
            commandId: reclaimed!.command.id,
            occurredAt: "2025-05-15T12:04:11.000Z",
            type: "PREFLIGHT_ACCEPTED",
            payload: {
              canonicalUrl:
                "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h",
              requestBytes: "0x574542324a534f4e",
              quotedFeeWei: "12345000000000000",
            },
          },
        ],
        artifacts: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd7",
            runId: created.runId,
            kind: "preflight-evidence",
            canonicalBytes,
            sha256,
            metadata: { source: "testcontainers-restart" },
          },
        ],
        nextCommands: [],
      },
    );

    const repositoryAfterSecondRestart = createPostgresCommandRepository({ pool });
    await expect(
      repositoryAfterSecondRestart.loadRunExecutionContext(created.runId),
    ).resolves.toMatchObject({
      runId: created.runId,
      events: [
        { type: "RUN_CREATED", sequence: 1 },
        { type: "PREFLIGHT_ACCEPTED", sequence: 2 },
      ],
      projection: {
        sequence: 2,
        stages: { preflight: "completed", request: "pending" },
      },
      artifacts: [
        {
          kind: "preflight-evidence",
          canonicalBytes,
          sha256,
          metadata: { source: "testcontainers-restart" },
        },
      ],
    });
  });

  it("persists retry recovery and appends RUN_RESUMED after repository recreation", async () => {
    await pool.query(
      `UPDATE proofline_private.run_commands
       SET status = 'cancelled'
       WHERE status IN ('queued', 'leased')`,
    );
    await pool.query(
      "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
      [PROJECT_D, "Slice 018 durable recovery"],
    );
    const service = createProductionProoflineService({
      pool,
      tokenDigestKey: "slice-018-testcontainers-key",
      publicWebOrigin: "https://proofline.test",
    });
    const created = await service.createRun({
      projectId: PROJECT_D,
      idempotencyKey: "slice018-recovery-create",
      manifest: validManifest,
    });

    const beforeRestart = createPostgresCommandRepository({ pool });
    const firstClaim = await beforeRestart.claimNextCommand();
    expect(firstClaim).toMatchObject({
      command: {
        runId: created.runId,
        kind: "RUN_PREFLIGHT",
        attempts: 1,
      },
    });
    await beforeRestart.retryCommand(
      firstClaim!.command.id,
      firstClaim!.claimToken,
      {
        category: "transport",
        code: "VERIFIER_TRANSPORT_FAILED",
        message: "Worker command failed",
        retryable: true,
        recoveryState: "retryable",
        evidence: { stage: "preflight" },
        commandId: firstClaim!.command.id,
      },
    );

    const scheduled = await pool.query<{
      sequence: string;
      dedupe_key: string;
      event_payload: {
        commandId: string;
        type: string;
        payload: { attempt: number; state: string };
      };
    }>(
      `SELECT sequence, dedupe_key, event_payload
       FROM proofline_private.run_events
       WHERE run_id = $1
       ORDER BY sequence`,
      [created.runId],
    );
    expect(scheduled.rows).toHaveLength(2);
    expect(scheduled.rows[1]).toMatchObject({
      sequence: "2",
      dedupe_key: `${firstClaim!.command.id}:STAGE_RETRY_SCHEDULED:1`,
      event_payload: {
        commandId: firstClaim!.command.id,
        type: "STAGE_RETRY_SCHEDULED",
        payload: { attempt: 1, state: "retryable" },
      },
    });

    await pool.query(
      `UPDATE proofline_private.run_commands
       SET available_at = now() - interval '1 second'
       WHERE id = $1`,
      [firstClaim!.command.id],
    );
    const afterRestart = createPostgresCommandRepository({ pool });
    const resumed = await afterRestart.claimNextCommand();
    expect(resumed).toMatchObject({
      command: {
        id: firstClaim!.command.id,
        runId: created.runId,
        kind: "RUN_PREFLIGHT",
        attempts: 2,
      },
    });

    const journal = await pool.query<{
      sequence: string;
      dedupe_key: string;
      event_payload: {
        commandId: string;
        type: string;
        payload: { attempt: number };
      };
    }>(
      `SELECT sequence, dedupe_key, event_payload
       FROM proofline_private.run_events
       WHERE run_id = $1
       ORDER BY sequence`,
      [created.runId],
    );
    expect(journal.rows.map(({ event_payload }) => ({
      commandId: event_payload.commandId,
      type: event_payload.type,
      attempt: event_payload.payload.attempt,
    }))).toEqual([
      {
        commandId: "slice018-recovery-create",
        type: "RUN_CREATED",
        attempt: undefined,
      },
      {
        commandId: firstClaim!.command.id,
        type: "STAGE_RETRY_SCHEDULED",
        attempt: 1,
      },
      {
        commandId: firstClaim!.command.id,
        type: "RUN_RESUMED",
        attempt: 2,
      },
    ]);
    expect(journal.rows[2].dedupe_key).toBe(
      `${firstClaim!.command.id}:RUN_RESUMED:2`,
    );

    const versions = await pool.query<{ version: number }>(
      "SELECT version FROM proofline_private.schema_migrations ORDER BY version",
    );
    expect(versions.rows.map(({ version }) => version)).toEqual([1]);
  });
});
