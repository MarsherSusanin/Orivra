import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");
const originalInnerWidth = window.innerWidth;
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

function hydratedRetryLayout() {
  browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar"></aside>
      <main class="run-primary">
        <section class="next-action">
          <div class="next-action-content">
            <h2>Proof is ready.</h2>
            <p>Verify your consumer contract before consuming the attestation.</p>
            <button class="verify-button" type="button">Retry verification</button>
            <div class="action-footer">
              <span>Next step: Verify consumer invariants and enforcement.</span>
              <a class="bundle-download" href="data:application/json,{}">
                Bundle verified
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
  const shell = getComputedStyle(document.querySelector<HTMLElement>(".app-shell")!);
  const navigation = getComputedStyle(
    document.querySelector<HTMLElement>(".sidebar")!,
  );
  const footer = getComputedStyle(
    document.querySelector<HTMLElement>(".action-footer")!,
  );
  return {
    shell,
    navigation,
    footer,
    retryLabel: document.querySelector<HTMLButtonElement>(".verify-button")!
      .textContent,
    bundleLabel: document.querySelector<HTMLAnchorElement>(".bundle-download")!
      .textContent,
  };
}

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: originalInnerWidth, height: 768 });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("Slice 007 hydrated mobile navigation reserve", () => {
  it("reserves nav height plus eight pixels for worst-case retry actions", () => {
    const layout = hydratedRetryLayout();
    const navigationHeight = Number.parseFloat(layout.navigation.height);
    const shellReserve = Number.parseFloat(layout.shell.paddingBottom);

    expect(layout.retryLabel).toMatch(/Retry verification/);
    expect(layout.bundleLabel).toMatch(/Bundle verified/);
    expect(layout.navigation.position).toBe("fixed");
    expect(layout.footer.flexDirection).not.toBe("column");

    // This is the hermetic structural reserve. Root Chromium remains the
    // authority for the rendered action.bottom + 8 <= fixedNav.top inequality.
    expect(shellReserve).toBeGreaterThanOrEqual(navigationHeight + 8);
  });
});
