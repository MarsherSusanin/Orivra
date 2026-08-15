import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindFixedReplayBootstrapComposeInterpolationEnvironment } from "./timeweb-production-compose-environment.mjs";
import { loadTimewebProductionRuntimeEnvironment } from "./timeweb-production-host-command.mjs";

const EVIDENCE_ROOT = "/opt/orivra/evidence";
const CURRENT_ROOT = "/opt/orivra/current";
const PROJECT = "proofline-production-primary";
const CONTAINER_RECORDING = "/run/proofline/canonical-url-attack.recording.json";
const MAX_RECORDING_BYTES = 6 * 1_024 * 1_024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const RECORDING_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.json$/;
const COMPOSE_FILES = [
  `${CURRENT_ROOT}/compose.yaml`,
  `${CURRENT_ROOT}/deploy/compose.runtime.yaml`,
  `${CURRENT_ROOT}/deploy/compose.backup.yaml`,
];

function invalid(message = "Production canonical URL demo import is invalid") {
  return Object.assign(new Error(message), {
    code: "PRODUCTION_CANONICAL_URL_DEMO_IMPORT_INVALID",
  });
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactRecordingPath(recordingPath, evidenceRoot) {
  if (
    typeof recordingPath !== "string" ||
    dirname(recordingPath) !== evidenceRoot ||
    !RECORDING_NAME.test(basename(recordingPath))
  ) {
    throw invalid("Production canonical URL demo recording path is invalid");
  }
  return recordingPath;
}

export async function inspectProductionCanonicalUrlDemoRecording({
  recordingPath,
  expectedSha256,
  evidenceRoot = EVIDENCE_ROOT,
  expectedOwner = Object.freeze({ uid: 0, gid: 0 }),
  openFile = open,
} = {}) {
  exactRecordingPath(recordingPath, evidenceRoot);
  if (!SHA256.test(expectedSha256 ?? "")) {
    throw invalid("Production canonical URL demo recording digest is invalid");
  }
  let handle;
  try {
    handle = await openFile(
      recordingPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o400 ||
      metadata.uid !== expectedOwner.uid ||
      metadata.gid !== expectedOwner.gid ||
      metadata.size < 1 ||
      metadata.size > MAX_RECORDING_BYTES
    ) {
      throw invalid("Production canonical URL demo recording metadata is invalid");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size || digest(bytes) !== expectedSha256) {
      throw invalid("Production canonical URL demo recording digest is invalid");
    }
    return Object.freeze({
      recordingPath,
      recordingSha256: expectedSha256,
      expectedSha256,
    });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_CANONICAL_URL_DEMO_IMPORT_INVALID") {
      throw cause;
    }
    throw invalid();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function composeArguments(recordingPath) {
  const arguments_ = ["compose"];
  for (const path of COMPOSE_FILES) arguments_.push("--file", path);
  arguments_.push(
    "--project-name",
    PROJECT,
    "run",
    "--rm",
    "--no-deps",
    "--pull",
    "never",
    "--user",
    "0:0",
    "--volume",
    `${recordingPath}:${CONTAINER_RECORDING}:ro`,
    "--entrypoint",
    "node",
    "db-role-bootstrap",
    "/app/apps/api/dist/import-canonical-url-attack-recording.js",
    "--recording",
    CONTAINER_RECORDING,
  );
  return Object.freeze(arguments_);
}

async function runProcess(executable, arguments_, { environment } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: CURRENT_ROOT,
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
        ...environment,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > 64 * 1_024) child.kill("SIGKILL");
      else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 || signal || size > 64 * 1_024) {
        reject(invalid("Production canonical URL demo importer failed"));
      } else {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
      }
    });
  });
}

export async function runProductionCanonicalUrlDemoImport({
  recordingPath,
  expectedSha256,
  runtimeEnvironment,
  inspectRecording = inspectProductionCanonicalUrlDemoRecording,
  invoke = runProcess,
} = {}) {
  if (
    runtimeEnvironment?.PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256 !==
      expectedSha256 ||
    !SHA256.test(expectedSha256 ?? "")
  ) {
    throw invalid("Production canonical URL demo selector is invalid");
  }
  const recording = await inspectRecording({ recordingPath, expectedSha256 });
  if (
    recording.recordingPath !== recordingPath ||
    recording.recordingSha256 !== expectedSha256 ||
    recording.expectedSha256 !== expectedSha256
  ) {
    throw invalid("Production canonical URL demo recording identity is invalid");
  }
  const environment = bindFixedReplayBootstrapComposeInterpolationEnvironment(
    runtimeEnvironment,
  );
  const output = await invoke(
    "/usr/bin/docker",
    composeArguments(recordingPath),
    { environment },
  );
  if (
    output.trim() !==
    `Imported canonical URL attack recording ${expectedSha256}`
  ) {
    throw invalid("Production canonical URL demo importer output is invalid");
  }
  return Object.freeze({ status: "imported", recordingSha256: expectedSha256 });
}

function parseArguments(argv) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--recording" ||
    argv[2] !== "--sha256"
  ) {
    throw invalid(
      "Usage: import-production-canonical-url-demo --recording <path> --sha256 <sha256>",
    );
  }
  return Object.freeze({ recordingPath: argv[1], expectedSha256: argv[3] });
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const runtimeEnvironment = await loadTimewebProductionRuntimeEnvironment();
  const result = await runProductionCanonicalUrlDemoImport({
    ...input,
    runtimeEnvironment,
  });
  process.stdout.write(
    `Imported production canonical URL demo ${result.recordingSha256}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main().catch(() => {
    process.stderr.write("Production canonical URL demo import failed\n");
    process.exitCode = 2;
  });
}
