// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import { RUN_ID } from "./fixtures";

const SHARE_TOKEN = `share_${"b".repeat(64)}`;
const shareLink = {
  version: "1",
  runId: RUN_ID,
  url: `https://proofline.test/runs/${RUN_ID}#share=${SHARE_TOKEN}`,
} as const;

function shareLinkSchema() {
  const schema = (Contracts as Record<string, unknown>).ShareLinkV1Schema as
    | {
        parse(value: unknown): unknown;
        safeParse(value: unknown): { success: boolean };
      }
    | undefined;
  expect(schema, "ShareLinkV1Schema must be a public V1 schema").toBeDefined();
  if (!schema) throw new Error("ShareLinkV1Schema is missing");
  return schema;
}

describe("Slice 020B public ShareLinkV1 contract", () => {
  it("accepts only an exact run-bound fragment capability", () => {
    expect(shareLinkSchema().parse(shareLink)).toEqual(shareLink);
    const parsed = new URL(shareLink.url);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#share=${SHARE_TOKEN}`);
  });

  it.each([
    ["raw token field", { ...shareLink, token: SHARE_TOKEN }],
    [
      "query capability",
      { ...shareLink, url: `https://proofline.test/runs/${RUN_ID}?share=${SHARE_TOKEN}` },
    ],
    [
      "foreign run URL",
      { ...shareLink, url: `https://proofline.test/runs/run_other#share=${SHARE_TOKEN}` },
    ],
    [
      "extra fragment data",
      { ...shareLink, url: `${shareLink.url}&utm_source=secret` },
    ],
    [
      "short capability",
      { ...shareLink, url: `https://proofline.test/runs/${RUN_ID}#share=share_deadbeef` },
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(shareLinkSchema().safeParse(candidate).success).toBe(false);
  });
});
