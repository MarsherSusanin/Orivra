// @vitest-environment node

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeRequestHandler } from "../src/bootstrap";

const WEB_ORIGIN = "https://proofline.example";
const FIXED_BRIDGE_PORT = 8080;
const AUTH_PATHS = [
  "/v1/auth/wallet/challenges",
  "/v1/auth/wallet/sessions",
] as const;

type NodeBoundaryInput = {
  api: { fetch(request: Request): Promise<Response> };
  port: number;
  publicWebOrigin: string;
  authBodyDeadlineMs?: number;
};

const servers: Server[] = [];
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }));
});

function nodeBoundaryHandler(input: NodeBoundaryInput): RequestListener {
  const factory = createNodeRequestHandler as unknown as (
    options: NodeBoundaryInput,
  ) => RequestListener;
  return factory(input);
}

async function listen(input: NodeBoundaryInput): Promise<{
  server: Server;
  port: number;
}> {
  const handler = nodeBoundaryHandler(input);
  const dispatch: RequestListener = (request, response) => {
    // The current RED bridge can reject its async listener when a client drops
    // mid-body. Keep the loopback process alive so the frozen test can assert
    // that GREEN normalizes the same failure through the direct unit case.
    void Promise.resolve(handler(request, response)).catch(() => undefined);
  };
  const server = createServer();
  server.on("request", dispatch);
  // Production must use the same guarded handler for Expect: 100-continue so
  // Node cannot emit an interim 100 before header-only admission has passed.
  server.on("checkContinue", dispatch);
  servers.push(server);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }
  return { server, port: address.port };
}

async function call(input: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: input.port,
      method: input.method,
      path: input.path,
      headers: { connection: "close", ...input.headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

async function rawConnection(port: number): Promise<Socket> {
  const socket = createConnection({ host: "127.0.0.1", port });
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  await once(socket, "connect");
  return socket;
}

async function collectUntil(input: {
  socket: Socket;
  write?: string | Uint8Array;
  predicate?: (received: string) => boolean;
  timeoutMs?: number;
  endAfterWrite?: boolean;
  acceptErrorAfterPredicate?: boolean;
}): Promise<string> {
  const predicate = input.predicate ?? ((received) => received.includes("\r\n\r\n"));
  const timeoutMs = input.timeoutMs ?? 1_000;
  return new Promise((resolve, reject) => {
    let received = "";
    const cleanup = () => {
      clearTimeout(timer);
      input.socket.off("data", onData);
      input.socket.off("error", onError);
      input.socket.off("close", onClose);
    };
    const finish = () => {
      cleanup();
      resolve(received);
    };
    const onData = (chunk: Buffer) => {
      received += chunk.toString("latin1");
      if (predicate(received)) finish();
    };
    const onError = (error: Error) => {
      if (input.acceptErrorAfterPredicate && predicate(received)) {
        finish();
        return;
      }
      cleanup();
      reject(error);
    };
    const onClose = () => {
      if (predicate(received)) finish();
      else {
        cleanup();
        reject(new Error(`Socket closed before expected response: ${received}`));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for raw HTTP response: ${received}`));
    }, timeoutMs);
    input.socket.on("data", onData);
    input.socket.once("error", onError);
    input.socket.once("close", onClose);
    if (input.write !== undefined) {
      if (input.endAfterWrite) input.socket.end(input.write);
      else input.socket.write(input.write);
    }
  });
}

function hasCompleteContentLengthResponse(received: string): boolean {
  const headerEnd = received.indexOf("\r\n\r\n");
  if (headerEnd < 0) return false;
  const match = received.slice(0, headerEnd).match(/^content-length:\s*([0-9]+)\s*$/im);
  if (!match?.[1]) return false;
  const contentLength = Number(match[1]);
  return Number.isSafeInteger(contentLength) &&
    Buffer.byteLength(received.slice(headerEnd + 4), "latin1") >= contentLength;
}

async function rawExchange(port: number, request: string): Promise<string> {
  const socket = await rawConnection(port);
  return collectUntil({
    socket,
    write: request,
    endAfterWrite: true,
    predicate: (received) => received.includes("HTTP/1.1") && socket.destroyed,
  });
}

function requestHead(input: {
  method?: string;
  path?: string;
  host?: string;
  origin?: string | null;
  headers?: string[];
} = {}): string {
  const headers = [
    `${input.method ?? "POST"} ${input.path ?? AUTH_PATHS[0]} HTTP/1.1`,
    `Host: ${input.host ?? "127.0.0.1"}`,
    "Connection: close",
  ];
  if (input.origin !== null) {
    headers.push(`Origin: ${input.origin ?? WEB_ORIGIN}`);
  }
  headers.push(...(input.headers ?? []), "", "");
  return headers.join("\r\n");
}

function expectRawPrivateRejection(
  raw: string,
  status: number,
  code: string,
  cors: boolean,
) {
  expect(raw).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
  expect(raw).toContain(`"code":"${code}"`);
  expect(raw).toContain(`"message":"Request rejected"`);
  const lower = raw.toLowerCase();
  expect(lower).toContain("cache-control: no-store");
  expect(lower).toContain("referrer-policy: no-referrer");
  expect(lower).toContain("connection: close");
  if (cors) {
    expect(lower).toContain(`access-control-allow-origin: ${WEB_ORIGIN}`);
    expect(lower).toMatch(/vary:[^\r\n]*origin/);
  } else {
    expect(lower).not.toContain("access-control-allow-origin");
  }
  expect(lower).not.toContain("access-control-allow-credentials");
}

function recordingApi(status = 204) {
  const seen: Array<{ url: string; method: string; bytes: Uint8Array; body: ReadableStream | null }> = [];
  const fetch = vi.fn(async (request: Request) => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    seen.push({ url: request.url, method: request.method, bytes, body: request.body });
    return new Response(null, { status });
  });
  return { api: { fetch }, fetch, seen };
}

describe("Slice 023D2 fixed Node routing and exact public-auth scope", () => {
  it.each(AUTH_PATHS)("uses a fixed local URL base and ignores Host as proxy identity for %s with query", async (path) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const response = await call({
      port,
      method: "POST",
      path: `${path}?attempt=1`,
      headers: {
        host: "attacker.invalid:4444",
        origin: WEB_ORIGIN,
        "content-type": "application/json",
        "content-length": "2",
      },
      body: "{}",
    });
    expect(response.status).toBe(204);
    expect(recorded.seen).toEqual([expect.objectContaining({
      url: `http://127.0.0.1:${FIXED_BRIDGE_PORT}${path}?attempt=1`,
      method: "POST",
      bytes: new TextEncoder().encode("{}"),
    })]);
    expect(recorded.seen[0].url).not.toContain("attacker.invalid");
  });

  it.each([
    ["a non-auth POST", "/v1/runs"],
    ["an unknown auth POST", "/v1/auth/wallet/unknown"],
    ["a trailing-slash auth POST", "/v1/auth/wallet/challenges/"],
  ])("leaves an explicit residual %s uncapped", async (_name, path) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const body = Buffer.alloc(8_193, "r");
    const response = await call({
      port,
      method: "POST",
      path,
      headers: { "content-length": String(body.byteLength) },
      body,
    });
    expect(response.status).toBe(204);
    expect(recorded.seen).toHaveLength(1);
    expect(recorded.seen[0].bytes).toHaveLength(8_193);
  });

  it("does not apply the POST cap to another method on an auth pathname", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const body = Buffer.alloc(8_193, "p");
    const response = await call({
      port,
      method: "PUT",
      path: AUTH_PATHS[0],
      headers: { "content-length": String(body.byteLength) },
      body,
    });
    expect(response.status).toBe(204);
    expect(recorded.seen[0].bytes).toHaveLength(8_193);
  });
});

describe("Slice 023D2 header-first private rejection", () => {
  it.each([
    ["missing", null],
    ["wrong", "https://proofline.example.evil.test"],
  ])("returns 403 for a %s Origin before waiting for declared body bytes", async (_name, origin) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
      authBodyDeadlineMs: 50,
    });
    const socket = await rawConnection(port);
    const raw = await collectUntil({
      socket,
      write: requestHead({
        origin,
        headers: ["Content-Type: application/json", "Content-Length: 100"],
      }),
      timeoutMs: 300,
      predicate: (received) => socket.destroyed && received.includes("AUTH_ORIGIN_FORBIDDEN"),
    });
    expectRawPrivateRejection(raw, 403, "AUTH_ORIGIN_FORBIDDEN", false);
    expect(recorded.fetch).not.toHaveBeenCalled();
  });

  it.each(["gzip", "identity"])("rejects Content-Encoding: %s before reading any body", async (encoding) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
      authBodyDeadlineMs: 50,
    });
    const socket = await rawConnection(port);
    const raw = await collectUntil({
      socket,
      write: requestHead({ headers: [
        "Content-Type: application/json",
        `Content-Encoding: ${encoding}`,
        "Content-Length: 100",
      ] }),
      timeoutMs: 300,
      predicate: (received) => socket.destroyed && received.includes("UNSUPPORTED_CONTENT_ENCODING"),
    });
    expectRawPrivateRejection(raw, 415, "UNSUPPORTED_CONTENT_ENCODING", true);
    expect(recorded.fetch).not.toHaveBeenCalled();
  });
});

describe("Slice 023D2 exact pre-buffer byte count", () => {
  it.each(AUTH_PATHS)("accepts exactly 8192 Content-Length bytes for %s", async (path) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const body = Buffer.alloc(8_192, "x");
    const response = await call({
      port,
      method: "POST",
      path,
      headers: {
        origin: WEB_ORIGIN,
        "content-length": String(body.byteLength),
      },
      body,
    });
    expect(response.status).toBe(204);
    expect(recorded.seen[0].bytes).toHaveLength(8_192);
  });

  it.each(AUTH_PATHS)("returns 413 from headers for 8193 Content-Length bytes on %s", async (path) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
      authBodyDeadlineMs: 50,
    });
    const socket = await rawConnection(port);
    const raw = await collectUntil({
      socket,
      write: requestHead({ path, headers: ["Content-Length: 8193"] }),
      timeoutMs: 300,
      predicate: (received) => socket.destroyed && received.includes("REQUEST_BODY_TOO_LARGE"),
    });
    expectRawPrivateRejection(raw, 413, "REQUEST_BODY_TOO_LARGE", true);
    expect(recorded.fetch).not.toHaveBeenCalled();
  });

  it("accepts one exact chunked coding and counts decoded bytes at 8192", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const raw = await rawExchange(
      port,
      `${requestHead({ headers: ["Transfer-Encoding: chunked"] })}2000\r\n${"c".repeat(8_192)}\r\n0\r\n\r\n`,
    );
    expect(raw).toMatch(/^HTTP\/1\.1 204 /);
    expect(recorded.seen[0].bytes).toHaveLength(8_192);
  });

  it("stops a chunked stream on decoded byte 8193 and closes the connection", async () => {
    const recorded = recordingApi();
    const { server, port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const raw = await rawExchange(
      port,
      `${requestHead({ headers: ["Transfer-Encoding: chunked"] })}2001\r\n${"c".repeat(8_193)}\r\n0\r\n\r\n`,
    );
    expectRawPrivateRejection(raw, 413, "REQUEST_BODY_TOO_LARGE", true);
    expect(recorded.fetch).not.toHaveBeenCalled();

    await vi.waitFor(async () => {
      const count = await new Promise<number>((resolve, reject) => {
        server.getConnections((error, connections) => error ? reject(error) : resolve(connections));
      });
      expect(count).toBe(0);
    });
  });

  it("uses one absolute body deadline instead of resetting it for each chunk", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
      authBodyDeadlineMs: 80,
    });
    const socket = await rawConnection(port);
    socket.write(requestHead({ headers: ["Transfer-Encoding: chunked"] }));
    const interval = setInterval(() => {
      if (!socket.destroyed) socket.write("1\r\nx\r\n");
    }, 20);
    const stopClientWrites = () => {
      clearInterval(interval);
      if (!socket.destroyed && socket.writable) socket.end();
    };
    socket.once("data", stopClientWrites);
    try {
      const raw = await collectUntil({
        socket,
        timeoutMs: 350,
        acceptErrorAfterPredicate: true,
        predicate: (received) =>
          socket.destroyed &&
          hasCompleteContentLengthResponse(received) &&
          received.includes("REQUEST_BODY_TIMEOUT"),
      });
      expectRawPrivateRejection(raw, 408, "REQUEST_BODY_TIMEOUT", true);
      expect(recorded.fetch).not.toHaveBeenCalled();
    } finally {
      socket.off("data", stopClientWrites);
      clearInterval(interval);
      if (!socket.destroyed) socket.destroy();
    }
  });
});

describe("Slice 023D2 malformed, aborted and failed streams", () => {
  it.each([
    ["duplicate Content-Length", ["Content-Length: 1", "Content-Length: 1"], "x"],
    ["comma Content-Length", ["Content-Length: 1, 1"], "x"],
    ["Content-Length plus chunked", ["Content-Length: 1", "Transfer-Encoding: chunked"], "1\r\nx\r\n0\r\n\r\n"],
  ])("leaves llhttp to return one bare 400 for %s", async (_name, headers, body) => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const raw = await rawExchange(port, `${requestHead({ headers })}${body}`);
    expect(raw).toMatch(/^HTTP\/1\.1 400 Bad Request\r\nConnection: close\r\n\r\n$/i);
    expect((raw.match(/HTTP\/1\.1/g) ?? [])).toHaveLength(1);
    expect(raw).not.toContain("access-control-allow-origin");
    expect(recorded.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-exact transfer coding with a private 400 before dispatch", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const raw = await rawExchange(
      port,
      `${requestHead({ headers: ["Transfer-Encoding: gzip, chunked"] })}1\r\nx\r\n0\r\n\r\n`,
    );
    expectRawPrivateRejection(raw, 400, "INVALID_REQUEST_BODY", true);
    expect(recorded.fetch).not.toHaveBeenCalled();
  });

  it("does not dispatch a short Content-Length body and keeps the server usable", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const raw = await rawExchange(
      port,
      `${requestHead({ headers: ["Content-Length: 10"] })}abc`,
    );
    expect(raw).toMatch(/^HTTP\/1\.1 400 Bad Request/);
    expect(recorded.fetch).not.toHaveBeenCalled();

    const followup = await call({ port, method: "GET", path: "/v1/networks" });
    expect(followup.status).toBe(204);
    expect(recorded.fetch).toHaveBeenCalledOnce();
  });

  it("cleans up a client-aborted auth stream without dispatch or process failure", async () => {
    const recorded = recordingApi();
    const { server, port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
      authBodyDeadlineMs: 500,
    });
    const socket = await rawConnection(port);
    socket.write(`${requestHead({ headers: ["Content-Length: 8192"] })}abc`);
    socket.destroy();
    await once(socket, "close");
    await vi.waitFor(async () => {
      const count = await new Promise<number>((resolve, reject) => {
        server.getConnections((error, connections) => error ? reject(error) : resolve(connections));
      });
      expect(count).toBe(0);
    });
    expect(recorded.fetch).not.toHaveBeenCalled();
    const followup = await call({ port, method: "GET", path: "/v1/networks" });
    expect(followup.status).toBe(204);
  });

  it("normalizes an iterator error to a private 400 and destroys the failed request", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const destroy = vi.fn();
    const request = {
      method: "POST",
      url: AUTH_PATHS[0],
      headers: {
        host: "attacker.invalid",
        origin: WEB_ORIGIN,
        "content-length": "2",
      },
      destroy,
      async *[Symbol.asyncIterator]() {
        throw new Error("hostile stream detail");
      },
    } as unknown as IncomingMessage;
    const writeHead = vi.fn();
    const end = vi.fn();
    const response = { writeHead, end } as unknown as ServerResponse;
    await expect(nodeBoundaryHandler({
      api: { fetch },
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    })(request, response)).resolves.toBeUndefined();
    expect(writeHead).toHaveBeenCalledWith(400, expect.objectContaining({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": WEB_ORIGIN,
      connection: "close",
    }));
    expect(Buffer.from(end.mock.calls[0][0]).toString("utf8")).toBe(JSON.stringify({
      version: "1",
      error: { code: "INVALID_REQUEST_BODY", message: "Request rejected" },
    }));
    expect(JSON.stringify(end.mock.calls)).not.toContain("hostile stream detail");
    expect(destroy).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Slice 023D2 Expect and unchanged bodyless bridge behavior", () => {
  it("rejects oversized Expect: 100-continue without sending an interim 100", async () => {
    const recorded = recordingApi();
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const socket = await rawConnection(port);
    const raw = await collectUntil({
      socket,
      write: requestHead({ headers: [
        "Expect: 100-continue",
        "Content-Length: 8193",
      ] }),
      timeoutMs: 300,
      predicate: (received) => socket.destroyed && received.includes("REQUEST_BODY_TOO_LARGE"),
    });
    expectRawPrivateRejection(raw, 413, "REQUEST_BODY_TOO_LARGE", true);
    expect(raw).not.toContain("100 Continue");
    expect(recorded.fetch).not.toHaveBeenCalled();
  });

  it("sends one 100 Continue only after valid headers, then accepts exact bytes", async () => {
    const recorded = recordingApi(201);
    const { port } = await listen({
      api: recorded.api,
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const socket = await rawConnection(port);
    const interim = await collectUntil({
      socket,
      write: requestHead({ headers: [
        "Expect: 100-continue",
        "Content-Length: 2",
      ] }),
      timeoutMs: 300,
      predicate: (received) => received.includes("HTTP/1.1 100 Continue\r\n\r\n"),
    });
    expect(interim).toBe("HTTP/1.1 100 Continue\r\n\r\n");
    const final = await collectUntil({
      socket,
      write: "{}",
      timeoutMs: 300,
      predicate: (received) => received.includes("HTTP/1.1 201"),
    });
    expect(final).toMatch(/^HTTP\/1\.1 201 /);
    expect(recorded.seen[0].bytes).toEqual(new TextEncoder().encode("{}"));
  });

  it.each(["GET", "HEAD"])("continues to create a bodyless Fetch Request for %s", async (method) => {
    const seen = vi.fn(async (request: Request) => {
      expect(request.body).toBeNull();
      return new Response(null, { status: 204 });
    });
    const { port } = await listen({
      api: { fetch: seen },
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const response = await call({ port, method, path: "/v1/networks" });
    expect(response.status).toBe(204);
    expect(seen).toHaveBeenCalledOnce();
  });

  it.each([
    ["no framing", {}],
    ["Content-Length: 0", { "content-length": "0" }],
    ["zero chunked", { "transfer-encoding": "chunked" }],
  ])("continues to create a bodyless Fetch Request for empty DELETE with %s", async (_name, headers) => {
    const seen = vi.fn(async (request: Request) => {
      expect(request.method).toBe("DELETE");
      expect(request.body).toBeNull();
      return new Response(null, { status: 204 });
    });
    const { port } = await listen({
      api: { fetch: seen },
      port: FIXED_BRIDGE_PORT,
      publicWebOrigin: WEB_ORIGIN,
    });
    const response = await call({
      port,
      method: "DELETE",
      path: "/v1/auth/wallet/sessions/current",
      headers,
    });
    expect(response.status).toBe(204);
    expect(seen).toHaveBeenCalledOnce();
  });
});
