import { createHash } from "node:crypto";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import {
  bytesToHex,
  createAddressFromString,
  hexToBytes,
} from "@ethereumjs/util";
import { createVM } from "@ethereumjs/vm";
import fdcVerificationAbi from "@flarenetwork/flare-periphery-contract-artifacts/coston2/artifacts/contracts/IFdcVerification.sol/IFdcVerification.json";
import {
  Web2JsonAbiParameterV1Schema,
  type CanonicalUrlAttackRecordingContentV1,
  type ProofBundleV1,
} from "@proofline/contracts";
import {
  canonicalJson,
  canonicalSerializeCanonicalUrlAttackRecording,
  canonicalizeManifestUrl,
  createCanonicalUrlAttackRecording,
  replayCanonicalUrlAttackRecording,
  replayProofBundle,
} from "@proofline/domain";
import solc from "solc";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  type Abi,
  type AbiParameter,
  type Hex,
} from "viem";

const SOURCE_PATHS = {
  vulnerable: "contracts/CanonicalVulnerableWeb2JsonConsumer.sol",
  safe: "contracts/CanonicalSafeWeb2JsonConsumer.sol",
  invariantLibrary: "contracts/ProoflineUrlInvariant.sol",
  web2JsonInterface:
    "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol",
  contractRegistry:
    "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol",
  exactProofVerifier: "contracts/ProoflineExactProofVerifier.sol",
} as const;

const WEB2JSON_INTERFACE_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
interface IWeb2Json {
    struct RequestBody {
        string url;
        string httpMethod;
        string headers;
        string queryParams;
        string body;
        string postProcessJq;
        string abiSignature;
    }
    struct ResponseBody { bytes abiEncodedData; }
    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint64 votingRound;
        uint64 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }
    struct Proof { bytes32[] merkleProof; Response data; }
}
`;

const CONTRACT_REGISTRY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {IWeb2Json} from "./IWeb2Json.sol";
interface IFdcVerification {
    function verifyWeb2Json(IWeb2Json.Proof calldata proof) external view returns (bool);
}
library ContractRegistry {
    function getFdcVerification() internal pure returns (IFdcVerification) {
        return IFdcVerification(address(0x100));
    }
}
`;

const VERIFIER_ADDRESS = createAddressFromString(
  "0x0000000000000000000000000000000000000100",
);
const VULNERABLE_ADDRESS = createAddressFromString(
  "0x0000000000000000000000000000000000000200",
);
const SAFE_ADDRESS = createAddressFromString(
  "0x0000000000000000000000000000000000000300",
);
const HOST_MISMATCH_SELECTOR = "0xb828610a";
const SOLC_VERSION = "0.8.36";
const VM_VERSION = "10.1.2";
const ATTACK_SOURCE_ORIGIN = "https://cdn.jsdelivr.net";
const ATTACK_SOURCE_REPOSITORY_PATH = "/gh/MarsherSusanin/Orivra@";
const ATTACK_SOURCE_ARTIFACT_PATH =
  "/examples/canonical-url-attack/attack-response.json";
const CONTROL_SOURCE_URL = "https://api.open-meteo.com/v1/forecast";
export const CANONICAL_URL_ATTACK_SOURCE_READ_ERROR_CODE =
  "CANONICAL_SOURCE_READ_FAILED";
export const CANONICAL_URL_ATTACK_SOURCE_READ_ERROR_MESSAGE =
  "Canonical URL attack source read failed";

export class CanonicalUrlAttackSourceReadError extends Error {
  readonly code = CANONICAL_URL_ATTACK_SOURCE_READ_ERROR_CODE;

  constructor() {
    super(CANONICAL_URL_ATTACK_SOURCE_READ_ERROR_MESSAGE);
    this.name = "CanonicalUrlAttackSourceReadError";
  }
}

export interface CanonicalUrlAttackRuntimeInput {
  attackRunId: string;
  attackBundle: string;
  controlRunId: string;
  controlBundle: string;
  release: { commitSha: string; treeSha: string };
}

export interface CanonicalUrlAttackRuntimeVerification {
  status: "runtime-verified";
  recordingChecksum: string;
}

export interface ProductionCanonicalUrlAttackRuntime {
  recordCanonicalUrlAttack(
    input: CanonicalUrlAttackRuntimeInput,
  ): Promise<string>;
  verifyCanonicalUrlAttackRecording(
    serialized: string,
  ): Promise<CanonicalUrlAttackRuntimeVerification>;
}

export interface ProductionCanonicalUrlAttackRuntimeOptions {
  readCheckedInSource(path: string): Promise<string>;
  now(): string;
}

interface DecodedProofData {
  attestationType: Hex;
  sourceId: Hex;
  votingRound: bigint;
  lowestUsedTimestamp: bigint;
  requestBody: {
    url: string;
    httpMethod: string;
    headers: string;
    queryParams: string;
    body: string;
    postProcessJq: string;
    abiSignature: string;
  };
  responseBody: { abiEncodedData: Hex };
}

interface CompiledContract {
  abi: Abi;
  evm: {
    bytecode: { object: string };
    deployedBytecode: { object: string };
  };
}

function assertRuntime(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Canonical URL attack runtime ${message}`);
  }
}

function assertProductionDemoAuthority(
  input: CanonicalUrlAttackRuntimeInput,
  attackBundle: ProofBundleV1,
  controlBundle: ProofBundleV1,
): void {
  assertRuntime(
    /^[a-f0-9]{40}$/.test(input.release.commitSha),
    "release commit identity is malformed",
  );
  const expectedAttackPath =
    `${ATTACK_SOURCE_REPOSITORY_PATH}${input.release.commitSha}` +
    ATTACK_SOURCE_ARTIFACT_PATH;
  const expectedAttackUrl = ATTACK_SOURCE_ORIGIN + expectedAttackPath;
  assertRuntime(
    attackBundle.manifest.request.url === expectedAttackUrl &&
      attackBundle.manifest.consumer.expectedScheme === "https" &&
      attackBundle.manifest.consumer.expectedHost ===
        "cdn.jsdelivr.net" &&
      attackBundle.manifest.consumer.expectedPathPrefix ===
        expectedAttackPath &&
      attackBundle.manifest.submission.mode === "wallet",
    "attack source provenance does not match the recorded release commit",
  );
  assertRuntime(
    controlBundle.manifest.request.url === CONTROL_SOURCE_URL &&
      controlBundle.manifest.consumer.expectedScheme === "https" &&
      controlBundle.manifest.consumer.expectedHost === "api.open-meteo.com" &&
      controlBundle.manifest.consumer.expectedPathPrefix === "/v1/forecast" &&
      controlBundle.manifest.submission.mode === "relayer",
    "control source provenance does not match the canonical Open-Meteo authority",
  );
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hexSha256(value: Hex): string {
  return sha256(Buffer.from(value.slice(2), "hex"));
}

function sourceEvidence<TPath extends string>(path: TPath, content: string) {
  return { path, content, sha256: sha256(content) };
}

function officialProofParameters(): {
  proof: AbiParameter;
  data: AbiParameter;
} {
  const verifier = (fdcVerificationAbi as Abi).find(
    (item) => item.type === "function" && item.name === "verifyWeb2Json",
  ) as Extract<Abi[number], { type: "function" }> | undefined;
  assertRuntime(verifier !== undefined, "official verifier ABI is missing");
  const proof = verifier.inputs[0] as AbiParameter | undefined;
  assertRuntime(
    proof?.type === "tuple" && "components" in proof,
    "official Web2Json proof tuple is missing",
  );
  const data = proof.components?.find((component) => component.name === "data");
  assertRuntime(data !== undefined, "official Web2Json response tuple is missing");
  return { proof, data };
}

function decodePersistedProof(bundle: ProofBundleV1): DecodedProofData {
  const { data: dataParameter } = officialProofParameters();
  const [decoded] = decodeAbiParameters(
    [dataParameter],
    bundle.proof.response as Hex,
  );
  const data = decoded as unknown as DecodedProofData;
  const canonicalResponse = encodeAbiParameters([dataParameter], [decoded]);
  assertRuntime(
    canonicalResponse.toLowerCase() === bundle.proof.response.toLowerCase(),
    "official proof response bytes are not canonical ABI data",
  );
  assertRuntime(
    data.votingRound === BigInt(bundle.proof.votingRound),
    "official proof voting round does not match persisted evidence",
  );
  assertRuntime(
    data.requestBody.url === canonicalizeManifestUrl(bundle.manifest),
    "official proof request URL does not match persisted evidence",
  );
  assertRuntime(
    data.requestBody.httpMethod === bundle.manifest.request.method &&
      data.requestBody.postProcessJq === bundle.manifest.request.jq &&
      data.requestBody.abiSignature === bundle.manifest.request.abiSignature,
    "official proof request identity does not match persisted evidence",
  );
  return data;
}

function exactProofVerifierSource(
  attackProofSha256: string,
  controlProofSha256: string,
): string {
  const attackHash = attackProofSha256.slice("sha256:".length);
  const controlHash = controlProofSha256.slice("sha256:".length);
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
contract ProoflineExactProofVerifier is IFdcVerification {
    bytes32 private constant ATTACK_PROOF_SHA256 = hex"${attackHash}";
    bytes32 private constant CONTROL_PROOF_SHA256 = hex"${controlHash}";
    function verifyWeb2Json(
        IWeb2Json.Proof calldata proof
    ) external pure returns (bool) {
        bytes32 proofHash = sha256(abi.encode(proof.data));
        return proofHash == ATTACK_PROOF_SHA256 || proofHash == CONTROL_PROOF_SHA256;
    }
}
`;
}

function nonEmptyBytecode(value: string, label: string): Hex {
  assertRuntime(
    /^(?:[a-f0-9]{2})+$/.test(value),
    `compiler ${label} bytecode is missing or malformed`,
  );
  return `0x${value}`;
}

function compiledContract(
  output: Record<string, any>,
  path: string,
  name: string,
): CompiledContract {
  const value = output.contracts?.[path]?.[name] as
    | CompiledContract
    | undefined;
  assertRuntime(
    value !== undefined,
    `checked-in source compiler output is missing ${name}`,
  );
  return value;
}

function compileCanonicalSources(input: {
  sources: Record<string, { content: string }>;
}): {
  input: string;
  output: string;
  vulnerable: { abi: Abi; creation: Hex; runtime: Hex };
  safe: { abi: Abi; creation: Hex; runtime: Hex };
  exactProofVerifier: { runtime: Hex };
} {
  const version = solc.version().split("+")[0];
  assertRuntime(version === SOLC_VERSION, "pinned solc version mismatch");
  const standardInput = canonicalJson({
    language: "Solidity",
    sources: input.sources,
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
          ],
        },
      },
    },
  });
  const outputValue = JSON.parse(solc.compile(standardInput));
  const errors = (outputValue.errors ?? []).filter(
    (error: { severity: string }) => error.severity === "error",
  );
  assertRuntime(
    errors.length === 0,
    "checked-in source compiler rejected canonical input",
  );
  const vulnerable = compiledContract(
    outputValue,
    SOURCE_PATHS.vulnerable,
    "CanonicalVulnerableWeb2JsonConsumer",
  );
  const safe = compiledContract(
    outputValue,
    SOURCE_PATHS.safe,
    "CanonicalSafeWeb2JsonConsumer",
  );
  const verifier = compiledContract(
    outputValue,
    SOURCE_PATHS.exactProofVerifier,
    "ProoflineExactProofVerifier",
  );
  return {
    input: standardInput,
    output: canonicalJson(outputValue),
    vulnerable: {
      abi: vulnerable.abi,
      creation: nonEmptyBytecode(
        vulnerable.evm.bytecode.object,
        "vulnerable creation",
      ),
      runtime: nonEmptyBytecode(
        vulnerable.evm.deployedBytecode.object,
        "vulnerable runtime",
      ),
    },
    safe: {
      abi: safe.abi,
      creation: nonEmptyBytecode(safe.evm.bytecode.object, "safe creation"),
      runtime: nonEmptyBytecode(
        safe.evm.deployedBytecode.object,
        "safe runtime",
      ),
    },
    exactProofVerifier: {
      runtime: nonEmptyBytecode(
        verifier.evm.deployedBytecode.object,
        "exact proof verifier runtime",
      ),
    },
  };
}

function responseShape(
  abiSignature: string,
  encodedData: Hex,
): string {
  const descriptor = Web2JsonAbiParameterV1Schema.parse(
    JSON.parse(abiSignature),
  ) as AbiParameter;
  decodeAbiParameters([descriptor], encodedData);
  const descriptorName = descriptor.name;
  assertRuntime(
    typeof descriptorName === "string" && descriptorName.length > 0,
    "transformed response ABI name is missing",
  );
  const shape =
    descriptor.type === "tuple" && "components" in descriptor
      ? Object.fromEntries(
          descriptor.components.map((component) => [
            component.name,
            component.type,
          ]),
        )
      : { [descriptorName]: descriptor.type };
  return canonicalJson(shape);
}

function persistedBundleEvidence(
  role: "attack" | "control",
  bundle: ProofBundleV1,
  canonicalBundle: string,
  transformedResponseShapeSha256: string,
) {
  const submitted = bundle.events.find(
    (event) => event.type === "REQUEST_SUBMITTED",
  );
  assertRuntime(
    submitted?.type === "REQUEST_SUBMITTED",
    "persisted live transaction evidence is missing",
  );
  return {
    role,
    provenance: "persisted-live-coston2" as const,
    runId: bundle.runId,
    submissionMode: submitted.payload.mode,
    requestedUrl: canonicalizeManifestUrl(bundle.manifest),
    canonicalBundle,
    canonicalBundleUtf8Bytes: Buffer.byteLength(canonicalBundle, "utf8"),
    canonicalBundleSha256: sha256(canonicalBundle),
    bundleChecksum: bundle.checksum,
    lastSequence: bundle.events.at(-1)!.sequence,
    transactionHash: submitted.payload.transactionHash.toLowerCase(),
    votingRound: bundle.proof.votingRound,
    proofSha256: hexSha256(bundle.proof.response as Hex),
    transformedResponseShapeSha256,
  };
}

async function executeTranscript(input: {
  verifierRuntime: Hex;
  vulnerableRuntime: Hex;
  safeRuntime: Hex;
  vulnerableAbi: Abi;
  safeAbi: Abi;
  attackBundle: ProofBundleV1;
  controlBundle: ProofBundleV1;
  attackData: DecodedProofData;
  controlData: DecodedProofData;
}) {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
  const vm = await createVM({ common });
  await vm.stateManager.putCode(
    VERIFIER_ADDRESS,
    hexToBytes(input.verifierRuntime),
  );
  const attackProof = {
    merkleProof: input.attackBundle.proof.merkleProof,
    data: input.attackData,
  };
  const controlProof = {
    merkleProof: input.controlBundle.proof.merkleProof,
    data: input.controlData,
  };
  const vulnerableAttackCalldata = encodeFunctionData({
    abi: input.vulnerableAbi,
    functionName: "consume",
    args: [attackProof],
  });
  const safeAttackCalldata = encodeFunctionData({
    abi: input.safeAbi,
    functionName: "consume",
    args: [attackProof],
  });
  const safeControlCalldata = encodeFunctionData({
    abi: input.safeAbi,
    functionName: "consume",
    args: [controlProof],
  });
  assertRuntime(
    vulnerableAttackCalldata === safeAttackCalldata,
    "attack calldata differs between canonical consumers",
  );

  const run = (code: Hex, data: Hex, to: typeof VULNERABLE_ADDRESS) =>
    vm.evm.runCode({
      code: hexToBytes(code),
      data: hexToBytes(data),
      gasLimit: 30_000_000n,
      isStatic: true,
      to,
    });
  const vulnerableAttack = await run(
    input.vulnerableRuntime,
    vulnerableAttackCalldata,
    VULNERABLE_ADDRESS,
  );
  const safeAttack = await run(
    input.safeRuntime,
    safeAttackCalldata,
    SAFE_ADDRESS,
  );
  const safeControl = await run(
    input.safeRuntime,
    safeControlCalldata,
    SAFE_ADDRESS,
  );
  const vulnerableAttackReturn = bytesToHex(
    vulnerableAttack.returnValue,
  ) as Hex;
  const safeAttackRevert = bytesToHex(safeAttack.returnValue) as Hex;
  const safeControlReturn = bytesToHex(safeControl.returnValue) as Hex;
  assertRuntime(
    vulnerableAttack.exceptionError === undefined,
    "vulnerable attack EVM call unexpectedly reverted",
  );
  assertRuntime(
    safeAttack.exceptionError?.error === "revert" &&
      safeAttackRevert === HOST_MISMATCH_SELECTOR,
    "safe attack EVM call did not revert with HostMismatch()",
  );
  assertRuntime(
    safeControl.exceptionError === undefined,
    "safe control EVM call unexpectedly reverted",
  );
  return {
    vulnerableAttackCalldata,
    safeAttackCalldata,
    safeControlCalldata,
    vulnerableAttackReturn,
    safeAttackRevert,
    safeControlReturn,
  };
}

async function buildRecording(
  options: ProductionCanonicalUrlAttackRuntimeOptions,
  input: CanonicalUrlAttackRuntimeInput,
  recordedAt: string,
) {
  const attackBundle = replayProofBundle(input.attackBundle);
  const controlBundle = replayProofBundle(input.controlBundle);
  assertRuntime(
    attackBundle.runId === input.attackRunId &&
      controlBundle.runId === input.controlRunId,
    "persisted run identity mismatch",
  );
  assertRuntime(
    input.attackRunId !== input.controlRunId,
    "requires different persisted live runs",
  );
  assertProductionDemoAuthority(input, attackBundle, controlBundle);
  const attackData = decodePersistedProof(attackBundle);
  const controlData = decodePersistedProof(controlBundle);
  const attackProofSha256 = hexSha256(attackBundle.proof.response as Hex);
  const controlProofSha256 = hexSha256(controlBundle.proof.response as Hex);
  let checkedInSources: [string, string, string];
  try {
    checkedInSources = await Promise.all([
      options.readCheckedInSource(SOURCE_PATHS.vulnerable),
      options.readCheckedInSource(SOURCE_PATHS.safe),
      options.readCheckedInSource(SOURCE_PATHS.invariantLibrary),
    ]);
  } catch {
    throw new CanonicalUrlAttackSourceReadError();
  }
  const [vulnerableSource, safeSource, invariantSource] = checkedInSources;
  const verifierSource = exactProofVerifierSource(
    attackProofSha256,
    controlProofSha256,
  );
  const sources = {
    vulnerable: sourceEvidence(SOURCE_PATHS.vulnerable, vulnerableSource),
    safe: sourceEvidence(SOURCE_PATHS.safe, safeSource),
    invariantLibrary: sourceEvidence(
      SOURCE_PATHS.invariantLibrary,
      invariantSource,
    ),
    web2JsonInterface: sourceEvidence(
      SOURCE_PATHS.web2JsonInterface,
      WEB2JSON_INTERFACE_SOURCE,
    ),
    contractRegistry: sourceEvidence(
      SOURCE_PATHS.contractRegistry,
      CONTRACT_REGISTRY_SOURCE,
    ),
    exactProofVerifier: sourceEvidence(
      SOURCE_PATHS.exactProofVerifier,
      verifierSource,
    ),
  };
  const compiled = compileCanonicalSources({
    sources: Object.fromEntries(
      Object.values(sources).map((source) => [
        source.path,
        { content: source.content },
      ]),
    ),
  });
  const executions = await executeTranscript({
    verifierRuntime: compiled.exactProofVerifier.runtime,
    vulnerableRuntime: compiled.vulnerable.runtime,
    safeRuntime: compiled.safe.runtime,
    vulnerableAbi: compiled.vulnerable.abi,
    safeAbi: compiled.safe.abi,
    attackBundle,
    controlBundle,
    attackData,
    controlData,
  });
  const transformedResponseShapeCanonicalJson = responseShape(
    attackBundle.manifest.request.abiSignature,
    attackData.responseBody.abiEncodedData,
  );
  assertRuntime(
    transformedResponseShapeCanonicalJson ===
      responseShape(
        controlBundle.manifest.request.abiSignature,
        controlData.responseBody.abiEncodedData,
      ),
    "attack and control transformed response shapes differ",
  );
  const shapeSha256 = sha256(transformedResponseShapeCanonicalJson);
  const attackEvidence = persistedBundleEvidence(
    "attack",
    attackBundle,
    input.attackBundle,
    shapeSha256,
  );
  const controlEvidence = persistedBundleEvidence(
    "control",
    controlBundle,
    input.controlBundle,
    shapeSha256,
  );

  const content: CanonicalUrlAttackRecordingContentV1 = {
    version: "1",
    kind: "canonical-url-attack-recording",
    recordedAt,
    release: input.release,
    network: {
      name: "coston2",
      chainId: 114,
      evidenceSource: "persisted-api",
    },
    statement: "Valid proof ≠ trusted URL",
    sharedRequest: {
      method: "GET",
      query: attackBundle.manifest.request.query,
      jq: attackBundle.manifest.request.jq,
      abiSignature: attackBundle.manifest.request.abiSignature,
      transformedResponseShapeSha256: shapeSha256,
    },
    bundles: { attack: attackEvidence, control: controlEvidence },
    toolchain: {
      compiler: {
        name: "solc",
        version: SOLC_VERSION,
        inputSha256: sha256(compiled.input),
        outputSha256: sha256(compiled.output),
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "cancun",
      },
      runtime: {
        name: "@ethereumjs/vm",
        version: VM_VERSION,
        hardfork: "cancun",
      },
    },
    consumers: {
      vulnerable: {
        identity: "canonical-vulnerable",
        contractName: "CanonicalVulnerableWeb2JsonConsumer",
        sourceSha256: sources.vulnerable.sha256,
        creationBytecodeSha256: hexSha256(compiled.vulnerable.creation),
        runtimeBytecodeSha256: hexSha256(compiled.vulnerable.runtime),
      },
      safe: {
        identity: "canonical-safe",
        contractName: "CanonicalSafeWeb2JsonConsumer",
        sourceSha256: sources.safe.sha256,
        creationBytecodeSha256: hexSha256(compiled.safe.creation),
        runtimeBytecodeSha256: hexSha256(compiled.safe.runtime),
      },
      invariantLibrary: {
        contractName: "ProoflineUrlInvariant",
        sourceSha256: sources.invariantLibrary.sha256,
        hostMismatchSelector: HOST_MISMATCH_SELECTOR,
      },
    },
    transcript: {
      executions: [
        {
          scenario: "attack",
          consumer: "canonical-vulnerable",
          proofSha256: attackProofSha256,
          calldataSha256: hexSha256(executions.vulnerableAttackCalldata),
          runtimeBytecodeSha256: hexSha256(compiled.vulnerable.runtime),
          result: {
            status: "accepted",
            returnDataSha256: hexSha256(
              executions.vulnerableAttackReturn,
            ),
          },
        },
        {
          scenario: "attack",
          consumer: "canonical-safe",
          proofSha256: attackProofSha256,
          calldataSha256: hexSha256(executions.safeAttackCalldata),
          runtimeBytecodeSha256: hexSha256(compiled.safe.runtime),
          result: {
            status: "reverted",
            error: "HostMismatch()",
            selector: HOST_MISMATCH_SELECTOR,
            revertDataSha256: hexSha256(
              executions.safeAttackRevert as Hex,
            ),
          },
        },
        {
          scenario: "control",
          consumer: "canonical-safe",
          proofSha256: controlProofSha256,
          calldataSha256: hexSha256(executions.safeControlCalldata),
          runtimeBytecodeSha256: hexSha256(compiled.safe.runtime),
          result: {
            status: "accepted",
            returnDataSha256: hexSha256(executions.safeControlReturn),
          },
        },
      ],
    },
    reproduction: {
      standardJson: { input: compiled.input, output: compiled.output },
      sources,
      bytecode: {
        vulnerable: {
          creation: compiled.vulnerable.creation,
          runtime: compiled.vulnerable.runtime,
        },
        safe: {
          creation: compiled.safe.creation,
          runtime: compiled.safe.runtime,
        },
        exactProofVerifier: {
          runtime: compiled.exactProofVerifier.runtime,
          runtimeSha256: hexSha256(compiled.exactProofVerifier.runtime),
        },
      },
      transformedResponseShapeCanonicalJson,
    },
  };
  return createCanonicalUrlAttackRecording(content);
}

export function createProductionCanonicalUrlAttackRuntime(
  options: ProductionCanonicalUrlAttackRuntimeOptions,
): ProductionCanonicalUrlAttackRuntime {
  return {
    async recordCanonicalUrlAttack(input) {
      const recording = await buildRecording(options, input, options.now());
      return canonicalSerializeCanonicalUrlAttackRecording(recording);
    },
    async verifyCanonicalUrlAttackRecording(serialized) {
      const claimed = replayCanonicalUrlAttackRecording(serialized);
      const rebuilt = await buildRecording(
        options,
        {
          attackRunId: claimed.bundles.attack.runId,
          attackBundle: claimed.bundles.attack.canonicalBundle,
          controlRunId: claimed.bundles.control.runId,
          controlBundle: claimed.bundles.control.canonicalBundle,
          release: claimed.release,
        },
        claimed.recordedAt,
      );
      const rebuiltBytes =
        canonicalSerializeCanonicalUrlAttackRecording(rebuilt);
      assertRuntime(
        rebuiltBytes === serialized,
        "checked-in source, compiler, bytecode, calldata or EVM evidence mismatch",
      );
      return {
        status: "runtime-verified",
        recordingChecksum: claimed.checksum,
      };
    },
  };
}
