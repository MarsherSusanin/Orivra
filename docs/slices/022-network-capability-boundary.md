# Slice 022 — Network capability boundary

## User outcome

Proofline can show Coston2 and Flare honestly: Coston2 Web2Json is available,
while Flare is visible but cannot start a run or reach network effects.

## Public contracts

- `FdcNetworkV1` is exactly `coston2 | flare`.
- `NetworkCapabilityV1` binds network, display name, Web2Json status and strict
  wallet metadata: decimal chain ID, hexadecimal EIP-1193 chain ID, native
  currency and HTTPS explorer base URL.
- `NetworkCapabilitiesV1` is a versioned ordered response containing Coston2
  first and Flare second.
- `Web2JsonManifestV1.network` recognizes the same closed network vocabulary.
- `GET /v1/networks` is public and does not require a project or share token.
- `POST /v1/runs` returns `409 NETWORK_CAPABILITY_DISABLED` for Flare before
  calling the run service. Unknown networks remain a strict `400` body error.

Canonical capabilities:

| Network | Web2Json | Chain | Wallet chain | Currency | Explorer |
|---|---|---:|---|---|---|
| Coston2 | `enabled` | `114` | `0x72` | C2FLR, 18 decimals | `https://coston2-explorer.flare.network` |
| Flare | `upstream-unsupported` | `14` | `0xe` | FLR, 18 decimals | `https://flare-explorer.flare.network` |

## Security and architecture

- Risk class: public contract and network trust-boundary change; no migration.
- Capability discovery contains no RPC URL, token, source URL, manifest or run
  evidence.
- The Flare rejection happens before `service.createRun`, so verifier, registry,
  source fetch, RPC, Relay and DA ports are unreachable.
- Share tokens remain read-only and cannot create a run.
- Persisted run, preflight, bundle and wallet-transaction schemas remain
  Coston2-only until Flare has a production adapter and live acceptance evidence.
- No production Flare adapter, feature-flag bypass or simulator is introduced.

Architecture decision: [ADR 0023](../adr/0023-network-capability-boundary.md).

## Frozen RED acceptance

- Contracts export strict `FdcNetworkV1Schema`, `NetworkCapabilityV1Schema` and
  `NetworkCapabilitiesV1Schema` parsers.
- Exact canonical capabilities parse; wrong chain pairing, noncanonical hex,
  wrong currency, insecure explorer URL, unknown fields and unknown networks do
  not parse.
- The manifest accepts Coston2 and recognized Flare, but still rejects Songbird
  and all unknown identities.
- `GET /v1/networks` succeeds without authentication and returns the strict
  ordered response.
- A project-authenticated Flare create request returns the stable `409` error and
  never invokes `createRun`; an unknown network returns `400` with the same
  no-call property.
- Share access cannot create either Coston2 or Flare runs.
- Wallet submission rejects a disabled capability with
  `NETWORK_CAPABILITY_DISABLED` before requesting accounts, switching chain or
  broadcasting.

Expected RED reason: the new public schemas and route do not exist, the manifest
still accepts only Coston2, and the browser wallet coordinator has no capability
input or stable disabled-network error.

## Validation cadence

RED runs only the new contracts, API and wallet capability tests plus
`npm run typecheck`. GREEN waves run affected packages and direct dependants.
The complete repository matrix is deferred until the MLP candidate freeze after
Slices 022–029, as defined by the accepted MLP plan.

## Exclusions

Flare execution, Flare registry/RPC/DA adapters, persisted Flare evidence,
network switching for an existing run, Mainnet deployment and relayer support
are outside Slice 022.
