import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProductionCanarySystemdTick } from "./production-canary-resume-runtime.mjs";
import { createProductionCanaryObservation } from "./timeweb-production-pilot-adapters.mjs";
import { readBoundedPrivateFile } from "./private-file-runtime.mjs";

const ROOT = "/var/lib/orivra/production-canary";
const DEPLOYMENT_EVIDENCE = "/opt/orivra/evidence/production-deployment-evidence.v2.json";
const DEPLOYMENT_EVIDENCE_SHA256 = "/opt/orivra/evidence/production-deployment-evidence.v2.sha256";
const PROMOTION_EVIDENCE = `${ROOT}/production-promotion-evidence.v2.json`;
const WRITE_STATE = Object.freeze({ accepted: "passed" });

function parseRoot(argv) {
  if (argv.length !== 2 || argv[0] !== "--state-root" || argv[1] !== ROOT) throw new Error("Production canary state root is invalid");
  return ROOT;
}

async function loadState(root) {
  const directory = join(root, "checkpoints");
  const directoryStatus = await lstat(directory);
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink() || (directoryStatus.mode & 0o777) !== 0o700) {
    throw new Error("Production canary checkpoint directory is invalid");
  }
  const names = (await readdir(directory)).filter((name) => /^\d{2}-[a-z0-9-]+\.json$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const status = await handle.stat();
      if (!status.isFile() || (status.mode & 0o777) !== 0o400 || status.size < 1 || status.size > 1024 * 1024) {
        throw new Error("Production canary checkpoint file is invalid");
      }
      const bytes = Buffer.alloc(status.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length) throw new Error("Production canary checkpoint read is incomplete");
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      await handle.close();
    }
  }));
}

async function appendFile(entry) {
  const checkpointDirectory = join(ROOT, "checkpoints");
  const allowedCheckpoint = entry.path.startsWith(`${checkpointDirectory}/`) && /^\d{2}-[a-z0-9-]+\.json$/.test(entry.path.slice(checkpointDirectory.length + 1));
  const allowedPromotion = entry.path === join(ROOT, "production-promotion-evidence.v2.json");
  if ((!allowedCheckpoint && !allowedPromotion) || entry.noReplace !== true || entry.mode !== 0o400) {
    throw new Error("Production canary output path is invalid");
  }
  await mkdir(dirname(entry.path), { recursive: true, mode: 0o700 });
  const directoryStatus = await lstat(dirname(entry.path));
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink() || (directoryStatus.mode & 0o777) !== 0o700) {
    throw new Error("Production canary output directory is invalid");
  }
  const stage = `${entry.path}.stage-${process.pid}`;
  let createdStage = false;
  try {
    const handle = await open(stage, "wx", 0o600);
    createdStage = true;
    try {
      await handle.writeFile(entry.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(stage, entry.mode);
    await link(stage, entry.path);
    return { status: WRITE_STATE.accepted, sha256: entry.sha256 };
  } finally {
    if (createdStage) await rm(stage, { force: true });
  }
}

async function loadPromotion() {
  try {
    const bytes = await readBoundedPrivateFile(PROMOTION_EVIDENCE, { maximumBytes: 1024 * 1024 });
    return { bytes, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  } catch (cause) {
    if (cause?.cause?.code === "ENOENT" || cause?.code === "ENOENT") return null;
    throw cause;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const stateRoot = parseRoot(argv);
  const result = await runProductionCanarySystemdTick({
    stateRoot,
    deploymentEvidenceBytes: await readBoundedPrivateFile(DEPLOYMENT_EVIDENCE, { maximumBytes: 1024 * 1024 }),
    expectedDeploymentEvidenceSha256: (await readBoundedPrivateFile(DEPLOYMENT_EVIDENCE_SHA256, { maximumBytes: 128 })).toString("utf8").trim(),
    clock: { now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    loadCanonicalState: () => loadState(stateRoot),
    loadCanonicalPromotionEvidence: loadPromotion,
    observe: createProductionCanaryObservation,
    appendCheckpoint: appendFile,
    appendPromotionEvidence: appendFile,
    cleanupStage: async (path) => rm(path, { force: true }),
  });
  process.stdout.write(`${JSON.stringify({ state: result.status, checkpointId: result.checkpointId })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
