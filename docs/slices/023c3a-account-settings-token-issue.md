# Slice 023C3A — Account Settings and one-time token issue

## User outcome

An authenticated developer can see the connected wallet and existing
CLI/Action credentials, generate one new credential and safely copy its secret
once without another wallet prompt.

## Frozen scope

- `Settings` is a real `/settings` link and active navigation state.
- Anonymous Settings shows one wallet-session card and the accepted shared
  sign-in dialog.
- Only the accepted authenticated browser controller grants management.
  Explicit embed/CLI/Action/legacy and share capabilities do not.
- Wallet address has a copy action. Existing token summaries preserve the
  exact `AccountV1` order and show direct `active`, `expired` or `revoked`
  labels without hover.
- The form accepts `cli | action`, a trimmed 1–128 character label and an
  integer 1–90 day lifetime, default 30, with one dominant `Generate` action.
- One CSPRNG `token_issue_<64 lowercase hex>` idempotency key belongs to one
  in-flight attempt. Double click creates one request.
- Success refreshes the account once and does not discover, read or prompt a
  wallet provider.
- The one-time reveal is modal, non-backdrop-dismissable and focuses `Copy`.
  Escape/Close before copy requires explicit loss confirmation; after copy it
  closes, clears the raw token and restores focus.
- The raw token exists only as component-memory text. It is absent from
  storage, URL/history, analytics, logs, attributes and serialized errors.
- Failure is redacted and retains the user's form.

Revocation and current-session sign-out are deferred to 023C3B. Run retention
and deletion remain Slice 027. This slice changes no contract, API, migration,
wallet adapter, Sites or infrastructure boundary.

## Frozen tests

- `src/slice023c3a-settings-route.contract.test.tsx`;
- `src/slice023c3a-account-settings.contract.test.tsx`;
- `src/slice023c3a-wallet-session-context-account.contract.test.tsx`;
- corrected Settings navigation expectations in the existing product-entry
  accessibility/state contracts.

## Targeted GREEN gates

Run typecheck, these contracts, the accepted C1/C2B2 account/session/navigation
baseline, affected React coverage at least 85% lines and 80% branches, and full
Web only after focused GREEN. No backend, PostgreSQL, Solidity, Sites, build or
live gate is owned by this module.

## Browser acceptance after GREEN

Inspect the local built preview at `1488×1058` and `390×844`:

1. anonymous `/settings` opens and closes one shared sign-in dialog with focus
   return and no provider work before its explicit action;
2. authenticated reload restores account once and never prompts the wallet;
3. token summaries keep their server order and visible statuses;
4. invalid fields remain inline; double click creates one request and one
   reveal dialog;
5. backdrop, Escape/Close confirmation, successful Copy, raw-token clearing and
   focus restoration match the frozen contract;
6. the mobile form/actions stack, the dialog remains bounded and the token
   wraps without horizontal overflow;
7. keyboard traversal is complete, axe has no serious/critical violations and
   console/network logs contain no token or duplicate request.

Screenshots and browser console/network evidence belong to GREEN. This RED
does not claim browser, build, Sites, hosted or live-network PASS.

Architecture decision: [ADR 0028](../adr/0028-settings-one-time-token-issue.md).
