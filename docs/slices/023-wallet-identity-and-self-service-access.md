# Slice 023 — Wallet identity and self-service access

## User outcome

A new developer signs one server-authored Coston2 message and receives access
to a default Proofline project without manually provisioning a project token.

## 023A frozen scope

Public contracts:

- `WalletChallengeRequestV1`: strict `{ version: "1", address }`.
- `WalletChallengeV1`: challenge identity, EOA address, fixed
  `browser-session` purpose, Coston2 chain `114`, exact message and five-minute
  server timestamps.
- `WalletSessionRequestV1`: strict
  `{ version: "1", challengeId, signature }`.
- `WalletSessionV1`: one-time 12-hour browser `project_` token plus wallet and
  default-project identity.
- `AccountV1`, `AccountTokenCreateRequestV1`, `AccountTokenSummaryV1`,
  `AccountTokenCreatedV1` and `AccountTokenRevokedV1`: strict account/settings
  contracts; no raw token appears in account or summaries.

Pure auth module contract:

- `buildEip4361Message` accepts only server inputs and emits the exact EIP-4361
  Coston2 message.
- `verifyEoaWalletSignature` delegates recovery to an injected pure port and
  accepts only the expected recovered address.

HTTP boundary:

- `POST /v1/auth/wallet/challenges` and
  `POST /v1/auth/wallet/sessions` are the only public auth POST routes.
- They require exact configured `Origin`, no bearer or `Idempotency-Key`, strict
  versioned bodies, an 8 KiB Fetch `Request` body cap, and
  non-cacheable/non-referring responses.
- The client cannot submit message, domain, URI, chain, nonce or timestamps.
- All other routes remain behind existing project/share bearer middleware.

Expected RED: schemas and pure auth module are absent; the current API returns
`401` before reaching both public routes and has no public-body limit.

## Deferred RED waves

023B freezes migration, single-use/expiry/concurrency, default-project and token
digest tests. 023C freezes browser wallet/session/Settings acceptance. 023D
freezes rate, daily quota, active-live-run, leakage and pre-buffer Node stream
body-limit hardening. The 023A Request-level 413 is not full transport DoS
evidence. None of those
implementation details are frozen by 023A tests.

## Validation cadence

RED runs only new contracts/auth/API tests, `npm run typecheck`, and the nearest
unchanged contracts/API auth baseline. Full PostgreSQL, Web, coverage and release
matrices wait for their owning GREEN waves and the MLP candidate freeze.

Architecture decision: [ADR 0024](../adr/0024-wallet-identity-and-self-service-access.md).
