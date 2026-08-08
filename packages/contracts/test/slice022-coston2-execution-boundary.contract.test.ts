// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as Contracts from "../src/index";
import {
  OCCURRED_AT,
  PROJECT_COMMAND_ID,
  RUN_ID,
  makeBundleInput,
  validManifest,
} from "./fixtures";

function flareManifest() {
  return { ...structuredClone(validManifest), network: "flare" as const };
}

function requiredSchema(name: string) {
  const schema = (Contracts as Record<string, unknown>)[name] as
    | { safeParse(value: unknown): { success: boolean } }
    | undefined;
  expect(
    schema,
    `${name} must freeze the Coston2-only persistence and execution boundary`,
  ).toBeDefined();
  if (!schema) throw new Error(`Missing ${name}`);
  return schema;
}

describe("Slice 022 Coston2 persistence boundary", () => {
  it("recognizes Flare in the generic manifest but exports a Coston2-only executable manifest", () => {
    expect(Contracts.Web2JsonManifestV1Schema.safeParse(flareManifest()).success).toBe(
      true,
    );

    const executable = requiredSchema("Coston2Web2JsonManifestV1Schema");
    expect(executable.safeParse(validManifest).success).toBe(true);
    expect(executable.safeParse(flareManifest()).success).toBe(false);
  });

  it("does not persist a Flare manifest in RUN_CREATED", () => {
    expect(
      Contracts.RunEventV1Schema.safeParse({
        version: "1",
        runId: RUN_ID,
        sequence: 1,
        commandId: PROJECT_COMMAND_ID,
        occurredAt: OCCURRED_AT,
        type: "RUN_CREATED",
        payload: { manifest: flareManifest() },
      }).success,
    ).toBe(false);
  });

  it("rejects a Flare manifest paired with a Coston2 proof snapshot", () => {
    const bundle = makeBundleInput();
    expect(
      Contracts.ProofBundleContentV1Schema.safeParse({
        ...bundle,
        manifest: flareManifest(),
      }).success,
    ).toBe(false);

    expect(Contracts.ProofBundleContentV1Schema.safeParse(bundle).success).toBe(
      true,
    );
  });
});
