import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import {
  PublicationEvidenceV1Schema,
  canonicalSerializePublicationEvidence,
} from "../packages/contracts/src/publication-runtime.mjs";
import {
  canonicalSerializeBackupEvidence,
  parseCanonicalBackupEvidence,
  sha256,
} from "./backup-evidence-validation.mjs";
import { collectCiphertextInventory } from "./recovery-inventory.mjs";
import { selectRecoveryBackupMetadata } from "./recovery-selected-backup-metadata.mjs";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";

const ROOT = "/opt/orivra/current";
const EVIDENCE_ROOT = "/opt/orivra/evidence/recovery/backups";
const PUBLICATION_EVIDENCE = "/opt/orivra/evidence/publication-evidence.v1.json";
const PUBLICATION_EVIDENCE_SHA256 = "/opt/orivra/evidence/publication-evidence.v1.sha256";
const FILES = ["compose.yaml", "deploy/compose.runtime.yaml", "deploy/compose.backup.yaml"];

function run(file, args, maximum = 4 * 1024 * 1024, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: ROOT, env: { ...environment, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const chunks = []; let size = 0;
    const collect = (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); else chunks.push(chunk); };
    child.stdout.on("data", collect); child.stderr.on("data", (chunk) => { size += chunk.length; if (size > maximum) child.kill("SIGKILL"); });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 && !signal && size <= maximum ? resolve(Buffer.concat(chunks)) : reject(new Error("command")));
  });
}

function compose(args, environment = process.env) {
  const command = ["compose"];
  for (const entry of FILES) command.push("--file", `${ROOT}/${entry}`);
  command.push("--project-name", "proofline-production-primary", ...args);
  return run("/usr/bin/docker", command, 4 * 1024 * 1024,
    bindFixedReplayBootstrapComposeInterpolationEnvironment(environment));
}

async function privateBytes(path, maximum = 4096) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > maximum) throw new Error("secret");
    const bytes = Buffer.alloc(stat.size);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== bytes.length) throw new Error("secret");
    return bytes;
  } finally { await handle?.close().catch(() => undefined); }
}

const hex = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const awsDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");
const query = (entries) => entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");

async function s3({ method, key = "", queryEntries = [], accessKey, secretKey }) {
  const now = new Date(); const amz = awsDate(now); const day = amz.slice(0, 8);
  const host = "s3.twcstorage.ru";
  const path = `/orivra-backet${key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : ""}`;
  const queryText = query(queryEntries); const payloadHash = hex(Buffer.alloc(0));
  const headers = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const scope = `${day}/ru-1/s3/aws4_request`;
  const request = `${method}\n${path}\n${queryText}\n${headers}\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
  const string = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(request)}`;
  const signature = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), "ru-1"), "s3"), "aws4_request")).update(string).digest("hex");
  const response = await fetch(`https://${host}${path}${queryText ? `?${queryText}` : ""}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`, "x-amz-content-sha256": payloadHash, "x-amz-date": amz },
  });
  if (!response.ok) throw new Error("s3");
  return response;
}

const xml = (text, name) => [...text.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "g"))].map((entry) => entry[1]);

async function inventoryReader(systemIdentifier, accessKey, secretKey) {
  const prefix = `proofline/v1/production/${systemIdentifier}/`;
  const objects = [];
  let continuation;
  do {
    const entries = [["encoding-type", "url"], ["list-type", "2"], ["prefix", prefix]];
    if (continuation) entries.push(["continuation-token", continuation]);
    const text = await (await s3({ method: "GET", queryEntries: entries, accessKey, secretKey })).text();
    const keys = xml(text, "Key").map(decodeURIComponent);
    const sizes = xml(text, "Size").map(Number);
    if (keys.length !== sizes.length) throw new Error("inventory");
    keys.forEach((key, index) => objects.push({ key: key.slice(prefix.length), size: sizes[index] }));
    continuation = xml(text, "NextContinuationToken")[0];
  } while (continuation);
  return {
    listObjects: async () => objects,
    readObject: async (key) => Buffer.from(await (await s3({ method: "GET", key: `${prefix}${key}`, accessKey, secretKey })).arrayBuffer()),
  };
}

export async function createCanonicalTimewebBackupEvidence({ backupId, archive, environment = process.env }) {
  const accessBytes = await privateBytes(environment.PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE);
  const secretBytes = await privateBytes(environment.PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE);
  const encryptionBytes = await privateBytes(environment.PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE);
  try {
    const [detailBytes, systemBytes, publicationBytes, publicationSha256Bytes, migrationBytes] = await Promise.all([
      compose(["run", "--rm", "--no-deps", "backup-status"], environment),
      compose(["exec", "-T", "postgres", "psql", "-U", "proofline", "-d", "proofline", "-Atc", "SELECT system_identifier FROM pg_control_system()"], environment),
      privateBytes(PUBLICATION_EVIDENCE, 1024 * 1024),
      privateBytes(PUBLICATION_EVIDENCE_SHA256, 128),
      readFile(`${ROOT}/apps/api/db/migrations/manifest.v1.json`),
    ]);
    const publicationText = new TextDecoder("utf-8", { fatal: true }).decode(publicationBytes);
    const publication = PublicationEvidenceV1Schema.parse(JSON.parse(publicationText));
    if (publicationText !== canonicalSerializePublicationEvidence(publication) ||
      publicationSha256Bytes.toString("utf8").trim() !== sha256(publicationBytes)) {
      throw new Error("publication binding");
    }
    const systemIdentifier = systemBytes.toString("utf8").trim();
    const metadata = selectRecoveryBackupMetadata({ backupListDetailBytes: detailBytes, selectedBackupId: backupId, expectedSystemIdentifier: systemIdentifier, postgresMajor: 17, walSegmentBytes: 16 * 1024 * 1024 });
    if (archive.switchedWalSegment < metadata.stopWalSegment) throw new Error("archive binding");
    const reader = await inventoryReader(systemIdentifier, accessBytes.toString("utf8").trim(), secretBytes.toString("utf8").trim());
    const inventory = await collectCiphertextInventory({ ...reader, maximumObjects: 100_000, maximumTotalBytes: 512 * 1024 * 1024 });
    const image = environment.PROOFLINE_POSTGRES_IMAGE ?? "";
    const imageDigest = image.slice(image.lastIndexOf("@") + 1);
    const evidence = {
      version: "1", kind: "base-backup",
      producer: { commitSha: publication.producer.commitSha, treeSha: publication.producer.treeSha, postgresImageDigest: imageDigest, walGVersion: "v3.0.8" },
      database: { slot: "production", systemIdentifier, postgresMajor: 17, schemaVersion: 10, migrationCount: 10, migrationManifestSha256: sha256(migrationBytes) },
      storage: { provider: "timeweb-s3", endpointOrigin: "https://s3.twcstorage.ru", region: "ru-1", bucket: "orivra-backet", addressing: "path-style", authorityMode: "shared-pilot", prefix: `s3://orivra-backet/proofline/v1/production/${systemIdentifier}`, encryption: "wal-g-libsodium", encryptionKeyIdSha256: sha256(encryptionBytes) },
      backup: { id: metadata.id, startedAt: metadata.startedAt, completedAt: metadata.completedAt, startLsn: metadata.startLsn, stopLsn: metadata.stopLsn, startWalSegment: metadata.startWalSegment, stopWalSegment: metadata.stopWalSegment, timeline: metadata.timeline },
      inventory, status: "completed",
    };
    const bytes = Buffer.from(canonicalSerializeBackupEvidence(evidence), "utf8");
    parseCanonicalBackupEvidence(bytes);
    await mkdir(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
    const evidenceRootStatus = await lstat(EVIDENCE_ROOT);
    if (!evidenceRootStatus.isDirectory() || evidenceRootStatus.isSymbolicLink()) throw new Error("evidence root");
    await chmod(EVIDENCE_ROOT, 0o700);
    const path = `${EVIDENCE_ROOT}/${backupId}.json`;
    const stage = `${path}.stage-${process.pid}`;
    let createdStage = false;
    try {
      const handle = await open(stage, "wx", 0o600);
      createdStage = true;
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await chmod(stage, 0o400);
      await link(stage, path);
      return { bytes, sha256: sha256(bytes), backupId, path };
    } finally {
      if (createdStage) await rm(stage, { force: true });
    }
  } finally {
    accessBytes.fill(0); secretBytes.fill(0); encryptionBytes.fill(0);
  }
}
