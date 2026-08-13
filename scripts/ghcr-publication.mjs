import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  GhcrPublicationTargetsV1Schema,
  canonicalSerializeGhcrPublicationTargets,
  canonicalSerializePublicationEvidence,
} from "../packages/contracts/src/publication-runtime.mjs";
import {
  CredentialFreeMlpCandidateV1Schema,
  canonicalSerializeCredentialFreeMlpCandidate,
} from "../packages/contracts/src/candidate-runtime.mjs";
import {
  FrozenOciReleaseManifestV1Schema,
  FrozenOciReleaseReceiptV1Schema,
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
} from "../packages/contracts/src/release-runtime.mjs";
import { verifyCredentialFreeMlpCandidateHandoff } from "../packages/domain/src/mlp-candidate-runtime.mjs";
import { createPublicationEvidence } from "../packages/domain/src/publication-runtime.mjs";
import {
  createPublicationCredentialEnvironment,
  captureFrozenOciArchiveForPublication,
  runGhcrPublication,
} from "./ghcr-publication-runtime.mjs";
import { createGhcrRegistryPublicationAdapter } from "./ghcr-registry-adapter.mjs";
import {
  checksumOciArchiveDescriptor,
  inspectCanonicalOciUstarDescriptor,
  readOciDescriptorRange,
} from "./oci-ustar-reader.mjs";

const AUTHORIZED = Object.freeze({
  commitSha: "9e45513339022a91f3269f2145b54166a7bb1046",
  treeSha: "6d39b92accefa60cd5b829a0b28a280ee6b98f13",
  candidateSha256: "sha256:b8dc48cab19e341d9c1033ef84f265058320c3f123d25117f06dfbbdcaee6405",
  coreReportSha256: "sha256:c07d0780ff0ff7cdcbdc92ab30808c416bf96b7f115b9165e03dc64b7b2f57af",
  productReportSha256: "sha256:dacb9cc30e6e56b6f442d34c2df95743c75ada29c8ef6c313722fba0d676016f",
});
const limits = Object.freeze({ maxEntries: 4_096, maxJsonBytes: 1_048_576, maxResidentBytes: 4_294_967_296 });

function fail(message = "GHCR publication input is invalid") {
  throw Object.assign(new Error(message), { code: "GHCR_PUBLICATION_INPUT_INVALID" });
}

function parseArguments(values) {
  const names = ["candidate", "core-report", "product-report", "targets", "username", "token-file", "operator-id", "run-id", "completed-at", "evidence-output"];
  if (values.length !== names.length * 2) fail("Usage: release:publish -- --candidate <dir> --core-report <file> --product-report <file> --targets <file> --username <name> --token-file <file> --operator-id <id> --run-id <id> --completed-at <UTC> --evidence-output <file>");
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]?.replace(/^--/, "");
    if (!names.includes(name) || result[name] !== undefined) fail();
    result[name] = values[index + 1];
  }
  if (Object.keys(result).sort().join("\0") !== [...names].sort().join("\0")) fail();
  for (const name of ["candidate", "core-report", "product-report", "targets", "token-file", "evidence-output"]) {
    if (!isAbsolute(result[name]) || result[name].includes("\0")) fail();
  }
  return result;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function requirePrivateCandidateRoot(path) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o500) fail();
}

async function appendEvidenceFile(path, bytes) {
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) fail("Publication evidence parent must be mode 0700");
  const handle = await open(path, "wx", 0o600).catch((cause) => {
    if (cause?.code === "EEXIST") throw Object.assign(new Error("Publication evidence already exists"), { code: "PUBLICATION_EVIDENCE_EXISTS" });
    throw cause;
  });
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => undefined);
    throw cause;
  }
  await handle.close();
  await chmod(path, 0o400);
}

async function preflightEvidenceOutput(path) {
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    fail("Publication evidence parent must be mode 0700");
  }
  await lstat(path).then(
    () => { throw Object.assign(new Error("Publication evidence already exists"), { code: "PUBLICATION_EVIDENCE_EXISTS" }); },
    (cause) => { if (cause?.code !== "ENOENT") throw cause; },
  );
}

function isolateProcessEnvironment(environment) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  await preflightEvidenceOutput(args["evidence-output"]);
  await requirePrivateCandidateRoot(args.candidate);
  const releaseRoot = join(args.candidate, "release");
  await requirePrivateCandidateRoot(releaseRoot);
  const [candidateBytes, fixtureBytes, manifestBytes, receiptBytes, coreReportBytes, productReportBytes, targetMapBytes] = await Promise.all([
    readFile(join(args.candidate, "credential-free-mlp-candidate.v1.json")),
    readFile(join(args.candidate, "recorded-product-fixture.v1.json")),
    readFile(join(releaseRoot, "frozen-release-manifest.v1.json")),
    readFile(join(releaseRoot, "frozen-release-receipt.v1.json")),
    readFile(args["core-report"]),
    readFile(args["product-report"]),
    readFile(args.targets),
  ]);
  if (sha256(candidateBytes) !== AUTHORIZED.candidateSha256 || sha256(coreReportBytes) !== AUTHORIZED.coreReportSha256 ||
    sha256(productReportBytes) !== AUTHORIZED.productReportSha256) fail("029A authorization is invalid");
  const candidate = CredentialFreeMlpCandidateV1Schema.parse(JSON.parse(candidateBytes.toString("utf8")));
  const manifest = FrozenOciReleaseManifestV1Schema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const receipt = FrozenOciReleaseReceiptV1Schema.parse(JSON.parse(receiptBytes.toString("utf8")));
  const targetMap = GhcrPublicationTargetsV1Schema.parse(JSON.parse(targetMapBytes.toString("utf8")));
  if (candidateBytes.toString("utf8") !== canonicalSerializeCredentialFreeMlpCandidate(candidate) ||
    manifestBytes.toString("utf8") !== canonicalSerializeFrozenOciReleaseManifest(manifest) ||
    receiptBytes.toString("utf8") !== canonicalSerializeFrozenOciReleaseReceipt(receipt) ||
    targetMapBytes.toString("utf8") !== canonicalSerializeGhcrPublicationTargets(targetMap) ||
    candidate.producer.commitSha !== AUTHORIZED.commitSha || candidate.producer.treeSha !== AUTHORIZED.treeSha) fail();
  verifyCredentialFreeMlpCandidateHandoff({
    candidate,
    expectedProducer: { commitSha: AUTHORIZED.commitSha, treeSha: AUTHORIZED.treeSha },
    manifestBytes,
    receiptBytes,
    receiptArtifactInventorySha256: receipt.artifactInventorySha256,
    fixtureBytes,
  });
  const receiptByName = new Map(receipt.artifacts.map((artifact) => [artifact.filename, artifact]));
  const images = manifest.images.map((image) => {
    const receiptArtifact = receiptByName.get(image.archiveFilename);
    if (!receiptArtifact || receiptArtifact.sizeBytes !== image.archiveSizeBytes || receiptArtifact.sha256 !== image.archiveSha256) fail();
    return Object.freeze({
      id: image.id,
      sourceRepository: image.repository,
      archivePath: join(releaseRoot, image.archiveFilename),
      archiveFilename: image.archiveFilename,
      archiveSizeBytes: image.archiveSizeBytes,
      archiveSha256: image.archiveSha256,
      imageManifestDigest: image.imageManifestDigest,
      platform: image.platform,
    });
  });
  const publicationEnvironment = await createPublicationCredentialEnvironment({
    ambientEnvironment: { PATH: process.env.PATH },
    username: args.username,
    tokenFile: args["token-file"],
    inspectSecretFile: lstat,
  });
  isolateProcessEnvironment(publicationEnvironment);
  const tokenBytes = await readFile(args["token-file"]);
  const registryAdapter = await createGhcrRegistryPublicationAdapter({ username: args.username, tokenBytes });
  try {
    const evidence = await runGhcrPublication({
      images,
      targetMap,
      inspectArchive: (image) => captureFrozenOciArchiveForPublication({
        archivePath: image.archivePath,
        expected: image,
        limits,
        openArchive: open,
        checksumDescriptor: checksumOciArchiveDescriptor,
        inspectDescriptor: inspectCanonicalOciUstarDescriptor,
        readDescriptorRange: readOciDescriptorRange,
        closeDescriptor: (handle) => handle.close(),
      }),
      registryAdapter,
      createEvidence: (remoteResults) => createPublicationEvidence({
        candidate, candidateBytes, manifest, manifestBytes, receipt, receiptBytes,
        targetMap, targetMapBytes,
        verifierReports: { coreReportSha256: AUTHORIZED.coreReportSha256, productReportSha256: AUTHORIZED.productReportSha256 },
        remoteResults,
        publication: { runId: args["run-id"], operatorId: args["operator-id"], completedAt: args["completed-at"] },
      }),
      appendEvidence: async (value) => appendEvidenceFile(
        args["evidence-output"],
        Buffer.from(canonicalSerializePublicationEvidence(value), "utf8"),
      ),
      cleanup: async () => registryAdapter.dispose(),
    });
    process.stdout.write(`${JSON.stringify({ status: "passed", publicationEvidenceSha256: sha256(Buffer.from(canonicalSerializePublicationEvidence(evidence), "utf8")) })}\n`);
  } finally {
    registryAdapter.dispose();
  }
}

await main();
