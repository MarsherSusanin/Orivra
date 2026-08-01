// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as contracts from "../src/index";
import {
  attentionPreflightReport,
  blockedPreflightReport,
  validPreflightReport,
} from "./fixtures";

type Schema = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
};

function requiredSchema(name: string): Schema {
  const candidate = (contracts as Record<string, unknown>)[name] as
    | Partial<Schema>
    | undefined;
  expect(
    candidate?.safeParse,
    `Slice 016A requires public ${name}`,
  ).toBeTypeOf("function");
  return candidate as Schema;
}

function clone(value: unknown): any {
  return structuredClone(value);
}

describe("Slice 016A public preflight report schemas", () => {
  it("exports strict report, diagnostic, shape, and diagnostic-code contracts", () => {
    for (const name of [
      "PreflightReportV1Schema",
      "PreflightDiagnosticV1Schema",
      "PreflightDiagnosticCodeV1Schema",
      "RedactedJsonShapeNodeV1Schema",
      "RedactedJsonShapeV1Schema",
    ]) {
      requiredSchema(name);
    }
  });

  it("accepts the ready, attention, and blocked canonical fixtures", () => {
    const schema = requiredSchema("PreflightReportV1Schema");
    expect(schema.parse(validPreflightReport)).toEqual(validPreflightReport);
    expect(schema.parse(attentionPreflightReport)).toEqual(
      attentionPreflightReport,
    );
    expect(schema.parse(blockedPreflightReport)).toEqual(
      blockedPreflightReport,
    );
  });

  it.each([
    ["four samples", validPreflightReport.sampleFingerprints.slice(0, 4)],
    [
      "six samples",
      [...validPreflightReport.sampleFingerprints, validPreflightReport.sampleFingerprints[0]],
    ],
    [
      "uppercase digest",
      [
        `sha256:${"A".repeat(64)}`,
        ...validPreflightReport.sampleFingerprints.slice(1),
      ],
    ],
    [
      "unprefixed digest",
      ["a".repeat(64), ...validPreflightReport.sampleFingerprints.slice(1)],
    ],
  ])("rejects %s instead of weakening five ordered fingerprints", (_label, fingerprints) => {
    const schema = requiredSchema("PreflightReportV1Schema");
    expect(
      schema.safeParse({
        ...clone(validPreflightReport),
        sampleFingerprints: fingerprints,
      }).success,
    ).toBe(false);
  });

  it("requires the exact distinct count and pass bit implied by ordered fingerprints", () => {
    const schema = requiredSchema("PreflightReportV1Schema");
    expect(
      schema.safeParse({
        ...clone(validPreflightReport),
        determinism: { passed: false, distinctFingerprints: 1 },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...clone(blockedPreflightReport),
        determinism: { passed: true, distinctFingerprints: 1 },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "ready with blockers",
      { ...clone(validPreflightReport), blockers: ["PREFLIGHT_FEE_CAP_EXCEEDED"] },
    ],
    [
      "attention with blockers",
      {
        ...clone(attentionPreflightReport),
        blockers: ["PREFLIGHT_RESPONSE_SHAPE_TRUNCATED"],
      },
    ],
    ["blocked without blockers", { ...clone(blockedPreflightReport), blockers: [] }],
    [
      "blocked without matching error diagnostic",
      { ...clone(blockedPreflightReport), diagnostics: [] },
    ],
    [
      "ready with a truncated shape",
      {
        ...clone(validPreflightReport),
        responseShape: {
          ...clone(validPreflightReport.responseShape),
          truncated: true,
        },
      },
    ],
  ])("rejects inconsistent verdict evidence: %s", (_label, candidate) => {
    expect(
      requiredSchema("PreflightReportV1Schema").safeParse(candidate).success,
    ).toBe(false);
  });

  it.each([
    [
      "ABI incompatibility",
      {
        ...clone(validPreflightReport),
        abiCompatibility: { compatible: false, checkedSamples: 5 },
      },
    ],
    [
      "fee cap failure",
      {
        ...clone(validPreflightReport),
        fee: { ...clone(validPreflightReport.fee), withinCap: false },
      },
    ],
    [
      "Trust host mismatch",
      {
        ...clone(validPreflightReport),
        blockers: ["PREFLIGHT_TRUST_HOST_MISMATCH"],
      },
    ],
  ])("requires a blocked verdict and matching diagnostic for %s", (_label, candidate) => {
    expect(
      requiredSchema("PreflightReportV1Schema").safeParse(candidate).success,
    ).toBe(false);
  });

  it("keeps shape nodes ordered, unique, bounded, and scalar-free", () => {
    const shape = requiredSchema("RedactedJsonShapeV1Schema");
    expect(shape.parse(validPreflightReport.responseShape)).toEqual(
      validPreflightReport.responseShape,
    );
    for (const candidate of [
      {
        truncated: false,
        nodes: [{ path: "", type: "object", value: "private scalar" }],
      },
      {
        truncated: false,
        nodes: [
          { path: "/z", type: "string" },
          { path: "/a", type: "string" },
        ],
      },
      {
        truncated: false,
        nodes: [
          { path: "", type: "object" },
          { path: "", type: "object" },
        ],
      },
      { truncated: false, nodes: [] },
    ]) {
      expect(shape.safeParse(candidate).success).toBe(false);
    }
  });

  it("allows diagnostics to reference only enumerated public report fields", () => {
    const schema = requiredSchema("PreflightDiagnosticV1Schema");
    expect(schema.parse(attentionPreflightReport.diagnostics[0])).toEqual(
      attentionPreflightReport.diagnostics[0],
    );
    expect(
      schema.safeParse({
        ...clone(attentionPreflightReport.diagnostics[0]),
        evidence: { reportFields: ["requestBytes"] },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...clone(attentionPreflightReport.diagnostics[0]),
        code: "FREE_FORM_WARNING",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["request bytes", { requestBytes: "0x1234" }],
    ["calldata", { calldata: "0xfeedcafe" }],
    ["headers", { headers: { authorization: "private" } }],
    ["pinned address", { pinnedAddress: "93.184.216.34" }],
    ["error stack", { errorStack: "private stack" }],
  ])("rejects a private %s extension anywhere in the public report", (_label, extension) => {
    expect(
      requiredSchema("PreflightReportV1Schema").safeParse({
        ...clone(validPreflightReport),
        ...extension,
      }).success,
    ).toBe(false);
  });

  it.each([
    `project_${"a".repeat(64)}`,
    `share_${"b".repeat(64)}`,
    "Bearer verifier-private",
    `0x${"c".repeat(64)}`,
  ])("rejects private-looking free-form report text: %s", (privateValue) => {
    const candidate = clone(attentionPreflightReport);
    candidate.diagnostics[0].summary = privateValue;
    expect(
      requiredSchema("PreflightReportV1Schema").safeParse(candidate).success,
    ).toBe(false);
  });

  it("rejects canonical report bytes above 65536 UTF-8 bytes", () => {
    const oversized = clone(attentionPreflightReport);
    oversized.jqPreview.nodes = Array.from({ length: 220 }, (_, index) => ({
      path: `/${String(index).padStart(3, "0")}-${"x".repeat(300)}`,
      type: "string",
    }));
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      65_536,
    );
    expect(
      requiredSchema("PreflightReportV1Schema").safeParse(oversized).success,
    ).toBe(false);
  });
});
