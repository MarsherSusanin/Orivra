// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createRunClient } from "./run-client";

const projectToken = `project_${"a".repeat(64)}`;

describe("run discovery client", () => {
  it("lists a filtered cursor page with the project bearer and no idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1", runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createRunClient({
      baseUrl: "https://api.proofline.test",
      projectToken,
      fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });

    await expect(client.listRuns({
      status: "active",
      cursor: "eyJ1cGRhdGVkQXQiOiIyMDI2LTA4LTAyIn0",
      limit: 7,
    })).resolves.toEqual({ version: "1", runs: [] });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain("/v1/runs?status=active&cursor=");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${projectToken}`);
    expect(headers.get("idempotency-key")).toBeNull();
  });
});
