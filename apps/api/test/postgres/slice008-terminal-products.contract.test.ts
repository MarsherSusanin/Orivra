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
import {
  makeRunEvents,
  validManifest,
} from "../../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);
const PROJECT_ID = "81818181-8181-4818-8818-818181818181";
const RUN_ID = "82828282-8282-4828-8828-828282828282";

function terminalProjection() {
  return {
    version: "1",
    runId: RUN_ID,
    sequence: 7,
    terminal: true,
    stages: {
      preflight: "completed",
      request: "completed",
      round: "completed",
      proof: "completed",
      verify: "completed",
      consumer: "failed",
    },
  };
}

describe.runIf(enabled)(
  "Slice 008 terminal products and idempotency on real PostgreSQL",
  () => {
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
          Wait.forLogMessage(
            /database system is ready to accept connections/,
            2,
          ),
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
      await pool.query(
        "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
        [PROJECT_ID, "Slice 008 terminal products"],
      );
      await pool.query(
        `INSERT INTO proofline_private.runs
          (id, project_id, idempotency_key, request_fingerprint, manifest, projection, last_sequence)
         VALUES ($1, $2, 'slice008-create', $3, $4::jsonb, $5::jsonb, 7)`,
        [
          RUN_ID,
          PROJECT_ID,
          createHash("sha256").update("slice008").digest(),
          JSON.stringify(validManifest),
          JSON.stringify(terminalProjection()),
        ],
      );
      for (const source of makeRunEvents()) {
        const event = { ...source, runId: RUN_ID };
        await pool.query(
          `INSERT INTO proofline_private.run_events
            (run_id, sequence, dedupe_key, event_type, event_payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            RUN_ID,
            event.sequence,
            `slice008-event-${event.sequence}`,
            event.type,
            JSON.stringify(event),
            event.occurredAt,
          ],
        );
      }
      await pool.query(
        `INSERT INTO proofline_private.run_commands
          (id, project_id, run_id, idempotency_key, kind, payload, status)
         VALUES ($1, $2, $3, 'slice008-existing-consumer',
                 'VERIFY_CONSUMER', $4::jsonb, 'succeeded')`,
        [
          "83838383-8383-4838-8838-838383838383",
          PROJECT_ID,
          RUN_ID,
          JSON.stringify({ consumer: "canonical-vulnerable" }),
        ],
      );
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    });

    it("allows derived terminal products without rewriting the journal and replays exact intents", async () => {
      const service = createProductionProoflineService({
        pool,
        tokenDigestKey: "slice-008-terminal-products-key",
        publicWebOrigin: "https://proofline.test",
      });
      const before = await pool.query(
        "SELECT count(*)::integer AS count FROM proofline_private.run_events WHERE run_id = $1",
        [RUN_ID],
      );

      await expect(
        service.verifyConsumer({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "slice008-existing-consumer",
          consumer: "canonical-vulnerable",
        }),
      ).resolves.toEqual({ accepted: true, runId: RUN_ID });
      await expect(
        service.verifyConsumer({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "slice008-new-terminal-intent",
          consumer: "canonical-vulnerable",
        }),
      ).rejects.toMatchObject({ status: 409, code: "RUN_TERMINAL" });
      await expect(
        service.verifyConsumer({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          idempotencyKey: "slice008-existing-consumer",
          consumer: "canonical-safe",
        }),
      ).rejects.toMatchObject({ status: 409 });

      const generatedContext = {
        projectId: PROJECT_ID,
        runId: RUN_ID,
        idempotencyKey: "slice008-terminal-codegen",
        contractName: "Slice008SafeConsumer",
      };
      const generated = await service.generateConsumer(generatedContext);
      await expect(
        service.generateConsumer(structuredClone(generatedContext)),
      ).resolves.toEqual(generated);
      await expect(
        service.generateConsumer({
          ...generatedContext,
          contractName: "ConflictingSafeConsumer",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(generated.source).toMatch(/contract\s+Slice008SafeConsumer/);

      const shareContext = {
        projectId: PROJECT_ID,
        runId: RUN_ID,
        idempotencyKey: "slice008-terminal-share",
        expiresAt: "2026-08-01T00:00:00.000Z",
      };
      const share = await service.createShare(shareContext);
      await expect(
        service.createShare(structuredClone(shareContext)),
      ).resolves.toEqual(share);
      await expect(
        service.createShare({
          ...shareContext,
          expiresAt: "2026-08-02T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({ status: 409 });
      const storedShares = await pool.query(
        "SELECT count(*)::integer AS count FROM proofline_private.share_tokens WHERE run_id = $1",
        [RUN_ID],
      );
      expect(storedShares.rows[0]?.count).toBe(1);

      const after = await pool.query(
        "SELECT count(*)::integer AS count FROM proofline_private.run_events WHERE run_id = $1",
        [RUN_ID],
      );
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });
  },
);
