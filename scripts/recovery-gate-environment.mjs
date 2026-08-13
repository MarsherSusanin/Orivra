const ENVIRONMENT_ERROR_CODE = "RECOVERY_GATE_ENV_INVALID";
const ENVIRONMENT_ERROR_MESSAGE = "Recovery gate environment is invalid";

export const RECOVERY_GATE_SCOPED_ENV_NAMES = Object.freeze([
  "PROOFLINE_CADDY_IMAGE",
  "PROOFLINE_WEB_IMAGE",
  "PROOFLINE_API_IMAGE",
  "PROOFLINE_WORKER_IMAGE",
  "PROOFLINE_POSTGRES_IMAGE",
  "PROOFLINE_MINIO_IMAGE",
  "PROOFLINE_MINIO_CLIENT_IMAGE",
  "PROOFLINE_PUBLIC_ORIGIN",
  "PROOFLINE_DEPLOYMENT_ID",
  "PROOFLINE_RELEASE_TREE_SHA",
  "PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI",
  "PROOFLINE_RELAYER_BALANCE_FLOOR_WEI",
  "PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA",
  "PROOFLINE_SAFE_CONSUMER_EVIDENCE_ROOT",
  "PROOFLINE_SAFE_CONSUMER_WORKER_HANDOFF_FILE",
  "PROOFLINE_REPLAY_BOOTSTRAP_STAGE_ROOT",
  "PROOFLINE_POSTGRES_ADMIN_DATABASE_URL_FILE",
  "PROOFLINE_MIGRATOR_DATABASE_URL_FILE",
  "PROOFLINE_API_DATABASE_URL_FILE",
  "PROOFLINE_API_TOKEN_DIGEST_KEY_FILE",
  "PROOFLINE_WORKER_DATABASE_URL_FILE",
  "PROOFLINE_WORKER_REPLAY_BUNDLE_FILE",
  "PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE",
  "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE",
  "PROOFLINE_POSTGRES_PASSWORD_FILE",
  "PROOFLINE_BACKUP_DATABASE_URL_FILE",
  "PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
  "PROOFLINE_BACKUP_EVIDENCE_FILE",
  "PROOFLINE_BACKUP_EVIDENCE_SHA256",
  "PROOFLINE_MINIO_ROOT_USER_FILE",
  "PROOFLINE_MINIO_ROOT_PASSWORD_FILE",
  "PROOFLINE_BACKUP_SLOT",
  "PROOFLINE_BACKUP_ENDPOINT",
  "PROOFLINE_BACKUP_REGION",
  "PROOFLINE_BACKUP_BUCKET",
  "PROOFLINE_RESTORE_BACKUP_ID",
  "PROOFLINE_RESTORE_BACKUP_EVIDENCE_SHA256",
  "PROOFLINE_RECOVERY_TARGET_TIME",
  "PROOFLINE_RECOVERY_TARGET_TIMELINE",
  "PROOFLINE_BACKUP_SYSTEM_IDENTIFIER",
]);

export const RECOVERY_NEGATIVE_CHILD_ENV_NAMES = Object.freeze([
  "PROOFLINE_POSTGRES_IMAGE",
  "PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE",
  "PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE",
  "PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE",
]);

const scopedNames = new Set(RECOVERY_GATE_SCOPED_ENV_NAMES);
const FORBIDDEN_DOCKER_AUTHORITY_NAMES = Object.freeze([
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
  "DOCKER_AUTH_CONFIG",
  "REGISTRY_AUTH_FILE",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "BUILDKIT_HOST",
  "BUILDX_CONFIG",
]);
const FORBIDDEN_DIRECT_AUTHORITY_NAMES = Object.freeze([
  ...FORBIDDEN_DOCKER_AUTHORITY_NAMES,
  "dockerHost",
  "dockerContext",
  "dockerTlsVerify",
  "dockerCertPath",
  "dockerConfig",
  "dockerAuthConfig",
  "registryAuthFile",
  "sshAuthSock",
  "sshAgentPid",
  "buildkitHost",
  "buildxConfig",
]);

function failEnvironment() {
  throw Object.assign(new Error(ENVIRONMENT_ERROR_MESSAGE), {
    code: ENVIRONMENT_ERROR_CODE,
  });
}

function exactString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function frozenCopy(value) {
  return Object.freeze(Object.fromEntries(Object.entries(value)));
}

function executionBase({
  ambientEnvironment,
  dockerConfigDirectory,
  homeDirectory,
  xdgConfigDirectory,
  temporaryDirectory,
}) {
  const base = {
    PATH: ambientEnvironment?.PATH,
    DOCKER_CONFIG: dockerConfigDirectory,
    HOME: homeDirectory,
    XDG_CONFIG_HOME: xdgConfigDirectory,
    TMPDIR: temporaryDirectory,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (Object.values(base).some((value) => !exactString(value))) failEnvironment();
  return base;
}

export function createCredentialFreeRecoveryEnvironments(input = {}) {
  const scopedEnvironment = input.scopedEnvironment;
  if (
    FORBIDDEN_DIRECT_AUTHORITY_NAMES.some((name) => Object.hasOwn(input, name)) ||
    FORBIDDEN_DOCKER_AUTHORITY_NAMES.some((name) =>
      Object.hasOwn(input.ambientEnvironment ?? {}, name)) ||
    scopedEnvironment === null ||
    typeof scopedEnvironment !== "object" ||
    Array.isArray(scopedEnvironment)
  ) {
    failEnvironment();
  }
  const names = Object.keys(scopedEnvironment);
  if (
    names.length !== RECOVERY_GATE_SCOPED_ENV_NAMES.length ||
    names.some((name) => !scopedNames.has(name)) ||
    RECOVERY_GATE_SCOPED_ENV_NAMES.some((name) =>
      !Object.hasOwn(scopedEnvironment, name) || !exactString(scopedEnvironment[name]))
  ) {
    failEnvironment();
  }
  const base = executionBase(input);
  const docker = frozenCopy({ ...base, ...scopedEnvironment });
  const negativeChild = frozenCopy({
    ...base,
    ...Object.fromEntries(RECOVERY_NEGATIVE_CHILD_ENV_NAMES.map((name) => [
      name,
      scopedEnvironment[name],
    ])),
  });
  return Object.freeze({ docker, negativeChild });
}

export function selectCredentialFreeNegativeChildEnvironment(environment = {}) {
  const baseNames = Object.freeze([
    "PATH", "DOCKER_CONFIG", "HOME", "XDG_CONFIG_HOME",
    "TMPDIR", "LANG", "LC_ALL", "TZ",
  ]);
  const names = [...baseNames, ...RECOVERY_NEGATIVE_CHILD_ENV_NAMES];
  if (names.some((name) => !exactString(environment[name]))) failEnvironment();
  return frozenCopy(Object.fromEntries(names.map((name) => [name, environment[name]])));
}
