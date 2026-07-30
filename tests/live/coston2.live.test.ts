// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPersistedActionRunClient } from "../../packages/action/src/runtime";

const configured =
  typeof process.env.PROOFLINE_API_URL === "string" &&
  typeof process.env.PROOFLINE_PROJECT_TOKEN === "string" &&
  typeof process.env.PROOFLINE_LIVE_MANIFEST === "string" &&
  typeof process.env.GITHUB_SHA === "string" &&
  typeof process.env.PROOFLINE_TREE_HASH === "string";

describe.runIf(configured)("live Coston2 Web2Json merge gate", () => {
  it(
    "observes complete persisted release evidence without runner-side custody",
    async () => {
      const client = createPersistedActionRunClient({
        environment: process.env,
        fetch: globalThis.fetch,
        clock: {
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
        files: { readText: (path) => readFile(path, "utf8") },
      });
      const result = await client.runLive({
        manifestPath: process.env.PROOFLINE_LIVE_MANIFEST!,
        timeoutMs: 600_000,
      });

      expect(result).toMatchObject({
        commitHash: process.env.GITHUB_SHA,
        treeHash: process.env.PROOFLINE_TREE_HASH,
        runId: expect.any(String),
        transactionHash: expect.stringMatching(/^0x[a-f0-9]{64}$/i),
        votingRound: expect.any(String),
        proofChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        consumerVerified: true,
        broadcastCountAfterRecordedHash: 0,
      });
      expect(result.persistedRun).toEqual({
        runId: result.runId,
        lastSequence: expect.toSatisfy(
          (sequence: unknown) =>
            Number.isSafeInteger(sequence) && Number(sequence) > 0,
        ),
      });
    },
    600_000,
  );
});
