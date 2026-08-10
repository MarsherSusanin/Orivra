const PROJECT_FINALIZER_TIMEOUT_CODE = "RECOVERY_PROJECT_FINALIZER_TIMEOUT";
const PROJECT_FINALIZER_TIMEOUT_MESSAGE = "Recovery project finalizer timed out";

function exactString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function timeoutFailure() {
  return Object.assign(new Error(PROJECT_FINALIZER_TIMEOUT_MESSAGE), {
    code: PROJECT_FINALIZER_TIMEOUT_CODE,
  });
}

async function rmTemporaryDirectory(path) {
  await rm(path, { recursive: true, force: true });
}

export async function finalizeRecoveryGate({
  temporaryDirectory,
  finalizerTimeoutMs,
  finalizeProject,
  removeTemporaryDirectory = rmTemporaryDirectory,
} = {}) {
  if (
    !exactString(temporaryDirectory) ||
    !Number.isSafeInteger(finalizerTimeoutMs) ||
    finalizerTimeoutMs < 1 ||
    typeof finalizeProject !== "function" ||
    typeof removeTemporaryDirectory !== "function"
  ) {
    throw new TypeError("A recovery gate finalizer configuration is required");
  }

  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(timeoutFailure());
      controller.abort();
    }, finalizerTimeoutMs);
  });
  try {
    await Promise.race([
      Promise.resolve().then(() => finalizeProject(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    await removeTemporaryDirectory(temporaryDirectory);
  }
}
import { rm } from "node:fs/promises";
