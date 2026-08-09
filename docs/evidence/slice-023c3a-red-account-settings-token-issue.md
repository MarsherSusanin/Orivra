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

## Authority-generation corrective RED

Rejected candidate `1d34635cfc241f20825f62a3e598b48a59d0b893` /
tree `3f537020790c3826438dcee5c62c73fe3f3ac75e` compared account effects only by
bearer and kept one global refresh flight. Five focused race contracts now
cover:

1. late A issue after B authentication with the same bearer bytes;
2. full Settings behavior for that same transition;
3. unresolved refresh A followed by a distinct refresh B;
4. same-generation refresh coalescing;
5. same-generation identical issue coalescing and different-intent safe busy.

Recorded evidence:

- typecheck and diff-check — PASS;
- focused Settings/context contracts — 2 files / 15 tests: 11 PASS and exactly
  4 intentional RED;
- the four RED reasons are late A raw result returned by context, late A secret
  revealed by Settings, B refresh aliased to A, and identical issue intent not
  coalesced; same-generation refresh already passes;
- nearest unmodified Settings route/navigation/provider baseline — 4 files /
  20 tests PASS.

The tests use the real provider/controller transitions rather than a token-only
mock. They require the opaque generation to stay absent from runtime context
keys, serializable snapshot, DOM, public context type and analytics imports.
No production, public schema, API or persistence change is part of this RED.

## Atomic issue-refresh corrective RED

Rejected candidate `b705b2336cb8143f3f6da66e5ec0b76bec554fc7` /
tree `d6c7c5b1ad3f02261640f94a6104e068ae671b7c` rejects stale issue service
responses, but returns a current raw result before summary refresh and leaves
the component to refresh afterward. That creates a generation-change gap.

The corrective contracts freeze:

- successful same-generation refresh updates strict account evidence before
  the raw Promise resolves;
- issue coalesces an existing same-generation refresh and stays unsettled until
  it completes;
- refresh resolve or reject after A→loss→same-bearer B produces fixed safe
  stale rejection, never raw A;
- current-generation refresh failure preserves prior account evidence and
  returns the one-time raw result once without inventing a public warning
  contract;
- `AccountSettings` never performs a post-create refresh;
- authority loss clears an already visible reveal before B surfaces and it
  cannot reappear under B.

Recorded evidence:

- typecheck and diff-check — PASS;
- focused context/Settings contracts — 2 files / 21 tests: 14 PASS and exactly
  7 intentional RED, one for each missing atomic decision above (the stale
  settlement case is separately frozen for resolve and reject);
- nearest unmodified Settings route/navigation/provider baseline — 4 files /
  20 tests PASS.

The focused command emits no new React `act(...)` warning, so no unrelated
harness rewrite is included. No production, dependency, public contract, API
or database file changes in this corrective RED.
