import { fileURLToPath } from "node:url";
import { runTimewebDirectProductionPilot } from "./digitalocean-production-promotion-runtime.mjs";
import { createProductionPilotAdapters } from "./timeweb-production-pilot-adapters.mjs";
import { canonicalJson } from "./backup-evidence-validation.mjs";
import { readBoundedPrivateFile } from "./private-file-runtime.mjs";

const argumentMap = Object.freeze({
  "publication-evidence": ["authority", "publicationEvidence"],
  "publication-evidence-sha256-file": ["authority", "publicationEvidenceSha256"],
  "production-target": ["authority", "productionTarget"],
  "production-target-sha256-file": ["authority", "productionTargetSha256"],
  "object-store-authority": ["authority", "objectStoreAuthority"],
  "object-store-authority-sha256-file": ["authority", "objectStoreAuthoritySha256"],
  "promotion-authorization": ["authority", "promotionAuthorization"],
  "promotion-authorization-sha256-file": ["authority", "promotionAuthorizationSha256"],
  run: ["authority", "run"],
  "ghcr-pull-token-file": ["secret", "ghcrPullToken"],
  "ssh-private-key-file": ["secret", "sshPrivateKey"],
  "timeweb-access-key-file": ["secret", "timewebAccessKey"],
  "timeweb-secret-key-file": ["secret", "timewebSecretKey"],
  "backup-encryption-key-file": ["secret", "backupEncryptionKey"],
});
const BROWSER_ACCEPTANCE = "/opt/orivra/evidence/hosted-browser-acceptance.v1.json";
const BROWSER_ACCEPTANCE_SHA256 = "/opt/orivra/evidence/hosted-browser-acceptance.v1.sha256";

function invalid(message = "Production pilot CLI requires absolute file arguments") {
  throw Object.assign(new Error(message), { code: "PRODUCTION_PILOT_CLI_INVALID" });
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== Object.keys(argumentMap).length * 2) invalid("Production pilot CLI received an unknown argument");
  const authorityFiles = {};
  const secretFiles = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, "");
    const definition = argumentMap[name];
    const value = argv[index + 1];
    if (!definition || typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) invalid();
    const target = definition[0] === "authority" ? authorityFiles : secretFiles;
    if (Object.hasOwn(target, definition[1])) invalid("Production pilot CLI received a duplicate argument");
    target[definition[1]] = value;
  }
  if (Object.keys(authorityFiles).length !== 9 || Object.keys(secretFiles).length !== 5) invalid();
  return Object.freeze({ authorityFiles: Object.freeze(authorityFiles), secretFiles: Object.freeze(secretFiles) });
}

async function readChecksum(path) {
  const value = (await readBoundedPrivateFile(path, { maximumBytes: 128 })).toString("utf8").trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) invalid("Production pilot checksum file is invalid");
  return value;
}

async function executeProductionPilot({ authorityFiles, adapters }) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return runTimewebDirectProductionPilot({
    publicationEvidenceBytes: await readBoundedPrivateFile(authorityFiles.publicationEvidence, { maximumBytes: 1024 * 1024 }),
    expectedPublicationEvidenceSha256: await readChecksum(authorityFiles.publicationEvidenceSha256),
    productionTargetBytes: await readBoundedPrivateFile(authorityFiles.productionTarget, { maximumBytes: 1024 * 1024 }),
    expectedProductionTargetSha256: await readChecksum(authorityFiles.productionTargetSha256),
    objectStoreAuthorityBytes: await readBoundedPrivateFile(authorityFiles.objectStoreAuthority, { maximumBytes: 64 * 1024 }),
    expectedObjectStoreAuthoritySha256: await readChecksum(authorityFiles.objectStoreAuthoritySha256),
    promotionAuthorizationBytes: await readBoundedPrivateFile(authorityFiles.promotionAuthorization, { maximumBytes: 1024 * 1024 }),
    expectedPromotionAuthorizationSha256: await readChecksum(authorityFiles.promotionAuthorizationSha256),
    runBytes: await readBoundedPrivateFile(authorityFiles.run, { maximumBytes: 64 * 1024 }),
    browserAcceptanceBytes: await readBoundedPrivateFile(BROWSER_ACCEPTANCE, { maximumBytes: 1024 * 1024 }),
    expectedBrowserAcceptanceSha256: await readChecksum(BROWSER_ACCEPTANCE_SHA256),
    now,
    clock: { now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    ...adapters,
  });
}

export async function runTimewebDirectProductionPilotCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  createAdapters = createProductionPilotAdapters,
  runPilot = executeProductionPilot,
} = {}) {
  const parsed = parseArguments(argv);
  const adapters = await createAdapters({ secretFiles: parsed.secretFiles, authorityFiles: parsed.authorityFiles });
  const result = await runPilot({ authorityFiles: parsed.authorityFiles, adapters });
  const publicResult = Object.freeze({ status: result.status, runId: result.runId });
  stdout.write(`${canonicalJson(publicResult)}\n`);
  return publicResult;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runTimewebDirectProductionPilotCli();
}
