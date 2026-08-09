import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProductionCanonicalUrlAttackRuntime } from "@proofline/fdc-coston2";
import {
  createProductionCliDependencies,
  prooflineHelp,
  runProoflineCli,
  safeCliErrorMessage,
} from "./index";

const argv = process.argv.slice(2);
const help = prooflineHelp(argv);

async function writeTextAtomic(path: string, value: string): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
  try {
    temporaryFile = await open(temporaryPath, "wx", 0o600);
    await temporaryFile.writeFile(value, "utf8");
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

if (help !== null) {
  console.log(help);
  process.exitCode = 0;
} else {
  try {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const canonicalUrlAttackRuntime =
      createProductionCanonicalUrlAttackRuntime({
        readCheckedInSource: (path) =>
          readFile(join(repositoryRoot, path), "utf8"),
        now: () => new Date().toISOString(),
      });
    process.exitCode = await runProoflineCli({
      argv,
      ...createProductionCliDependencies({
        environment: process.env,
        fetch: globalThis.fetch,
        clock: {
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        files: {
          readText: (path) => readFile(path, "utf8"),
          writeText: (path, value) => writeFile(path, value, "utf8"),
          writeTextAtomic,
        },
        io: { stdout: console.log, stderr: console.error },
        demoRecorder: canonicalUrlAttackRuntime,
      }),
    });
  } catch (error) {
    console.error(safeCliErrorMessage(error));
    process.exitCode = 2;
  }
}
