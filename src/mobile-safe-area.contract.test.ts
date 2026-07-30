import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8");
const originalInnerWidth = window.innerWidth;

function computedMobileLayout(width: number) {
  window.happyDOM.setViewport({ width, height: 844 });
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
  window.happyDOM.setViewport({ width: originalInnerWidth, height: 768 });
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

    // These controls prove the test is exercising the fixed 68px mobile navigation.
    expect(layout.navigation.position).toBe("fixed");
    expect(layout.navigation.height).toBe("68px");
    expect(layout.shell.paddingBottom).toBe("68px");

    // Root Chromium evidence measured the stacked button at y=769..801 and the
    // navigation at y=776..844. Keeping the footer inline removes the second row;
    // the browser gate separately enforces action.bottom + 8 <= navigation.top.
    expect(layout.actionFooter.flexDirection).not.toBe("column");
  });
});
