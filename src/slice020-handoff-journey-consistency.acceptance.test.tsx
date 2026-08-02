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
});
