// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DiagnosticV1Schema,
  NormalizedFdcErrorSchema,
  ProofBundleV1Schema,
  RunEventV1Schema,
  RunProjectionV1Schema,
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
    ["other networks", { ...validManifest, network: "flare" }],
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
