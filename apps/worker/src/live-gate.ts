import { readFile } from "node:fs/promises";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import { createWeb2JsonVerifierClient } from "@proofline/fdc-coston2";
import {
  createLiveCoston2Runtime,
  type LiveGateEvidence,
  type LiveGateRuntime,
} from "./live-runtime";

export type { LiveGateEvidence, LiveGateRuntime } from "./live-runtime";

export interface LiveGateInput {
  projectToken: string;
  privateKey: string;
  verifierApiKey: string;
  manifestPath: string;
  timeoutMs: number;
  runtime?: LiveGateRuntime;
  runtimeFactory?(input: {
    environment: Record<string, string | undefined>;
  }): LiveGateRuntime;
}

function requireSecret(name: string, value: string): void {
  if (!value || value.trim().length < 8) {
    throw Object.assign(new Error(`${name} is required for the live Coston2 gate`), {
      kind: "configuration",
    });
  }
}

export async function runLiveCoston2Gate(
  input: LiveGateInput,
): Promise<LiveGateEvidence> {
  requireSecret("PROOFLINE_PROJECT_TOKEN", input.projectToken);
  requireSecret("PROOFLINE_COSTON2_PRIVATE_KEY", input.privateKey);
  requireSecret("PROOFLINE_VERIFIER_API_KEY", input.verifierApiKey);
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 600_000) {
    throw Object.assign(new Error("Live Coston2 timeout must be within 10 minutes"), {
      kind: "configuration",
    });
  }
  const manifest = Web2JsonManifestV1Schema.parse(
    JSON.parse(await readFile(input.manifestPath, "utf8")),
  );
  const runtime =
    input.runtime ??
    (input.runtimeFactory ?? createLiveCoston2Runtime)({
      environment: process.env,
    });
  if (runtime.kind !== "live") {
    throw Object.assign(
      new Error("Replay/simulator adapters are forbidden in the live runtime"),
      { kind: "configuration" },
    );
  }
  const verifier = createWeb2JsonVerifierClient({
    endpoint: "https://fdc-verifiers-testnet.flare.network",
    apiKey: input.verifierApiKey,
  });
  return runtime.execute({
    manifest,
    projectToken: input.projectToken,
    privateKey: input.privateKey,
    verifier,
    timeoutMs: input.timeoutMs,
  });
}
