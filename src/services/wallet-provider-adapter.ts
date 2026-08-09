import {
  NetworkCapabilityV1Schema,
  type NetworkCapabilityV1,
} from "@proofline/contracts";

export const EIP6963_DISCOVERY_WINDOW_MS = 50 as const;

const COSTON2_CHAIN_ID = "0x72" as const;
const COSTON2_ADD_CHAIN_PARAMETERS = {
  chainId: COSTON2_CHAIN_ID,
  chainName: "Coston2",
  nativeCurrency: {
    name: "Coston2 Flare",
    symbol: "C2FLR",
    decimals: 18,
  },
  rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
  blockExplorerUrls: ["https://coston2-explorer.flare.network"],
} as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const BYTECODE = /^0x(?:[0-9a-fA-F]{2})+$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RDNS = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type RequestArguments = {
  method: string;
  params?: readonly unknown[] | object;
};

export type Eip1193Provider = {
  request(args: RequestArguments): Promise<unknown>;
};

export type BrowserEvent = { type: string; detail?: unknown };
export type BrowserListener = (event: BrowserEvent) => void;

export type BrowserPort = {
  addEventListener(type: string, listener: BrowserListener): void;
  removeEventListener(type: string, listener: BrowserListener): void;
  dispatchEvent(event: { type: string }): boolean;
  readonly ethereum?: Eip1193Provider;
};

export type ProviderOption = {
  id: string;
  name: string;
  icon: string | null;
  rdns: string | null;
  source: "eip6963" | "legacy";
  provider: Eip1193Provider;
};

export type WalletConnection = {
  address: string;
  chainId: typeof COSTON2_CHAIN_ID;
};

export type WalletSignature = {
  address: string;
  signature: string;
};

export type WalletProviderErrorKind =
  | "validation"
  | "unsupported"
  | "provider"
  | "rejected"
  | "cancelled";

export class WalletProviderError extends Error {
  readonly kind: WalletProviderErrorKind;
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: {
    kind: WalletProviderErrorKind;
    code: string;
    retryable: boolean;
  }) {
    super("Wallet request failed.");
    this.name = "WalletProviderError";
    this.kind = input.kind;
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export type WalletProviderAdapter = {
  discoverProviders(): Promise<readonly ProviderOption[]>;
  connect(input: {
    provider: Eip1193Provider;
    networkCapability: NetworkCapabilityV1;
  }): Promise<WalletConnection>;
  signMessage(input: { message: string }): Promise<WalletSignature>;
  cancelPending(): void;
  close(): void;
};

function adapterError(
  kind: WalletProviderErrorKind,
  code: string,
  retryable: boolean,
): WalletProviderError {
  return new WalletProviderError({ kind, code, retryable });
}

function cancelled(): WalletProviderError {
  return adapterError("cancelled", "WALLET_OPERATION_CANCELLED", true);
}

function providerCode(value: unknown): number | null {
  try {
    if (value && typeof value === "object" && "code" in value) {
      const code = (value as { code?: unknown }).code;
      return typeof code === "number" && Number.isInteger(code) ? code : null;
    }
  } catch {
    return null;
  }
  return null;
}

function validProvider(value: unknown): value is Eip1193Provider {
  try {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      typeof (value as { request?: unknown }).request === "function"
    );
  } catch {
    return false;
  }
}

function validIcon(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4_096 &&
    /^data:image\/(?:svg\+xml|png|webp|gif|jpeg)[;,]/i.test(value)
  );
}

function announcedProvider(value: unknown): ProviderOption | null {
  try {
    if (!value || typeof value !== "object") return null;
    const detail = value as Record<string, unknown>;
    if (!detail.info || typeof detail.info !== "object") return null;
    const info = detail.info as Record<string, unknown>;
    if (
      typeof info.uuid !== "string" ||
      !UUID.test(info.uuid) ||
      typeof info.name !== "string" ||
      info.name.length < 1 ||
      info.name.length > 64 ||
      info.name !== info.name.trim() ||
      !validIcon(info.icon) ||
      typeof info.rdns !== "string" ||
      info.rdns !== info.rdns.toLowerCase() ||
      !RDNS.test(info.rdns) ||
      !validProvider(detail.provider)
    ) {
      return null;
    }
    return {
      id: info.uuid.toLowerCase(),
      name: info.name,
      icon: info.icon,
      rdns: info.rdns,
      source: "eip6963",
      provider: detail.provider,
    };
  } catch {
    return null;
  }
}

function parseCapability(value: unknown): NetworkCapabilityV1 {
  const parsed = NetworkCapabilityV1Schema.safeParse(value);
  if (!parsed.success) {
    throw adapterError("validation", "NETWORK_CAPABILITY_INVALID", false);
  }
  if (parsed.data.network !== "coston2") {
    throw adapterError("unsupported", "NETWORK_CAPABILITY_DISABLED", false);
  }
  return parsed.data;
}

function validMessage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 8_192
  );
}

export function createWalletProviderAdapter(input: {
  browser: BrowserPort;
  clock: { wait(milliseconds: number): Promise<void> };
}): WalletProviderAdapter {
  let closed = false;
  let generation = 0;
  let discoveryFlight: Promise<readonly ProviderOption[]> | null = null;
  let connectionFlight: Promise<WalletConnection> | null = null;
  let signatureFlight: Promise<WalletSignature> | null = null;
  let connection: {
    provider: Eip1193Provider;
    address: string;
  } | null = null;

  function beginAttempt(): number {
    generation += 1;
    discoveryFlight = null;
    connectionFlight = null;
    signatureFlight = null;
    return generation;
  }

  function current(attempt: number): boolean {
    return !closed && generation === attempt;
  }

  function requireCurrent(attempt: number): void {
    if (!current(attempt)) throw cancelled();
  }

  async function rpc(
    provider: Eip1193Provider,
    args: RequestArguments,
    attempt: number,
  ): Promise<unknown> {
    try {
      const result = await provider.request(args);
      requireCurrent(attempt);
      return result;
    } catch (cause) {
      if (!current(attempt)) throw cancelled();
      if (cause instanceof WalletProviderError) throw cause;
      if (providerCode(cause) === 4001) {
        throw adapterError("rejected", "WALLET_REQUEST_REJECTED", true);
      }
      throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
    }
  }

  function discoverProviders(): Promise<readonly ProviderOption[]> {
    if (closed) return Promise.reject(cancelled());
    if (discoveryFlight) return discoveryFlight;

    const attempt = beginAttempt();
    const discovered: ProviderOption[] = [];
    const ids = new Set<string>();
    let listenerAdded = false;
    const listener: BrowserListener = (event) => {
      try {
        if (!current(attempt) || event.type !== "eip6963:announceProvider") {
          return;
        }
        const option = announcedProvider(event.detail);
        if (!option || ids.has(option.id)) return;
        ids.add(option.id);
        discovered.push(option);
      } catch {
        // An injected event is untrusted and malformed announcements are ignored.
      }
    };

    let flight!: Promise<readonly ProviderOption[]>;
    flight = (async () => {
      try {
        input.browser.addEventListener("eip6963:announceProvider", listener);
        listenerAdded = true;
        input.browser.dispatchEvent({ type: "eip6963:requestProvider" });
        await input.clock.wait(EIP6963_DISCOVERY_WINDOW_MS);
        requireCurrent(attempt);
      } catch (cause) {
        if (!current(attempt)) throw cancelled();
        if (cause instanceof WalletProviderError) throw cause;
        throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
      } finally {
        if (listenerAdded) {
          try {
            input.browser.removeEventListener(
              "eip6963:announceProvider",
              listener,
            );
          } catch {
            // Listener cleanup is best effort on a malformed injected event port.
          }
        }
      }

      requireCurrent(attempt);
      if (discovered.length > 0) return discovered;
      let legacy: unknown;
      try {
        legacy = input.browser.ethereum;
      } catch {
        throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
      }
      requireCurrent(attempt);
      return validProvider(legacy)
        ? [
            {
              id: "legacy-window-ethereum",
              name: "Browser wallet",
              icon: null,
              rdns: null,
              source: "legacy" as const,
              provider: legacy,
            },
          ]
        : [];
    })().finally(() => {
      if (discoveryFlight === flight) discoveryFlight = null;
    });
    discoveryFlight = flight;
    return flight;
  }

  function connect(rawInput: {
    provider: Eip1193Provider;
    networkCapability: NetworkCapabilityV1;
  }): Promise<WalletConnection> {
    if (closed) return Promise.reject(cancelled());
    if (connectionFlight) return connectionFlight;

    let capabilityInput: unknown;
    try {
      capabilityInput = rawInput?.networkCapability;
    } catch {
      return Promise.reject(
        adapterError("validation", "NETWORK_CAPABILITY_INVALID", false),
      );
    }
    try {
      parseCapability(capabilityInput);
    } catch (cause) {
      return Promise.reject(cause);
    }
    let selectedProvider: unknown;
    try {
      selectedProvider = rawInput?.provider;
    } catch {
      return Promise.reject(
        adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true),
      );
    }
    if (!validProvider(selectedProvider)) {
      return Promise.reject(
        adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true),
      );
    }

    const attempt = beginAttempt();
    const provider = selectedProvider;
    connection = null;
    let flight!: Promise<WalletConnection>;
    flight = (async () => {
      const accounts = await rpc(
        provider,
        { method: "eth_requestAccounts" },
        attempt,
      );
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        !ADDRESS.test(accounts[0])
      ) {
        throw adapterError("validation", "WALLET_ACCOUNT_INVALID", false);
      }
      const address = accounts[0].toLowerCase();

      const initialChain = await rpc(
        provider,
        { method: "eth_chainId" },
        attempt,
      );
      if (typeof initialChain !== "string" || !HEX_QUANTITY.test(initialChain)) {
        throw adapterError("provider", "WALLET_CHAIN_INVALID", true);
      }

      if (initialChain !== COSTON2_CHAIN_ID) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: COSTON2_CHAIN_ID }],
          });
          requireCurrent(attempt);
        } catch (cause) {
          if (!current(attempt)) throw cancelled();
          const code = providerCode(cause);
          if (code === 4001) {
            throw adapterError("rejected", "WALLET_REQUEST_REJECTED", true);
          }
          if (code !== 4902) {
            throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
          }
          await rpc(
            provider,
            {
              method: "wallet_addEthereumChain",
              params: [COSTON2_ADD_CHAIN_PARAMETERS],
            },
            attempt,
          );
        }

        const resultingChain = await rpc(
          provider,
          { method: "eth_chainId" },
          attempt,
        );
        if (resultingChain !== COSTON2_CHAIN_ID) {
          throw adapterError("provider", "WALLET_CHAIN_UNAVAILABLE", true);
        }
      }

      const code = await rpc(
        provider,
        { method: "eth_getCode", params: [address, "latest"] },
        attempt,
      );
      if (code !== "0x") {
        if (typeof code === "string" && BYTECODE.test(code)) {
          throw adapterError(
            "unsupported",
            "CONTRACT_WALLET_UNSUPPORTED",
            false,
          );
        }
        throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
      }

      requireCurrent(attempt);
      connection = { provider, address };
      return { address, chainId: COSTON2_CHAIN_ID };
    })().catch((cause) => {
      if (!current(attempt)) throw cancelled();
      if (cause instanceof WalletProviderError) throw cause;
      throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
    }).finally(() => {
      if (connectionFlight === flight) connectionFlight = null;
    });
    connectionFlight = flight;
    return flight;
  }

  function signMessage(rawInput: { message: string }): Promise<WalletSignature> {
    if (closed) return Promise.reject(cancelled());
    if (signatureFlight) return signatureFlight;
    if (!connection) {
      return Promise.reject(
        adapterError("validation", "WALLET_CONNECTION_REQUIRED", false),
      );
    }
    let message: unknown;
    try {
      message = rawInput?.message;
    } catch {
      return Promise.reject(
        adapterError("validation", "WALLET_SIGNATURE_INVALID", false),
      );
    }
    if (!validMessage(message)) {
      return Promise.reject(
        adapterError("validation", "WALLET_SIGNATURE_INVALID", false),
      );
    }

    const attempt = beginAttempt();
    const verified = connection;
    let flight!: Promise<WalletSignature>;
    flight = (async () => {
      const signature = await rpc(
        verified.provider,
        {
          method: "personal_sign",
          params: [message, verified.address],
        },
        attempt,
      );
      if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
        throw adapterError("provider", "WALLET_SIGNATURE_INVALID", true);
      }
      requireCurrent(attempt);
      return { address: verified.address, signature };
    })().catch((cause) => {
      if (!current(attempt)) throw cancelled();
      if (cause instanceof WalletProviderError) throw cause;
      throw adapterError("provider", "WALLET_PROVIDER_UNAVAILABLE", true);
    }).finally(() => {
      if (signatureFlight === flight) signatureFlight = null;
    });
    signatureFlight = flight;
    return flight;
  }

  return {
    discoverProviders,
    connect,
    signMessage,

    cancelPending() {
      if (closed) return;
      beginAttempt();
    },

    close() {
      if (closed) return;
      beginAttempt();
      closed = true;
      connection = null;
    },
  };
}
