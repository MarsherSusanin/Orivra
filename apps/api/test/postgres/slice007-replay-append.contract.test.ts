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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeBundleInput,
  validPreflightReport,
} from "../../../../packages/contracts/test/fixtures";
import {
  canonicalizeManifestUrl,
  canonicalSerializeProofBundle,
  createProofBundle,
} from "@proofline/domain";
import { createProductionCommandHandlers } from "../../../worker/src/worker";
import { createPostgresCommandRepository } from "../../src/postgres";
import { createProductionProoflineService } from "../../src/production-service";

const enabled = process.env.PROOFLINE_TESTCONTAINERS === "1";
const migrationPath = fileURLToPath(
  new URL("../../db/migrations/001_initial.sql", import.meta.url),
);
const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const RETRY_COMMAND_ID = "88888888-8888-4888-8888-888888888888";
const OCCURRED_AT = "2025-05-15T12:04:11.000Z";

function terminalReplayBundle(persistedManifest?: Record<string, any>) {
  const input = makeBundleInput();
  const manifest = persistedManifest ?? {
    ...input.manifest,
    consumer: {
      ...input.manifest.consumer,
      expectedQuery: {
        ...input.manifest.consumer.expectedQuery,
        window: "1h",
      },
    },
    submission: { ...input.manifest.submission, mode: "replay" as const },
  };
  const canonicalUrl = canonicalizeManifestUrl(manifest as any);
  const events = input.events.map((event) => {
    if (event.type === "RUN_CREATED") {
      return { ...event, payload: { manifest } };
    }
    if (event.type === "PREFLIGHT_ACCEPTED") {
      return {
        ...event,
        payload: { ...event.payload, canonicalUrl },
      };
    }
    return event;
  });
  return createProofBundle({ ...input, manifest, events });
}

function boundPreflightReport(source: ReturnType<typeof terminalReplayBundle>) {
  const accepted = source.events.find(
    (event) => event.type === "PREFLIGHT_ACCEPTED",
  );
  if (accepted?.type !== "PREFLIGHT_ACCEPTED") {
    throw new Error("Replay fixture has no accepted preflight event");
  }
  return {
    ...structuredClone(validPreflightReport),
    runId: source.runId,
    canonicalUrl: accepted.payload.canonicalUrl,
    requestIdentitySha256: `sha256:${createHash("sha256")
      .update(Buffer.from(source.requestBytes.slice(2), "hex"))
      .digest("hex")}`,
    registrySnapshot: {
      ...structuredClone(validPreflightReport.registrySnapshot),
      chainId: source.network.chainId,
      blockNumber: source.network.blockNumber,
      registryAddress: source.network.registryAddress,
      resolvedContracts: {
        ...structuredClone(validPreflightReport.registrySnapshot.resolvedContracts),
        FdcHub: source.network.resolvedContracts.FdcHub,
        FdcRequestFeeConfigurations:
          source.network.resolvedContracts.FdcRequestFeeConfigurations,
        FdcVerification: source.network.resolvedContracts.FdcVerification,
        Relay: source.network.resolvedContracts.Relay,
      },
    },
    fee: {
      quotedWei: accepted.payload.quotedFeeWei,
      capWei: source.manifest.submission.feeCapWei,
      withinCap:
        BigInt(accepted.payload.quotedFeeWei) <=
        BigInt(source.manifest.submission.feeCapWei),
    },
  };
}

describe.runIf(enabled)(
  "Slice 007 replay batch through real PostgreSQL completion",
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
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    });

    it("atomically persists and idempotently resumes the actual replay event batch", async () => {
      const fixtureManifest = terminalReplayBundle().manifest;
      const initialSource = terminalReplayBundle({
        ...fixtureManifest,
        request: {
          ...fixtureManifest.request,
          query: { currency: "USD" },
        },
        consumer: {
          ...fixtureManifest.consumer,
          expectedQuery: { currency: "USD", source: "primary" },
        },
      });
      await pool.query(
        "INSERT INTO proofline_private.projects (id, name) VALUES ($1, $2)",
        [PROJECT_ID, "Slice 007 replay append contract"],
      );
      const service = createProductionProoflineService({
        pool,
        tokenDigestKey: "slice-007-replay-append-key",
        publicWebOrigin: "https://proofline.test",
      });
      const created = await service.createRun({
        projectId: PROJECT_ID,
        idempotencyKey: "create-replay-append",
        manifest: initialSource.manifest,
      });

      const repositoryBeforeRestart = createPostgresCommandRepository({ pool });
      const persistedCreated = await repositoryBeforeRestart
        .loadRunExecutionContext(created.runId);
      const source = terminalReplayBundle(persistedCreated.manifest);
      const serialized = canonicalSerializeProofBundle(source);
      const sourceReport = boundPreflightReport(source);
      const preflightClaim = await repositoryBeforeRestart.claimNextCommand();
      expect(preflightClaim).toMatchObject({
        command: { kind: "RUN_PREFLIGHT", runId: created.runId },
      });
      const handlersBeforeRestart = createProductionCommandHandlers({
        repository: repositoryBeforeRestart,
        ports: {
          loadReplayBundle: vi.fn(async () => serialized),
          loadReplayPreflightReport: vi.fn(async () =>
            JSON.stringify(sourceReport),
          ),
        } as any,
        clock: { now: () => OCCURRED_AT },
      }) as Record<string, (command: any) => Promise<any>>;
      const preflightOutcome = await handlersBeforeRestart.RUN_PREFLIGHT(
        preflightClaim!.command,
      );
      await repositoryBeforeRestart.completeCommand(
        preflightClaim!.command.id,
        preflightClaim!.claimToken,
        preflightOutcome,
      );

      const preApply = await repositoryBeforeRestart.loadRunExecutionContext(
        created.runId,
      );
      expect(preApply.events.map((event) => event.type)).toEqual([
        "RUN_CREATED",
        "PREFLIGHT_ACCEPTED",
      ]);
      expect(preApply.artifacts.map((item) => item.kind)).toEqual(
        expect.arrayContaining([
          "replay-source",
          "preflight-evidence",
          "preflight-report-v1",
        ]),
      );
      const persistedReportArtifact = preApply.artifacts.find(
        (item) => item.kind === "preflight-report-v1",
      );
      expect(persistedReportArtifact).toBeDefined();
      expect(persistedReportArtifact?.runId).toBe(created.runId);
      expect(Buffer.from(persistedReportArtifact!.sha256)).toEqual(
        createHash("sha256")
          .update(Buffer.from(persistedReportArtifact!.canonicalBytes))
          .digest(),
      );
      expect(
        JSON.parse(Buffer.from(persistedReportArtifact!.canonicalBytes).toString("utf8")),
      ).toEqual({ ...sourceReport, runId: created.runId });

      const replaySubmissionKey = "slice007-explicit-replay-apply";
      const authorized = await service.createSubmission({
        projectId: PROJECT_ID,
        runId: created.runId,
        mode: "replay",
        idempotencyKey: replaySubmissionKey,
      });
      expect(authorized).toMatchObject({
        version: "1",
        runId: created.runId,
        mode: "replay",
        effectOwner: "none",
        commandId: expect.any(String),
      });

      const repositoryAfterRestart = createPostgresCommandRepository({ pool });
      const applyClaim = await repositoryAfterRestart.claimNextCommand();
      expect(applyClaim).toMatchObject({
        command: {
          id: authorized.commandId,
          kind: "APPLY_REPLAY_EVIDENCE",
          runId: created.runId,
          payload: { idempotencyKey: replaySubmissionKey },
        },
      });
      const handlersAfterRestart = createProductionCommandHandlers({
        repository: repositoryAfterRestart,
        ports: {} as any,
        clock: { now: () => OCCURRED_AT },
      }) as Record<string, (command: any) => Promise<any>>;
      const applyOutcome = await handlersAfterRestart.APPLY_REPLAY_EVIDENCE(
        applyClaim!.command,
      );
      expect(applyOutcome.events.map((event: any) => event.type)).toEqual([
        "REQUEST_SUBMITTED",
        "ROUND_FINALIZED",
        "PROOF_AVAILABLE",
        "PROOF_VERIFIED",
        "CONSUMER_VERIFIED",
      ]);
      expect(applyOutcome.artifacts.map((item: any) => item.kind)).toEqual([
        "proof-evidence",
        "verification-evidence",
        "consumer-evidence",
        "safe-consumer",
      ]);

      const completion = await repositoryAfterRestart
        .completeCommand(
          applyClaim!.command.id,
          applyClaim!.claimToken,
          applyOutcome,
        )
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );

      if (!completion.ok) {
        expect(completion.error).toBeInstanceOf(Error);
        expect((completion.error as Error).message).toMatch(
          /idempotency command conflict/i,
        );
        const rolledBack = await createPostgresCommandRepository({ pool })
          .loadRunExecutionContext(created.runId);
        expect(rolledBack.events.map((event) => event.type)).toEqual([
          "RUN_CREATED",
          "PREFLIGHT_ACCEPTED",
        ]);
        expect(rolledBack.artifacts.map((item) => item.kind)).not.toEqual(
          expect.arrayContaining([
            "proof-evidence",
            "verification-evidence",
            "consumer-evidence",
            "safe-consumer",
          ]),
        );
      } else {
        const persisted = await createPostgresCommandRepository({ pool })
          .loadRunExecutionContext(created.runId);
        expect(persisted.projection).toMatchObject({
          sequence: 7,
          terminal: true,
          stages: { consumer: "completed" },
        });
        expect(persisted.events.map((event) => event.type)).toEqual([
          "RUN_CREATED",
          "PREFLIGHT_ACCEPTED",
          "REQUEST_SUBMITTED",
          "ROUND_FINALIZED",
          "PROOF_AVAILABLE",
          "PROOF_VERIFIED",
          "CONSUMER_VERIFIED",
        ]);
        expect(persisted.artifacts.map((item) => item.kind)).toEqual(
          expect.arrayContaining([
            "replay-source",
            "preflight-evidence",
            "preflight-report-v1",
            "proof-evidence",
            "verification-evidence",
            "consumer-evidence",
            "safe-consumer",
          ]),
        );

        await pool.query(
          `UPDATE proofline_private.run_commands
           SET status = 'cancelled'
           WHERE run_id = $1 AND kind = 'BUILD_PROOF_BUNDLE'`,
          [created.runId],
        );
        await pool.query(
          `INSERT INTO proofline_private.run_commands
            (id, project_id, run_id, idempotency_key, kind, payload)
           VALUES ($1, $2, $3, 'retry-replay-apply',
                   'APPLY_REPLAY_EVIDENCE', '{}'::jsonb)`,
          [RETRY_COMMAND_ID, PROJECT_ID, created.runId],
        );
        const repositoryAfterSecondRestart = createPostgresCommandRepository({
          pool,
        });
        const retryClaim = await repositoryAfterSecondRestart.claimNextCommand();
        expect(retryClaim).toMatchObject({
          command: {
            id: RETRY_COMMAND_ID,
            kind: "APPLY_REPLAY_EVIDENCE",
          },
        });
        const retryOutcome = await createProductionCommandHandlers({
          repository: repositoryAfterSecondRestart,
          ports: {} as any,
          clock: { now: () => OCCURRED_AT },
        }).APPLY_REPLAY_EVIDENCE(retryClaim!.command as any);
        expect(retryOutcome).toMatchObject({
          nextCommands: [{ kind: "BUILD_PROOF_BUNDLE" }],
        });
        expect(retryOutcome).not.toHaveProperty("events");
        expect(retryOutcome).not.toHaveProperty("artifacts");
        await repositoryAfterSecondRestart.completeCommand(
          retryClaim!.command.id,
          retryClaim!.claimToken,
          retryOutcome,
        );

        const afterRetry = await createPostgresCommandRepository({ pool })
          .loadRunExecutionContext(created.runId);
        expect(afterRetry.events).toHaveLength(7);
        expect(afterRetry.artifacts).toHaveLength(persisted.artifacts.length);
      }

      expect(completion).toEqual({ ok: true });
    });
  },
);
