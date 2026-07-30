import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8");
const originalInnerWidth = window.innerWidth;
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

function computedMobileLayout(width: number) {
  browserWindow.happyDOM.setViewport({ width, height: 844 });
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar"></aside>
      <main class="run-primary">
        <section class="next-action">
          <div class="next-action-content">
            <div class="action-footer">
              <span>Next step: Verify consumer invariants and enforcement.</span>
              <button class="bundle-action" type="button">Export bundle</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;

  return {
    shell: getComputedStyle(document.querySelector<HTMLElement>(".app-shell")!),
    navigation: getComputedStyle(document.querySelector<HTMLElement>(".sidebar")!),
    actionFooter: getComputedStyle(
      document.querySelector<HTMLElement>(".action-footer")!,
    ),
  };
}

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: originalInnerWidth, height: 768 });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("mobile fixed-navigation safe area", () => {
  it("keeps the accepted desktop action footer inline", () => {
    const layout = computedMobileLayout(1488);

    expect(layout.actionFooter.display).toBe("flex");
    expect(["", "row"]).toContain(layout.actionFooter.flexDirection);
  });

  it("does not stack the secondary action into the fixed navigation hit area", () => {
    const layout = computedMobileLayout(390);

    // These controls prove the test is exercising the fixed mobile navigation
    // plus the ADR 0010 full-footer clearance token.
    expect(layout.navigation.position).toBe("fixed");
    expect(layout.navigation.height).toBe("68px");
    expect(Number.parseFloat(layout.shell.paddingBottom)).toBeGreaterThanOrEqual(
      Number.parseFloat(layout.navigation.height) + 8,
    );

    // Root Chromium separately enforces the rendered inequality for every
    // footer child: child.bottom + 8 <= navigation.top.
    expect(layout.actionFooter.flexDirection).not.toBe("column");
  });
});
