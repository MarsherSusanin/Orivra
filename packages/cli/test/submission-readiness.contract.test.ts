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
    prepareSubmission: vi.fn().mockResolvedValue({
      version: "1",
      runId: "run_cli",
      mode: "relayer",
      effectOwner: "worker",
      commandId: "command_cli",
    }),
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

  it("retries the persisted 409 readiness code with one command identity and returns the durable transaction", async () => {
    let now = 0;
    let submissionAttempts = 0;
    const requests: Request[] = [];
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
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/submissions")) {
          submissionAttempts += 1;
          if (submissionAttempts < 3) {
            return Response.json(
              { error: { code: "PREFLIGHT_NOT_READY" } },
              { status: 409 },
            );
          }
          return Response.json({
            version: "1",
            runId: "run_cli",
            mode: "wallet",
            effectOwner: "wallet",
            transaction,
          });
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
    expect(
      new Set(
        requests.map((request) => request.headers.get("idempotency-key")),
      ),
    ).toEqual(new Set(["cli-0-1"]));
    await expect(
      Promise.all(requests.map((request) => request.clone().json())),
    ).resolves.toEqual([
      { mode: "wallet" },
      { mode: "wallet" },
      { mode: "wallet" },
    ]);
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
          { status: 409 },
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

  it("fails closed for the superseded 404 readiness status without retrying", async () => {
    const sleep = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(
        { error: { code: "PREFLIGHT_NOT_READY" } },
        { status: 404 },
      ))
      .mockResolvedValueOnce(Response.json(
        { error: { code: "UNEXPECTED_RETRY" } },
        { status: 503 },
      ));
    const dependencies = createProductionCliDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      },
      fetch,
      walletFactory: vi.fn(),
      clock: { now: () => 0, sleep },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    await expect(
      dependencies.client.prepareSubmission({
        runId: "run_cli",
        mode: "wallet",
      }),
    ).rejects.toThrow(/rejected POST .*\(404\)/i);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
