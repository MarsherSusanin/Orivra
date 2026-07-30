// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createProductionCliDependencies,
  runProoflineCli,
} from "../src/index";

function factory(input: Record<string, unknown> = {}) {
  return createProductionCliDependencies({
    environment: {
      PROOFLINE_API_URL: "https://proofline.invalid/",
      PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
    },
    fetch: vi.fn(async () => Response.json({ accepted: true })),
    walletFactory: vi.fn(() => ({ sendTransaction: vi.fn() })),
    clock: { now: () => 1_000, sleep: vi.fn() },
    files: { readText: vi.fn(), writeText: vi.fn() },
    io: { stdout: vi.fn(), stderr: vi.fn() },
    ...input,
  } as any);
}

describe("CLI production adapter failure and route coverage", () => {
  it.each([
    [{ PROOFLINE_PROJECT_TOKEN: "token" }],
    [{ PROOFLINE_API_URL: "https://proofline.invalid" }],
  ])("requires both API environment values", (environment) => {
    expect(() => factory({ environment })).toThrow(/PROOFLINE_API_URL.*PROJECT_TOKEN/i);
  });

  it.each([
    ["GET", (client: any) => client.exportBundle({ runId: "run/one" })],
    ["POST", (client: any) => client.verifyRun({ runId: "run/one" })],
  ])("reports a safe non-2xx %s failure", async (method, invoke) => {
    const fetch = vi.fn(async () => new Response("Bearer server-secret", { status: 503 }));
    const dependencies = factory({ fetch });
    await expect(invoke(dependencies.client)).rejects.toThrow(
      new RegExp(`rejected ${method} .*503`, "i"),
    );
    expect(fetch.mock.calls[0][0]).toContain("run%2Fone");
  });

  it("covers verify, export, replay, and terminal watch without sleeping", async () => {
    const sleep = vi.fn();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/consumer-verifications")) {
        return Response.json({ proofVerified: true });
      }
      if (url.endsWith("/bundle")) return new Response("bundle-bytes");
      if (url.endsWith("/v1/replays")) return Response.json({ runId: "replayed" });
      return Response.json({ runId: "run-terminal", terminal: true });
    });
    const dependencies = factory({
      fetch,
      clock: { now: () => 1_000, sleep },
    });
    await expect(dependencies.client.verifyRun({ runId: "run-1" })).resolves.toEqual({
      proofVerified: true,
    });
    await expect(dependencies.client.exportBundle({ runId: "run-1" })).resolves.toBe(
      "bundle-bytes",
    );
    await expect(dependencies.client.replay({ bundle: "bundle-bytes" })).resolves.toEqual({
      runId: "replayed",
    });
    await expect(dependencies.client.watchRun({ runId: "run-terminal" })).resolves.toEqual({
      runId: "run-terminal",
      terminal: true,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects the wrong chain before creating a wallet", async () => {
    const walletFactory = vi.fn();
    const dependencies = factory({ walletFactory });
    await expect(
      dependencies.wallet.signAndBroadcast(
        {
          chainId: "0x1",
          to: `0x${"1".repeat(40)}`,
          data: "0xfeed",
          value: "0x1",
        },
        `0x${"2".repeat(64)}`,
      ),
    ).rejects.toThrow(/Coston2/i);
    expect(walletFactory).not.toHaveBeenCalled();
  });

  it("redacts a non-Error command failure with the generic message", async () => {
    const stderr = vi.fn();
    const code = await runProoflineCli({
      argv: ["run", "watch", "run-1"],
      client: { watchRun: vi.fn().mockRejectedValue(null) },
      wallet: { signAndBroadcast: vi.fn() },
      env: {},
      io: { stdout: vi.fn(), stderr },
      files: { readText: vi.fn(), writeText: vi.fn() },
    });
    expect(code).toBe(2);
    expect(stderr).toHaveBeenCalledWith("Command failed");
  });
});
