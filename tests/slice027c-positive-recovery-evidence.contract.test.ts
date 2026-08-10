// @vitest-environment node

import { createHash } from "node:crypto";
import { access, chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BackupEvidenceV1Schema,
  RestoreDrillEvidenceV1Schema,
  canonicalSerializeBackupEvidence,
  canonicalSerializeRestoreDrillEvidence,
  checksumBackupEvidence,
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

const PRODUCER = Object.freeze({
  commitSha: COMMIT_SHA,
  treeSha: TREE_SHA,
  verification: "verified",
  releaseClaim: true,
});

async function optionalModule(path: string): Promise<Record<string, any>> {
  const url = pathToFileURL(resolve(root, path)).href;
  return import(`${url}?contract=${Date.now()}`).catch(() => ({}));
}

async function handoffModule(): Promise<Record<string, any>> {
  return optionalModule("scripts/recovery-evidence-handoff.mjs");
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

function canonicalJson(value: any): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function isAbsent(path: string): Promise<boolean> {
  return access(path).then(() => false, () => true);
}

function stageInput(producerIdentity: Record<string, unknown> = PRODUCER) {
  return {
    producerIdentity,
    backupEvidence: BACKUP,
    pitrVerify: PITR_VERIFY,
    directRecoveryState: "t",
    targetTime: "2026-08-11T00:02:00.123456Z",
    timeline: 1,
    sourceVolumeIdentitySha256: SOURCE_VOLUME_SHA,
    restoreVolumeIdentitySha256: RESTORE_VOLUME_SHA,
    startedAt: "2026-08-11T00:03:00.000000Z",
    completedAt: "2026-08-11T00:04:00.000000Z",
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("Slice 027C terminal recovery evidence handoff", () => {
  it("exports separate stage, terminal publish, discard and exact-scoped cleanup boundaries", async () => {
    const module = await handoffModule();
    expect(module.RECOVERY_EVIDENCE_DIRECTORY_NAME).toBe("recovery-evidence.v1");
    expect(module.RECOVERY_EVIDENCE_FILENAMES).toEqual({
      backup: "backup-evidence.v1.json",
      restore: "restore-drill-evidence.v1.json",
      handoff: "recovery-evidence-handoff.v1.json",
    });
    expect(module.stageRecoveryEvidenceHandoff).toBeTypeOf("function");
    expect(module.publishRecoveryEvidenceHandoff).toBeTypeOf("function");
    expect(module.discardRecoveryEvidenceHandoff).toBeTypeOf("function");
    expect(module.cleanupRecoveryEvidenceHandoff).toBeTypeOf("function");
    expect(module.writeRecoveryEvidenceHandoff).toBeUndefined();
  });

  it("stages the canonical triad privately and atomically publishes it only as terminal PASS", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const staged = await module.stageRecoveryEvidenceHandoff({
      outputDirectory,
      ...stageInput(),
    });
    const finalDirectory = join(outputDirectory, "recovery-evidence.v1");
    expect(await isAbsent(finalDirectory)).toBe(true);
    expect((await lstat(staged.stageRoot)).mode & 0o777).toBe(0o700);
    expect((await readdir(staged.stageRoot)).sort()).toEqual([
      "backup-evidence.v1.json",
      "recovery-evidence-handoff.v1.json",
      "restore-drill-evidence.v1.json",
    ]);

    const result = await module.publishRecoveryEvidenceHandoff({
      outputDirectory,
      stagedEvidence: staged,
      finalProducerIdentity: PRODUCER,
    });
    const backupPath = join(finalDirectory, "backup-evidence.v1.json");
    const restorePath = join(finalDirectory, "restore-drill-evidence.v1.json");
    const handoffPath = join(finalDirectory, "recovery-evidence-handoff.v1.json");
    const [backupBytes, restoreBytes, handoffBytes, names] = await Promise.all([
      readFile(backupPath),
      readFile(restorePath),
      readFile(handoffPath),
      readdir(finalDirectory),
    ]);
    expect(names.sort()).toEqual([
      "backup-evidence.v1.json",
      "recovery-evidence-handoff.v1.json",
      "restore-drill-evidence.v1.json",
    ]);
    for (const path of [backupPath, restorePath, handoffPath]) {
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
    }
    const parsedBackup = BackupEvidenceV1Schema.parse(JSON.parse(backupBytes.toString("utf8")));
    const parsedRestore = RestoreDrillEvidenceV1Schema.parse(JSON.parse(restoreBytes.toString("utf8")));
    const parsedHandoff = JSON.parse(handoffBytes.toString("utf8"));
    expect(backupBytes.toString("utf8")).toBe(canonicalSerializeBackupEvidence(parsedBackup));
    expect(restoreBytes.toString("utf8")).toBe(canonicalSerializeRestoreDrillEvidence(parsedRestore));
    expect(handoffBytes.toString("utf8")).toBe(canonicalJson(parsedHandoff));
    expect(parsedRestore.sourceBackupEvidenceSha256).toBe(checksumBackupEvidence(parsedBackup));
    expect(parsedHandoff).toEqual({
      version: "1",
      kind: "recovery-evidence-handoff",
      status: "passed",
      verification: "verified",
      releaseClaim: true,
      producer: BACKUP.producer,
      backup: { filename: "backup-evidence.v1.json", sha256: sha256(backupBytes) },
      restore: { filename: "restore-drill-evidence.v1.json", sha256: sha256(restoreBytes) },
    });
    expect(result).toMatchObject({
      status: "passed",
      verification: "verified",
      releaseClaim: true,
      handoff: {
        filename: "recovery-evidence-handoff.v1.json",
        sha256: sha256(handoffBytes),
      },
    });
    expect(`${backupBytes}${restoreBytes}${handoffBytes}`).not.toMatch(
      /(?:DATABASE_URL|ACCESS_KEY|SECRET|PRIVATE_KEY|\/tmp\/|\/run\/secrets\/)/,
    );
  });

  it("removes staging and publishes no final evidence when observations are invalid", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const callerSentinel = join(outputDirectory, "caller-owned.txt");
    await writeFile(callerSentinel, "preserve", { mode: 0o600 });
    await expect(module.stageRecoveryEvidenceHandoff({
      outputDirectory,
      ...stageInput(),
      pitrVerify: { ...PITR_VERIFY, afterCutCount: "1" },
    })).rejects.toThrow(/Recovery evidence handoff is invalid/);
    expect(await readdir(outputDirectory)).toEqual(["caller-owned.txt"]);
    expect(await readFile(callerSentinel, "utf8")).toBe("preserve");
  });

  it("allows dirty candidate bytes only in private draft staging and forbids terminal publication", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const draftProducer = {
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      verification: "draft",
      releaseClaim: false,
    };
    const staged = await module.stageRecoveryEvidenceHandoff({
      outputDirectory,
      ...stageInput(draftProducer),
    });
    await expect(module.publishRecoveryEvidenceHandoff({
      outputDirectory,
      stagedEvidence: staged,
      finalProducerIdentity: draftProducer,
    })).rejects.toThrow(/Draft recovery evidence cannot be published/);
    expect(await isAbsent(join(outputDirectory, "recovery-evidence.v1"))).toBe(true);
    await module.discardRecoveryEvidenceHandoff({ outputDirectory, stagedEvidence: staged });
    expect(await readdir(outputDirectory)).toEqual([]);
  });

  it("requires V2 authorization bound to a verified canonical handoff and restore before promotion", async () => {
    const [module, promotion] = await Promise.all([
      handoffModule(),
      optionalModule("scripts/restore-promotion.mjs"),
    ]);
    const outputDirectory = await temporaryOutput();
    const staged = await module.stageRecoveryEvidenceHandoff({ outputDirectory, ...stageInput() });
    await module.publishRecoveryEvidenceHandoff({
      outputDirectory,
      stagedEvidence: staged,
      finalProducerIdentity: PRODUCER,
    });
    const finalDirectory = join(outputDirectory, "recovery-evidence.v1");
    const backupEvidenceBytes = await readFile(join(finalDirectory, "backup-evidence.v1.json"));
    const restoreEvidenceBytes = await readFile(join(finalDirectory, "restore-drill-evidence.v1.json"));
    const handoffReceiptBytes = await readFile(join(finalDirectory, "recovery-evidence-handoff.v1.json"));
    const authorizationV2 = Buffer.from(canonicalJson({
      version: "2",
      kind: "restore-promotion-authorization",
      recoveryEvidenceHandoffSha256: sha256(handoffReceiptBytes),
      restoreDrillEvidenceSha256: sha256(restoreEvidenceBytes),
      operator: "operator_0123456789abcdef",
      authorizedAt: "2026-08-11T00:05:00.000000Z",
      expiresAt: "2026-08-11T00:15:00.000000Z",
      promote: true,
    }), "utf8");
    const effects: string[][] = [];
    await promotion.authorizeRestorePromotion({
      handoffReceiptBytes,
      expectedHandoffReceiptSha256: sha256(handoffReceiptBytes),
      backupEvidenceBytes,
      restoreEvidenceBytes,
      authorizationBytes: authorizationV2,
      now: "2026-08-11T00:06:00.000000Z",
      run: async (_command: string, args: string[]) => {
        effects.push(args);
        return { status: 0, stdout: "t\n", stderr: "" };
      },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0].join(" ")).toContain("pg_promote");

    const authorizationV1 = Buffer.from(canonicalJson({
      version: "1",
      kind: "restore-promotion-authorization",
      restoreDrillEvidenceSha256: sha256(restoreEvidenceBytes),
      operator: "operator_0123456789abcdef",
      authorizedAt: "2026-08-11T00:05:00.000000Z",
      expiresAt: "2026-08-11T00:15:00.000000Z",
      promote: true,
    }), "utf8");
    effects.length = 0;
    await expect(promotion.authorizeRestorePromotion({
      handoffReceiptBytes,
      expectedHandoffReceiptSha256: sha256(handoffReceiptBytes),
      backupEvidenceBytes,
      restoreEvidenceBytes,
      authorizationBytes: authorizationV1,
      now: "2026-08-11T00:06:00.000000Z",
      run: async () => {
        effects.push(["forbidden"]);
        return { status: 0 };
      },
    })).rejects.toThrow(/Restore promotion is forbidden/);
    expect(effects).toEqual([]);

    for (const authorization of [
      undefined,
      Buffer.from(canonicalJson({
        ...JSON.parse(authorizationV2.toString("utf8")),
        recoveryEvidenceHandoffSha256: `sha256:${"a".repeat(64)}`,
      }), "utf8"),
      Buffer.from(canonicalJson({
        ...JSON.parse(authorizationV2.toString("utf8")),
        restoreDrillEvidenceSha256: `sha256:${"b".repeat(64)}`,
      }), "utf8"),
      Buffer.from(JSON.stringify(JSON.parse(authorizationV2.toString("utf8")), null, 2), "utf8"),
    ]) {
      effects.length = 0;
      await expect(promotion.authorizeRestorePromotion({
        handoffReceiptBytes,
        expectedHandoffReceiptSha256: sha256(handoffReceiptBytes),
        backupEvidenceBytes,
        restoreEvidenceBytes,
        authorizationBytes: authorization,
        now: "2026-08-11T00:06:00.000000Z",
        run: async () => {
          effects.push(["forbidden"]);
          return { status: 0 };
        },
      })).rejects.toThrow();
      expect(effects).toEqual([]);
    }
  });

  it("rejects draft, missing, noncanonical and digest-substituted handoffs before effect", async () => {
    const promotion = await optionalModule("scripts/restore-promotion.mjs");
    expect(promotion.authorizeRestorePromotion).toBeTypeOf("function");
    const restoreEvidenceBytes = Buffer.from(canonicalSerializeRestoreDrillEvidence({
      version: "1",
      kind: "pitr-restore-drill",
      producer: BACKUP.producer,
      sourceBackupEvidenceSha256: checksumBackupEvidence(BACKUP),
      target: { targetTime: "2026-08-11T00:02:00.123456Z", inclusive: true, timeline: 1 },
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
      startedAt: "2026-08-11T00:03:00.000000Z",
      completedAt: "2026-08-11T00:04:00.000000Z",
      status: "passed",
    }), "utf8");
    const backupEvidenceBytes = Buffer.from(canonicalSerializeBackupEvidence(BACKUP), "utf8");
    const baseHandoff = {
      version: "1",
      kind: "recovery-evidence-handoff",
      status: "passed",
      verification: "verified",
      releaseClaim: true,
      producer: BACKUP.producer,
      backup: { filename: "backup-evidence.v1.json", sha256: sha256(backupEvidenceBytes) },
      restore: { filename: "restore-drill-evidence.v1.json", sha256: sha256(restoreEvidenceBytes) },
    };
    const baseHandoffBytes = Buffer.from(canonicalJson(baseHandoff), "utf8");
    for (const handoff of [
      undefined,
      Buffer.from(JSON.stringify(baseHandoff, null, 2), "utf8"),
      Buffer.from(canonicalJson({ ...baseHandoff, verification: "draft", releaseClaim: false }), "utf8"),
      Buffer.from(canonicalJson({ ...baseHandoff, producer: { ...baseHandoff.producer, treeSha: "a".repeat(40) } }), "utf8"),
      Buffer.from(canonicalJson({ ...baseHandoff, restore: { ...baseHandoff.restore, sha256: `sha256:${"f".repeat(64)}` } }), "utf8"),
    ]) {
      const effects: string[] = [];
      const authorizationBytes = Buffer.from(canonicalJson({
        version: "2",
        kind: "restore-promotion-authorization",
        recoveryEvidenceHandoffSha256: sha256(handoff ?? baseHandoffBytes),
        restoreDrillEvidenceSha256: sha256(restoreEvidenceBytes),
        operator: "operator_0123456789abcdef",
        authorizedAt: "2026-08-11T00:05:00.000000Z",
        expiresAt: "2026-08-11T00:15:00.000000Z",
        promote: true,
      }), "utf8");
      await expect(promotion.authorizeRestorePromotion({
        handoffReceiptBytes: handoff,
        expectedHandoffReceiptSha256: handoff ? sha256(handoff) : undefined,
        backupEvidenceBytes,
        restoreEvidenceBytes,
        authorizationBytes,
        now: "2026-08-11T00:06:00.000000Z",
        run: async () => {
          effects.push("effect");
          return { status: 0 };
        },
      })).rejects.toThrow();
      expect(effects).toEqual([]);
    }
  });

  it("removes only the terminal evidence directory after explicit caller cleanup", async () => {
    const module = await handoffModule();
    const outputDirectory = await temporaryOutput();
    const staged = await module.stageRecoveryEvidenceHandoff({ outputDirectory, ...stageInput() });
    await module.publishRecoveryEvidenceHandoff({
      outputDirectory,
      stagedEvidence: staged,
      finalProducerIdentity: PRODUCER,
    });
    await module.cleanupRecoveryEvidenceHandoff({ outputDirectory });
    expect(await readdir(outputDirectory)).toEqual([]);
    expect((await lstat(outputDirectory)).isDirectory()).toBe(true);
  });
});
