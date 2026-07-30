export const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
export const PROJECT_COMMAND_ID = "cmd_01JYXW62QHR0MCAJ68D5NX7BZV";
export const OCCURRED_AT = "2025-05-15T12:04:11.000Z";

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
    abiSignature: "{uint256 value}",
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

export const expectedCanonicalUrl =
  "https://api.example.com/prices/eth?currency=USD&source=primary&window=1h";

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
