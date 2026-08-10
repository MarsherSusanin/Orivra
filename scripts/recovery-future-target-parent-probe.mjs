const FUTURE_TARGET_CASE_ID = "future-recovery-target";
const FUTURE_TARGET_SERVICE = "pitr-postgres";
const FUTURE_TARGET_TERMINAL_SIGNATURE =
  "recovery ended before configured recovery target was reached";

function exactString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function validIdentity(identity) {
  return identity !== null &&
    typeof identity === "object" &&
    !Array.isArray(identity) &&
    identity.caseId === FUTURE_TARGET_CASE_ID &&
    exactString(identity.projectName) &&
    identity.serviceName === FUTURE_TARGET_SERVICE &&
    identity.containerName === `${identity.projectName}-${identity.serviceName}`;
}

function parseContainerState(result) {
  if (
    result?.exitCode !== 0 ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  ) {
    return undefined;
  }
  try {
    const state = JSON.parse(result.stdout.trim());
    if (state === null || typeof state !== "object" || Array.isArray(state)) {
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

export async function observeFutureTargetParentTerminalFailure({
  identity,
  signal,
  runDocker,
} = {}) {
  if (
    !validIdentity(identity) ||
    !(signal instanceof AbortSignal) ||
    signal.aborted ||
    typeof runDocker !== "function"
  ) {
    return false;
  }

  const stateResult = await runDocker([
    "inspect",
    "--format",
    "{{json .State}}",
    identity.containerName,
  ], signal);
  const logsResult = await runDocker([
    "logs",
    identity.containerName,
  ], signal);
  const state = parseContainerState(stateResult);
  const logsAvailable = logsResult?.exitCode === 0 &&
    typeof logsResult.stdout === "string" &&
    typeof logsResult.stderr === "string";

  return state?.Status === "exited" &&
    Number.isSafeInteger(state.ExitCode) &&
    state.ExitCode > 0 &&
    logsAvailable &&
    `${logsResult.stdout}${logsResult.stderr}`.includes(
      FUTURE_TARGET_TERMINAL_SIGNATURE,
    );
}
