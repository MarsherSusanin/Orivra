# ADR 0051 — Flare Mainnet Web2Json upstream capability assessment

## Status

Accepted as a fail-closed upstream assessment. Mainnet Web2Json remains blocked.

## Context

Issue #12 asks for a separately verified Flare Mainnet Web2Json capability. A
known EVM network, a working RPC, and deployed FDC contracts do not prove that
the Web2Json attestation type is supported on that network. Enabling a selector
from copied Coston2 constants would create wallet, relayer, Relay and DA
authority that the upstream protocol does not provide.

The authoritative Flare documentation currently states that Web2Json is
available only on Coston and Coston2:

- [Flare network identity and RPC](https://dev.flare.network/);
- [Flare Contract Registry](https://dev.flare.network/network/guides/flare-contracts-registry);
- [FDC attestation-type availability](https://dev.flare.network/fdc/overview).

## Decision

`FlareMainnetWeb2JsonAssessmentV1` is an immutable public contract for this
assessment. It binds:

- Flare chain `14` and the official Mainnet RPC;
- the shared official registry address;
- one read-only registry observation at block `67510177` resolving `FdcHub`,
  `Relay` and `FdcVerification` independently of Coston2;
- the official upstream statement that Web2Json supports only `coston` and
  `coston2`;
- the three primary documentation sources used for the conclusion.

The probe performed only `eth_chainId`, `eth_blockNumber` and registry reads.
It did not submit an FDC request, request a wallet signature, access a relayer
key or write on-chain state.

`NETWORK_CAPABILITIES_V1` remains unchanged: Coston2 is enabled and Flare is
`upstream-unsupported`. Flare manifests remain recognizable for explanatory
UI, but all persistence and execution contracts remain Coston2-only.

## Consequences

Issue #12 remains externally blocked rather than being closed with a synthetic
capability. Mainnet enablement requires a new upstream assessment proving
Web2Json support, exact Relay/DA and fee authority, a new accepted ADR, bounded
read-only probes, separately authorized persisted live acceptance and the full
release gates. This ADR and the current probe do not authorize any of those
effects.
