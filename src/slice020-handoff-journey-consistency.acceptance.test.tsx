import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createHermeticProoflineSystem } from "../apps/api/src/test-system";
import {
  canonicalSerializeEvidenceReceipt,
} from "../packages/domain/src";
import { validManifest } from "../packages/contracts/test/fixtures";
import { App } from "./App";
import {
  createLiveSurfaceServices,
  type RunServiceContext,
  type RunSurfaceServices,
} from "./services/run-surface";
import type {
  ConsumerLabReportV1,
  EvidenceReceiptV1,
} from "../packages/contracts/src";

const PROJECT_TOKEN = `project_${"a".repeat(64)}`;
const FAILING_REQUEST_URL =
  "https://mirror.example.net/prices/eth?currency=USD&source=primary";
const replayManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "replay" as const },
};

function projectRequest(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${PROJECT_TOKEN}`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://api.proofline.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function decodedDownload(link: HTMLElement): string {
  const href = link.getAttribute("href") ?? "";
  expect(href).toMatch(/^data:/);
  return decodeURIComponent(href.slice(href.indexOf(",") + 1));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("Slice 020 canonical hermetic handoff journey", () => {
  it("carries vulnerable evidence through safe codegen into one consistent Integration Package", async () => {
    const system = createHermeticProoflineSystem({
      projectToken: PROJECT_TOKEN,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });
    const create = await system.api.fetch(projectRequest(
      "/v1/runs",
      "POST",
      { manifest: replayManifest },
      "slice020-handoff-create",
    ));
    expect(create.status).toBe(202);
    const { runId } = await create.json() as { runId: string };
    await system.worker.drain();
    const submit = await system.api.fetch(projectRequest(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice020-handoff-submit",
    ));
    expect(submit.status).toBe(202);
    await system.worker.drain();

    const hermeticFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const response = await system.api.fetch(request);
      if (
        response.ok &&
        request.method === "POST" &&
        /\/v1\/runs\/[^/]+\/consumer-verifications$/.test(new URL(request.url).pathname)
      ) {
        await system.worker.drain();
      }
      return response;
    };
    const live = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      expectedWebOrigin: "https://proofline.test",
      fetch: hermeticFetch,
      storage: localStorage,
      recoveryStorage: sessionStorage,
    });
    let observedReceipt: EvidenceReceiptV1 | undefined;
    let observedReport: ConsumerLabReportV1 | undefined;
    let observedBundle = "";
    const services: RunSurfaceServices = {
      ...live,
      async getEvidenceReceipt(context: RunServiceContext) {
        observedReceipt = await live.getEvidenceReceipt!(context);
        return observedReceipt;
      },
      async getConsumerLabReport(context: RunServiceContext) {
        observedReport = await live.getConsumerLabReport!(context);
        return observedReport;
      },
      async exportBundle(context: RunServiceContext) {
        observedBundle = await live.exportBundle(context);
        return observedBundle;
      },
    };

    window.history.replaceState({}, "", `/runs/${runId}`);
    const user = userEvent.setup();
    render(<App projectToken={PROJECT_TOKEN} services={services} />);

    await user.click(await screen.findByRole("button", { name: /^verify consumer$/i }));
    const consumerDialog = await screen.findByRole("dialog", {
      name: /consumer verification/i,
    });
    await user.click(within(consumerDialog).getByRole("button", {
      name: /run verification/i,
    }));
    expect(await within(consumerDialog).findByText("CONSUMER_HOST_MISMATCH"))
      .toBeVisible();

    await user.click(await within(consumerDialog).findByRole("button", {
      name: /generate safe consumer/i,
    }));
    expect(await within(consumerDialog).findByText("Valid proof ≠ trusted URL"))
      .toBeVisible();
    await user.click(within(consumerDialog).getByRole("button", {
      name: /^verify generated consumer$/i,
    }));
    const handoff = await within(consumerDialog).findByRole("button", {
      name: /open integration package/i,
    });
    await user.click(handoff);

    const integration = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    await waitFor(() => {
      expect(observedReceipt).toBeDefined();
      expect(observedReport).toBeDefined();
      expect(observedBundle).not.toBe("");
    });
    expect.soft(observedReport!.passed).toBe(observedReceipt!.consumerResult.passed);
    expect.soft(observedReport!.consumerIdentity).toBe("canonical-vulnerable");
    expect.soft(
      observedReport!.diagnostics.map(({ code }) => code).sort(),
    ).toEqual([...observedReceipt!.consumerResult.diagnosticCodes].sort());
    const hostDiagnostic = observedReport!.diagnostics.find(
      ({ code }) => code === "CONSUMER_HOST_MISMATCH",
    );
    expect.soft(hostDiagnostic?.evidence).toMatchObject({
      actual: "mirror.example.net",
      requestUrl: FAILING_REQUEST_URL,
    });
    const observedChecks = Object.fromEntries(
      observedReport!.checks.map(({ invariant, observed }) => [invariant, observed]),
    );
    expect.soft(observedChecks).toEqual({
      scheme: "https",
      host: "mirror.example.net",
      path: "/prices/eth",
      query: "currency=USD&source=primary",
    });
    expect.soft(hostDiagnostic?.evidence.actual).toBe(observedChecks.host);
    expect.soft(
      new URL(String(hostDiagnostic?.evidence.requestUrl)).hostname,
    ).toBe(observedChecks.host);

    const expectedDownloads = [
      ["receipt", `${runId}.receipt.json`, canonicalSerializeEvidenceReceipt(observedReceipt!)],
      ["bundle", `${runId}.proofline.json`, observedBundle],
      ["manifest", `${runId}.manifest.json`, JSON.stringify(replayManifest)],
      ["Solidity", `${observedReport!.safeConsumer.contractName}.sol`, observedReport!.safeConsumer.source],
    ] as const;
    for (const [label, filename, bytes] of expectedDownloads) {
      const link = await within(integration).findByRole("link", {
        name: new RegExp(`download ${label}`, "i"),
      });
      expect(link).toHaveAttribute("download", filename);
      expect(decodedDownload(link)).toBe(bytes);
    }
    expect(integration).toHaveTextContent(
      `node packages/cli/dist/index.js replay ${runId}.proofline.json`,
    );
    expect(integration).toHaveTextContent("uses: ./packages/action");
    expect(integration).toHaveTextContent(`manifest: ${runId}.manifest.json`);
    expect(integration).toHaveTextContent(`bundle: ${runId}.proofline.json`);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /integration package/i }))
      .not.toBeInTheDocument();
    const resumeAction = screen.getByRole("button", {
      name: /^resume consumer lab$/i,
    });
    expect(resumeAction).toBeVisible();
    expect(resumeAction).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  }, 15_000);

  it("restores persisted safe codegen after reload without rerunning terminal verification", async () => {
    const system = createHermeticProoflineSystem({
      projectToken: PROJECT_TOKEN,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });
    const create = await system.api.fetch(projectRequest(
      "/v1/runs",
      "POST",
      { manifest: replayManifest },
      "slice020-reload-create",
    ));
    const { runId } = await create.json() as { runId: string };
    await system.worker.drain();
    await system.api.fetch(projectRequest(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice020-reload-submit",
    ));
    await system.worker.drain();

    let consumerVerificationPosts = 0;
    const hermeticFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const consumerVerification =
        request.method === "POST" &&
        /\/v1\/runs\/[^/]+\/consumer-verifications$/.test(new URL(request.url).pathname);
      if (consumerVerification) consumerVerificationPosts += 1;
      const response = await system.api.fetch(request);
      if (response.ok && consumerVerification) await system.worker.drain();
      return response;
    };
    const createServices = () => createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      expectedWebOrigin: "https://proofline.test",
      fetch: hermeticFetch,
      storage: localStorage,
      recoveryStorage: sessionStorage,
    });

    window.history.replaceState({}, "", `/runs/${runId}`);
    const user = userEvent.setup();
    const firstServices = createServices();
    const firstSession = render(
      <App projectToken={PROJECT_TOKEN} services={firstServices} />,
    );
    await user.click(await screen.findByRole("button", { name: /^verify consumer$/i }));
    const consumerDialog = await screen.findByRole("dialog", {
      name: /consumer verification/i,
    });
    await user.click(within(consumerDialog).getByRole("button", {
      name: /run verification/i,
    }));
    expect(await within(consumerDialog).findByText("CONSUMER_HOST_MISMATCH"))
      .toBeVisible();
    await user.click(await within(consumerDialog).findByRole("button", {
      name: /generate safe consumer/i,
    }));
    expect(await within(consumerDialog).findByText("Valid proof ≠ trusted URL"))
      .toBeVisible();
    const persistedReport = await firstServices.getConsumerLabReport!({
      runId,
      projectToken: PROJECT_TOKEN,
    });
    await user.click(within(consumerDialog).getByRole("button", {
      name: /close consumer verification/i,
    }));
    firstSession.unmount();
    expect(consumerVerificationPosts).toBe(1);

    window.history.replaceState({}, "", `/runs/${runId}`);
    const reloadedServices = createServices();
    render(<App projectToken={PROJECT_TOKEN} services={reloadedServices} />);
    const resumeAction = await screen.findByRole("button", {
      name: /^(?:resume consumer lab|open consumer lab|open integration package)$/i,
    });
    expect(screen.getAllByRole("button", {
      name: /^(?:resume consumer lab|open consumer lab|open integration package)$/i,
    })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /retry verification/i }))
      .not.toBeInTheDocument();
    expect(consumerVerificationPosts).toBe(1);

    const opensIntegration = /integration package/i.test(
      resumeAction.textContent ?? "",
    );
    await user.click(resumeAction);
    if (!opensIntegration) {
      const resumedLab = await screen.findByRole("dialog", {
        name: /consumer (?:verification|lab)/i,
      });
      expect(await within(resumedLab).findByText("Valid proof ≠ trusted URL"))
        .toBeVisible();
      const safeDownload = within(resumedLab).getByRole("link", {
        name: /download .sol/i,
      });
      expect(decodedDownload(safeDownload)).toBe(persistedReport.safeConsumer.source);
      await user.click(within(resumedLab).getByRole("button", {
        name: /open integration package/i,
      }));
    }

    const integration = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    expect(await within(integration).findByRole("link", {
      name: /download receipt/i,
    })).toBeVisible();
    const safeDownload = within(integration).getByRole("link", {
      name: /download solidity/i,
    });
    expect(decodedDownload(safeDownload)).toBe(persistedReport.safeConsumer.source);
    expect(integration).toHaveTextContent(
      `node packages/cli/dist/index.js replay ${runId}.proofline.json`,
    );
    expect(consumerVerificationPosts).toBe(1);
  }, 15_000);

  it("resumes terminal vulnerable evidence before codegen without rerunning verification", async () => {
    const system = createHermeticProoflineSystem({
      projectToken: PROJECT_TOKEN,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });
    const create = await system.api.fetch(projectRequest(
      "/v1/runs",
      "POST",
      { manifest: replayManifest },
      "slice020-before-codegen-create",
    ));
    const { runId } = await create.json() as { runId: string };
    await system.worker.drain();
    await system.api.fetch(projectRequest(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice020-before-codegen-submit",
    ));
    await system.worker.drain();

    let consumerVerificationPosts = 0;
    const hermeticFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const consumerVerification =
        request.method === "POST" &&
        /\/v1\/runs\/[^/]+\/consumer-verifications$/.test(new URL(request.url).pathname);
      if (consumerVerification) consumerVerificationPosts += 1;
      const response = await system.api.fetch(request);
      if (response.ok && consumerVerification) await system.worker.drain();
      return response;
    };
    const createServices = () => createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      expectedWebOrigin: "https://proofline.test",
      fetch: hermeticFetch,
      storage: localStorage,
      recoveryStorage: sessionStorage,
    });

    window.history.replaceState({}, "", `/runs/${runId}`);
    const user = userEvent.setup();
    const firstSession = render(
      <App projectToken={PROJECT_TOKEN} services={createServices()} />,
    );
    await user.click(await screen.findByRole("button", { name: /^verify consumer$/i }));
    const consumerDialog = await screen.findByRole("dialog", {
      name: /consumer verification/i,
    });
    await user.click(within(consumerDialog).getByRole("button", {
      name: /run verification/i,
    }));
    expect(await within(consumerDialog).findByText("CONSUMER_HOST_MISMATCH"))
      .toBeVisible();
    await user.click(within(consumerDialog).getByRole("button", {
      name: /close consumer verification/i,
    }));
    firstSession.unmount();
    expect(consumerVerificationPosts).toBe(1);

    window.history.replaceState({}, "", `/runs/${runId}`);
    render(<App projectToken={PROJECT_TOKEN} services={createServices()} />);
    const resumeAction = await screen.findByRole("button", {
      name: /^(?:resume consumer lab|open consumer lab)$/i,
    });
    expect(screen.getAllByRole("button", {
      name: /^(?:resume consumer lab|open consumer lab)$/i,
    })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /retry verification/i }))
      .not.toBeInTheDocument();
    expect(consumerVerificationPosts).toBe(1);

    await user.click(resumeAction);
    const resumedLab = await screen.findByRole("dialog", {
      name: /consumer (?:verification|lab)/i,
    });
    expect(within(resumedLab).queryByRole("button", {
      name: /run verification|retry verification/i,
    })).not.toBeInTheDocument();
    expect(await within(resumedLab).findByText("CONSUMER_HOST_MISMATCH"))
      .toBeVisible();
    expect(consumerVerificationPosts).toBe(1);

    await user.click(within(resumedLab).getByRole("button", {
      name: /generate safe consumer/i,
    }));
    expect(await within(resumedLab).findByText("Valid proof ≠ trusted URL"))
      .toBeVisible();
    const persistedReport = await createServices().getConsumerLabReport!({
      runId,
      projectToken: PROJECT_TOKEN,
    });
    await user.click(within(resumedLab).getByRole("button", {
      name: /^verify generated consumer$/i,
    }));
    await user.click(await within(resumedLab).findByRole("button", {
      name: /open integration package/i,
    }));

    const integration = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    expect(await within(integration).findByRole("link", {
      name: /download receipt/i,
    })).toBeVisible();
    const safeDownload = within(integration).getByRole("link", {
      name: /download solidity/i,
    });
    expect(decodedDownload(safeDownload)).toBe(persistedReport.safeConsumer.source);
    expect(integration).toHaveTextContent(
      `node packages/cli/dist/index.js replay ${runId}.proofline.json`,
    );
    expect(consumerVerificationPosts).toBe(1);
  }, 15_000);

  it("hands exact failed-vulnerable evidence to a fragment share recipient without mutations", async () => {
    const system = createHermeticProoflineSystem({
      projectToken: PROJECT_TOKEN,
      fixture: "web2json-host-invariant",
      now: "2025-05-15T12:04:11.000Z",
    });
    const create = await system.api.fetch(projectRequest(
      "/v1/runs",
      "POST",
      { manifest: replayManifest },
      "slice020-share-recipient-create",
    ));
    const { runId } = await create.json() as { runId: string };
    await system.worker.drain();
    await system.api.fetch(projectRequest(
      `/v1/runs/${runId}/submissions`,
      "POST",
      { mode: "replay" },
      "slice020-share-recipient-submit",
    ));
    await system.worker.drain();

    const mutations = {
      consumerVerification: 0,
      consumerCodegen: 0,
      replay: 0,
      share: 0,
    };
    const hermeticFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      if (request.method === "POST") {
        if (/\/consumer-verifications$/.test(pathname)) mutations.consumerVerification += 1;
        if (/\/artifacts\/consumer$/.test(pathname)) mutations.consumerCodegen += 1;
        if (pathname === "/v1/replays") mutations.replay += 1;
        if (/\/share$/.test(pathname)) mutations.share += 1;
      }
      const response = await system.api.fetch(request);
      if (
        response.ok &&
        request.method === "POST" &&
        /\/consumer-verifications$/.test(pathname)
      ) {
        await system.worker.drain();
      }
      return response;
    };
    const projectServices = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: PROJECT_TOKEN,
      expectedWebOrigin: "https://proofline.test",
      fetch: hermeticFetch,
      storage: localStorage,
      recoveryStorage: sessionStorage,
    });

    window.history.replaceState({}, "", `/runs/${runId}`);
    const user = userEvent.setup();
    const ownerSession = render(
      <App projectToken={PROJECT_TOKEN} services={projectServices} />,
    );
    await user.click(await screen.findByRole("button", { name: /^verify consumer$/i }));
    const consumerLab = await screen.findByRole("dialog", {
      name: /consumer verification/i,
    });
    await user.click(within(consumerLab).getByRole("button", {
      name: /run verification/i,
    }));
    expect(await within(consumerLab).findByText("CONSUMER_HOST_MISMATCH"))
      .toBeVisible();
    await user.click(within(consumerLab).getByRole("button", {
      name: /generate safe consumer/i,
    }));
    await user.click(await within(consumerLab).findByRole("button", {
      name: /^verify generated consumer$/i,
    }));
    await user.click(await within(consumerLab).findByRole("button", {
      name: /open integration package/i,
    }));
    const ownerIntegration = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    await within(ownerIntegration).findByRole("link", { name: /download receipt/i });
    await user.click(within(ownerIntegration).getByRole("button", {
      name: /create read-only share link/i,
    }));
    const shareLink = await within(ownerIntegration).findByRole("link", {
      name: /open read-only share/i,
    });
    const shareUrl = shareLink.getAttribute("href") ?? "";
    const parsedShareUrl = new URL(shareUrl);
    const shareToken = parsedShareUrl.hash.slice("#share=".length);
    expect(shareToken).toMatch(/^share_[a-f0-9]{64}$/);

    const context = { runId, projectToken: PROJECT_TOKEN };
    const [persistedReceipt, persistedReport, persistedBundle] = await Promise.all([
      projectServices.getEvidenceReceipt!(context),
      projectServices.getConsumerLabReport!(context),
      projectServices.exportBundle(context),
    ]);
    const expectedMutations = { ...mutations };
    expect(expectedMutations).toEqual({
      consumerVerification: 1,
      consumerCodegen: 1,
      replay: 0,
      share: 1,
    });

    ownerSession.unmount();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(
      {},
      "",
      `${parsedShareUrl.pathname}${parsedShareUrl.hash}`,
    );
    const recipientServices = createLiveSurfaceServices({
      baseUrl: "https://api.proofline.test",
      projectToken: shareToken,
      expectedWebOrigin: "https://proofline.test",
      fetch: hermeticFetch,
      storage: localStorage,
      recoveryStorage: sessionStorage,
    });
    render(<App services={recipientServices} />);

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem(`proofline:share-token:${runId}`)).toBe(shareToken);
    const recipientAction = await screen.findByRole("button", {
      name: /^open integration package$/i,
    });
    expect(screen.getAllByRole("button", {
      name: /^open integration package$/i,
    })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /verify consumer/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate safe consumer/i }))
      .not.toBeInTheDocument();

    await user.click(recipientAction);
    const recipientIntegration = await screen.findByRole("dialog", {
      name: /integration package/i,
    });
    const expectedDownloads = [
      ["receipt", `${runId}.receipt.json`, canonicalSerializeEvidenceReceipt(persistedReceipt)],
      ["bundle", `${runId}.proofline.json`, persistedBundle],
      ["manifest", `${runId}.manifest.json`, JSON.stringify(replayManifest)],
      ["Solidity", `${persistedReport.safeConsumer.contractName}.sol`, persistedReport.safeConsumer.source],
    ] as const;
    for (const [label, filename, bytes] of expectedDownloads) {
      const link = await within(recipientIntegration).findByRole("link", {
        name: new RegExp(`download ${label}`, "i"),
      });
      expect(link).toHaveAttribute("download", filename);
      expect(decodedDownload(link)).toBe(bytes);
    }
    expect(within(recipientIntegration).getByText(/read-only shared run/i))
      .toBeVisible();
    expect(within(recipientIntegration).queryByRole("button", {
      name: /create.*share|verify|generate|replay bundle/i,
    })).not.toBeInTheDocument();
    expect(mutations).toEqual(expectedMutations);
  }, 15_000);
});
