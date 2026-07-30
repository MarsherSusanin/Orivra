// @vitest-environment node

import { describe, expect, it } from "vitest";
import { runLiveCoston2Gate } from "../../apps/worker/src/live-gate";

const configured =
  typeof process.env.PROOFLINE_PROJECT_TOKEN === "string" &&
  typeof process.env.PROOFLINE_COSTON2_PRIVATE_KEY === "string" &&
  typeof process.env.PROOFLINE_VERIFIER_API_KEY === "string" &&
  typeof process.env.PROOFLINE_LIVE_MANIFEST === "string";

describe.runIf(configured)("live Coston2 Web2Json merge gate", () => {
  it(
    "produces complete release evidence and never rebroadcasts after recording the tx hash",
    async () => {
      const result = await runLiveCoston2Gate({
        projectToken: process.env.PROOFLINE_PROJECT_TOKEN!,
        privateKey: process.env.PROOFLINE_COSTON2_PRIVATE_KEY!,
        verifierApiKey: process.env.PROOFLINE_VERIFIER_API_KEY!,
        manifestPath: process.env.PROOFLINE_LIVE_MANIFEST!,
        timeoutMs: 600_000,
      });

      expect(result).toMatchObject({
        commitHash: expect.stringMatching(/^[a-f0-9]{40}$/),
        treeHash: expect.stringMatching(/^[a-f0-9]{40}$/),
        runId: expect.any(String),
        transactionHash: expect.stringMatching(/^0x[a-f0-9]{64}$/i),
        votingRound: expect.any(String),
        proofChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        consumerVerified: true,
        broadcastCountAfterRecordedHash: 0,
      });
    },
    600_000,
  );
});
