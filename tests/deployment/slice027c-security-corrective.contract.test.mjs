import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

async function optionalImport(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?contract=${Date.now()}`)
    .catch(() => ({}));
}

function expectCode(code, message) {
  return (error) => error?.code === code && error?.message === message;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" ||
      typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function inventoryFor(objects) {
  const entries = [...objects.entries()]
    .map(([key, bytes]) => ({ key, size: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => Buffer.from(left.key).compare(Buffer.from(right.key)));
  const value = {
    entries,
    objectCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
  return { ...value, canonicalSha256: sha256(Buffer.from(canonicalJson(value), "utf8")) };
}

const encryptionKey = Buffer.from("proofline-027c-fixture-encryption-key", "utf8");
const ciphertextObjects = new Map([
  [
    "wal_005/00000001000000000000000B.lz4",
    Buffer.from("encrypted-wal-ciphertext", "utf8"),
  ],
  [
    "basebackups_005/base_00000001000000000000000A/tar_partitions/part_001.tar.lz4",
    Buffer.from("encrypted-base-backup-ciphertext", "utf8"),
  ],
]);

function backupEvidence(inventory = inventoryFor(ciphertextObjects)) {
  return {
    version: "1",
    kind: "base-backup",
    producer: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      postgresImageDigest: `sha256:${"c".repeat(64)}`,
      walGVersion: "v3.0.8",
    },
    database: {
      slot: "qa",
      systemIdentifier: "7532076200787175519",
      postgresMajor: 17,
      schemaVersion: 10,
      migrationCount: 10,
      migrationManifestSha256: `sha256:${"d".repeat(64)}`,
    },
    storage: {
      provider: "minio",
      endpointOrigin: "http://minio:9000",
      bucket: "proofline-recovery-qa",
      prefix: "s3://proofline-recovery-qa/proofline/v1/qa/7532076200787175519",
      encryption: "wal-g-libsodium",
      encryptionKeyIdSha256: sha256(encryptionKey),
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
    inventory,
    status: "completed",
  };
}

function canonicalEvidence(value = backupEvidence()) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function storageReader(objects) {
  const calls = { list: 0, reads: [] };
  return {
    calls,
    async listObjects() {
      calls.list += 1;
      return [...objects.entries()].reverse().map(([key, bytes]) => ({
        key,
        size: bytes.length,
      }));
    },
    async readObject(key) {
      calls.reads.push(key);
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("missing fixture object"), { code: "ENOENT" });
      return Buffer.from(bytes);
    },
  };
}

const WAL_G_INPUT_ERROR = expectCode(
  "RECOVERY_WAL_G_INPUT_INVALID",
  "Recovery WAL-G build input is invalid",
);

async function createWalGFixture(directory, bytes) {
  const context = join(directory, "docker/.prefetch/wal_g_release");
  await mkdir(context, { recursive: true, mode: 0o700 });
  await writeFile(join(context, "wal-g"), bytes, { mode: 0o555 });
  await writeFile(join(context, "receipt.v1.json"), canonicalJson({
    version: "1",
    binarySize: bytes.length,
    binarySha256: sha256(bytes),
  }), { mode: 0o444 });
  return context;
}

function walGLock(bytes) {
  return {
    version: "1",
    walGVersion: "v3.0.8",
    platform: "linux/amd64",
    assetUrl: "https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz",
    assetSha256: "sha256:b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9",
    maximumBytes: 17_891_961,
    binarySha256: sha256(bytes),
  };
}

const recoveryImageLock = {
  version: "1",
  platform: "linux/amd64",
  images: {
    postgresRecovery: {
      repository: "postgres",
      tag: "17.6-bookworm",
      indexDigest: `sha256:${"a".repeat(64)}`,
      linuxAmd64Digest: `sha256:${"b".repeat(64)}`,
    },
  },
};

test("binds use-time WAL-G verification to the exact bytes copied by BuildKit", async () => {
  const [entry, orchestration, dockerfile] = await Promise.all([
    source("scripts/docker-build.mjs"),
    source("scripts/docker-build-orchestration.mjs"),
    source("docker/postgres-recovery.Dockerfile"),
  ]);
  assert.match(entry, /docker-build-orchestration\.mjs/);
  assert.match(entry, /wal-g-release\.v1\.json/);
  assert.match(orchestration, /O_NOFOLLOW/);
  assert.match(orchestration, /O_NONBLOCK/);
  assert.match(orchestration, /isFile\s*\(/);
  assert.match(orchestration, /0o555|0?555/);
  assert.match(orchestration, /binarySize/);
  assert.match(orchestration, /binarySha256/);
  assert.match(orchestration, /handle\.read|readFile\s*\(\s*handle/);
  assert.match(orchestration, /mkdtemp|immutable|capture/i);
  assert.match(dockerfile, /PROOFLINE_WAL_G_BINARY_SHA256/);
  assert.match(dockerfile, /sha256sum\s+--check|sha256sum\s+-c/);
  assert.match(dockerfile, /\/usr\/local\/bin\/wal-g/);
});

test("fails a safe same-owner WAL-G replacement before one Docker build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-walg-replaced-"));
  try {
    const trusted = Buffer.from("trusted-wal-g-fixture", "utf8");
    const context = await createWalGFixture(directory, trusted);
    const replacement = Buffer.alloc(trusted.length, 0x78);
    const replacementPath = join(directory, "replacement-wal-g");
    await writeFile(replacementPath, replacement, { mode: 0o555 });
    await rename(replacementPath, join(context, "wal-g"));
    const module = await optionalImport("scripts/docker-build-orchestration.mjs");
    let dockerCalls = 0;
    await assert.rejects(module.runOfflineDockerBuilds({
      root: directory,
      imageLock: recoveryImageLock,
      walGLock: walGLock(trusted),
      runDocker() { dockerCalls += 1; },
    }), WAL_G_INPUT_ERROR);
    assert.equal(dockerCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects symlink, non-regular, wrong-mode, empty and receipt-size WAL-G inputs", async () => {
  const module = await optionalImport("scripts/docker-build-orchestration.mjs");
  const trusted = Buffer.from("trusted-wal-g-fixture", "utf8");
  for (const invalid of ["symlink", "directory", "mode", "empty", "size"]) {
    const directory = await mkdtemp(join(tmpdir(), `proofline-027c-walg-${invalid}-`));
    try {
      const context = await createWalGFixture(directory, trusted);
      const binaryPath = join(context, "wal-g");
      if (invalid === "symlink") {
        await rename(binaryPath, join(context, "target"));
        await symlink("target", binaryPath);
      } else if (invalid === "directory") {
        await rm(binaryPath);
        await mkdir(binaryPath);
      } else if (invalid === "mode") {
        await chmod(binaryPath, 0o755);
      } else if (invalid === "empty") {
        await chmod(binaryPath, 0o600);
        await writeFile(binaryPath, Buffer.alloc(0));
        await chmod(binaryPath, 0o555);
      } else {
        const receiptPath = join(context, "receipt.v1.json");
        await chmod(receiptPath, 0o600);
        await writeFile(receiptPath, canonicalJson({
          version: "1",
          binarySize: trusted.length + 1,
          binarySha256: sha256(trusted),
        }));
        await chmod(receiptPath, 0o444);
      }
      let dockerCalls = 0;
      await assert.rejects(module.runOfflineDockerBuilds({
        root: directory,
        imageLock: recoveryImageLock,
        walGLock: walGLock(trusted),
        runDocker() { dockerCalls += 1; },
      }), WAL_G_INPUT_ERROR, invalid);
      assert.equal(dockerCalls, 0, invalid);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("captures verified WAL-G bytes before effects and binds both recovery builds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proofline-027c-walg-capture-"));
  try {
    const trusted = Buffer.from("trusted-wal-g-fixture", "utf8");
    const context = await createWalGFixture(directory, trusted);
    const module = await optionalImport("scripts/docker-build-orchestration.mjs");
    const calls = [];
    let replaced = false;
    await module.runOfflineDockerBuilds({
      root: directory,
      imageLock: recoveryImageLock,
      walGLock: walGLock(trusted),
      runDocker(args) {
        calls.push(args);
        if (!replaced) {
          const replacement = join(directory, "replacement-wal-g");
          readFileSync(join(context, "receipt.v1.json"));
          requireWriteAndRename(replacement, join(context, "wal-g"), trusted.length);
          replaced = true;
        }
        const contextIndex = args.indexOf("--build-context");
        if (contextIndex !== -1) {
          const [name, contextPath] = args[contextIndex + 1].split("=");
          assert.equal(name, "wal_g_release");
          assert.deepEqual(readFileSync(join(contextPath, "wal-g")), trusted);
        }
      },
    });
    const recoveryCalls = calls.filter((args) => args.includes("docker/postgres-recovery.Dockerfile"));
    assert.equal(recoveryCalls.length, 2);
    for (const args of recoveryCalls) {
      assert.ok(args.includes(`PROOFLINE_WAL_G_BINARY_SHA256=${sha256(trusted)}`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function requireWriteAndRename(sourcePath, destinationPath, size) {
  const bytes = Buffer.alloc(size, 0x78);
  const descriptor = createTemporaryFile(sourcePath, bytes);
  descriptor.close();
  renameSync(sourcePath, destinationPath);
}

function createTemporaryFile(path, bytes) {
  const descriptor = openSync(path, "wx", 0o600);
  writeFileSync(descriptor, bytes);
  chmodSync(path, 0o555);
  return { close: () => closeSync(descriptor) };
}

test("independently downloads, hashes and canonically compares ciphertext inventory", async () => {
  const module = await optionalImport("scripts/recovery-inventory.mjs");
  const reader = storageReader(ciphertextObjects);
  const expected = inventoryFor(ciphertextObjects);
  const actual = await module.verifyCiphertextInventory({
    backupEvidenceBytes: canonicalEvidence(),
    listObjects: reader.listObjects,
    readObject: reader.readObject,
    maximumObjects: 100,
    maximumTotalBytes: 1_000_000,
  });
  assert.deepEqual(actual, expected);
  assert.equal(reader.calls.list, 1);
  assert.deepEqual(reader.calls.reads.sort(), expected.entries.map(({ key }) => key));
});

for (const mutation of ["corrupt", "add", "remove"]) {
  test(`fails closed for downloaded ciphertext inventory mutation: ${mutation}`, async () => {
    const objects = new Map([...ciphertextObjects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
    if (mutation === "corrupt") {
      const key = [...objects.keys()][0];
      objects.set(key, Buffer.alloc(objects.get(key).length, 0x78));
    } else if (mutation === "add") {
      objects.set("wal_005/00000001000000000000000C.lz4", Buffer.from("extra"));
    } else {
      objects.delete([...objects.keys()][0]);
    }
    const module = await optionalImport("scripts/recovery-inventory.mjs");
    const reader = storageReader(objects);
    await assert.rejects(module.verifyCiphertextInventory({
      backupEvidenceBytes: canonicalEvidence(),
      listObjects: reader.listObjects,
      readObject: reader.readObject,
      maximumObjects: 100,
      maximumTotalBytes: 1_000_000,
    }), expectCode(
      "RECOVERY_INVENTORY_MISMATCH",
      "Recovery ciphertext inventory does not match backup evidence",
    ));
    assert.equal(reader.calls.list, 1);
    assert.ok(reader.calls.reads.length > 0);
  });
}

test("does not source both PITR inventory operands from one configured value", async () => {
  const [gate, compose, inventory] = await Promise.all([
    source("scripts/docker-recovery-gate.mjs"),
    source("deploy/compose.recovery.qa.yaml"),
    source("scripts/recovery-inventory.mjs"),
  ]);
  assert.match(gate, /verifyCiphertextInventory/);
  assert.match(inventory, /listObjects/);
  assert.match(inventory, /readObject/);
  assert.match(inventory, /canonicalSha256/);
  assert.doesNotMatch(
    compose,
    /"?\$?\{?PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256[^\n]+\n[^\n]*"?\$?\{?PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256/,
  );
  assert.doesNotMatch(gate, /inventorySha256\s*:\s*expectedInventorySha256/);
});

const NEGATIVE_CASES = Object.freeze([
  ["missing-wal-object", "RECOVERY_MISSING_OBJECT"],
  ["corrupt-backup-object", "RECOVERY_CORRUPT_OBJECT"],
  ["wrong-encryption-key", "RECOVERY_ENCRYPTION_KEY_INVALID"],
  ["future-recovery-target", "RECOVERY_TARGET_UNAVAILABLE"],
  ["reused-restore-volume", "RECOVERY_VOLUME_REUSED"],
  ["nonempty-restore-volume", "RECOVERY_VOLUME_NOT_EMPTY"],
  ["promotion-authorization-absent", "RESTORE_PROMOTION_FORBIDDEN"],
  ["promotion-authorization-mismatch", "RESTORE_PROMOTION_EVIDENCE_MISMATCH"],
]);

test("derives every negative result from child execution and independent parent observation", async () => {
  const module = await optionalImport("scripts/docker-recovery-gate-runtime.mjs");
  const calls = [];
  const orchestration = module.createDockerRecoveryOrchestration({
    async prepareCase({ id, action }, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      calls.push([id, "prepare", action]);
      return {
        caseId: id,
        mutationApplied: true,
        mutationEvidenceSha256: `sha256:${"a".repeat(64)}`,
      };
    },
    async executeRecoveryCase(fixture) {
      calls.push([fixture.caseId, "execute"]);
      const failureCode = NEGATIVE_CASES.find(([id]) => id === fixture.caseId)[1];
      return {
        caseId: fixture.caseId,
        exitCode: 64,
        stdout: "",
        stderr: `${JSON.stringify({
          version: "1",
          caseId: fixture.caseId,
          status: "failed",
          failureCode,
        })}\n`,
      };
    },
    async inspectRecoveryCase(fixture, execution) {
      calls.push([fixture.caseId, "inspect", execution.exitCode]);
      return {
        caseId: fixture.caseId,
        observationSha256: `sha256:${"b".repeat(64)}`,
        mutationObserved: true,
        sinkObserved: true,
        passEvidenceCount: 0,
        promotionCount: 0,
      };
    },
    async cleanupCase(_id, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      return { containers: 0, networks: 0, volumes: 0, temporaryPaths: 0 };
    },
  });
  for (const [id, expectedFailureCode] of NEGATIVE_CASES) {
    const result = await orchestration.runCase({ id, expectedFailureCode }, new AbortController().signal);
    assert.equal(result.caseId, id);
    assert.equal(result.status, "failed");
    assert.equal(result.failureCode, expectedFailureCode);
    assert.equal(result.childExitCode, 64);
    assert.match(result.childOutputSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.parentObservationSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.parentMutationObserved, true);
    assert.equal(result.parentSinkObserved, true);
    assert.equal(result.parentPassEvidenceCount, 0);
    assert.equal(result.parentPromotionCount, 0);
  }
  for (const [id] of NEGATIVE_CASES) {
    assert.deepEqual(calls.filter(([caseId]) => caseId === id).map(([, phase]) => phase), [
      "prepare",
      "execute",
      "inspect",
    ]);
  }
});

test("rejects the old driver that returns a synthetic expected code", async () => {
  const module = await optionalImport("scripts/docker-recovery-gate-runtime.mjs");
  assert.throws(() => module.createDockerRecoveryOrchestration({
    async executeMutation({ id }) {
      return {
        status: "failed",
        failureCode: NEGATIVE_CASES.find(([caseId]) => caseId === id)[1],
        passEvidenceCount: 0,
        promotionCount: 0,
      };
    },
    async cleanupCase() {
      return { containers: 0, networks: 0, volumes: 0, temporaryPaths: 0 };
    },
  }), /recovery runtime|required/i);
});

test("production negative cases mutate and invoke the actual recovery paths", async () => {
  const [gate, runtime] = await Promise.all([
    source("scripts/docker-recovery-gate.mjs"),
    source("scripts/docker-recovery-gate-runtime.mjs"),
  ]);
  assert.match(runtime, /prepareCase/);
  assert.match(runtime, /executeRecoveryCase/);
  assert.match(runtime, /inspectRecoveryCase/);
  assert.match(runtime, /exitCode/);
  assert.match(runtime, /stdout/);
  assert.match(runtime, /stderr/);
  assert.doesNotMatch(runtime, /observation\?\.failureCode/);
  assert.doesNotMatch(runtime, /observationPath|childObservation/);
  for (const token of [
    "pitr-fetch",
    "pitr-postgres",
    "minio",
    "missing-wal-object",
    "corrupt-backup-object",
    "wrong-encryption-key",
    "future-recovery-target",
    "reused-restore-volume",
    "nonempty-restore-volume",
    "authorizeRestorePromotion",
  ]) assert.match(gate, new RegExp(token));
  assert.doesNotMatch(gate, /observedFailureCode\s*=/);
  assert.doesNotMatch(gate, /const\s+restoreVolume\s*=\s*sourceVolume/);
  assert.doesNotMatch(gate, /Date\.now\(\)\s*\+\s*60_?000/);
});

test("validates canonical retention evidence, hash, prefix and key before delete", async () => {
  const module = await optionalImport("scripts/backup-retention-authorization.mjs");
  const bytes = canonicalEvidence();
  const calls = [];
  const result = await module.runAuthorizedBackupRetention({
    backupEvidenceBytes: bytes,
    expectedBackupEvidenceSha256: sha256(bytes),
    expectedPrefix: backupEvidence().storage.prefix,
    encryptionKeyBytes: encryptionKey,
    runWalG(args) { calls.push(args); return { status: 0 }; },
  });
  assert.deepEqual(calls, [["delete", "retain", "FULL", "8", "--confirm"]]);
  assert.deepEqual(result, {
    backupId: backupEvidence().backup.id,
    evidenceSha256: sha256(bytes),
    prefix: backupEvidence().storage.prefix,
  });
});

test("retention rejects noncanonical, wrong-hash, wrong-prefix, wrong-key and invalid-key evidence before delete", async () => {
  const module = await optionalImport("scripts/backup-retention-authorization.mjs");
  const evidence = backupEvidence();
  const canonical = canonicalEvidence(evidence);
  const invalidKeyEvidence = {
    ...evidence,
    inventory: {
      ...evidence.inventory,
      entries: evidence.inventory.entries.map((entry, index) => index === 0
        ? { ...entry, key: "outside-prefix/object" }
        : entry),
    },
  };
  const cases = [
    { backupEvidenceBytes: Buffer.from(JSON.stringify(evidence, null, 2)), expectedBackupEvidenceSha256: sha256(canonical) },
    { backupEvidenceBytes: canonical, expectedBackupEvidenceSha256: `sha256:${"f".repeat(64)}` },
    { backupEvidenceBytes: canonical, expectedBackupEvidenceSha256: sha256(canonical), expectedPrefix: "s3://wrong/prefix" },
    { backupEvidenceBytes: canonical, expectedBackupEvidenceSha256: sha256(canonical), encryptionKeyBytes: Buffer.from("wrong-key") },
    {
      backupEvidenceBytes: canonicalEvidence(invalidKeyEvidence),
      expectedBackupEvidenceSha256: sha256(canonicalEvidence(invalidKeyEvidence)),
    },
  ];
  for (const invalid of cases) {
    let deletes = 0;
    await assert.rejects(module.runAuthorizedBackupRetention({
      backupEvidenceBytes: invalid.backupEvidenceBytes,
      expectedBackupEvidenceSha256: invalid.expectedBackupEvidenceSha256,
      expectedPrefix: invalid.expectedPrefix ?? evidence.storage.prefix,
      encryptionKeyBytes: invalid.encryptionKeyBytes ?? encryptionKey,
      runWalG() { deletes += 1; return { status: 0 }; },
    }), expectCode(
      "BACKUP_RETENTION_EVIDENCE_INVALID",
      "Backup retention evidence is invalid",
    ));
    assert.equal(deletes, 0);
  }
});

test("the destructive retention wrapper invokes strict authorization first", async () => {
  const [wrapper, authorization] = await Promise.all([
    source("docker/recovery/proofline-backup-retention.sh"),
    source("scripts/backup-retention-authorization.mjs"),
  ]);
  assert.match(wrapper, /backup-retention-authorization/);
  assert.match(wrapper, /PROOFLINE_BACKUP_EVIDENCE_SHA256/);
  assert.match(authorization, /BackupEvidenceV1Schema/);
  assert.match(authorization, /canonicalSerializeBackupEvidence/);
  assert.match(authorization, /encryptionKeyIdSha256/);
  assert.match(authorization, /WALG_S3_PREFIX|expectedPrefix/);
  assert.ok(wrapper.indexOf("backup-retention-authorization") < wrapper.indexOf("wal-g delete"));
});
