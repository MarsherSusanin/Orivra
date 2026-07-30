import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import {
  createPersistedActionRunClient,
  createProductionActionDependencies,
  runActionEntry,
} from "./runtime";

const artifactClient = new DefaultArtifactClient();
const persistedClient = createPersistedActionRunClient({
  environment: process.env,
  fetch: globalThis.fetch,
  clock: {
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
  files: { readText: (path) => readFile(path, "utf8") },
});

await runActionEntry({
  dependencies: createProductionActionDependencies({
    environment: process.env,
    core: {
      getInput: core.getInput,
      setFailed: core.setFailed,
      async writeSummary(markdown) {
        await core.summary.addRaw(markdown).write();
      },
    },
    replayManifest: persistedClient.replayManifest,
    runLive: persistedClient.runLive,
    async uploadJson(name, value) {
      const directory = await mkdtemp(join(tmpdir(), "proofline-action-"));
      const path = join(directory, `${name}.json`);
      await writeFile(path, JSON.stringify(value, null, 2), "utf8");
      await artifactClient.uploadArtifact(name, [path], directory);
    },
  }),
  setFailed: core.setFailed,
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
