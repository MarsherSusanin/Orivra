import { describe, expect, it, vi } from "vitest";
import { getWeb2JsonTemplateDetail } from "@proofline/domain/templates";
import {
  createOrivraMcpRuntime,
  parseOrivraMcpConfiguration,
  safeMcpErrorMessage,
} from "../src/index";
import { createOrivraApiClient } from "../src/api-client";

const TOKEN = `project_${"a".repeat(64)}`;
const DETAIL = getWeb2JsonTemplateDetail("open-meteo-current-weather")!;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Orivra local MCP runtime", () => {
  it("accepts one scoped HTTPS API configuration and rejects credentials in the URL", () => {
    expect(parseOrivraMcpConfiguration({
      PROOFLINE_API_URL: "https://orivra.xyz/api",
      PROOFLINE_PROJECT_TOKEN: TOKEN,
    })).toEqual({ apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN });

    for (const apiUrl of [
      "http://orivra.xyz/api",
      "https://user@orivra.xyz/api",
      "https://orivra.xyz/api?token=secret",
      "https://orivra.xyz/api#fragment",
    ]) {
      expect(() => parseOrivraMcpConfiguration({
        PROOFLINE_API_URL: apiUrl,
        PROOFLINE_PROJECT_TOKEN: TOKEN,
      })).toThrow(/configuration/i);
    }
  });

  it("forces arbitrary manifests to replay and uses one stable operation ID for create and submit", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/runs")) {
        return json({ status: "accepted", runId: "run_mcp_1", location: "/v1/runs/run_mcp_1" }, 202);
      }
      return json({
        version: "1",
        runId: "run_mcp_1",
        mode: "replay",
        effectOwner: "none",
        commandId: "command_mcp_1",
      }, 202);
    });
    const runtime = createOrivraMcpRuntime({
      configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
      fetch: fetch as typeof globalThis.fetch,
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    const result = await runtime.createReplayRun({
      source: { kind: "manifest", manifest: {
        ...DETAIL.manifest,
        submission: { ...DETAIL.manifest.submission, mode: "wallet" as const },
      } },
    });

    expect(result).toMatchObject({ status: "success", runId: "run_mcp_1", operationId: "mcp_11111111-1111-4111-8111-111111111111" });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0]!.init!.body))).toMatchObject({
      manifest: { submission: { mode: "replay" } },
    });
    expect(JSON.parse(String(requests[1]!.init!.body))).toEqual({ mode: "replay" });
    expect(new Headers(requests[0]!.init!.headers).get("idempotency-key")).toBe("mcp_11111111-1111-4111-8111-111111111111:create");
    expect(new Headers(requests[1]!.init!.headers).get("idempotency-key")).toBe("mcp_11111111-1111-4111-8111-111111111111:submit");
    expect(requests.every(({ url }) => !/transactions|wallet|relayer/i.test(url))).toBe(true);
  });

  it("binds exact template provenance and preserves API idempotency conflicts", async () => {
    const intents = new Map<string, string>();
    let effects = 0;
    const fetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (init?.method !== "POST") return json(DETAIL);
      effects += 1;
      const key = new Headers(init.headers).get("idempotency-key")!;
      const body = String(init.body);
      const prior = intents.get(key);
      if (prior !== undefined && prior !== body) {
        return json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Intent conflict" } }, 409);
      }
      intents.set(key, body);
      if (url.pathname.endsWith("/runs")) {
        return json({ status: "accepted", runId: "run_template_1", location: "/v1/runs/run_template_1" }, 202);
      }
      return json({
        version: "1",
        runId: "run_template_1",
        mode: "replay",
        effectOwner: "none",
        commandId: "command_template_1",
      }, 202);
    });
    const runtime = createOrivraMcpRuntime({
      configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
      fetch: fetch as typeof globalThis.fetch,
    });
    const exact = {
      source: {
        kind: "template" as const,
        templateId: DETAIL.template.id,
        revision: DETAIL.template.revision,
      },
      operationId: "agent-template-1",
    };

    await expect(runtime.createReplayRun(exact)).resolves.toMatchObject({
      status: "success",
      runId: "run_template_1",
      operationId: "agent-template-1",
    });
    await expect(runtime.createReplayRun(exact)).resolves.toMatchObject({ status: "success" });
    await expect(runtime.createReplayRun({
      source: {
        kind: "manifest",
        manifest: {
          ...DETAIL.manifest,
          consumer: { ...DETAIL.manifest.consumer, expectedHost: "api.coinbase.com" },
        },
      },
      operationId: "agent-template-1",
    })).rejects.toMatchObject({ type: "conflict", message: "Intent conflict" });
    expect(effects).toBe(5);

    const provenanceFetch = vi.fn(async () => json({
      ...DETAIL,
      manifestCanonicalJson: `${DETAIL.manifestCanonicalJson} `,
    }));
    const invalidRuntime = createOrivraMcpRuntime({
      configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
      fetch: provenanceFetch as typeof globalThis.fetch,
    });
    await expect(invalidRuntime.createReplayRun(exact))
      .rejects.toMatchObject({ type: "upstream_error", message: /provenance/i });
    expect(provenanceFetch).toHaveBeenCalledOnce();
  });

  it("keeps safe Solidity behind a resource and never returns it in compact tool output", async () => {
    const source = "contract SafeConsumer {}";
    const runtime = createOrivraMcpRuntime({
      configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
      fetch: vi.fn(async () => json({ source }, 201)) as typeof globalThis.fetch,
      randomUUID: () => "22222222-2222-4222-8222-222222222222",
    });

    const result = await runtime.generateSafeConsumer({ runId: "run_mcp_1" });
    expect(JSON.stringify(result)).not.toContain(source);
    expect(result).toMatchObject({
      status: "success",
      runId: "run_mcp_1",
      resources: [{ uri: "orivra://runs/run_mcp_1/safe-consumer" }],
    });
    await expect(runtime.readResource("orivra://runs/run_mcp_1/safe-consumer"))
      .resolves.toContain(source);
  });

  it("keeps list filters inside the bounded runs route", async () => {
    const fetch = vi.fn(async (request: string | URL | Request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/v1/runs");
      expect(url.searchParams.get("status")).toBe("active");
      expect(url.searchParams.get("cursor")).toBe("cursor_12345678");
      expect(url.searchParams.get("limit")).toBe("7");
      return json({ version: "1", runs: [] });
    });
    const runtime = createOrivraMcpRuntime({
      configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(runtime.listRuns({
      status: "active",
      cursor: "cursor_12345678",
      limit: 7,
    })).resolves.toMatchObject({ status: "success", runs: [] });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("redacts project credentials from bounded tool failures", () => {
    expect(safeMcpErrorMessage(new Error(`Bearer ${TOKEN} ${TOKEN}`), TOKEN))
      .toBe("Bearer [REDACTED] [REDACTED]");
    expect(safeMcpErrorMessage(new Error("Orivra MCP configuration is invalid"), ""))
      .toBe("Orivra MCP configuration is invalid");
  });

  it("fails closed on timeout, oversized bodies and unauthorized secret-bearing errors", async () => {
    const configuration = { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN };
    const timeoutClient = createOrivraApiClient({
      configuration,
      fetch: vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof globalThis.fetch,
    });
    await expect(timeoutClient.requestText("/runs", { timeoutMs: 1 }))
      .rejects.toMatchObject({ type: "timeout", message: "Orivra API request timed out" });

    const slowBodyClient = createOrivraApiClient({
      configuration,
      fetch: vi.fn(async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      }))) as typeof globalThis.fetch,
    });
    await expect(slowBodyClient.requestText("/runs", { timeoutMs: 1 }))
      .rejects.toMatchObject({ type: "timeout", message: "Orivra API request timed out" });

    const oversizedClient = createOrivraApiClient({
      configuration,
      fetch: vi.fn(async () => new Response("x".repeat(40), {
        headers: { "content-length": "40" },
      })) as typeof globalThis.fetch,
    });
    await expect(oversizedClient.requestText("/runs", { maxBytes: 32 }))
      .rejects.toMatchObject({ type: "upstream_error", message: /exceeded/ });

    const unauthorizedClient = createOrivraApiClient({
      configuration,
      fetch: vi.fn(async () => json({ error: { code: "UNAUTHORIZED", message: `bad ${TOKEN}` } }, 401)) as typeof globalThis.fetch,
    });
    await expect(unauthorizedClient.requestText("/runs"))
      .rejects.toMatchObject({ type: "unauthorized", message: "bad [REDACTED]" });
  });
});
