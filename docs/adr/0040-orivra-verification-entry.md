# ADR 0040: Orivra verification entry and protected product routes

- Status: Accepted for Slice 027E
- Date: 2026-08-11
- Supersedes: the root storage/session and product-route clauses of ADR 0034
- Refines: ADR 0014, ADR 0024, ADR 0027, ADR 0029

## Context

The public Orivra surface explains the product but does not let a Web3 developer begin the core job. The intended job is narrower than URL reputation or arbitrary smart-contract auditing: prove that a Web2Json consumer accepts the intended public HTTPS endpoint, then generate persisted evidence, safe Solidity and an integration package.

ADR 0034 intentionally kept `/` free of wallet, session and storage activity. A useful verification starter now requires one explicit, user-triggered handoff from the public page into the authenticated Composer. That boundary must remain local, bounded and free of source fetches or credential material.

## Decision

1. `/` contains a local verification starter for one public HTTPS endpoint. Preview parses the URL and derives the expected scheme, normalized host, path prefix and public query invariants. It never requests the entered endpoint.
2. URLs with credentials, fragments, non-default ports, duplicate query names, credential query names, opaque credential values or more than the bounded draft size fail closed.
3. `Continue with wallet` creates a strict `Web2JsonManifestDraftV1`, stores a one-shot internal handoff under `proofline:landing-composer-handoff:v1` when session storage is available, and keeps the same draft in memory for the current tab. The URL is never placed in navigation, analytics or API calls.
4. The root remains free of wallet-provider discovery and wallet-session restoration. Those begin only after navigation to a protected product route. Closing or failing wallet sign-in does not discard the handoff.
5. The Composer imports the handoff only after authenticated entry. If a saved Composer draft exists, it remains authoritative until the user chooses `Replace with landing URL`; `Keep saved draft` consumes the pending handoff without changing the saved draft.
6. Canonical product routes are `/app/runs`, `/app/runs/new`, `/app/runs/:id` and `/app/settings`; `/app` replaces to `/app/runs`. Legacy `/runs*` and `/settings` inputs replace to their canonical equivalents while preserving accepted query and fragment state.
7. `ShareLinkV1` remains byte-for-byte compatible as `/runs/:id#share=…`. A valid legacy share fragment is consumed and scrubbed before the application renders the canonical `/app/runs/:id` route. Query share authority remains rejected.
8. Authentication remains the existing SIWE EIP-4361 flow on Coston2 through EIP-6963/EIP-1193 injected EVM wallets. The UI calls them `Detected wallets` or `Compatible EVM wallets`; provider metadata is not described as verified. WalletConnect, Bifrost and EIP-1271 smart wallets are deferred.
9. The service remains under the selected Caddy/Docker VDS boundary from ADR 0029. Sites remains compatibility/preview packaging, not production hosting. Domain activation is a later credentialed 029B action.

## Consequences

- The public surface can start the primary product journey without claiming to audit a deployed contract.
- Root storage is now permitted only inside the explicit Continue action; passive root render still performs exactly the existing two anonymous same-origin summary reads.
- Route output changes to `/app/*`, so all product navigation and black-box contracts must be migrated together while keeping legacy inputs compatible.
- The handoff is an internal UI contract and is not exported from `@proofline/contracts`.
