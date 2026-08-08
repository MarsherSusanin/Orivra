# ADR 0023 — Explicit FDC network capability boundary

## Status

Proposed for Slice 022.

## Context

Proofline currently represents Coston2 support with scattered literals in the
manifest, wallet client and FDC adapters. The MLP needs to name Flare Mainnet in
the product without implying that Web2Json can run there. Treating every known
chain as executable would let a structurally valid manifest reach verifier,
registry or RPC effects for an unsupported network.

The network selector also needs safe wallet metadata before a user owns a
project token. This metadata is public release configuration; it contains no
project, run or source evidence.

## Decision

`FdcNetworkV1` is the closed public vocabulary `coston2 | flare`.
`NetworkCapabilityV1` is a strict discriminated contract that binds each
network to its decimal and EIP-1193 hexadecimal chain IDs, display name, native
currency and explorer base URL. It also binds Web2Json to one of two states:

- Coston2 is `enabled`;
- Flare is `upstream-unsupported` with stable explanatory copy.

`GET /v1/networks` is an unauthenticated read endpoint. It returns one ordered,
versioned page containing Coston2 followed by Flare. The route may call only the
in-process capability service and must not perform registry, verifier, source,
RPC, Relay or DA I/O.

`Web2JsonManifestV1` recognizes both enumerated network identities so clients
can preserve and explain a Flare selection. `POST /v1/runs` checks the selected
capability after strict request validation and project authentication, but
before invoking `service.createRun`. A Flare manifest returns HTTP `409` with
stable code `NETWORK_CAPABILITY_DISABLED`. Unknown networks remain invalid and
return HTTP `400`.

No Flare production adapter, registry snapshot, persisted run, proof bundle or
wallet transaction can be created in this slice. Existing persisted evidence
schemas therefore remain Coston2-only. Enabling Flare later requires new live
evidence, an accepted ADR and an atomic expansion of those schemas and adapters.

## Consequences

The API can tell an unauthenticated user why Flare cannot be selected without
probing any upstream service. Wallet and explorer copy consume one canonical
metadata contract instead of adding new chain literals. A recognized network is
not equivalent to an executable capability, and production continues to fail
closed when no enabled adapter exists.

Contract tests must prove exact schema strictness, decimal/hex chain identity,
public discovery, project/share authorization behavior, and rejection of Flare
before any service or network-capable port can run.
