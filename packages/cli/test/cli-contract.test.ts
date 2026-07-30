// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { validManifest } from "../../contracts/test/fixtures";
import { runProoflineCli } from "../src/index";

function createHarness() {
  const output: string[] = [];
  const files = new Map([
    ["manifest.json", JSON.stringify(validManifest)],
    ["bundle.json", JSON.stringify({ version: "1", checksum: `sha256:${"a".repeat(64)}` })],
  ]);
  const client = {
    createRun: vi.fn().mockResolvedValue({ runId: "run_1" }),
    watchRun: vi.fn().mockResolvedValue({ runId: "run_1", terminal: true }),
    verifyRun: vi.fn().mockResolvedValue({ proofVerified: true }),
    prepareSubmission: vi.fn().mockResolvedValue({
      chainId: "0x72",
      to: "0x3333333333333333333333333333333333333333",
      data: "0xfeedcafe",
      value: "0x3039",
    }),
    attachTransaction: vi.fn().mockResolvedValue({ accepted: true }),
    exportBundle: vi.fn().mockResolvedValue(files.get("bundle.json")),
    replay: vi.fn().mockResolvedValue({ runId: "run_replay", byteIdentical: true }),
  };
  const wallet = {
    signAndBroadcast: vi.fn().mockResolvedValue(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
  };
  return {
    output,
    client,
    wallet,
    dependencies: {
      client,
      wallet,
      env: { PROOFLINE_COSTON2_PRIVATE_KEY: "0xlocal-secret" },
      io: {
        stdout: (line: string) => output.push(line),
        stderr: (line: string) => output.push(`ERR:${line}`),
      },
      files: {
        readText: async (path: string) => {
          const value = files.get(path);
          if (value === undefined) throw new Error(`missing ${path}`);
          return value;
        },
        writeText: async (path: string, value: string) => {
          files.set(path, value);
        },
      },
    },
  };
}

describe("Proofline CLI commands", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it.each([
    [["run", "create", "--manifest", "manifest.json", "--mode", "replay"], "createRun"],
    [["run", "watch", "run_1"], "watchRun"],
    [["run", "verify", "run_1"], "verifyRun"],
    [["bundle", "export", "run_1", "--out", "exported.json"], "exportBundle"],
    [["replay", "bundle.json"], "replay"],
  ] as const)("routes proofline %s", async (argv, method) => {
    await expect(
      runProoflineCli({ argv: [...argv], ...harness.dependencies }),
    ).resolves.toBe(0);
    expect(harness.client[method]).toHaveBeenCalledOnce();
    expect(harness.output.join("\n")).toMatch(/run_|proof|bundle|replay|complete/i);
  });

  it("signs a wallet submission locally and sends only the resulting tx hash to the API", async () => {
    await expect(
      runProoflineCli({
        argv: ["run", "create", "--manifest", "manifest.json", "--mode", "wallet"],
        ...harness.dependencies,
      }),
    ).resolves.toBe(0);

    expect(harness.wallet.signAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "0x72" }),
      "0xlocal-secret",
    );
    expect(harness.client.attachTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(JSON.stringify(harness.client.createRun.mock.calls)).not.toContain("0xlocal-secret");
    expect(JSON.stringify(harness.client.attachTransaction.mock.calls)).not.toContain(
      "0xlocal-secret",
    );
  });

  it("fails without side effects for an unsupported command or missing local wallet secret", async () => {
    await expect(
      runProoflineCli({
        argv: ["delete", "everything"],
        ...harness.dependencies,
      }),
    ).resolves.toBe(2);
    await expect(
      runProoflineCli({
        argv: ["run", "create", "--manifest", "manifest.json", "--mode", "wallet"],
        ...harness.dependencies,
        env: {},
      }),
    ).resolves.toBe(2);
    expect(harness.output.join("\n")).not.toContain("0xlocal-secret");
  });
});
