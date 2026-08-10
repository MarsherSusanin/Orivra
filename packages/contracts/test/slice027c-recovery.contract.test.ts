// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

async function optionalModule(path: string): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function recoveryContracts(): Promise<Record<string, any>> {
  return optionalModule(pathToFileURL(fileURLToPath(
    new URL("../src/recovery.ts", import.meta.url),
  )).href);
}

const sha = (character: string) => `sha256:${character.repeat(64)}`;

const BACKUP = {
  version: "1",
  kind: "base-backup",
  producer: {
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    postgresImageDigest: sha("c"),
    walGVersion: "v3.0.8",
  },
  database: {
    slot: "qa",
    systemIdentifier: "7532076200787175519",
    postgresMajor: 17,
    schemaVersion: 10,
    migrationCount: 10,
    migrationManifestSha256: sha("d"),
  },
  storage: {
    provider: "minio",
    endpointOrigin: "http://minio:9000",
    bucket: "proofline-recovery-qa",
    prefix: "s3://proofline-recovery-qa/proofline/v1/qa/7532076200787175519",
    encryption: "wal-g-libsodium",
    encryptionKeyIdSha256: sha("e"),
  },
  backup: {
    id: "base_00000001000000000000000A",
    startedAt: "2026-08-10T01:00:00.000000Z",
    completedAt: "2026-08-10T01:01:00.000000Z",
    startLsn: "0/A000028",
    stopLsn: "0/B0001F8",
    startWalSegment: "00000001000000000000000A",
    stopWalSegment: "00000001000000000000000B",
    timeline: 1,
  },
  inventory: {
    entries: [
      {
        key: "basebackups_005/base_00000001000000000000000A/tar_partitions/part_001.tar.lz4",
        size: 4096,
        sha256: sha("6"),
      },
      {
        key: "wal_005/00000001000000000000000B.lz4",
        size: 4096,
        sha256: sha("7"),
      },
    ],
    objectCount: 2,
    totalBytes: 8192,
    canonicalSha256: sha("f"),
  },
  status: "completed",
} as const;

const RESTORE = {
  version: "1",
  kind: "pitr-restore-drill",
  producer: {
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    postgresImageDigest: sha("c"),
    walGVersion: "v3.0.8",
  },
  sourceBackupEvidenceSha256: sha("1"),
  target: {
    targetTime: "2026-08-10T01:02:00.123456Z",
    inclusive: true,
    timeline: 1,
  },
  restore: {
    sourceVolumeIdentitySha256: sha("2"),
    restoreVolumeIdentitySha256: sha("3"),
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
  startedAt: "2026-08-10T01:03:00.000000Z",
  completedAt: "2026-08-10T01:04:00.000000Z",
  status: "passed",
} as const;

describe("Slice 027C strict recovery evidence contracts", () => {
  it("exports a cycle-free recovery feature with root identity compatibility", async () => {
    const [feature, root, packageJson, source] = await Promise.all([
      recoveryContracts(),
      optionalModule(pathToFileURL(fileURLToPath(
        new URL("../src/index.ts", import.meta.url),
      )).href),
      readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../src/recovery.ts", import.meta.url), "utf8").catch(() => ""),
    ]);
    expect(packageJson.exports?.["./recovery"]).toBe("./src/recovery.ts");
    for (const name of [
      "BackupEvidenceV1Schema",
      "RestoreDrillEvidenceV1Schema",
      "RestorePromotionAuthorizationV1Schema",
      "RestorePromotionAuthorizationV2Schema",
      "RecoveryEvidenceHandoffV1Schema",
      "canonicalSerializeBackupEvidence",
      "canonicalSerializeRestoreDrillEvidence",
      "canonicalSerializeRecoveryEvidenceHandoff",
      "checksumBackupEvidence",
      "checksumRestoreDrillEvidence",
      "checksumRecoveryEvidenceHandoff",
    ]) {
      expect(feature[name], name).toBeDefined();
      expect(root[name], `${name} root identity`).toBe(feature[name]);
    }
    expect(source).not.toMatch(/node:|process\.|fetch\s*\(|setTimeout|@proofline\/domain/);
  });

  it("accepts only exact completed backup evidence without authority fields", async () => {
    const { BackupEvidenceV1Schema: schema } = await recoveryContracts();
    expect(schema).toBeDefined();
    expect(schema.parse(BACKUP)).toEqual(BACKUP);
    for (const invalid of [
      { ...BACKUP, status: "pending" },
      { ...BACKUP, latest: true },
      { ...BACKUP, credentials: { accessKey: "private" } },
      { ...BACKUP, databaseUrl: "postgres://secret@postgres/proofline" },
      { ...BACKUP, storage: { ...BACKUP.storage, prefix: "s3://caller-owned" } },
      { ...BACKUP, producer: { ...BACKUP.producer, walGVersion: "latest" } },
      { ...BACKUP, producer: { ...BACKUP.producer, commitSha: BACKUP.producer.treeSha } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, canonicalSha256: `sha256:${"A".repeat(64)}` } },
    ]) expect(() => schema.parse(invalid)).toThrow();
  });

  it("requires exact UTC microseconds, ordered WAL bounds and honest inventory", async () => {
    const { BackupEvidenceV1Schema: schema } = await recoveryContracts();
    expect(schema).toBeDefined();
    for (const invalid of [
      { ...BACKUP, backup: { ...BACKUP.backup, startedAt: "2026-08-10T01:00:00Z" } },
      { ...BACKUP, backup: { ...BACKUP.backup, completedAt: "2026-08-10T00:59:00.000000Z" } },
      { ...BACKUP, backup: { ...BACKUP.backup, timeline: 0 } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, objectCount: 0 } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, objectCount: 3 } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, totalBytes: -1 } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, totalBytes: 8191 } },
      { ...BACKUP, inventory: {
        ...BACKUP.inventory,
        entries: [...BACKUP.inventory.entries].reverse(),
      } },
      { ...BACKUP, inventory: {
        ...BACKUP.inventory,
        entries: [{
          ...BACKUP.inventory.entries[0],
          key: "unbounded/object",
        }, BACKUP.inventory.entries[1]],
      } },
      { ...BACKUP, inventory: { ...BACKUP.inventory, etag: "not-a-sha256" } },
      { ...BACKUP, storage: { ...BACKUP.storage, endpointOrigin: "https://user@minio:9000" } },
    ]) expect(() => schema.parse(invalid)).toThrow();
  });

  it("serializes backup evidence to one canonical UTF-8 byte sequence and checksum", async () => {
    const module = await recoveryContracts();
    expect(module.canonicalSerializeBackupEvidence).toBeTypeOf("function");
    const canonical = module.canonicalSerializeBackupEvidence(BACKUP);
    const reordered = module.canonicalSerializeBackupEvidence({
      status: BACKUP.status,
      inventory: BACKUP.inventory,
      backup: BACKUP.backup,
      storage: BACKUP.storage,
      database: BACKUP.database,
      producer: BACKUP.producer,
      kind: BACKUP.kind,
      version: BACKUP.version,
    });
    expect(reordered).toBe(canonical);
    expect(Buffer.from(canonical, "utf8").toString("utf8")).toBe(canonical);
    expect(JSON.parse(canonical)).toEqual(BACKUP);
    expect(module.checksumBackupEvidence(BACKUP)).toBe(
      `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    );
  });

  it("accepts only a paused, in-recovery, unpromoted exact-time restore PASS", async () => {
    const { RestoreDrillEvidenceV1Schema: schema } = await recoveryContracts();
    expect(schema).toBeDefined();
    expect(schema.parse(RESTORE)).toEqual(RESTORE);
    for (const invalid of [
      { ...RESTORE, producer: { ...RESTORE.producer, commitSha: RESTORE.producer.treeSha } },
      { ...RESTORE, target: { ...RESTORE.target, inclusive: false } },
      { ...RESTORE, target: { ...RESTORE.target, timeline: "latest" } },
      { ...RESTORE, restore: { ...RESTORE.restore, paused: false } },
      { ...RESTORE, restore: { ...RESTORE.restore, inRecovery: false } },
      { ...RESTORE, restore: { ...RESTORE.restore, promoted: true } },
      { ...RESTORE, restore: { ...RESTORE.restore, restoreVolumeIdentitySha256: sha("2") } },
      { ...RESTORE, checks: { ...RESTORE.checks, afterCutAbsent: false } },
      { ...RESTORE, status: "partial" },
      { ...RESTORE, latest: true },
    ]) expect(() => schema.parse(invalid)).toThrow();
  });

  it("canonicalizes restore evidence and binds an explicit separate promotion authorization", async () => {
    const module = await recoveryContracts();
    expect(module.canonicalSerializeRestoreDrillEvidence).toBeTypeOf("function");
    const canonical = module.canonicalSerializeRestoreDrillEvidence(RESTORE);
    expect(JSON.parse(canonical)).toEqual(RESTORE);
    const restoreSha = module.checksumRestoreDrillEvidence(RESTORE);
    expect(restoreSha).toBe(
      `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    );
    const authorization = {
      version: "1",
      kind: "restore-promotion-authorization",
      restoreDrillEvidenceSha256: restoreSha,
      operator: "operator_0123456789abcdef",
      authorizedAt: "2026-08-10T01:05:00.000000Z",
      expiresAt: "2026-08-10T01:15:00.000000Z",
      promote: true,
    };
    expect(module.RestorePromotionAuthorizationV1Schema.parse(authorization))
      .toEqual(authorization);
    for (const invalid of [
      { ...authorization, promote: false },
      { ...authorization, expiresAt: "2026-08-10T01:04:00.000000Z" },
      { ...authorization, rawSecret: "forbidden" },
    ]) {
      expect(() => module.RestorePromotionAuthorizationV1Schema.parse(
        invalid,
      )).toThrow();
    }
  });

  it("keeps V1 as compatibility data and requires V2 to bind the terminal handoff and restore digests", async () => {
    const module = await recoveryContracts();
    const restoreSha = module.checksumRestoreDrillEvidence(RESTORE);
    const handoff = {
      version: "1",
      kind: "recovery-evidence-handoff",
      status: "passed",
      verification: "verified",
      releaseClaim: true,
      producer: RESTORE.producer,
      backup: {
        filename: "backup-evidence.v1.json",
        sha256: RESTORE.sourceBackupEvidenceSha256,
      },
      restore: {
        filename: "restore-drill-evidence.v1.json",
        sha256: restoreSha,
      },
    };
    expect(module.RecoveryEvidenceHandoffV1Schema.parse(handoff)).toEqual(handoff);
    const canonical = module.canonicalSerializeRecoveryEvidenceHandoff(handoff);
    const handoffSha = module.checksumRecoveryEvidenceHandoff(handoff);
    expect(JSON.parse(canonical)).toEqual(handoff);
    expect(handoffSha).toBe(
      `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    );
    expect(module.RecoveryEvidenceHandoffV1Schema.parse({
      ...handoff,
      verification: "draft",
      releaseClaim: false,
    })).toEqual({ ...handoff, verification: "draft", releaseClaim: false });
    const authorizationV2 = {
      version: "2",
      kind: "restore-promotion-authorization",
      recoveryEvidenceHandoffSha256: handoffSha,
      restoreDrillEvidenceSha256: restoreSha,
      operator: "operator_0123456789abcdef",
      authorizedAt: "2026-08-10T01:05:00.000000Z",
      expiresAt: "2026-08-10T01:15:00.000000Z",
      promote: true,
    };
    expect(module.RestorePromotionAuthorizationV2Schema.parse(authorizationV2))
      .toEqual(authorizationV2);
    for (const invalid of [
      { ...handoff, verification: "draft", releaseClaim: true },
      { ...handoff, verification: "verified", releaseClaim: false },
      { ...handoff, producer: { ...handoff.producer, commitSha: handoff.producer.treeSha } },
      { ...handoff, restore: { ...handoff.restore, filename: "other.json" } },
      { ...handoff, extra: true },
      { ...authorizationV2, version: "1" },
      { ...authorizationV2, recoveryEvidenceHandoffSha256: "sha256:abc" },
      { ...authorizationV2, extra: true },
    ]) {
      const schema = "kind" in invalid && invalid.kind === "recovery-evidence-handoff"
        ? module.RecoveryEvidenceHandoffV1Schema
        : module.RestorePromotionAuthorizationV2Schema;
      expect(() => schema.parse(invalid)).toThrow();
    }
    expect(module.RestorePromotionAuthorizationV1Schema).toBeDefined();
  });

  it("keeps the accepted deployment health contract unchanged as a GREEN control", async () => {
    const deployment = await optionalModule(pathToFileURL(fileURLToPath(
      new URL("../src/deployment.ts", import.meta.url),
    )).href);
    expect(deployment.DeploymentHealthV1Schema.parse({
      version: "1",
      status: "ok",
    })).toEqual({ version: "1", status: "ok" });
  });
});
