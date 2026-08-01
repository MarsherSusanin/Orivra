import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProductEventV1,
  Web2JsonManifestV1,
} from "../packages/contracts/src";
import {
  VALID_ABI_SIGNATURE,
  validComposerDraft,
} from "../packages/contracts/test/fixtures";
import { App } from "./App";
import type { RunSurfaceServices } from "./services/run-surface";

const DRAFT_KEY = "proofline:composer-draft:v1";
const projectToken = `project_${"a".repeat(64)}`;
const templateAbi =
  '{"components":[{"internalType":"string","name":"amount","type":"string"},{"internalType":"string","name":"currency","type":"string"}],"name":"data","type":"tuple"}';
const browserWindow = window as typeof window & {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};

function services(overrides: Record<string, unknown> = {}): RunSurfaceServices {
  return {
    listRuns: vi.fn().mockResolvedValue({ version: "1", runs: [] }),
    createRun: vi.fn(),
    verifyConsumer: vi.fn(),
    generateConsumer: vi.fn(),
    exportBundle: vi.fn(),
    replayBundle: vi.fn(),
    resume: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as RunSurfaceServices;
}

function collector() {
  const events: ProductEventV1[] = [];
  return {
    events,
    emit: vi.fn((event: ProductEventV1) => events.push(event)),
  };
}

function renderComposer(path: string, options: {
  projectToken?: string;
  services?: RunSurfaceServices;
} = {}) {
  window.history.replaceState({}, "", path);
  return render(
    <App
      projectToken={options.projectToken}
      services={options.services ?? services()}
    />,
  );
}

afterEach(() => {
  browserWindow.happyDOM.setViewport({ width: 1024, height: 768 });
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Slice 015B local Transform surface", () => {
  it("shows the ETH/USD JQ, official ABI JSON and exact local-only canonical preview", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("The browser must not fetch the source"),
    );
    renderComposer("/runs/new?template=eth-usd&step=transform");

    expect(screen.getByLabelText(/jq transform/i)).toHaveValue(
      ".data | {amount: .amount, currency: .currency}",
    );
    expect(screen.getByLabelText(/abi signature/i)).toHaveValue(templateAbi);
    const preview = screen.getByLabelText(/canonical manifest preview.*local/i);
    const manifest = JSON.parse(preview.textContent ?? "") as Web2JsonManifestV1;
    expect(manifest).toMatchObject({
      version: "1",
      attestationType: "Web2Json",
      network: "coston2",
      request: {
        url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
        jq: ".data | {amount: .amount, currency: .currency}",
        abiSignature: templateAbi,
      },
      consumer: {
        expectedHost: "api.coinbase.com",
        expectedPathPrefix: "/v2/prices/ETH-USD/spot",
      },
      submission: { mode: "replay", feeCapWei: "20000000000000000" },
    });
    expect(preview.textContent).not.toMatch(
      /createIdempotencyKey|updatedAt|sourceResponse|projectToken|errorStack/,
    );
    expect(screen.getByText(/local only/i)).toBeVisible();
    expect(screen.queryByText(/remote transform preview|source response|sample output/i)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps invalid JQ and ABI beside their fields and gates Trust", async () => {
    const user = userEvent.setup();
    renderComposer("/runs/new?template=eth-usd&step=transform");
    const jq = screen.getByLabelText(/jq transform/i);
    const abi = screen.getByLabelText(/abi signature/i);
    await user.clear(jq);
    await user.clear(abi);
    fireEvent.change(abi, { target: { value: "{uint256 value}" } });
    await user.click(screen.getByRole("button", { name: /continue to trust/i }));

    expect(jq).toHaveAttribute("aria-invalid", "true");
    expect(jq).toHaveAccessibleDescription(/jq|required/i);
    expect(abi).toHaveAttribute("aria-invalid", "true");
    expect(abi).toHaveAccessibleDescription(/json abi|descriptor/i);
    expect(new URLSearchParams(window.location.search).get("step")).toBe("transform");
    expect(screen.queryByLabelText(/canonical manifest preview/i)).not.toBeInTheDocument();

    await user.type(jq, ".data");
    await user.clear(abi);
    fireEvent.change(abi, { target: { value: templateAbi } });
    await user.click(screen.getByRole("button", { name: /continue to trust/i }));
    expect(new URLSearchParams(window.location.search).get("step")).toBe("trust");
  });

  it("keeps the mobile canonical preview in keyboard order with its local-only label", () => {
    browserWindow.happyDOM.setViewport({ width: 390, height: 844 });
    renderComposer("/runs/new?template=eth-usd&step=transform");

    const preview = screen.getByLabelText(/canonical manifest preview.*local only/i);
    expect(preview).toHaveAttribute("tabindex", "0");
    expect(preview).toHaveAccessibleName(/canonical manifest preview.*local only/i);
    expect(screen.getByText(/local only.*not remote evidence/i)).toBeVisible();
    preview.focus();
    expect(preview).toHaveFocus();
  });
});

describe("Slice 015B strict local draft recovery", () => {
  it("persists Source and Transform edits and restores the same step after reload", async () => {
    const user = userEvent.setup();
    const first = renderComposer("/runs/new?step=source");
    await user.type(
      screen.getByLabelText(/source url/i),
      "https://api.example.com/public",
    );
    await user.click(screen.getByRole("button", { name: /continue to transform/i }));
    await user.type(screen.getByLabelText(/jq transform/i), ".data");
    fireEvent.change(screen.getByLabelText(/abi signature/i), {
      target: { value: VALID_ABI_SIGNATURE },
    });

    await waitFor(() => {
      const persisted = localStorage.getItem(DRAFT_KEY);
      expect(persisted).not.toBeNull();
      expect(JSON.parse(persisted!).step).toBe("transform");
    });
    const beforeReload = localStorage.getItem(DRAFT_KEY);
    first.unmount();
    renderComposer("/runs/new?step=source");

    expect(screen.getByLabelText(/jq transform/i)).toHaveValue(".data");
    expect(screen.getByLabelText(/abi signature/i)).toHaveValue(
      VALID_ABI_SIGNATURE,
    );
    expect(screen.getByText(/draft restored/i)).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("step")).toBe("transform");
    expect(localStorage.getItem(DRAFT_KEY)).toBe(beforeReload);
  });

  it("lets a valid saved draft win over an explicit template until discard", async () => {
    const saved = {
      ...structuredClone(validComposerDraft),
      fields: {
        ...structuredClone(validComposerDraft.fields),
        sourceUrl: "https://saved.example.com/public",
        expectedHost: "saved.example.com",
        expectedPathPrefix: "/public",
        queryRows: [],
        expectedQueryRows: [],
      },
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
    const previousKey = saved.createIdempotencyKey;
    const user = userEvent.setup();
    renderComposer("/runs/new?template=eth-usd&step=source");

    expect(screen.getByLabelText(/source url/i)).toHaveValue(
      "https://saved.example.com/public",
    );
    await user.click(
      screen.getByRole("button", { name: /discard.*start eth\/usd/i }),
    );
    expect(screen.getByLabelText(/source url/i)).toHaveValue(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    );
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).createIdempotencyKey)
        .not.toBe(previousKey);
    });
  });

  it.each([
    ["corrupt", "{"],
    ["old", JSON.stringify({ ...validComposerDraft, version: "0" })],
    ["oversized", `"${"é".repeat(40_000)}"`],
  ])("rejects a %s draft as a whole and starts fresh explicitly", async (_label, raw) => {
    localStorage.setItem(DRAFT_KEY, raw);
    const user = userEvent.setup();
    renderComposer("/runs/new?step=source");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/saved draft.*could not be restored/i);
    expect(screen.queryByLabelText(/source url/i)).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /start fresh/i }));
    expect(screen.getByLabelText(/source url/i)).toHaveValue("");
    await waitFor(() => {
      const restored = JSON.parse(localStorage.getItem(DRAFT_KEY)!);
      expect(restored.version).toBe("1");
      expect(restored.createIdempotencyKey).toMatch(/^composer_/);
    });
  });

  it("keeps in-memory editing available and visible when storage writes are denied", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    renderComposer("/runs/new?step=source");
    const source = screen.getByLabelText(/source url/i);
    fireEvent.change(source, {
      target: { value: "https://api.example.com/public" },
    });

    expect(source).toHaveValue("https://api.example.com/public");
    expect(screen.getByText(/won.t survive reload|local to this tab|storage unavailable/i)).toBeVisible();
  });

  it("never copies the project token or remote evidence into persisted draft bytes", async () => {
    const analytics = collector();
    window.history.replaceState({}, "", "/runs/new?step=source");
    render(
      <App
        projectToken={projectToken}
        services={services()}
        analytics={analytics}
      />,
    );
    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://api.example.com/public" },
    });

    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull());
    const bytes = localStorage.getItem(DRAFT_KEY)!;
    expect(bytes).not.toContain(projectToken);
    expect(bytes).not.toMatch(
      /sourceResponse|verifierData|transactionHash|authorization|errorStack|privateKey/i,
    );
  });
});
