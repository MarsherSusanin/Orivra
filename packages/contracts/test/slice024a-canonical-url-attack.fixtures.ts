import { createHash } from "node:crypto";
import {
  canonicalSerializeProofBundle,
  canonicalizeManifestUrl,
  createProofBundle,
} from "../../domain/src/index";
import {
  VALID_ABI_SIGNATURE,
  makeBundleInput,
  makeRunEvents,
} from "./fixtures";

export const ATTACK_RUN_ID = "run_024_attack_live";
export const CONTROL_RUN_ID = "run_024_control_live";
export const RELEASE_COMMIT_SHA = "a".repeat(40);
export const RELEASE_TREE_SHA = "b".repeat(40);
export const HOST_MISMATCH_SELECTOR = "0xb828610a";
export const RESPONSE_SHAPE_SHA256 = sha256("{\"value\":\"uint256\"}");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite test value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`unsupported test value ${typeof value}`);
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256HexBytes(value: string): string {
  return sha256(Buffer.from(value.slice(2), "hex"));
}

function makeLiveBundle(role: "attack" | "control") {
  const base = makeBundleInput();
  const runId = role === "attack" ? ATTACK_RUN_ID : CONTROL_RUN_ID;
  const sourceHost = role === "attack" ? "attacker.example" : "api.example.com";
  const submissionMode = role === "attack" ? "wallet" : "relayer";
  const votingRound = role === "attack" ? 52_410 : 52_411;
  const transactionHash = `0x${role === "attack" ? "1" : "2"}${"0".repeat(63)}`;
  const manifest = {
    ...base.manifest,
    request: {
      ...base.manifest.request,
      url: `https://${sourceHost}/prices/eth?source=primary`,
      method: "GET" as const,
      query: { currency: "USD", window: "1h" },
      jq: ".price | {value: (. * 1000000 | floor)}",
      abiSignature: VALID_ABI_SIGNATURE,
    },
    consumer: {
      expectedScheme: "https" as const,
      expectedHost: sourceHost,
      expectedPathPrefix: "/prices/",
      expectedQuery: {
        currency: "USD",
        source: "primary",
        window: "1h",
      },
    },
    submission: {
      ...base.manifest.submission,
      mode: submissionMode,
    },
  };
  const canonicalUrl = canonicalizeManifestUrl(manifest);
  const events = makeRunEvents().map((event) => {
    const common = { ...event, runId };
    switch (event.type) {
      case "RUN_CREATED":
        return { ...common, payload: { manifest } };
      case "PREFLIGHT_ACCEPTED":
        return {
          ...common,
          payload: { ...event.payload, canonicalUrl },
        };
      case "REQUEST_SUBMITTED":
        return {
          ...common,
          payload: { mode: submissionMode, transactionHash },
        };
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
      ...base.proof,
      votingRound,
      response: role === "attack" ? "0x1234a024" : "0x1234c024",
    },
  } as any);
}

function bundleEvidence(role: "attack" | "control") {
  const bundle = makeLiveBundle(role);
  const canonicalBundle = canonicalSerializeProofBundle(bundle);
  const submitted = bundle.events.find(
    (event) => event.type === "REQUEST_SUBMITTED",
  );
  if (submitted?.type !== "REQUEST_SUBMITTED") {
    throw new Error("test live bundle has no transaction");
  }

  return {
    role,
    provenance: "persisted-live-coston2" as const,
    runId: bundle.runId,
    submissionMode: bundle.manifest.submission.mode,
    requestedUrl: canonicalizeManifestUrl(bundle.manifest),
    canonicalBundle,
    canonicalBundleUtf8Bytes: new TextEncoder().encode(canonicalBundle).byteLength,
    canonicalBundleSha256: sha256(canonicalBundle),
    bundleChecksum: bundle.checksum,
    lastSequence: bundle.events.at(-1)?.sequence,
    transactionHash: submitted.payload.transactionHash,
    votingRound: bundle.proof.votingRound,
    proofSha256: sha256HexBytes(bundle.proof.response),
    transformedResponseShapeSha256: RESPONSE_SHAPE_SHA256,
  };
}

export function makeCanonicalUrlAttackRecordingContent() {
  const attack = bundleEvidence("attack");
  const control = bundleEvidence("control");
  const vulnerableRuntimeSha256 = sha256("vulnerable-runtime-bytecode");
  const safeRuntimeSha256 = sha256("safe-runtime-bytecode");
  const attackCalldataSha256 = sha256("attack-consume-calldata");
  const controlCalldataSha256 = sha256("control-consume-calldata");

  return {
    version: "1" as const,
    kind: "canonical-url-attack-recording" as const,
    recordedAt: "2026-08-09T12:00:00.000Z",
    release: {
      commitSha: RELEASE_COMMIT_SHA,
      treeSha: RELEASE_TREE_SHA,
    },
    network: {
      name: "coston2" as const,
      chainId: 114 as const,
      evidenceSource: "persisted-api" as const,
    },
    statement: "Valid proof ≠ trusted URL" as const,
    sharedRequest: {
      method: "GET" as const,
      query: { currency: "USD", window: "1h" },
      jq: ".price | {value: (. * 1000000 | floor)}",
      abiSignature: VALID_ABI_SIGNATURE,
      transformedResponseShapeSha256: RESPONSE_SHAPE_SHA256,
    },
    bundles: { attack, control },
    toolchain: {
      compiler: {
        name: "solc" as const,
        version: "0.8.36",
        inputSha256: sha256("compiler-input"),
        outputSha256: sha256("compiler-output"),
        optimizer: { enabled: true as const, runs: 200 },
        evmVersion: "cancun" as const,
      },
      runtime: {
        name: "@ethereumjs/vm" as const,
        version: "10.1.2",
        hardfork: "cancun" as const,
      },
    },
    consumers: {
      vulnerable: {
        identity: "canonical-vulnerable" as const,
        contractName: "CanonicalVulnerableWeb2JsonConsumer",
        sourceSha256: sha256("vulnerable-source"),
        creationBytecodeSha256: sha256("vulnerable-creation-bytecode"),
        runtimeBytecodeSha256: vulnerableRuntimeSha256,
      },
      safe: {
        identity: "canonical-safe" as const,
        contractName: "CanonicalSafeWeb2JsonConsumer",
        sourceSha256: sha256("safe-source"),
        creationBytecodeSha256: sha256("safe-creation-bytecode"),
        runtimeBytecodeSha256: safeRuntimeSha256,
      },
      invariantLibrary: {
        contractName: "ProoflineUrlInvariant",
        sourceSha256: sha256("url-invariant-source"),
        hostMismatchSelector: HOST_MISMATCH_SELECTOR,
      },
    },
    transcript: {
      executions: [
        {
          scenario: "attack" as const,
          consumer: "canonical-vulnerable" as const,
          proofSha256: attack.proofSha256,
          calldataSha256: attackCalldataSha256,
          runtimeBytecodeSha256: vulnerableRuntimeSha256,
          result: {
            status: "accepted" as const,
            returnDataSha256: sha256("attack-return-data"),
          },
        },
        {
          scenario: "attack" as const,
          consumer: "canonical-safe" as const,
          proofSha256: attack.proofSha256,
          calldataSha256: attackCalldataSha256,
          runtimeBytecodeSha256: safeRuntimeSha256,
          result: {
            status: "reverted" as const,
            error: "HostMismatch()" as const,
            selector: HOST_MISMATCH_SELECTOR,
            revertDataSha256: sha256(HOST_MISMATCH_SELECTOR),
          },
        },
        {
          scenario: "control" as const,
          consumer: "canonical-safe" as const,
          proofSha256: control.proofSha256,
          calldataSha256: controlCalldataSha256,
          runtimeBytecodeSha256: safeRuntimeSha256,
          result: {
            status: "accepted" as const,
            returnDataSha256: sha256("control-return-data"),
          },
        },
      ],
    },
  };
}

export function makeCanonicalUrlAttackRecording() {
  const content = makeCanonicalUrlAttackRecordingContent();
  return {
    ...content,
    checksum: sha256(canonicalJson(content)),
  };
}

export function canonicalSerializeTestRecording(): string {
  return canonicalJson(makeCanonicalUrlAttackRecording());
}
