import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

test("Sites compatibility serves the canonical URL demo deep route without weakening API fail-closed routing", async () => {
  const calls = [];
  const environment = {
    ASSETS: {
      fetch: async (request) => {
        const url = new URL(request.url);
        calls.push(`${request.method} ${url.pathname}${url.search}`);
        return new Response(url.pathname === "/index.html" ? "app" : "missing", {
          status: url.pathname === "/index.html" ? 200 : 404,
          headers: { "content-type": url.pathname === "/index.html" ? "text/html" : "text/plain" },
        });
      },
    },
  };

  const deepRoute = await worker.fetch(
    new Request("https://proofline.test/demo/canonical-url?view=evidence", {
      headers: { accept: "text/html" },
    }),
    environment,
  );
  assert.equal(deepRoute.status, 200);
  assert.deepEqual(calls, [
    "GET /demo/canonical-url?view=evidence",
    "GET /index.html",
  ]);

  calls.length = 0;
  const api = await worker.fetch(
    new Request("https://proofline.test/api/v1/demo/canonical-url", {
      headers: { accept: "text/html" },
    }),
    environment,
  );
  assert.equal(api.status, 404);
  assert.deepEqual(calls, ["GET /api/v1/demo/canonical-url"]);
});
