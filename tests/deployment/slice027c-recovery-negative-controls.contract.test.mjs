import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CASES = Object.freeze([
  { id: "missing-wal-object", expectedFailureCode: "RECOVERY_MISSING_OBJECT" },
  { id: "corrupt-backup-object", expectedFailureCode: "RECOVERY_CORRUPT_OBJECT" },
  { id: "wrong-encryption-key", expectedFailureCode: "RECOVERY_ENCRYPTION_KEY_INVALID" },
  { id: "future-recovery-target", expectedFailureCode: "RECOVERY_TARGET_UNAVAILABLE" },
  { id: "reused-restore-volume", expectedFailureCode: "RECOVERY_VOLUME_REUSED" },
  { id: "nonempty-restore-volume", expectedFailureCode: "RECOVERY_VOLUME_NOT_EMPTY" },
  { id: "promotion-authorization-absent", expectedFailureCode: "RESTORE_PROMOTION_FORBIDDEN" },
  { id: "promotion-authorization-mismatch", expectedFailureCode: "RESTORE_PROMOTION_EVIDENCE_MISMATCH" },
]);

const VERIFIED = Object.freeze({
  pgIsInRecovery: "t",
  pgIsWalReplayPaused: "t",
  systemIdentifier: "7532076200787175519",
  expectedSystemIdentifier: "7532076200787175519",
  schemaVersion: "10",
  migrationChecksumCount: "10",
  beforeCutCount: "1",
  afterCutCount: "0",
  inventorySha256: `sha256:${"a".repeat(64)}`,
  expectedInventorySha256: `sha256:${"a".repeat(64)}`,
});

const FAILED_RESULT = (definition) => ({
  caseId: definition.id,
  status: "failed",
  failureCode: definition.expectedFailureCode,
  childExitCode: 64,
  childOutputSha256: `sha256:${"c".repeat(64)}`,
  parentObservationSha256: `sha256:${"d".repeat(64)}`,
  parentMutationObserved: true,
  parentSinkObserved: true,
  parentPassEvidenceCount: 0,
  parentPromotionCount: 0,
});

const CLEAN = Object.freeze({
  containers: 0,
  networks: 0,
  volumes: 0,
  temporaryPaths: 0,
});

async function core() {
  const path = pathToFileURL(resolve(
    root,
    "scripts/docker-recovery-gate-core.mjs",
  )).href;
  return import(`${path}?contract=${Date.now()}`).catch(() => ({}));
}

function expectBypass(error) {
  return error?.code === "RECOVERY_NEGATIVE_CONTROL_BYPASSED" &&
    error?.message === "Recovery negative control failed closed";
}

function expectTimeout(error) {
  return error?.code === "RECOVERY_NEGATIVE_TIMEOUT" &&
    error?.message === "Recovery negative control timed out";
}

function passingOrchestration(overrides = {}) {
  return {
    async runCase(definition, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      return FAILED_RESULT(definition);
    },
    async cleanupCase(_id, signal) {
      assert.equal(signal instanceof AbortSignal, true);
      return CLEAN;
    },
    ...overrides,
  };
}

test("exports the exact bounded executable recovery-negative inventory", async () => {
  const module = await core();
  assert.deepEqual(module.RECOVERY_NEGATIVE_CASES, CASES);
  assert.equal(Object.isFrozen(module.RECOVERY_NEGATIVE_CASES), true);
  assert.equal(typeof module.runRecoveryNegativeControls, "function");
  assert.equal(typeof module.deriveRestoreChecksFromPitrVerify, "function");
});

test("derives every restore evidence boolean from actual pitr-verify fields", async () => {
  const module = await core();
  assert.deepEqual(module.deriveRestoreChecksFromPitrVerify(VERIFIED), {
    restore: { paused: true, inRecovery: true, promoted: false },
    checks: {
      systemIdentifierMatches: true,
      schemaVersion: 10,
      migrationChecksums: 10,
      beforeCutPresent: true,
      afterCutAbsent: true,
      inventorySha256Matches: true,
    },
  });
});

test("does not fabricate PASS when any pitr-verify field disagrees", async () => {
  const module = await core();
  for (const [field, value, expectedPath] of [
    ["pgIsInRecovery", "f", ["restore", "inRecovery"]],
    ["pgIsWalReplayPaused", "f", ["restore", "paused"]],
    ["systemIdentifier", "1", ["checks", "systemIdentifierMatches"]],
    ["schemaVersion", "9", ["checks", "schemaVersion"]],
    ["migrationChecksumCount", "9", ["checks", "migrationChecksums"]],
    ["beforeCutCount", "0", ["checks", "beforeCutPresent"]],
    ["afterCutCount", "1", ["checks", "afterCutAbsent"]],
    ["inventorySha256", `sha256:${"b".repeat(64)}`, ["checks", "inventorySha256Matches"]],
  ]) {
    const derived = module.deriveRestoreChecksFromPitrVerify({
      ...VERIFIED,
      [field]: value,
    });
    const observed = expectedPath.reduce((current, part) => current[part], derived);
    assert.notEqual(observed, expectedPath.at(-1) === "schemaVersion" ||
      expectedPath.at(-1) === "migrationChecksums" ? 10 : true, field);
  }
});

test("executes all negative controls in exact order with cleanup and no PASS effect", async () => {
  const module = await core();
  const executed = [];
  const cleaned = [];
  const result = await module.runRecoveryNegativeControls({
    orchestration: passingOrchestration({
      async runCase(definition, signal) {
        assert.equal(signal instanceof AbortSignal, true);
        executed.push(definition.id);
        return FAILED_RESULT(definition);
      },
      async cleanupCase(id, signal) {
        assert.equal(signal instanceof AbortSignal, true);
        cleaned.push(id);
        return CLEAN;
      },
    }),
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 100,
  });
  assert.deepEqual(executed, CASES.map(({ id }) => id));
  assert.deepEqual(cleaned, executed);
  assert.deepEqual(result, {
    version: "1",
    status: "passed",
    cases: CASES.map(({ id, expectedFailureCode }) => ({
      id,
      failureCode: expectedFailureCode,
      cleanupVerified: true,
    })),
  });
});

for (const bypassed of CASES) {
  test(`fails closed when ${bypassed.id} does not produce its fixed failure`, async () => {
    const module = await core();
    const cleaned = [];
    await assert.rejects(
      module.runRecoveryNegativeControls({
        orchestration: passingOrchestration({
          async runCase(definition) {
            return definition.id === bypassed.id
              ? { ...FAILED_RESULT(definition), status: "passed" }
              : FAILED_RESULT(definition);
          },
          async cleanupCase(id, signal) {
            assert.equal(signal instanceof AbortSignal, true);
            cleaned.push(id);
            return CLEAN;
          },
        }),
        caseTimeoutMs: 100,
        cleanupTimeoutMs: 100,
      }),
      expectBypass,
    );
    assert.equal(cleaned.includes(bypassed.id), true);
  });
}

test("rejects case-name strings as non-executable negative evidence", async () => {
  const module = await core();
  await assert.rejects(module.runRecoveryNegativeControls({
    orchestration: passingOrchestration({
      async runCase(definition) {
        return definition.id;
      },
    }),
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 100,
  }), expectBypass);
});

test("rejects the legacy synthetic four-field driver result", async () => {
  const module = await core();
  await assert.rejects(module.runRecoveryNegativeControls({
    orchestration: passingOrchestration({
      async runCase(definition) {
        return {
          status: "failed",
          failureCode: definition.expectedFailureCode,
          parentPassEvidenceCount: 0,
          parentPromotionCount: 0,
        };
      },
    }),
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 100,
  }), expectBypass);
});

test("rejects any negative path that writes PASS evidence or attempts promotion", async () => {
  const module = await core();
  for (const effect of [
    { parentPassEvidenceCount: 1 },
    { parentPromotionCount: 1 },
  ]) {
    await assert.rejects(module.runRecoveryNegativeControls({
      orchestration: passingOrchestration({
        async runCase(definition) {
          return { ...FAILED_RESULT(definition), ...effect };
        },
      }),
      caseTimeoutMs: 100,
      cleanupTimeoutMs: 100,
    }), expectBypass);
  }
});

test("requires zero exact scoped leftovers after every negative case", async () => {
  const module = await core();
  await assert.rejects(module.runRecoveryNegativeControls({
    orchestration: passingOrchestration({
      async cleanupCase(_id, signal) {
        assert.equal(signal instanceof AbortSignal, true);
        return { ...CLEAN, volumes: 1 };
      },
    }),
    caseTimeoutMs: 100,
    cleanupTimeoutMs: 100,
  }), (error) => error?.code === "RECOVERY_NEGATIVE_CLEANUP_FAILED" &&
    error?.message === "Recovery negative cleanup failed");
});

test("normalizes each negative timeout and still performs bounded cleanup", async () => {
  const module = await core();
  const cleaned = [];
  await assert.rejects(module.runRecoveryNegativeControls({
    orchestration: passingOrchestration({
      async runCase() {
        return new Promise(() => undefined);
      },
      async cleanupCase(id, signal) {
        assert.equal(signal instanceof AbortSignal, true);
        cleaned.push(id);
        return CLEAN;
      },
    }),
    caseTimeoutMs: 5,
    cleanupTimeoutMs: 100,
  }), expectTimeout);
  assert.deepEqual(cleaned, [CASES[0].id]);
});
