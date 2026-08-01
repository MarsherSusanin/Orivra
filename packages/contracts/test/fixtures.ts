export const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
export const PROJECT_COMMAND_ID = "cmd_01JYXW62QHR0MCAJ68D5NX7BZV";
export const OCCURRED_AT = "2025-05-15T12:04:11.000Z";
export const VALID_ABI_SIGNATURE =
  '{"components":[{"internalType":"uint256","name":"value","type":"uint256"}],"name":"data","type":"tuple"}';

export const validManifest = {
  version: "1",
  attestationType: "Web2Json",
  network: "coston2",
  request: {
    method: "GET",
    url: "https://API.Example.com:443/prices/eth?source=primary",
    query: {
      currency: "USD",
      window: "1h",
    },
    jq: ".price | {value: (. * 1000000 | floor)}",
    abiSignature: VALID_ABI_SIGNATURE,
  },
  consumer: {
    expectedScheme: "https",
    expectedHost: "api.example.com",
    expectedPathPrefix: "/prices/",
    expectedQuery: {
      currency: "USD",
      source: "primary",
    },
  },
  submission: {
    mode: "wallet",
    feeCapWei: "20000000000000000",
  },
} as const;

export const validComposerDraft = {
  version: "1",
  step: "source",
  updatedAt: "2026-08-02T03:00:00.000Z",
  createIdempotencyKey: "composer_123e4567-e89b-42d3-a456-426614174000",
  fields: {
    sourceUrl: validManifest.request.url,
    queryRows: [
      { id: "query_currency", key: "currency", value: "USD" },
      { id: "query_window", key: "window", value: "1h" },
    ],
    jq: validManifest.request.jq,
    abiSignature: validManifest.request.abiSignature,
    expectedScheme: "https",
    expectedHost: validManifest.consumer.expectedHost,
    expectedPathPrefix: validManifest.consumer.expectedPathPrefix,
    expectedQueryRows: [
      { id: "expected_currency", key: "currency", value: "USD" },
      { id: "expected_source", key: "source", value: "primary" },
    ],
    submissionMode: validManifest.submission.mode,
    feeCapWei: validManifest.submission.feeCapWei,
  },
} as const;

export const expectedCanonicalUrl =
  "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h";

/**
 * Slice 016 fixture whose consumer Trust policy covers the exact effective URL.
 * The historical validManifest remains unchanged for earlier bundle fixtures.
 */
export const exactTrustManifest = {
  ...validManifest,
  consumer: {
    ...validManifest.consumer,
    expectedQuery: {
      ...validManifest.consumer.expectedQuery,
      window: "1h",
    },
  },
} as const;

const stableSampleFingerprint =
  "sha256:6d8108d1c7dccddc7f0a7114f8c7a1f8b01600f6f560314662721f61f077e8d0";

export const validPreflightReport = {
  version: "1",
  runId: RUN_ID,
  verdict: "ready",
  canonicalUrl: expectedCanonicalUrl,
  requestIdentitySha256:
    "sha256:9b11457aa29d65e4940b67b7da16bd370d29bf6a3247a28066f93ac407b8b811",
  sampleFingerprints: Array.from(
    { length: 5 },
    () => stableSampleFingerprint,
  ),
  determinism: {
    passed: true,
    distinctFingerprints: 1,
  },
  responseShape: {
    truncated: false,
    nodes: [
      { path: "", type: "object" },
      { path: "/price", type: "number" },
    ],
  },
  jqPreview: {
    truncated: false,
    nodes: [
      { path: "", type: "object" },
      { path: "/value", type: "number" },
    ],
  },
  abiCompatibility: {
    compatible: true,
    checkedSamples: 5,
    encodedBytes: 2,
    encodedSha256:
      "sha256:3a103a4e5729ad68c02a678ae39accfbc0ae208096437401b7ceab63cca0622f",
  },
  registrySnapshot: {
    chainId: 114,
    blockNumber: "12345678",
    registryAddress: "0x2222222222222222222222222222222222222222",
    resolvedContracts: {
      FdcHub: "0x3333333333333333333333333333333333333333",
      FdcRequestFeeConfigurations:
        "0x6666666666666666666666666666666666666666",
      FdcVerification: "0x1111111111111111111111111111111111111111",
      Relay: "0x4444444444444444444444444444444444444444",
    },
  },
  fee: {
    quotedWei: "12345000000000000",
    capWei: exactTrustManifest.submission.feeCapWei,
    withinCap: true,
  },
  blockers: [],
  diagnostics: [],
} as const;

export const attentionPreflightReport = {
  ...structuredClone(validPreflightReport),
  verdict: "attention",
  responseShape: {
    ...structuredClone(validPreflightReport.responseShape),
    truncated: true,
  },
  diagnostics: [
    {
      version: "1",
      code: "PREFLIGHT_RESPONSE_SHAPE_TRUNCATED",
      severity: "warning",
      confidence: "high",
      summary: "The response shape exceeded the bounded public preview.",
      evidence: { reportFields: ["responseShape"] },
      remediation: "Review the source schema before submission.",
    },
  ],
} as const;

export const blockedPreflightReport = {
  ...structuredClone(validPreflightReport),
  verdict: "blocked",
  sampleFingerprints: [
    stableSampleFingerprint,
    stableSampleFingerprint,
    stableSampleFingerprint,
    stableSampleFingerprint,
    "sha256:c806c492b8c7c2cda5da45323f72e9b1f5f7b3f0a6b4f6c1a2a06a3c0a60aa9e",
  ],
  determinism: {
    passed: false,
    distinctFingerprints: 2,
  },
  blockers: ["PREFLIGHT_SOURCE_NONDETERMINISTIC"],
  diagnostics: [
    {
      version: "1",
      code: "PREFLIGHT_SOURCE_NONDETERMINISTIC",
      severity: "error",
      confidence: "high",
      summary: "Five transformed samples did not produce one stable result.",
      evidence: {
        reportFields: ["sampleFingerprints", "determinism"],
      },
      remediation: "Use a source and transform with stable public output.",
    },
  ],
} as const;

export const validDiagnostic = {
  version: "1",
  code: "CONSUMER_HOST_MISMATCH",
  severity: "error",
  confidence: "high",
  summary: "Consumer request host does not match the manifest invariant.",
  evidence: {
    expected: "api.example.com",
    actual: "mirror.example.net",
    requestUrl: "https://mirror.example.net/prices/eth?currency=USD&source=primary",
  },
  remediation: "Enforce the exact normalized host before decoding proof data.",
} as const;

export function makeRunEvents() {
  const common = {
    version: "1" as const,
    runId: RUN_ID,
    occurredAt: OCCURRED_AT,
  };

  return [
    {
      ...common,
      sequence: 1,
      commandId: PROJECT_COMMAND_ID,
      type: "RUN_CREATED" as const,
      payload: { manifest: validManifest },
    },
    {
      ...common,
      sequence: 2,
      commandId: "cmd_preflight",
      type: "PREFLIGHT_ACCEPTED" as const,
      payload: {
        canonicalUrl: expectedCanonicalUrl,
        requestBytes: "0x574542324a534f4e",
        quotedFeeWei: "12345000000000000",
      },
    },
    {
      ...common,
      sequence: 3,
      commandId: "cmd_submission",
      type: "REQUEST_SUBMITTED" as const,
      payload: {
        mode: "wallet" as const,
        transactionHash:
          "0x9f3e00000000000000000000000000000000000000000000000000007ab2c1d4",
      },
    },
    {
      ...common,
      sequence: 4,
      commandId: "cmd_round",
      type: "ROUND_FINALIZED" as const,
      payload: { votingRound: 42871 },
    },
    {
      ...common,
      sequence: 5,
      commandId: "cmd_proof",
      type: "PROOF_AVAILABLE" as const,
      payload: {
        proofHash:
          "0x9b11457aa29d65e4940b67b7da16bd370d29bf6a3247a28066f93ac407b8b811",
      },
    },
    {
      ...common,
      sequence: 6,
      commandId: "cmd_verify",
      type: "PROOF_VERIFIED" as const,
      payload: {
        verificationContract: "0x1111111111111111111111111111111111111111",
      },
    },
    {
      ...common,
      sequence: 7,
      commandId: "cmd_consumer",
      type: "CONSUMER_VERIFIED" as const,
      payload: { passed: true, diagnostics: [] },
    },
  ];
}

export function makeBundleInput() {
  return {
    version: "1" as const,
    runId: RUN_ID,
    manifest: validManifest,
    events: makeRunEvents(),
    requestBytes: "0x574542324a534f4e",
    network: {
      chainId: 114,
      registryAddress: "0x2222222222222222222222222222222222222222",
      resolvedContracts: {
        FdcHub: "0x3333333333333333333333333333333333333333",
        FdcVerification: "0x1111111111111111111111111111111111111111",
        Relay: "0x4444444444444444444444444444444444444444",
      },
    },
    proof: {
      votingRound: 42871,
      merkleProof: [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
      response: "0x1234abcd",
    },
    verification: {
      proofVerified: true,
      consumerVerified: true,
      diagnostics: [],
    },
    artifacts: {
      safeConsumerSha256:
        "e3bc5540039a2c2b07fe9e89bccfd76194d1f427888dcd9505f4707095c3ccae",
    },
  };
}
