# ADR 0025 — Lazy browser wallet provider boundary

Status: accepted for Slice 023C2A RED

## Context

Proofline needs wallet sign-in without making a wallet SDK part of the initial
Web bundle or allowing module import, reload, React render or session restore to
touch a provider. EIP-6963 can announce several injected wallets, while the
legacy `window.ethereum` surface exposes at most one. A valid EOA signature is
not sufficient on its own: the selected provider must be on an enabled
Coston2 capability and the account must have empty runtime bytecode before the
server challenge is requested or signed.

Provider errors are untrusted. They may contain account data, extension state,
RPC URLs, stacks or arbitrary messages and must not cross the adapter boundary.

## Decision

Slice 023C2A adds one unrendered `wallet-provider-adapter` service. It receives
an injected browser event port and clock; it never reads `window`, dispatches an
event or invokes RPC at module import or construction time.

The internal exported surface is deliberately small:

- `createWalletProviderAdapter({ browser, clock })`;
- `discoverProviders()`;
- `connect({ provider, networkCapability })`;
- `signMessage({ message })`;
- `cancelPending()`;
- `close()`.

Discovery is an explicit user action. It subscribes before dispatching
`eip6963:requestProvider`, collects synchronous and delayed
`eip6963:announceProvider` events for the fixed exported 50 ms discovery
window, removes its listener, validates provider info and `request`, and keeps
the first valid announcement for each UUID in announcement order. Multiple
valid providers are returned for a later chooser. Only when no valid EIP-6963
announcement exists does the adapter read and expose a valid legacy
`window.ethereum` provider.

Connection accepts only the strict existing `NetworkCapabilityV1` Coston2
entry whose Web2Json capability is enabled. Disabled Flare or malformed
capability evidence fails before provider I/O. The exact effect order is:

1. `eth_requestAccounts` and strict 20-byte hexadecimal account validation;
2. `eth_chainId` and canonical hexadecimal-quantity validation;
3. if needed, `wallet_switchEthereumChain({ chainId: "0x72" })`;
4. on numeric EIP-1193 `4902`,
   `wallet_addEthereumChain` with exact Coston2 metadata;
5. after every switch or add, `eth_chainId` verifies the resulting chain;
6. `eth_getCode(canonicalAddress, "latest")` proves empty runtime code.

The canonical address exposed to the API is lowercase. A malformed account,
malformed chain result, wrong chain after switch/add, non-empty code or
malformed code fails closed. Code lookup failure is provider/offline evidence;
Proofline never guesses that the account is an EOA. The exact add-chain payload
is derived from `NetworkCapabilityV1` plus the current production Coston2 RPC
endpoint `https://coston2-api.flare.network/ext/C/rpc`; it contains no Flare
Mainnet metadata. This literal is public wallet bootstrap metadata only. It is
not a protocol contract address, does not replace registry resolution, and
cannot be overridden with a caller-provided RPC URL.

A successful connection is retained privately by the adapter. Only that
verified provider/address may perform `personal_sign` with the exact server
message and canonical address, so signing cannot precede the EOA check. A
signature must be exact 65-byte hexadecimal evidence.

Numeric provider code `4001` at account, switch, add, code or sign phases maps
to the same bounded rejected error. Every other provider failure maps to a
bounded provider/offline error. Raw error code, message, data, stack and RPC
response bytes are discarded. Contract-wallet, disabled-network, validation,
cancelled and stale results use separate fixed adapter-owned codes.

Discovery, connection and signing are single-flight. Cancellation or close
increments an attempt generation before a late promise can publish a provider,
connection or signature. A new explicit attempt after cancellation cannot be
overwritten by the old result. Close is terminal.

## Consequences

The pure adapter can be covered hermetically with injected events, providers
and time. It adds no wallet SDK, provider custody, Flare support, React state or
analytics. Slice 023C2B will own chooser/sign-in UI and will call the persisted
023C1 services only after this adapter has returned verified EOA evidence.
Browser rendering, code splitting and wallet reconnect UX are therefore not
acceptance evidence for 023C2A.
