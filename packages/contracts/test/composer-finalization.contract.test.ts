// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import {
  VALID_ABI_SIGNATURE,
  validManifest,
} from "./fixtures";

type SchemaLike = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
};

function createRunResultSchema(): SchemaLike {
  const schema = (Contracts as unknown as Record<string, unknown>)
    .CreateRunResultV1Schema;
  expect(schema, "CreateRunResultV1Schema must be a public contract").toBeDefined();
  return schema as SchemaLike;
}

function withAbiSignature(abiSignature: string) {
  return {
    ...validManifest,
    request: { ...validManifest.request, abiSignature },
  };
}

function nestedTuple(depth: number): Record<string, unknown> {
  if (depth === 0) {
    return { internalType: "uint256", name: "value", type: "uint256" };
  }
  return {
    components: [nestedTuple(depth - 1)],
    internalType: `struct Nested${depth}`,
    name: `nested${depth}`,
    type: "tuple",
  };
}

describe("official bounded Web2Json ABI signature contract", () => {
  it("accepts the official recursive JSON ABI-parameter descriptor shape", () => {
    expect(
      Contracts.Web2JsonManifestV1Schema.parse(
        withAbiSignature(VALID_ABI_SIGNATURE),
      ),
    ).toMatchObject({ request: { abiSignature: VALID_ABI_SIGNATURE } });

    const recursive = JSON.stringify({
      components: [
        {
          components: [
            { internalType: "address", name: "owner", type: "address" },
          ],
          internalType: "struct Inner",
          name: "inner",
          type: "tuple",
        },
      ],
      internalType: "struct Outer",
      name: "result",
      type: "tuple",
    });
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse(withAbiSignature(recursive))
        .success,
    ).toBe(true);
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse(
        withAbiSignature(JSON.stringify(nestedTuple(8))),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["legacy Solidity shorthand", "{uint256 value}"],
    ["malformed JSON", "{"],
    ["top-level array", JSON.stringify([{ name: "value", type: "uint256" }])],
    ["missing root name", JSON.stringify({ type: "uint256" })],
    ["blank root type", JSON.stringify({ name: "value", type: "" })],
    [
      "tuple without components",
      JSON.stringify({ name: "value", type: "tuple" }),
    ],
    [
      "primitive with components",
      JSON.stringify({
        components: [{ name: "child", type: "uint256" }],
        name: "value",
        type: "uint256",
      }),
    ],
    [
      "unknown descriptor fields",
      JSON.stringify({ name: "value", type: "uint256", selector: "secret" }),
    ],
    ["more than eight nested tuple levels", JSON.stringify(nestedTuple(9))],
    [
      "more than 2048 serialized characters",
      JSON.stringify({ name: "x".repeat(2_050), type: "uint256" }),
    ],
  ])("rejects %s", (_label, abiSignature) => {
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse(
        withAbiSignature(abiSignature),
      ).success,
    ).toBe(false);
  });

  it("rejects malformed nested components recursively", () => {
    const invalid = JSON.stringify({
      components: [
        {
          components: [{ internalType: "uint256", name: "", type: "" }],
          name: "inner",
          type: "tuple",
        },
      ],
      name: "result",
      type: "tuple",
    });
    expect(
      Contracts.Web2JsonManifestV1Schema.safeParse(withAbiSignature(invalid))
        .success,
    ).toBe(false);
  });
});

describe("CreateRunResultV1 public response contract", () => {
  const accepted = {
    status: "accepted",
    runId: "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
    location: "/v1/runs/run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
  };

  it("accepts one strict persisted run identity", () => {
    expect(createRunResultSchema().parse(accepted)).toEqual(accepted);
  });

  it.each([
    ["missing status", { runId: accepted.runId, location: accepted.location }],
    ["wrong status", { ...accepted, status: "queued" }],
    ["blank run id", { ...accepted, runId: "" }],
    ["path-traversal run id", { ...accepted, runId: "../settings" }],
    ["overlong run id", { ...accepted, runId: `run_${"x".repeat(129)}` }],
    ["absolute location", { ...accepted, location: "https://evil.example/runs/1" }],
    ["mismatched location", { ...accepted, location: "/v1/runs/run_other" }],
    ["extra response fields", { ...accepted, token: "project_secret" }],
  ])("rejects %s", (_label, candidate) => {
    expect(createRunResultSchema().safeParse(candidate).success).toBe(false);
  });
});
