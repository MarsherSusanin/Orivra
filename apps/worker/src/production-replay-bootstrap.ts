import { constants } from "node:fs";
import { chmod, link, lstat, open, rm } from "node:fs/promises";
import {
  canonicalSerializePreflightReport,
  canonicalizeManifestUrl,
  getProductionRelayerManifest,
  getWeb2JsonTemplateDetail,
  replayProofBundle,
  verifyProductionRelayerReplayAlias,
} from "@proofline/domain";
import {
  PreflightReportV1Schema,
  SafeConsumerDeploymentEvidenceV1Schema,
  canonicalSerializeSafeConsumerDeploymentEvidence,
} from "@proofline/contracts";
import { runWorkerLoop } from "./bootstrap";
import { createProductionReplayBootstrapWorker } from "./production-replay-bootstrap-worker";
import {
  runProductionReplayBootstrap,
  validateAndStageProductionReplayBootstrapArtifacts,
} from "./production-replay-bootstrap-runtime.mjs";

const API_ORIGIN = "http://api:8080";
const PUBLIC_ORIGIN = "https://orivra.xyz";
const OPEN_METEO_REPLAY = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const OPEN_METEO_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const STAGE_ROOT = "/run/proofline/replay-bootstrap-stage";
const DEPLOYMENT_EVIDENCE_PATH = "/run/proofline/evidence/safe-consumer-deployment-evidence.v1.json";
const DEADLINE_MS = 20 * 60_000;
const MAX_DEPLOYMENT_EVIDENCE_BYTES = 64 * 1024;

function productionRunId(environment: NodeJS.ProcessEnv) {
  const value = environment.PROOFLINE_PRODUCTION_RUN_ID;
  if (!/^prod_[0-9A-Z]{26}$/.test(value ?? "")) throw new Error("Production replay bootstrap run id is invalid");
  return value!;
}

async function api(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw Object.assign(new Error("Production replay bootstrap API request failed"), {
    status: response.status,
    code: (value as any)?.error?.code,
  });
  return value as any;
}

async function apiCanonicalBytes(path: string, token: string) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || bytes.length < 1 || bytes.length > 2_200_000) {
    throw new Error("Production replay bootstrap canonical API response is invalid");
  }
  return bytes;
}

async function loadSafeConsumerDeploymentIdentity() {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      DEPLOYMENT_EVIDENCE_PATH,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o400 || stat.size < 1 || stat.size > MAX_DEPLOYMENT_EVIDENCE_BYTES) {
      throw new Error("Safe consumer deployment evidence is invalid");
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error("Safe consumer deployment evidence is truncated");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const evidence = SafeConsumerDeploymentEvidenceV1Schema.parse(JSON.parse(text));
    if (canonicalSerializeSafeConsumerDeploymentEvidence(evidence) !== text) {
      throw new Error("Safe consumer deployment evidence is not canonical");
    }
    const deployment = evidence.deployments.filter((entry) => entry.manifestSha256 === OPEN_METEO_REPLAY);
    if (deployment.length !== 1) throw new Error("Safe consumer deployment identity is missing");
    return Object.freeze({
      generatedSourceSha256: deployment[0].compiledSourceSha256,
      creationBytecodeSha256: deployment[0].bytecodeSha256,
      runtimeCodeSha256: deployment[0].runtimeCodeSha256,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function idempotency(root: string, operation: string) {
  return `bootstrap-${root}-${operation}`;
}

async function stageFile(path: string, bytes: Buffer) {
  const temporary = `${path}.stage-${process.pid}`;
  let staged = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    staged = true;
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await chmod(temporary, 0o400);
    await link(temporary, path);
  } finally {
    if (staged) await rm(temporary, { force: true });
  }
}

async function main(environment: NodeJS.ProcessEnv = process.env) {
  const rootRunId = productionRunId(environment);
  const stageRoot = environment.PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT ?? STAGE_ROOT;
  const stageStatus = await lstat(stageRoot);
  if (!stageStatus.isDirectory() || stageStatus.isSymbolicLink() || (stageStatus.mode & 0o777) !== 0o700) {
    throw new Error("Production replay bootstrap staging root is invalid");
  }
  for (const name of ["proof-bundle.json", "preflight-report.json"]) {
    await lstat(`${stageRoot}/${name}`).then(
      () => { throw new Error("Production replay bootstrap output exists"); },
      (cause) => { if (cause?.code !== "ENOENT") throw cause; },
    );
  }
  const replayDetail = getWeb2JsonTemplateDetail("open-meteo-current-weather");
  const relayerDetail = getProductionRelayerManifest("open-meteo-current-weather");
  if (!replayDetail || replayDetail.template.manifestSha256 !== OPEN_METEO_REPLAY ||
    relayerDetail.manifestSha256 !== OPEN_METEO_RELAYER) throw new Error("Production replay bootstrap manifest is unavailable");
  const runtime = await createProductionReplayBootstrapWorker(environment);
  const deployedConsumerIdentity = await loadSafeConsumerDeploymentIdentity();
  let walletSession: any;
  let submittedRunId = "";
  let projectToken = "";
  try {
    const result = await runProductionReplayBootstrap({
      chainId: 114,
      relayerManifestSha256: OPEN_METEO_RELAYER,
      replayManifestSha256: OPEN_METEO_REPLAY,
      deadlineMs: DEADLINE_MS,
      ports: {
        async authenticateApiSession() {
          const address = runtime.relayerAccount.address;
          const challenge = await api("/v1/auth/wallet/challenges", {
            method: "POST", headers: { origin: PUBLIC_ORIGIN }, body: JSON.stringify({ version: "1", address }),
          });
          const signature = await runtime.relayerAccount.signMessage({ message: String(challenge.message) });
          walletSession = await api("/v1/auth/wallet/sessions", {
            method: "POST", headers: { origin: PUBLIC_ORIGIN },
            body: JSON.stringify({ version: "1", challengeId: challenge.challengeId, signature }),
          });
          return { status: "authenticated" };
        },
        async createApiProject() {
          projectToken = String(walletSession?.projectToken ?? "");
          const projectId = String(walletSession?.project?.projectId ?? "");
          return { status: "created", projectId, projectToken };
        },
        async submitPersistedRun() {
          const created = await api("/v1/runs", {
            method: "POST",
            headers: { "idempotency-key": idempotency(rootRunId, "create") },
            body: JSON.stringify({ manifest: relayerDetail.manifest }),
          }, projectToken);
          submittedRunId = String(created.runId ?? "");
          runtime.activateRun(submittedRunId);
          for (;;) {
            try {
              await api(`/v1/runs/${encodeURIComponent(submittedRunId)}/submissions`, {
                method: "POST",
                headers: { "idempotency-key": idempotency(rootRunId, "submit") },
                body: JSON.stringify({ mode: "relayer" }),
              }, projectToken);
              break;
            } catch (cause: any) {
              if (cause?.code !== "PREFLIGHT_NOT_READY") throw cause;
              await runtime.processOne();
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
          }
          return { runId: submittedRunId };
        },
        async processWorkerCommand() {
          const deadline = Date.now() + DEADLINE_MS;
          let stopping = false;
          let verificationRequested = false;
          const loop = runWorkerLoop({
            processOne: runtime.processOne,
            shouldStop: () => stopping,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            idleDelayMs: 250,
          });
          try {
            while (Date.now() < deadline) {
              const projection = await api(`/v1/runs/${encodeURIComponent(submittedRunId)}`, {}, projectToken);
              if (!verificationRequested && (projection.stages?.verify === "completed" || projection.proofVerified === true)) {
                await api(`/v1/runs/${encodeURIComponent(submittedRunId)}/consumer-verifications`, {
                  method: "POST",
                  headers: { "idempotency-key": idempotency(rootRunId, "verify") },
                  body: JSON.stringify({ consumer: "canonical-safe" }),
                }, projectToken);
                verificationRequested = true;
              }
              if (projection.terminal === true && projection.consumerVerified === true) {
                return { status: "completed", runId: submittedRunId, manifestSha256: OPEN_METEO_RELAYER };
              }
              if (projection.terminal === true) throw new Error("Production replay bootstrap run failed");
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
            throw new Error("Production replay bootstrap deadline exceeded");
          } finally {
            stopping = true;
            await loop;
          }
        },
        async readPersistedRun() {
          const projection = await api(`/v1/runs/${encodeURIComponent(submittedRunId)}`, {}, projectToken);
          return {
            runId: submittedRunId,
            stage: projection.terminal === true && projection.consumerVerified === true ? "completed" : "failed",
            proofVerified:
              projection.proofVerified === true ||
              projection.stages?.verify === "completed",
            manifestSha256: OPEN_METEO_RELAYER,
            request: relayerDetail.manifest.request,
            consumer: relayerDetail.manifest.consumer,
          };
        },
        async exportPersistedBundle() {
          const bytes = await apiCanonicalBytes(`/v1/runs/${encodeURIComponent(submittedRunId)}/bundle`, projectToken);
          return { runId: submittedRunId, manifestSha256: OPEN_METEO_RELAYER, bytes };
        },
        async exportPersistedPreflightReport() {
          const value = PreflightReportV1Schema.parse(await api(`/v1/runs/${encodeURIComponent(submittedRunId)}/preflight`, {}, projectToken));
          return { runId: submittedRunId, manifestSha256: OPEN_METEO_RELAYER, bytes: Buffer.from(canonicalSerializePreflightReport(value), "utf8") };
        },
        async verifyRelayerReplayAlias({ sourceRun, bundleBytes, reportBytes }: any) {
          const validated = await validateAndStageProductionReplayBootstrapArtifacts({
            sourceRun,
            relayerManifest: relayerDetail.manifest,
            relayerManifestSha256: OPEN_METEO_RELAYER,
            replayManifest: replayDetail.manifest,
            replayManifestSha256: OPEN_METEO_REPLAY,
            consumerIdentity: deployedConsumerIdentity,
            bundleBytes,
            reportBytes,
            parseBundle: (bytes: Buffer) => replayProofBundle(bytes.toString("utf8")),
            parseReport: (bytes: Buffer) => PreflightReportV1Schema.parse(JSON.parse(bytes.toString("utf8"))),
            verifyAlias: verifyProductionRelayerReplayAlias,
            stageCanonicalPair: async ({ bundleBytes: exactBundle, reportBytes: exactReport }: any) => {
              await stageFile(`${stageRoot}/proof-bundle.json`, exactBundle);
              try { await stageFile(`${stageRoot}/preflight-report.json`, exactReport); }
              catch (cause) { await rm(`${stageRoot}/proof-bundle.json`, { force: true }); throw cause; }
              return { status: "staged" };
            },
          });
          const bundle = replayProofBundle(validated.bundleBytes.toString("utf8"));
          const report = PreflightReportV1Schema.parse(JSON.parse(validated.reportBytes.toString("utf8")));
          if (report.runId !== bundle.runId || report.canonicalUrl !== canonicalizeManifestUrl(bundle.manifest)) {
            throw new Error("Production replay bootstrap evidence is not cross-bound");
          }
          return { runId: bundle.runId, replayManifestSha256: OPEN_METEO_REPLAY,
            bundleBytes: validated.bundleBytes, reportBytes: validated.reportBytes, staged: true };
        },
        async stageCanonicalPair({ bundleBytes, reportBytes }: { bundleBytes: Buffer; reportBytes: Buffer }) {
          await stageFile(`${stageRoot}/proof-bundle.json`, bundleBytes);
          try { await stageFile(`${stageRoot}/preflight-report.json`, reportBytes); }
          catch (cause) { await rm(`${stageRoot}/proof-bundle.json`, { force: true }); throw cause; }
          return { status: "staged" };
        },
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await runtime.close();
  }
}

await main();
