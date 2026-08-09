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
