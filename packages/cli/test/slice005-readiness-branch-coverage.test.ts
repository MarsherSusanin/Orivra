// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import {
  createProductionCliDependencies,
  runProoflineCli,
} from "../src/index";

function productionDependencies(
  fetch: typeof globalThis.fetch,
  overrides: Record<string, unknown> = {},
) {
  return createProductionCliDependencies({
    environment: {
      PROOFLINE_API_URL: "https://proofline.invalid",
      PROOFLINE_PROJECT_TOKEN: `project_${"a".repeat(64)}`,
    },
    fetch,
    walletFactory: vi.fn(() => ({ sendTransaction: vi.fn() })),
    clock: { now: vi.fn(() => 0), sleep: vi.fn() },
    files: { readText: vi.fn(), writeText: vi.fn() },
    io: { stdout: vi.fn(), stderr: vi.fn() },
    ...overrides,
  } as any);
}

describe("CLI bounded preflight error handling", () => {
  it.each([
    [
      "malformed 404",
      () => new Response("not-json", { status: 404 }),
    ],
    [
      "different 404 code",
      () =>
        Response.json(
          { error: { code: "RUN_NOT_FOUND" } },
          { status: 404 },
        ),
    ],
    [
      "transport status",
      () => Response.json({ error: { code: "UPSTREAM" } }, { status: 503 }),
    ],
  ])("does not retry a %s response", async (_label, response) => {
    const sleep = vi.fn();
    const fetch = vi.fn(async () => response());
    const dependencies = productionDependencies(fetch, {
      clock: { now: vi.fn(() => 0), sleep },
    });

    await expect(
      dependencies.client.prepareSubmission({
        runId: "run_cli",
        mode: "wallet",
      }),
    ).rejects.toThrow(/rejected POST .*\((?:404|503)\)/i);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns a relayer acceptance body when no wallet transaction is present", async () => {
    const accepted = { accepted: true, runId: "run_cli" };
    const dependencies = productionDependencies(
      vi.fn(async () => Response.json(accepted, { status: 202 })),
    );

    await expect(
      dependencies.client.prepareSubmission({
        runId: "run_cli",
        mode: "relayer",
      }),
    ).resolves.toEqual(accepted);
  });
});

describe("CLI command and secret boundaries", () => {
  it("defaults run creation to replay without requesting a submission", async () => {
    const client = {
      createRun: vi.fn().mockResolvedValue({ runId: "run_replay" }),
      prepareSubmission: vi.fn(),
    };
    const code = await runProoflineCli({
      argv: ["run", "create", "--manifest", "manifest.json"],
      client,
      wallet: { signAndBroadcast: vi.fn() },
      env: {},
      io: { stdout: vi.fn(), stderr: vi.fn() },
      files: {
        readText: vi.fn().mockResolvedValue(JSON.stringify(validManifest)),
        writeText: vi.fn(),
      },
    });

    expect(code).toBe(0);
    expect(client.createRun).toHaveBeenCalledWith({
      manifest: validManifest,
      mode: "replay",
    });
    expect(client.prepareSubmission).not.toHaveBeenCalled();
  });

  it("rejects bundle export without an output path before API access", async () => {
    const stderr = vi.fn();
    const exportBundle = vi.fn();

    await expect(
      runProoflineCli({
        argv: ["bundle", "export", "run_cli"],
        client: { exportBundle },
        wallet: { signAndBroadcast: vi.fn() },
        env: {},
        io: { stdout: vi.fn(), stderr },
        files: { readText: vi.fn(), writeText: vi.fn() },
      }),
    ).resolves.toBe(2);
    expect(exportBundle).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/requires --out/i));
  });

  it("redacts bearer credentials and long hexadecimal secrets from readiness errors", async () => {
    const stderr = vi.fn();
    const secret = `0x${"b".repeat(64)}`;

    await expect(
      runProoflineCli({
        argv: ["run", "watch", "run_cli"],
        client: {
          watchRun: vi
            .fn()
            .mockRejectedValue(new Error(`Bearer project-secret failed ${secret}`)),
        },
        wallet: { signAndBroadcast: vi.fn() },
        env: {},
        io: { stdout: vi.fn(), stderr },
        files: { readText: vi.fn(), writeText: vi.fn() },
      }),
    ).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "Bearer [REDACTED] failed [REDACTED]",
    );
  });

  it("uses the public Coston2 RPC default without sending the private key to HTTP", async () => {
    const sendTransaction = vi.fn().mockResolvedValue(`0x${"c".repeat(64)}`);
    const walletFactory = vi.fn(() => ({ sendTransaction }));
    const dependencies = productionDependencies(
      vi.fn(async () => Response.json({})),
      { walletFactory },
    );
    const privateKey = `0x${"d".repeat(64)}`;

    await dependencies.wallet.signAndBroadcast(
      {
        chainId: "0x72",
        to: `0x${"e".repeat(40)}`,
        data: "0xfeed",
        value: "0x1",
      },
      privateKey,
    );

    expect(walletFactory).toHaveBeenCalledWith({
      privateKey,
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });
    expect(sendTransaction).toHaveBeenCalledWith({
      to: `0x${"e".repeat(40)}`,
      data: "0xfeed",
      value: 1n,
    });
  });
});
