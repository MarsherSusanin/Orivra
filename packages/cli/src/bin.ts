import { readFile, writeFile } from "node:fs/promises";
import {
  createProductionCliDependencies,
  runProoflineCli,
} from "./index";

process.exitCode = await runProoflineCli({
  argv: process.argv.slice(2),
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
