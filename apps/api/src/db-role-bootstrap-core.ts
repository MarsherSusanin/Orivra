import { Pool } from "pg";
import {
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from "./deployment-secrets";

const ROLE_BOOTSTRAP_ERROR_CODE = "DEPLOYMENT_ROLE_BOOTSTRAP_FAILED";
const ROLE_BOOTSTRAP_ERROR_MESSAGE = "Database role bootstrap failed";

const DEPLOYMENT_DATABASE_ROLES = [
  {
    environmentName: "PROOFLINE_MIGRATOR_DATABASE_URL",
    username: "proofline_migrator_login",
    createRole: true,
    replication: false,
  },
  {
    environmentName: "PROOFLINE_API_DATABASE_URL",
    username: "proofline_api_login",
    createRole: false,
    replication: false,
  },
  {
    environmentName: "PROOFLINE_WORKER_DATABASE_URL",
    username: "proofline_worker_login",
    createRole: false,
    replication: false,
  },
  {
    environmentName: "PROOFLINE_RECORDING_IMPORTER_DATABASE_URL",
    username: "proofline_recording_importer_login",
    createRole: false,
    replication: false,
  },
  {
    environmentName: "PROOFLINE_BACKUP_DATABASE_URL",
    username: "proofline_backup_login",
    createRole: false,
    replication: true,
  },
] as const;

type QueryResult = {
  rowCount: number | null;
  rows: readonly Record<string, unknown>[];
};

type RoleBootstrapClient = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
};

export class DeploymentRoleBootstrapError extends Error {
  readonly code = ROLE_BOOTSTRAP_ERROR_CODE;

  constructor() {
    super(ROLE_BOOTSTRAP_ERROR_MESSAGE);
    this.name = "DeploymentRoleBootstrapError";
  }
}

class DeploymentDatabaseUrlConfigurationError extends Error {
  readonly code = "DEPLOYMENT_SECRET_CONFIGURATION_INVALID";

  constructor() {
    super("Deployment secret configuration is invalid");
    this.name = "DeploymentDatabaseUrlConfigurationError";
  }
}

function bootstrapFailed(): never {
  throw new DeploymentRoleBootstrapError();
}

function invalidDatabaseUrl(): never {
  throw new DeploymentDatabaseUrlConfigurationError();
}

function parseExactDatabaseUrl(value: string, expectedUsername: string) {
  try {
    const parsed = new URL(value);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (
      parsed.protocol !== "postgres:" ||
      parsed.hostname !== "postgres" ||
      parsed.port !== "5432" ||
      parsed.pathname !== "/proofline" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      username !== expectedUsername ||
      password.length === 0
    ) {
      invalidDatabaseUrl();
    }
    return { username, password };
  } catch (cause) {
    if (cause instanceof DeploymentDatabaseUrlConfigurationError) throw cause;
    invalidDatabaseUrl();
  }
}

export async function grantApplicationRoleMemberships(input: {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}): Promise<void> {
  await input.query(`
GRANT proofline_api TO proofline_api_login;
GRANT proofline_worker TO proofline_worker_login;
GRANT proofline_recording_importer TO proofline_recording_importer_login;
GRANT INSERT ON TABLE proofline_private.run_commands TO proofline_api;
`);
}

export async function bootstrapProductionDatabaseRoles(input: {
  environment?: DeploymentEnvironment;
  connect(connectionString: string): Promise<RoleBootstrapClient>;
}): Promise<void> {
  const environment = await resolveDeploymentEnvironment(
    "db-role-bootstrap",
    input.environment ?? process.env,
  );
  const adminUrl = environment.DATABASE_URL!;
  parseExactDatabaseUrl(adminUrl, "proofline");
  const deploymentRoles = DEPLOYMENT_DATABASE_ROLES
    .filter((role) => environment[role.environmentName] !== undefined)
    .map((role) => ({
      ...role,
      ...parseExactDatabaseUrl(environment[role.environmentName]!, role.username),
    }));
  const backupConfigured = deploymentRoles.some(
    ({ username }) => username === "proofline_backup_login",
  );

  let client: RoleBootstrapClient | undefined;
  try {
    client = await input.connect(adminUrl);
    await client.query("BEGIN");
    await client.query(`
CREATE OR REPLACE FUNCTION pg_temp.ensure_login(
    login_name text,
    login_password text,
    allow_createrole boolean,
    allow_replication boolean
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login_name) THEN
        EXECUTE format(
            'ALTER ROLE %I WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB %s %s NOBYPASSRLS PASSWORD %L',
            login_name,
            CASE WHEN allow_createrole THEN 'CREATEROLE' ELSE 'NOCREATEROLE' END,
            CASE WHEN allow_replication THEN 'REPLICATION' ELSE 'NOREPLICATION' END,
            login_password
        );
    ELSE
        EXECUTE format(
            'CREATE ROLE %I WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB %s %s NOBYPASSRLS PASSWORD %L',
            login_name,
            CASE WHEN allow_createrole THEN 'CREATEROLE' ELSE 'NOCREATEROLE' END,
            CASE WHEN allow_replication THEN 'REPLICATION' ELSE 'NOREPLICATION' END,
            login_password
        );
    END IF;
END
$function$;
`);
    for (const role of deploymentRoles) {
      await client.query(
        "SELECT pg_temp.ensure_login($1, $2, $3, $4)",
        [role.username, role.password, role.createRole, role.replication],
      );
    }
    await client.query("ALTER ROLE proofline_migrator_login CREATEROLE");
    await client.query("REVOKE CONNECT, CREATE ON DATABASE proofline FROM PUBLIC");
    await client.query(
      "GRANT CONNECT, CREATE ON DATABASE proofline TO proofline_migrator_login",
    );
    await client.query(`
GRANT CONNECT ON DATABASE proofline TO
    proofline_api_login,
    proofline_worker_login,
    proofline_recording_importer_login
`);
    if (backupConfigured) {
      await client.query(
        "GRANT CONNECT ON DATABASE proofline TO proofline_backup_login",
      );
      await client.query("GRANT pg_monitor TO proofline_backup_login");
      for (const signature of [
        "pg_backup_start(text, boolean)",
        "pg_backup_stop(boolean)",
        "pg_switch_wal()",
      ]) {
        await client.query(
          `GRANT EXECUTE ON FUNCTION pg_catalog.${signature} TO proofline_backup_login`,
        );
      }
    }
    await client.query("COMMIT");
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    bootstrapFailed();
  } finally {
    client?.release();
  }
}

export async function runProductionDatabaseRoleBootstrap(
  environment: DeploymentEnvironment = process.env,
): Promise<void> {
  let pool: Pool | undefined;
  try {
    await bootstrapProductionDatabaseRoles({
      environment,
      connect: async (connectionString) => {
        pool = new Pool({ connectionString, max: 1 });
        return pool.connect();
      },
    });
  } finally {
    await pool?.end().catch(() => undefined);
  }
}
