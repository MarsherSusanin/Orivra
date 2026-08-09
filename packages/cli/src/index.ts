import {
  SubmissionResponseV1Schema,
  Web2JsonManifestV1Schema,
  type SubmissionResponseV1,
} from "@proofline/contracts";
import {
  canonicalSerializeCanonicalUrlAttackRecording,
  replayCanonicalUrlAttackRecording,
} from "@proofline/domain";
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
  demoRecorder?: {
    recordCanonicalUrlAttack(input: {
      attackRunId: string;
      attackBundle: string;
      controlRunId: string;
      controlBundle: string;
      release: { commitSha: string; treeSha: string };
    }): Promise<string>;
    verifyCanonicalUrlAttackRecording(serialized: string): Promise<{
      status: "runtime-verified";
      recordingChecksum: string;
    }>;
  };
  env: Record<string, string | undefined>;
  io: {
    stdout(line: string): void;
    stderr(line: string): void;
  };
  files: {
    readText(path: string): Promise<string>;
    writeText(path: string, value: string): Promise<void>;
    writeTextAtomic?(path: string, value: string): Promise<void>;
  };
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function safeCliErrorMessage(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "CANONICAL_SOURCE_READ_FAILED"
  ) {
    return "Canonical URL attack source read failed";
  }
  const message = error instanceof Error ? error.message : "Command failed";
  const sanitized = message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:project|share)_[A-Za-z0-9_-]{16,}/gi, "[REDACTED]")
    .replace(
      /("(?:authorization|private[_ -]?key|secret|token)"\s*:\s*")[^"]*"/gi,
      "$1[REDACTED]\"",
    )
    .replace(/0x[a-f0-9]{16,}/gi, "[REDACTED]");
  const bytes = new TextEncoder().encode(sanitized);
  if (bytes.byteLength <= 480) return sanitized;
  let bounded = sanitized;
  while (
    bounded.length > 0 &&
    new TextEncoder().encode(`${bounded}…`).byteLength > 480
  ) {
    bounded = bounded.slice(0, -1);
  }
  return `${bounded}…`;
}

const DEMO_RECORD_FLAGS = [
  "--attack-run",
  "--control-run",
  "--commit",
  "--tree",
  "--out",
] as const;

type DemoRecordFlag = (typeof DEMO_RECORD_FLAGS)[number];

function parseDemoRecordArguments(argv: readonly string[]): {
  attackRunId: string;
  controlRunId: string;
  commitSha: string;
  treeSha: string;
  outputPath: string;
} {
  const allowed = new Set<string>(DEMO_RECORD_FLAGS);
  const values = new Map<DemoRecordFlag, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) {
      throw new Error("demo record has invalid trailing positional arguments");
    }
    if (!allowed.has(flag)) {
      throw new Error(`demo record has unknown flag ${flag}`);
    }
    if (values.has(flag as DemoRecordFlag)) {
      throw new Error(`demo record has duplicate flag ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`demo record has invalid value for ${flag}`);
    }
    values.set(flag as DemoRecordFlag, value);
  }
  const missing = DEMO_RECORD_FLAGS.filter((flag) => !values.has(flag));
  if (missing.length > 0) {
    throw new Error(`demo record requires ${missing.join(", ")}`);
  }

  const attackRunId = values.get("--attack-run")!;
  const controlRunId = values.get("--control-run")!;
  const commitSha = values.get("--commit")!;
  const treeSha = values.get("--tree")!;
  const outputPath = values.get("--out")!;
  const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const shaPattern = /^[a-f0-9]{40}$/;
  if (!runIdPattern.test(attackRunId)) {
    throw new Error("demo record has invalid --attack-run");
  }
  if (!runIdPattern.test(controlRunId)) {
    throw new Error("demo record has invalid --control-run");
  }
  if (!shaPattern.test(commitSha)) {
    throw new Error("demo record has invalid --commit");
  }
  if (!shaPattern.test(treeSha)) {
    throw new Error("demo record has invalid --tree");
  }
  const outputName = outputPath.split(/[\\/]/).at(-1);
  if (
    outputPath.length === 0 ||
    outputPath.startsWith("-") ||
    new TextEncoder().encode(outputPath).byteLength > 4_096 ||
    /[\0-\x1f\x7f]/.test(outputPath) ||
    /[\\/]$/.test(outputPath) ||
    outputName === "." ||
    outputName === ".."
  ) {
    throw new Error("demo record has invalid --out");
  }
  return { attackRunId, controlRunId, commitSha, treeSha, outputPath };
}

type SubmissionMode = SubmissionResponseV1["mode"];

function isSubmissionMode(value: string): value is SubmissionMode {
  return value === "wallet" || value === "relayer" || value === "replay";
}

function submissionErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const nested =
    body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>).code
      : undefined;
  const code = nested ?? body.code;
  return typeof code === "string" &&
    code.length <= 64 &&
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code)
    ? code
    : undefined;
}

async function readSubmissionErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    return submissionErrorCode(await response.json());
  } catch {
    return undefined;
  }
}

function parseSubmissionResponse(
  value: unknown,
  request: { runId: string; mode: SubmissionMode },
): SubmissionResponseV1 {
  const parsed = SubmissionResponseV1Schema.safeParse(value);
  const expectedEffectOwner = {
    wallet: "wallet",
    relayer: "worker",
    replay: "none",
  } as const;
  if (
    !parsed.success ||
    parsed.data.runId !== request.runId ||
    parsed.data.mode !== request.mode ||
    parsed.data.effectOwner !== expectedEffectOwner[request.mode]
  ) {
    throw new Error("Proofline returned an invalid submission response contract");
  }
  return parsed.data;
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
  "  demo record      Record the canonical URL attack from two persisted live runs",
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
  if (argv[0] === "demo" && argv[1] === "record") {
    return [
      "Usage: proofline demo record --attack-run <id> --control-run <id> --commit <sha> --tree <sha> --out <path>",
      "Records two explicit persisted live Coston2 bundles through the deterministic local EVM recorder.",
    ].join("\n");
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
      if (!manifestPath || !isSubmissionMode(mode)) {
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
      const submission = await input.client.prepareSubmission({
        runId: created.runId,
        mode,
      });
      if (mode === "wallet") {
        const transactionHash = await input.wallet.signAndBroadcast(
          submission,
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
    if (group === "demo" && command === "record") {
      const { attackRunId, controlRunId, commitSha, treeSha, outputPath } =
        parseDemoRecordArguments(input.argv);
      if (attackRunId === controlRunId) {
        throw new Error(
          "Canonical URL attack and control must be different persisted live runs",
        );
      }
      if (!input.demoRecorder || !input.files.writeTextAtomic) {
        throw new Error("Canonical URL attack production authority is required");
      }

      const attackBundle = String(
        await input.client.exportBundle({ runId: attackRunId }),
      );
      const controlBundle = String(
        await input.client.exportBundle({ runId: controlRunId }),
      );
      const recordedBytes = await input.demoRecorder.recordCanonicalUrlAttack({
        attackRunId,
        attackBundle,
        controlRunId,
        controlBundle,
        release: { commitSha, treeSha },
      });
      const runtimeVerification =
        await input.demoRecorder.verifyCanonicalUrlAttackRecording(
          recordedBytes,
        );
      const recording = replayCanonicalUrlAttackRecording(recordedBytes);
      if (
        runtimeVerification.status !== "runtime-verified" ||
        runtimeVerification.recordingChecksum !== recording.checksum ||
        recording.release.commitSha !== commitSha ||
        recording.release.treeSha !== treeSha ||
        recording.bundles.attack.runId !== attackRunId ||
        recording.bundles.attack.canonicalBundle !== attackBundle ||
        recording.bundles.control.runId !== controlRunId ||
        recording.bundles.control.canonicalBundle !== controlBundle
      ) {
        throw new Error(
          "Canonical URL attack recording does not match the requested persisted evidence",
        );
      }
      const canonicalBytes =
        canonicalSerializeCanonicalUrlAttackRecording(recording);
      await input.files.writeTextAtomic(outputPath, canonicalBytes);
      input.io.stdout(`Recorded canonical URL attack: ${outputPath}`);
      return 0;
    }
    input.io.stderr("Unsupported Proofline command");
    return 2;
  } catch (error) {
    input.io.stderr(safeCliErrorMessage(error));
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
  demoRecorder?: CliDependencies["demoRecorder"];
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
  function nextIdempotencyKey(): string {
    return `cli-${input.clock.now()}-${++idempotencySequence}`;
  }
  async function requestApi(
    path: string,
    init: RequestInit = {},
    idempotencyKey?: string,
  ) {
    const method = init.method ?? "GET";
    return input.fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${projectToken}`,
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "idempotency-key": idempotencyKey ?? nextIdempotencyKey(),
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
    async prepareSubmission(request: { runId: string; mode: SubmissionMode }) {
      const path = `/v1/runs/${encodeURIComponent(request.runId)}/submissions`;
      const startedAt = input.clock.now();
      const timeoutMs = 60_000;
      const idempotencyKey = nextIdempotencyKey();
      while (true) {
        const response = await requestApi(
          path,
          {
            method: "POST",
            body: JSON.stringify({ mode: request.mode }),
          },
          idempotencyKey,
        );
        if (response.ok) {
          let value: unknown;
          try {
            value = await response.json();
          } catch {
            throw new Error(
              "Proofline returned an invalid submission response contract",
            );
          }
          const parsed = parseSubmissionResponse(value, request);
          return parsed.mode === "wallet" ? parsed.transaction : parsed;
        }
        const code =
          response.status === 409
            ? await readSubmissionErrorCode(response)
            : undefined;
        if (response.status !== 409 || code !== "PREFLIGHT_NOT_READY") {
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
    demoRecorder: input.demoRecorder,
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
