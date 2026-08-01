// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OCCURRED_AT,
  RUN_ID,
  exactTrustManifest,
  makeBundleInput,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import {
  canonicalSerializeProofBundle,
  createProofBundle,
  projectRun,
} from "@proofline/domain";
import {
  createProductionCommandHandlers,
  createRunWorker,
} from "../src/worker";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PX";
const decoder = new TextDecoder();

function created(runId: string, manifest: unknown) {
  return {
    version: "1" as const,
    runId,
    sequence: 1,
    commandId: "command_create",
    occurredAt: OCCURRED_AT,
    type: "RUN_CREATED" as const,
    payload: { manifest },
  };
}

function command(runId = RUN_ID) {
  return {
    id: "command_preflight",
    kind: "RUN_PREFLIGHT",
    runId,
    attempts: 1,
    payload: {},
  };
}

function handlerHarness(input: {
  runId?: string;
  manifest?: any;
  preflight?: () => Promise<unknown>;
  loadReplayBundle?: () => Promise<string>;
  loadReplayPreflightReport?: () => Promise<string>;
}) {
  const runId = input.runId ?? RUN_ID;
  const manifest = input.manifest ?? exactTrustManifest;
  const events = [created(runId, manifest)] as any[];
  const repository = {
    loadRunExecutionContext: vi.fn(async () => ({
      runId,
      projectId: PROJECT_ID,
      manifest,
      events,
      projection: projectRun(events),
      artifacts: [],
    })),
    findRelayerTransaction: vi.fn(),
    persistRelayerTransaction: vi.fn(),
    markRelayerBroadcast: vi.fn(),
  };
  const ports = {
    preflight: vi.fn(input.preflight),
    loadReplayBundle: input.loadReplayBundle
      ? vi.fn(input.loadReplayBundle)
      : undefined,
    loadReplayPreflightReport: input.loadReplayPreflightReport
      ? vi.fn(input.loadReplayPreflightReport)
      : undefined,
  };
  const handlers = createProductionCommandHandlers({
    repository: repository as any,
    ports: ports as any,
    clock: { now: () => OCCURRED_AT },
  }) as Record<string, (value: any) => Promise<any>>;
  return { handlers, ports, repository };
}

function artifactJson(outcome: any, kind: string) {
  const artifact = outcome.artifacts.find((item: any) => item.kind === kind);
  expect(artifact, `missing persisted ${kind}`).toBeDefined();
  const bytes = artifact.canonicalBytes as Uint8Array;
  expect(Buffer.from(artifact.sha256)).toEqual(
    createHash("sha256").update(bytes).digest(),
  );
  return JSON.parse(decoder.decode(bytes));
}

describe("Slice 016A worker preflight artifact boundary", () => {
  it("atomically returns compact acceptance, one public report, private evidence and the authorized child", async () => {
    const relayerManifest = {
      ...exactTrustManifest,
      submission: { ...exactTrustManifest.submission, mode: "relayer" as const },
    };
    const fixture = handlerHarness({
      manifest: relayerManifest,
      preflight: async () => ({
        kind: "accepted",
        report: validPreflightReport,
        submissionEvidence: {
          version: "1",
          canonicalUrl: validPreflightReport.canonicalUrl,
          requestBytes: "0x1234abcd",
          requestCalldata: "0xfeedcafe",
          quotedFeeWei: 12_345_000_000_000_000n,
          network: {
            chainId: 114,
            registryAddress: validPreflightReport.registrySnapshot.registryAddress,
            resolvedContracts:
              validPreflightReport.registrySnapshot.resolvedContracts,
          },
        },
      }),
    });

    const outcome = await fixture.handlers.RUN_PREFLIGHT(command());

    expect(outcome.events).toEqual([
      {
        version: "1",
        runId: RUN_ID,
        sequence: 2,
        commandId: "command_preflight",
        occurredAt: OCCURRED_AT,
        type: "PREFLIGHT_ACCEPTED",
        payload: {
          canonicalUrl: validPreflightReport.canonicalUrl,
          requestBytes: "0x1234abcd",
          quotedFeeWei: "12345000000000000",
        },
      },
    ]);
    expect(outcome.artifacts.map((item: any) => item.kind)).toEqual([
      "preflight-evidence",
      "preflight-report-v1",
    ]);
    expect(artifactJson(outcome, "preflight-report-v1")).toEqual(
      validPreflightReport,
    );
    expect(JSON.stringify(artifactJson(outcome, "preflight-report-v1"))).not.toMatch(
      /requestBytes|requestCalldata|feedcafe/i,
    );
    expect(artifactJson(outcome, "preflight-evidence")).toMatchObject({
      requestBytes: "0x1234abcd",
      requestCalldata: "0xfeedcafe",
      quotedFeeWei: "12345000000000000",
    });
    expect(outcome.nextCommands).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        kind: "SUBMIT_RELAYER",
        idempotencyKey: `${RUN_ID}:submit_relayer`,
      }),
    ]);
  });

  it("persists a blocked public report with terminal journal evidence and no private or submission artifact", async () => {
    const report = {
      ...structuredClone(validPreflightReport),
      verdict: "blocked",
      fee: {
        ...structuredClone(validPreflightReport.fee),
        quotedWei: "20000000000000001",
        withinCap: false,
      },
      blockers: ["PREFLIGHT_FEE_CAP_EXCEEDED"],
      diagnostics: [
        {
          version: "1",
          code: "PREFLIGHT_FEE_CAP_EXCEEDED",
          severity: "error",
          confidence: "high",
          summary: "The registry fee quote exceeds the manifest fee cap.",
          evidence: { reportFields: ["fee"] },
          remediation: "Increase the cap or wait for a lower registry quote.",
        },
      ],
    };
    const fixture = handlerHarness({
      preflight: async () => ({
        kind: "blocked",
        report,
        error: {
          version: "1",
          category: "configuration",
          code: "PREFLIGHT_FEE_CAP_EXCEEDED",
          message: "Preflight is blocked by the fee cap.",
          retryable: false,
          evidence: { reportFields: ["fee"] },
        },
      }),
    });

    const outcome = await fixture.handlers.RUN_PREFLIGHT(command());

    expect(outcome.events).toEqual([
      expect.objectContaining({
        runId: RUN_ID,
        sequence: 2,
        type: "RUN_FAILED",
        payload: {
          stage: "preflight",
          error: expect.objectContaining({
            code: "PREFLIGHT_FEE_CAP_EXCEEDED",
            retryable: false,
          }),
        },
      }),
    ]);
    expect(outcome.artifacts.map((item: any) => item.kind)).toEqual([
      "preflight-report-v1",
    ]);
    expect(artifactJson(outcome, "preflight-report-v1")).toEqual(report);
    expect(outcome.nextCommands).toEqual([]);
  });

  it("lets the command repository retry transport failures without a partial artifact outcome", async () => {
    const completeCommand = vi.fn();
    const retryCommand = vi.fn();
    const worker = createRunWorker({
      environment: "test",
      mode: "live",
      repository: {
        claimNextCommand: vi.fn(async () => ({
          claimToken: "claim_preflight",
          command: command(),
        })),
        completeCommand,
        retryCommand,
      },
      handlers: {
        RUN_PREFLIGHT: vi.fn(async () => {
          throw Object.assign(new Error("Verifier unavailable"), {
            category: "transport",
            code: "VERIFIER_TRANSPORT_FAILED",
            retryable: true,
            evidence: {},
          });
        }),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(worker.processOne()).resolves.toBe(true);
    expect(completeCommand).not.toHaveBeenCalled();
    expect(retryCommand).toHaveBeenCalledWith(
      "command_preflight",
      "claim_preflight",
      expect.objectContaining({
        category: "transport",
        code: "VERIFIER_TRANSPORT_FAILED",
        retryable: true,
      }),
    );
  });
});

describe("Slice 016A replay report sidecar", () => {
  function replaySource() {
    const input = makeBundleInput();
    const manifest = {
      ...exactTrustManifest,
      submission: { ...exactTrustManifest.submission, mode: "replay" as const },
    };
    const events = input.events.map((item) =>
      item.type === "RUN_CREATED"
        ? { ...item, payload: { manifest } }
        : item,
    );
    return createProofBundle({ ...input, manifest, events });
  }

  function boundReport(source: ReturnType<typeof replaySource>) {
    const accepted = source.events.find((item) => item.type === "PREFLIGHT_ACCEPTED");
    expect(accepted?.type).toBe("PREFLIGHT_ACCEPTED");
    if (accepted?.type !== "PREFLIGHT_ACCEPTED") throw new Error("fixture invalid");
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
        registryAddress: source.network.registryAddress,
        resolvedContracts: {
          ...structuredClone(validPreflightReport.registrySnapshot.resolvedContracts),
          FdcHub: source.network.resolvedContracts.FdcHub,
          FdcVerification: source.network.resolvedContracts.FdcVerification,
          Relay: source.network.resolvedContracts.Relay,
        },
      },
      fee: {
        ...structuredClone(validPreflightReport.fee),
        quotedWei: accepted.payload.quotedFeeWei,
        capWei: source.manifest.submission.feeCapWei,
      },
    };
  }

  it("requires and binds a recorded public report without live preflight I/O", async () => {
    const source = replaySource();
    const sourceReport = boundReport(source);
    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: source.manifest,
      preflight: async () => {
        throw new Error("live preflight must not execute in replay");
      },
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
      loadReplayPreflightReport: async () => JSON.stringify(sourceReport),
    });

    const outcome = await fixture.handlers.RUN_PREFLIGHT(command(TARGET_RUN_ID));

    expect(fixture.ports.preflight).not.toHaveBeenCalled();
    expect(fixture.ports.loadReplayPreflightReport).toHaveBeenCalledOnce();
    expect(fixture.ports.loadReplayPreflightReport).toHaveBeenCalledWith({
      manifest: source.manifest,
      runId: TARGET_RUN_ID,
    });
    expect(outcome.artifacts.map((item: any) => item.kind)).toEqual([
      "replay-source",
      "preflight-evidence",
      "preflight-report-v1",
    ]);
    expect(artifactJson(outcome, "preflight-report-v1")).toEqual({
      ...sourceReport,
      runId: TARGET_RUN_ID,
    });
  });

  it.each([
    [
      "request identity",
      (report: any) => ({
        ...report,
        requestIdentitySha256: `sha256:${"f".repeat(64)}`,
      }),
    ],
    [
      "canonical URL",
      (report: any) => ({
        ...report,
        canonicalUrl: "https://mirror.example.net/prices/eth",
      }),
    ],
    [
      "fee cap",
      (report: any) => ({
        ...report,
        fee: { ...report.fee, capWei: "1" },
      }),
    ],
    [
      "resolved FdcHub",
      (report: any) => ({
        ...report,
        registrySnapshot: {
          ...report.registrySnapshot,
          resolvedContracts: {
            ...report.registrySnapshot.resolvedContracts,
            FdcHub: "0x9999999999999999999999999999999999999999",
          },
        },
      }),
    ],
  ])("rejects a replay sidecar whose %s is not bound to the bundle", async (_label, mutate) => {
    const source = replaySource();
    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: source.manifest,
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
      loadReplayPreflightReport: async () =>
        JSON.stringify(mutate(boundReport(source))),
    });

    await expect(
      fixture.handlers.RUN_PREFLIGHT(command(TARGET_RUN_ID)),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: "REPLAY_PREFLIGHT_REPORT_MISMATCH",
      retryable: false,
    });
  });

  it("fails closed when a replay bundle has no recorded report sidecar", async () => {
    const source = replaySource();
    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: source.manifest,
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
    });

    await expect(
      fixture.handlers.RUN_PREFLIGHT(command(TARGET_RUN_ID)),
    ).rejects.toMatchObject({
      category: "configuration",
      code: "REPLAY_PREFLIGHT_REPORT_MISSING",
      retryable: false,
    });
  });
});
