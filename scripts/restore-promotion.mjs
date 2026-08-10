import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  RestoreDrillEvidenceV1Schema,
  RestorePromotionAuthorizationV1Schema,
  canonicalSerializeRestoreDrillEvidence,
} from "../packages/contracts/src/recovery-runtime.mjs";

const ERROR_CODE = "RESTORE_PROMOTION_FORBIDDEN";
const ERROR_MESSAGE = "Restore promotion is forbidden";
const MISMATCH_CODE = "RESTORE_PROMOTION_EVIDENCE_MISMATCH";
const MISMATCH_MESSAGE = "Restore promotion evidence does not match";

function forbidden() {
  throw Object.assign(new Error(ERROR_MESSAGE), { code: ERROR_CODE });
}

function evidenceMismatch() {
  throw Object.assign(new Error(MISMATCH_MESSAGE), { code: MISMATCH_CODE });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function authorizeRestorePromotion({
  restoreEvidencePath,
  authorizationPath,
  currentTime = new Date(),
  run = spawnSync,
} = {}) {
  try {
    const restore = RestoreDrillEvidenceV1Schema.parse(
      JSON.parse(await readFile(restoreEvidencePath, "utf8")),
    );
    const canonicalRestore = canonicalSerializeRestoreDrillEvidence(restore);
    const restoreDrillEvidenceSha256 = sha256(canonicalRestore);
    const authorization = RestorePromotionAuthorizationV1Schema.parse(
      JSON.parse(await readFile(authorizationPath, "utf8")),
    );
    if (authorization.restoreDrillEvidenceSha256 !== restoreDrillEvidenceSha256) {
      evidenceMismatch();
    }
    if (
      Date.parse(authorization.authorizedAt.slice(0, -4) + "Z") > currentTime.getTime() ||
      Date.parse(authorization.expiresAt.slice(0, -4) + "Z") <= currentTime.getTime()
    ) {
      forbidden();
    }
    const result = run("psql", [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      "SELECT CASE WHEN pg_is_in_recovery() THEN pg_promote(true, 60) ELSE false END",
    ], { encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0 || result.stdout.trim() !== "t") forbidden();
  } catch (cause) {
    if (cause?.code === ERROR_CODE || cause?.code === MISMATCH_CODE) throw cause;
    forbidden();
  }
}
