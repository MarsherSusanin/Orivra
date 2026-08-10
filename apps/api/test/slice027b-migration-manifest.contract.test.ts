// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);
const temporaryDirectories: string[] = [];
const expectedHistorical = [
  [1, "001_initial.sql", "981c89f41206efbdd3d8aaee29d2a3fd792140cbabd672ec037b498f8db45b7a"],
  [2, "002_one_active_submission.sql", "cc0c793c937fc7bec2ebb67d6f71f07d623161c28e5519881c42528026cab3dc"],
  [3, "003_run_discovery.sql", "0dce79492d46b0be5ca74bf9d0c799929d1a4f78d895ad2971e3a8bd42bfd2f3"],
  [4, "004_preflight_report.sql", "7a4d9417181e62c2863c9f87a4e5631d907418b40b1580b21c4403718edb018e"],
  [5, "005_explicit_submission_authority.sql", "9a0cb48b20f7f9a388f644951e11c3c7160eebc66822c5326e49812b5ea49282"],
  [6, "006_wallet_identity_sessions.sql", "dcb56f914d2817392f3d12e9781f4402c47e773c65f89988a10f2fd2f7332d17"],
  [7, "007_account_token_management.sql", "c83e9d98f45285bc19a66d79bb53b87f51cfc81aaa023248a7a20232a3328be9"],
  [8, "008_persisted_admission_quotas.sql", "38d50b679e6dfbd6460818c6155b535f9b6d47906d0ab644eb6e456034dd00be"],
  [9, "009_canonical_url_attack_recordings.sql", "d5e73e7541a49edf07d78b3f754f0b9df2f6ff7d0254bbc1ef5c3a87da0f1426"],
] as const;

async function optionalModule(): Promise<Record<string, any>> {
  const path = pathToFileURL(
    fileURLToPath(new URL("../src/migration-runner.ts", import.meta.url)),
  ).href;
  return import(/* @vite-ignore */ `${path}?contract=${Date.now()}`).catch(() => ({}));
}

async function checkedInManifest(): Promise<Record<string, any>> {
  const bytes = await readFile(join(migrationsDirectory, "manifest.v1.json"), "utf8")
    .catch(() => "{}");
  return JSON.parse(bytes) as Record<string, any>;
}

function expectManifestInvalid(operation: () => unknown) {
  try {
    operation();
  } catch (cause) {
    expect(cause).toMatchObject({ code: "MIGRATION_MANIFEST_INVALID" });
    return;
  }
  throw new Error("Expected MIGRATION_MANIFEST_INVALID");
}

async function copyMigrationDirectory(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "proofline-027b-migrations-"));
  temporaryDirectories.push(target);
  for (const name of await readdir(migrationsDirectory)) {
    if (/^\d{3}_.+\.sql$/.test(name) || name === "manifest.v1.json") {
      await writeFile(join(target, name), await readFile(join(migrationsDirectory, name)));
    }
  }
  return target;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

describe("Slice 027B immutable migration manifest", () => {
  it("records one strict ordered raw-byte authority for schema compatibility 10 only", async () => {
    const manifest = await checkedInManifest();
    expect(manifest).toEqual({
      version: "1",
      lockKey: "-4708329426407388777",
      schema: {
        targetVersion: 10,
        minimumCompatibleVersion: 10,
        maximumCompatibleVersion: 10,
      },
      migrations: expect.any(Array),
    });
    expect(manifest.migrations).toHaveLength(10);
    expect(manifest.migrations.map((entry: any) => entry.version)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    expect(manifest.migrations.at(-1)?.filename).toBe(
      "010_deployment_lifecycle.sql",
    );
    for (const entry of manifest.migrations) {
      expect(Object.keys(entry).sort()).toEqual(["filename", "sha256", "version"]);
      expect(entry.filename).toMatch(
        new RegExp(`^${String(entry.version).padStart(3, "0")}_[a-z0-9_]+\\.sql$`),
      );
      expect(entry.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("keeps accepted migrations 001 through 009 byte-identical as a nearest control", async () => {
    for (const [version, filename, digest] of expectedHistorical) {
      const bytes = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
      expect(version).toBe(Number(filename.slice(0, 3)));
    }
  });

  it("binds every accepted historical raw file digest in the new manifest", async () => {
    const manifest = await checkedInManifest();
    for (const [version, filename, digest] of expectedHistorical) {
      expect(manifest.migrations?.[version - 1]).toEqual({
        version,
        filename,
        sha256: `sha256:${digest}`,
      });
    }
  });

  it("binds migration 010 to its exact checked-in raw bytes", async () => {
    const manifest = await checkedInManifest();
    const entry = manifest.migrations?.[9];
    expect(entry?.filename).toBe("010_deployment_lifecycle.sql");
    const bytes = await readFile(join(migrationsDirectory, entry.filename));
    expect(entry.sha256).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });

  it.each([
    ["unknown manifest field", (value: any) => ({ ...value, extra: true })],
    ["wrong manifest version", (value: any) => ({ ...value, version: "2" })],
    ["widened application range", (value: any) => ({
      ...value,
      schema: {
        targetVersion: 10,
        minimumCompatibleVersion: 9,
        maximumCompatibleVersion: 10,
      },
    })],
    ["reordered entry", (value: any) => ({
      ...value,
      migrations: [value.migrations[1], value.migrations[0], ...value.migrations.slice(2)],
    })],
    ["duplicate version", (value: any) => ({
      ...value,
      migrations: value.migrations.map((entry: any, index: number) =>
        index === 1 ? { ...entry, version: 1 } : entry),
    })],
    ["uppercase digest", (value: any) => ({
      ...value,
      migrations: value.migrations.map((entry: any, index: number) =>
        index === 0 ? { ...entry, sha256: entry.sha256.toUpperCase() } : entry),
    })],
    ["entry field", (value: any) => ({
      ...value,
      migrations: value.migrations.map((entry: any, index: number) =>
        index === 0 ? { ...entry, size: 10_078 } : entry),
    })],
  ] as const)("rejects %s before filesystem or PostgreSQL effects", async (_label, mutate) => {
    const module = await optionalModule();
    expect(module.parseMigrationManifest).toBeTypeOf("function");
    const manifest = await checkedInManifest();
    const readMigrationFile = vi.fn();
    const connect = vi.fn();
    expectManifestInvalid(() => module.parseMigrationManifest(mutate(structuredClone(manifest)), {
      readMigrationFile,
      connect,
    }));
    expect(readMigrationFile).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ["tampered bytes", async (directory: string) => {
      const path = join(directory, "004_preflight_report.sql");
      await writeFile(path, `${await readFile(path, "utf8")}\n`);
    }],
    ["missing file", async (directory: string) => {
      await rm(join(directory, "006_wallet_identity_sessions.sql"));
    }],
    ["extra migration", async (directory: string) => {
      await writeFile(join(directory, "011_unlisted.sql"), "BEGIN;\nCOMMIT;\n");
    }],
    ["invalid outer wrapper", async (directory: string) => {
      const path = join(directory, "003_run_discovery.sql");
      await writeFile(path, (await readFile(path, "utf8")).replace(/^BEGIN;/, "BEGIN; BEGIN;"));
    }],
  ] as const)("rejects %s while loading the plan before a database connection", async (_label, mutate) => {
    const module = await optionalModule();
    expect(module.loadVerifiedMigrationPlan).toBeTypeOf("function");
    const directory = await copyMigrationDirectory();
    await mutate(directory);
    const pool = { connect: vi.fn() };
    await expect(module.loadVerifiedMigrationPlan({
      migrationsDirectory: directory,
      pool,
    })).rejects.toMatchObject({ code: "MIGRATION_MANIFEST_INVALID" });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("exports fixed schema and advisory-lock authority without path or network defaults", async () => {
    const module = await optionalModule();
    expect(module).toMatchObject({
      PROOFLINE_SCHEMA_VERSION: 10,
      MIGRATION_ADVISORY_LOCK: -4_708_329_426_407_388_777n,
      MIGRATION_STATEMENT_TIMEOUT_MS: 60_000,
      parseMigrationManifest: expect.any(Function),
      loadVerifiedMigrationPlan: expect.any(Function),
      runVerifiedMigrations: expect.any(Function),
    });
    const source = await readFile(
      new URL("../src/migration-runner.ts", import.meta.url),
      "utf8",
    ).catch(() => "");
    expect(source).not.toMatch(/https?:|fetch\s*\(|readdir\([^)]*\.\.|process\.cwd\(\)/i);
    expect(source).not.toMatch(/private.?key|project_|share_|verifier/i);
  });

  it("ships separate exact-API-image role-bootstrap and migrate entries", async () => {
    const [packageSource, dockerfile, roleEntry, migrationEntry] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../../docker/Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../src/db-role-bootstrap.ts", import.meta.url), "utf8")
        .catch(() => ""),
      readFile(new URL("../src/migrate.ts", import.meta.url), "utf8").catch(() => ""),
    ]);
    const packageJson = JSON.parse(packageSource);
    for (const name of [
      "build:migrate",
      "build:db-role-bootstrap",
      "db:bootstrap-roles",
      "db:migrate",
    ]) expect(packageJson.scripts?.[name]).toBeTypeOf("string");
    expect(packageJson.scripts?.["build:migrate"] ?? "").toMatch(/migrate\.ts/);
    expect(packageJson.scripts?.["build:db-role-bootstrap"] ?? "")
      .toMatch(/db-role-bootstrap\.ts/);
    expect(packageJson.scripts?.["db:bootstrap-roles"] ?? "")
      .toMatch(/db-role-bootstrap\.js/);
    expect(packageJson.scripts?.["db:migrate"] ?? "").toMatch(/migrate\.js/);
    expect(roleEntry).toMatch(/bootstrapProductionDatabaseRoles/);
    expect(migrationEntry).toMatch(/runProductionMigrations/);
    expect(`${roleEntry}\n${migrationEntry}`).not.toMatch(/http|worker|private.?key|verifier/i);
    expect(dockerfile).toMatch(/dist\/migrate\.js/);
    expect(dockerfile).toMatch(/dist\/db-role-bootstrap\.js/);
    expect(dockerfile).toMatch(/manifest\.v1\.json/);
    expect(basename(migrationsDirectory)).toBe("migrations");
  });
});
