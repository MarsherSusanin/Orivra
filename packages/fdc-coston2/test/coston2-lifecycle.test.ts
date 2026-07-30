// @vitest-environment node

import { MockAgent } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  buildWalletSubmissionTransaction,
  calculateVotingRoundId,
  createDaClient,
  pollRelayFinalization,
  quoteAttestationFee,
  resolveCoston2Contracts,
  verifyWeb2JsonProof,
} from "../src/coston2";
import {
  daProofFixture,
  FDC_HUB,
  FDC_VERIFICATION,
  REGISTRY,
  RELAY,
  REQUEST_BYTES,
} from "./fixtures";

describe("dynamic Coston2 registry and fee resolution", () => {
  it("resolves protocol contracts through the registry instead of hardcoded addresses", async () => {
    const reader = {
      readContract: vi.fn(async ({ functionName, args }) => {
        expect(args).toHaveLength(1);
        return {
          FdcHub: FDC_HUB,
          FdcVerification: FDC_VERIFICATION,
          Relay: RELAY,
        }[String(args[0])];
      }),
    };

    await expect(
      resolveCoston2Contracts({ registryAddress: REGISTRY, reader }),
    ).resolves.toEqual({
      chainId: 114,
      registryAddress: REGISTRY,
      resolvedContracts: {
        FdcHub: FDC_HUB,
        FdcVerification: FDC_VERIFICATION,
        Relay: RELAY,
      },
    });
    expect(reader.readContract).toHaveBeenCalledTimes(3);
    expect(reader.readContract.mock.calls.every(([call]) => call.address === REGISTRY)).toBe(true);
  });

  it("quotes the exact prepared request and returns bigint without lossy conversion", async () => {
    const reader = {
      readContract: vi.fn().mockResolvedValue(12_345_000_000_000_000n),
    };
    await expect(
      quoteAttestationFee({ requestBytes: REQUEST_BYTES, fdcHub: FDC_HUB, reader }),
    ).resolves.toBe(12_345_000_000_000_000n);
    expect(reader.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FDC_HUB,
        functionName: expect.stringMatching(/fee/i),
        args: [REQUEST_BYTES],
      }),
    );
  });
});

describe("wallet transaction and round derivation", () => {
  it("builds an unsigned EIP-1193 chain-114 requestAttestation transaction", () => {
    const encodeRequestAttestation = vi.fn().mockReturnValue("0xfeedcafe");
    expect(
      buildWalletSubmissionTransaction({
        from: "0x5555555555555555555555555555555555555555",
        requestBytes: REQUEST_BYTES,
        feeWei: 12_345n,
        fdcHub: FDC_HUB,
        encodeRequestAttestation,
      }),
    ).toEqual({
      chainId: "0x72",
      from: "0x5555555555555555555555555555555555555555",
      to: FDC_HUB,
      data: "0xfeedcafe",
      value: "0x3039",
    });
    expect(encodeRequestAttestation).toHaveBeenCalledWith(REQUEST_BYTES);
  });

  it("derives the voting round from Flare system timing using bigint", () => {
    expect(
      calculateVotingRoundId({
        blockTimestamp: 1_800_000_123n,
        firstVotingRoundStartTs: 1_700_000_000n,
        votingEpochDurationSeconds: 90n,
      }),
    ).toBe(1_111_112n);
    expect(() =>
      calculateVotingRoundId({
        blockTimestamp: 1n,
        firstVotingRoundStartTs: 2n,
        votingEpochDurationSeconds: 0n,
      }),
    ).toThrow(/timing|duration/i);
  });
});

describe("Relay finality, raw DA, and proof verification", () => {
  it("polls Relay with bounded injected time and stops when the round is finalized", async () => {
    const isFinalized = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    let now = 0;
    await expect(
      pollRelayFinalization({
        votingRoundId: 42_871n,
        isFinalized,
        clock: {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
        pollIntervalMs: 100,
        timeoutMs: 500,
      }),
    ).resolves.toEqual({ votingRoundId: 42_871n, finalizedAtMs: 200 });
    expect(isFinalized).toHaveBeenCalledTimes(3);
  });

  it("returns an evidence-backed not-finalized timeout", async () => {
    let now = 0;
    await expect(
      pollRelayFinalization({
        votingRoundId: 42_871n,
        isFinalized: async () => false,
        clock: {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        },
        pollIntervalMs: 100,
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({
      category: "not-finalized",
      retryable: true,
      evidence: expect.objectContaining({ votingRoundId: "42871" }),
    });
  });

  it("uses the raw DA endpoint with exact round/request bytes and validates its schema", async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent
      .get("https://da.example")
      .intercept({
        path: "/api/v1/fdc/proof-by-request-round-raw",
        method: "POST",
        body: JSON.stringify({
          votingRoundId: "42871",
          requestBytes: REQUEST_BYTES,
        }),
      })
      .reply(200, daProofFixture);

    const client = createDaClient({
      endpoint: "https://da.example",
      dispatcher: agent,
    });
    await expect(client.getProof(42_871n, REQUEST_BYTES)).resolves.toEqual(daProofFixture);
    agent.assertNoPendingInterceptors();
    await agent.close();
  });

  it("requires local root integrity and on-chain verifyWeb2Json", async () => {
    const relayRoot =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const onchainVerify = vi.fn().mockResolvedValue(true);
    await expect(
      verifyWeb2JsonProof({
        proof: daProofFixture,
        relayRoot,
        calculateMerkleRoot: () => relayRoot,
        onchainVerify,
        fdcVerification: FDC_VERIFICATION,
      }),
    ).resolves.toEqual({ localIntegrity: true, onchainVerified: true });
    expect(onchainVerify).toHaveBeenCalledWith({
      address: FDC_VERIFICATION,
      functionName: "verifyWeb2Json",
      proof: daProofFixture,
    });

    await expect(
      verifyWeb2JsonProof({
        proof: daProofFixture,
        relayRoot,
        calculateMerkleRoot: () =>
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        onchainVerify,
        fdcVerification: FDC_VERIFICATION,
      }),
    ).rejects.toMatchObject({ category: "proof-invalid", retryable: false });

    onchainVerify.mockResolvedValueOnce(false);
    await expect(
      verifyWeb2JsonProof({
        proof: daProofFixture,
        relayRoot,
        calculateMerkleRoot: () => relayRoot,
        onchainVerify,
        fdcVerification: FDC_VERIFICATION,
      }),
    ).rejects.toMatchObject({ category: "proof-invalid", retryable: false });
  });
});
