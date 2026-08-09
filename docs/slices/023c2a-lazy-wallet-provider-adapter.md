# Slice 023C2A — Lazy EIP-6963/EIP-1193 provider adapter

## User outcome

When a developer explicitly starts wallet sign-in, Proofline can discover all
valid injected wallets, let a later surface choose one, establish that the
selected account is a Coston2 EOA, and sign the exact server message. Reload,
module import and session restoration remain free of wallet prompts and RPC.

This slice is a pure Web service. It does not render a chooser, connect button,
sign-in dialog or Settings surface and does not connect the provider to the
023C1 session controller yet.

## Internal contract

`src/services/wallet-provider-adapter.ts` exports:

- `EIP6963_DISCOVERY_WINDOW_MS = 50`;
- `createWalletProviderAdapter({ browser, clock })`;
- provider descriptors containing bounded EIP-6963 identity plus the injected
  provider reference;
- bounded `WalletProviderError` evidence.

The returned adapter exposes `discoverProviders`, `connect`, `signMessage`,
`cancelPending` and `close`. Provider/global access is forbidden until an
explicit method is called.

### Discovery

- Register the announce listener before dispatching exactly one
  `eip6963:requestProvider` event.
- Collect for 50 ms through the injected clock and always remove the listener.
- Accept only UUID/name/icon/rdns provider info and a callable EIP-1193
  `request`; discard malformed announcements.
- Deduplicate by UUID, first valid announcement wins, preserving announcement
  order.
- Return every valid announced provider for a chooser.
- Read `browser.ethereum` only after the window and only if no valid EIP-6963
  provider was collected; ignore a malformed legacy provider.

### Connect and sign

- Parse the existing `NetworkCapabilityV1`; only enabled Coston2 proceeds.
- Exact successful RPC order is accounts → chain → optional switch/add → chain
  verification → code.
- Canonicalize a valid 20-byte hexadecimal account to lowercase.
- Switch to `0x72`; numeric `4902` adds exact Coston2 name, currency, official
  RPC and explorer metadata, then verifies `eth_chainId`.
- Fail closed on malformed chain evidence or a chain other than `0x72` after
  switching/adding.
- Call `eth_getCode(address, "latest")`; only exact `0x` is an EOA. Non-empty
  code is explicitly unsupported; malformed or unavailable code is not treated
  as an EOA.
- Permit `personal_sign([exactMessage, canonicalAddress])` only for the current
  verified connection and require an exact 65-byte hex signature.
- Numeric `4001` is a bounded rejection at every RPC phase. No provider error
  message, data, stack, raw code or malformed response is surfaced.

The adapter-owned codes are exactly `NETWORK_CAPABILITY_DISABLED`,
`NETWORK_CAPABILITY_INVALID`, `WALLET_ACCOUNT_INVALID`,
`WALLET_CHAIN_INVALID`, `WALLET_CHAIN_UNAVAILABLE`,
`CONTRACT_WALLET_UNSUPPORTED`, `WALLET_PROVIDER_UNAVAILABLE`,
`WALLET_CONNECTION_REQUIRED`, `WALLET_SIGNATURE_INVALID`,
`WALLET_REQUEST_REJECTED` and `WALLET_OPERATION_CANCELLED`. Every error uses
the fixed public message `Wallet request failed.` and carries no raw cause.

Every operation is single-flight. Cancellation and close make late provider
responses stale; a subsequent explicit attempt owns the current generation.

## RED and focused validation

Frozen test:

- `src/services/slice023c2a-lazy-wallet-provider-adapter.contract.test.ts`.

Intentional RED: `wallet-provider-adapter` does not exist. The test freezes
lazy import/construction, discovery ordering/fallback, capability fail-closed,
exact RPC order and add-chain metadata, EOA proof, sanitized failures and
single-flight/cancellation behavior.

Focused GREEN must run:

```text
npm run typecheck
npx vitest run src/services/slice023c2a-lazy-wallet-provider-adapter.contract.test.ts
npx vitest run src/services/slice023c1-*.test.ts packages/contracts/test/slice022-network-capability.contract.test.ts
```

Affected Web coverage must meet at least 85% lines and above 80% branches once
production exists. No build, browser, Sites, PostgreSQL, live Coston2 or full
repository claim belongs to this unimported service slice.

Architecture decision: [ADR 0025](../adr/0025-lazy-browser-wallet-provider-boundary.md).
