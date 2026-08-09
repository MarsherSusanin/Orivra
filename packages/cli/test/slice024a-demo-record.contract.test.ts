// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { prooflineHelp, runProoflineCli } from "../src/index";
import {
  ATTACK_RUN_ID,
  CONTROL_RUN_ID,
  RELEASE_COMMIT_SHA,
  RELEASE_TREE_SHA,
  canonicalSerializeTestRecording,
  makeCanonicalUrlAttackRecordingContent,
} from "../../contracts/test/slice024a-canonical-url-attack.fixtures";

const OUTPUT_PATH = "evidence/canonical-url-attack.recording.json";

function createHarness() {
  const content = makeCanonicalUrlAttackRecordingContent();
  const output: string[] = [];
  const atomicFiles = new Map<string, string>();
  const client = {
    exportBundle: vi.fn(async ({ runId }: { runId: string }) => {
      if (runId === ATTACK_RUN_ID) return content.bundles.attack.canonicalBundle;
      if (runId === CONTROL_RUN_ID) return content.bundles.control.canonicalBundle;
      throw new Error("unexpected run");
    }),
  };
  const demoRecorder = {
    recordCanonicalUrlAttack: vi.fn(async () =>
      canonicalSerializeTestRecording(),
    ),
  };
  const wallet = {
    signAndBroadcast: vi.fn(async () => {
      throw new Error("demo record must never use a wallet");
    }),
  };
  const files = {
    readText: vi.fn(async () => {
      throw new Error("demo record has no local default fixture");
    }),
    writeText: vi.fn(async () => {
      throw new Error("non-atomic output is forbidden");
    }),
    writeTextAtomic: vi.fn(async (path: string, value: string) => {
      atomicFiles.set(path, value);
    }),
  };

  return {
    output,
    atomicFiles,
    client,
    demoRecorder,
    wallet,
    files,
    dependencies: {
      client,
      demoRecorder,
      wallet,
      env: {
        PROOFLINE_PROJECT_TOKEN: "project_scoped_token_must_not_escape",
        PROOFLINE_COSTON2_PRIVATE_KEY: "0xwallet_secret_must_not_be_read",
        PROOFLINE_RELAYER_PRIVATE_KEY: "0xrelayer_secret_must_not_be_read",
      },
      io: {
        stdout: (line: string) => output.push(line),
        stderr: (line: string) => output.push(`ERR:${line}`),
      },
      files,
    },
  };
}

const argv = [
  "demo",
  "record",
  "--attack-run",
  ATTACK_RUN_ID,
  "--control-run",
  CONTROL_RUN_ID,
  "--commit",
  RELEASE_COMMIT_SHA,
  "--tree",
  RELEASE_TREE_SHA,
  "--out",
  OUTPUT_PATH,
];

describe("Slice 024A explicit canonical URL attack recorder CLI", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("unit recorder tests must have zero external network");
    }));
  });

  it("documents only the explicit two-live-run record command and has no bundled demo command", () => {
    expect(prooflineHelp(["demo", "record", "--help"])).toMatch(
      /demo record.*--attack-run.*--control-run.*--commit.*--tree.*--out/is,
    );
    expect(prooflineHelp(["--help"])).toMatch(/demo record/i);
    expect(prooflineHelp(["demo", "--help"])).not.toMatch(/fixture|synthetic|replay default/i);
  });

  it("loads both exact persisted bundles, records once and commits canonical bytes atomically", async () => {
    await expect(
      runProoflineCli({ argv, ...harness.dependencies } as any),
    ).resolves.toBe(0);

    expect(harness.client.exportBundle.mock.calls).toEqual([
      [{ runId: ATTACK_RUN_ID }],
      [{ runId: CONTROL_RUN_ID }],
    ]);
    expect(harness.demoRecorder.recordCanonicalUrlAttack).toHaveBeenCalledWith({
      attackRunId: ATTACK_RUN_ID,
      attackBundle: makeCanonicalUrlAttackRecordingContent().bundles.attack.canonicalBundle,
      controlRunId: CONTROL_RUN_ID,
      controlBundle: makeCanonicalUrlAttackRecordingContent().bundles.control.canonicalBundle,
      release: {
        commitSha: RELEASE_COMMIT_SHA,
        treeSha: RELEASE_TREE_SHA,
      },
    });
    expect(harness.files.writeTextAtomic).toHaveBeenCalledOnce();
    expect(harness.files.writeTextAtomic).toHaveBeenCalledWith(
      OUTPUT_PATH,
      canonicalSerializeTestRecording(),
    );
    expect(harness.files.writeText).not.toHaveBeenCalled();
    expect(harness.files.readText).not.toHaveBeenCalled();
    expect(harness.output.join("\n")).toMatch(/recorded.*canonical URL attack/i);
  });

  it.each([
    ["attack run", ["--attack-run", ATTACK_RUN_ID]],
    ["control run", ["--control-run", CONTROL_RUN_ID]],
    ["commit", ["--commit", RELEASE_COMMIT_SHA]],
    ["tree", ["--tree", RELEASE_TREE_SHA]],
    ["output", ["--out", OUTPUT_PATH]],
  ])("fails closed before bundle reads when explicit %s is absent", async (_name, pair) => {
    const index = argv.indexOf(pair[0]);
    const incomplete = [...argv.slice(0, index), ...argv.slice(index + 2)];
    await expect(
      runProoflineCli({ argv: incomplete, ...harness.dependencies } as any),
    ).resolves.toBe(2);
    expect(harness.output.join("\n")).toMatch(
      new RegExp(`demo record requires[\\s\\S]*${pair[0].replace(/^--/, "")}`, "i"),
    );
    expect(harness.client.exportBundle).not.toHaveBeenCalled();
    expect(harness.demoRecorder.recordCanonicalUrlAttack).not.toHaveBeenCalled();
    expect(harness.files.writeTextAtomic).not.toHaveBeenCalled();
  });

  it("rejects the same run as attack and control instead of manufacturing a comparison", async () => {
    const duplicate = argv.map((value) =>
      value === CONTROL_RUN_ID ? ATTACK_RUN_ID : value,
    );
    await expect(
      runProoflineCli({ argv: duplicate, ...harness.dependencies } as any),
    ).resolves.toBe(2);
    expect(harness.output.join("\n")).toMatch(/attack and control.*different.*live runs/i);
    expect(harness.client.exportBundle).not.toHaveBeenCalled();
    expect(harness.files.writeTextAtomic).not.toHaveBeenCalled();
  });

  it("leaves the destination untouched when either live bundle or deterministic runtime fails", async () => {
    harness.client.exportBundle.mockRejectedValueOnce(new Error("bundle unavailable"));
    await expect(
      runProoflineCli({ argv, ...harness.dependencies } as any),
    ).resolves.toBe(2);
    expect(harness.output.join("\n")).toMatch(/bundle unavailable/i);
    expect(harness.files.writeTextAtomic).not.toHaveBeenCalled();

    harness = createHarness();
    harness.demoRecorder.recordCanonicalUrlAttack.mockRejectedValueOnce(
      new Error("deterministic EVM transcript mismatch"),
    );
    await expect(
      runProoflineCli({ argv, ...harness.dependencies } as any),
    ).resolves.toBe(2);
    expect(harness.output.join("\n")).toMatch(/deterministic EVM transcript mismatch/i);
    expect(harness.files.writeTextAtomic).not.toHaveBeenCalled();
  });

  it("uses only the scoped persisted API port and never reads, signs, logs or forwards wallet/relayer secrets", async () => {
    await expect(
      runProoflineCli({ argv, ...harness.dependencies } as any),
    ).resolves.toBe(0);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(harness.client.exportBundle).toHaveBeenCalledTimes(2);
    expect(harness.demoRecorder.recordCanonicalUrlAttack).toHaveBeenCalledOnce();
    expect(harness.wallet.signAndBroadcast).not.toHaveBeenCalled();
    const recorderCalls = JSON.stringify(
      harness.demoRecorder.recordCanonicalUrlAttack.mock.calls,
    );
    const output = `${harness.output.join("\n")}\n${recorderCalls}\n${harness.atomicFiles.get(OUTPUT_PATH)}`;
    expect(output).not.toMatch(/project_scoped_token|wallet_secret|relayer_secret|private.?key|Bearer/i);
  });

  it("never replaces an unavailable recording with replay, synthetic, test or checked-in fixture evidence", async () => {
    harness.demoRecorder.recordCanonicalUrlAttack.mockRejectedValueOnce(
      new Error("persisted live evidence required"),
    );
    await expect(
      runProoflineCli({ argv, ...harness.dependencies } as any),
    ).resolves.toBe(2);

    expect(harness.files.readText).not.toHaveBeenCalled();
    expect(harness.files.writeTextAtomic).not.toHaveBeenCalled();
    expect(harness.output.join("\n")).toMatch(/persisted live evidence required/i);
  });
});
