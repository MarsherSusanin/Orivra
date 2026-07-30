// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import {
  createProductionCliDependencies,
  runProoflineCli,
} from "../src/index";

function cliHarness() {
  const client = {
    createRun: vi.fn().mockResolvedValue({ runId: "run_cli" }),
    prepareSubmission: vi.fn().mockResolvedValue({ accepted: true }),
    attachTransaction: vi.fn(),
    watchRun: vi.fn(),
    verifyRun: vi.fn(),
    exportBundle: vi.fn(),
    replay: vi.fn(),
  };
  return {
    client,
    dependencies: {
      client,
      wallet: { signAndBroadcast: vi.fn() },
      env: {},
      io: { stdout: vi.fn(), stderr: vi.fn() },
      files: {
        readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)),
        writeText: vi.fn(),
      },
    },
  };
}

describe("CLI submission readiness", () => {
  it("creates a relayer run and explicitly requests its persisted submission", async () => {
    const harness = cliHarness();

    await expect(
      runProoflineCli({
        argv: [
          "run",
          "create",
          "--manifest",
          "manifest.json",
          "--mode",
          "relayer",
        ],
        ...harness.dependencies,
      }),
    ).resolves.toBe(0);

    expect(harness.client.createRun).toHaveBeenCalledOnce();
    expect(harness.client.prepareSubmission).toHaveBeenCalledWith({
      runId: "run_cli",
      mode: "relayer",
    });
    expect(
      harness.client.createRun.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.client.prepareSubmission.mock.invocationCallOrder[0]!);
  });

  it("retries a transient wallet preflight 404 and returns the durable transaction", async () => {
    let now = 0;
    let submissionAttempts = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const transaction = {
      chainId: "0x72",
      to: "0x3333333333333333333333333333333333333333",
      data: "0xfeedcafe",
      value: "0x3039",
    };
    const dependencies = createProductionCliDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      },
      fetch: vi.fn(async (input: string | URL | Request) => {
        const request = new Request(input);
        if (request.url.endsWith("/submissions")) {
          submissionAttempts += 1;
          if (submissionAttempts < 3) {
            return Response.json(
              { error: { code: "PREFLIGHT_NOT_READY" } },
              { status: 404 },
            );
          }
          return Response.json({ transaction });
        }
        throw new Error(`Unexpected request ${request.url}`);
      }),
      walletFactory: vi.fn(),
      clock: { now: () => now, sleep },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    await expect(
      dependencies.client.prepareSubmission({
        runId: "run_cli",
        mode: "wallet",
      }),
    ).resolves.toEqual(transaction);
    expect(submissionAttempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("bounds a wallet preflight wait that never becomes durable", async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const dependencies = createProductionCliDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      },
      fetch: vi.fn(async () =>
        Response.json(
          { error: { code: "PREFLIGHT_NOT_READY" } },
          { status: 404 },
        ),
      ),
      walletFactory: vi.fn(),
      clock: { now: () => now, sleep },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    await expect(
      dependencies.client.prepareSubmission({
        runId: "run_cli",
        mode: "wallet",
      }),
    ).rejects.toThrow(/preflight.*(?:timed out|not ready)/i);
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
    expect(sleep.mock.calls.flat().reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(
      60_000,
    );
  });
});
