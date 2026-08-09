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
          calls.push(`${url.pathname}${url.search}`);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
            headers: url.pathname === "/index.html"
              ? { "content-type": "text/html; charset=utf-8" }
              : undefined,
          });
        },
      },
    },
  };
}

for (const path of ["/", "/?ignored=1"]) {
  test(`serves the Slice 026 app shell at ${path}`, async () => {
    const { calls, env } = assetEnvironment();
    const response = await worker.fetch(
      new Request(`https://proofline.example${path}`, {
        headers: { accept: "text/html,application/xhtml+xml" },
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "app");
    assert.deepEqual(calls, [path, "/index.html"]);
  });
}

for (const path of [
  "/demo/canonical-url",
  "/templates",
  "/templates/open-meteo-current-weather",
  "/runs",
  "/runs/new?template=eth-usd&revision=1&step=source",
]) {
  test(`preserves the accepted app route ${path}`, async () => {
    const { calls, env } = assetEnvironment();
    const response = await worker.fetch(
      new Request(`https://proofline.example${path}`, {
        headers: { accept: "text/html" },
      }),
      env,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "app");
    assert.deepEqual(calls, [path, "/index.html"]);
  });
}

test("never turns a missing same-origin landing dependency into the app shell", async () => {
  for (const path of ["/api/v1/templates", "/api/v1/demo/canonical-url"]) {
    const { calls, env } = assetEnvironment();
    const response = await worker.fetch(
      new Request(`https://proofline.example${path}`, {
        headers: { accept: "application/json,text/html" },
      }),
      env,
    );

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "missing");
    assert.deepEqual(calls, [path]);
  }
});
