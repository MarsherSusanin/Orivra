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

## Corrective RED after rejected GREEN

Candidate `d3a543a7f7b98a89851904fb5f6efe72e35ec1a3` exposed share fallback
and a non-hermetic historical restore harness. Four new authority cases cover
write-denied valid share, invalid fragment plus project, query attempt plus
project, and malformed attempt plus restored valid share. The four previous
authority controls pass and exactly these four cases fail on the candidate.

Every historical test that seeds `proofline:project-token` without an explicit
App override now injects deterministic wallet access: one App hardening case,
three production-run cases and five recovery cases including the second
Composer render. Targeted harness evidence is 3 files / 23 tests PASS. A
rejecting fetch spy is never called. Full Web is 57 files / 420 tests: 416 PASS
and only the four intentional share RED cases fail; no localhost/EPERM network
failure occurs. `npm run typecheck` passes.

## StrictMode corrective RED

React development `StrictMode` replays the App state initializer after the
first invocation has scrubbed the capability URL. The focused contract now
also renders the real App root under `React.StrictMode`: a valid current share
whose session write is denied must still hydrate exactly once with read-only
share authority, perform zero account/network/provider work and preserve the
stored project token. After unmount, another run must restore only its project
authority, proving that the bootstrap handoff is bounded and cannot leak a
share across mounts or runs. Two table cases require invalid-fragment and
query-share attempts to stay suppressive across the same initializer replay.

The implementation may retain the first parse result only for the same run and
initialization turn, clearing it after initialization (at latest the next
microtask) and on unmount. A long-lived global capability cache is explicitly
outside the accepted trust boundary.

Recorded on parent `203351da3ee7976ce97fed7cb4a7ec12e35a08e5` /
tree `c7c67ace160237813d901bba5e652361ade62b3c`:

- `npm run typecheck` and `git diff --check` — PASS;
- focused authority contract — 1 file / 11 tests: 4 established controls PASS
  and 7 intentional RED (the prior 4 authority failures plus these 3
  StrictMode failures);
- the valid StrictMode case receives two hydration calls instead of one; the
  invalid-fragment and query cases lose their suppressive result after the URL
  is scrubbed and fall back to the readable project session;
- deterministic seeded-session controls — 3 files / 23 tests PASS with no
  browser provider or localhost/network work.
