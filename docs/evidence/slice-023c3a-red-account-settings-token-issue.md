# Slice 023C3A RED — Account Settings token issue

## Expected RED

The accepted parent has no `/settings` branch, `AccountSettings` component or
account issue/refresh operations in the wallet-session context. `Sidebar`
still renders Settings as unavailable. Focused tests therefore fail only on
those missing Web modules and behaviors; existing public contracts and API
client remain unchanged.

The RED freezes route authority, stable account evidence, local validation,
single in-flight issuance, one-time raw-secret handling, redacted failure,
keyboard/axe semantics and the 390 px stacked/no-overflow CSS contract.

Recorded on parent `44da4e36bfe18c2505a1ab19d315caadd185615e` /
tree `ca1ba4f8bd36395deaddaa49cde4cc4d40d6084d`:

- `npm run typecheck` and `git diff --check` — PASS;
- focused Settings and corrected navigation contracts — 4 files / 21 tests:
  9 unaffected controls PASS and 12 intentional RED;
- the 12 failures are the absent `AccountSettings` module (4), absent App route,
  authority and mobile CSS behaviors (6), and the two former disabled-Settings
  assertions now requiring a real link;
- nearest accepted wallet auth/client/session/App journey baseline — 5 files /
  29 tests PASS.

The App source also lacks the frozen account-only `createAccountToken` and
`refreshAccount` context transitions; no test reaches network, wallet provider,
API, PostgreSQL or live Coston2 behavior. No browser, coverage, build, Sites,
hosted or live-network PASS is represented here.

## Clipboard harness correction

Both copy contracts install their own deterministic `vi.fn` `writeText` port
through a configurable `navigator.clipboard` descriptor after
`userEvent.setup()`. `afterEach` restores the exact prior descriptor even when
the missing production module makes the test RED. Assertions now target the
explicit spy rather than relying on user-event's environment clipboard stub.
The reveal case also inspects real `Storage.prototype.setItem` calls and both
browser storage objects, so the raw token cannot enter the local analytics
queue or another browser persistence path. Product behavior is unchanged.
After the correction, typecheck and diff-check remain PASS, the focused result
remains 4 files / 21 tests with 9 controls PASS and the same 12 intentional RED,
and the nearest accepted baseline remains 5 files / 29 tests PASS.

## Affected-branch corrective RED

The component contract adds only reachable decisions: clipboard rejection and
absence, accessible invalid-field focus, synchronous/asynchronous issue
failure followed by distinct deliberate idempotent attempts, and an issued
secret resolving after unmount. A separate context contract freezes
fail-closed anonymous/stale account operations plus authenticated create and
refresh without wallet/network work. Client schema poisoning is already owned
by 023C1 and is not duplicated; structurally impossible null branches are not
added for coverage. Exact focused and include-only coverage evidence is
recorded after this correction runs.

Recorded on the clean RED parent:

- typecheck and diff-check — PASS;
- focused Settings/context/navigation contracts — 5 files / 27 tests: 9
  unaffected controls PASS and 18 intentional RED;
- RED reasons are missing `AccountSettings` (7), missing App route/authority/CSS
  (6), missing context account methods (3), and disabled Settings links (2);
- nearest accepted wallet auth/client/session/App baseline — 5 files / 29 tests
  PASS.

An include-only production percentage is intentionally not claimed on this
clean RED tree because `AccountSettings` does not exist and the context has no
account-operation branches yet. The frozen cases map every reported reachable
decision; the production writer must run include-only coverage after GREEN and
meet at least 85% lines / 80% branches for the new component and changed
context before candidate freeze.
