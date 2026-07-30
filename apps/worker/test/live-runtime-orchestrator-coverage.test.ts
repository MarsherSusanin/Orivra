// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  validDiagnostic,
  validManifest,
} from "../../../packages/contracts/test/fixtures";
import { createLiveCoston2Runtime } from "../src/live-gate-runtime";

const TX_HASH = `0x${"2".repeat(64)}`;

function environment(override: Record<string, string | undefined> = {}) {
  return {
    GITHUB_SHA: "a".repeat(40),
    PROOFLINE_TREE_HASH: "b".repeat(40),
    ...override,
  };
}

function ports(override: Record<string, unknown> = {}) {
  return {
    preflight: vi.fn(async () => ({
      requestBytes: "0x1234",
      requestCalldata: "0xfeedcafe",
      quotedFeeWei: 12_345n,
      network: {
        resolvedContracts: {
          FdcHub: "0x3333333333333333333333333333333333333333",
          FdcVerification: "0x1111111111111111111111111111111111111111",
        },
      },
    })),
    signRelayerTransaction: vi.fn(async () => ({
      rawTransaction: "0x02f8",
      transactionHash: TX_HASH,
    })),
    broadcastRawTransaction: vi.fn(async () => TX_HASH),
    getTransactionReceipt: vi.fn(async () => ({
      transactionHash: TX_HASH,
      blockHash: `0x${"3".repeat(64)}`,
      blockTimestamp: 1_747_308_251n,
    })),
    getVotingConfiguration: vi.fn(async () => ({
      firstVotingRoundStartTs: 1_747_265_565n,
      votingEpochDurationSeconds: 90n,
      protocolId: 200,
    })),
    isRelayFinalized: vi.fn(async () => true),
    fetchDaProof: vi.fn(async () => ({
      response_hex: "0x1234",
      attestation_type: "Web2Json",
      proof: [],
    })),
    getRelayRoot: vi.fn(async () => `0x${"4".repeat(64)}`),
    verifyProof: vi.fn(async () => ({ verified: true })),
    verifyConsumer: vi.fn(async () => ({ passed: true, diagnostics: [] })),
    ...override,
  };
}

function execution() {
  return {
    manifest: validManifest,
    projectToken: `project_${"5".repeat(64)}`,
    privateKey: `0x${"1".repeat(64)}`,
    verifier: { prepareRequest: vi.fn() },
    timeoutMs: 600_000,
  };
}

describe("live Coston2 staged orchestrator failure coverage", () => {
  it.each([
    ["commit", { GITHUB_SHA: "" }],
    ["tree", { PROOFLINE_TREE_HASH: "" }],
  ])("rejects missing %s identity before constructing ports", async (_label, override) => {
    const portsFactory = vi.fn();
    await expect(
      createLiveCoston2Runtime({
        environment: environment(override),
        portsFactory: portsFactory as any,
      }).execute(execution() as any),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(portsFactory).not.toHaveBeenCalled();
  });

  it("rejects malformed project tokens before any staged operation", async () => {
    const portsFactory = vi.fn();
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: portsFactory as any,
      }).execute({ ...execution(), projectToken: "project_short" } as any),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(portsFactory).not.toHaveBeenCalled();
  });

  it("rejects a broadcaster hash that differs from the signed transaction", async () => {
    const fixture = ports({
      broadcastRawTransaction: vi.fn(async () => `0x${"9".repeat(64)}`),
    });
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: (() => fixture) as any,
        clock: { now: () => 0, sleep: vi.fn() },
      }).execute(execution() as any),
    ).rejects.toMatchObject({ code: "RELAYER_TRANSACTION_HASH_MISMATCH" });
    expect(fixture.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("retries only retryable DA misses with the injected clock", async () => {
    const retryable = Object.assign(new Error("pending"), { retryable: true });
    const fetchDaProof = vi
      .fn()
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce({
        response_hex: "0x1234",
        attestation_type: "Web2Json",
        proof: [],
      });
    const fixture = ports({ fetchDaProof });
    const sleep = vi.fn(async () => undefined);
    let time = 0;
    const clock = {
      now: vi.fn(() => time++),
      sleep: vi.fn(async (ms: number) => {
        time += ms;
        await sleep(ms);
      }),
    };
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: (() => fixture) as any,
        clock,
      }).execute(execution() as any),
    ).resolves.toMatchObject({ consumerVerified: true });
    expect(fetchDaProof).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("propagates non-retryable DA errors without sleeping", async () => {
    const failure = Object.assign(new Error("schema mismatch"), { retryable: false });
    const fixture = ports({ fetchDaProof: vi.fn().mockRejectedValue(failure) });
    const sleep = vi.fn();
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: (() => fixture) as any,
        clock: { now: () => 0, sleep },
      }).execute(execution() as any),
    ).rejects.toBe(failure);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails closed on proof and consumer rejection evidence", async () => {
    const proofRejected = ports({
      verifyProof: vi.fn(async () => ({ verified: false })),
    });
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: (() => proofRejected) as any,
        clock: { now: () => 0, sleep: vi.fn() },
      }).execute(execution() as any),
    ).rejects.toMatchObject({ code: "PROOF_ONCHAIN_REJECTED" });
    expect(proofRejected.verifyConsumer).not.toHaveBeenCalled();

    const consumerRejected = ports({
      verifyConsumer: vi.fn(async () => ({
        passed: false,
        diagnostics: [validDiagnostic],
      })),
    });
    await expect(
      createLiveCoston2Runtime({
        environment: environment(),
        portsFactory: (() => consumerRejected) as any,
        clock: { now: () => 0, sleep: vi.fn() },
      }).execute(execution() as any),
    ).rejects.toMatchObject({
      code: "CONSUMER_INVARIANT_REJECTED",
      evidence: { diagnosticCodes: [validDiagnostic.code] },
    });
  });

  it("rejects an already exhausted deadline without real timers", async () => {
    const fixture = ports();
    let now = 0;
    const runtime = createLiveCoston2Runtime({
      environment: environment(),
      portsFactory: (() => fixture) as any,
      clock: { now: () => now++, sleep: vi.fn() },
    });
    await expect(
      runtime.execute({ ...execution(), timeoutMs: 0 } as any),
    ).rejects.toMatchObject({ code: "LIVE_GATE_DEADLINE_EXCEEDED" });
    expect(fixture.preflight).toHaveBeenCalledOnce();
    expect(fixture.signRelayerTransaction).not.toHaveBeenCalled();
  });
});
