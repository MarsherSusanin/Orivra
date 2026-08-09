// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_CAPABILITIES_V1,
  type NetworkCapabilityV1,
} from "@proofline/contracts";

const MODULE_PATH = "./wallet-provider-adapter";
const ADDRESS_CHECKSUM = "0xAbCdEf0123456789aBCdef0123456789AbCdEf01";
const ADDRESS = ADDRESS_CHECKSUM.toLowerCase();
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const MESSAGE = "proofline.example wants you to sign in with your Ethereum account";
const SIGNATURE = `0x${"11".repeat(65)}`;
const POISON = `project_${"f".repeat(64)}`;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

type RequestArguments = {
  method: string;
  params?: readonly unknown[] | object;
};

type Eip1193Provider = {
  request(args: RequestArguments): Promise<unknown>;
};

type ProviderOption = {
  id: string;
  name: string;
  icon: string | null;
  rdns: string | null;
  source: "eip6963" | "legacy";
  provider: Eip1193Provider;
};

type WalletConnection = {
  address: string;
  chainId: "0x72";
};

type WalletSignature = {
  address: string;
  signature: string;
};

type WalletProviderAdapter = {
  discoverProviders(): Promise<readonly ProviderOption[]>;
  connect(input: {
    provider: Eip1193Provider;
    networkCapability: NetworkCapabilityV1;
  }): Promise<WalletConnection>;
  signMessage(input: { message: string }): Promise<WalletSignature>;
  cancelPending(): void;
  close(): void;
};

type WalletProviderAdapterModule = {
  EIP6963_DISCOVERY_WINDOW_MS: 50;
  createWalletProviderAdapter(input: {
    browser: BrowserPort;
    clock: { wait(milliseconds: number): Promise<void> };
  }): WalletProviderAdapter;
};

type BrowserEvent = { type: string; detail?: unknown };
type BrowserListener = (event: BrowserEvent) => void;

type BrowserPort = {
  addEventListener(type: string, listener: BrowserListener): void;
  removeEventListener(type: string, listener: BrowserListener): void;
  dispatchEvent(event: { type: string }): boolean;
  readonly ethereum?: Eip1193Provider;
};

type AnnouncedProvider = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

async function loadModule(): Promise<WalletProviderAdapterModule> {
  return import(MODULE_PATH) as Promise<WalletProviderAdapterModule>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function provider(
  implementation: (args: RequestArguments) => unknown | Promise<unknown>,
) {
  return {
    request: vi.fn((args: RequestArguments) => Promise.resolve(implementation(args))),
  } satisfies Eip1193Provider;
}

function announcement(
  uuid: string,
  name: string,
  wallet: Eip1193Provider,
): AnnouncedProvider {
  return {
    info: {
      uuid,
      name,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      rdns: `example.${name.toLowerCase().replaceAll(" ", "-")}`,
    },
    provider: wallet,
  };
}

class FakeBrowser implements BrowserPort {
  readonly calls: string[] = [];
  readonly listeners = new Map<string, Set<BrowserListener>>();
  announcements: unknown[] = [];
  legacyReads = 0;

  constructor(private readonly legacy?: Eip1193Provider) {}

  get ethereum() {
    this.legacyReads += 1;
    return this.legacy;
  }

  addEventListener(type: string, listener: BrowserListener) {
    this.calls.push(`add:${type}`);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: BrowserListener) {
    this.calls.push(`remove:${type}`);
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string }) {
    this.calls.push(`dispatch:${event.type}`);
    if (event.type === "eip6963:requestProvider") {
      for (const detail of this.announcements) {
        for (const listener of this.listeners.get("eip6963:announceProvider") ?? []) {
          listener({ type: "eip6963:announceProvider", detail });
        }
      }
    }
    return true;
  }
}

function immediateClock() {
  return { wait: vi.fn(async (_milliseconds: number) => undefined) };
}

function expectSafeError(
  error: unknown,
  expected: {
    kind: string;
    code: string;
    retryable: boolean;
  },
) {
  expect(error).toMatchObject({
    name: "WalletProviderError",
    message: "Wallet request failed.",
    ...expected,
  });
  const serialized = JSON.stringify(error);
  expect(String(error)).not.toContain(POISON);
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("data");
  expect(error).not.toHaveProperty("providerCode");
  expect(serialized).not.toContain(POISON);
  expect(serialized).not.toContain("provider exploded");
  expect(serialized).not.toContain("stack-secret");
}

function coston2Capability() {
  return NETWORK_CAPABILITIES_V1.networks[0];
}

function flareCapability() {
  return NETWORK_CAPABILITIES_V1.networks[1];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slice 023C2A lazy provider discovery", () => {
  it("does not access a browser global, provider, event or clock on import or construction", async () => {
    vi.resetModules();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let globalReads = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        globalReads += 1;
        throw new Error("wallet global accessed before user action");
      },
    });

    try {
      const { createWalletProviderAdapter } = await loadModule();
      const browser = new FakeBrowser(provider(() => []));
      const clock = immediateClock();
      createWalletProviderAdapter({ browser, clock });

      expect(globalReads).toBe(0);
      expect(browser.calls).toEqual([]);
      expect(browser.legacyReads).toBe(0);
      expect(clock.wait).not.toHaveBeenCalled();
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("discovers, validates and first-wins deduplicates multiple EIP-6963 providers in stable order", async () => {
    const { createWalletProviderAdapter, EIP6963_DISCOVERY_WINDOW_MS } = await loadModule();
    const walletA = provider(() => null);
    const walletB = provider(() => null);
    const duplicateA = provider(() => null);
    const browser = new FakeBrowser(provider(() => null));
    browser.announcements = [
      announcement(UUID_B, "Wallet B", walletB),
      { ...announcement("not-a-uuid", "Invalid", walletA) },
      { info: announcement(UUID_A, "Broken", walletA).info, provider: {} },
      announcement(UUID_A, "Wallet A", walletA),
      announcement(UUID_A, "Duplicate A", duplicateA),
    ];
    const discoveryWindow = deferred<void>();
    const clock = { wait: vi.fn(() => discoveryWindow.promise) };
    const adapter = createWalletProviderAdapter({ browser, clock });

    const firstDiscovery = adapter.discoverProviders();
    const duplicateDiscovery = adapter.discoverProviders();
    expect(browser.calls.filter((call) => call === "dispatch:eip6963:requestProvider")).toHaveLength(1);
    discoveryWindow.resolve();
    const [discovered, duplicateResult] = await Promise.all([
      firstDiscovery,
      duplicateDiscovery,
    ]);

    expect(EIP6963_DISCOVERY_WINDOW_MS).toBe(50);
    expect(clock.wait).toHaveBeenCalledOnce();
    expect(clock.wait).toHaveBeenCalledWith(50);
    expect(browser.calls).toEqual([
      "add:eip6963:announceProvider",
      "dispatch:eip6963:requestProvider",
      "remove:eip6963:announceProvider",
    ]);
    expect(browser.listeners.get("eip6963:announceProvider")?.size).toBe(0);
    expect(browser.legacyReads).toBe(0);
    expect(discovered.map(({ id, name, icon, rdns, source }) => ({ id, name, icon, rdns, source }))).toEqual([
      {
        id: UUID_B,
        name: "Wallet B",
        icon: announcement(UUID_B, "Wallet B", walletB).info.icon,
        rdns: "example.wallet-b",
        source: "eip6963",
      },
      {
        id: UUID_A,
        name: "Wallet A",
        icon: announcement(UUID_A, "Wallet A", walletA).info.icon,
        rdns: "example.wallet-a",
        source: "eip6963",
      },
    ]);
    expect(discovered[0]?.provider).toBe(walletB);
    expect(discovered[1]?.provider).toBe(walletA);
    expect(discovered.some(({ provider }) => provider === duplicateA)).toBe(false);
    expect(duplicateResult).toEqual(discovered);
  });

  it("uses one valid legacy provider only when EIP-6963 announces no valid provider", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const legacy = provider(() => null);
    const browser = new FakeBrowser(legacy);
    browser.announcements = [{ info: { uuid: UUID_A }, provider: {} }];

    const discovered = await createWalletProviderAdapter({
      browser,
      clock: immediateClock(),
    }).discoverProviders();

    expect(browser.legacyReads).toBe(1);
    expect(discovered).toEqual([
      {
        id: "legacy-window-ethereum",
        name: "Browser wallet",
        icon: null,
        rdns: null,
        source: "legacy",
        provider: legacy,
      },
    ]);

    const malformedLegacy = new FakeBrowser({ request: "not-callable" } as unknown as Eip1193Provider);
    await expect(createWalletProviderAdapter({
      browser: malformedLegacy,
      clock: immediateClock(),
    }).discoverProviders()).resolves.toEqual([]);
  });

  it("always removes the announce listener and sanitizes a failed discovery clock", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const browser = new FakeBrowser(provider(() => null));
    const adapter = createWalletProviderAdapter({
      browser,
      clock: {
        wait: vi.fn(async () => {
          throw new Error(`provider exploded ${POISON}`);
        }),
      },
    });

    const error = await adapter.discoverProviders().catch((cause: unknown) => cause);

    expectSafeError(error, {
      kind: "provider",
      code: "WALLET_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(browser.listeners.get("eip6963:announceProvider")?.size).toBe(0);
    expect(browser.legacyReads).toBe(0);
  });
});

describe("Slice 023C2A Coston2 EOA connection and signing", () => {
  it("rejects disabled or malformed capabilities before any provider effect", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const wallet = provider(() => null);
    const adapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });

    const cases = [
      {
        networkCapability: flareCapability(),
        expected: { kind: "unsupported", code: "NETWORK_CAPABILITY_DISABLED" },
      },
      {
        networkCapability: { ...coston2Capability(), web2JsonStatus: "upstream-unsupported" },
        expected: { kind: "validation", code: "NETWORK_CAPABILITY_INVALID" },
      },
      {
        networkCapability: {
          ...coston2Capability(),
          wallet: { ...coston2Capability().wallet, chainIdHex: "0x0e" },
        },
        expected: { kind: "validation", code: "NETWORK_CAPABILITY_INVALID" },
      },
    ];
    for (const { networkCapability, expected } of cases) {
      const error = await adapter.connect({
        provider: wallet,
        networkCapability: networkCapability as NetworkCapabilityV1,
      }).catch((cause: unknown) => cause);
      expectSafeError(error, {
        ...expected,
        retryable: false,
      });
    }
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it("connects an enabled Coston2 EOA in exact order and signs only afterward", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const wallet = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [ADDRESS_CHECKSUM];
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") return "0x";
      if (method === "personal_sign") return SIGNATURE;
      throw new Error(`unexpected ${method}`);
    });
    const adapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });

    await expect(adapter.signMessage({ message: MESSAGE })).rejects.toMatchObject({
      code: "WALLET_CONNECTION_REQUIRED",
    });
    await expect(adapter.connect({
      provider: wallet,
      networkCapability: coston2Capability(),
    })).resolves.toEqual({ address: ADDRESS, chainId: "0x72" });
    await expect(adapter.signMessage({ message: MESSAGE })).resolves.toEqual({
      address: ADDRESS,
      signature: SIGNATURE,
    });

    expect(wallet.request.mock.calls).toEqual([
      [{ method: "eth_requestAccounts" }],
      [{ method: "eth_chainId" }],
      [{ method: "eth_getCode", params: [ADDRESS, "latest"] }],
      [{ method: "personal_sign", params: [MESSAGE, ADDRESS] }],
    ]);
  });

  it("switches a valid wrong chain and verifies the resulting chain before code lookup", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    let chain = "0x1";
    const wallet = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        chain = "0x72";
        return null;
      }
      if (method === "eth_getCode") return "0x";
      throw new Error(`unexpected ${method}`);
    });
    const adapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });

    await adapter.connect({ provider: wallet, networkCapability: coston2Capability() });

    expect(wallet.request.mock.calls).toEqual([
      [{ method: "eth_requestAccounts" }],
      [{ method: "eth_chainId" }],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x72" }] }],
      [{ method: "eth_chainId" }],
      [{ method: "eth_getCode", params: [ADDRESS, "latest"] }],
    ]);
  });

  it("adds exact audited Coston2 metadata on 4902 and then verifies the chain", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    let chain = "0x1";
    const wallet = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        throw { code: 4902, message: POISON, data: { stack: "stack-secret" } };
      }
      if (method === "wallet_addEthereumChain") {
        chain = "0x72";
        return null;
      }
      if (method === "eth_getCode") return "0x";
      throw new Error(`unexpected ${method}`);
    });
    const adapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });

    await adapter.connect({ provider: wallet, networkCapability: coston2Capability() });

    expect(wallet.request.mock.calls).toEqual([
      [{ method: "eth_requestAccounts" }],
      [{ method: "eth_chainId" }],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: "0x72" }] }],
      [{
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x72",
          chainName: "Coston2",
          nativeCurrency: {
            name: "Coston2 Flare",
            symbol: "C2FLR",
            decimals: 18,
          },
          rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
          blockExplorerUrls: ["https://coston2-explorer.flare.network"],
        }],
      }],
      [{ method: "eth_chainId" }],
      [{ method: "eth_getCode", params: [ADDRESS, "latest"] }],
    ]);
  });

  it("fails closed for malformed accounts, chains, wrong post-switch chains and code evidence", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const cases: Array<{
      name: string;
      replies: Record<string, unknown>;
      code: string;
      kind: string;
      retryable: boolean;
    }> = [
      {
        name: "malformed account",
        replies: { eth_requestAccounts: ["0x1234"] },
        code: "WALLET_ACCOUNT_INVALID",
        kind: "validation",
        retryable: false,
      },
      {
        name: "malformed chain",
        replies: { eth_requestAccounts: [ADDRESS], eth_chainId: "0x072" },
        code: "WALLET_CHAIN_INVALID",
        kind: "provider",
        retryable: true,
      },
      {
        name: "wrong chain after switch",
        replies: {
          eth_requestAccounts: [ADDRESS],
          eth_chainId: ["0x1", "0xe"],
          wallet_switchEthereumChain: null,
        },
        code: "WALLET_CHAIN_UNAVAILABLE",
        kind: "provider",
        retryable: true,
      },
      {
        name: "contract wallet",
        replies: { eth_requestAccounts: [ADDRESS], eth_chainId: "0x72", eth_getCode: "0x6001" },
        code: "CONTRACT_WALLET_UNSUPPORTED",
        kind: "unsupported",
        retryable: false,
      },
      {
        name: "malformed code",
        replies: { eth_requestAccounts: [ADDRESS], eth_chainId: "0x72", eth_getCode: "0x0" },
        code: "WALLET_PROVIDER_UNAVAILABLE",
        kind: "provider",
        retryable: true,
      },
    ];

    for (const item of cases) {
      const replyCount = new Map<string, number>();
      const wallet = provider(({ method }) => {
        const value = item.replies[method];
        if (Array.isArray(value) && method === "eth_chainId") {
          const index = replyCount.get(method) ?? 0;
          replyCount.set(method, index + 1);
          return value[index];
        }
        return value;
      });
      const adapter = createWalletProviderAdapter({
        browser: new FakeBrowser(),
        clock: immediateClock(),
      });
      const error = await adapter.connect({
        provider: wallet,
        networkCapability: coston2Capability(),
      }).catch((cause: unknown) => cause);
      expectSafeError(error, {
        kind: item.kind,
        code: item.code,
        retryable: item.retryable,
      });
    }
  });

  it("maps numeric 4001 at every RPC phase to one bounded rejection and never leaks provider errors", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const phases = ["eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_getCode", "personal_sign"];

    for (const rejectedMethod of phases) {
      let chain = rejectedMethod === "wallet_switchEthereumChain" || rejectedMethod === "wallet_addEthereumChain"
        ? "0x1"
        : "0x72";
      const wallet = provider(({ method }) => {
        if (method === rejectedMethod) {
          throw { code: 4001, message: `provider exploded ${POISON}`, data: POISON, stack: "stack-secret" };
        }
        if (method === "eth_requestAccounts") return [ADDRESS];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          if (rejectedMethod === "wallet_addEthereumChain") {
            throw { code: 4902, message: POISON };
          }
          chain = "0x72";
          return null;
        }
        if (method === "wallet_addEthereumChain") {
          chain = "0x72";
          return null;
        }
        if (method === "eth_getCode") return "0x";
        if (method === "personal_sign") return SIGNATURE;
        throw new Error("unexpected provider phase");
      });
      const adapter = createWalletProviderAdapter({
        browser: new FakeBrowser(),
        clock: immediateClock(),
      });

      let error: unknown;
      if (rejectedMethod === "personal_sign") {
        await adapter.connect({ provider: wallet, networkCapability: coston2Capability() });
        error = await adapter.signMessage({ message: MESSAGE }).catch((cause: unknown) => cause);
      } else {
        error = await adapter.connect({
          provider: wallet,
          networkCapability: coston2Capability(),
        }).catch((cause: unknown) => cause);
      }
      expectSafeError(error, {
        kind: "rejected",
        code: "WALLET_REQUEST_REJECTED",
        retryable: true,
      });
    }
  });

  it("maps failed code lookup and malformed signatures to bounded provider evidence", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const lookupFailure = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") {
        throw new Error(`provider exploded ${POISON}`);
      }
      return null;
    });
    const lookupAdapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });
    const lookupError = await lookupAdapter.connect({
      provider: lookupFailure,
      networkCapability: coston2Capability(),
    }).catch((cause: unknown) => cause);
    expectSafeError(lookupError, {
      kind: "provider",
      code: "WALLET_PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    const badSignature = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [OTHER_ADDRESS];
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") return "0x";
      if (method === "personal_sign") return `0x${POISON}`;
      return null;
    });
    const signatureAdapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });
    await signatureAdapter.connect({
      provider: badSignature,
      networkCapability: coston2Capability(),
    });
    const signatureError = await signatureAdapter.signMessage({ message: MESSAGE })
      .catch((cause: unknown) => cause);
    expectSafeError(signatureError, {
      kind: "provider",
      code: "WALLET_SIGNATURE_INVALID",
      retryable: true,
    });
  });

  it("single-flights duplicate actions and prevents cancelled late results from replacing a newer connection", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const firstAccounts = deferred<unknown>();
    const oldWallet = provider(({ method }) => {
      if (method === "eth_requestAccounts") return firstAccounts.promise;
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") return "0x";
      if (method === "personal_sign") return SIGNATURE;
      return null;
    });
    const signed = deferred<unknown>();
    const newWallet = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [OTHER_ADDRESS];
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") return "0x";
      if (method === "personal_sign") return signed.promise;
      return null;
    });
    const adapter = createWalletProviderAdapter({
      browser: new FakeBrowser(),
      clock: immediateClock(),
    });

    const first = adapter.connect({ provider: oldWallet, networkCapability: coston2Capability() });
    const duplicate = adapter.connect({ provider: oldWallet, networkCapability: coston2Capability() });
    expect(oldWallet.request).toHaveBeenCalledTimes(1);
    adapter.cancelPending();
    const current = adapter.connect({ provider: newWallet, networkCapability: coston2Capability() });
    firstAccounts.resolve([ADDRESS]);

    const firstError = await first.catch((cause: unknown) => cause);
    const duplicateError = await duplicate.catch((cause: unknown) => cause);
    expectSafeError(firstError, {
      kind: "cancelled",
      code: "WALLET_OPERATION_CANCELLED",
      retryable: true,
    });
    expectSafeError(duplicateError, {
      kind: "cancelled",
      code: "WALLET_OPERATION_CANCELLED",
      retryable: true,
    });
    await expect(current).resolves.toEqual({ address: OTHER_ADDRESS, chainId: "0x72" });
    const firstSign = adapter.signMessage({ message: MESSAGE });
    const duplicateSign = adapter.signMessage({ message: MESSAGE });
    expect(newWallet.request.mock.calls.filter(([args]) => args.method === "personal_sign")).toHaveLength(1);
    signed.resolve(SIGNATURE);
    await expect(firstSign).resolves.toEqual({
      address: OTHER_ADDRESS,
      signature: SIGNATURE,
    });
    await expect(duplicateSign).resolves.toEqual({
      address: OTHER_ADDRESS,
      signature: SIGNATURE,
    });
    expect(oldWallet.request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);

    adapter.close();
    const callsBeforeClosedActions = newWallet.request.mock.calls.length;
    await expect(adapter.connect({
      provider: newWallet,
      networkCapability: coston2Capability(),
    })).rejects.toMatchObject({ code: "WALLET_OPERATION_CANCELLED" });
    await expect(adapter.signMessage({ message: MESSAGE })).rejects.toMatchObject({
      code: "WALLET_OPERATION_CANCELLED",
    });
    expect(newWallet.request).toHaveBeenCalledTimes(callsBeforeClosedActions);
  });
});
