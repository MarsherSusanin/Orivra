// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as Bootstrap from "../src/bootstrap";
import {
  RECORDING_BYTES,
  RECORDING_SHA256,
} from "../../../packages/contracts/test/slice024b-canonical-url-attack-demo.fixtures";
import { makeCanonicalUrlAttackRecording } from "../../../packages/contracts/test/slice024a-canonical-url-attack.fixtures";

const bootstrap = Bootstrap as Record<string, any>;

function digestBytes(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function persistedRow(overrides: Record<string, unknown> = {}) {
  const recording = makeCanonicalUrlAttackRecording();
  return {
    recording_sha256: digestBytes(RECORDING_BYTES),
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
    ...overrides,
  };
}

describe("Slice 024B exact recording selection and startup cache", () => {
  it("accepts only an optional exact lowercase sha256 environment selector", () => {
    expect(bootstrap.parseCanonicalUrlAttackRecordingSelector).toBeTypeOf("function");
    expect(bootstrap.parseCanonicalUrlAttackRecordingSelector({})).toBeNull();
    expect(bootstrap.parseCanonicalUrlAttackRecordingSelector({
      PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: RECORDING_SHA256,
    })).toBe(RECORDING_SHA256);
    for (const value of ["latest", RECORDING_SHA256.toUpperCase(), RECORDING_SHA256.slice(0, -1), ` ${RECORDING_SHA256}`]) {
      expect(() => bootstrap.parseCanonicalUrlAttackRecordingSelector({
        PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: value,
      })).toThrow(/PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256|sha256/i);
    }
  });

  it("does not query PostgreSQL when the optional selector is absent", async () => {
    expect(bootstrap.loadCanonicalUrlAttackDemoCache).toBeTypeOf("function");
    const pool = { query: vi.fn() };
    await expect(bootstrap.loadCanonicalUrlAttackDemoCache({
      pool,
      recordingSha256: null,
    })).resolves.toEqual({ status: "unavailable" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("loads one exact digest row once and caches exact bytes plus a strict derived summary", async () => {
    expect(bootstrap.loadCanonicalUrlAttackDemoCache).toBeTypeOf("function");
    const row = persistedRow();
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [row] }) };
    const cache = await bootstrap.loadCanonicalUrlAttackDemoCache({
      pool,
      recordingSha256: RECORDING_SHA256,
    });
    expect(pool.query).toHaveBeenCalledOnce();
    expect(String(pool.query.mock.calls[0][0])).toMatch(/WHERE\s+recording_sha256\s*=\s*\$1/i);
    expect(cache).toMatchObject({
      status: "available",
      recordingSha256: RECORDING_SHA256,
      summary: {
        status: "available",
        recording: { sha256: RECORDING_SHA256 },
      },
    });
    expect(Buffer.from(cache.recordingBytes)).toEqual(Buffer.from(RECORDING_BYTES));
    expect(Object.isFrozen(cache.summary)).toBe(true);
    expect(Object.isFrozen(cache.summary.recording)).toBe(true);
    expect(Object.isFrozen(cache.summary.runs.attack)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["digest mismatch", persistedRow({ recording_sha256: Buffer.alloc(32, 7) })],
    ["byte size mismatch", persistedRow({ canonical_utf8_bytes: 1 })],
    ["outer checksum mismatch", persistedRow({ recording_checksum: Buffer.alloc(32, 9) })],
    ["authority checksum mismatch", persistedRow({ authority_recording_checksum: Buffer.alloc(32, 8) })],
    ["release metadata mismatch", persistedRow({ release_tree_sha: "c".repeat(40) })],
    ["recorded time mismatch", persistedRow({ recorded_at: new Date("2026-08-09T12:00:00.001Z") })],
    ["run metadata mismatch", persistedRow({ attack_run_id: "run_substituted" })],
    ["wrong authority", persistedRow({ runtime_authority: "pure-domain-replay" })],
    ["noncanonical bytes", persistedRow({ canonical_bytes: Buffer.from(`${RECORDING_BYTES} `), canonical_utf8_bytes: Buffer.byteLength(RECORDING_BYTES) + 1 })],
  ])("degrades a %s row to the same unavailable state", async (_label, row) => {
    expect(bootstrap.loadCanonicalUrlAttackDemoCache).toBeTypeOf("function");
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: row ? 1 : 0, rows: row ? [row] : [] }) };
    await expect(bootstrap.loadCanonicalUrlAttackDemoCache({
      pool,
      recordingSha256: RECORDING_SHA256,
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps compiler/EVM authority out of ordinary API startup and read paths", async () => {
    const [bootstrapSource, appSource] = await Promise.all([
      readFile(new URL("../src/bootstrap.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app.ts", import.meta.url), "utf8"),
    ]);
    expect(`${bootstrapSource}\n${appSource}`).not.toMatch(
      /@proofline\/fdc-coston2|createProductionCanonicalUrlAttackRuntime|\bsolc\b|@ethereumjs\/vm/,
    );
  });
});
