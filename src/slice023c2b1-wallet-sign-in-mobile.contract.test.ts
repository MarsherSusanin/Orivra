import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: 1024, height: 768 });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("Slice 023C2B1 wallet dialog mobile contract", () => {
  it("fits 390x844 with an internally scrolling body and reachable provider actions", () => {
    browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
    document.head.innerHTML = `<style>${styles}</style>`;
    document.body.innerHTML = `
      <div class="dialog-backdrop">
        <section class="verification-dialog wallet-sign-in-dialog">
          <header class="dialog-header"></header>
          <div class="dialog-body wallet-sign-in-body">
            <div class="wallet-provider-list">
              <button class="wallet-provider-option">Wallet A</button>
              <button class="wallet-provider-option">Wallet B</button>
            </div>
            <button class="dialog-primary">Try again</button>
          </div>
        </section>
      </div>`;

    const dialog = getComputedStyle(document.querySelector<HTMLElement>(".wallet-sign-in-dialog")!);
    const body = getComputedStyle(document.querySelector<HTMLElement>(".wallet-sign-in-body")!);
    const option = getComputedStyle(document.querySelector<HTMLElement>(".wallet-provider-option")!);
    expect(Number.parseFloat(dialog.width)).toBeLessThanOrEqual(390);
    expect(dialog.maxHeight).toMatch(/(?:dvh|calc)/);
    expect(body.overflowY).toBe("auto");
    expect(option.width).not.toMatch(/^\d{3,}px$/);
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*\.wallet-sign-in-dialog/);
  });
});
