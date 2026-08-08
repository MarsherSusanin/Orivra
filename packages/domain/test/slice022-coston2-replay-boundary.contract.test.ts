// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeBundleInput } from "../../contracts/test/fixtures";
import { canonicalJson } from "../src/canonical-json";
import { createProofBundle, replayProofBundle } from "../src/proof-bundle";

describe("Slice 022 Coston2 replay boundary", () => {
  it("rejects checksum-valid Flare evidence paired with a Coston2 network snapshot", () => {
    const current = createProofBundle(makeBundleInput());
    const { checksum: _checksum, ...content } = structuredClone(current);
    content.manifest.network = "flare" as never;
    const created = content.events.find((event) => event.type === "RUN_CREATED");
    if (created?.type !== "RUN_CREATED") throw new Error("Missing RUN_CREATED");
    created.payload.manifest.network = "flare" as never;

    const checksum = `sha256:${createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex")}`;
    const serialized = canonicalJson({ ...content, checksum });

    expect(() => replayProofBundle(serialized)).toThrow(/Coston2/i);
  });
});
