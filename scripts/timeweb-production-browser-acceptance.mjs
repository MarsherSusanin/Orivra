import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const PUBLIC_ORIGIN = "https://orivra.xyz";
const AXE_SOURCE_PATH = fileURLToPath(new URL("../node_modules/axe-core/axe.min.js", import.meta.url));
const CHROME_PATHS = Object.freeze([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function failure(cause) {
  return Object.assign(new Error("PRODUCTION_BROWSER_ACCEPTANCE_INVALID: Hosted browser acceptance is invalid"), {
    code: "PRODUCTION_BROWSER_ACCEPTANCE_INVALID",
    cause,
  });
}

async function chromeExecutable() {
  for (const path of CHROME_PATHS) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {}
  }
  throw new Error("Chrome executable is unavailable");
}

function observePage(page, failures) {
  page.on("console", (message) => {
    if (message.type() === "error") failures.console.push(message.text());
  });
  page.on("pageerror", (cause) => failures.console.push(String(cause)));
  page.on("requestfailed", (request) => failures.network.push(`${request.method()} ${request.url()}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== PUBLIC_ORIGIN) {
      failures.network.push(`external ${request.method()} ${url.origin}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.network.push(`${response.status()} ${response.url()}`);
  });
}

async function assertLandingGeometry(page, viewport) {
  await page.goto(PUBLIC_ORIGIN, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Verify what your Web2Json consumer actually trusts." }).waitFor();
  const input = page.getByLabel("Public HTTPS endpoint");
  const action = page.getByRole("button", { name: "Preview trust boundary" });
  for (const locator of [input, action]) {
    if (!await locator.isVisible()) throw new Error("landing control is hidden");
    const box = await locator.boundingBox();
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
      throw new Error("landing control is outside the first viewport");
    }
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
    throw new Error("horizontal overflow");
  }
}

async function assertKeyboardJourney(page) {
  await page.goto(PUBLIC_ORIGIN, { waitUntil: "networkidle", timeout: 30_000 });
  const input = page.getByLabel("Public HTTPS endpoint");
  await input.focus();
  await page.keyboard.type("https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current=temperature_2m");
  await page.keyboard.press("Enter");
  await page.getByText("Boundary derived", { exact: true }).waitFor();
  const continueButton = page.getByRole("button", { name: /Continue with wallet/ });
  await continueButton.focus();
  if (!await continueButton.evaluate((element) => element === document.activeElement)) throw new Error("keyboard focus");
}

async function axeSeriousCritical(page, axeSource) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await globalThis.axe.run(document, { resultTypes: ["violations"] });
    return result.violations.filter((entry) => entry.impact === "serious" || entry.impact === "critical").length;
  });
}

async function assertHistory(page) {
  await page.goto(PUBLIC_ORIGIN, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("link", { name: "Use a manifest template" }).click();
  await page.waitForURL(`${PUBLIC_ORIGIN}/templates`);
  await page.goBack({ waitUntil: "networkidle" });
  if (page.url() !== `${PUBLIC_ORIGIN}/`) throw new Error("back navigation");
  await page.goForward({ waitUntil: "networkidle" });
  if (page.url() !== `${PUBLIC_ORIGIN}/templates`) throw new Error("forward navigation");
  await page.reload({ waitUntil: "networkidle" });
  if (page.url() !== `${PUBLIC_ORIGIN}/templates`) throw new Error("reload navigation");
}

export function createProductionPlaywrightBrowserAdapter({ launch = chromium.launch } = {}) {
  let reportPromise;
  const report = () => reportPromise ??= (async () => {
    const browser = await launch({ executablePath: await chromeExecutable(), headless: true,
      args: ["--disable-background-networking", "--disable-component-update", "--no-default-browser-check", "--no-first-run"] });
    const failures = { console: [], network: [] };
    try {
      const axeSource = await readFile(AXE_SOURCE_PATH, "utf8");
      const desktopViewport = { width: 1440, height: 1000 };
      const mobileViewport = { width: 390, height: 844 };
      const desktopContext = await browser.newContext({ viewport: desktopViewport, colorScheme: "dark" });
      const desktop = await desktopContext.newPage(); observePage(desktop, failures);
      await assertLandingGeometry(desktop, desktopViewport);
      const desktopAxe = await axeSeriousCritical(desktop, axeSource);
      await desktopContext.close();
      const mobileContext = await browser.newContext({ viewport: mobileViewport, isMobile: true, hasTouch: true, colorScheme: "dark" });
      const mobile = await mobileContext.newPage(); observePage(mobile, failures);
      await assertLandingGeometry(mobile, mobileViewport);
      const mobileAxe = await axeSeriousCritical(mobile, axeSource);
      await mobileContext.close();
      const journeyContext = await browser.newContext({ viewport: desktopViewport, colorScheme: "dark" });
      const journey = await journeyContext.newPage(); observePage(journey, failures);
      await assertKeyboardJourney(journey);
      await assertHistory(journey);
      await journeyContext.close();
      return Object.freeze({
        desktop: { status: "passed" }, mobile: { status: "passed" }, keyboard: { status: "passed" },
        accessibility: { seriousCritical: desktopAxe + mobileAxe },
        consoleAndNetwork: { consoleErrors: failures.console.length, networkErrors: failures.network.length },
        history: { status: "passed" },
      });
    } finally {
      await browser.close();
    }
  })();
  return Object.freeze({
    desktop: async () => (await report()).desktop,
    mobile: async () => (await report()).mobile,
    keyboard: async () => (await report()).keyboard,
    accessibility: async () => (await report()).accessibility,
    consoleAndNetwork: async () => (await report()).consoleAndNetwork,
    reloadBackForward: async () => (await report()).history,
  });
}

export async function runProductionHostedBrowserAcceptance({
  activation,
  browserAdapter,
  hostAdapter,
} = {}) {
  try {
    if (activation?.status !== "passed" || activation.publicOrigin !== PUBLIC_ORIGIN ||
      !Number.isFinite(Date.parse(activation.activatedAt)) || !browserAdapter ||
      typeof hostAdapter?.appendBrowserAcceptance !== "function") throw new Error("authority");
    const [desktop, mobile, keyboard, accessibility, consoleAndNetwork, history] = await Promise.all([
      browserAdapter.desktop({ publicOrigin: PUBLIC_ORIGIN }),
      browserAdapter.mobile({ publicOrigin: PUBLIC_ORIGIN }),
      browserAdapter.keyboard({ publicOrigin: PUBLIC_ORIGIN }),
      browserAdapter.accessibility({ publicOrigin: PUBLIC_ORIGIN }),
      browserAdapter.consoleAndNetwork({ publicOrigin: PUBLIC_ORIGIN }),
      browserAdapter.reloadBackForward({ publicOrigin: PUBLIC_ORIGIN }),
    ]);
    if (desktop?.status !== "passed" || mobile?.status !== "passed" || keyboard?.status !== "passed" ||
      accessibility?.seriousCritical !== 0 || consoleAndNetwork?.consoleErrors !== 0 ||
      consoleAndNetwork.networkErrors !== 0 || history?.status !== "passed") throw new Error("checks");
    const evidence = {
      version: "1",
      kind: "hosted-browser-acceptance",
      status: "passed",
      publicOrigin: PUBLIC_ORIGIN,
      checks: {
        desktop: "passed",
        mobile: "passed",
        keyboard: "passed",
        axeSeriousCritical: 0,
        consoleErrors: 0,
        networkErrors: 0,
        reloadBackForward: "passed",
      },
    };
    const bytes = Buffer.from(canonicalJson(evidence), "utf8");
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const receipt = await hostAdapter.appendBrowserAcceptance({
      id: "append-browser-acceptance",
      canonicalBytesBase64url: bytes.toString("base64url"),
      sha256,
    });
    if (receipt?.id !== "append-browser-acceptance" || receipt.status !== "passed" || receipt.sha256 !== sha256) throw new Error("publication");
    return Object.freeze({ status: "passed", publicOrigin: PUBLIC_ORIGIN, sha256 });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_BROWSER_ACCEPTANCE_INVALID") throw cause;
    throw failure(cause);
  }
}
