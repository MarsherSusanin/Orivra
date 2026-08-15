import fdcVerificationAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcVerification.sol/IFdcVerification.json";
import {
  canonicalSerializeProofBundle,
  canonicalizeManifestUrl,
  createProofBundle,
} from "../../domain/src/index";
import {
  RELEASE_COMMIT_SHA,
  RELEASE_TREE_SHA,
} from "../../contracts/test/slice024a-canonical-url-attack.fixtures";
import { makeBundleInput, makeRunEvents } from "../../contracts/test/fixtures";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  padHex,
  stringToHex,
  type Abi,
  type AbiParameter,
  type Hex,
} from "viem";

export const NEAR_MAX_TRANSFORMED_PAYLOAD_BYTES = 1_048_000;
export const NEAR_MAX_RESPONSE_BYTES = 1_049_280;
export const NEAR_MAX_CALLDATA_BYTES = 1_049_412;
export const BYTES_ABI_SIGNATURE = JSON.stringify({
  name: "value",
  type: "bytes",
});
export const OPEN_METEO_ABI_SIGNATURE =
  '{"components":[{"internalType":"int256","name":"temperatureTenthsCelsius","type":"int256"},{"internalType":"string","name":"observedAt","type":"string"}],"name":"data","type":"tuple"}';

function proofParameters(): { proof: AbiParameter; data: AbiParameter } {
  const verifier = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }>;
  const proof = verifier.inputs[0];
  if (proof.type !== "tuple" || !("components" in proof)) {
    throw new Error("test requires the official Web2Json proof tuple");
  }
  const data = proof.components.find((component) => component.name === "data");
  if (!data) throw new Error("test requires official Web2Json response data");
  return { proof, data };
}

function makeAbiValidPersistedBundle(
  role: "attack" | "control",
  options: {
    payloadBytes?: number;
    merkleProofEntries?: number;
    controlRequestPath?: string;
    attackCommitSha?: string;
    attackSourceUrl?: string;
  } = {},
) {
  const base = makeBundleInput();
  const runId = `run_024_runtime_${role}`;
  const host =
    role === "attack" ? "cdn.jsdelivr.net" : "api.open-meteo.com";
  const mode = role === "attack" ? "wallet" : "relayer";
  const votingRound = role === "attack" ? 61_024 : 61_025;
  const transactionHash = `0x${role === "attack" ? "3" : "4"}${"0".repeat(63)}`;
  const abiSignature =
    options.payloadBytes === undefined
      ? OPEN_METEO_ABI_SIGNATURE
      : BYTES_ABI_SIGNATURE;
  const manifest = {
    ...base.manifest,
    request: {
      ...base.manifest.request,
      url:
        role === "attack"
          ? options.attackSourceUrl ??
            `https://${host}/gh/MarsherSusanin/Orivra@${options.attackCommitSha ?? "a".repeat(40)}/examples/canonical-url-attack/attack-response.json`
          : `https://${host}${options.controlRequestPath ?? "/v1/forecast"}`,
      query: {
        current: "temperature_2m",
        forecast_days: "1",
        latitude: "52.52",
        longitude: "13.41",
        temperature_unit: "celsius",
        timezone: "UTC",
      },
      jq: ".current | {temperatureTenthsCelsius: (.temperature_2m * 10), observedAt: .time}",
      abiSignature,
    },
    consumer: {
      expectedScheme: "https" as const,
      expectedHost:
        role === "attack" && options.attackSourceUrl !== undefined
          ? new URL(options.attackSourceUrl).hostname
          : host,
      expectedPathPrefix:
        role === "attack"
          ? new URL(
              options.attackSourceUrl ??
                `https://${host}/gh/MarsherSusanin/Orivra@${options.attackCommitSha ?? "a".repeat(40)}/examples/canonical-url-attack/attack-response.json`,
            ).pathname
          : "/v1/forecast",
      expectedQuery: {
        current: "temperature_2m",
        forecast_days: "1",
        latitude: "52.52",
        longitude: "13.41",
        temperature_unit: "celsius",
        timezone: "UTC",
      },
    },
    submission: { ...base.manifest.submission, mode },
  };
  const canonicalUrl = canonicalizeManifestUrl(manifest);
  const encodedValue =
    options.payloadBytes === undefined
      ? encodeAbiParameters(
          [JSON.parse(OPEN_METEO_ABI_SIGNATURE) as AbiParameter],
          [{
            temperatureTenthsCelsius: role === "attack" ? 215n : 216n,
            observedAt: "2026-08-15T05:00",
          }],
        )
      : encodeAbiParameters(
          [JSON.parse(BYTES_ABI_SIGNATURE) as AbiParameter],
          [
            `0x${(role === "attack" ? "a5" : "5a").repeat(
              options.payloadBytes,
            )}`,
          ],
        );
  const { data: dataParameter } = proofParameters();
  const response = encodeAbiParameters(
    [dataParameter],
    [
      {
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
      },
    ],
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
  const proofNode = `0x${role === "attack" ? "5" : "6"}${"0".repeat(63)}`;
  return createProofBundle({
    ...base,
    runId,
    manifest,
    events,
    proof: {
      votingRound,
      merkleProof: Array(options.merkleProofEntries ?? 1).fill(proofNode),
      response,
    },
  } as any);
}

export function makeAbiValidPersistedBundlePair(
  options: {
    payloadBytes?: number;
    merkleProofEntries?: number;
    controlRequestPath?: string;
    attackCommitSha?: string;
    attackSourceUrl?: string;
  } = {},
) {
  return {
    attack: makeAbiValidPersistedBundle("attack", options),
    control: makeAbiValidPersistedBundle("control", options),
  };
}

export function makeRuntimeInput(
  options: {
    payloadBytes?: number;
    merkleProofEntries?: number;
    controlRequestPath?: string;
    attackCommitSha?: string;
    attackSourceUrl?: string;
  } = {},
) {
  return runtimeInputForPair(makeAbiValidPersistedBundlePair(options));
}

export function runtimeInputForPair(
  pair: ReturnType<typeof makeAbiValidPersistedBundlePair>,
) {
  const { attack, control } = pair;
  return {
    attackRunId: attack.runId,
    attackBundle: canonicalSerializeProofBundle(attack),
    controlRunId: control.runId,
    controlBundle: canonicalSerializeProofBundle(control),
    release: { commitSha: RELEASE_COMMIT_SHA, treeSha: RELEASE_TREE_SHA },
  };
}

export function encodePersistedConsumerCalldata(bundle: {
  proof: { response: string; merkleProof: string[] };
}): Hex {
  const { proof, data } = proofParameters();
  const [decoded] = decodeAbiParameters(
    [data],
    bundle.proof.response as Hex,
  );
  const consumerAbi = [
    {
      type: "function",
      name: "consume",
      stateMutability: "view",
      inputs: [proof],
      outputs: [{ name: "", type: "bytes" }],
    },
  ] as Abi;
  return encodeFunctionData({
    abi: consumerAbi,
    functionName: "consume",
    args: [{ merkleProof: bundle.proof.merkleProof, data: decoded }],
  } as any);
}
