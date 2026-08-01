// @vitest-environment node

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  attentionPreflightReport,
  validPreflightReport,
} from "../../contracts/test/fixtures";
import * as domain from "../src/index";

function requiredFunction(name: string): (...args: any[]) => any {
  const candidate = (domain as Record<string, unknown>)[name];
  expect(candidate, `Slice 016A requires pure domain ${name}`).toBeTypeOf(
    "function",
  );
  return candidate as (...args: any[]) => any;
}

describe("Slice 016A canonical transformed-sample fingerprints", () => {
  it("exports the pure fingerprint, redacted-shape and report serializer boundaries", () => {
    for (const name of [
      "fingerprintCanonicalJson",
      "createRedactedJsonShape",
      "canonicalSerializePreflightReport",
    ]) {
      requiredFunction(name);
    }
  });

  it("uses canonical object-key order and the exact lowercase sha256 envelope", () => {
    const fingerprint = requiredFunction("fingerprintCanonicalJson");
    expect(fingerprint({ value: 2_500_125_000 })).toBe(
      "sha256:6d8108d1c7dccddc7f0a7114f8c7a1f8b01600f6f560314662721f61f077e8d0",
    );
    expect(fingerprint({ b: 2, a: { y: true, x: null } })).toBe(
      fingerprint({ a: { x: null, y: true }, b: 2 }),
    );
  });

  it("is invariant to arbitrary object insertion order", () => {
    const fingerprint = requiredFunction("fingerprintCanonicalJson");
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.oneof(fc.integer(), fc.boolean(), fc.string({ maxLength: 16 })),
          { maxKeys: 20 },
        ),
        (record) => {
          const reversed = Object.fromEntries(Object.entries(record).reverse());
          expect(fingerprint(reversed)).toBe(fingerprint(record));
        },
      ),
    );
  });

  it.each([
    [{ value: 1 }, { value: 2 }, "value mutation"],
    [{ value: 1 }, { value: "1" }, "type mutation"],
    [[1, 2], [2, 1], "array-order mutation"],
    [{ value: [1, 2] }, { value: [1, 2, 3] }, "shape mutation"],
  ])("changes for %s", (left, right, _label) => {
    const fingerprint = requiredFunction("fingerprintCanonicalJson");
    expect(fingerprint(left)).not.toBe(fingerprint(right));
  });
});

describe("Slice 016A deterministic redacted JSON shape", () => {
  it("returns only sorted path/type nodes and never scalar values", () => {
    const shape = requiredFunction("createRedactedJsonShape")({
      z: [{ token: `project_${"a".repeat(64)}`, amount: 42 }],
      a: { email: "private@example.test", enabled: true },
    });
    const serialized = JSON.stringify(shape);

    expect(shape).toMatchObject({ truncated: false, nodes: expect.any(Array) });
    expect(shape.nodes.map((node: { path: string }) => node.path)).toEqual(
      [...shape.nodes.map((node: { path: string }) => node.path)].sort(),
    );
    expect(serialized).not.toMatch(
      /private@example\.test|project_[a-f0-9]{64}|"amount":42|"enabled":true/i,
    );
    expect(
      shape.nodes.every(
        (node: Record<string, unknown>) =>
          Object.keys(node).sort().join(",") === "path,type",
      ),
    ).toBe(true);
  });

  it("is object-order invariant and deterministic byte-for-byte", () => {
    const shape = requiredFunction("createRedactedJsonShape");
    expect(shape({ b: [1, 2], a: { c: "value" } })).toEqual(
      shape({ a: { c: "other value" }, b: [9, 8] }),
    );
  });

  it("caps traversal deterministically and marks truncation", () => {
    const shape = requiredFunction("createRedactedJsonShape");
    const huge = Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [
        `field_${String(index).padStart(3, "0")}`,
        { nested: index },
      ]),
    );
    const first = shape(huge);
    const second = shape(Object.fromEntries(Object.entries(huge).reverse()));

    expect(first.truncated).toBe(true);
    expect(first.nodes.length).toBeLessThanOrEqual(256);
    expect(first).toEqual(second);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThan(
      65_536,
    );
  });

  it("represents JSON null and rejects unsupported values without inventing a shape", () => {
    const shape = requiredFunction("createRedactedJsonShape");
    expect(shape(null)).toEqual({
      truncated: false,
      nodes: [{ path: "", type: "null" }],
    });
    expect(() => shape(undefined)).toThrow(/unsupported JSON shape value/i);
  });
});

describe("Slice 016A canonical public report bytes", () => {
  it("serializes one validated report deterministically regardless of object insertion order", () => {
    const serialize = requiredFunction("canonicalSerializePreflightReport");
    const reversed = Object.fromEntries(
      Object.entries(structuredClone(validPreflightReport)).reverse(),
    );
    const first = serialize(validPreflightReport);
    const second = serialize(reversed);

    expect(first).toBe(second);
    expect(new TextEncoder().encode(first).byteLength).toBeLessThanOrEqual(65_536);
    expect(JSON.parse(first)).toEqual(validPreflightReport);
  });

  it("rejects private or oversized report candidates instead of serializing them", () => {
    const serialize = requiredFunction("canonicalSerializePreflightReport");
    expect(() =>
      serialize({
        ...structuredClone(attentionPreflightReport),
        requestBytes: "0x1234",
      }),
    ).toThrow();
    const oversized = structuredClone(attentionPreflightReport) as any;
    oversized.jqPreview.nodes = Array.from({ length: 220 }, (_, index) => ({
      path: `/${index}-${"x".repeat(300)}`,
      type: "string",
    }));
    expect(() => serialize(oversized)).toThrow();
  });
});
