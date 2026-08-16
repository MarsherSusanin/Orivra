// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { replayCanonicalUrlAttackRecording } from "../../domain/src/index";
import { sha256 } from "../../contracts/test/slice024a-canonical-url-attack.fixtures";
import * as FdcCoston2 from "../src/index";
import {
  NEAR_MAX_CALLDATA_BYTES,
  NEAR_MAX_RESPONSE_BYTES,
  NEAR_MAX_TRANSFORMED_PAYLOAD_BYTES,
  encodePersistedConsumerCalldata,
  makeAbiValidPersistedBundlePair,
  makeRuntimeInput,
  runtimeInputForPair,
} from "./slice024a-runtime-recording.fixtures";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fdc = FdcCoston2 as Record<string, any>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function sha256Hex(value: Hex): string {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(value.slice(2), "hex"))
    .digest("hex")}`;
}

function createRuntime() {
  expect(fdc.createProductionCanonicalUrlAttackRuntime).toBeTypeOf("function");
  return fdc.createProductionCanonicalUrlAttackRuntime({
    readCheckedInSource: (path: string) => readFile(join(repoRoot, path), "utf8"),
    now: () => "2026-08-09T12:00:00.000Z",
  });
}

function rechecksum(value: Record<string, any>): string {
  const { checksum: _checksum, ...content } = value;
  return canonicalJson({ ...content, checksum: sha256(canonicalJson(content)) });
}

function forgeEveryRuntimeClaim(serialized: string): string {
  const value = JSON.parse(serialized);
  const fakeSource = (name: string) =>
    `// wholly fabricated but self-consistent ${name}\ncontract ${name} {}\n`;
  for (const [name, source] of Object.entries(value.reproduction.sources) as Array<
    [string, any]
  >) {
    source.content = fakeSource(name);
    source.sha256 = sha256(source.content);
  }
  value.consumers.vulnerable.sourceSha256 =
    value.reproduction.sources.vulnerable.sha256;
  value.consumers.safe.sourceSha256 = value.reproduction.sources.safe.sha256;
  value.consumers.invariantLibrary.sourceSha256 =
    value.reproduction.sources.invariantLibrary.sha256;

  const input = JSON.parse(value.reproduction.standardJson.input);
  for (const source of Object.values(value.reproduction.sources) as any[]) {
    input.sources[source.path] = { content: source.content };
  }
  value.reproduction.standardJson.input = canonicalJson(input);
  value.toolchain.compiler.inputSha256 = sha256(
    value.reproduction.standardJson.input,
  );
  value.reproduction.standardJson.output = canonicalJson({
    contracts: { fabricated: { output: true } },
  });
  value.toolchain.compiler.outputSha256 = sha256(
    value.reproduction.standardJson.output,
  );

  const raw = value.reproduction;
  raw.bytecode.vulnerable.creation = "0x600a";
  raw.bytecode.vulnerable.runtime = "0x600b";
  raw.bytecode.safe.creation = "0x600c";
  raw.bytecode.safe.runtime = "0x600d";
  raw.bytecode.exactProofVerifier.runtime = "0x600e";
  raw.bytecode.exactProofVerifier.runtimeSha256 = sha256Hex("0x600e");
  value.consumers.vulnerable.creationBytecodeSha256 = sha256Hex("0x600a");
  value.consumers.vulnerable.runtimeBytecodeSha256 = sha256Hex("0x600b");
  value.consumers.safe.creationBytecodeSha256 = sha256Hex("0x600c");
  value.consumers.safe.runtimeBytecodeSha256 = sha256Hex("0x600d");
  value.transcript.executions[0].runtimeBytecodeSha256 = sha256Hex("0x600b");
  value.transcript.executions[1].runtimeBytecodeSha256 = sha256Hex("0x600d");
  value.transcript.executions[2].runtimeBytecodeSha256 = sha256Hex("0x600d");

  raw.transformedResponseShapeCanonicalJson = canonicalJson({ fabricated: true });
  const shapeHash = sha256(raw.transformedResponseShapeCanonicalJson);
  value.sharedRequest.transformedResponseShapeSha256 = shapeHash;
  value.bundles.attack.transformedResponseShapeSha256 = shapeHash;
  value.bundles.control.transformedResponseShapeSha256 = shapeHash;

  value.transcript.executions[0].calldataSha256 = sha256Hex("0xaaaa");
  value.transcript.executions[1].calldataSha256 = sha256Hex("0xaaaa");
  value.transcript.executions[2].calldataSha256 = sha256Hex("0xbbbb");
  value.transcript.executions[0].result.returnDataSha256 = sha256Hex("0x1111");
  value.transcript.executions[1].result.revertDataSha256 =
    sha256Hex("0xb828610a");
  value.transcript.executions[2].result.returnDataSha256 = sha256Hex("0x2222");
  return rechecksum(value);
}

describe("Slice 024A trusted compiler/EVM recording authority", () => {
  it("exports one concrete production recorder and runtime verifier from the FDC adapter boundary", () => {
    expect(fdc.createProductionCanonicalUrlAttackRuntime).toBeTypeOf("function");
  });

  it("records exact checked-in sources and compiler material without duplicated execution payloads", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(makeRuntimeInput());
    const recording = replayCanonicalUrlAttackRecording(serialized);

    for (const name of ["vulnerable", "safe", "invariantLibrary"] as const) {
      const source = recording.reproduction.sources[name];
      await expect(readFile(join(repoRoot, source.path), "utf8")).resolves.toBe(
        source.content,
      );
      expect(source.sha256).toBe(sha256(source.content));
    }
    const compilerInput = JSON.parse(recording.reproduction.standardJson.input);
    expect(compilerInput.sources[recording.reproduction.sources.safe.path].content)
      .toBe(recording.reproduction.sources.safe.content);
    expect(recording.reproduction.bytecode.safe.creation).toMatch(/^0x[0-9a-f]+$/);
    expect(recording.reproduction.bytecode.safe.runtime).toMatch(/^0x[0-9a-f]+$/);
    expect(recording.reproduction).not.toHaveProperty("executions");
    expect(recording.transcript.executions).toHaveLength(3);
  });

  it("generates an exact-proof-hash verifier shim and executes the exact three calls", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(makeRuntimeInput());
    const recording = replayCanonicalUrlAttackRecording(serialized);
    const shim = recording.reproduction.sources.exactProofVerifier.content;

    expect(shim).toMatch(
      /sha256\s*\(\s*abi\.encode\s*\(\s*proof\.data\s*\)\s*\)/,
    );
    expect(shim).toContain(recording.bundles.attack.proofSha256.slice(7));
    expect(shim).toContain(recording.bundles.control.proofSha256.slice(7));
    expect(recording.transcript.executions.map((execution: any) => ({
      scenario: execution.scenario,
      consumer: execution.consumer,
      status: execution.result.status,
    }))).toEqual([
      { scenario: "attack", consumer: "canonical-vulnerable", status: "accepted" },
      { scenario: "attack", consumer: "canonical-safe", status: "reverted" },
      { scenario: "control", consumer: "canonical-safe", status: "accepted" },
    ]);
    expect(recording.transcript.executions[1].result).toMatchObject({
      status: "reverted",
      selector: "0xb828610a",
    });
  });

  it("rejects an Open-Meteo descendant path instead of treating the exact demo path as a prefix", async () => {
    const runtime = createRuntime();
    await expect(runtime.recordCanonicalUrlAttack(makeRuntimeInput({
      controlRequestPath: "/v1/forecast/other",
    }))).rejects.toThrow(/control|safe|EVM|revert/i);
  });

  it("rejects an attack source whose immutable GitHub CDN revision is not the recorded release commit", async () => {
    let sourceReads = 0;
    const runtime = fdc.createProductionCanonicalUrlAttackRuntime({
      readCheckedInSource: async () => {
        sourceReads += 1;
        throw new Error("must not read sources");
      },
      now: () => "2026-08-09T12:00:00.000Z",
    });
    await expect(runtime.recordCanonicalUrlAttack(makeRuntimeInput({
      attackCommitSha: "c".repeat(40),
    }))).rejects.toThrow(/attack source|release commit|provenance/i);
    expect(sourceReads).toBe(0);
  });

  it.each([
    [
      "unrelated host",
      `https://example.com/gh/MarsherSusanin/Orivra@${"a".repeat(40)}/examples/canonical-url-attack/attack-response.json`,
    ],
    [
      "unrelated repository path",
      `https://cdn.jsdelivr.net/gh/other/Orivra@${"a".repeat(40)}/examples/canonical-url-attack/attack-response.json`,
    ],
    [
      "unrelated artifact path",
      `https://cdn.jsdelivr.net/gh/MarsherSusanin/Orivra@${"a".repeat(40)}/examples/canonical-url-attack/other.json`,
    ],
    [
      "raw GitHub content-type-incompatible origin",
      `https://raw.githubusercontent.com/MarsherSusanin/Orivra/${"a".repeat(40)}/examples/canonical-url-attack/attack-response.json`,
    ],
  ])("rejects an attack source with an %s", async (_name, attackSourceUrl) => {
    const runtime = createRuntime();
    await expect(runtime.recordCanonicalUrlAttack(makeRuntimeInput({
      attackSourceUrl,
    }))).rejects.toThrow(/attack source|provenance/i);
  });

  it("recompiles and reexecutes before returning runtime-verified import authority", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(makeRuntimeInput());
    await expect(
      runtime.verifyCanonicalUrlAttackRecording(serialized),
    ).resolves.toMatchObject({
      status: "runtime-verified",
      recordingChecksum: replayCanonicalUrlAttackRecording(serialized).checksum,
    });
  });

  it("rejects a canonical and rechecksummed but wholly fabricated self-consistent transcript", async () => {
    const runtime = createRuntime();
    const legitimate = await runtime.recordCanonicalUrlAttack(makeRuntimeInput());
    const forged = forgeEveryRuntimeClaim(legitimate);

    expect(() => replayCanonicalUrlAttackRecording(forged)).not.toThrow();
    await expect(
      runtime.verifyCanonicalUrlAttackRecording(forged),
    ).rejects.toThrow(/checked-in source|compiler|bytecode|calldata|EVM|runtime/i);
  });

  it("fails closed when any checked-in canonical source cannot be reread exactly", async () => {
    expect(fdc.createProductionCanonicalUrlAttackRuntime).toBeTypeOf("function");
    const runtime = fdc.createProductionCanonicalUrlAttackRuntime({
      readCheckedInSource: async (path: string) =>
        path.endsWith("CanonicalSafeWeb2JsonConsumer.sol")
          ? "contract ForgedSafe {}\n"
          : readFile(join(repoRoot, path), "utf8"),
      now: () => "2026-08-09T12:00:00.000Z",
    });
    await expect(
      runtime.recordCanonicalUrlAttack(makeRuntimeInput()),
    ).rejects.toThrow(/source|compile|canonical/i);
  });

  it.each(["ENOENT", "EACCES"])(
    "normalizes %s source reads to one bounded public code and message",
    async (sourceCode) => {
      expect(fdc.createProductionCanonicalUrlAttackRuntime).toBeTypeOf("function");
      const runtime = fdc.createProductionCanonicalUrlAttackRuntime({
        readCheckedInSource: async (path: string) => {
          throw Object.assign(
            new Error(`${sourceCode}: open '/Users/private/Proofline/${path}'`),
            { code: sourceCode },
          );
        },
        now: () => "2026-08-09T12:00:00.000Z",
      });
      const error = await runtime
        .recordCanonicalUrlAttack(makeRuntimeInput())
        .catch((failure: unknown) => failure);

      expect(error).toMatchObject({
        code: "CANONICAL_SOURCE_READ_FAILED",
        message: "Canonical URL attack source read failed",
      });
      expect(Buffer.byteLength((error as Error).message, "utf8")).toBeLessThanOrEqual(96);
      expect((error as Error).message).not.toMatch(
        /ENOENT|EACCES|\/Users\/|Canonical(?:Safe|Vulnerable)|ProoflineUrlInvariant|\.sol/i,
      );
    },
  );

  it(
    "records, runtime-verifies and replays two near-1 MiB official-ABI bundles inside 6 MiB",
    async () => {
      const pair = makeAbiValidPersistedBundlePair({
        payloadBytes: NEAR_MAX_TRANSFORMED_PAYLOAD_BYTES,
        merkleProofEntries: 1,
      });
      const attackResponseBytes = (pair.attack.proof.response.length - 2) / 2;
      const attackCalldata = encodePersistedConsumerCalldata(pair.attack);
      const attackCalldataBytes = (attackCalldata.length - 2) / 2;
      expect(attackResponseBytes).toBe(NEAR_MAX_RESPONSE_BYTES);
      expect(pair.attack.proof.response).toHaveLength(
        2 * NEAR_MAX_RESPONSE_BYTES + 2,
      );
      expect(attackCalldataBytes).toBe(NEAR_MAX_CALLDATA_BYTES);
      expect(attackCalldata).toHaveLength(2 * NEAR_MAX_CALLDATA_BYTES + 2);
      expect(attackResponseBytes - NEAR_MAX_TRANSFORMED_PAYLOAD_BYTES).toBe(
        1_280,
      );
      expect(attackCalldataBytes - NEAR_MAX_TRANSFORMED_PAYLOAD_BYTES).toBe(
        1_412,
      );

      const input = runtimeInputForPair(pair);
      expect(Buffer.byteLength(input.attackBundle, "utf8")).toBeLessThanOrEqual(
        2_200_000,
      );
      expect(Buffer.byteLength(input.controlBundle, "utf8")).toBeLessThanOrEqual(
        2_200_000,
      );
      const runtime = createRuntime();
      const serialized = await runtime.recordCanonicalUrlAttack(input);
      expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(4_200_000);
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
        6 * 1_024 * 1_024,
      );
      expect(JSON.parse(serialized).reproduction).not.toHaveProperty(
        "executions",
      );
      await expect(
        runtime.verifyCanonicalUrlAttackRecording(serialized),
      ).resolves.toMatchObject({ status: "runtime-verified" });
      expect(() => replayCanonicalUrlAttackRecording(serialized)).not.toThrow();
    },
    30_000,
  );
});
