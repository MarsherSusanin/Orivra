// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolateRecordingImporterEnvironment } from "../src/recording-importer-environment";
import {
  RECORDING_BYTES,
  RECORDING_SHA256,
} from "../../../packages/contracts/test/slice024b-canonical-url-attack-demo.fixtures";
import { makeCanonicalUrlAttackRecording } from "../../../packages/contracts/test/slice024a-canonical-url-attack.fixtures";

const { verifyRuntime, createRuntime } = vi.hoisted(() => {
  const verifyRuntime = vi.fn();
  return {
    verifyRuntime,
    createRuntime: vi.fn(() => ({
      verifyCanonicalUrlAttackRecording: verifyRuntime,
    })),
  };
});

vi.mock("@proofline/fdc-coston2", () => ({
  createProductionCanonicalUrlAttackRuntime: createRuntime,
}));

const temporaryDirectories: string[] = [];

async function importerModule(): Promise<Record<string, any>> {
  const modulePath = "../src/canonical-url-attack-importer.ts";
  try {
    return await import(/* @vite-ignore */ modulePath) as Record<string, any>;
  } catch {
    return {};
  }
}

async function recordingPath(bytes = RECORDING_BYTES): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "proofline-024b-import-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "recording.json");
  await writeFile(path, bytes);
  return path;
}

function database(rereadOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const recording = makeCanonicalUrlAttackRecording();
  const rereadRow = {
    recording_sha256: Buffer.from(RECORDING_SHA256.slice(7), "hex"),
    recording_checksum: Buffer.from(recording.checksum.slice(7), "hex"),
    authority_recording_checksum: Buffer.from(recording.checksum.slice(7), "hex"),
    canonical_bytes: Buffer.from(RECORDING_BYTES),
    canonical_utf8_bytes: Buffer.byteLength(RECORDING_BYTES),
    recorded_at: new Date(recording.recordedAt),
    release_commit_sha: recording.release.commitSha,
    release_tree_sha: recording.release.treeSha,
    attack_run_id: recording.bundles.attack.runId,
    control_run_id: recording.bundles.control.runId,
    runtime_authority: "fdc-coston2-runtime-v1",
    ...rereadOverrides,
  };
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/SELECT[\s\S]+canonical_bytes/i.test(sql)) {
        return { rowCount: 1, rows: [rereadRow] };
      }
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  return { calls, client, pool: { connect: vi.fn().mockResolvedValue(client) } };
}

afterEach(async () => {
  verifyRuntime.mockReset();
  createRuntime.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Slice 024B one-shot trusted recording importer", () => {
  it("ships a separate importer entry wired to the concrete FDC runtime", async () => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    const [source, entry, packageSource] = await Promise.all([
      readFile(new URL("../src/canonical-url-attack-importer.ts", import.meta.url), "utf8").catch(() => ""),
      readFile(new URL("../src/import-canonical-url-attack-recording.ts", import.meta.url), "utf8").catch(() => ""),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);
    expect(source).toMatch(/@proofline\/fdc-coston2/);
    expect(source).toMatch(/createProductionCanonicalUrlAttackRuntime/);
    expect(source).not.toMatch(/fixture|synthetic|test-system|replay fallback/i);
    expect(entry).toMatch(/--recording/);
    expect(entry).toMatch(/DATABASE_URL/);
    expect(entry).not.toMatch(/PROOFLINE_PROJECT_TOKEN|PRIVATE_KEY|RPC_URL/);
    expect(JSON.parse(packageSource).scripts?.["import:canonical-url-attack"])
      .toMatch(/import-canonical-url-attack-recording/);
  });

  it("fully runtime-verifies exact in-memory bytes before connect, transaction or advisory lock", async () => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    const db = database();
    verifyRuntime.mockImplementation(async (serialized: string) => {
      expect(serialized).toBe(RECORDING_BYTES);
      expect(db.pool.connect).not.toHaveBeenCalled();
      return {
        status: "runtime-verified",
        recordingChecksum: makeCanonicalUrlAttackRecording().checksum,
      };
    });
    await module.importCanonicalUrlAttackRecording({
      recordingPath: await recordingPath(),
      pool: db.pool,
      repositoryRoot: new URL("../../../", import.meta.url),
    });
    expect(verifyRuntime).toHaveBeenCalledOnce();
    expect(db.pool.connect).toHaveBeenCalledOnce();
    expect(db.calls.findIndex((sql) => /BEGIN/i.test(sql))).toBeLessThan(
      db.calls.findIndex((sql) => /pg_advisory_xact_lock/i.test(sql)),
    );
  });

  it("inserts and rereads the same Buffer with exact digest, checksum and redundant metadata", async () => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    const db = database();
    verifyRuntime.mockResolvedValue({
      status: "runtime-verified",
      recordingChecksum: makeCanonicalUrlAttackRecording().checksum,
    });
    await module.importCanonicalUrlAttackRecording({
      recordingPath: await recordingPath(),
      pool: db.pool,
      repositoryRoot: new URL("../../../", import.meta.url),
    });
    const insert = db.client.query.mock.calls.find(([sql]) => /INSERT INTO proofline_private\.canonical_url_attack_recordings/i.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert?.[1]).toEqual(expect.arrayContaining([
      Buffer.from(RECORDING_SHA256.slice(7), "hex"),
      Buffer.from(RECORDING_BYTES),
      Buffer.byteLength(RECORDING_BYTES),
      "fdc-coston2-runtime-v1",
    ]));
    expect(db.calls.some((sql) => /ON CONFLICT/i.test(sql))).toBe(true);
    expect(db.calls.some((sql) => /SELECT[\s\S]+canonical_bytes/i.test(sql))).toBe(true);
    expect(db.calls.some((sql) => /COMMIT/i.test(sql))).toBe(true);
  });

  it("rolls back a same-identity conflict unless the reread bytes and metadata are identical", async () => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    verifyRuntime.mockResolvedValue({
      status: "runtime-verified",
      recordingChecksum: makeCanonicalUrlAttackRecording().checksum,
    });
    for (const rereadOverrides of [
      { canonical_bytes: Buffer.from("{}") },
      { release_tree_sha: "c".repeat(40) },
    ]) {
      const db = database(rereadOverrides);
      await expect(module.importCanonicalUrlAttackRecording({
        recordingPath: await recordingPath(),
        pool: db.pool,
        repositoryRoot: new URL("../../../", import.meta.url),
      })).rejects.toThrow(/conflict|bytes|metadata|identity/i);
      expect(db.calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
      expect(db.calls.some((sql) => /^\s*COMMIT\s*;?\s*$/i.test(sql))).toBe(false);
      const reread = db.calls.find((sql) => /SELECT[\s\S]+canonical_bytes/i.test(sql)) ?? "";
      for (const field of [
        "recording_sha256", "recording_checksum", "authority_recording_checksum",
        "canonical_utf8_bytes", "recorded_at", "release_commit_sha", "release_tree_sha",
        "attack_run_id", "control_run_id", "runtime_authority",
      ]) expect(reread).toMatch(new RegExp(`\\b${field}\\b`, "i"));
    }
  });

  it("rejects oversize, invalid UTF-8 or noncanonical bytes before runtime and PostgreSQL", async () => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    for (const bytes of [
      Buffer.alloc(6 * 1_024 * 1_024 + 1, 0x61),
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`${RECORDING_BYTES} `),
    ]) {
      const db = database();
      await expect(module.importCanonicalUrlAttackRecording({
        recordingPath: await recordingPath(bytes as any),
        pool: db.pool,
        repositoryRoot: new URL("../../../", import.meta.url),
      })).rejects.toThrow();
      expect(verifyRuntime).not.toHaveBeenCalled();
      expect(db.pool.connect).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["checksum mismatch", { status: "runtime-verified", recordingChecksum: `sha256:${"0".repeat(64)}` }],
    ["missing runtime authority", { status: "replayed", recordingChecksum: makeCanonicalUrlAttackRecording().checksum }],
  ])("rejects %s before PostgreSQL", async (_label, authority) => {
    const module = await importerModule();
    expect(module.importCanonicalUrlAttackRecording).toBeTypeOf("function");
    const db = database();
    verifyRuntime.mockResolvedValue(authority);
    await expect(module.importCanonicalUrlAttackRecording({
      recordingPath: await recordingPath(),
      pool: db.pool,
      repositoryRoot: new URL("../../../", import.meta.url),
    })).rejects.toThrow(/checksum|authority/i);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("uses one bounded file handle and no HTTP, directory scan, token or default recording path", async () => {
    const source = await readFile(new URL("../src/canonical-url-attack-importer.ts", import.meta.url), "utf8").catch(() => "");
    expect(source).toMatch(/\bopen\s*\(/);
    expect(source).toMatch(/O_NOFOLLOW/);
    expect(source).toMatch(/\.readFile\s*\(/);
    expect(source).toMatch(/\.close\s*\(/);
    expect(source).toContain(
      "proofline:canonical-url-attack-recording-import:v1",
    );
    expect(source).toMatch(/pg_advisory_xact_lock\s*\(\s*hashtextextended/i);
    expect(source).not.toMatch(/\bfetch\s*\(|https?:\/\/|readdir|glob|PROOFLINE_PROJECT_TOKEN|Authorization/i);
    expect(source).not.toMatch(/recordingPath\s*\?\?|default.*recording/i);
  });

  it("isolates the importer database role from bootstrap and ambient credentials", () => {
    const dedicated = isolateRecordingImporterEnvironment({
      PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE:
        "/run/secrets/recording_importer_database_url",
      DATABASE_URL: "postgresql://ambient.example.invalid/admin",
      DATABASE_URL_FILE: "/run/secrets/bootstrap_database_url",
      PROOFLINE_PROJECT_TOKEN: "must-not-cross-the-boundary",
    });
    expect(dedicated).toEqual({
      DATABASE_URL_FILE: "/run/secrets/recording_importer_database_url",
    });
    expect(Object.isFrozen(dedicated)).toBe(true);

    expect(isolateRecordingImporterEnvironment({
      DATABASE_URL: "postgresql://localhost/proofline",
    })).toEqual({
      DATABASE_URL: "postgresql://localhost/proofline",
      DATABASE_URL_FILE: undefined,
    });
  });
});
