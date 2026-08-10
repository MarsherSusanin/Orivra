import { spawn } from "node:child_process";

const CHILD_TIMEOUT_CODE = "RECOVERY_CHILD_TIMEOUT";
const CHILD_TIMEOUT_MESSAGE = "Recovery child process timed out";
const CHILD_INVALID_CODE = "RECOVERY_CHILD_INVALID";
const CHILD_INVALID_MESSAGE = "Recovery child process configuration is invalid";

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function validString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function killProcessTree(child, signal) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try { child.kill(signal); } catch {}
    }
  }
}

function isProcessGroupAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export async function runBoundedRecoveryChild({
  executable,
  args = [],
  cwd,
  environment,
  timeoutMs,
  killGraceMs,
  maximumOutputBytes,
  signal,
  input,
} = {}) {
  if (
    !validString(executable) ||
    !Array.isArray(args) ||
    args.some((value) => typeof value !== "string" || value.includes("\0")) ||
    !validString(cwd) ||
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    !Number.isSafeInteger(killGraceMs) || killGraceMs < 1 ||
    !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 ||
    !(signal instanceof AbortSignal) || signal.aborted ||
    (input !== undefined && !Buffer.isBuffer(input) && typeof input !== "string")
  ) {
    throw fail(CHILD_INVALID_CODE, CHILD_INVALID_MESSAGE);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      env: { ...environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let terminationReason;
    let settled = false;
    let childClosed = false;
    let killTimer;
    let reapTimer;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    }

    function finishTerminationAfterReap() {
      if (!terminationReason || !childClosed) return;
      if (isProcessGroupAlive(child.pid)) {
        reapTimer = setTimeout(finishTerminationAfterReap, 5);
        return;
      }
      finish(terminationReason);
    }

    function terminate(reason) {
      if (terminationReason) return;
      terminationReason = reason;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
        finishTerminationAfterReap();
      }, killGraceMs);
    }

    function append(target, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        terminate(fail(CHILD_INVALID_CODE, CHILD_INVALID_MESSAGE));
        return;
      }
      target.push(chunk);
    }

    const timeout = setTimeout(() => {
      terminate(fail(CHILD_TIMEOUT_CODE, CHILD_TIMEOUT_MESSAGE));
    }, timeoutMs);
    function onAbort() {
      terminate(fail(CHILD_TIMEOUT_CODE, CHILD_TIMEOUT_MESSAGE));
    }
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (exitCode, exitSignal) => {
      childClosed = true;
      if (terminationReason) {
        finishTerminationAfterReap();
        return;
      }
      finish(undefined, {
        exitCode,
        signal: exitSignal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut: false,
      });
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}
