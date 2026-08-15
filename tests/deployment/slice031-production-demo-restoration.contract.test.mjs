import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operatorModule = new URL("../../scripts/import-production-canonical-url-demo.mjs", import.meta.url);
const selector = `sha256:${"a".repeat(64)}`;
const recordingPath = "/opt/orivra/evidence/canonical-url-attack.recording.json";

test("production Compose passes one exact canonical demo selector to the API", async () => {
  const source = await readFile(new URL("../../deploy/compose.runtime.yaml", import.meta.url), "utf8");
  assert.match(source, /PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256:\s*\$\{PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256:\?/);
});

test("production runtime rejects a missing or malformed canonical demo selector before effects", async () => {
  const host = await import(new URL("../../scripts/timeweb-production-host-command.mjs", import.meta.url).href);
  assert.equal(typeof host.validateCanonicalUrlDemoSelectorEnvironment, "function");
  assert.equal(
    host.validateCanonicalUrlDemoSelectorEnvironment({
      PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: selector,
    }).PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256,
    selector,
  );
  for (const value of [undefined, "", "sha256:ABC", `sha256:${"a".repeat(63)}`]) {
    assert.throws(
      () => host.validateCanonicalUrlDemoSelectorEnvironment({
        PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: value,
      }),
      (error) => error?.code === "TIMEWEB_HOST_CONFIGURATION_INVALID",
    );
  }
});

test("operator reads one root-owned mode-0400 recording with O_NOFOLLOW and exact SHA", async () => {
  const operator = await import(operatorModule.href).catch(() => ({}));
  assert.equal(typeof operator.inspectProductionCanonicalUrlDemoRecording, "function");
  const calls = [];
  const bytes = Buffer.from('{"recording":true}');
  const result = await operator.inspectProductionCanonicalUrlDemoRecording({
    recordingPath,
    expectedSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    openFile: async (path, flags) => {
      calls.push([path, flags]);
      return {
        stat: async () => ({ isFile: () => true, mode: 0o100400, uid: 0, gid: 0, size: bytes.length }),
        readFile: async () => bytes,
        close: async () => calls.push(["close"]),
      };
    },
  });
  assert.deepEqual(calls[0], [recordingPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK]);
  assert.deepEqual(calls.at(-1), ["close"]);
  assert.equal(result.recordingPath, recordingPath);
  assert.equal(result.recordingSha256, result.expectedSha256);
});

test("operator rejects symlinks, wrong ownership or mode, and oversized recordings before Docker", async () => {
  const operator = await import(operatorModule.href);
  const bytes = Buffer.from("x");
  const expectedSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const invalidMetadata = [
    { isFile: () => false, mode: 0o100400, uid: 0, gid: 0, size: 1 },
    { isFile: () => true, mode: 0o100600, uid: 0, gid: 0, size: 1 },
    { isFile: () => true, mode: 0o100400, uid: 1000, gid: 0, size: 1 },
    { isFile: () => true, mode: 0o100400, uid: 0, gid: 1000, size: 1 },
    { isFile: () => true, mode: 0o100400, uid: 0, gid: 0, size: 6 * 1_024 * 1_024 + 1 },
  ];
  for (const metadata of invalidMetadata) {
    await assert.rejects(operator.inspectProductionCanonicalUrlDemoRecording({
      recordingPath,
      expectedSha256,
      openFile: async () => ({
        stat: async () => metadata,
        readFile: async () => bytes,
        close: async () => undefined,
      }),
    }), /metadata|invalid/i);
  }
  await assert.rejects(operator.inspectProductionCanonicalUrlDemoRecording({
    recordingPath,
    expectedSha256,
    openFile: async () => { throw Object.assign(new Error("symlink"), { code: "ELOOP" }); },
  }), /invalid/i);
});

test("operator runs exactly one isolated dedicated-role importer and binds the selector", async () => {
  const operator = await import(operatorModule.href).catch(() => ({}));
  assert.equal(typeof operator.runProductionCanonicalUrlDemoImport, "function");
  const calls = [];
  const result = await operator.runProductionCanonicalUrlDemoImport({
    recordingPath,
    expectedSha256: selector,
    runtimeEnvironment: {
      PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: selector,
    },
    inspectRecording: async () => ({ recordingPath, recordingSha256: selector, expectedSha256: selector }),
    invoke: async (executable, arguments_, options) => {
      calls.push({ executable, arguments_, options });
      return "Imported canonical URL attack recording sha256:" + "a".repeat(64) + "\n";
    },
  });
  assert.equal(result.status, "imported");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "/usr/bin/docker");
  assert.deepEqual(calls[0].arguments_.slice(-6), [
    "--entrypoint", "node", "db-role-bootstrap",
    "/app/apps/api/dist/import-canonical-url-attack-recording.js",
    "--recording", "/run/proofline/canonical-url-attack.recording.json",
  ]);
  assert.match(calls[0].arguments_.join(" "), /run --rm --no-deps --pull never --user 0:0/);
  assert.match(calls[0].arguments_.join(" "), /canonical-url-attack\.recording\.json:ro/);
  assert.equal(calls[0].options.environment.PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256, selector);
});

test("operator fails before Docker for wrong path, metadata, digest or selector", async () => {
  const operator = await import(operatorModule.href).catch(() => ({}));
  assert.equal(typeof operator.runProductionCanonicalUrlDemoImport, "function");
  for (const mutation of ["path", "metadata", "digest", "selector"]) {
    let effects = 0;
    await assert.rejects(
      operator.runProductionCanonicalUrlDemoImport({
        recordingPath: mutation === "path" ? "/tmp/recording.json" : recordingPath,
        expectedSha256: selector,
        runtimeEnvironment: {
          PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256:
            mutation === "selector" ? `sha256:${"b".repeat(64)}` : selector,
        },
        inspectRecording: async ({ recordingPath: path }) => {
          if (mutation === "path" || mutation === "metadata") throw new Error("invalid recording");
          return { recordingPath: path, recordingSha256: mutation === "digest" ? `sha256:${"b".repeat(64)}` : selector, expectedSha256: selector };
        },
        invoke: async () => { effects += 1; },
      }),
      /invalid|recording|selector|digest/i,
    );
    assert.equal(effects, 0);
  }
});

test("a nonzero importer is one failed foreground attempt with no synthetic success", async () => {
  const operator = await import(operatorModule.href);
  let effects = 0;
  await assert.rejects(operator.runProductionCanonicalUrlDemoImport({
    recordingPath,
    expectedSha256: selector,
    runtimeEnvironment: {
      PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256: selector,
    },
    inspectRecording: async () => ({ recordingPath, recordingSha256: selector, expectedSha256: selector }),
    invoke: async () => {
      effects += 1;
      throw new Error("docker exit 17");
    },
  }), /docker exit 17/);
  assert.equal(effects, 1);
});

test("operator is exposed as one production command and never logs recording bytes or secrets", async () => {
  const [rootPackage, source] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(operatorModule, "utf8").catch(() => ""),
  ]);
  assert.match(JSON.parse(rootPackage).scripts?.["production:demo:import"] ?? "", /import-production-canonical-url-demo/);
  assert.doesNotMatch(source, /PROOFLINE_PROJECT_TOKEN|PRIVATE_KEY|console\.log\([^)]*(?:bytes|secret|DATABASE_URL)/i);
});
