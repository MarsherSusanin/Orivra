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

const rootHelp = [
  "Proofline Web2Json release client",
  "",
  "Usage: proofline <command> [options]",
  "",
  "Commands:",
  "  run create       Create a replay, wallet, or relayer run",
  "  run watch        Wait for terminal run evidence",
  "  run verify       Verify the canonical safe consumer",
  "  bundle export    Export a ProofBundleV1",
  "  replay           Replay a bundle",
  "",
  "Run proofline <command> --help for command options.",
].join("\n");

export function prooflineHelp(argv: readonly string[]): string | null {
  if (argv[0] === "help" || argv[0] === "--help" || argv.length === 0) {
    return rootHelp;
  }
  if (!argv.includes("--help")) return null;
  if (argv[0] === "run" && argv[1] === "create") {
    return [
      "Usage: proofline run create --manifest <path> [--mode replay|wallet|relayer]",
      "Creates one persisted Web2Json run. Wallet secrets stay local.",
    ].join("\n");
  }
  if (argv[0] === "run") {
    return [
      "Usage: proofline run <create|watch|verify> [options]",
      "Commands: create, watch, verify",
    ].join("\n");
  }
  if (argv[0] === "bundle" && argv[1] === "export") {
    return "Usage: proofline bundle export <run-id> --out <path>";
  }
  if (argv[0] === "replay") {
    return "Usage: proofline replay <bundle-path>";
  }
  return rootHelp;
}

export async function runProoflineCli(input: CliDependencies): Promise<number> {
  const help = prooflineHelp(input.argv);
  if (help !== null) {
    input.io.stdout(help);
    return 0;
  }
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
      if (mode === "wallet" || mode === "relayer") {
        const transaction = await input.client.prepareSubmission({
          runId: created.runId,
          mode,
        });
        if (mode === "wallet") {
          const transactionHash = await input.wallet.signAndBroadcast(
            transaction,
            privateKey!,
          );
          await input.client.attachTransaction({
            runId: created.runId,
            transactionHash,
          });
        }
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

export function createProductionCliDependencies(input: {
  environment: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  walletFactory?: (input: {
    privateKey: string;
    rpcUrl: string;
  }) => {
    sendTransaction(transaction: {
      to: Address;
      data: Hex;
      value: bigint;
    }): Promise<string>;
  };
  clock: { now(): number; sleep(ms: number): Promise<void> };
  files: CliDependencies["files"];
  io: CliDependencies["io"];
}): Omit<CliDependencies, "argv"> {
  const environment = input.environment;
  const apiOrigin = environment.PROOFLINE_API_URL?.replace(/\/+$/, "");
  const projectToken = environment.PROOFLINE_PROJECT_TOKEN;
  if (!apiOrigin || !projectToken) {
    throw new Error("PROOFLINE_API_URL and PROOFLINE_PROJECT_TOKEN are required");
  }
  const walletFactory =
    input.walletFactory ??
    ((walletInput: { privateKey: string; rpcUrl: string }) => {
      const account = privateKeyToAccount(walletInput.privateKey as Hex);
      const chain = {
        id: 114,
        name: "Coston2",
        nativeCurrency: {
          name: "Coston2 Flare",
          symbol: "C2FLR",
          decimals: 18,
        },
        rpcUrls: { default: { http: [walletInput.rpcUrl] } },
      } as const;
      const wallet = createWalletClient({
        account,
        chain,
        transport: http(walletInput.rpcUrl),
      });
      return {
        sendTransaction(transaction: {
          to: Address;
          data: Hex;
          value: bigint;
        }) {
          return wallet.sendTransaction({
            account,
            chain,
            ...transaction,
          });
        },
      };
    });
  let idempotencySequence = 0;
  async function requestApi(path: string, init: RequestInit = {}) {
    const method = init.method ?? "GET";
    return input.fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${projectToken}`,
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "idempotency-key": `cli-${input.clock.now()}-${++idempotencySequence}`,
            }
          : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
  }
  async function api(path: string, init: RequestInit = {}) {
    const method = init.method ?? "GET";
    const response = await requestApi(path, init);
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
    async prepareSubmission(request: { runId: string; mode: string }) {
      const path = `/v1/runs/${encodeURIComponent(request.runId)}/submissions`;
      const startedAt = input.clock.now();
      const timeoutMs = 60_000;
      while (true) {
        const response = await requestApi(path, {
          method: "POST",
          body: JSON.stringify({ mode: request.mode }),
        });
        if (response.ok) {
          const value: any = await response.json();
          return value.transaction ?? value;
        }
        let code: unknown;
        if (response.status === 404) {
          try {
            code = ((await response.json()) as any)?.error?.code;
          } catch {
            code = undefined;
          }
        }
        if (response.status !== 404 || code !== "PREFLIGHT_NOT_READY") {
          throw new Error(
            `Proofline API rejected POST ${path} (${response.status})`,
          );
        }
        const remainingMs = timeoutMs - (input.clock.now() - startedAt);
        if (remainingMs <= 0) {
          throw new Error(
            "Web2Json preflight was not ready before the 60 second timeout",
          );
        }
        await input.clock.sleep(Math.min(2_000, remainingMs));
      }
    },
    async attachTransaction(input: { runId: string; transactionHash: string }) {
      return api(`/v1/runs/${encodeURIComponent(input.runId)}/transactions`, {
        method: "POST",
        body: JSON.stringify({ transactionHash: input.transactionHash }),
      }).then((response) => response.json());
    },
    async watchRun(request: { runId: string }) {
      const startedAt = input.clock.now();
      while (input.clock.now() - startedAt < 600_000) {
        const run: any = await api(
          `/v1/runs/${encodeURIComponent(request.runId)}`,
        ).then((response) => response.json());
        if (run.terminal) return run;
        await input.clock.sleep(2_000);
      }
      throw new Error("Run watch timed out after 10 minutes");
    },
    async verifyRun(input: { runId: string }) {
      return api(
        `/v1/runs/${encodeURIComponent(input.runId)}/consumer-verifications`,
        {
          method: "POST",
          body: JSON.stringify({ consumer: "canonical-safe" }),
        },
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
        const wallet = walletFactory({
          privateKey,
          rpcUrl:
            environment.PROOFLINE_COSTON2_RPC_URL ??
            "https://coston2-api.flare.network/ext/C/rpc",
        });
        return wallet.sendTransaction({
          to: request.to,
          data: request.data,
          value: BigInt(request.value),
        });
      },
    },
    env: environment,
    io: input.io,
    files: input.files,
  };
}
