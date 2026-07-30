import { readFile, writeFile } from "node:fs/promises";
import {
  createProductionCliDependencies,
  prooflineHelp,
  runProoflineCli,
} from "./index";

const argv = process.argv.slice(2);
const help = prooflineHelp(argv);

if (help !== null) {
  console.log(help);
  process.exitCode = 0;
} else {
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
      },
      io: { stdout: console.log, stderr: console.error },
    }),
  });
}
