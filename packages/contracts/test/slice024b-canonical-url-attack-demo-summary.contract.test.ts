// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import {
  RECORDING_SHA256,
  makeCanonicalUrlAttackDemoSummary,
} from "./slice024b-canonical-url-attack-demo.fixtures";

const contracts = Contracts as Record<string, any>;

function summarySchema() {
  return contracts.CanonicalUrlAttackDemoSummaryV1Schema;
}

describe("Slice 024B public canonical URL attack demo summary", () => {
  it("exports one strict versioned available-summary schema", () => {
    expect(summarySchema()).toBeDefined();
    expect(summarySchema().safeParse(makeCanonicalUrlAttackDemoSummary()).success)
      .toBe(true);
  });

  it("binds the exact recording bytes, outer checksum, recording time and release", () => {
    const summary = makeCanonicalUrlAttackDemoSummary();
    expect(summary.recording).toEqual({
      sha256: RECORDING_SHA256,
      checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      recordedAt: "2026-08-09T12:00:00.000Z",
      release: {
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
      },
    });
    expect(summarySchema().safeParse(summary).success).toBe(true);
  });

  it("publishes only fixed Coston2 persisted-API identity and the exact download path", () => {
    const summary = makeCanonicalUrlAttackDemoSummary();
    expect(summary.network).toEqual({
      name: "coston2",
      chainId: 114,
      evidenceSource: "persisted-api",
    });
    expect(summary.downloadPath).toBe("/v1/demo/canonical-url/recording");
    expect(summarySchema().safeParse(summary).success).toBe(true);
  });

  it("exposes two bounded public run identities and no embedded bundle", () => {
    const summary = makeCanonicalUrlAttackDemoSummary();
    expect(Object.keys(summary.runs.attack)).toEqual([
      "runId",
      "submissionMode",
      "requestedUrl",
      "transactionHash",
      "votingRound",
      "proofSha256",
    ]);
    expect(summary.runs.attack.runId).not.toBe(summary.runs.control.runId);
    expect(summarySchema().safeParse(summary).success).toBe(true);
  });

  it("freezes compiler/runtime versions and the ordered three-outcome proof", () => {
    const summary = makeCanonicalUrlAttackDemoSummary();
    expect(summary.outcomes.map(({ scenario, consumer, result }) => ({
      scenario,
      consumer,
      status: result.status,
    }))).toEqual([
      { scenario: "attack", consumer: "canonical-vulnerable", status: "accepted" },
      { scenario: "attack", consumer: "canonical-safe", status: "reverted" },
      { scenario: "control", consumer: "canonical-safe", status: "accepted" },
    ]);
    expect(summary.outcomes[1].result).toMatchObject({
      error: "HostMismatch()",
      selector: "0xb828610a",
    });
    expect(summarySchema().safeParse(summary).success).toBe(true);
  });

  it.each([
    ["bundle", (value: any) => { value.runs.attack.canonicalBundle = "{}"; }],
    ["source", (value: any) => { value.source = "contract Fake {}"; }],
    ["bytecode", (value: any) => { value.bytecode = "0x6000"; }],
    ["calldata", (value: any) => { value.outcomes[0].calldata = "0xaaaa"; }],
    ["raw result", (value: any) => { value.outcomes[0].result.returnData = "0x01"; }],
    ["credential", (value: any) => { value.authorization = "Bearer secret"; }],
  ])("rejects %s or other non-public recording material", (_label, mutate) => {
    const value: any = structuredClone(makeCanonicalUrlAttackDemoSummary());
    mutate(value);
    expect(summarySchema().safeParse(value).success).toBe(false);
  });

  it("rejects malformed or unbounded public identities", () => {
    const mutations: Array<(value: any) => void> = [
      (value) => { value.recording.sha256 = `sha256:${"A".repeat(64)}`; },
      (value) => { value.recording.release.commitSha = "a".repeat(41); },
      (value) => { value.runs.attack.runId = "x".repeat(129); },
      (value) => { value.runs.attack.requestedUrl = `https://example.com/${"x".repeat(2049)}`; },
      (value) => { value.runs.control.transactionHash = "0x1234"; },
      (value) => { value.toolchain.compiler.version = "latest"; },
    ];
    for (const mutate of mutations) {
      const value: any = structuredClone(makeCanonicalUrlAttackDemoSummary());
      mutate(value);
      expect(summarySchema().safeParse(value).success).toBe(false);
    }
  });

  it("rejects unavailable, loading or synthetic states from the available evidence schema", () => {
    for (const status of ["unavailable", "loading", "fixture"]) {
      const value: any = structuredClone(makeCanonicalUrlAttackDemoSummary());
      value.status = status;
      expect(summarySchema().safeParse(value).success).toBe(false);
    }
  });
});
