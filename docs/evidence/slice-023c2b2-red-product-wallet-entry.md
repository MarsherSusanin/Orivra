# Slice 023C2B2 RED — product wallet entry

## Frozen scope

This RED connects accepted B1 behavior to App/Runs/deep routes/Composer without
implementing Settings, access-token management, quotas or infrastructure.
Contracts freeze root authority precedence, share isolation, exact pending
Composer intent and the production lazy bundle boundary.

## Expected RED

The current App still imports and renders `ProjectTokenDialog`, owns a second
session-token state and does not accept the deterministic wallet composition.
Runs/deep/Composer therefore cannot complete wallet self-service, Composer asks
for access before validation, and the production build contains no reachable
lazy wallet provider chunk.

## Recorded evidence

Evidence is recorded immediately before the RED freeze commit:

- `npm run typecheck` — PASS.
- New deterministic React contracts — expected semantic RED: 2 files / 7
  tests, 2 preserved-boundary tests pass and 5 fail because App has no wallet
  root, sign-in entry or pending Composer intent. The JSON run completes in
  about 5 seconds and performs no live wallet/network work.
- Corrected historical App/Runs/Composer contracts — expected semantic RED: 4
  files / 21 tests, 15 unaffected controls pass and 6 deprecated manual-token
  scenarios now fail on the missing wallet entry. The six are two `/runs`
  dialog escape/close cases, one locked deep route, one reconnect label, one
  deep hydration gate and one valid unauthenticated Composer submit.
- Nearest accepted B1/App/Composer/share baseline — PASS: 8 files / 39 tests.
- `npm run build` — PASS baseline; initial entry is 149.65 kB gzip.
- Standalone bundle contract — expected RED: 1 test fails because no reachable
  lazy `wallet-provider-adapter` chunk contains the sign-in-only
  `personal_sign`, `eth_getCode` and `wallet_addEthereumChain` markers. Existing
  run-submission use of `eth_requestAccounts` and `wallet_switchEthereumChain`
  in the initial entry is explicitly allowed.

No browser, Sites, hosted or live-network PASS is represented by this RED.
