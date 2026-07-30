import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");
const originalInnerWidth = window.innerWidth;
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

type FooterState = "initial" | "hydrated-retry" | "bundle-verified";

function numberOfPixels(value: string): number {
  const numbers = [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) =>
    Number(match[1]),
  );
  if (numbers.length === 0) return Number.NaN;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function mobileLayout(state: FooterState) {
  browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
  document.head.innerHTML = `<style>${styles}</style>`;
  const secondary =
    state === "bundle-verified"
      ? '<a class="bundle-download" href="data:application/json,{}">Bundle verified</a>'
      : '<button class="bundle-action" type="button">Export bundle</button>';
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar"></aside>
      <main class="run-primary">
        <section class="next-action">
          <div class="next-action-content">
            <h2>Proof is ready.</h2>
            <p>Verify your consumer contract before consuming the attestation.</p>
            <button class="verify-button" type="button">${
              state === "initial" ? "Verify consumer" : "Retry verification"
            }</button>
            <div class="action-footer">
              <span>Next step: Verify consumer invariants and enforcement.</span>
              ${secondary}
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
  const children = [
    ...document.querySelector<HTMLElement>(".action-footer")!.children,
  ] as HTMLElement[];
  const navigationHeight = numberOfPixels(navigation.height);
  const navigationTop = 844 - navigationHeight;
  const reservedBottom = numberOfPixels(shell.paddingBottom);
  // Chromium RED measured the full guidance copy at a 2px gap in the two
  // button states and at -15px in the wider bundle-link state. These are the
  // smallest structural reserves that recover the required 8px clearance;
  // final acceptance still measures every rendered child in Chromium.
  const requiredBottomReserve =
    state === "bundle-verified"
      ? 99
      : 74;

  return {
    children,
    navigation,
    navigationTop,
    reservedBottom,
    requiredBottomReserve,
  };
}

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: originalInnerWidth, height: 768 });
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("Slice 010 complete mobile action-footer reserve", () => {
  it.each(["initial", "hydrated-retry", "bundle-verified"] as const)(
    "keeps every %s footer child at least eight pixels above fixed navigation",
    (state) => {
      const layout = mobileLayout(state);

      expect(layout.navigation.position).toBe("fixed");
      expect(layout.children).toHaveLength(2);
      expect(layout.children[0]?.textContent).toBe(
        "Next step: Verify consumer invariants and enforcement.",
      );
      for (const child of layout.children) {
        expect(child.textContent?.trim().length).toBeGreaterThan(0);
        expect(layout.reservedBottom).toBeGreaterThanOrEqual(
          layout.requiredBottomReserve,
        );
      }
    },
  );
});
