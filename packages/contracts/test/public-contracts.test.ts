// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DiagnosticV1Schema,
  NormalizedFdcErrorSchema,
  ProductEventV1Schema,
  ProofBundleV1Schema,
  RunEventV1Schema,
  RunListPageV1Schema,
  RunProjectionV1Schema,
  RunSummaryV1Schema,
  Web2JsonManifestV1Schema,
} from "../src/index";
import {
  makeBundleInput,
  makeRunEvents,
  RUN_ID,
  validDiagnostic,
  validManifest,
} from "./fixtures";

describe("Web2JsonManifestV1Schema", () => {
  it("accepts the single supported Coston2 safe-GET manifest", () => {
    expect(Web2JsonManifestV1Schema.parse(validManifest)).toEqual(validManifest);
  });

  it.each([
    ["future schema versions", { ...validManifest, version: "2" }],
    ["unknown networks", { ...validManifest, network: "songbird" }],
    [
      "non-GET methods",
      { ...validManifest, request: { ...validManifest.request, method: "POST" } },
    ],
    [
      "plaintext HTTP",
      {
        ...validManifest,
        request: { ...validManifest.request, url: "http://api.example.com/prices/eth" },
      },
    ],
    [
      "non-443 ports",
      {
        ...validManifest,
        request: { ...validManifest.request, url: "https://api.example.com:8443/prices/eth" },
      },
    ],
    [
      "URL credentials",
      {
        ...validManifest,
        request: { ...validManifest.request, url: "https://user:secret@api.example.com/prices/eth" },
      },
    ],
    [
      "URL fragments",
      {
        ...validManifest,
        request: { ...validManifest.request, url: "https://api.example.com/prices/eth#secret" },
      },
    ],
    [
      "an invalid expected path prefix",
      {
        ...validManifest,
        consumer: { ...validManifest.consumer, expectedPathPrefix: "prices" },
      },
    ],
    [
      "non-canonical fee integers",
      {
        ...validManifest,
        submission: { ...validManifest.submission, feeCapWei: "01" },
      },
    ],
    ["unknown request capabilities", {
      ...validManifest,
      request: { ...validManifest.request, headers: { Authorization: "secret" } },
    }],
  ])("rejects %s", (_caseName, candidate) => {
    expect(Web2JsonManifestV1Schema.safeParse(candidate).success).toBe(false);
  });
});

describe("RunEventV1Schema", () => {
  it("accepts the complete ordered lifecycle event vocabulary", () => {
    for (const event of makeRunEvents()) {
      expect(RunEventV1Schema.parse(event)).toEqual(event);
    }
  });

  it("requires a positive integer sequence and a stable command id", () => {
    const [created] = makeRunEvents();
    expect(RunEventV1Schema.safeParse({ ...created, sequence: 0 }).success).toBe(false);
    expect(RunEventV1Schema.safeParse({ ...created, commandId: "" }).success).toBe(false);
  });

  it("rejects payloads that do not match the discriminated event type", () => {
    const [created] = makeRunEvents();
    expect(
      RunEventV1Schema.safeParse({
        ...created,
        type: "ROUND_FINALIZED",
        payload: { manifest: validManifest },
      }).success,
    ).toBe(false);
  });
});

describe("remaining wire schemas", () => {
  it("accepts structured diagnostics and rejects unstable diagnostic codes", () => {
    expect(DiagnosticV1Schema.parse(validDiagnostic)).toEqual(validDiagnostic);
    expect(
      DiagnosticV1Schema.safeParse({ ...validDiagnostic, code: "something went wrong" }).success,
    ).toBe(false);
  });

  it("defines the complete bundle envelope including a sha256 checksum", () => {
    const bundle = {
      ...makeBundleInput(),
      checksum: `sha256:${"a".repeat(64)}`,
    };
    expect(ProofBundleV1Schema.parse(bundle)).toEqual(bundle);
    expect(ProofBundleV1Schema.safeParse({ ...bundle, checksum: "aabb" }).success).toBe(false);
  });

  it("keeps normalized FDC errors serializable and category-stable", () => {
    const error = {
      version: "1",
      category: "not-finalized",
      code: "RELAY_ROUND_NOT_FINALIZED",
      message: "Voting round 42871 is not finalized.",
      retryable: true,
      evidence: { votingRound: 42871 },
    };
    expect(NormalizedFdcErrorSchema.parse(error)).toEqual(error);

    for (const category of [
      "configuration",
      "transport",
      "timeout",
      "not-finalized",
      "consensus-miss",
      "schema-invalid",
      "proof-invalid",
      "consumer-invariant",
    ]) {
      expect(NormalizedFdcErrorSchema.safeParse({ ...error, category }).success).toBe(true);
    }

    expect(NormalizedFdcErrorSchema.safeParse({ ...error, category: "unknown" }).success).toBe(false);
  });

  it("defines a six-stage projection with an explicit terminal bit", () => {
    const projection = {
      version: "1",
      runId: RUN_ID,
      sequence: 1,
      terminal: false,
      stages: {
        preflight: "active",
        request: "pending",
        round: "pending",
        proof: "pending",
        verify: "pending",
        consumer: "pending",
      },
    };
    expect(RunProjectionV1Schema.parse(projection)).toEqual(projection);
  });
});

describe("ProductEventV1Schema", () => {
  const common = {
    version: "1",
    sessionId: "session_123e4567-e89b-42d3-a456-426614174000",
    occurredAt: "2026-08-02T02:10:00.000Z",
  };

  const events = [
    { ...common, name: "COMPOSER_STARTED", metadata: { entryPoint: "runs" } },
    { ...common, name: "MANIFEST_VALIDATED", metadata: { outcome: "accepted" } },
    { ...common, name: "PREFLIGHT_COMPLETED", metadata: { outcome: "accepted" } },
    { ...common, name: "SUBMISSION_REQUESTED", metadata: { mode: "wallet" } },
    { ...common, name: "PROOF_AVAILABLE", metadata: { source: "live" } },
    {
      ...common,
      name: "CONSUMER_VERIFICATION_FAILED",
      metadata: { category: "consumer-invariant" },
    },
    { ...common, name: "SAFE_CODEGEN_GENERATED", metadata: { target: "solidity" } },
    { ...common, name: "BUNDLE_REPLAYED", metadata: { outcome: "byte-identical" } },
    { ...common, name: "RUN_RESUMED", metadata: { priorStatus: "active" } },
  ];

  it("accepts exactly the nine privacy-safe product events", () => {
    expect(events.map((event) => ProductEventV1Schema.parse(event).name)).toEqual([
      "COMPOSER_STARTED",
      "MANIFEST_VALIDATED",
      "PREFLIGHT_COMPLETED",
      "SUBMISSION_REQUESTED",
      "PROOF_AVAILABLE",
      "CONSUMER_VERIFICATION_FAILED",
      "SAFE_CODEGEN_GENERATED",
      "BUNDLE_REPLAYED",
      "RUN_RESUMED",
    ]);
  });

  it.each([
    ["unknown event names", { ...events[0], name: "PAGE_VIEWED" }],
    ["free-form metadata", { ...events[0], metadata: { entryPoint: "runs", label: "hello" } }],
    ["URLs", { ...events[0], metadata: { entryPoint: "runs", url: "https://secret.test" } }],
    ["manifest data", { ...events[1], metadata: { outcome: "accepted", manifest: validManifest } }],
    ["transaction hashes", { ...events[4], metadata: { source: "live", transactionHash: `0x${"a".repeat(64)}` } }],
    ["invalid timestamps", { ...events[0], occurredAt: "yesterday" }],
    ["extra envelope fields", { ...events[0], token: `project_${"a".repeat(64)}` }],
  ])("rejects %s", (_caseName, candidate) => {
    expect(ProductEventV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("accepts a bounded, generated analytics session identifier", () => {
    expect(ProductEventV1Schema.safeParse(events[0]).success).toBe(true);
  });

  it.each([
    ["project-token markers", "session_project_deadbeef"],
    ["share-token markers", "session_share_deadbeef"],
    ["URLs", "session_https://proofline.test/runs/run_private"],
    ["transaction-looking hashes", `0x${"c".repeat(64)}`],
    ["private-key-looking hex", "d".repeat(64)],
    ["labeled private material", `private_${"e".repeat(64)}`],
    ["overlong values", `session_${"f".repeat(65)}`],
  ])("rejects session IDs containing %s", (_caseName, sessionId) => {
    expect(
      ProductEventV1Schema.safeParse({ ...events[0], sessionId }).success,
    ).toBe(false);
  });
});

describe("run discovery schemas", () => {
  const summary = {
    version: "1",
    runId: RUN_ID,
    network: "coston2",
    sourceHost: "api.example.com",
    submissionMode: "wallet",
    currentStage: "proof",
    status: "active",
    createdAt: "2026-08-02T01:00:00.000Z",
    updatedAt: "2026-08-02T02:00:00.000Z",
    lastSequence: 5,
    resumable: true,
  };

  it("defines a strict product-facing run summary", () => {
    expect(RunSummaryV1Schema.parse(summary)).toEqual(summary);
    expect(
      RunSummaryV1Schema.safeParse({ ...summary, internalProjectId: "project_1" }).success,
    ).toBe(false);
  });

  it.each([
    ["unknown statuses", { ...summary, status: "pending" }],
    ["unknown stages", { ...summary, currentStage: "broadcast" }],
    ["URLs instead of source hosts", { ...summary, sourceHost: "https://api.example.com/private?q=1" }],
    ["invalid timestamps", { ...summary, updatedAt: "02 August 2026" }],
    ["backwards timestamps", { ...summary, updatedAt: "2026-08-01T23:59:59.000Z" }],
    ["non-positive sequences", { ...summary, lastSequence: 0 }],
  ])("rejects %s", (_caseName, candidate) => {
    expect(RunSummaryV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("defines an ordered page with one optional opaque cursor", () => {
    const page = {
      version: "1",
      runs: [summary],
      nextCursor: "eyJ1cGRhdGVkQXQiOiIyMDI2LTA4LTAyIn0",
    };
    expect(RunListPageV1Schema.parse(page)).toEqual(page);
    expect(RunListPageV1Schema.parse({ version: "1", runs: [] })).toEqual({
      version: "1",
      runs: [],
    });
  });

  it.each([
    ["empty cursors", { version: "1", runs: [], nextCursor: "" }],
    ["structured cursors", { version: "1", runs: [], nextCursor: "updated_at=secret" }],
    ["unknown page fields", { version: "1", runs: [], total: 1 }],
    ["invalid summaries", { version: "1", runs: [{ ...summary, status: "queued" }] }],
  ])("rejects %s", (_caseName, candidate) => {
    expect(RunListPageV1Schema.safeParse(candidate).success).toBe(false);
  });
});
