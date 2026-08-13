import { readFile } from "node:fs/promises";
import { getWeb2JsonTemplateDetail } from "@proofline/domain";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { runProductionPersistedLiveGate } from "./production-live-gate-runtime.mjs";

const API_ORIGIN = "http://api:8080";
const PUBLIC_ORIGIN = "https://orivra.xyz";
const KEY_FILE = "/run/secrets/worker_coston2_private_key";
const MANIFESTS = [
  ["open-meteo-current-weather", "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898"],
  ["eth-usd", "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db"],
] as const;

function requiredRunId(argv: string[]) {
  if (argv.length !== 2 || argv[0] !== "--run-id" || !/^prod_[0-9A-Z]{26}$/.test(argv[1] ?? "")) {
    throw new Error("Production run id is invalid");
  }
  return argv[1]!;
}

async function json(path: string, init: RequestInit, token?: string) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error("Production API request failed"), { status: response.status, code: (value as any)?.error?.code });
  return value as Record<string, any>;
}

function idempotency(runId: string, operation: string) {
  return `production-${runId}-${operation}`;
}

async function waitFor(runId: string, token: string, predicate: (value: Record<string, any>) => boolean) {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const value = await json(`/v1/runs/${encodeURIComponent(runId)}`, {}, token);
    if (predicate(value)) return value;
    if (value.terminal === true) throw new Error("Production run became terminal before the required stage");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Production run timed out");
}

const productionRunId = requiredRunId(process.argv.slice(2));
const key = await readFile(process.env.PROOFLINE_COSTON2_PRIVATE_KEY_FILE ?? KEY_FILE);
let account: ReturnType<typeof privateKeyToAccount>;
try {
  const text = key.toString("utf8").trim();
  account = privateKeyToAccount((key.length === 32 ? `0x${key.toString("hex")}` : text) as Hex);
} finally {
  key.fill(0);
}
let walletSession: Record<string, any> | undefined;
const submittedManifests = new Map<string, string>();
const manifestsBySha = new Map<string, unknown>(MANIFESTS.map(([id, sha]) => {
  const detail = getWeb2JsonTemplateDetail(id);
  if (!detail || detail.template.manifestSha256 !== sha) throw new Error("Production manifest authority is unavailable");
  return [sha, detail.manifest];
}));

const result = await runProductionPersistedLiveGate({
  productionRunId,
  manifestSha256s: MANIFESTS.map(([, sha]) => sha),
  chainId: 114,
  signer: { address: account.address, signSiweMessage: (message: string) => account.signMessage({ message }) },
  api: {
    requestSiweChallenge: (input: unknown) => json("/v1/auth/wallet/challenges", { method: "POST", headers: { origin: PUBLIC_ORIGIN }, body: JSON.stringify(input) }),
    async verifySiweSession(input: unknown) {
      walletSession = await json("/v1/auth/wallet/sessions", { method: "POST", headers: { origin: PUBLIC_ORIGIN }, body: JSON.stringify(input) });
      return { sessionId: String(walletSession.project?.projectId ?? "") };
    },
    async createProject() {
      if (!walletSession) throw new Error("Wallet session is unavailable");
      return { projectId: String(walletSession.project?.projectId ?? ""), projectToken: String(walletSession.projectToken ?? "") };
    },
    async submitPersistedRun({ manifestSha256, projectToken }: { manifestSha256: string; projectToken: string }) {
      const manifest = manifestsBySha.get(manifestSha256);
      if (!manifest) throw new Error("Production manifest is unavailable");
      const suffix = manifestSha256.slice(-12);
      const created = await json("/v1/runs", { method: "POST", headers: { "idempotency-key": idempotency(productionRunId, `create-${suffix}`) }, body: JSON.stringify({ manifest }) }, projectToken);
      const runId = String(created.runId ?? "");
      for (;;) {
        try {
          await json(`/v1/runs/${encodeURIComponent(runId)}/submissions`, { method: "POST", headers: { "idempotency-key": idempotency(productionRunId, `submit-${suffix}`) }, body: JSON.stringify({ mode: "relayer" }) }, projectToken);
          break;
        } catch (cause: any) {
          if (cause?.code !== "PREFLIGHT_NOT_READY") throw cause;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
      const proof = await waitFor(runId, projectToken, (value) => value.stages?.verify === "completed" || value.proofVerified === true);
      if (proof.terminal !== true) {
        await json(`/v1/runs/${encodeURIComponent(runId)}/consumer-verifications`, { method: "POST", headers: { "idempotency-key": idempotency(productionRunId, `verify-${suffix}`) }, body: JSON.stringify({ consumer: "canonical-safe" }) }, projectToken);
      }
      await waitFor(runId, projectToken, (value) => value.terminal === true && value.consumerVerified === true);
      submittedManifests.set(runId, manifestSha256);
      return { runId };
    },
    async readPersistedRun({ runId }: { runId: string }) {
      const projection = await json(`/v1/runs/${encodeURIComponent(runId)}`, {}, String(walletSession?.projectToken ?? ""));
      return { runId, stage: projection.terminal === true && projection.consumerVerified === true ? "completed" : "failed", manifestSha256: submittedManifests.get(runId), persisted: projection.terminal === true && projection.consumerVerified === true };
    },
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
