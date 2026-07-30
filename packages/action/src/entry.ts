import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { replayProofBundle } from "@proofline/domain";
import { runLiveCoston2Gate } from "@proofline/worker/src/live-gate";
import { runProoflineAction } from "./index";

const artifactClient = new DefaultArtifactClient();

try {
  const exitCode = await runProoflineAction({
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    inputs: {
      manifest: core.getInput("manifest", { required: true }),
      mode: core.getInput("mode"),
    },
    env: process.env,
    client: {
      async replayManifest(path) {
        const bundle = replayProofBundle(await readFile(path, "utf8"));
        return { runId: bundle.runId, checksum: bundle.checksum };
      },
      runLive(input) {
        return runLiveCoston2Gate({
          manifestPath: input.manifestPath,
          timeoutMs: input.timeoutMs,
          projectToken: process.env.PROOFLINE_PROJECT_TOKEN ?? "",
          privateKey: process.env.PROOFLINE_COSTON2_PRIVATE_KEY ?? "",
          verifierApiKey: process.env.PROOFLINE_VERIFIER_API_KEY ?? "",
        });
      },
    },
    artifacts: {
      async writeSummary(markdown) {
        await core.summary.addRaw(markdown).write();
      },
      async upload(name, value) {
        const directory = await mkdtemp(join(tmpdir(), "proofline-action-"));
        const path = join(directory, `${name}.json`);
        await writeFile(path, JSON.stringify(value, null, 2), "utf8");
        await artifactClient.uploadArtifact(name, [path], directory);
      },
    },
  });
  if (exitCode !== 0) core.setFailed("Proofline release gate failed");
  process.exitCode = exitCode;
} catch {
  core.setFailed("Proofline release gate failed without publishable detail");
  process.exitCode = 1;
}
