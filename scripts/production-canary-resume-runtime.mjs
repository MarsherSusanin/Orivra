import { createHash } from "node:crypto";
import {
  ProductionCanaryCheckpointV2Schema,
  ProductionDeploymentEvidenceV2Schema,
  ProductionPromotionEvidenceV2Schema,
  canonicalSerializeProductionCanaryCheckpointV2,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeProductionPromotionEvidenceV2,
} from "../packages/contracts/src/production-promotion-runtime.mjs";

const definitions = Object.freeze([
  ["cutover", 0],
  ["post-cutover-15m", 900],
  ["post-cutover-1h", 3600],
  ["post-cutover-24h", 86400],
]);
const ROOT = "/var/lib/orivra/production-canary";

function failure(code, message, cause) {
  return Object.assign(new Error(message), { code, cause });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function dueAt(cutover, seconds) {
  return new Date(Date.parse(cutover) + seconds * 1000).toISOString().replace(".000Z", "Z");
}

function parseDeployment(bytes, expectedSha256) {
  try {
    if (!(bytes instanceof Uint8Array) || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256 ?? "") ||
      sha256(bytes) !== expectedSha256) throw new Error("deployment digest");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const deployment = ProductionDeploymentEvidenceV2Schema.parse(JSON.parse(text));
    if (text !== canonicalSerializeProductionDeploymentEvidenceV2(deployment)) throw new Error("deployment canonical bytes");
    return deployment;
  } catch (cause) {
    throw failure("PRODUCTION_DEPLOYMENT_EVIDENCE_INVALID", "Production deployment evidence is invalid", cause);
  }
}

function validateState(state, deployment) {
  try {
    if (!Array.isArray(state) || state.length < 1 || state.length > definitions.length) throw new Error("state length");
    const parsed = state.map((entry) => ProductionCanaryCheckpointV2Schema.parse(entry));
    const cutover = parsed[0].dueAt;
    if (parsed[0].id !== "cutover" || deployment.cutover.activatedAt !== cutover ||
      Date.parse(parsed[0].observedAt) < Date.parse(cutover) ||
      deployment.cutover.publicOrigin !== deployment.target.publicOrigin) {
      throw new Error("cutover binding");
    }
    for (let index = 0; index < parsed.length; index += 1) {
      const entry = parsed[index];
      if (entry.id !== definitions[index][0] || entry.dueAt !== dueAt(cutover, definitions[index][1])) throw new Error("checkpoint order");
    }
    return parsed;
  } catch (cause) {
    throw failure("CANARY_STATE_INVALID", "Production canary state is invalid", cause);
  }
}

function requireAppend(result, expectedSha256, code, message) {
  if (!result || result.status !== "passed" || result.sha256 !== expectedSha256) throw failure(code, message);
}

export async function runProductionCanarySystemdTick(input) {
  if (Object.hasOwn(input ?? {}, "callerNow")) throw failure("CANARY_CLOCK_INVALID", "Production canary requires the host clock");
  if (input.stateRoot !== ROOT) throw failure("CANARY_STATE_INVALID", "Production canary state root is invalid");
  const deployment = parseDeployment(input.deploymentEvidenceBytes, input.expectedDeploymentEvidenceSha256);
  const now = input.clock?.now?.();
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw failure("CANARY_CLOCK_INVALID", "Production canary requires the host clock");
  const state = validateState(await input.loadCanonicalState(), deployment);
  const cutover = state[0].dueAt;
  const lastObserved = Date.parse(state.at(-1).observedAt);
  if (nowMs < lastObserved) throw failure("CANARY_CLOCK_SKEW", "Production host clock moved backwards");
  const next = definitions[state.length];
  if (!next) return Object.freeze({ status: "complete" });
  const expectedDueAt = dueAt(cutover, next[1]);
  if (nowMs < Date.parse(expectedDueAt)) return Object.freeze({ status: "not-due", checkpointId: next[0], dueAt: expectedDueAt });
  const stagePath = `${ROOT}/.checkpoint-stage.${next[0]}`;
  try {
    let observation;
    try { observation = ProductionCanaryCheckpointV2Schema.parse(await input.observe({ id: next[0], dueAt: expectedDueAt })); }
    catch (cause) { throw failure("CANARY_CLOCK_SKEW", "Production host clock synchronization is invalid", cause); }
    if (observation.id !== next[0] || observation.dueAt !== expectedDueAt || observation.observedAt !== now) {
      throw failure("CANARY_OBSERVATION_INVALID", "Production canary observation is invalid");
    }
    const bytes = Buffer.from(canonicalSerializeProductionCanaryCheckpointV2(observation), "utf8");
    const checkpointSha256 = sha256(bytes);
    const entry = Object.freeze({
      ...observation,
      path: `${ROOT}/checkpoints/${String(state.length).padStart(2, "0")}-${next[0]}.json`,
      mode: 0o400,
      noReplace: true,
      sha256: checkpointSha256,
      bytes,
    });
    let checkpointResult;
    try {
      checkpointResult = await input.appendCheckpoint(entry);
      requireAppend(checkpointResult, checkpointSha256, "CANARY_CHECKPOINT_WRITE_FAILED", "Production canary checkpoint write failed");
    } catch (cause) {
      if (cause?.code === "CANARY_CHECKPOINT_WRITE_FAILED") throw cause;
      throw failure("CANARY_CHECKPOINT_WRITE_FAILED", "CANARY_CHECKPOINT_WRITE_FAILED: Production canary checkpoint write failed", cause);
    }
    if (next[0] === "post-cutover-24h") {
      if (nowMs - Date.parse(cutover) < 86_400_000) throw failure("CANARY_CLOCK_INVALID", "Production canary cannot complete early");
      const promotion = ProductionPromotionEvidenceV2Schema.parse({
        version: "2", kind: "digitalocean-production-promotion-evidence", status: "passed", verification: "verified", promotionClaim: true,
        producer: deployment.producer, publicationEvidenceSha256: deployment.publicationEvidenceSha256,
        productionDeploymentEvidenceSha256: input.expectedDeploymentEvidenceSha256,
        runId: deployment.run.runId, operatorId: deployment.run.operatorId, cutover: deployment.cutover,
        canary: { durationSeconds: 86400, checkpoints: [...state, observation] }, completedAt: now,
      });
      const promotionBytes = Buffer.from(canonicalSerializeProductionPromotionEvidenceV2(promotion), "utf8");
      const promotionSha256 = sha256(promotionBytes);
      const promotionResult = await input.appendPromotionEvidence({
        path: `${ROOT}/production-promotion-evidence.v2.json`, bytes: promotionBytes,
        sha256: promotionSha256, mode: 0o400, noReplace: true,
      });
      requireAppend(promotionResult, promotionSha256, "CANARY_PROMOTION_EVIDENCE_INVALID", "Production promotion evidence is invalid");
    }
    return Object.freeze({ status: next[0] === "post-cutover-24h" ? "checkpoint-complete" : "canary-pending", checkpointId: next[0] });
  } catch (cause) {
    await input.cleanupStage?.(stagePath).catch(() => undefined);
    throw cause;
  }
}
