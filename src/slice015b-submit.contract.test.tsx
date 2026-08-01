import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProductEventV1,
  Web2JsonManifestDraftV1,
  Web2JsonManifestV1,
} from "../packages/contracts/src";
import {
  validComposerDraft,
  validManifest,
} from "../packages/contracts/test/fixtures";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

const DRAFT_KEY = "proofline:composer-draft:v1";
const projectToken = `project_${"a".repeat(64)}`;
const runId = "run_01JYXW5ZC6K9JSGG0TQ7V8N3PH";
const finalManifest: Web2JsonManifestV1 = {
  ...structuredClone(validManifest),
  consumer: {
    ...structuredClone(validManifest.consumer),
    expectedQuery: {
      ...structuredClone(validManifest.consumer.expectedQuery),
      window: "1h",
    },
  },
};

type CreateRunContext = {
  projectToken: string;
  manifest: Web2JsonManifestV1;
  idempotencyKey: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function services(createRun: ReturnType<typeof vi.fn>): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    createRun,
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
  } as unknown as RunSurfaceServices;
}

function collector(options: { throwOnEmit?: boolean } = {}) {
  const events: ProductEventV1[] = [];
  return {
    events,
    port: {
      emit: vi.fn((event: ProductEventV1) => {
        if (options.throwOnEmit) throw new Error("analytics unavailable");
        events.push(event);
      }),
    },
  };
}

function manifestEvents(events: readonly ProductEventV1[]) {
  return events.filter(({ name }) => name === "MANIFEST_VALIDATED");
}

function persistSubmitDraft(
  overrides: Partial<Web2JsonManifestDraftV1["fields"]> = {},
) {
  const draft = {
    ...structuredClone(validComposerDraft),
    step: "submit",
    fields: {
      ...structuredClone(validComposerDraft.fields),
      expectedQueryRows: [
        ...structuredClone(validComposerDraft.fields.expectedQueryRows),
        { id: "expected_window", key: "window", value: "1h" },
      ],
      ...overrides,
    },
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  return draft as unknown as Web2JsonManifestDraftV1;
}

function renderSubmit(input: {
  createRun: ReturnType<typeof vi.fn>;
  analytics?: ReturnType<typeof collector>["port"];
  token?: string;
}) {
  window.history.replaceState({}, "", "/runs/new?step=submit");
  return render(
    <App
      projectToken={input.token}
      services={services(input.createRun)}
      analytics={input.analytics}
    />,
  );
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 015B explicit Submit boundary", () => {
  it("requires a project connection without validating or creating implicitly", async () => {
    persistSubmitDraft();
    const createRun = vi.fn();
    const analytics = collector();
    const user = userEvent.setup();
    renderSubmit({ createRun, analytics: analytics.port });

    expect(manifestEvents(analytics.events)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /connect.*create|create preflight run/i }));
    expect(screen.getByRole("dialog", { name: /connect project/i })).toBeVisible();
    expect(createRun).not.toHaveBeenCalled();
    expect(manifestEvents(analytics.events)).toHaveLength(0);
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("emits one rejected result only from an explicit invalid action and focuses its field", async () => {
    persistSubmitDraft({ jq: "" });
    const createRun = vi.fn();
    const analytics = collector();
    const user = userEvent.setup();
    renderSubmit({ createRun, analytics: analytics.port, token: projectToken });

    expect(manifestEvents(analytics.events)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /create preflight run/i }));
    expect(manifestEvents(analytics.events)).toEqual([
      expect.objectContaining({
        name: "MANIFEST_VALIDATED",
        metadata: { outcome: "rejected" },
      }),
    ]);
    expect(createRun).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("step")).toBe("transform");
    expect(screen.getByLabelText(/jq transform/i)).toHaveFocus();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("keeps the utilitarian submission mode and canonical fee cap in the final manifest", async () => {
    persistSubmitDraft();
    const createRun = vi.fn().mockResolvedValue({
      status: "accepted",
      runId,
      location: `/v1/runs/${runId}`,
    });
    const user = userEvent.setup();
    renderSubmit({ createRun, token: projectToken });

    await user.selectOptions(screen.getByLabelText(/submission mode/i), "replay");
    const feeCap = screen.getByLabelText(/fee cap.*wei/i);
    await user.clear(feeCap);
    await user.type(feeCap, "0");
    await user.click(screen.getByRole("button", { name: /create preflight run/i }));

    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    expect((createRun.mock.calls[0][0] as CreateRunContext).manifest.submission).toEqual({
      mode: "replay",
      feeCapWei: "0",
    });
  });

  it("submits the exact final manifest once, locks duplicate clicks, clears and opens persisted preflight", async () => {
    const saved = persistSubmitDraft();
    const pending = deferred<{
      status: "accepted";
      runId: string;
      location: string;
    }>();
    const createRun = vi.fn().mockReturnValue(pending.promise);
    const analytics = collector();
    const user = userEvent.setup();
    renderSubmit({ createRun, analytics: analytics.port, token: projectToken });

    expect(screen.getByLabelText(/submission mode/i)).toHaveValue("wallet");
    expect(screen.getByLabelText(/fee cap.*wei/i)).toHaveValue(
      "20000000000000000",
    );
    const submit = screen.getByRole("button", { name: /create preflight run/i });
    await user.dblClick(submit);

    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun).toHaveBeenCalledWith({
      projectToken,
      manifest: finalManifest,
      idempotencyKey: saved.createIdempotencyKey,
    });
    expect(submit).toBeDisabled();
    expect(manifestEvents(analytics.events)).toEqual([
      expect.objectContaining({ metadata: { outcome: "accepted" } }),
    ]);

    pending.resolve({
      status: "accepted",
      runId,
      location: `/v1/runs/${runId}`,
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/runs/${runId}`);
      expect(new URLSearchParams(window.location.search).get("step")).toBe(
        "preflight",
      );
    });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("preserves one identity after an unknown response and reuses it on explicit retry after reload", async () => {
    const saved = persistSubmitDraft();
    const persistedRunIds = new Set<string>();
    const createRun = vi
      .fn()
      .mockImplementationOnce(async () => {
        persistedRunIds.add(runId);
        throw new Error(`Bearer ${projectToken} response lost`);
      })
      .mockImplementationOnce(async () => {
        persistedRunIds.add(runId);
        return {
        status: "accepted",
        runId,
        location: `/v1/runs/${runId}`,
        };
      });
    const analytics = collector();
    const user = userEvent.setup();
    const first = renderSubmit({
      createRun,
      analytics: analytics.port,
      token: projectToken,
    });

    await user.click(screen.getByRole("button", { name: /create preflight run/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be created|response lost|retry/i);
    expect(alert).not.toHaveTextContent(projectToken);
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    first.unmount();

    renderSubmit({
      createRun,
      analytics: analytics.port,
      token: projectToken,
    });
    expect(createRun).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /create preflight run/i }));
    await waitFor(() => expect(window.location.pathname).toBe(`/runs/${runId}`));

    expect(createRun).toHaveBeenCalledTimes(2);
    expect(createRun.mock.calls.map(([context]) => context.idempotencyKey)).toEqual([
      saved.createIdempotencyKey,
      saved.createIdempotencyKey,
    ]);
    expect(persistedRunIds).toEqual(new Set([runId]));
    expect(manifestEvents(analytics.events)).toHaveLength(2);
    expect(manifestEvents(analytics.events).map(({ metadata }) => metadata)).toEqual([
      { outcome: "accepted" },
      { outcome: "accepted" },
    ]);
  });

  it("lets analytics and draft-clear failures fail open after a valid persisted result", async () => {
    persistSubmitDraft();
    const createRun = vi.fn().mockResolvedValue({
      status: "accepted",
      runId,
      location: `/v1/runs/${runId}`,
    });
    const analytics = collector({ throwOnEmit: true });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderSubmit({ createRun, analytics: analytics.port, token: projectToken });

    fireEvent.click(screen.getByRole("button", { name: /create preflight run/i }));
    await waitFor(() => expect(window.location.pathname).toBe(`/runs/${runId}`));
    expect(createRun).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
  });
});
