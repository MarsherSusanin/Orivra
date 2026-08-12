import { constants } from "node:fs";
import { open } from "node:fs/promises";

export type DeploymentProfile =
  | "api"
  | "worker"
  | "recording-importer"
  | "db-role-bootstrap"
  | "migration-runner"
  | "backup";
export type DeploymentEnvironment = Record<string, string | undefined>;

const REQUIRED_SECRETS = {
  api: ["DATABASE_URL", "PROOFLINE_TOKEN_DIGEST_KEY"],
  worker: [
    "DATABASE_URL",
    "PROOFLINE_VERIFIER_API_KEY",
    "PROOFLINE_COSTON2_PRIVATE_KEY",
  ],
  "recording-importer": ["DATABASE_URL"],
  "db-role-bootstrap": [
    "DATABASE_URL",
    "PROOFLINE_MIGRATOR_DATABASE_URL",
    "PROOFLINE_API_DATABASE_URL",
    "PROOFLINE_WORKER_DATABASE_URL",
    "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL",
  ],
  "migration-runner": ["DATABASE_URL"],
  backup: ["PROOFLINE_BACKUP_DATABASE_URL"],
} as const satisfies Record<DeploymentProfile, readonly string[]>;

const OPTIONAL_SECRETS: Partial<Record<DeploymentProfile, readonly string[]>> = {
  "db-role-bootstrap": ["PROOFLINE_BACKUP_DATABASE_URL"],
};

const ERROR_CODE = "DEPLOYMENT_SECRET_CONFIGURATION_INVALID";
const ERROR_MESSAGE = "Deployment secret configuration is invalid";
const MAX_SECRET_FILE_BYTES = 4_096;

class DeploymentSecretConfigurationError extends Error {
  readonly code = ERROR_CODE;

  constructor() {
    super(ERROR_MESSAGE);
    this.name = "DeploymentSecretConfigurationError";
  }
}

function invalidConfiguration(): never {
  throw new DeploymentSecretConfigurationError();
}

function isDeploymentFileVariable(name: string): boolean {
  if (name === "PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE") return false;
  return (
    (name.startsWith("DATABASE_URL") && name.endsWith("_FILE")) ||
    (name.startsWith("PROOFLINE_") && name.endsWith("_FILE"))
  );
}

async function readSecretFile(path: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SECRET_FILE_BYTES) {
      invalidConfiguration();
    }

    const bytes = Buffer.alloc(MAX_SECRET_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const result = await handle.read(
        bytes,
        length,
        bytes.byteLength - length,
        null,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length === 0 || length > MAX_SECRET_FILE_BYTES) {
      invalidConfiguration();
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    if (decoded.includes("\0")) invalidConfiguration();
    const value = decoded.trim();
    if (!value) invalidConfiguration();
    return value;
  } catch (cause) {
    if (cause instanceof DeploymentSecretConfigurationError) throw cause;
    invalidConfiguration();
  } finally {
    await handle?.close().catch(() => undefined);
  }
  invalidConfiguration();
}

export async function resolveDeploymentEnvironment(
  profile: DeploymentProfile,
  environment: DeploymentEnvironment,
): Promise<DeploymentEnvironment> {
  if (!Object.hasOwn(REQUIRED_SECRETS, profile)) invalidConfiguration();
  const requiredSecrets = REQUIRED_SECRETS[profile];
  const optionalSecrets = OPTIONAL_SECRETS[profile] ?? [];
  const allowedFileVariables = new Set(
    [...requiredSecrets, ...optionalSecrets].map((name) => `${name}_FILE`),
  );
  for (const name of Object.keys(environment)) {
    if (isDeploymentFileVariable(name) && !allowedFileVariables.has(name)) {
      invalidConfiguration();
    }
  }

  const resolved: DeploymentEnvironment = { ...environment };
  for (const name of Object.keys(resolved)) {
    if (isDeploymentFileVariable(name)) delete resolved[name];
  }
  for (const name of requiredSecrets) {
    const direct = environment[name];
    const file = environment[`${name}_FILE`];
    if ((direct === undefined) === (file === undefined)) {
      invalidConfiguration();
    }
    if (file !== undefined) {
      if (!file.trim()) invalidConfiguration();
      resolved[name] = await readSecretFile(file);
      continue;
    }
    const value = direct!.trim();
    if (!value) invalidConfiguration();
    resolved[name] = value;
  }
  for (const name of optionalSecrets) {
    const direct = environment[name];
    const file = environment[`${name}_FILE`];
    if (direct !== undefined && file !== undefined) invalidConfiguration();
    if (file !== undefined) {
      if (!file.trim()) invalidConfiguration();
      resolved[name] = await readSecretFile(file);
    } else if (direct !== undefined) {
      const value = direct.trim();
      if (!value) invalidConfiguration();
      resolved[name] = value;
    }
  }
  return resolved;
}
