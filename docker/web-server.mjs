import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.env.PROOFLINE_WEB_ROOT ?? "/srv/web");
const rawPort = process.env.PORT ?? "8080";
if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) throw new Error("Invalid Web port");
const port = Number(rawPort);
if (port > 65_535) throw new Error("Invalid Web port");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function send(response, status, body = "") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function regularFile(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() ? metadata : undefined;
  } catch {
    return undefined;
  }
}

async function serveFile(request, response, path, metadata) {
  const headers = {
    "content-length": metadata.size,
    "content-type": contentTypes.get(extname(path).toLowerCase()) ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(path).on("error", () => response.destroy()).pipe(response);
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    send(response, 405, "Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent((request.url ?? "/").split("?", 1)[0]);
  } catch {
    send(response, 400, "Invalid path");
    return;
  }
  if (pathname.includes("\0")) {
    send(response, 400, "Invalid path");
    return;
  }
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    send(response, 404, "Not found");
    return;
  }
  const metadata = await regularFile(candidate);
  if (metadata) {
    await serveFile(request, response, candidate, metadata);
    return;
  }
  if (extname(pathname)) {
    send(response, 404, "Not found");
    return;
  }
  const indexPath = resolve(root, "index.html");
  const indexMetadata = await regularFile(indexPath);
  if (!indexMetadata) {
    send(response, 404, "Not found");
    return;
  }
  await serveFile(request, response, indexPath, indexMetadata);
}).listen(port, "0.0.0.0");
