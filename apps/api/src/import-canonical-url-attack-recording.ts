import { Pool } from "pg";
import { importCanonicalUrlAttackRecording } from "./canonical-url-attack-importer";
import { verifyDeploymentSchema } from "./deployment-lifecycle";
import { resolveDeploymentEnvironment } from "./deployment-secrets";

function recordingArgument(argv: readonly string[]): string {
  if (
    argv.length !== 2 ||
    argv[0] !== "--recording" ||
    argv[1].length === 0 ||
    argv[1].startsWith("-")
  ) {
    throw new Error(
      "Usage: import-canonical-url-attack-recording --recording <path>",
    );
  }
  return argv[1];
}

let pool: Pool | undefined;
try {
  const environment = await resolveDeploymentEnvironment(
    "recording-importer",
    process.env,
  );
  pool = new Pool({ connectionString: environment.DATABASE_URL });
  await verifyDeploymentSchema({ pool });
  const result = await importCanonicalUrlAttackRecording({
    recordingPath: recordingArgument(process.argv.slice(2)),
    pool,
    repositoryRoot: new URL("../../../", import.meta.url),
  });
  console.log(`Imported canonical URL attack recording ${result.recordingSha256}`);
} catch {
  console.error("Canonical URL attack recording import failed");
  process.exitCode = 2;
} finally {
  await pool?.end();
}
