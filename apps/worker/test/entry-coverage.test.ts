// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const startProductionWorker = vi.hoisted(() =>
  vi.fn(async () => undefined),
);

vi.mock("../src/bootstrap", () => ({ startProductionWorker }));

describe("production worker executable entry", () => {
  it("delegates startup exactly once and awaits it", async () => {
    await expect(import("../src/entry")).resolves.toBeDefined();
    expect(startProductionWorker).toHaveBeenCalledOnce();
    expect(startProductionWorker).toHaveBeenCalledWith();
  });
});
