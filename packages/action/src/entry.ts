import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { replayProofBundle } from "@proofline/domain";
import { runLiveCoston2Gate } from "@proofline/worker/src/live-gate";
import {
  createProductionActionDependencies,
  runActionEntry,
} from "./runtime";

const artifactClient = new DefaultArtifactClient();

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
    async replayManifest(path) {
      const bundle = replayProofBundle(await readFile(path, "utf8"));
      return { runId: bundle.runId, checksum: bundle.checksum };
    },
    runLive: (liveInput) =>
      runLiveCoston2Gate(
        liveInput as unknown as Parameters<typeof runLiveCoston2Gate>[0],
      ),
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
