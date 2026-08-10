// @vitest-environment node

import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BackupEvidenceV1Schema,
  RestoreDrillEvidenceV1Schema,
  canonicalSerializeBackupEvidence,
  canonicalSerializeRestoreDrillEvidence,
  checksumBackupEvidence,
  checksumRestoreDrillEvidence,
} from "@proofline/contracts/recovery";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];
const COMMIT_SHA = "1".repeat(40);
const TREE_SHA = "2".repeat(40);
const POSTGRES_IMAGE_SHA = `sha256:${"3".repeat(64)}`;
const MIGRATION_SHA = `sha256:${"4".repeat(64)}`;
const KEY_SHA = `sha256:${"5".repeat(64)}`;
const SOURCE_VOLUME_SHA = `sha256:${"6".repeat(64)}`;
const RESTORE_VOLUME_SHA = `sha256:${"7".repeat(64)}`;
const INVENTORY_SHA = `sha256:${"8".repeat(64)}`;

const BACKUP = {
  version: "1",
  kind: "base-backup",
  producer: {
    commitSha: COMMIT_SHA,
    treeSha: TREE_SHA,
    postgresImageDigest: POSTGRES_IMAGE_SHA,
    walGVersion: "v3.0.8",
  },
  database: {
    slot: "qa",
    systemIdentifier: "7532076200787175519",
    postgresMajor: 17,
    schemaVersion: 10,
    migrationCount: 10,
    migrationManifestSha256: MIGRATION_SHA,
  },
  storage: {
    provider: "minio",
    endpointOrigin: "http://minio:9000",
    bucket: "proofline-recovery-qa",
    prefix: "s3://proofline-recovery-qa/proofline/v1/qa/7532076200787175519",
    encryption: "wal-g-libsodium",
    encryptionKeyIdSha256: KEY_SHA,
  },
  backup: {
    id: "base_00000001000000000000000A",
    startedAt: "2026-08-11T00:00:00.000000Z",
    completedAt: "2026-08-11T00:01:00.000000Z",
    startLsn: "0/A000028",
    stopLsn: "0/B0001F8",
    startWalSegment: "00000001000000000000000A",
    stopWalSegment: "00000001000000000000000B",
    timeline: 1,
  },
  inventory: {
    entries: [{
      key: "wal_005/00000001000000000000000B.lz4",
      size: 4096,
      sha256: `sha256:${"9".repeat(64)}`,
    }],
    objectCount: 1,
    totalBytes: 4096,
    canonicalSha256: INVENTORY_SHA,
  },
  status: "completed",
} as const;

const PITR_VERIFY = {
  pgIsInRecovery: "t",
  pgIsWalReplayPaused: "t",
  systemIdentifier: BACKUP.database.systemIdentifier,
  expectedSystemIdentifier: BACKUP.database.systemIdentifier,
  schemaVersion: "10",
  migrationChecksumCount: "10",
  beforeCutCount: "1",
  afterCutCount: "0",
  inventorySha256: INVENTORY_SHA,
  expectedInventorySha256: INVENTORY_SHA,
} as const;

async function handoffModule(): Promise<Record<string, any>> {
  const url = pathToFileURL(resolve(root, "scripts/recovery-evidence-handoff.mjs")).href;
  return import(`${url}?contract=${Date.now()}`).catch(() => ({}));
}

async function temporaryOutput(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-evidence-red-"));
  temporaryRoots.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("Slice 027C corrective positive recovery evidence handoff", () => {
  it("exports one exact atomic handoff and cleanup boundary", async () => {
    const module = await handoffModule();
    expect(module.RECOVERY_EVIDENCE_DIRECTORY_NAME).toBe("recovery-evidence.v1");
    expect(module.RECOVERY_EVIDENCE_FILENAMES).toEqual({
      backup: "backup-evidence.v1.json",
      restore: "restore-drill-evidence.v1.json",
    });
    expect(module.resolveRecoveryProducerIdentity).toBeTypeOf("function");
    expect(module.writeRecoveryEvidenceHandoff).toBeTypeOf("function");
    expect(module.cleanupRecoveryEvidenceHandoff).toBeTypeOf("function");
  });

  it("derives distinct exact commit and tree identities from three independent repository reads", async () => {
    const module = await handoffModule();
    const calls: string[][] = [];
    const outputByArguments = new Map([
      ["rev-parse\0HEAD", `${COMMIT_SHA}\n`],
      ["rev-parse\0HEAD^{tree}", `${TREE_SHA}\n`],
      ["status\0--porcelain", ""],
    ]);
    const identity = await module.resolveRecoveryProducerIdentity({
      repositoryRoot: root,
      runGit: async (arguments_: string[]) => {
        calls.push(arguments_);
        return { exitCode: 0, stdout: outputByArguments.get(arguments_.join("\0")) ?? "" };
      },
    });
    expect(calls).toEqual([
      ["rev-parse", "HEAD"],
      ["rev-parse", "HEAD^{tree}"],
      ["status", "--porcelain"],
    ]);
    expect(identity).toEqual({
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      verification: "verified",
      releaseClaim: true,
    });

    for (const invalid of [
      { commit: TREE_SHA, tree: TREE_SHA, status: "" },
      { commit: "A".repeat(40), tree: TREE_SHA, status: "" },
      { commit: COMMIT_SHA, tree: TREE_SHA, status: " M production.ts\n" },
    ]) {
      await expect(module.resolveRecoveryProducerIdentity({
        repositoryRoot: root,
        runGit: async (arguments_: string[]) => ({
          exitCode: 0,
          stdout: arguments_[0] === "status"
            ? invalid.status
            : arguments_.at(-1) === "HEAD" ? `${invalid.commit}\n` : `${invalid.tree}\n`,
        }),
      })).rejects.toThrow(/Recovery producer identity is invalid/);
    }
  });

  it("labels a dirty local author handoff draft without reusing or omitting schema identity", async () => {
    const module = await handoffModule();
    const identity = await module.resolveRecoveryProducerIdentity({
      repositoryRoot: root,
      allowDirtyDraft: true,
      runGit: async (arguments_: string[]) => ({
        exitCode: 0,
        stdout: arguments_[0] === "status"
          ? " M docs/runbook.md\n"
          : arguments_.at(-1) === "HEAD" ? `${COMMIT_SHA}\n` : `${TREE_SHA}\n`,
      }),
    });
    expect(identity).toEqual({
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      verification: "draft",
      releaseClaim: false,
    });
    expect(identity.commitSha).not.toBe(identity.treeSha);
  });

  it("writes exact canonical backup and actual-derived restore artifacts and preserves them on PASS", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const result = await module.writeRecoveryEvidenceHandoff({
      outputDirectory,
      producerIdentity: {
        commitSha: COMMIT_SHA,
        treeSha: TREE_SHA,
        verification: "verified",
        releaseClaim: true,
      },
      backupEvidence: BACKUP,
      pitrVerify: PITR_VERIFY,
      directRecoveryState: "t",
      targetTime: "2026-08-11T00:02:00.123456Z",
      timeline: 1,
      sourceVolumeIdentitySha256: SOURCE_VOLUME_SHA,
      restoreVolumeIdentitySha256: RESTORE_VOLUME_SHA,
      startedAt: "2026-08-11T00:03:00.000000Z",
      completedAt: "2026-08-11T00:04:00.000000Z",
    });

    const artifactDirectory = join(outputDirectory, "recovery-evidence.v1");
    const backupPath = join(artifactDirectory, "backup-evidence.v1.json");
    const restorePath = join(artifactDirectory, "restore-drill-evidence.v1.json");
    const [backupBytes, restoreBytes, names, backupStat, restoreStat] = await Promise.all([
      readFile(backupPath),
      readFile(restorePath),
      readdir(artifactDirectory),
      lstat(backupPath),
      lstat(restorePath),
    ]);
    expect(names.sort()).toEqual([
      "backup-evidence.v1.json",
      "restore-drill-evidence.v1.json",
    ]);
    expect(backupStat.isFile()).toBe(true);
    expect(restoreStat.isFile()).toBe(true);
    expect(backupStat.mode & 0o777).toBe(0o600);
    expect(restoreStat.mode & 0o777).toBe(0o600);

    const parsedBackup = BackupEvidenceV1Schema.parse(JSON.parse(backupBytes.toString("utf8")));
    const parsedRestore = RestoreDrillEvidenceV1Schema.parse(JSON.parse(restoreBytes.toString("utf8")));
    expect(backupBytes.toString("utf8")).toBe(canonicalSerializeBackupEvidence(parsedBackup));
    expect(restoreBytes.toString("utf8")).toBe(canonicalSerializeRestoreDrillEvidence(parsedRestore));
    expect(parsedBackup.status).toBe("completed");
    expect(parsedBackup.producer).toEqual(BACKUP.producer);
    expect(parsedRestore).toMatchObject({
      producer: BACKUP.producer,
      sourceBackupEvidenceSha256: checksumBackupEvidence(parsedBackup),
      target: {
        targetTime: "2026-08-11T00:02:00.123456Z",
        inclusive: true,
        timeline: 1,
      },
      restore: {
        sourceVolumeIdentitySha256: SOURCE_VOLUME_SHA,
        restoreVolumeIdentitySha256: RESTORE_VOLUME_SHA,
        paused: true,
        inRecovery: true,
        promoted: false,
      },
      checks: {
        systemIdentifierMatches: true,
        schemaVersion: 10,
        migrationChecksums: 10,
        beforeCutPresent: true,
        afterCutAbsent: true,
        inventorySha256Matches: true,
      },
      status: "passed",
    });
    expect(result).toEqual({
      version: "1",
      kind: "recovery-evidence-handoff",
      status: "passed",
      verification: "verified",
      releaseClaim: true,
      producer: { commitSha: COMMIT_SHA, treeSha: TREE_SHA },
      backup: {
        filename: "backup-evidence.v1.json",
        sha256: sha256(backupBytes),
      },
      restore: {
        filename: "restore-drill-evidence.v1.json",
        sha256: checksumRestoreDrillEvidence(parsedRestore),
      },
    });
    expect(result.restore.sha256).toBe(sha256(restoreBytes));
    expect(`${backupBytes}${restoreBytes}`).not.toMatch(
      /(?:DATABASE_URL|ACCESS_KEY|SECRET|PRIVATE_KEY|\/tmp\/|\/run\/secrets\/)/,
    );
  });

  it("fails before publishing either artifact and removes only the exact atomic staging boundary", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const callerSentinel = join(outputDirectory, "caller-owned.txt");
    await writeFile(callerSentinel, "preserve", { mode: 0o600 });
    await expect(module.writeRecoveryEvidenceHandoff({
      outputDirectory,
      producerIdentity: {
        commitSha: COMMIT_SHA,
        treeSha: TREE_SHA,
        verification: "verified",
        releaseClaim: true,
      },
      backupEvidence: BACKUP,
      pitrVerify: { ...PITR_VERIFY, afterCutCount: "1" },
      directRecoveryState: "t",
      targetTime: "2026-08-11T00:02:00.123456Z",
      timeline: 1,
      sourceVolumeIdentitySha256: SOURCE_VOLUME_SHA,
      restoreVolumeIdentitySha256: RESTORE_VOLUME_SHA,
      startedAt: "2026-08-11T00:03:00.000000Z",
      completedAt: "2026-08-11T00:04:00.000000Z",
    })).rejects.toThrow(/Recovery evidence handoff is invalid/);
    expect(await readdir(outputDirectory)).toEqual(["caller-owned.txt"]);
    expect(await readFile(callerSentinel, "utf8")).toBe("preserve");
  });

  it("requires explicit scoped cleanup after PASS without deleting the caller output root", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    await module.writeRecoveryEvidenceHandoff({
      outputDirectory,
      producerIdentity: {
        commitSha: COMMIT_SHA,
        treeSha: TREE_SHA,
        verification: "draft",
        releaseClaim: false,
      },
      backupEvidence: BACKUP,
      pitrVerify: PITR_VERIFY,
      directRecoveryState: "t",
      targetTime: "2026-08-11T00:02:00.123456Z",
      timeline: 1,
      sourceVolumeIdentitySha256: SOURCE_VOLUME_SHA,
      restoreVolumeIdentitySha256: RESTORE_VOLUME_SHA,
      startedAt: "2026-08-11T00:03:00.000000Z",
      completedAt: "2026-08-11T00:04:00.000000Z",
    });
    expect(await readdir(outputDirectory)).toEqual(["recovery-evidence.v1"]);
    await module.cleanupRecoveryEvidenceHandoff({ outputDirectory });
    expect(await readdir(outputDirectory)).toEqual([]);
    expect((await lstat(outputDirectory)).isDirectory()).toBe(true);
  });

  it("binds the actual positive artifacts into promotion negatives and the final repository identity", async () => {
    const [gate, negativeRuntime, handoff] = await Promise.all([
      readFile(resolve(root, "scripts/docker-recovery-gate.mjs"), "utf8"),
      readFile(resolve(root, "scripts/docker-recovery-negative-runtime.mjs"), "utf8"),
      readFile(resolve(root, "scripts/recovery-evidence-handoff.mjs"), "utf8").catch(() => ""),
    ]);
    expect(handoff).toMatch(/rev-parse[\s\S]*HEAD[\s\S]*HEAD\^\{tree\}[\s\S]*status[\s\S]*--porcelain/);
    expect(gate).toMatch(/resolveRecoveryProducerIdentity/);
    expect(gate).toMatch(/writeRecoveryEvidenceHandoff/);
    expect(gate).toMatch(/PROOFLINE_RECOVERY_EVIDENCE_OUTPUT_DIR/);
    expect(gate).not.toMatch(/PROOFLINE_RELEASE_TREE_SHA:\s*randomBytes/);
    expect(gate).toMatch(/commitSha:\s*producerIdentity\.commitSha/);
    expect(gate).toMatch(/treeSha:\s*producerIdentity\.treeSha/);
    expect(negativeRuntime).not.toMatch(/function\s+promotionEvidence\s*\(/);
    expect(negativeRuntime).toMatch(/positive\.(?:restoreEvidencePath|restoreEvidenceBytes)/);
    expect(negativeRuntime).toMatch(/positive\.restoreEvidenceSha256/);
    expect(negativeRuntime).not.toMatch(/commitSha:\s*["']a["']\.repeat|treeSha:\s*["']b["']\.repeat/);
    expect(gate).not.toMatch(/pg_promote\s*\(/);
  });
});
