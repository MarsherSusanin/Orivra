# Slice 030A — Global wallet session chrome

Status: terminal-focus corrective RED after second Core FAIL

Decision: [ADR 0046](../adr/0046-global-wallet-session-chrome.md)

## Outcome

Make the existing twelve-hour, tab-scoped SIWE session visible across ordinary
public and private Web routes without changing authentication authority. Fix
the landing wallet-security CTA whose two children previously inherited the
three-column trust-gap grid.

## Frozen boundary

- one route-aware `WalletSessionProvider` and wallet-chrome owner cover the
  landing page, Composer, Runs, Settings and templates;
- browser wallet authority is unavailable on exact share and caller-supplied
  project-token routes, which render only neutral access labels;
- successful SIWE updates the top bar immediately and leaves an explicit
  `Signed in` result visible until Continue;
- authenticated desktop chrome shows a local deterministic identicon,
  shortened address and accessible profile menu; mobile retains the identicon
  and menu without the shortened address;
- sign-out confirmation uses the existing current-session DELETE and exposes
  bounded retry or local browser forgetting after a server failure;
- Settings calls the identity `Verified wallet`, never a persistent provider
  connection;
- wallet-security uses a dedicated two-column grid above 720px and one full
  width column below it; `Verify an endpoint` never wraps;
- there is no API, SIWE, session-duration, route, DNS, V2BOX, local-network or
  production-host change in this slice.

## Acceptance

The frozen contracts cover anonymous, restoring, unavailable, authenticated,
share and project-token chrome; token exclusion from DOM; reload/history
authority restoration; menu keyboard/focus/copy/settings/sign-out behavior;
explicit post-SIWE confirmation; and desktop/mobile CTA geometry. Author gates
and two independent reports are recorded before release publication.
