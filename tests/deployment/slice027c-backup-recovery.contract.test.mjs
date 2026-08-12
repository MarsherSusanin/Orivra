import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function source(path) {
  return readFile(resolve(root, path), "utf8").catch(() => "");
}

async function optionalImport(path) {
  return import(`${pathToFileURL(resolve(root, path)).href}?contract=${Date.now()}`)
    .catch(() => ({}));
}

function realSha256(value, label) {
  assert.match(value ?? "", /^sha256:[a-f0-9]{64}$/, `${label} must be lowercase SHA-256`);
  const body = value.slice(7);
  assert.notEqual(new Set(body).size, 1, `${label} must not be a repeated placeholder`);
}

test("accepts ADR 0037 and freezes Slice 027C C1/C2/C3 without a hosted claim", async () => {
  const [index, adr, slice, roadmap, readme] = await Promise.all([
    source("docs/adr/README.md"),
    source("docs/adr/0037-wal-archiving-and-pitr-recovery.md"),
    source("docs/slices/027c-wal-archiving-and-pitr-recovery.md"),
    source("docs/development/product-roadmap.md"),
    source("README.md"),
  ]);
  assert.match(index, /0037-wal-archiving-and-pitr-recovery/);
  assert.match(adr, /^Status: accepted$/m);
  for (const wave of ["027C1", "027C2", "027C3"]) assert.match(slice, new RegExp(wave));
  assert.match(
    roadmap,
    /\| 027C \| WAL\/base-backup PITR and local MinIO restore drill \| Complete; Core and Product PASS `8137970` \/ `8c594cc`; scan 8852 user-canceled\/not a security PASS; deferred evidence-integrity validation risk remains open \|/,
  );
  const roadmap027c = roadmap.match(/- \*\*027C\*\*[\s\S]*?(?=\n- \*\*028A)/)?.[0] ?? "";
  assert.match(roadmap027c, /exact candidate\s+`1218e589` \/ tree `f0d6e325` is rejected/i);
  assert.match(roadmap027c, /corrective RED freezes/i);
  assert.match(roadmap027c, /stash\s+candidate `ccccf5d2` is rejected by scan `ae807f50`/i);
  assert.match(roadmap027c, /not hosted, live Spaces\/production/i);
  assert.match(readme, /527c561[\s\S]{0,80}ebdf648/);
  assert.doesNotMatch(`${adr}\n${slice}`, /hosting is deployed|hosted PASS|production PITR PASS/i);
});

test("locks the official WAL-G v3.0.8 asset and two real SHA-256 identities", async () => {
  const raw = await source("docker/wal-g-release.v1.json");
  assert.notEqual(raw, "", "WAL-G release lock must exist");
  const lock = JSON.parse(raw);
  assert.deepEqual(Object.keys(lock).sort(), [
    "assetSha256",
    "assetUrl",
    "binarySha256",
    "maximumBytes",
    "platform",
    "version",
    "walGVersion",
  ]);
  assert.equal(lock.version, "1");
  assert.equal(lock.walGVersion, "v3.0.8");
  assert.equal(lock.platform, "linux/amd64");
  assert.equal(
    lock.assetUrl,
    "https://github.com/wal-g/wal-g/releases/download/v3.0.8/wal-g-pg-22.04-amd64.tar.gz",
  );
  assert.equal(lock.maximumBytes, 17_891_961);
  assert.equal(
    lock.assetSha256,
    "sha256:b0df1b484035eb5f131db7bbd303d1a460391848fdcce34ba1e0a564cca493e9",
  );
  assert.equal(
    lock.binarySha256,
    "sha256:f30544c5ce93cf83b87578e3c4a2e9c0e0ffc3d160ef89ecddaf75f397d98deb",
  );
  realSha256(lock.assetSha256, "WAL-G archive");
  realSha256(lock.binarySha256, "WAL-G binary");
  assert.notEqual(lock.assetSha256, lock.binarySha256);
});

test("locks official PostgreSQL Debian, MinIO server and MinIO client Linux/amd64 manifests", async () => {
  const lock = JSON.parse(await source("docker/base-images.json"));
  for (const [name, repository] of [
    ["postgresRecovery", "postgres"],
    ["minio", "minio/minio"],
    ["minioClient", "minio/mc"],
  ]) {
    const image = lock.images?.[name];
    assert.equal(image?.repository, repository, `${name} official repository`);
    assert.ok(typeof image?.tag === "string" && image.tag !== "latest");
    realSha256(image?.indexDigest, `${name} index`);
    realSha256(image?.linuxAmd64Digest, `${name} linux/amd64`);
  }
  assert.match(lock.images.postgresRecovery.tag, /^17\.6-bookworm(?:$|-)/);
});

test("builds the recovery PostgreSQL image offline from official Debian and a named WAL-G context", async () => {
  const dockerfile = await source("docker/postgres-recovery.Dockerfile");
  assert.notEqual(dockerfile, "", "recovery PostgreSQL Dockerfile must exist");
  assert.match(dockerfile, /^FROM --platform=linux\/amd64 postgres@sha256:[a-f0-9]{64}\b/m);
  assert.match(dockerfile, /(?:FROM|COPY)\s+[^\n]*wal_g_release/i);
  assert.match(dockerfile, /\/usr\/local\/bin\/wal-g/);
  assert.match(dockerfile, /proofline-(?:archive|backup|restore)/i);
  assert.doesNotMatch(dockerfile, /curl|wget|apk\s+add|apt(?:-get)?\s+(?:install|update)|github\.com|latest/i);
  const userDirectives = dockerfile.match(/^USER\s+[^\n]+$/gmi) ?? [];
  assert.match(userDirectives.at(-1) ?? "", /^USER\s+(?:postgres|[1-9][0-9]*(?::[1-9][0-9]*)?)$/i);
});

test("extends credential-isolated prefetch and both offline build passes with the named context", async () => {
  const [prefetch, orchestration, build] = await Promise.all([
    source("scripts/docker-prefetch.mjs"),
    source("scripts/docker-prefetch-orchestration.mjs"),
    source("scripts/docker-build.mjs"),
  ]);
  const combined = `${prefetch}\n${orchestration}`;
  assert.match(combined, /wal-g-release\.v1\.json/);
  assert.match(combined, /wal-g-pg-22\.04-amd64\.tar\.gz/);
  assert.match(combined, /assetSha256[\s\S]*binarySha256/);
  assert.match(combined, /maximumBytes|content-length/i);
  assert.match(combined, /wal_g_release/);
  assert.match(combined, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  assert.match(combined, /GITHUB_TOKEN|GH_TOKEN/);
  assert.match(build, /postgres-recovery\.Dockerfile/);
  assert.match(build, /--build-context["',\s]+wal_g_release=/);
  assert.match(build, /--pull=false/);
  assert.match(build, /--network["',\s]+none/);
  assert.match(build, /for\s*\([^)]*(?:1|repetition)[\s\S]*(?:2|repetition)/);
});

test("retains exact historical Spaces recovery data without making it active production authority", async () => {
  const [module, adr0037, adr0044] = await Promise.all([
    optionalImport("scripts/backup-configuration.mjs"),
    source("docs/adr/0037-wal-archiving-and-pitr-recovery.md"),
    source("docs/adr/0044-timeweb-direct-production-pilot.md"),
  ]);
  assert.equal(typeof module.parseProductionBackupConfiguration, "function");
  assert.equal(typeof module.parseRestorePlan, "function");
  const historicalSpacesConfiguration = Object.freeze({
    PROOFLINE_BACKUP_SLOT: "production",
    PROOFLINE_BACKUP_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
    PROOFLINE_BACKUP_REGION: "nyc3",
    PROOFLINE_BACKUP_BUCKET: "proofline-production-backups",
  });
  assert.deepEqual(historicalSpacesConfiguration, {
    PROOFLINE_BACKUP_SLOT: "production",
    PROOFLINE_BACKUP_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
    PROOFLINE_BACKUP_REGION: "nyc3",
    PROOFLINE_BACKUP_BUCKET: "proofline-production-backups",
  });
  assert.match(adr0037, /DigitalOcean Spaces endpoint/);
  assert.match(adr0037, /https:\/\/<region>\.digitaloceanspaces\.com/);
  assert.match(adr0044, /DigitalOcean-Spaces `BackupEvidenceV1` remains historical/);
  assert.match(adr0044, /endpoint `https:\/\/s3\.twcstorage\.ru`, region `ru-1`/);
  assert.throws(
    () => module.parseProductionBackupConfiguration({
      ...historicalSpacesConfiguration,
      AWS_SECRET_ACCESS_KEY: "ambient-secret",
    }),
    (error) => error?.code === "BACKUP_CONFIGURATION_INVALID" &&
      error?.message === "Backup configuration is invalid" &&
      !JSON.stringify(error).includes("ambient-secret"),
  );

  const restore = {
    PROOFLINE_RESTORE_BACKUP_ID: "base_0123456789ABCDEF01234567",
    PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    PROOFLINE_RECOVERY_TARGET_TIME: "2026-08-12T00:00:00.000000Z",
    PROOFLINE_RECOVERY_TARGET_TIMELINE: "1",
  };
  assert.deepEqual(module.parseRestorePlan(restore), {
    backupId: restore.PROOFLINE_RESTORE_BACKUP_ID,
    backupEvidenceSha256: restore.PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256,
    targetTime: restore.PROOFLINE_RECOVERY_TARGET_TIME,
    timeline: 1,
  });
});

test("adds exact file-only backup secrets without exposing values or arbitrary files", async () => {
  const [compose, configuration] = await Promise.all([
    source("deploy/compose.backup.yaml"),
    source("scripts/backup-configuration.mjs"),
  ]);
  for (const name of [
    "PROOFLINE_BACKUP_DATABASE_URL_FILE",
    "PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE",
    "PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE",
    "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
    "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
    "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE",
    "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE",
    "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
  ]) assert.match(`${compose}\n${configuration}`, new RegExp(name));
  assert.match(configuration, /O_NOFOLLOW/);
  assert.match(configuration, /O_NONBLOCK/);
  assert.doesNotMatch(compose, /(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|LIBSODIUM_KEY):\s*\$\{PROOFLINE_/);
  assert.doesNotMatch(compose, /env_file|docker\.sock|privileged:\s*true|network_mode:\s*host/i);
});

test("renders exact production backup services, archive settings and private topology", async () => {
  const compose = await source("deploy/compose.backup.yaml");
  assert.notEqual(compose, "", "backup Compose overlay must exist");
  for (const service of ["postgres", "base-backup", "backup-status", "backup-retention"]) {
    assert.match(compose, new RegExp(`^  ${service}:`, "m"));
  }
  assert.match(compose, /archive_mode=on/);
  assert.match(compose, /archive_timeout=60s/);
  assert.match(compose, /WALG_PREVENT_WAL_OVERWRITE[^\n]*(?:true|"true")/i);
  assert.match(compose, /backup_egress/);
  assert.match(compose, /postgres_data:[\s\S]{0,180}(?:read_only:\s*true|:ro)/i);
  assert.match(compose, /pull_policy:\s*never/);
  assert.doesNotMatch(compose, /published:|ports:|docker\.sock|privileged:/i);
});

test("keeps production wrapper fixed and makes backup inseparable from runtime", async () => {
  const wrapper = await source("scripts/compose-production.mjs");
  assert.match(wrapper, /deploy\/compose\.backup\.yaml/);
  assert.match(wrapper, /validateProductionImageReference\(environment\.PROOFLINE_POSTGRES_IMAGE\)/);
  assert.match(wrapper, /BACKUP_DATABASE_URL_FILE/);
  assert.match(wrapper, /WRITER_ACCESS_KEY_ID_FILE/);
  assert.match(wrapper, /BACKUP_ENCRYPTION_KEY_FILE/);
  assert.match(wrapper, /Production Compose files are fixed by policy/);
  assert.match(wrapper, /start|restart/);
});

test("freezes advisory-lock backup, exact prefix, encrypted WAL and eight-full retention seams", async () => {
  const aggregate = (await Promise.all([
    source("docker/recovery/proofline-archive-command.sh"),
    source("docker/recovery/proofline-base-backup.sh"),
    source("docker/recovery/proofline-backup-status.sh"),
    source("docker/recovery/proofline-backup-retention.sh"),
  ])).join("\n");
  assert.match(aggregate, /-4708329426407388776/);
  assert.match(aggregate, /BACKUP_ALREADY_RUNNING/);
  assert.match(aggregate, /pg_controldata|system_identifier/i);
  assert.match(aggregate, /proofline\/v1\//);
  assert.match(aggregate, /WALG_PREVENT_WAL_OVERWRITE/);
  assert.match(aggregate, /WALG_LIBSODIUM_KEY|libsodium/i);
  assert.match(aggregate, /wal-g["'\s]+wal-push/);
  assert.match(aggregate, /wal-g["'\s]+backup-push/);
  assert.match(aggregate, /delete["'\s]+retain["'\s]+FULL["'\s]+8["'\s]+--confirm/i);
  assert.doesNotMatch(aggregate, /echo[^\n]*(?:KEY|PASSWORD|DATABASE_URL)|set\s+-x/i);
});

test("adds a dedicated executable recovery gate without weakening existing Docker commands", async () => {
  const [packageJson, gate] = await Promise.all([
    source("package.json").then(JSON.parse),
    source("scripts/docker-recovery-gate.mjs"),
  ]);
  assert.equal(packageJson.scripts?.["test:docker"], "node scripts/docker-gate.mjs");
  assert.equal(packageJson.scripts?.["test:docker:runtime"], "node scripts/docker-runtime-smoke.mjs");
  assert.equal(packageJson.scripts?.["test:docker:recovery"], "node scripts/docker-recovery-gate.mjs");
  assert.notEqual(gate, "", "recovery Docker gate must exist");
  assert.match(gate, /proofline-027c-[a-z0-9-]+/i);
  assert.match(gate, /--pull["',\s]+never/);
  assert.match(gate, /--network["',\s]+none/);
  assert.match(gate, /15\s*\*\s*60|900_?000/);
  assert.match(gate, /down["',\s]+--volumes["',\s]+--remove-orphans/);
});

test("freezes private MinIO identities and exact new-volume paused PITR without LATEST", async () => {
  const [compose, gate] = await Promise.all([
    source("deploy/compose.recovery.qa.yaml"),
    source("scripts/docker-recovery-gate.mjs"),
  ]);
  for (const service of ["minio", "minio-init", "pitr-fetch", "pitr-postgres", "pitr-verify"]) {
    assert.match(compose, new RegExp(`^  ${service}:`, "m"));
  }
  assert.doesNotMatch(compose, /ports:|published:|0\.0\.0\.0/);
  assert.match(compose, /writer[\s\S]*reader[\s\S]*(?:retention|deleter)/i);
  assert.match(`${compose}\n${gate}`, /recovery_target_inclusive[\s=:'"]+(?:on|true)/i);
  assert.match(`${compose}\n${gate}`, /recovery_target_action[\s=:'"]+pause/i);
  assert.match(`${compose}\n${gate}`, /recovery_target_timeline/i);
  assert.match(gate, /pg_is_in_recovery/);
  assert.match(gate, /beforeCutPresent|before[_-]cut/i);
  assert.match(gate, /afterCutAbsent|after[_-]cut/i);
  assert.match(gate, /sourceVolumeIdentitySha256/);
  assert.match(gate, /restoreVolumeIdentitySha256/);
  assert.doesNotMatch(`${compose}\n${gate}`, /\bLATEST\b/);
  assert.doesNotMatch(compose, /^  worker:|PROOFLINE_COSTON2_PRIVATE_KEY/m);
  assert.match(gate, /worker[\s_-]*(?:absent|not[\s_-]*started)/i);
});

test("fails closed for corrupt recovery inputs and promotion without exact authorization", async () => {
  const [gate, core, runtime, promotion] = await Promise.all([
    source("scripts/docker-recovery-gate.mjs"),
    source("scripts/docker-recovery-gate-core.mjs"),
    source("scripts/docker-recovery-gate-runtime.mjs"),
    source("scripts/restore-promotion.mjs"),
  ]);
  assert.match(gate, /runRecoveryNegativeControls/);
  assert.match(gate, /createDockerRecoveryOrchestration/);
  assert.doesNotMatch(gate, /void\s+negativeCases/);
  assert.doesNotMatch(
    gate,
    /(?:beforeCutPresent|afterCutAbsent)\s*=\s*true/,
  );
  assert.match(core, /deriveRestoreChecksFromPitrVerify/);
  assert.match(core, /RECOVERY_NEGATIVE_CONTROL_BYPASSED/);
  assert.match(runtime, /createDockerRecoveryOrchestration/);
  for (const name of [
    "missing-wal-object",
    "corrupt-backup-object",
    "wrong-encryption-key",
    "future-recovery-target",
    "reused-restore-volume",
    "nonempty-restore-volume",
    "promotion-authorization-absent",
    "promotion-authorization-mismatch",
  ]) assert.match(runtime, new RegExp(name));
  assert.match(runtime, /pitr-verify|PitrVerify/i);
  assert.match(runtime, /passEvidenceCount/);
  assert.match(runtime, /promotionCount/);
  assert.match(promotion, /RestorePromotionAuthorizationV2Schema/);
  assert.match(promotion, /RecoveryEvidenceHandoffV1Schema/);
  assert.match(promotion, /recoveryEvidenceHandoffSha256/);
  assert.match(promotion, /restoreDrillEvidenceSha256/);
  assert.match(promotion, /pg_promote/);
  assert.match(promotion, /RESTORE_PROMOTION_FORBIDDEN/);
  assert.ok(promotion.indexOf("RecoveryEvidenceHandoffV1Schema") < promotion.indexOf("pg_promote"));
});

test("uses exact WAL-G detail metadata and never substitutes process clocks or post-cut WAL", async () => {
  const [status, gate, selected, handoff] = await Promise.all([
    source("docker/recovery/proofline-backup-status.sh"),
    source("scripts/docker-recovery-gate.mjs"),
    source("scripts/recovery-selected-backup-metadata.mjs"),
    source("scripts/recovery-evidence-handoff.mjs"),
  ]);
  assert.match(status, /backup-list\s+--detail\s+--json/);
  assert.match(gate, /captureRecoveryProducerSnapshot/);
  assert.match(gate, /snapshot\.sourceRoot/);
  assert.match(gate, /runRecoveryEvidencePublication/);
  assert.match(gate, /selectRecoveryBackupMetadata/);
  assert.match(selected, /backup_name/);
  assert.match(selected, /start_time/);
  assert.match(selected, /finish_time/);
  assert.match(selected, /start_lsn/);
  assert.match(selected, /finish_lsn/);
  assert.match(selected, /wal_file_name/);
  assert.match(selected, /expectedSystemIdentifier/);
  assert.match(handoff, /RecoveryEvidenceHandoffV1Schema/);
  assert.match(handoff, /canonicalSerializeRecoveryEvidenceHandoff/);
  assert.match(handoff, /checksumRecoveryEvidenceHandoff/);
  assert.doesNotMatch(gate, /Date\.now\(\)\s*-\s*1_?000/);
  assert.doesNotMatch(gate, /stopWalSegment:\s*afterWal/);
});

test("keeps application readiness and the accepted 027B runtime as GREEN controls", async () => {
  const [app, runtime, caddy] = await Promise.all([
    source("apps/api/src/app.ts"),
    source("deploy/compose.runtime.yaml"),
    source("compose.yaml"),
  ]);
  assert.match(app, /url\.pathname !== "\/healthz" && url\.pathname !== "\/readyz"/);
  assert.match(runtime, /worker:/);
  assert.match(runtime, /postgres:[\s\S]*expose:[\s\S]*"5432"/);
  assert.doesNotMatch(runtime, /published:\s*5432|docker\.sock/);
  assert.match(caddy, /published:\s*80/);
  assert.match(caddy, /published:\s*443/);
});
