import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

for (const path of [
  "/templates",
  "/templates/open-meteo-current-weather",
  "/runs/new?template=open-meteo-current-weather&revision=1&step=source",
  "/runs/new?template=eth-usd&revision=1&step=source",
]) {
  test(`keeps the Slice 025 app deep route ${path}`, async () => {
    const calls = [];
    const response = await worker.fetch(
      new Request(`https://proofline.example${path}`, {
        headers: { accept: "text/html" },
      }),
      {
        ASSETS: {
          fetch: async (request) => {
            const url = new URL(request.url);
            calls.push(`${url.pathname}${url.search}`);
            return new Response(url.pathname === "/index.html" ? "app" : "missing", {
              status: url.pathname === "/index.html" ? 200 : 404,
            });
          },
        },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "app");
    assert.deepEqual(calls, [path, "/index.html"]);
  });
}

test("does not turn a missing same-origin template API read into the app shell", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://proofline.example/api/v1/templates", {
      headers: { accept: "application/json" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          calls.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404 });
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(calls, ["/api/v1/templates"]);
});
