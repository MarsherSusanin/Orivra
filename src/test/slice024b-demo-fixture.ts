const hash = (nibble: string) => `sha256:${nibble.repeat(64)}`;

export function makeCanonicalUrlAttackDemoSummaryFixture() {
  return {
    version: "1" as const,
    kind: "canonical-url-attack-demo-summary" as const,
    status: "available" as const,
    statement: "Valid proof ≠ trusted URL" as const,
    recording: {
      sha256: hash("1"),
      checksum: hash("2"),
      recordedAt: "2026-08-09T12:00:00.000Z",
      release: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) },
    },
    network: { name: "coston2" as const, chainId: 114 as const, evidenceSource: "persisted-api" as const },
    runs: {
      attack: {
        runId: "run_024_attack_live",
        submissionMode: "wallet" as const,
        requestedUrl: "https://attacker.example/prices/eth?currency=USD",
        transactionHash: `0x${"1".repeat(64)}`,
        votingRound: 52_410,
        proofSha256: hash("3"),
      },
      control: {
        runId: "run_024_control_live",
        submissionMode: "relayer" as const,
        requestedUrl: "https://api.example.com/prices/eth?currency=USD",
        transactionHash: `0x${"2".repeat(64)}`,
        votingRound: 52_411,
        proofSha256: hash("4"),
      },
    },
    toolchain: {
      compiler: { name: "solc" as const, version: "0.8.36", evmVersion: "cancun" as const },
      runtime: { name: "@ethereumjs/vm" as const, version: "10.1.2", hardfork: "cancun" as const },
    },
    outcomes: [
      {
        scenario: "attack" as const,
        consumer: "canonical-vulnerable" as const,
        proofSha256: hash("3"),
        calldataSha256: hash("5"),
        runtimeBytecodeSha256: hash("6"),
        result: { status: "accepted" as const, returnDataSha256: hash("7") },
      },
      {
        scenario: "attack" as const,
        consumer: "canonical-safe" as const,
        proofSha256: hash("3"),
        calldataSha256: hash("5"),
        runtimeBytecodeSha256: hash("8"),
        result: {
          status: "reverted" as const,
          error: "HostMismatch()" as const,
          selector: "0xb828610a" as const,
          revertDataSha256: hash("9"),
        },
      },
      {
        scenario: "control" as const,
        consumer: "canonical-safe" as const,
        proofSha256: hash("4"),
        calldataSha256: hash("a"),
        runtimeBytecodeSha256: hash("8"),
        result: { status: "accepted" as const, returnDataSha256: hash("b") },
      },
    ] as const,
    downloadPath: "/v1/demo/canonical-url/recording" as const,
  };
}
