// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  NETWORK_CAPABILITIES_V1,
  type NetworkCapabilityV1,
} from "@proofline/contracts";
import type {
  BrowserPort,
  Eip1193Provider,
  RequestArguments,
  WalletProviderAdapter,
} from "./wallet-provider-adapter";

const MODULE_PATH = "./wallet-provider-adapter";
const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const MESSAGE_A = "server-authored challenge A";
const MESSAGE_B = "server-authored challenge B";
const SIGNATURE_A = `0x${"11".repeat(65)}`;
const SIGNATURE_B = `0x${"22".repeat(65)}`;
const POISON = `project_${"f".repeat(64)}`;
const ATTACKER_RPC = "https://attacker.example/rpc";

type WalletProviderErrorConstructor = new (input: {
  kind: "validation" | "unsupported" | "provider" | "rejected" | "cancelled";
  code: string;
  retryable: boolean;
}) => Error & Record<string, unknown>;

type AdapterModule = typeof import("./wallet-provider-adapter") & {
  WalletProviderError?: WalletProviderErrorConstructor;
};

async function loadModule(): Promise<AdapterModule> {
  return import(MODULE_PATH) as Promise<AdapterModule>;
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

function browser(): BrowserPort {
  const listeners = new Set<(event: { type: string; detail?: unknown }) => void>();
  return {
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
    dispatchEvent: vi.fn(() => true),
  };
}

function clock() {
  return { wait: vi.fn(async () => undefined) };
}

function adapter(
  createWalletProviderAdapter: AdapterModule["createWalletProviderAdapter"],
  overrides: Partial<Parameters<typeof createWalletProviderAdapter>[0]> = {},
) {
  return createWalletProviderAdapter({
    browser: overrides.browser ?? browser(),
    clock: overrides.clock ?? clock(),
  });
}

function coston2(): NetworkCapabilityV1 {
  return NETWORK_CAPABILITIES_V1.networks[0];
}

function flare(): NetworkCapabilityV1 {
  return NETWORK_CAPABILITIES_V1.networks[1];
}

function expectBoundedError(
  error: unknown,
  expected: { kind: string; code: string; retryable: boolean },
) {
  expect(error).toMatchObject({
    name: "WalletProviderError",
    message: "Wallet request failed.",
    ...expected,
  });
  expect(String(error)).toBe("WalletProviderError: Wallet request failed.");
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("data");
  expect(error).not.toHaveProperty("rawCode");
  const serialized = JSON.stringify(error);
  expect(serialized).not.toContain(POISON);
  expect(serialized).not.toContain("RAW_PROVIDER_CODE");
  expect(serialized).not.toContain("provider exploded");
  expect(serialized).not.toContain("stack-secret");
}

function successfulProvider(input: {
  address?: string;
  signature?: unknown | Promise<unknown>;
  accounts?: unknown | Promise<unknown>;
}) {
  return provider(({ method }) => {
    if (method === "eth_requestAccounts") {
      return input.accounts ?? [input.address ?? ADDRESS_A];
    }
    if (method === "eth_chainId") return "0x72";
    if (method === "eth_getCode") return "0x";
    if (method === "personal_sign") return input.signature ?? SIGNATURE_A;
    throw new Error(`unexpected ${method}`);
  });
}

async function connect(
  walletAdapter: WalletProviderAdapter,
  selectedProvider: Eip1193Provider,
) {
  return walletAdapter.connect({
    provider: selectedProvider,
    networkCapability: coston2(),
  });
}

describe("Slice 023C2A corrective external error boundary", () => {
  it("normalizes forged, mutated and hostile provider values at discovery, connect and sign boundaries", async () => {
    const module = await loadModule();
    const forged = module.WalletProviderError
      ? new module.WalletProviderError({
          kind: "provider",
          code: "RAW_PROVIDER_CODE",
          retryable: false,
        })
      : Object.assign(new Error("Wallet request failed."), {
          name: "WalletProviderError",
          kind: "provider",
          code: "RAW_PROVIDER_CODE",
          retryable: false,
        });
    Object.assign(forged, {
      message: `provider exploded ${POISON}`,
      code: "RAW_PROVIDER_CODE",
      cause: { data: POISON },
      data: POISON,
      rawCode: POISON,
    });
    expect((forged as { code?: unknown }).code).toBe("RAW_PROVIDER_CODE");

    const hostileProxy = new Proxy({ secret: POISON }, {
      getPrototypeOf() {
        throw new Error(`stack-secret ${POISON}`);
      },
      get(_target, property) {
        if (property === "code") throw new Error(`provider exploded ${POISON}`);
        return Reflect.get(_target, property);
      },
    });

    const discoveryAdapter = adapter(module.createWalletProviderAdapter, {
      clock: { wait: vi.fn(async () => { throw forged; }) },
    });
    const discoveryError = await discoveryAdapter.discoverProviders()
      .catch((cause: unknown) => cause);
    expect(discoveryError).not.toBe(forged);
    expectBoundedError(discoveryError, {
      kind: "provider",
      code: "WALLET_PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    for (const externalCause of [forged, hostileProxy]) {
      const selectedProvider = provider(() => { throw externalCause; });
      const connectionAdapter = adapter(module.createWalletProviderAdapter);
      const connectionError = await connect(connectionAdapter, selectedProvider)
        .catch((cause: unknown) => cause);
      expect(connectionError).not.toBe(externalCause);
      expectBoundedError(connectionError, {
        kind: "provider",
        code: "WALLET_PROVIDER_UNAVAILABLE",
        retryable: true,
      });
    }

    const signProvider = provider(({ method }) => {
      if (method === "eth_requestAccounts") return [ADDRESS_A];
      if (method === "eth_chainId") return "0x72";
      if (method === "eth_getCode") return "0x";
      if (method === "personal_sign") throw forged;
      throw new Error(`unexpected ${method}`);
    });
    const signatureAdapter = adapter(module.createWalletProviderAdapter);
    await connect(signatureAdapter, signProvider);
    const signatureError = await signatureAdapter.signMessage({ message: MESSAGE_A })
      .catch((cause: unknown) => cause);
    expect(signatureError).not.toBe(forged);
    expectBoundedError(signatureError, {
      kind: "provider",
      code: "WALLET_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("recognizes only a safely-read own numeric 4001 and treats inherited or accessor codes as provider failures", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const own4001 = Object.freeze({ code: 4001, message: POISON, data: POISON });
    const inherited4001 = Object.create({ code: 4001 }) as Record<string, unknown>;
    inherited4001.message = POISON;
    const accessor4001 = Object.defineProperty({}, "code", {
      enumerable: true,
      get() {
        return 4001;
      },
    });

    const cases = [
      {
        cause: own4001,
        expected: {
          kind: "rejected",
          code: "WALLET_REQUEST_REJECTED",
          retryable: true,
        },
      },
      {
        cause: inherited4001,
        expected: {
          kind: "provider",
          code: "WALLET_PROVIDER_UNAVAILABLE",
          retryable: true,
        },
      },
      {
        cause: accessor4001,
        expected: {
          kind: "provider",
          code: "WALLET_PROVIDER_UNAVAILABLE",
          retryable: true,
        },
      },
    ];

    for (const { cause, expected } of cases) {
      const selectedProvider = provider(() => { throw cause; });
      const walletAdapter = adapter(createWalletProviderAdapter);
      const error = await connect(walletAdapter, selectedProvider)
        .catch((providerError: unknown) => providerError);
      expect(error).not.toBe(cause);
      expectBoundedError(error, expected);
    }
  });

  it("normalizes hostile capability access and parse exceptions before provider I/O", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const selectedProvider = successfulProvider({});
    const raw = new Error(`provider exploded ${POISON}`);
    Object.assign(raw, { data: POISON, cause: { stack: "stack-secret" } });
    const hostileCapability = new Proxy(coston2(), {
      get() {
        throw raw;
      },
      ownKeys() {
        throw raw;
      },
      getOwnPropertyDescriptor() {
        throw raw;
      },
    });

    const walletAdapter = adapter(createWalletProviderAdapter);
    const error = await walletAdapter.connect({
      provider: selectedProvider,
      networkCapability: hostileCapability,
    }).catch((cause: unknown) => cause);

    expect(error).not.toBe(raw);
    expectBoundedError(error, {
      kind: "validation",
      code: "NETWORK_CAPABILITY_INVALID",
      retryable: false,
    });
    expect(selectedProvider.request).not.toHaveBeenCalled();
  });
});

describe("Slice 023C2A corrective immutable add-chain metadata", () => {
  it("passes fresh deeply immutable exact Coston2 metadata to every provider and cannot poison a later adapter", async () => {
    const module = await loadModule();
    expect(module).not.toHaveProperty("COSTON2_ADD_CHAIN_PARAMETERS");
    const payloads: Array<Record<string, unknown>> = [];
    const mutationResults: boolean[][] = [];

    function switchProvider(address: string) {
      let chain = "0x1";
      return provider(({ method, params }) => {
        if (method === "eth_requestAccounts") return [address];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") throw { code: 4902 };
        if (method === "wallet_addEthereumChain") {
          const payload = (params as Array<Record<string, unknown>>)[0]!;
          payloads.push(payload);
          const nativeCurrency = payload.nativeCurrency as Record<string, unknown>;
          const rpcUrls = payload.rpcUrls as string[];
          const blockExplorerUrls = payload.blockExplorerUrls as string[];
          mutationResults.push([
            Reflect.set(payload, "chainName", "Attacker chain"),
            Reflect.set(nativeCurrency, "symbol", "EVIL"),
            Reflect.set(rpcUrls, "0", ATTACKER_RPC),
            Reflect.set(blockExplorerUrls, "0", ATTACKER_RPC),
          ]);
          chain = "0x72";
          return null;
        }
        if (method === "eth_getCode") return "0x";
        throw new Error(`unexpected ${method}`);
      });
    }

    const firstProvider = switchProvider(ADDRESS_A);
    const secondProvider = switchProvider(ADDRESS_B);
    await connect(adapter(module.createWalletProviderAdapter), firstProvider);
    await connect(adapter(module.createWalletProviderAdapter), secondProvider);

    const expected = {
      chainId: "0x72",
      chainName: "Coston2",
      nativeCurrency: {
        name: "Coston2 Flare",
        symbol: "C2FLR",
        decimals: 18,
      },
      rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
      blockExplorerUrls: ["https://coston2-explorer.flare.network"],
    };
    expect(payloads).toEqual([expected, expected]);
    expect(payloads[0]).not.toBe(payloads[1]);
    expect(payloads[0]?.nativeCurrency).not.toBe(payloads[1]?.nativeCurrency);
    expect(payloads[0]?.rpcUrls).not.toBe(payloads[1]?.rpcUrls);
    expect(payloads[0]?.blockExplorerUrls).not.toBe(payloads[1]?.blockExplorerUrls);
    for (const payload of payloads) {
      expect(Object.isFrozen(payload)).toBe(true);
      expect(Object.isFrozen(payload.nativeCurrency)).toBe(true);
      expect(Object.isFrozen(payload.rpcUrls)).toBe(true);
      expect(Object.isFrozen(payload.blockExplorerUrls)).toBe(true);
    }
    expect(mutationResults).toEqual([
      [false, false, false, false],
      [false, false, false, false],
    ]);
    expect(JSON.stringify(payloads)).not.toContain(ATTACKER_RPC);
  });
});

describe("Slice 023C2A corrective intent-sensitive single-flight", () => {
  it("coalesces only an identical provider plus canonical capability and rejects distinct connect intents", async () => {
    const { createWalletProviderAdapter } = await loadModule();

    const identicalAccounts = deferred<unknown>();
    const identicalProvider = successfulProvider({ accounts: identicalAccounts.promise });
    const identicalAdapter = adapter(createWalletProviderAdapter);
    const firstIdentical = identicalAdapter.connect({
      provider: identicalProvider,
      networkCapability: coston2(),
    });
    const duplicateIdentical = identicalAdapter.connect({
      provider: identicalProvider,
      networkCapability: structuredClone(coston2()),
    });
    expect(duplicateIdentical).toBe(firstIdentical);
    expect(identicalProvider.request).toHaveBeenCalledTimes(1);
    identicalAccounts.resolve([ADDRESS_A]);
    await expect(Promise.all([firstIdentical, duplicateIdentical])).resolves.toEqual([
      { address: ADDRESS_A, chainId: "0x72" },
      { address: ADDRESS_A, chainId: "0x72" },
    ]);

    const providerAAccounts = deferred<unknown>();
    const providerA = successfulProvider({ accounts: providerAAccounts.promise });
    const providerB = successfulProvider({ address: ADDRESS_B });
    const providerAdapter = adapter(createWalletProviderAdapter);
    const pendingProviderA = connect(providerAdapter, providerA);
    const providerBResult = connect(providerAdapter, providerB)
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    expect(providerB.request).not.toHaveBeenCalled();
    providerAAccounts.resolve([ADDRESS_A]);
    await expect(pendingProviderA).resolves.toEqual({ address: ADDRESS_A, chainId: "0x72" });
    const providerBOutcome = await providerBResult;
    expect(providerBOutcome).toHaveProperty("error");
    expectBoundedError((providerBOutcome as { error: unknown }).error, {
      kind: "cancelled",
      code: "WALLET_OPERATION_IN_PROGRESS",
      retryable: true,
    });

    const capabilityAccounts = deferred<unknown>();
    const capabilityProvider = successfulProvider({ accounts: capabilityAccounts.promise });
    const capabilityAdapter = adapter(createWalletProviderAdapter);
    const pendingCoston2 = capabilityAdapter.connect({
      provider: capabilityProvider,
      networkCapability: coston2(),
    });
    const flareResult = capabilityAdapter.connect({
      provider: capabilityProvider,
      networkCapability: flare(),
    }).then((value) => ({ value }), (error: unknown) => ({ error }));
    expect(capabilityProvider.request).toHaveBeenCalledTimes(1);
    capabilityAccounts.resolve([ADDRESS_A]);
    await expect(pendingCoston2).resolves.toEqual({ address: ADDRESS_A, chainId: "0x72" });
    const flareOutcome = await flareResult;
    expect(flareOutcome).toHaveProperty("error");
    expectBoundedError((flareOutcome as { error: unknown }).error, {
      kind: "cancelled",
      code: "WALLET_OPERATION_IN_PROGRESS",
      retryable: true,
    });
  });

  it("coalesces only the exact sign message and rejects a different challenge without aliasing its result", async () => {
    const { createWalletProviderAdapter } = await loadModule();
    const pendingSignature = deferred<unknown>();
    const selectedProvider = successfulProvider({ signature: pendingSignature.promise });
    const walletAdapter = adapter(createWalletProviderAdapter);
    await connect(walletAdapter, selectedProvider);

    const first = walletAdapter.signMessage({ message: MESSAGE_A });
    const duplicate = walletAdapter.signMessage({ message: MESSAGE_A });
    expect(duplicate).toBe(first);
    expect(selectedProvider.request.mock.calls.filter(([args]) => args.method === "personal_sign"))
      .toHaveLength(1);

    const differentResult = walletAdapter.signMessage({ message: MESSAGE_B })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    expect(selectedProvider.request.mock.calls.filter(([args]) => args.method === "personal_sign"))
      .toHaveLength(1);

    pendingSignature.resolve(SIGNATURE_A);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { address: ADDRESS_A, signature: SIGNATURE_A },
      { address: ADDRESS_A, signature: SIGNATURE_A },
    ]);
    const differentOutcome = await differentResult;
    expect(differentOutcome).toHaveProperty("error");
    const differentError = (differentOutcome as { error: unknown }).error;
    expectBoundedError(differentError, {
      kind: "cancelled",
      code: "WALLET_OPERATION_IN_PROGRESS",
      retryable: true,
    });
    expect(JSON.stringify(differentError)).not.toContain(SIGNATURE_A);
    expect(JSON.stringify(differentError)).not.toContain(SIGNATURE_B);
  });
});
