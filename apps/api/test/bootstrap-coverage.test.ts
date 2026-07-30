// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createNodeRequestHandler,
  createProductionApi,
} from "../src/bootstrap";

function incoming(input: {
  method?: string;
  url?: string;
  host?: string;
  chunks?: Uint8Array[];
}) {
  return {
    method: input.method,
    url: input.url,
    headers: input.host ? { host: input.host } : {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of input.chunks ?? []) yield chunk;
    },
  } as any;
}

function outgoing() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any;
}

describe("production API bootstrap", () => {
  it.each([undefined, "0", "65536", "1.5", "not-a-port"])(
    "rejects invalid port %j",
    (port) => {
      expect(() =>
        createProductionApi({
          environment: {
            PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
            ...(port === undefined ? { PORT: "" } : { PORT: port }),
          },
          pool: { query: vi.fn() } as any,
        }),
      ).toThrow(port === undefined ? /PORT/ : /PORT/);
    },
  );

  it("requires the digest key and applies default/custom bootstrap values", () => {
    expect(() =>
      createProductionApi({ environment: {}, pool: { query: vi.fn() } as any }),
    ).toThrow(/PROOFLINE_TOKEN_DIGEST_KEY/);
    const pool = { query: vi.fn() } as any;
    expect(
      createProductionApi({
        environment: { PROOFLINE_TOKEN_DIGEST_KEY: "digest-key" },
        pool,
      }),
    ).toMatchObject({ pool, port: 8080 });
    expect(
      createProductionApi({
        environment: {
          PROOFLINE_TOKEN_DIGEST_KEY: "digest-key",
          PROOFLINE_WEB_ORIGIN: "https://custom.invalid",
          PORT: "9090",
        },
        pool,
      }),
    ).toMatchObject({ port: 9090 });
  });

  it.each([
    ["project", { kind: "project", project_id: "project-1", run_id: null }, 200],
    ["share", { kind: "share", project_id: "project-1", run_id: "run-1" }, 404],
    ["missing", undefined, 401],
  ])("authenticates a %s token without exposing its raw value", async (_label, authRow, status) => {
    let queryCount = 0;
    const query = vi.fn(async (text: string) => {
      queryCount += 1;
      if (/FROM proofline_private\.api_tokens/i.test(text)) {
        return { rowCount: authRow ? 1 : 0, rows: authRow ? [authRow] : [] };
      }
      if (/SELECT projection/i.test(text)) {
        return authRow?.kind === "project"
          ? { rowCount: 1, rows: [{ projection: { runId: "run-1" } }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    const { api } = createProductionApi({
      environment: { PROOFLINE_TOKEN_DIGEST_KEY: "digest-key" },
      pool: { query } as any,
    });
    const rawToken = `${authRow?.kind === "share" ? "share" : "project"}_${"c".repeat(64)}`;
    const response = await api.fetch(
      new Request("https://proofline.test/v1/runs/run-1", {
        headers: { authorization: `Bearer ${rawToken}` },
      }),
    );
    expect(response.status).toBe(status);
    expect(JSON.stringify(query.mock.calls)).not.toContain(rawToken);
    expect(queryCount).toBeGreaterThan(0);
  });
});

describe("Node request bridge", () => {
  it.each(["GET", "HEAD"])("forwards %s without a request body", async (method) => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("http://proofline.local/v1/runs/run-1");
      expect(await request.text()).toBe("");
      return new Response("ok", {
        status: 202,
        headers: { "x-proofline": "accepted" },
      });
    });
    const response = outgoing();
    await createNodeRequestHandler({ api: { fetch }, port: 8080 })(
      incoming({ method, url: "/v1/runs/run-1", host: "proofline.local" }),
      response,
    );
    expect(response.writeHead).toHaveBeenCalledWith(
      202,
      expect.objectContaining({ "x-proofline": "accepted" }),
    );
    expect(Buffer.from(response.end.mock.calls[0][0]).toString()).toBe("ok");
  });

  it("forwards a POST body and uses safe URL/host fallbacks", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("http://127.0.0.1:8080/");
      expect(await request.json()).toEqual({ mode: "wallet" });
      return Response.json({ accepted: true }, { status: 201 });
    });
    const response = outgoing();
    await createNodeRequestHandler({ api: { fetch }, port: 8080 })(
      incoming({
        method: "POST",
        chunks: [new TextEncoder().encode('{"mode":"'), new TextEncoder().encode('wallet"}')],
      }),
      response,
    );
    expect(response.writeHead).toHaveBeenCalledWith(
      201,
      expect.objectContaining({ "content-type": expect.stringContaining("application/json") }),
    );
  });
});
