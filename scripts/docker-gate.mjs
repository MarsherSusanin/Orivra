import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const script of ["scripts/docker-build.mjs", "scripts/docker-smoke.mjs"]) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Docker gate failed (${script})`);
}
