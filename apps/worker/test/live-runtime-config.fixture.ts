import type {
  LiveCoston2RuntimeConfig,
  WorkerRelayerPolicy,
  WorkerReplayEvidence,
} from "../src/worker-runtime-configuration";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = `0x${"1".repeat(64)}` as const;

export function testRelayerPolicy(
  overrides: Partial<WorkerRelayerPolicy> = {},
): WorkerRelayerPolicy {
  return Object.freeze({
    globalFeeCapWei: 20_000_000_000_000_000n,
    balanceFloorWei: 1_000n,
    dailyProjectQuota: 4,
    ...overrides,
  });
}

export function testLiveCoston2RuntimeConfig(
  overrides: Partial<LiveCoston2RuntimeConfig> = {},
): LiveCoston2RuntimeConfig {
  const {
    relayerPolicy: relayerPolicyOverrides,
    ...remainingOverrides
  } = overrides;
  const relayerPolicy = testRelayerPolicy(relayerPolicyOverrides);
  return Object.freeze({
    chainId: 114,
    registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    rpcUrl: "https://rpc.invalid",
    daEndpoint: "https://da.invalid",
    receiptPollTimeoutMs: 25_000,
    daTimeoutMs: 15_000,
    relayerAccount: Object.freeze(privateKeyToAccount(TEST_PRIVATE_KEY)),
    safeConsumerAddress: "0x5555555555555555555555555555555555555555",
    ...remainingOverrides,
    relayerPolicy,
  });
}

export function testWorkerAuthoritySlices() {
  const liveRuntimeConfig = testLiveCoston2RuntimeConfig();
  return Object.freeze({
    repositoryPolicy: Object.freeze({
      relayerPolicy: liveRuntimeConfig.relayerPolicy,
    }),
    workerLoopConfig: Object.freeze({
      maxAttempts: 8,
      leaseHeartbeatMs: 10_000,
    }),
    liveRuntimeConfig,
  });
}

export const testReplayEvidence: WorkerReplayEvidence = Object.freeze({
  bundleCanonicalJson: '{"version":"1"}',
  bundleSha256: `sha256:${"a".repeat(64)}`,
  preflightReportCanonicalJson: '{"version":"1"}',
  preflightReportSha256: `sha256:${"b".repeat(64)}`,
});
