// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import {
  createProductionCliDependencies,
  runProoflineCli,
} from "../src/index";

const RUN_ID = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const COMMAND_ID = "command_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const PRIVATE_KEY = `0x${"b".repeat(64)}`;
const TRANSACTION = {
  chainId: "0x72" as const,
  to: "0x3333333333333333333333333333333333333333" as const,
  data: "0xfeedcafe" as const,
  value: "0x3039" as const,
};

function walletResponse(overrides: Record<string, unknown> = {}) {
  return {
    version: "1",
    runId: RUN_ID,
    mode: "wallet",
    effectOwner: "wallet",
    transaction: TRANSACTION,
    ...overrides,
  };
}

function productionDependencies(
  fetch: typeof globalThis.fetch,
  input: {
    walletFactory?: (input: { privateKey: string; rpcUrl: string }) => {
      sendTransaction(transaction: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: bigint;
      }): Promise<string>;
    };
    files?: {
      readText(path: string): Promise<string>;
      writeText(path: string, value: string): Promise<void>;
    };
  } = {},
) {
  return createProductionCliDependencies({
    environment: {
      PROOFLINE_API_URL: "https://proofline.invalid",
      PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      PROOFLINE_COSTON2_PRIVATE_KEY: PRIVATE_KEY,
      PROOFLINE_COSTON2_RPC_URL: "https://rpc.invalid",
    },
    fetch,
    walletFactory: input.walletFactory ?? vi.fn(),
    clock: { now: vi.fn(() => 1_000), sleep: vi.fn() },
    files: input.files ?? { readText: vi.fn(), writeText: vi.fn() },
    io: { stdout: vi.fn(), stderr: vi.fn() },
  });
}

describe("Slice 017 CLI strict submission response contract", () => {
  it("returns only the exact validated WalletTransactionV1 from a strict wallet envelope", async () => {
    const dependencies = productionDependencies(
      vi.fn(async () => Response.json(walletResponse(), { status: 202 })),
    );

    await expect(
      dependencies.client.prepareSubmission({ runId: RUN_ID, mode: "wallet" }),
    ).resolves.toEqual(TRANSACTION);
  });

  it.each([
    [
      "relayer",
      {
        version: "1",
        runId: RUN_ID,
        mode: "relayer",
        effectOwner: "worker",
        commandId: COMMAND_ID,
      },
    ],
    [
      "replay",
      {
        version: "1",
        runId: RUN_ID,
        mode: "replay",
        effectOwner: "none",
        commandId: COMMAND_ID,
      },
    ],
  ] as const)("returns the validated %s envelope", async (mode, response) => {
    const dependencies = productionDependencies(
      vi.fn(async () => Response.json(response, { status: 202 })),
    );

    await expect(
      dependencies.client.prepareSubmission({ runId: RUN_ID, mode }),
    ).resolves.toEqual(response);
  });

  it.each([
    ["missing version", (({ version: _version, ...value }) => value)(walletResponse())],
    ["wrong version", walletResponse({ version: "2" })],
    ["wrong run identity", walletResponse({ runId: "run_other" })],
    [
      "wrong requested mode",
      {
        version: "1",
        runId: RUN_ID,
        mode: "replay",
        effectOwner: "none",
        commandId: COMMAND_ID,
      },
    ],
    ["wrong effect owner", walletResponse({ effectOwner: "worker" })],
    [
      "malformed wallet transaction",
      walletResponse({ transaction: { ...TRANSACTION, chainId: "0x1" } }),
    ],
  ])("rejects a successful HTTP response with %s", async (_label, response) => {
    const dependencies = productionDependencies(
      vi.fn(async () => Response.json(response, { status: 202 })),
    );

    await expect(
      dependencies.client.prepareSubmission({ runId: RUN_ID, mode: "wallet" }),
    ).rejects.toThrow(/invalid.*submission|submission.*response/i);
  });

  it("rejects unsafe response data without surfacing raw tokens or private values", async () => {
    const leakedToken = `project_${"f".repeat(64)}`;
    const leakedSecret = `0x${"d".repeat(64)}`;
    const dependencies = productionDependencies(
      vi.fn(async () =>
        Response.json(
          walletResponse({
            unsafeDebug: {
              authorization: `Bearer ${leakedToken}`,
              privateKey: leakedSecret,
            },
          }),
          { status: 202 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await dependencies.client.prepareSubmission({
        runId: RUN_ID,
        mode: "wallet",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/invalid.*submission|submission.*response/i);
    expect(String(caught)).not.toContain(leakedToken);
    expect(String(caught)).not.toContain(leakedSecret);
  });

  it("passes the exact validated wallet transaction to the local signer", async () => {
    const requests: Request[] = [];
    const sendTransaction = vi.fn(async () => `0x${"9".repeat(64)}`);
    const files = {
      readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)),
      writeText: vi.fn(),
    };
    const dependencies = productionDependencies(
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/v1/runs")) {
          return Response.json({ runId: RUN_ID }, { status: 202 });
        }
        if (request.url.endsWith("/submissions")) {
          return Response.json(walletResponse(), { status: 202 });
        }
        if (request.url.endsWith("/transactions")) {
          return Response.json({ accepted: true }, { status: 202 });
        }
        throw new Error(`Unexpected request ${request.url}`);
      }),
      {
        walletFactory: vi.fn(() => ({ sendTransaction })),
        files,
      },
    );
    const signAndBroadcast = vi.spyOn(
      dependencies.wallet,
      "signAndBroadcast",
    );

    await expect(
      runProoflineCli({
        argv: [
          "run",
          "create",
          "--manifest",
          "manifest.json",
          "--mode",
          "wallet",
        ],
        ...dependencies,
      }),
    ).resolves.toBe(0);

    expect(signAndBroadcast).toHaveBeenCalledExactlyOnceWith(
      TRANSACTION,
      PRIVATE_KEY,
    );
    expect(sendTransaction).toHaveBeenCalledExactlyOnceWith({
      to: TRANSACTION.to,
      data: TRANSACTION.data,
      value: 12_345n,
    });
    expect(requests).toHaveLength(3);
  });
});
