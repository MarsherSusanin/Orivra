import { runProoflineAction } from "./index";

type Environment = Record<string, string | undefined>;

export function createProductionActionDependencies(input: {
  environment: Environment;
  core: {
    getInput(name: string, options?: { required?: boolean }): string;
    setFailed(message: string): void;
    writeSummary(markdown: string): void | Promise<void>;
  };
  replayManifest(path: string): Promise<{ runId: string; checksum: string }>;
  runLive(input: Record<string, unknown>): Promise<any>;
  uploadJson(name: string, value: unknown): void | Promise<void>;
}) {
  const environment = input.environment;
  return {
    eventName: environment.GITHUB_EVENT_NAME ?? "",
    inputs: {
      manifest: input.core.getInput("manifest", { required: true }),
      mode: input.core.getInput("mode"),
    },
    env: environment,
    client: {
      replayManifest: input.replayManifest,
      runLive(request: Record<string, unknown>) {
        return input.runLive({
          ...request,
          projectToken: environment.PROOFLINE_PROJECT_TOKEN ?? "",
          privateKey: environment.PROOFLINE_COSTON2_PRIVATE_KEY ?? "",
          verifierApiKey: environment.PROOFLINE_VERIFIER_API_KEY ?? "",
        });
      },
    },
    artifacts: {
      writeSummary: input.core.writeSummary,
      upload: input.uploadJson,
    },
  };
}

export async function runActionEntry(input: {
  dependencies: Record<string, unknown>;
  runAction?: typeof runProoflineAction;
  setFailed(message: string): void;
  setExitCode(code: number): void;
}): Promise<number> {
  try {
    const result = await (input.runAction ?? runProoflineAction)(
      input.dependencies as never,
    );
    if (result !== 0) input.setFailed("Proofline release gate failed");
    input.setExitCode(result);
    return result;
  } catch {
    input.setFailed(
      "Proofline release gate failed without publishable detail",
    );
    input.setExitCode(1);
    return 1;
  }
}
