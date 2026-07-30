import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Web2JsonManifestV1Schema } from "@proofline/contracts";
import {
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

function productionDependencies(): Omit<CliDependencies, "argv"> {
  const apiOrigin = process.env.PROOFLINE_API_URL?.replace(/\/+$/, "");
  const projectToken = process.env.PROOFLINE_PROJECT_TOKEN;
  if (!apiOrigin || !projectToken) {
    throw new Error("PROOFLINE_API_URL and PROOFLINE_PROJECT_TOKEN are required");
  }
  let idempotencySequence = 0;
  async function api(path: string, init: RequestInit = {}) {
    const method = init.method ?? "GET";
    const response = await fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${projectToken}`,
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "idempotency-key": `cli-${Date.now()}-${++idempotencySequence}`,
            }
          : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
    if (!response.ok) {
      throw new Error(`Proofline API rejected ${method} ${path} (${response.status})`);
    }
    return response;
  }
  const client = {
    async createRun(input: { manifest: any; mode: string }) {
      const manifest = {
        ...input.manifest,
        submission: { ...input.manifest.submission, mode: input.mode },
      };
      return api("/v1/runs", {
        method: "POST",
        body: JSON.stringify({ manifest }),
      }).then((response) => response.json());
    },
    async prepareSubmission(input: { runId: string; mode: string }) {
      return api(`/v1/runs/${encodeURIComponent(input.runId)}/submissions`, {
        method: "POST",
        body: JSON.stringify({ mode: input.mode }),
      })
        .then((response) => response.json())
        .then((value: any) => value.transaction);
    },
    async attachTransaction(input: { runId: string; transactionHash: string }) {
      return api(`/v1/runs/${encodeURIComponent(input.runId)}/transactions`, {
        method: "POST",
        body: JSON.stringify({ transactionHash: input.transactionHash }),
      }).then((response) => response.json());
    },
    async watchRun(input: { runId: string }) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 600_000) {
        const run: any = await api(
          `/v1/runs/${encodeURIComponent(input.runId)}`,
        ).then((response) => response.json());
        if (run.terminal) return run;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error("Run watch timed out after 10 minutes");
    },
    async verifyRun(input: { runId: string }) {
      return api(
        `/v1/runs/${encodeURIComponent(input.runId)}/consumer-verifications`,
        { method: "POST", body: "{}" },
      ).then((response) => response.json());
    },
    async exportBundle(input: { runId: string }) {
      return api(
        `/v1/runs/${encodeURIComponent(input.runId)}/bundle`,
      ).then((response) => response.text());
    },
    async replay(input: { bundle: string }) {
      return api("/v1/replays", {
        method: "POST",
        body: JSON.stringify({ bundle: input.bundle }),
      }).then((response) => response.json());
    },
  };
  return {
    client,
    wallet: {
      async signAndBroadcast(transaction, privateKey) {
        const request = transaction as {
          chainId: string;
          to: Address;
          data: Hex;
          value: string;
        };
        if (request.chainId !== "0x72") {
          throw new Error("Wallet transaction must target Coston2 chain 114");
        }
        const account = privateKeyToAccount(privateKey as Hex);
        const wallet = createWalletClient({
          account,
          chain: {
            id: 114,
            name: "Coston2",
            nativeCurrency: {
              name: "Coston2 Flare",
              symbol: "C2FLR",
              decimals: 18,
            },
            rpcUrls: {
              default: {
                http: [
                  process.env.PROOFLINE_COSTON2_RPC_URL ??
                    "https://coston2-api.flare.network/ext/C/rpc",
                ],
              },
            },
          },
          transport: http(
            process.env.PROOFLINE_COSTON2_RPC_URL ??
              "https://coston2-api.flare.network/ext/C/rpc",
          ),
        });
        return wallet.sendTransaction({
          account,
          chain: wallet.chain,
          to: request.to,
          data: request.data,
          value: BigInt(request.value),
        });
      },
    },
    env: process.env,
    io: { stdout: console.log, stderr: console.error },
    files: {
      readText: (path) => readFile(path, "utf8"),
      writeText: (path, value) => writeFile(path, value, "utf8"),
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await runProoflineCli({
      argv: process.argv.slice(2),
      ...productionDependencies(),
    });
  } catch (cause) {
    console.error(safeMessage(cause));
    process.exitCode = 2;
  }
}
