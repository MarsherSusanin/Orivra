import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8");
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: 1024, height: 768 });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("run discovery mobile layout", () => {
  it("stacks each run card and leaves fixed-navigation clearance at 390x844", () => {
    browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
    document.head.innerHTML = `<style>${styles}</style>`;
    document.body.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar"></aside>
        <main class="entry-layout">
          <a class="run-card"><div></div><div class="run-progress"></div><div></div></a>
        </main>
      </div>
    `;

    const shell = getComputedStyle(document.querySelector<HTMLElement>(".app-shell")!);
    const card = getComputedStyle(document.querySelector<HTMLElement>(".run-card")!);
    expect(card.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*\.run-progress\s*\{[\s\S]*grid-column:\s*1;/);
    expect(Number.parseFloat(shell.paddingBottom)).toBeGreaterThanOrEqual(76);
  });
});
