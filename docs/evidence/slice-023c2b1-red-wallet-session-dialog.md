# Slice 023C2B1 RED — wallet session context and sign-in dialog

## Frozen scope

The Contract & Test Designer split rendered wallet sign-in before freezing:

- B1 owns the single app-wide session context, isolated lazy dialog,
  accessibility, cancellation and responsive DOM contract;
- B2 later owns App/Runs/deep-route/Composer wiring, production bundle evidence
  and the initial gzip budget.

The B1 tests require no wallet/provider work on render or reload, parallel
network/discovery startup after one explicit action, named keyboard provider
selection, exact Coston2 EOA → challenge → sign → session composition, bounded
states, no analytics and no late-session persistence after close.

## Expected RED

The focused React contracts intentionally fail because
`src/wallet-session-context.tsx` and
`src/components/WalletSignInDialog.tsx` do not exist and the wallet-dialog CSS
and dynamic-import source contract are absent. `npm run typecheck` remains
green because production modules are loaded dynamically by the tests.

Nearest accepted baselines are the 023C1 session/controller contracts, 023C2A
adapter contracts and existing dialog accessibility/focus tests. Actual
browser/build/Sites evidence is not claimed in this isolated RED wave.

## Recorded evidence

- `npm run typecheck` — PASS.
- The four new B1 files — expected RED: 4 files / 10 tests fail; the bounded
  serial run completes in 1.43 s (47 ms in test bodies).
  Eight rendered cases stop on the absent context/dialog modules, the lazy
  source contract stops on the absent context file, and the mobile contract
  stops on the missing internal scroll rule. No test hangs or performs live
  network/provider work.
- The nearest accepted baseline — PASS: 8 files / 92 tests in 4.72 s. It covers all 023C1
  access-client/session-controller contracts, both accepted 023C2A provider
  contracts and the existing dialog focus/accessibility contracts.

This is RED evidence only. Coverage, production build, real browser and Sites
acceptance belong to GREEN/B2 and are not represented as passing here.
