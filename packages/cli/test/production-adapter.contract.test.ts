// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";

type ProductionDependenciesFactory = (input: Record<string, unknown>) => any;

async function loadFactory(): Promise<ProductionDependenciesFactory> {
  const module = (await import("../src/index")) as unknown as Record<
    string,
    unknown
  >;
  const factory = module.createProductionCliDependencies;
  expect(
    factory,
    "Slice 004 requires an injectable production CLI dependency factory",
  ).toEqual(expect.any(Function));
  if (typeof factory !== "function") {
    throw new Error("Missing createProductionCliDependencies");
  }
  return factory as ProductionDependenciesFactory;
}

describe("Slice 004 CLI production adapter", () => {
  it("uses the supplied API transport with bearer auth and keeps the wallet secret local", async () => {
    const createDependencies = await loadFactory();
    const requests: Request[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/v1/runs")) {
        return Response.json({ runId: "run_cli" });
      }
      if (request.url.endsWith("/submissions")) {
        return Response.json({
          version: "1",
          runId: "run_cli",
          mode: "wallet",
          effectOwner: "wallet",
          transaction: {
            chainId: "0x72",
            to: "0x3333333333333333333333333333333333333333",
            data: "0xfeedcafe",
            value: "0x3039",
          },
        });
      }
      return Response.json({ accepted: true });
    });
    const sendTransaction = vi.fn(async () => `0x${"9".repeat(64)}`);
    const dependencies = createDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid/",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
        PROOFLINE_COSTON2_RPC_URL: "https://rpc.invalid",
      },
      fetch,
      walletFactory: vi.fn(() => ({ sendTransaction })),
      clock: { now: () => 1_000, sleep: vi.fn() },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    const created = await dependencies.client.createRun({
      manifest: validManifest,
      mode: "wallet",
    });
    const transaction = await dependencies.client.prepareSubmission({
      runId: created.runId,
      mode: "wallet",
    });
    const privateKey = `0x${"b".repeat(64)}`;
    const transactionHash = await dependencies.wallet.signAndBroadcast(
      transaction,
      privateKey,
    );
    await dependencies.client.attachTransaction({
      runId: created.runId,
      transactionHash,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      requests.every(
        (request) =>
          request.headers.get("authorization") ===
          `Bearer project_${"a".repeat(64)}`,
      ),
    ).toBe(true);
    expect(requests[0]?.headers.get("idempotency-key")).toMatch(/^cli-/);
    expect(requests[1]?.headers.get("idempotency-key")).not.toBe(
      requests[0]?.headers.get("idempotency-key"),
    );
    expect(JSON.stringify(requests)).not.toContain(privateKey);
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("bounds run watching with an injected clock and sleep", async () => {
    const createDependencies = await loadFactory();
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(600_001);
    const sleep = vi.fn(async () => undefined);
    const dependencies = createDependencies({
      environment: {
        PROOFLINE_API_URL: "https://proofline.invalid",
        PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
      },
      fetch: vi.fn(async () => Response.json({ runId: "run_wait", terminal: false })),
      walletFactory: vi.fn(),
      clock: { now, sleep },
      files: { readText: vi.fn(), writeText: vi.fn() },
      io: { stdout: vi.fn(), stderr: vi.fn() },
    });

    await expect(
      dependencies.client.watchRun({ runId: "run_wait" }),
    ).rejects.toThrow(/timed out/i);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2_000);
  });
});
