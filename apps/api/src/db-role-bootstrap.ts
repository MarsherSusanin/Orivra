import { pathToFileURL } from "node:url";
import {
  bootstrapProductionDatabaseRoles,
  grantApplicationRoleMemberships,
  runProductionDatabaseRoleBootstrap,
} from "./db-role-bootstrap-core";

export {
  DeploymentRoleBootstrapError,
  bootstrapProductionDatabaseRoles,
  grantApplicationRoleMemberships,
  runProductionDatabaseRoleBootstrap,
} from "./db-role-bootstrap-core";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProductionDatabaseRoleBootstrap();
  } catch {
    console.error(JSON.stringify({
      event: "DEPLOYMENT_ROLE_BOOTSTRAP_FAILED",
      code: "DEPLOYMENT_ROLE_BOOTSTRAP_FAILED",
    }));
    process.exitCode = 1;
  }
}
