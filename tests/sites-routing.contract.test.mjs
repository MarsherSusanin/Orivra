import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

function assetEnvironment() {
  const calls = [];
  return {
    calls,
    env: {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}${url.search}`);
          if (url.pathname === "/index.html") {
            return new Response("<!doctype html><title>Proofline</title>", {
              status: 200,
              headers: { "content-type": "text/html" },
            });
          }
          return new Response("missing", { status: 404 });
        },
      },
    },
  };
}

test("never gives SPA fallback to /api, even when a client accepts HTML", async () => {
  const { calls, env } = assetEnvironment();
  const response = await worker.fetch(
    new Request("https://proofline.test/api/v1/runs/missing", {
      headers: { accept: "text/html,application/xhtml+xml" },
    }),
    env,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["GET /api/v1/runs/missing"]);
});

test("never gives SPA fallback to missing asset-like paths", async () => {
  for (const path of ["/assets/missing.js", "/favicon.ico", "/proofline.css.map"]) {
    const { calls, env } = assetEnvironment();
    const response = await worker.fetch(
      new Request(`https://proofline.test${path}`, {
        headers: { accept: "text/html,*/*" },
      }),
      env,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(calls, [`GET ${path}`]);
  }
});

test("preserves deep route query on the first asset lookup but strips it from index fallback", async () => {
  const { calls, env } = assetEnvironment();
  const response = await worker.fetch(
    new Request("https://proofline.test/runs/run_1?share=opaque", {
      headers: { accept: "text/html" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["GET /runs/run_1?share=opaque", "GET /index.html"]);
});
