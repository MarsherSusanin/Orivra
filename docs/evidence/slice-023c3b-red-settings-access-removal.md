# Slice 023C3B RED — Settings access removal

## Expected RED

The accepted parent exposes strict revoke and current-session DELETE ports, but
the Web session context has no generation-bound revoke transition or shared
issue/revoke mutation lane. Settings intentionally has no Revoke or Sign out
surface. The frozen tests therefore fail on only those missing C3B Web
behaviors; no production, dependency, public contract, API or SQL file changes
in this RED.

Recorded on parent `28a459abd362563fa2375aa68568576929e8a017` /
tree `f71d703c8f930d5280035852c566c0abe69a5621`:

- `npm run typecheck` — PASS;
- focused C3B contracts — 2 files / 28 tests, exactly 28 intentional RED;
- the 14 context RED cases are the absent `revokeAccountToken`, shared
  issue↔revoke mutation lane, strict response/persisted revoked-evidence gate,
  current invalid-authority clear and same-bearer A→B settlement rules;
- the 14 Settings RED cases are absent non-revoked revoke controls,
  confirmations/focus/pending/retry, direct persisted status, sign-out
  204/401/invalid-authority-403 clear, offline/origin-403/5xx recovery,
  explicit local forget, one-time reveal collision, axe and 390 px layout;
- nearest unchanged C1 controller, C2B2 authority and C3A Settings/context
  baseline — 4 files / 42 tests PASS;
- that baseline still emits its accepted C3A anonymous-restore React `act(...)`
  harness warning; the new C3B anonymous harness was flushed and emits no new
  warning.

The focused failures arise before any new service effect can be made: current
production lacks the context method and rendered controls/classes. Fixtures
use only local ports and strict recorded values. No network, wallet provider,
PostgreSQL, Docker, hosted or live Coston2 operation is reached.

## Superseded C3A assertion correction

After the C3B freeze, the two C3A assertions that required Revoke and Sign out
to remain absent became superseded negative contracts. They expressed C3A's
then-deferred scope, not durable product behavior, and would contradict this
frozen C3B surface once GREEN. The corrective wave removes only those two
negative assertions. It preserves C3A wallet identity, exact ordered statuses,
provider silence, axe, issuance, generation, reveal and leakage expectations.

Recorded on RED parent `86794dc51724b59187a673e61dfa5010c314c2cf` /
tree `74aca81152e411f22d9ce64d04d2e276ca0bf596`:

- corrected C3A Settings contract — 1 file / 10 tests PASS;
- focused C3B remains 2 files / 28 tests, exactly 28 intentional RED;
- nearest unchanged C1 controller, C2B2 authority and C3A context baseline —
  3 files / 32 tests PASS;
- typecheck and diff-check — PASS.

No C3B expectation is weakened and no new positive C3A revoke/sign-out behavior
is invented; those behaviors remain owned exclusively by the frozen C3B tests.

## Frozen corrective details

- One authority generation serializes account mutations. Identical issue or
  same-target revoke calls coalesce; any other issue/revoke pairing receives a
  fixed local 409 without a second service call.
- A revoke resolves only after its strict returned target and refreshed
  non-null `revokedAt` agree. Mismatch, missing target or still-active evidence
  is fixed 502 contract failure and never closes the confirmation.
- Current revoke 401/`ACCOUNT_SESSION_REQUIRED` clears only current authority;
  late A maps to stale 403 and cannot clear B. Sign-out applies the same bearer
  invalidity rule while retaining origin/unknown 403, transport and 5xx for
  Retry or explicit Forget.
- Both pending and already visible one-time raw results become permanently
  stale when sign-out starts, including when remote sign-out later fails.
- Open revoke, sign-out and recovery states own labelled/described focus and
  axe checks; mobile evidence prevents a squeezed four-column token row and
  requires bounded, stacked 44 px actions.

Coverage, browser screenshots, build, Sites and full Web are GREEN gates, not
RED evidence. The unified repository matrix remains deferred until all
credential-free 022–029A modules are complete.

## Corrective verifier-finding RED

The first GREEN candidate was rejected on exact commit
`de6c01bd994564c4a1972ff5e102ad003466af67` / tree
`1134a30a9d75014fde61dc590ea5150206fff2e6`. Independent review found
`AccountSettings.tsx` at 91.03% lines but 75.82% branches and demonstrated an
actual keyboard escape: while a confirmation is pending, both actions are
disabled, leaving no tabbable element in the `aria-modal`. Review also found
unreached pending/unmount, retry-label, expiry-only and CSPRNG-failure paths.

The corrective tests/docs-only wave freezes the smallest reachable contracts:

- revoke and sign-out confirmations cycle Tab and Shift+Tab in their normal
  state;
- pending confirmations keep focus inside the modal and contain Tab and
  Shift+Tab while duplicate submit and Escape remain blocked;
- deferred retry remains in recovery, exposes disabled
  `Retrying sign-out…`, disables Forget and sends one retry request;
- pending revoke resolve/reject, sign-out and retry settlements after unmount
  are inert and do not emit raw data or React unmount/`act` warnings;
- expiry-only invalid input focuses expiry, and CSPRNG failure renders only
  fixed safe copy without calling the service or exposing an error echo.

Four context warnings were corrected only by awaiting the existing state work
inside the test harness `act`; no production behavior or contract changed.
Against the rejected candidate, the Settings contract is 1 file / 22 tests:
19 PASS and exactly 3 intentional RED. Those failures are the two pending-modal
focus escapes and the retry recovery/pending-label transition. The context
contract is 1 file / 14 tests PASS with no `act` warning. Combined focused C3B
is therefore 2 files / 36 tests, 33 PASS and exactly 3 intentional RED.

Failure-reporting design coverage over the corrected C3A and C3B Settings
contracts records `AccountSettings.tsx` at 95.75% lines and 85.16% branches
(97.77% functions, 92.05% statements). This exceeds the React design target
but is not GREEN evidence because the three frozen behaviors still fail.

Typecheck passes. The nearest unchanged C1 controller, C2B2 authority and C3A
context baseline is 3 files / 32 tests PASS; it retains the already accepted
C3A anonymous-restore harness warning. No broad or full matrix was run for this
corrective RED wave.
