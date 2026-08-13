import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/sha256");
  vi.resetModules();
});

describe("production relayer manifest defensive boundaries", () => {
  it("rejects bytes whose derived digest is not the frozen live identity", async () => {
    const actual = await vi.importActual<typeof import("../src/sha256")>("../src/sha256");
    vi.doMock("../src/sha256", () => ({ ...actual, sha256Hex: () => "0".repeat(64) }));
    const module = await import("../src/production-relayer-manifest");
    expect(() => module.getProductionRelayerManifest("open-meteo-current-weather"))
      .toThrow(/PRODUCTION_REPLAY_ALIAS_INVALID/);
  });
});
