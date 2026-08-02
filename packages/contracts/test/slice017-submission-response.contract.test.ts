// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";

const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const COMMAND_ID = "command_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const TRANSACTION = {
  chainId: "0x72",
  to: "0x3333333333333333333333333333333333333333",
  data: "0xfeedcafe",
  value: "0x3039",
};

function submissionSchema() {
  return (Contracts as Record<string, unknown>).SubmissionResponseV1Schema as {
    safeParse(value: unknown): { success: boolean; data?: unknown };
  } | undefined;
}

function walletTransactionSchema() {
  return (Contracts as Record<string, unknown>).WalletTransactionV1Schema as {
    safeParse(value: unknown): { success: boolean; data?: unknown };
  } | undefined;
}

describe("Slice 017 SubmissionResponseV1 public contract", () => {
  it("exports a strict Coston2 wallet transaction parser", () => {
    const schema = walletTransactionSchema();
    expect(schema, "Slice 017 must export WalletTransactionV1Schema").toBeDefined();
    expect(schema?.safeParse(TRANSACTION)).toMatchObject({ success: true });
    for (const invalid of [
      { ...TRANSACTION, chainId: "0x1" },
      { ...TRANSACTION, to: "0x1234" },
      { ...TRANSACTION, data: "feedcafe" },
      { ...TRANSACTION, value: "12345" },
      { ...TRANSACTION, from: "0x5555555555555555555555555555555555555555" },
    ]) {
      expect(schema?.safeParse(invalid)).toMatchObject({ success: false });
    }
  });

  it("exports one strict versioned discriminator for wallet, relayer and replay", () => {
    const schema = submissionSchema();
    expect(schema, "Slice 017 must export SubmissionResponseV1Schema").toBeDefined();

    const values = [
      {
        version: "1",
        runId: RUN_ID,
        mode: "wallet",
        effectOwner: "wallet",
        transaction: TRANSACTION,
      },
      {
        version: "1",
        runId: RUN_ID,
        mode: "relayer",
        effectOwner: "worker",
        commandId: COMMAND_ID,
      },
      {
        version: "1",
        runId: RUN_ID,
        mode: "replay",
        effectOwner: "none",
        commandId: COMMAND_ID,
      },
    ];

    for (const value of values) {
      expect(schema?.safeParse(value)).toMatchObject({ success: true });
    }
  });

  it.each([
    ["wrong wallet owner", { version: "1", runId: RUN_ID, mode: "wallet", effectOwner: "worker", transaction: TRANSACTION }],
    ["wrong relayer owner", { version: "1", runId: RUN_ID, mode: "relayer", effectOwner: "none", commandId: COMMAND_ID }],
    ["wrong replay owner", { version: "1", runId: RUN_ID, mode: "replay", effectOwner: "worker", commandId: COMMAND_ID }],
    ["missing run identity", { version: "1", mode: "replay", effectOwner: "none", commandId: COMMAND_ID }],
    ["wallet with command identity", { version: "1", runId: RUN_ID, mode: "wallet", effectOwner: "wallet", transaction: TRANSACTION, commandId: COMMAND_ID }],
    ["worker without command identity", { version: "1", runId: RUN_ID, mode: "relayer", effectOwner: "worker" }],
    ["unknown field", { version: "1", runId: RUN_ID, mode: "replay", effectOwner: "none", commandId: COMMAND_ID, accepted: true }],
  ])("rejects %s", (_label, value) => {
    const schema = submissionSchema();
    expect(schema, "Slice 017 must export SubmissionResponseV1Schema").toBeDefined();
    expect(schema?.safeParse(value)).toMatchObject({ success: false });
  });
});
