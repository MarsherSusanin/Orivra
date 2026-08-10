import assert from "node:assert/strict";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = [];
const frozenSnapshotRoots = new Set();
const COMMIT_SHA = "1".repeat(40);
const TREE_SHA = "2".repeat(40);

async function optionalImport(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?red=${Date.now()}`)
    .catch(() => ({}));
}

async function temporaryRoot(name) {
  const directory = await mkdtemp(join(tmpdir(), `proofline-027c-${name}-`));
  temporaryRoots.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

async function absent(path) {
  return access(path).then(() => false, () => true);
}

function trackFrozenSnapshot(path) {
  frozenSnapshotRoots.add(path);
}

async function makeWritableAndRemoveFrozenSnapshot(path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    await rm(path, { force: true });
    return;
  }
  if (!metadata.isDirectory()) {
    await chmod(path, 0o600);
    await rm(path, { force: true });
    return;
  }
  await chmod(path, 0o700);
  for (const entry of await readdir(path)) {
    await makeWritableAndRemoveFrozenSnapshot(join(path, entry));
  }
  await rm(path, { recursive: true, force: true });
}

test.afterEach(async () => {
  const cleanupFailures = [];
  for (const snapshotRoot of frozenSnapshotRoots) {
    try {
      await makeWritableAndRemoveFrozenSnapshot(snapshotRoot);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  frozenSnapshotRoots.clear();
  for (const directory of temporaryRoots.splice(0)) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, "Wave-4 fixture cleanup failed");
  }
});

test("captures one commit, derives its tree and materializes the only drill source privately", async () => {
  const module = await optionalImport("scripts/recovery-producer-snapshot.mjs");
  assert.equal(typeof module.captureRecoveryProducerSnapshot, "function");
  const repositoryRoot = await temporaryRoot("shared-source");
  const snapshotParentDirectory = await temporaryRoot("snapshot-parent");
  await writeFile(join(repositoryRoot, "compose.yaml"), "trusted-candidate\n");
  const calls = [];
  const snapshot = await module.captureRecoveryProducerSnapshot({
    repositoryRoot,
    snapshotParentDirectory,
    allowDirtyDraft: false,
    runGit: async (arguments_) => {
      calls.push(arguments_);
      const key = arguments_.join("\0");
      if (key === "rev-parse\0HEAD") return { exitCode: 0, stdout: `${COMMIT_SHA}\n` };
      if (key === `rev-parse\0${COMMIT_SHA}^{tree}`) return { exitCode: 0, stdout: `${TREE_SHA}\n` };
      if (key === "status\0--porcelain") return { exitCode: 0, stdout: "" };
      return { exitCode: 64, stdout: "" };
    },
    materializeSnapshot: async ({ sourceRoot, commitSha, treeSha, mode }) => {
      trackFrozenSnapshot(sourceRoot);
      assert.equal(commitSha, COMMIT_SHA);
      assert.equal(treeSha, TREE_SHA);
      assert.equal(mode, "commit");
      await mkdir(sourceRoot, { mode: 0o700 });
      await mkdir(join(sourceRoot, "scripts"), { mode: 0o700 });
      await writeFile(join(sourceRoot, "compose.yaml"), "trusted-candidate\n", { mode: 0o400 });
      await writeFile(join(sourceRoot, "scripts", "gate.mjs"), "trusted\n", { mode: 0o400 });
      await chmod(join(sourceRoot, "scripts"), 0o500);
      await chmod(sourceRoot, 0o500);
      return { materializedTreeSha: TREE_SHA };
    },
  });
  assert.deepEqual(calls, [
    ["rev-parse", "HEAD"],
    ["rev-parse", `${COMMIT_SHA}^{tree}`],
    ["status", "--porcelain"],
  ]);
  assert.equal(calls.some((arguments_) => arguments_.includes("HEAD^{tree}")), false);
  assert.equal(snapshot.producerIdentity.verification, "verified");
  assert.equal(snapshot.producerIdentity.releaseClaim, true);
  assert.notEqual(snapshot.sourceRoot, repositoryRoot);
  assert.equal((await lstat(snapshot.sourceRoot)).mode & 0o777, 0o500);
  assert.equal((await lstat(join(snapshot.sourceRoot, "compose.yaml"))).mode & 0o777, 0o400);
  assert.equal((await lstat(join(snapshot.sourceRoot, "scripts"))).mode & 0o777, 0o500);
  assert.equal((await lstat(join(snapshot.sourceRoot, "scripts", "gate.mjs"))).mode & 0o777, 0o400);
  await writeFile(join(repositoryRoot, "compose.yaml"), "transient-writer-change\n");
  assert.equal(await readFile(join(snapshot.sourceRoot, "compose.yaml"), "utf8"), "trusted-candidate\n");

  await assert.rejects(module.captureRecoveryProducerSnapshot({
    repositoryRoot,
    snapshotParentDirectory: await temporaryRoot("mismatched-snapshot-parent"),
    allowDirtyDraft: false,
    runGit: async (arguments_) => {
      const key = arguments_.join("\0");
      if (key === "rev-parse\0HEAD") return { exitCode: 0, stdout: `${COMMIT_SHA}\n` };
      if (key === `rev-parse\0${COMMIT_SHA}^{tree}`) return { exitCode: 0, stdout: `${TREE_SHA}\n` };
      return { exitCode: 0, stdout: "" };
    },
    materializeSnapshot: async ({ sourceRoot }) => {
      trackFrozenSnapshot(sourceRoot);
      await mkdir(sourceRoot, { mode: 0o700 });
      await chmod(sourceRoot, 0o500);
      return { materializedTreeSha: "3".repeat(40) };
    },
  }), /Recovery producer snapshot tree does not match/);

  await assert.rejects(module.captureRecoveryProducerSnapshot({
    repositoryRoot,
    snapshotParentDirectory: await temporaryRoot("reused-identity-parent"),
    allowDirtyDraft: false,
    runGit: async (arguments_) => ({
      exitCode: 0,
      stdout: arguments_.join("\0") === "status\0--porcelain" ? "" : `${COMMIT_SHA}\n`,
    }),
    materializeSnapshot: async ({ sourceRoot }) => {
      trackFrozenSnapshot(sourceRoot);
      await mkdir(sourceRoot, { mode: 0o500 });
      return { materializedTreeSha: COMMIT_SHA };
    },
  }), /Recovery producer identity is invalid/);

  await assert.rejects(module.captureRecoveryProducerSnapshot({
    repositoryRoot,
    snapshotParentDirectory: await temporaryRoot("symlink-snapshot-parent"),
    allowDirtyDraft: false,
    runGit: async (arguments_) => {
      const key = arguments_.join("\0");
      if (key === "rev-parse\0HEAD") return { exitCode: 0, stdout: `${COMMIT_SHA}\n` };
      if (key === `rev-parse\0${COMMIT_SHA}^{tree}`) return { exitCode: 0, stdout: `${TREE_SHA}\n` };
      return { exitCode: 0, stdout: "" };
    },
    materializeSnapshot: async ({ sourceRoot }) => {
      trackFrozenSnapshot(sourceRoot);
      await mkdir(sourceRoot, { mode: 0o700 });
      await symlink(repositoryRoot, join(sourceRoot, "mutable-source"));
      await chmod(sourceRoot, 0o500);
      return { materializedTreeSha: TREE_SHA };
    },
  }), /Recovery producer snapshot is not immutable/);
});

test("captures dirty author bytes into a private draft snapshot but never upgrades them", async () => {
  const module = await optionalImport("scripts/recovery-producer-snapshot.mjs");
  assert.equal(typeof module.captureRecoveryProducerSnapshot, "function");
  assert.equal(typeof module.verifyRecoveryProducerSnapshotForPublication, "function");
  const repositoryRoot = await temporaryRoot("dirty-source");
  const snapshotParentDirectory = await temporaryRoot("dirty-snapshot-parent");
  await writeFile(join(repositoryRoot, "candidate.txt"), "dirty-candidate-bytes\n");
  const snapshot = await module.captureRecoveryProducerSnapshot({
    repositoryRoot,
    snapshotParentDirectory,
    allowDirtyDraft: true,
    runGit: async (arguments_) => ({
      exitCode: 0,
      stdout: arguments_.join("\0") === "rev-parse\0HEAD"
        ? `${COMMIT_SHA}\n`
        : arguments_.join("\0") === `rev-parse\0${COMMIT_SHA}^{tree}`
          ? `${TREE_SHA}\n`
          : " M candidate.txt\n",
    }),
    materializeSnapshot: async ({ sourceRoot, mode }) => {
      trackFrozenSnapshot(sourceRoot);
      assert.equal(mode, "working-tree-draft");
      await mkdir(sourceRoot, { mode: 0o700 });
      await writeFile(join(sourceRoot, "candidate.txt"), "dirty-candidate-bytes\n", { mode: 0o400 });
      await chmod(sourceRoot, 0o500);
      return { candidateManifestSha256: `sha256:${"4".repeat(64)}` };
    },
  });
  assert.equal(snapshot.producerIdentity.verification, "draft");
  assert.equal(snapshot.producerIdentity.releaseClaim, false);
  assert.equal(snapshot.candidateManifestSha256, `sha256:${"4".repeat(64)}`);
  assert.equal(await readFile(join(snapshot.sourceRoot, "candidate.txt"), "utf8"), "dirty-candidate-bytes\n");
  await assert.rejects(
    module.verifyRecoveryProducerSnapshotForPublication({ snapshot }),
    /Recovery producer snapshot is not publishable/,
  );
});

test("revalidates final HEAD, captured-commit tree and clean state before verified publication", async () => {
  const module = await optionalImport("scripts/recovery-producer-snapshot.mjs");
  assert.equal(typeof module.verifyRecoveryProducerSnapshotForPublication, "function");
  const baseSnapshot = {
    sourceRoot: "/private/immutable/snapshot",
    materializedTreeSha: TREE_SHA,
    producerIdentity: {
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      verification: "verified",
      releaseClaim: true,
    },
  };
  const acceptedCalls = [];
  const accepted = await module.verifyRecoveryProducerSnapshotForPublication({
    snapshot: baseSnapshot,
    runGit: async (arguments_) => {
      acceptedCalls.push(arguments_);
      const key = arguments_.join("\0");
      if (key === "rev-parse\0HEAD") return { exitCode: 0, stdout: `${COMMIT_SHA}\n` };
      if (key === `rev-parse\0${COMMIT_SHA}^{tree}`) return { exitCode: 0, stdout: `${TREE_SHA}\n` };
      return { exitCode: 0, stdout: "" };
    },
  });
  assert.deepEqual(accepted, baseSnapshot.producerIdentity);
  assert.deepEqual(acceptedCalls, [
    ["rev-parse", "HEAD"],
    ["rev-parse", `${COMMIT_SHA}^{tree}`],
    ["status", "--porcelain"],
  ]);
  for (const changed of ["head", "tree", "status"]) {
    const calls = [];
    await assert.rejects(module.verifyRecoveryProducerSnapshotForPublication({
      snapshot: baseSnapshot,
      runGit: async (arguments_) => {
        calls.push(arguments_);
        const key = arguments_.join("\0");
        if (key === "rev-parse\0HEAD") {
          return { exitCode: 0, stdout: `${changed === "head" ? "3".repeat(40) : COMMIT_SHA}\n` };
        }
        if (key === `rev-parse\0${COMMIT_SHA}^{tree}`) {
          return { exitCode: 0, stdout: `${changed === "tree" ? "4".repeat(40) : TREE_SHA}\n` };
        }
        return { exitCode: 0, stdout: changed === "status" ? " M compose.yaml\n" : "" };
      },
    }), /Recovery producer snapshot changed/);
    assert.deepEqual(calls, [
      ["rev-parse", "HEAD"],
      ["rev-parse", `${COMMIT_SHA}^{tree}`],
      ["status", "--porcelain"],
    ]);
  }
});

const BACKUP_ID = "base_00000001000000000000000A";
const SYSTEM_IDENTIFIER = "7532076200787175519";
// WAL-G's Go DTO emits system_identifier and both LSNs as JSON integer tokens.
// The system identifier intentionally exceeds Number.MAX_SAFE_INTEGER, so this
// fixture must never pass through JSON.stringify/JSON.parse before validation.
const DETAIL_RECORD_JSON = [
  `{\"backup_name\":\"${BACKUP_ID}\"`,
  `\"time\":\"2026-08-11T00:00:00Z\"`,
  `\"wal_file_name\":\"00000001000000000000000A\"`,
  `\"storage_name\":\"default\"`,
  `\"start_time\":\"2026-08-11T00:00:00.1234Z\"`,
  `\"finish_time\":\"2026-08-11T00:01:00.5Z\"`,
  `\"date_fmt\":\"%Y-%m-%dT%H:%M:%S.%fZ\"`,
  `\"hostname\":\"proofline-postgres\"`,
  `\"data_dir\":\"/var/lib/postgresql/data\"`,
  `\"pg_version\":170006`,
  `\"start_lsn\":167772200`,
  `\"finish_lsn\":184549880`,
  `\"is_permanent\":false`,
  `\"system_identifier\":${SYSTEM_IDENTIFIER}`,
  `\"uncompressed_size\":8192`,
  `\"compressed_size\":4096}`,
].join(",");
const HIGH_BACKUP_ID = "base_000000010020000000000000";
const HIGH_DETAIL_RECORD_JSON = DETAIL_RECORD_JSON
  .replace(BACKUP_ID, HIGH_BACKUP_ID)
  .replace("00000001000000000000000A", "000000010020000000000000")
  .replace("2026-08-11T00:00:00.1234Z", "2026-08-11T00:00:00Z")
  .replace("2026-08-11T00:01:00.5Z", "2026-08-11T00:01:00.123456Z")
  .replace("167772200", "9007199254740993")
  .replace("184549880", "9007199271518209");

test("selects one exact WAL-G v3.0.8 detail record for every backup evidence field", async () => {
  const module = await optionalImport("scripts/recovery-selected-backup-metadata.mjs");
  assert.equal(typeof module.selectRecoveryBackupMetadata, "function");
  const selected = module.selectRecoveryBackupMetadata({
    backupListDetailBytes: Buffer.from(`[${DETAIL_RECORD_JSON}]`, "utf8"),
    selectedBackupId: BACKUP_ID,
    expectedSystemIdentifier: SYSTEM_IDENTIFIER,
    postgresMajor: 17,
    walSegmentBytes: 16 * 1024 * 1024,
  });
  assert.deepEqual(selected, {
    id: BACKUP_ID,
    startedAt: "2026-08-11T00:00:00.123400Z",
    completedAt: "2026-08-11T00:01:00.500000Z",
    startLsn: "0/A000028",
    stopLsn: "0/B0001F8",
    startWalSegment: "00000001000000000000000A",
    stopWalSegment: "00000001000000000000000B",
    timeline: 1,
    systemIdentifier: SYSTEM_IDENTIFIER,
  });
  assert.equal(JSON.stringify(selected).includes("Date.now"), false);

  const high = module.selectRecoveryBackupMetadata({
    backupListDetailBytes: Buffer.from(`[${HIGH_DETAIL_RECORD_JSON}]`, "utf8"),
    selectedBackupId: HIGH_BACKUP_ID,
    expectedSystemIdentifier: SYSTEM_IDENTIFIER,
    postgresMajor: 17,
    walSegmentBytes: 16 * 1024 * 1024,
  });
  assert.deepEqual(high, {
    id: HIGH_BACKUP_ID,
    startedAt: "2026-08-11T00:00:00.000000Z",
    completedAt: "2026-08-11T00:01:00.123456Z",
    startLsn: "200000/1",
    stopLsn: "200000/1000001",
    startWalSegment: "000000010020000000000000",
    stopWalSegment: "000000010020000000000001",
    timeline: 1,
    systemIdentifier: SYSTEM_IDENTIFIER,
  });
});

test("rejects missing, duplicate, extra or malformed selected backup detail", async () => {
  const module = await optionalImport("scripts/recovery-selected-backup-metadata.mjs");
  assert.equal(typeof module.selectRecoveryBackupMetadata, "function");
  const cases = [
    "[]",
    `[${DETAIL_RECORD_JSON},${DETAIL_RECORD_JSON}]`,
    `[${DETAIL_RECORD_JSON.replace('"uncompressed_size"', '"untrusted_extra":true,"uncompressed_size"')}]`,
    `[${DETAIL_RECORD_JSON.replace(',"finish_lsn":184549880', "")}]`,
    `[${DETAIL_RECORD_JSON.replace('"finish_lsn":184549880', '"finish_lsn":184549880,"finish_lsn":184549880')}]`,
    `[${DETAIL_RECORD_JSON.replace(BACKUP_ID, "base_00000001000000000000000B")}]`,
    `[${DETAIL_RECORD_JSON.replace("2026-08-11T00:00:00.1234Z", "2026-08-11T00:00:00.1234567Z")}]`,
    `[${DETAIL_RECORD_JSON.replace("2026-08-11T00:00:00.1234Z", "2026-08-11T00:00:00.1234+00:00")}]`,
    `[${DETAIL_RECORD_JSON.replace("2026-08-11T00:01:00.5Z", "2026-08-10T23:59:00Z")}]`,
    `[${DETAIL_RECORD_JSON.replace("167772200", "18446744073709551616")}]`,
    `[${DETAIL_RECORD_JSON.replace("167772200", "-1")}]`,
    `[${DETAIL_RECORD_JSON.replace("167772200", "1.5")}]`,
    `[${DETAIL_RECORD_JSON.replace("167772200", "1e8")}]`,
    `[${DETAIL_RECORD_JSON.replace(SYSTEM_IDENTIFIER, `\"${SYSTEM_IDENTIFIER}\"`)}]`,
    `[${DETAIL_RECORD_JSON.replace(SYSTEM_IDENTIFIER, "7532076200787175520")}]`,
  ];
  for (const detailJson of cases) {
    assert.throws(() => module.selectRecoveryBackupMetadata({
      backupListDetailBytes: Buffer.from(detailJson, "utf8"),
      selectedBackupId: BACKUP_ID,
      expectedSystemIdentifier: SYSTEM_IDENTIFIER,
      postgresMajor: 17,
      walSegmentBytes: 16 * 1024 * 1024,
    }), /Selected WAL-G backup metadata is invalid/);
  }
});

test("publishes only after stage, real negatives, exact cleanup and final source acceptance", async () => {
  const module = await optionalImport("scripts/recovery-evidence-publication.mjs");
  assert.equal(typeof module.runRecoveryEvidencePublication, "function");
  const outputRoot = await temporaryRoot("publication-success");
  const snapshotRoot = join(outputRoot, ".source-snapshot");
  trackFrozenSnapshot(snapshotRoot);
  await mkdir(snapshotRoot, { mode: 0o500 });
  const calls = [];
  const result = await module.runRecoveryEvidencePublication({
    outputRoot,
    snapshot: { sourceRoot: snapshotRoot, producerIdentity: { verification: "verified", releaseClaim: true } },
    runRecoveryFromSnapshot: async ({ sourceRoot }) => calls.push(`drill:${sourceRoot}`),
    stageEvidence: async ({ sourceRoot }) => {
      calls.push(`stage:${sourceRoot}`);
      const stageRoot = join(outputRoot, ".recovery-evidence.staging");
      await mkdir(stageRoot, { mode: 0o700 });
      await writeFile(join(stageRoot, "recovery-evidence-handoff.v1.json"), "{}", { mode: 0o600 });
      return { stageRoot };
    },
    runNegativeControls: async ({ stageRoot }) => calls.push(`negatives:${stageRoot}`),
    finalizeProjectAndSecrets: async () => calls.push("cleanup"),
    cleanupSnapshot: async ({ sourceRoot }) => {
      calls.push("snapshot-cleanup");
      await chmod(sourceRoot, 0o700);
      await rm(sourceRoot, { recursive: true, force: true });
    },
    verifyFinalSource: async () => calls.push("source-final"),
    publishEvidence: async ({ stageRoot }) => {
      calls.push(`publish:${stageRoot}`);
      assert.equal(await absent(snapshotRoot), true);
      await rename(stageRoot, join(outputRoot, "recovery-evidence.v1"));
      return { status: "passed" };
    },
    discardEvidence: async () => calls.push("discard"),
    runFailureDiagnostics: async () => calls.push("diagnostics"),
  });
  assert.deepEqual(calls, [
    `drill:${snapshotRoot}`,
    `stage:${snapshotRoot}`,
    `negatives:${join(outputRoot, ".recovery-evidence.staging")}`,
    "cleanup",
    "snapshot-cleanup",
    "source-final",
    `publish:${join(outputRoot, ".recovery-evidence.staging")}`,
  ]);
  assert.deepEqual(result, { status: "passed" });
  assert.equal(await absent(join(outputRoot, ".recovery-evidence.staging")), true);
});

test("every negative, diagnostic, finalizer, final-source or atomic-publish failure leaves zero final PASS artifacts", async () => {
  const module = await optionalImport("scripts/recovery-evidence-publication.mjs");
  assert.equal(typeof module.runRecoveryEvidencePublication, "function");
  for (const failure of ["drill", "negative", "diagnostic", "finalizer", "source-final", "publish"]) {
    const outputRoot = await temporaryRoot(`publication-${failure}`);
    const snapshotRoot = join(outputRoot, ".source-snapshot");
    const stageRoot = join(outputRoot, ".recovery-evidence.staging");
    const finalRoot = join(outputRoot, "recovery-evidence.v1");
    trackFrozenSnapshot(snapshotRoot);
    await mkdir(snapshotRoot, { mode: 0o500 });
    const calls = [];
    await assert.rejects(module.runRecoveryEvidencePublication({
      outputRoot,
      snapshot: { sourceRoot: snapshotRoot, producerIdentity: { verification: "verified", releaseClaim: true } },
      runRecoveryFromSnapshot: async ({ sourceRoot }) => {
        calls.push(`drill:${sourceRoot}`);
        if (failure === "drill") throw new Error("drill failed");
      },
      stageEvidence: async () => {
        calls.push("stage");
        await mkdir(stageRoot, { mode: 0o700 });
        return { stageRoot };
      },
      runNegativeControls: async () => {
        calls.push("negatives");
        if (failure === "negative" || failure === "diagnostic") {
          throw new Error("negative failed");
        }
      },
      runFailureDiagnostics: async () => {
        calls.push("diagnostics");
        if (failure === "diagnostic") throw new Error("diagnostics failed");
      },
      finalizeProjectAndSecrets: async () => {
        calls.push("cleanup");
        if (failure === "finalizer") throw new Error("cleanup failed");
      },
      cleanupSnapshot: async ({ sourceRoot }) => {
        calls.push("snapshot-cleanup");
        await chmod(sourceRoot, 0o700);
        await rm(sourceRoot, { recursive: true, force: true });
      },
      verifyFinalSource: async () => {
        calls.push("source-final");
        if (failure === "source-final") throw new Error("source changed");
      },
      publishEvidence: async () => {
        calls.push("publish");
        await mkdir(finalRoot, { mode: 0o700 });
        if (failure === "publish") throw new Error("publish failed after rename");
      },
      discardEvidence: async () => {
        calls.push("discard");
        await rm(stageRoot, { recursive: true, force: true });
        await rm(finalRoot, { recursive: true, force: true });
      },
    }));
    const expectedCalls = {
      drill: [`drill:${snapshotRoot}`, "diagnostics", "cleanup", "snapshot-cleanup", "discard"],
      negative: [`drill:${snapshotRoot}`, "stage", "negatives", "diagnostics", "cleanup", "snapshot-cleanup", "discard"],
      diagnostic: [`drill:${snapshotRoot}`, "stage", "negatives", "diagnostics", "cleanup", "snapshot-cleanup", "discard"],
      finalizer: [`drill:${snapshotRoot}`, "stage", "negatives", "cleanup", "diagnostics", "snapshot-cleanup", "discard"],
      "source-final": [`drill:${snapshotRoot}`, "stage", "negatives", "cleanup", "snapshot-cleanup", "source-final", "diagnostics", "discard"],
      publish: [`drill:${snapshotRoot}`, "stage", "negatives", "cleanup", "snapshot-cleanup", "source-final", "publish", "diagnostics", "discard"],
    };
    assert.deepEqual(calls, expectedCalls[failure]);
    assert.equal(calls.includes("publish"), failure === "publish");
    assert.equal(calls.at(-1), "discard");
    assert.equal(calls.includes("snapshot-cleanup"), true);
    if (failure === "drill" || failure === "negative" || failure === "diagnostic") {
      assert.equal(calls.includes("diagnostics"), true);
      assert.equal(calls.includes("cleanup"), true);
    }
    assert.equal(await absent(stageRoot), true);
    assert.equal(await absent(finalRoot), true);
    assert.equal(await absent(snapshotRoot), true);
    assert.deepEqual(await readdir(outputRoot), []);
  }
});
