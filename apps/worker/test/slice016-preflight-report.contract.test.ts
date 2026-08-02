// @vitest-environment node

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Abi } from "viem";
import fdcHubAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcHub.sol/IFdcHub.json";
import {
  OCCURRED_AT,
  RUN_ID,
  attentionPreflightReport,
  blockedPreflightReport,
  exactTrustManifest,
  makeBundleInput,
  UINT256_MAX,
  UINT256_OVERFLOW,
  validPreflightReport,
} from "../../../packages/contracts/test/fixtures";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  canonicalizeManifestUrl,
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

function requestAttestationCalldata(requestBytes: `0x${string}`) {
  return encodeFunctionData({
    abi: fdcHubAbi as Abi,
    functionName: "requestAttestation",
    args: [requestBytes],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  const ports: any = {
    preflight: vi.fn(input.preflight),
    signRelayerTransaction: vi.fn(),
    ...(input.loadReplayBundle
      ? { loadReplayBundle: vi.fn(input.loadReplayBundle) }
      : {}),
    ...(input.loadReplayPreflightReport
      ? { loadReplayPreflightReport: vi.fn(input.loadReplayPreflightReport) }
      : {}),
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

function acceptedOutcome(input: {
  report?: any;
  submissionEvidence?: any;
} = {}) {
  const submissionEvidence = {
    version: "1",
    canonicalUrl: validPreflightReport.canonicalUrl,
    requestBytes: "0x1234abcd",
    requestCalldata: requestAttestationCalldata("0x1234abcd"),
    quotedFeeWei: 12_345_000_000_000_000n,
    network: {
      chainId: 114,
      blockNumber: validPreflightReport.registrySnapshot.blockNumber,
      registryAddress: validPreflightReport.registrySnapshot.registryAddress,
      resolvedContracts: {
        FdcHub: validPreflightReport.registrySnapshot.resolvedContracts.FdcHub,
        FdcRequestFeeConfigurations:
          validPreflightReport.registrySnapshot.resolvedContracts
            .FdcRequestFeeConfigurations,
        FdcVerification:
          validPreflightReport.registrySnapshot.resolvedContracts.FdcVerification,
        Relay: validPreflightReport.registrySnapshot.resolvedContracts.Relay,
      },
    },
  };
  return {
    kind: "accepted",
    report: structuredClone(input.report ?? validPreflightReport),
    submissionEvidence: {
      ...submissionEvidence,
      ...(input.submissionEvidence ?? {}),
    },
  };
}

const TRUST_DIAGNOSTICS = {
  PREFLIGHT_TRUST_HOST_MISMATCH: {
    summary: "The expected consumer host does not match the canonical request host.",
    remediation: "Set Trust host to the exact normalized source host.",
  },
  PREFLIGHT_TRUST_PATH_MISMATCH: {
    summary: "The expected consumer path does not cover the canonical request path.",
    remediation: "Set a segment-safe path prefix that covers the source path.",
  },
  PREFLIGHT_TRUST_QUERY_MISMATCH: {
    summary: "The expected consumer query does not match every effective request input.",
    remediation: "Make the Trust query exactly match the canonical request query.",
  },
} as const;

type TrustBlocker = keyof typeof TRUST_DIAGNOSTICS;

function trustBlockedOutcome(blockers: TrustBlocker[]) {
  const diagnostics = blockers.map((code) => ({
    version: "1",
    code,
    severity: "error",
    confidence: "high",
    summary: TRUST_DIAGNOSTICS[code].summary,
    evidence: { reportFields: ["canonicalUrl"] },
    remediation: TRUST_DIAGNOSTICS[code].remediation,
  }));
  return {
    kind: "blocked",
    report: {
      ...structuredClone(validPreflightReport),
      verdict: "blocked",
      blockers,
      diagnostics,
    },
    error: {
      version: "1",
      category: "configuration",
      code: blockers[0],
      message: diagnostics[0].summary,
      retryable: false,
      evidence: structuredClone(diagnostics[0].evidence),
    },
  };
}

async function expectBoundaryRejection(
  fixture: ReturnType<typeof handlerHarness>,
  expected: Record<string, unknown>,
) {
  await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject(
    expected,
  );
  expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
  expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
  expect(fixture.repository.markRelayerBroadcast).not.toHaveBeenCalled();
}

function blockedOutcome(report: any = blockedPreflightReport) {
  const publicReport = structuredClone(report);
  const blocker = publicReport.blockers[0] ?? "PREFLIGHT_SOURCE_NONDETERMINISTIC";
  const diagnostic = publicReport.diagnostics.find(
    (item: any) => item.code === blocker,
  ) ?? structuredClone(blockedPreflightReport.diagnostics[0]);
  return {
    kind: "blocked",
    report: publicReport,
    error: {
      version: "1",
      category: blocker === "PREFLIGHT_SOURCE_NONDETERMINISTIC"
        ? "schema-invalid"
        : "configuration",
      code: blocker,
      message: diagnostic.summary,
      retryable: false,
      evidence: structuredClone(diagnostic.evidence),
    },
  };
}

describe("Slice 016A worker preflight artifact boundary", () => {
  it("accepts uint256 max but rejects overflow at the preflight port boundary", async () => {
    const maxManifest = {
      ...exactTrustManifest,
      submission: {
        ...exactTrustManifest.submission,
        feeCapWei: UINT256_MAX,
      },
    };
    const maxOutcome = acceptedOutcome();
    maxOutcome.report.fee = {
      quotedWei: UINT256_MAX,
      capWei: UINT256_MAX,
      withinCap: true,
    };
    maxOutcome.submissionEvidence.quotedFeeWei = BigInt(UINT256_MAX);
    const maxFixture = handlerHarness({
      manifest: maxManifest,
      preflight: async () => maxOutcome,
    });
    await expect(maxFixture.handlers.RUN_PREFLIGHT(command())).resolves
      .toMatchObject({
        events: [
          expect.objectContaining({
            type: "PREFLIGHT_ACCEPTED",
            payload: expect.objectContaining({ quotedFeeWei: UINT256_MAX }),
          }),
        ],
      });

    for (const mutate of [
      (outcome: any) => {
        outcome.report.fee = {
          quotedWei: UINT256_OVERFLOW,
          capWei: UINT256_OVERFLOW,
          withinCap: true,
        };
        outcome.submissionEvidence.quotedFeeWei = BigInt(UINT256_OVERFLOW);
      },
      (outcome: any) => {
        outcome.report.registrySnapshot.blockNumber = UINT256_OVERFLOW;
        outcome.submissionEvidence.network.blockNumber = UINT256_OVERFLOW;
      },
    ]) {
      const overflow = acceptedOutcome();
      mutate(overflow);
      const fixture = handlerHarness({
        manifest: maxManifest,
        preflight: async () => overflow,
      });
      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        retryable: false,
      });
    }
  });

  it("atomically returns compact acceptance, one public report, private evidence and the authorized child", async () => {
    const relayerManifest = {
      ...exactTrustManifest,
      submission: { ...exactTrustManifest.submission, mode: "relayer" as const },
    };
    const fixture = handlerHarness({
      manifest: relayerManifest,
      preflight: async () => acceptedOutcome(),
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
      requestCalldata: requestAttestationCalldata("0x1234abcd"),
      quotedFeeWei: "12345000000000000",
      network: {
        chainId: 114,
        blockNumber: validPreflightReport.registrySnapshot.blockNumber,
        registryAddress: validPreflightReport.registrySnapshot.registryAddress,
        resolvedContracts: {
          FdcHub: validPreflightReport.registrySnapshot.resolvedContracts.FdcHub,
          FdcRequestFeeConfigurations:
            validPreflightReport.registrySnapshot.resolvedContracts
              .FdcRequestFeeConfigurations,
          FdcVerification:
            validPreflightReport.registrySnapshot.resolvedContracts
              .FdcVerification,
          Relay: validPreflightReport.registrySnapshot.resolvedContracts.Relay,
        },
      },
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
          message: "The registry fee quote exceeds the manifest fee cap.",
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
    expect(JSON.stringify(artifactJson(outcome, "preflight-report-v1"))).not.toMatch(
      /requestBytes|requestCalldata|feedcafe|private|authorization|stack/i,
    );
    expect(outcome.nextCommands).toEqual([]);
  });

  it.each([
    ["accepted discriminator with blocked report", () => ({
      ...acceptedOutcome({ report: blockedPreflightReport }),
    })],
    ["blocked discriminator with ready report", () => blockedOutcome(validPreflightReport)],
    ["blocked discriminator with attention report", () => blockedOutcome(attentionPreflightReport)],
  ])("rejects %s", async (_label, makeOutcome) => {
    const fixture = handlerHarness({ preflight: async () => makeOutcome() });
    await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject({
      category: "schema-invalid",
      code: "PREFLIGHT_OUTCOME_DISCRIMINATOR_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["run id", (outcome: any) => { outcome.report.runId = "run_other"; }],
    ["canonical URL", (outcome: any) => {
      outcome.submissionEvidence.canonicalUrl = "https://mirror.example.net/prices/eth";
    }],
    ["request bytes SHA-256", (outcome: any) => {
      outcome.submissionEvidence.requestBytes = "0xdeadbeef";
    }],
    ["quoted fee", (outcome: any) => {
      outcome.submissionEvidence.quotedFeeWei = 1n;
    }],
    ["manifest fee cap", (outcome: any) => {
      outcome.report.fee.capWei = "20000000000000001";
    }],
    ["network chain", (outcome: any) => {
      outcome.submissionEvidence.network.chainId = 1;
    }],
    ["network block", (outcome: any) => {
      outcome.submissionEvidence.network.blockNumber = "12345679";
    }],
    ["registry address", (outcome: any) => {
      outcome.submissionEvidence.network.registryAddress =
        "0x9999999999999999999999999999999999999999";
    }],
    ["registry-resolved FdcHub", (outcome: any) => {
      outcome.submissionEvidence.network.resolvedContracts.FdcHub =
        "0x9999999999999999999999999999999999999999";
    }],
  ])("rejects accepted evidence with mismatched %s", async (_label, mutate) => {
    const outcome = acceptedOutcome();
    mutate(outcome);
    const fixture = handlerHarness({ preflight: async () => outcome });
    await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject({
      category: "schema-invalid",
      code: "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
      retryable: false,
    });
  });

  it("rejects a self-consistent accepted URL that is not the persisted manifest canonical URL", async () => {
    expect(canonicalizeManifestUrl(exactTrustManifest)).toBe(
      validPreflightReport.canonicalUrl,
    );
    const outcome = acceptedOutcome();
    const forgedCanonicalUrl =
      "https://api.example.com/prices/eth?currency=USD&source=primary&window=4h";
    outcome.report.canonicalUrl = forgedCanonicalUrl;
    outcome.submissionEvidence.canonicalUrl = forgedCanonicalUrl;
    const fixture = handlerHarness({ preflight: async () => outcome });

    await expectBoundaryRejection(fixture, {
      category: "schema-invalid",
      code: "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["host", { expectedHost: "mirror.example.net" }],
    ["path", { expectedPathPrefix: "/trusted/" }],
    ["query", { expectedQuery: { currency: "USD", source: "backup" } }],
  ])(
    "rejects accepted evidence when persisted consumer Trust derives a %s blocker",
    async (_label, consumerOverride) => {
      const manifest = {
        ...exactTrustManifest,
        consumer: { ...exactTrustManifest.consumer, ...consumerOverride },
      };
      const fixture = handlerHarness({
        manifest,
        preflight: async () => acceptedOutcome(),
      });

      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        code: "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
        retryable: false,
      });
    },
  );

  it("accepts exactly the Trust blockers derived from the persisted manifest", async () => {
    const manifest = {
      ...exactTrustManifest,
      consumer: {
        ...exactTrustManifest.consumer,
        expectedHost: "mirror.example.net",
        expectedPathPrefix: "/trusted/",
        expectedQuery: { currency: "USD", source: "backup" },
      },
    };
    const exactBlockers: TrustBlocker[] = [
      "PREFLIGHT_TRUST_HOST_MISMATCH",
      "PREFLIGHT_TRUST_PATH_MISMATCH",
      "PREFLIGHT_TRUST_QUERY_MISMATCH",
    ];
    const fixture = handlerHarness({
      manifest,
      preflight: async () => trustBlockedOutcome(exactBlockers),
    });

    await expect(fixture.handlers.RUN_PREFLIGHT(command())).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "RUN_FAILED" })],
      nextCommands: [],
    });
  });

  it.each([
    [
      "missing",
      {
        ...exactTrustManifest,
        consumer: {
          ...exactTrustManifest.consumer,
          expectedHost: "mirror.example.net",
          expectedPathPrefix: "/trusted/",
        },
      },
      ["PREFLIGHT_TRUST_HOST_MISMATCH"],
    ],
    [
      "spurious",
      exactTrustManifest,
      ["PREFLIGHT_TRUST_HOST_MISMATCH"],
    ],
  ] as const)(
    "rejects a blocked report with %s persisted-manifest Trust blockers",
    async (_label, manifest, reportedBlockers) => {
      const fixture = handlerHarness({
        manifest,
        preflight: async () => trustBlockedOutcome([...reportedBlockers]),
      });

      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        code: "PREFLIGHT_BLOCKED_ERROR_MISMATCH",
        retryable: false,
      });
    },
  );

  it.each([
    ["arbitrary hex", "0xfeedcafe"],
    ["calldata for different request bytes", requestAttestationCalldata("0xdeadbeef")],
  ])(
    "rejects %s before returning a child command or signing",
    async (_label, requestCalldata) => {
      const outcome = acceptedOutcome({
        submissionEvidence: { requestCalldata },
      });
      const fixture = handlerHarness({
        manifest: {
          ...exactTrustManifest,
          submission: { ...exactTrustManifest.submission, mode: "relayer" },
        },
        preflight: async () => outcome,
      });

      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        code: "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
        retryable: false,
      });
    },
  );

  it.each([
    ["missing", (outcome: any) => {
      delete outcome.submissionEvidence.network.resolvedContracts
        .FdcRequestFeeConfigurations;
    }],
    ["mismatched", (outcome: any) => {
      outcome.submissionEvidence.network.resolvedContracts
        .FdcRequestFeeConfigurations =
        "0x9999999999999999999999999999999999999999";
    }],
  ])(
    "rejects accepted evidence with %s FdcRequestFeeConfigurations",
    async (_label, mutate) => {
      const outcome = acceptedOutcome();
      mutate(outcome);
      const fixture = handlerHarness({ preflight: async () => outcome });

      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        code: "PREFLIGHT_SUBMISSION_EVIDENCE_MISMATCH",
        retryable: false,
      });
    },
  );

  it("requires the blocked error code to name the same blocker and error diagnostic", async () => {
    const outcome = blockedOutcome();
    outcome.error.code = "PREFLIGHT_ABI_INCOMPATIBLE";
    const fixture = handlerHarness({ preflight: async () => outcome });
    await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject({
      category: "schema-invalid",
      code: "PREFLIGHT_BLOCKED_ERROR_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    "Preflight is blocked by the fee cap.",
    "Stripe payment_intent pi_123 failed for customer cus_123.",
  ])("rejects a blocked error message that is not the diagnostic summary: %s", async (message) => {
    const outcome = blockedOutcome();
    outcome.error.message = message;
    const fixture = handlerHarness({ preflight: async () => outcome });

    await expectBoundaryRejection(fixture, {
      category: "schema-invalid",
      code: "PREFLIGHT_BLOCKED_ERROR_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["private error evidence", (outcome: any) => {
      outcome.error.evidence = { requestBytes: "0x1234abcd" };
    }],
    ["private submission evidence", (outcome: any) => {
      outcome.submissionEvidence = acceptedOutcome().submissionEvidence;
    }],
  ])("rejects blocked outcomes containing %s", async (_label, mutate) => {
    const outcome = blockedOutcome();
    mutate(outcome);
    const fixture = handlerHarness({ preflight: async () => outcome });
    await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject({
      category: "schema-invalid",
      code: "PREFLIGHT_BLOCKED_PRIVATE_EVIDENCE",
      retryable: false,
    });
  });

  it.each(["test", "development", "production"])(
    "rejects a legacy flat preflight outcome when NODE_ENV=%s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const fixture = handlerHarness({
        preflight: async () => acceptedOutcome().submissionEvidence,
      });
      await expect(fixture.handlers.RUN_PREFLIGHT(command())).rejects.toMatchObject({
        category: "configuration",
        code: "PREFLIGHT_OUTCOME_INVALID",
        retryable: false,
      });
    },
  );

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
        ...structuredClone(validPreflightReport.fee),
        quotedWei: accepted.payload.quotedFeeWei,
        capWei: source.manifest.submission.feeCapWei,
      },
    };
  }

  async function captureCorruptReplayRejection(serialized: string) {
    const source = replaySource();
    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: source.manifest,
      preflight: async () => {
        throw new Error("live-preflight-secret-must-not-leak");
      },
      loadReplayBundle: async () => serialized,
      loadReplayPreflightReport: async () => {
        throw new Error("report-sidecar-secret-must-not-leak");
      },
    });

    const rejection = await fixture.handlers
      .RUN_PREFLIGHT(command(TARGET_RUN_ID))
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(rejection).toMatchObject({
      category: "schema-invalid",
      code: "REPLAY_EVIDENCE_INVALID",
      retryable: false,
    });
    expect(rejection).toMatchObject({
      message: "Recorded replay evidence is invalid",
    });
    expect(JSON.stringify(rejection)).not.toMatch(
      /bundle-secret-must-not-leak|live-preflight-secret-must-not-leak|report-sidecar-secret-must-not-leak|SyntaxError/i,
    );
    expect(fixture.ports.loadReplayBundle).toHaveBeenCalledOnce();
    expect(fixture.ports.loadReplayPreflightReport).not.toHaveBeenCalled();
    expect(fixture.ports.preflight).not.toHaveBeenCalled();
    expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.markRelayerBroadcast).not.toHaveBeenCalled();
    return fixture;
  }

  it("fails closed with a stable safe error for invalid replay bundle JSON", async () => {
    await captureCorruptReplayRejection(
      "not-json::bundle-secret-must-not-leak::SyntaxError",
    );
  });

  it("fails closed with the same safe error for checksum or canonical corruption", async () => {
    const source = replaySource();
    const canonical = canonicalSerializeProofBundle(source);
    const checksumCorrupted = canonical.replace(
      source.checksum,
      `sha256:${"0".repeat(64)}`,
    );
    const canonicalCorrupted = `${canonical}\n`;

    await Promise.all(
      [checksumCorrupted, canonicalCorrupted].map((serialized) =>
        captureCorruptReplayRejection(serialized),
      ),
    );
  });

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

  it("accepts semantically identical replay manifests with reordered JSONB keys", async () => {
    const source = replaySource();
    const persistedManifest = {
      submission: {
        feeCapWei: source.manifest.submission.feeCapWei,
        mode: source.manifest.submission.mode,
      },
      consumer: {
        expectedQuery: Object.fromEntries(
          Object.entries(source.manifest.consumer.expectedQuery).reverse(),
        ),
        expectedPathPrefix: source.manifest.consumer.expectedPathPrefix,
        expectedHost: source.manifest.consumer.expectedHost,
        expectedScheme: source.manifest.consumer.expectedScheme,
      },
      request: {
        abiSignature: source.manifest.request.abiSignature,
        jq: source.manifest.request.jq,
        query: Object.fromEntries(
          Object.entries(source.manifest.request.query).reverse(),
        ),
        url: source.manifest.request.url,
        method: source.manifest.request.method,
      },
      network: source.manifest.network,
      attestationType: source.manifest.attestationType,
      version: source.manifest.version,
    };
    const sourceParsed = Web2JsonManifestV1Schema.parse(source.manifest);
    const persistedParsed = Web2JsonManifestV1Schema.parse(persistedManifest);
    expect(persistedParsed).toEqual(sourceParsed);
    expect(Object.keys(persistedManifest)).not.toEqual(
      Object.keys(source.manifest),
    );
    expect(Object.keys(persistedManifest.request)).not.toEqual(
      Object.keys(source.manifest.request),
    );

    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: persistedManifest,
      preflight: async () => {
        throw new Error("live preflight must not execute in replay");
      },
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
      loadReplayPreflightReport: async () =>
        JSON.stringify(boundReport(source)),
    });

    const outcome = await fixture.handlers.RUN_PREFLIGHT(command(TARGET_RUN_ID));

    expect(outcome.artifacts.map((item: any) => item.kind)).toEqual([
      "replay-source",
      "preflight-evidence",
      "preflight-report-v1",
    ]);
    expect(fixture.ports.preflight).not.toHaveBeenCalled();
    expect(fixture.ports.loadReplayBundle).toHaveBeenCalledOnce();
    expect(fixture.ports.loadReplayPreflightReport).toHaveBeenCalledOnce();
    expect(fixture.ports.signRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.persistRelayerTransaction).not.toHaveBeenCalled();
    expect(fixture.repository.markRelayerBroadcast).not.toHaveBeenCalled();

    const changedManifest = {
      ...persistedManifest,
      consumer: {
        ...persistedManifest.consumer,
        expectedHost: "mirror.example.net",
      },
    };
    const changedFixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest: changedManifest,
      preflight: async () => {
        throw new Error("live preflight must not execute in replay");
      },
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
      loadReplayPreflightReport: async () =>
        JSON.stringify(boundReport(source)),
    });
    await expect(
      changedFixture.handlers.RUN_PREFLIGHT(command(TARGET_RUN_ID)),
    ).rejects.toMatchObject({
      category: "schema-invalid",
      code: "REPLAY_EVIDENCE_INVALID",
      retryable: false,
    });
    expect(changedFixture.ports.preflight).not.toHaveBeenCalled();
    expect(changedFixture.ports.loadReplayPreflightReport).not.toHaveBeenCalled();
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
      "registry block",
      (report: any) => ({
        ...report,
        registrySnapshot: {
          ...report.registrySnapshot,
          blockNumber: (BigInt(report.registrySnapshot.blockNumber) + 1n).toString(),
        },
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
    [
      "resolved FdcRequestFeeConfigurations",
      (report: any) => ({
        ...report,
        registrySnapshot: {
          ...report.registrySnapshot,
          resolvedContracts: {
            ...report.registrySnapshot.resolvedContracts,
            FdcRequestFeeConfigurations:
              "0x9999999999999999999999999999999999999999",
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

  it("rejects a sidecar and event URL that agree with each other but not the persisted manifest", async () => {
    const input = makeBundleInput();
    const manifest = {
      ...exactTrustManifest,
      submission: { ...exactTrustManifest.submission, mode: "replay" as const },
    };
    const forgedCanonicalUrl =
      "https://api.example.com/prices/eth?currency=USD&source=primary&window=4h";
    const events = input.events.map((item) => {
      if (item.type === "RUN_CREATED") {
        return { ...item, payload: { manifest } };
      }
      if (item.type === "PREFLIGHT_ACCEPTED") {
        return {
          ...item,
          payload: { ...item.payload, canonicalUrl: forgedCanonicalUrl },
        };
      }
      return item;
    });
    const source = createProofBundle({ ...input, manifest, events });
    const report = {
      ...boundReport(source),
      canonicalUrl: forgedCanonicalUrl,
    };
    const fixture = handlerHarness({
      runId: TARGET_RUN_ID,
      manifest,
      loadReplayBundle: async () => canonicalSerializeProofBundle(source),
      loadReplayPreflightReport: async () => JSON.stringify(report),
    });

    await expectBoundaryRejection(fixture, {
      category: "schema-invalid",
      code: "REPLAY_PREFLIGHT_REPORT_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["host", { expectedHost: "mirror.example.net" }],
    ["path", { expectedPathPrefix: "/trusted/" }],
    ["query", { expectedQuery: { currency: "USD", source: "backup" } }],
  ])(
    "rejects a ready replay sidecar when persisted Trust derives a %s blocker",
    async (_label, consumerOverride) => {
      const input = makeBundleInput();
      const manifest = {
        ...exactTrustManifest,
        submission: { ...exactTrustManifest.submission, mode: "replay" as const },
        consumer: {
          ...exactTrustManifest.consumer,
          ...consumerOverride,
        },
      };
      const events = input.events.map((item) =>
        item.type === "RUN_CREATED"
          ? { ...item, payload: { manifest } }
          : item,
      );
      const source = createProofBundle({ ...input, manifest, events });
      const fixture = handlerHarness({
        runId: TARGET_RUN_ID,
        manifest,
        loadReplayBundle: async () => canonicalSerializeProofBundle(source),
        loadReplayPreflightReport: async () =>
          JSON.stringify(boundReport(source)),
      });

      await expectBoundaryRejection(fixture, {
        category: "schema-invalid",
        code: "REPLAY_PREFLIGHT_REPORT_MISMATCH",
        retryable: false,
      });
    },
  );

  it.each(["test", "development", "production"])(
    "fails closed without a replay report sidecar when NODE_ENV=%s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
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
    },
  );
});
