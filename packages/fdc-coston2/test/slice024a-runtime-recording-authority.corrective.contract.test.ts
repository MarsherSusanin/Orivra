// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fdcVerificationAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcVerification.sol/IFdcVerification.json";
import {
  encodeAbiParameters,
  padHex,
  stringToHex,
  type Abi,
  type AbiParameter,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  canonicalSerializeProofBundle,
  canonicalizeManifestUrl,
  createProofBundle,
  replayCanonicalUrlAttackRecording,
} from "../../domain/src/index";
import {
  RELEASE_COMMIT_SHA,
  RELEASE_TREE_SHA,
  sha256,
} from "../../contracts/test/slice024a-canonical-url-attack.fixtures";
import {
  VALID_ABI_SIGNATURE,
  makeBundleInput,
  makeRunEvents,
} from "../../contracts/test/fixtures";
import * as FdcCoston2 from "../src/index";

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

function proofDataParameter(): AbiParameter {
  const verifier = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }>;
  const proof = verifier.inputs[0];
  if (proof.type !== "tuple" || !("components" in proof)) {
    throw new Error("test requires the official Web2Json proof tuple");
  }
  const data = proof.components.find((component) => component.name === "data");
  if (!data) throw new Error("test requires official Web2Json response data");
  return data;
}

function makeAbiValidPersistedBundle(role: "attack" | "control") {
  const base = makeBundleInput();
  const runId = `run_024_runtime_${role}`;
  const host = role === "attack" ? "attacker.example" : "api.example.com";
  const mode = role === "attack" ? "wallet" : "relayer";
  const votingRound = role === "attack" ? 61_024 : 61_025;
  const transactionHash = `0x${role === "attack" ? "3" : "4"}${"0".repeat(63)}`;
  const manifest = {
    ...base.manifest,
    request: {
      ...base.manifest.request,
      url: `https://${host}/prices/eth?source=primary`,
      query: { currency: "USD", window: "1h" },
      jq: ".price | {value: (. * 1000000 | floor)}",
      abiSignature: VALID_ABI_SIGNATURE,
    },
    consumer: {
      expectedScheme: "https" as const,
      expectedHost: host,
      expectedPathPrefix: "/prices/",
      expectedQuery: { currency: "USD", source: "primary", window: "1h" },
    },
    submission: { ...base.manifest.submission, mode },
  };
  const canonicalUrl = canonicalizeManifestUrl(manifest);
  const encodedValue = encodeAbiParameters(
    [JSON.parse(VALID_ABI_SIGNATURE) as AbiParameter],
    [{ value: role === "attack" ? 1_000_000n : 1_000_001n }],
  );
  const response = encodeAbiParameters(
    [proofDataParameter()],
    [{
      attestationType: padHex(stringToHex("Web2Json"), { size: 32 }),
      sourceId: padHex(stringToHex("WEB2"), { size: 32 }),
      votingRound: BigInt(votingRound),
      lowestUsedTimestamp: 1_786_255_200n,
      requestBody: {
        url: canonicalUrl,
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "",
        postProcessJq: manifest.request.jq,
        abiSignature: manifest.request.abiSignature,
      },
      responseBody: { abiEncodedData: encodedValue },
    }],
  );
  const events = makeRunEvents().map((event) => {
    const common = { ...event, runId };
    switch (event.type) {
      case "RUN_CREATED":
        return { ...common, payload: { manifest } };
      case "PREFLIGHT_ACCEPTED":
        return { ...common, payload: { ...event.payload, canonicalUrl } };
      case "REQUEST_SUBMITTED":
        return { ...common, payload: { mode, transactionHash } };
      case "ROUND_FINALIZED":
        return { ...common, payload: { votingRound } };
      default:
        return common;
    }
  });
  return createProofBundle({
    ...base,
    runId,
    manifest,
    events,
    proof: {
      votingRound,
      merkleProof: [`0x${role === "attack" ? "5" : "6"}${"0".repeat(63)}`],
      response,
    },
  } as any);
}

function runtimeInput() {
  const attack = makeAbiValidPersistedBundle("attack");
  const control = makeAbiValidPersistedBundle("control");
  return {
    attackRunId: attack.runId,
    attackBundle: canonicalSerializeProofBundle(attack),
    controlRunId: control.runId,
    controlBundle: canonicalSerializeProofBundle(control),
    release: { commitSha: RELEASE_COMMIT_SHA, treeSha: RELEASE_TREE_SHA },
  };
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

  raw.executions[0].calldata = "0xaaaa";
  raw.executions[1].calldata = "0xaaaa";
  raw.executions[2].calldata = "0xbbbb";
  value.transcript.executions[0].calldataSha256 = sha256Hex("0xaaaa");
  value.transcript.executions[1].calldataSha256 = sha256Hex("0xaaaa");
  value.transcript.executions[2].calldataSha256 = sha256Hex("0xbbbb");
  raw.executions[0].result.returnData = "0x1111";
  raw.executions[1].result.revertData = "0xb828610a";
  raw.executions[2].result.returnData = "0x2222";
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

  it("records exact checked-in sources, compiler material, bytecodes, calldata and raw results", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(runtimeInput());
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
    expect(recording.reproduction.executions).toHaveLength(3);
  });

  it("generates an exact-proof-hash verifier shim and executes the exact three calls", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(runtimeInput());
    const recording = replayCanonicalUrlAttackRecording(serialized);
    const shim = recording.reproduction.sources.exactProofVerifier.content;

    expect(shim).toMatch(
      /sha256\s*\(\s*abi\.encode\s*\(\s*proof\.data\s*\)\s*\)/,
    );
    expect(shim).toContain(recording.bundles.attack.proofSha256.slice(7));
    expect(shim).toContain(recording.bundles.control.proofSha256.slice(7));
    expect(recording.reproduction.executions.map((execution: any) => ({
      scenario: execution.scenario,
      consumer: execution.consumer,
      status: execution.result.status,
    }))).toEqual([
      { scenario: "attack", consumer: "canonical-vulnerable", status: "accepted" },
      { scenario: "attack", consumer: "canonical-safe", status: "reverted" },
      { scenario: "control", consumer: "canonical-safe", status: "accepted" },
    ]);
    expect(recording.reproduction.executions[1].result.revertData).toBe(
      "0xb828610a",
    );
  });

  it("recompiles and reexecutes before returning runtime-verified import authority", async () => {
    const runtime = createRuntime();
    const serialized = await runtime.recordCanonicalUrlAttack(runtimeInput());
    await expect(
      runtime.verifyCanonicalUrlAttackRecording(serialized),
    ).resolves.toMatchObject({
      status: "runtime-verified",
      recordingChecksum: replayCanonicalUrlAttackRecording(serialized).checksum,
    });
  });

  it("rejects a canonical and rechecksummed but wholly fabricated self-consistent transcript", async () => {
    const runtime = createRuntime();
    const legitimate = await runtime.recordCanonicalUrlAttack(runtimeInput());
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
      runtime.recordCanonicalUrlAttack(runtimeInput()),
    ).rejects.toThrow(/source|compile|canonical/i);
  });
});
