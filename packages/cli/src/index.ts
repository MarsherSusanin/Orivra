import { Web2JsonManifestV1Schema } from "@proofline/contracts";

interface CliDependencies {
  argv: string[];
  client: Record<string, (...args: any[]) => Promise<any>>;
  wallet: {
    signAndBroadcast(transaction: unknown, privateKey: string): Promise<string>;
  };
  env: Record<string, string | undefined>;
  io: {
    stdout(line: string): void;
    stderr(line: string): void;
  };
  files: {
    readText(path: string): Promise<string>;
    writeText(path: string, value: string): Promise<void>;
  };
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Command failed";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/0x[a-f0-9]{16,}/gi, "[REDACTED]");
}

export async function runProoflineCli(input: CliDependencies): Promise<number> {
  const [group, command, positional] = input.argv;
  try {
    if (group === "run" && command === "create") {
      const manifestPath = option(input.argv, "--manifest");
      const mode = option(input.argv, "--mode") ?? "replay";
      if (!manifestPath || !["replay", "wallet", "relayer"].includes(mode)) {
        throw new Error("run create requires --manifest and a supported --mode");
      }
      const privateKey =
        mode === "wallet" ? input.env.PROOFLINE_COSTON2_PRIVATE_KEY : undefined;
      if (mode === "wallet" && !privateKey) {
        throw new Error("A local Coston2 wallet secret is required");
      }
      const manifest = Web2JsonManifestV1Schema.parse(
        JSON.parse(await input.files.readText(manifestPath)),
      );
      const created = await input.client.createRun({ manifest, mode });
      if (mode === "wallet") {
        const transaction = await input.client.prepareSubmission({
          runId: created.runId,
          mode: "wallet",
        });
        const transactionHash = await input.wallet.signAndBroadcast(
          transaction,
          privateKey!,
        );
        await input.client.attachTransaction({
          runId: created.runId,
          transactionHash,
        });
      }
      input.io.stdout(`Run created: ${created.runId}`);
      return 0;
    }

    if (group === "run" && command === "watch" && positional) {
      const result = await input.client.watchRun({ runId: positional });
      input.io.stdout(`Run ${result.runId} complete`);
      return 0;
    }
    if (group === "run" && command === "verify" && positional) {
      const result = await input.client.verifyRun({ runId: positional });
      input.io.stdout(`Proof verified: ${String(result.proofVerified)}`);
      return 0;
    }
    if (group === "bundle" && command === "export" && positional) {
      const outputPath = option(input.argv, "--out");
      if (!outputPath) throw new Error("bundle export requires --out");
      const bundle = await input.client.exportBundle({ runId: positional });
      await input.files.writeText(outputPath, String(bundle));
      input.io.stdout(`Bundle exported: ${outputPath}`);
      return 0;
    }
    if (group === "replay" && command) {
      const serialized = await input.files.readText(command);
      const result = await input.client.replay({ bundle: serialized });
      input.io.stdout(`Replay complete: ${result.runId}`);
      return 0;
    }
    input.io.stderr("Unsupported Proofline command");
    return 2;
  } catch (error) {
    input.io.stderr(safeMessage(error));
    return 2;
  }
}
