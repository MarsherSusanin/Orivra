const REPLAY_BOOTSTRAP_STAGE_ROOT = "/opt/orivra/replay-bootstrap-stage";

function failure(cause) {
  return Object.assign(new Error("TIMEWEB_HOST_REPLAY_STAGE_INVALID: Replay-bootstrap Compose authority is invalid"), {
    code: "TIMEWEB_HOST_REPLAY_STAGE_INVALID",
    cause,
  });
}

function requireEnvironment(runtimeEnvironment) {
  if (!runtimeEnvironment || typeof runtimeEnvironment !== "object" || Array.isArray(runtimeEnvironment) ||
    Object.hasOwn(runtimeEnvironment, "PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT")) {
    throw new Error("replay stage authority");
  }
  return runtimeEnvironment;
}

export function bindFixedReplayBootstrapComposeInterpolationEnvironment(runtimeEnvironment) {
  try {
    requireEnvironment(runtimeEnvironment);
    return Object.freeze({
      ...runtimeEnvironment,
      PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT: REPLAY_BOOTSTRAP_STAGE_ROOT,
    });
  } catch (cause) {
    throw failure(cause);
  }
}

export function bindOwnedReplayBootstrapComposeEnvironment({
  runtimeEnvironment,
  stageRoot,
  createHostPath,
} = {}) {
  try {
    if (stageRoot !== REPLAY_BOOTSTRAP_STAGE_ROOT || createHostPath !== false) {
      throw new Error("replay stage authority");
    }
    return bindFixedReplayBootstrapComposeInterpolationEnvironment(runtimeEnvironment);
  } catch (cause) {
    if (cause?.code === "TIMEWEB_HOST_REPLAY_STAGE_INVALID") throw cause;
    throw failure(cause);
  }
}

export { REPLAY_BOOTSTRAP_STAGE_ROOT };
