import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES } from "@proofline/contracts";
import { replayCanonicalUrlAttackRecording } from "@proofline/domain";
import { createProductionCanonicalUrlAttackRuntime } from "@proofline/fdc-coston2";

const IMPORT_LOCK_IDENTITY =
  "proofline:canonical-url-attack-recording-import:v1";
const RUNTIME_AUTHORITY = "fdc-coston2-runtime-v1";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface QueryResult {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
}

interface RecordingImportClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface RecordingImportPool {
  connect(): Promise<RecordingImportClient>;
}

export interface CanonicalUrlAttackRecordingImportInput {
  recordingPath: string;
  pool: RecordingImportPool;
  repositoryRoot: URL;
}

export interface CanonicalUrlAttackRecordingImportResult {
  status: "imported";
  recordingSha256: string;
  recordingChecksum: string;
}

function sha256Envelope(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestBytes(envelope: string): Buffer {
  return Buffer.from(envelope.slice("sha256:".length), "hex");
}

async function readCanonicalRecording(path: string): Promise<{
  bytes: Buffer;
  serialized: string;
}> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES
    ) {
      throw new Error("Canonical URL attack recording has invalid size");
    }
    const bytes = await handle.readFile();
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > CANONICAL_URL_ATTACK_RECORDING_MAX_UTF8_BYTES
    ) {
      throw new Error("Canonical URL attack recording has invalid size");
    }
    const serialized = utf8Decoder.decode(bytes);
    if (!Buffer.from(serialized, "utf8").equals(bytes)) {
      throw new Error("Canonical URL attack recording is not exact UTF-8");
    }
    replayCanonicalUrlAttackRecording(serialized);
    return { bytes, serialized };
  } finally {
    await handle.close();
  }
}

function exactBuffer(value: unknown, expected: Buffer): boolean {
  return value instanceof Uint8Array && Buffer.from(value).equals(expected);
}

function exactTimestamp(value: unknown, expected: string): boolean {
  if (!(value instanceof Date) && typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === expected;
}

function rowMatches(input: {
  row: Record<string, unknown>;
  recordingSha256: Buffer;
  recordingChecksum: Buffer;
  canonicalBytes: Buffer;
  canonicalUtf8Bytes: number;
  recordedAt: string;
  releaseCommitSha: string;
  releaseTreeSha: string;
  attackRunId: string;
  controlRunId: string;
}): boolean {
  const row = input.row;
  return (
    exactBuffer(row.recording_sha256, input.recordingSha256) &&
    exactBuffer(row.recording_checksum, input.recordingChecksum) &&
    exactBuffer(row.authority_recording_checksum, input.recordingChecksum) &&
    exactBuffer(row.canonical_bytes, input.canonicalBytes) &&
    Number(row.canonical_utf8_bytes) === input.canonicalUtf8Bytes &&
    exactTimestamp(row.recorded_at, input.recordedAt) &&
    row.release_commit_sha === input.releaseCommitSha &&
    row.release_tree_sha === input.releaseTreeSha &&
    row.attack_run_id === input.attackRunId &&
    row.control_run_id === input.controlRunId &&
    row.runtime_authority === RUNTIME_AUTHORITY
  );
}

export async function importCanonicalUrlAttackRecording(
  input: CanonicalUrlAttackRecordingImportInput,
): Promise<CanonicalUrlAttackRecordingImportResult> {
  const { bytes, serialized } = await readCanonicalRecording(
    input.recordingPath,
  );
  const recording = replayCanonicalUrlAttackRecording(serialized);
  const recordingSha256 = sha256Envelope(bytes);
  const repositoryRoot = fileURLToPath(input.repositoryRoot);
  const runtime = createProductionCanonicalUrlAttackRuntime({
    readCheckedInSource: (path) =>
      readFile(join(repositoryRoot, path), "utf8"),
    now: () => recording.recordedAt,
  });
  const authority = await runtime.verifyCanonicalUrlAttackRecording(serialized);
  if (
    authority.status !== "runtime-verified" ||
    authority.recordingChecksum !== recording.checksum
  ) {
    throw new Error("Canonical URL attack recording runtime authority mismatch");
  }

  const recordingSha256Bytes = digestBytes(recordingSha256);
  const recordingChecksumBytes = digestBytes(recording.checksum);
  const runtimeVerifiedAt = new Date().toISOString();
  const client = await input.pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('${IMPORT_LOCK_IDENTITY}', 0))`,
    );
    await client.query(
      `INSERT INTO proofline_private.canonical_url_attack_recordings
        (recording_sha256, recording_checksum, authority_recording_checksum,
         canonical_bytes, canonical_utf8_bytes, recorded_at,
         release_commit_sha, release_tree_sha, attack_run_id, control_run_id,
         runtime_authority, runtime_verified_at)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        recordingSha256Bytes,
        recordingChecksumBytes,
        bytes,
        bytes.byteLength,
        recording.recordedAt,
        recording.release.commitSha,
        recording.release.treeSha,
        recording.bundles.attack.runId,
        recording.bundles.control.runId,
        RUNTIME_AUTHORITY,
        runtimeVerifiedAt,
      ],
    );
    const reread = await client.query(
      `SELECT recording_sha256, recording_checksum,
              authority_recording_checksum, canonical_bytes,
              canonical_utf8_bytes, recorded_at, release_commit_sha,
              release_tree_sha, attack_run_id, control_run_id,
              runtime_authority
       FROM proofline_private.canonical_url_attack_recordings
       WHERE recording_sha256 = $1 OR recording_checksum = $2
       FOR SHARE`,
      [recordingSha256Bytes, recordingChecksumBytes],
    );
    if (
      reread.rowCount !== 1 ||
      !reread.rows[0] ||
      !rowMatches({
        row: reread.rows[0],
        recordingSha256: recordingSha256Bytes,
        recordingChecksum: recordingChecksumBytes,
        canonicalBytes: bytes,
        canonicalUtf8Bytes: bytes.byteLength,
        recordedAt: recording.recordedAt,
        releaseCommitSha: recording.release.commitSha,
        releaseTreeSha: recording.release.treeSha,
        attackRunId: recording.bundles.attack.runId,
        controlRunId: recording.bundles.control.runId,
      })
    ) {
      throw new Error(
        "Canonical URL attack recording identity conflict: bytes or metadata differ",
      );
    }
    await client.query("COMMIT");
    committed = true;
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    client.release();
  }

  return {
    status: "imported",
    recordingSha256,
    recordingChecksum: recording.checksum,
  };
}
