import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageUnavailable } from "./components/PublicLanding";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";

const repositoryRoot = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), "utf8");
}

describe("Slice 027D Orivra public Web brand", () => {
  it("publishes exact Orivra document metadata and the vector mark URL", async () => {
    const html = await source("index.html");
    expect(html).toContain('<title>Orivra · Web2Json evidence</title>');
    expect(html).toContain(
      '<meta name="description" content="Orivra — observable, verifiable Flare Data Connector runs." />',
    );
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="/src/assets/orivra-mark.svg" />',
    );
    expect(html).not.toMatch(/<title>[^<]*Proofline|content="[^"]*Proofline/);
  });

  it("uses one bounded local SVG mark without active or remote content", async () => {
    const svg = await source("src/assets/orivra-mark.svg").catch(() => "");
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toMatch(/viewBox="0 0 48 48"/);
    const content = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
    expect(content).not.toMatch(/<script|<foreignObject|<image|https?:|javascript:|on\w+=/i);
    const sidebar = await source("src/components/Sidebar.tsx");
    expect(sidebar).toContain('from "../assets/orivra-mark.svg"');
    expect(sidebar).not.toContain("proofline-mark.png");
  });

  it("renders Orivra in the persistent shell while preserving navigation", () => {
    render(
      <>
        <Sidebar active="" />
        <Topbar title="Overview" mode="overview" />
      </>,
    );
    expect(screen.getByRole("link", { name: "Orivra home" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Orivra")).toBeVisible();
    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/app/runs");
  });

  it("uses the new display name in the honest unknown-route state", () => {
    render(<PageUnavailable />);
    expect(screen.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
    expect(screen.getByText("This Orivra route is not available in this build.")).toBeVisible();
    expect(screen.queryByText(/This Proofline route/)).not.toBeInTheDocument();
  });

  it("removes the old display label from current Web sources but keeps technical symbols", async () => {
    const paths = [
      "src/App.tsx",
      "src/components/AccountSettings.tsx",
      "src/components/IntegrationPackageDialog.tsx",
      "src/components/ManifestComposerSteps.tsx",
      "src/components/PreflightWorkbench.tsx",
      "src/components/ProjectTokenDialog.tsx",
      "src/components/PublicLanding.tsx",
      "src/components/Sidebar.tsx",
      "src/components/SubmissionDecision.tsx",
      "src/components/Topbar.tsx",
      "src/components/WalletSignInDialog.tsx",
      "src/services/run-client.ts",
      "src/services/run-surface.ts",
      "src/services/wallet-access-client.ts",
    ];
    const visibleSource = (await Promise.all(paths.map(source)))
      .join("\n")
      .replaceAll("ProoflineClientError", "")
      .replaceAll("ProoflineSafeWeb2JsonConsumer", "");
    expect(visibleSource).not.toContain("Proofline");
    expect(visibleSource).toContain("Orivra");
  });
});
