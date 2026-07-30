# Slice 001 — Coston2 Web2Json vertical

## User result

A developer can submit one safe-GET Web2Json manifest through Web, API, CLI, or the GitHub Action; follow a persisted Coston2 run; verify the returned proof and canonical consumer; generate a safe consumer; and export or replay a checksummed bundle.

## Execution modes

- `replay`: deterministic fixtures only; mandatory for pull requests and local acceptance.
- `wallet`: API prepares a chain-114 transaction; the client signs locally and registers the transaction hash.
- `relayer`: an authenticated project requests a bounded server-side Coston2 submission.
- `live-coston2`: merge-gate smoke; never runs as part of the hermetic test suite.

## Public contracts

- `Web2JsonManifestV1`, `RunEventV1`, `RunProjectionV1`, `DiagnosticV1`, `ProofBundleV1`, and `NormalizedFdcError` are versioned Zod schemas and inferred TypeScript types in `packages/contracts`.
- Run events are append-only, strictly sequenced per run, and are the source of truth. Projections are derived.
- Bundle bytes use canonical JSON and a SHA-256 checksum. Tokens, private keys, authorization headers, and environment values are excluded.
- Live code depends on typed ports. Replay adapters must throw outside tests/replay commands and are forbidden in the live composition root.

## API acceptance

- `POST /v1/runs`
- `GET /v1/runs/:id`
- `GET /v1/runs/:id/events?after=<sequence>`
- `POST /v1/runs/:id/submissions`
- `POST /v1/runs/:id/transactions`
- `POST /v1/runs/:id/consumer-verifications`
- `POST /v1/runs/:id/artifacts/consumer`
- `GET /v1/runs/:id/bundle`
- `POST /v1/replays`
- `POST /v1/runs/:id/share`

Project bearer tokens authorize mutation. Opaque share tokens authorize only shared-run reads. Token digests, never raw tokens, are persisted.

## Domain acceptance

- Lifecycle is monotonic across Preflight, Request, Round, Proof, Verify, and Consumer.
- An accepted terminal state cannot transition back to a non-terminal state.
- Reapplying the same idempotent command does not append another side-effect event.
- Proof or event mutation changes the bundle checksum and makes replay fail.
- Consumer diagnostics require HTTPS, exact normalized host, path prefix, and expected query values.

## Security acceptance

- Web2 requests are public HTTPS GET only, port 443, no redirects, no request headers/body, 1 MB response limit, and bounded timeouts.
- DNS results are validated and pinned; loopback, private, link-local, multicast, and metadata ranges are rejected.
- Relayer enforces chain id 114, registry-resolved `FdcHub`, exact calldata and fee, quotas, balance floor, and idempotency.
- The API never receives a user private key. Only the worker can read the relayer secret.

## Verification commands

```text
npm run typecheck
npm run test:contracts
npm run test:core
npm run test:integration
npm run test:web
npm run test:sites
npm run test:e2e
npm run build
```

Live acceptance is separate: `npm run test:live:coston2` with funded secrets and a 10-minute budget.

## Out of scope

Other networks and attestation types, arbitrary methods/headers/body, arbitrary consumer ABI/address, mainnet, user-key custody, and automatic deployment.
