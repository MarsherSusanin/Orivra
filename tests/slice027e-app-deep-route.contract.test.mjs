import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

const routes = [
  "/app",
  "/app/runs",
  "/app/runs/new?step=source",
  "/app/runs/run_01JYXW5ZC6K9JSGG0TQ7V8N3PH?panel=diagnostics",
  "/app/settings",
  "/runs",
  "/runs/new?step=source",
  "/runs/run_01JYXW5ZC6K9JSGG0TQ7V8N3PH",
  "/settings",
];

for (const route of routes) {
  test(`Sites compatibility serves the Orivra product route ${route}`, async () => {
    const calls = [];
    const response = await worker.fetch(
      new Request(`https://orivra.example${route}`, {
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
    assert.deepEqual(calls, [route, "/index.html"]);
  });
}

test("Sites compatibility keeps the Orivra API boundary fail-closed", async () => {
  let calls = 0;
  const response = await worker.fetch(
    new Request("https://orivra.example/api/v1/runs", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});
