import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Slice 031 pinned production HTTPS connection", () => {
  it("does not reuse a pooled socket across independently pinned DNS samples", async () => {
    const source = await readFile(
      resolve(process.cwd(), "apps/worker/src/live-runtime.ts"),
      "utf8",
    );
    const dispatch = source.slice(
      source.indexOf("function httpsDispatch"),
      source.indexOf("function calculateMerkleRoot"),
    );

    expect(dispatch).toMatch(/httpsRequest\([\s\S]*?agent:\s*false/);
    expect(dispatch).toMatch(/servername:\s*input\.url\.hostname/);
    expect(dispatch).toMatch(/address:\s*input\.pinnedAddress/);
    expect(dispatch).toMatch(/response\.socket\.remoteAddress/);
  });
});
