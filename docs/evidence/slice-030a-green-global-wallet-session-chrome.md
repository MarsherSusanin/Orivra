# Slice 030A GREEN evidence — global wallet session chrome

Status: Settings-composition corrective Author GREEN; reverification pending.

The implementation adds one route-aware wallet session/chrome owner, one
deterministic dependency-free profile component and separate landing grid
contracts. It preserves the existing SIWE API, tab-scoped storage and
twelve-hour expiry. Share/project-token routes never restore or render the
browser identity, and no private token is added to DOM, analytics, history or
logs.

Final author gates PASS: typecheck; focused wallet/landing/Composer 39/39;
serialized Web 72 files / 612 tests; authoritative React coverage 92.17% lines
and 85.76% branches (components 88.67% / 81.42%); production build; Sites
46/46; and Action artifact byte-sync 1/1. The first serialized Web run exposed
a real authority-switch compatibility regression in one retained Composer
test; the provider boundary was corrected without weakening that retained
contract, and the exact no-edit rerun passed 610/610.

The first independent Core wave then rejected the authenticated menu's ARIA
ownership and the sign-out modal's reverse-Tab boundary. Corrective GREEN moves
the descriptive identity block outside the `role=menu` owner and traps dynamic
normal, pending and failed sign-out focus sets. Both causal cases and all 610
retained Web cases pass in the exact corrective run (612/612 total).

The second Core wave then rejected focus restoration after the two terminal
anonymous transitions. The terminal-focus correction focuses the newly
rendered anonymous sign-in successor only when an open sign-out flow changes to
anonymous; initial anonymous pages do not receive unsolicited focus. Both
server-revocation success and local-forget causal assertions now pass.

The third Product wave then reproduced a Settings-only focus race: its
background recovery layout effect focused `Retry sign-out` after the global
modal entered the failed state. Corrective GREEN restores modal focus in a
post-layout failed-state effect, while retaining the background recovery UI for
the separate Settings-owned sign-out flow. The exact `/app/settings` causal
contract now keeps focus inside the global modal and preserves local forgetting.

Mac production-preview browser acceptance PASS at 2048×900 and 390×844:
desktop wallet-security columns are 919px / 181px; mobile is one 300px column;
the CTA is 44px high, `nowrap`, fully visible, and both viewports have zero
horizontal overflow. The top-bar sign-in remains visible on mobile; its dialog
closes on Escape and returns focus. The integrated SIWE journey test records
the explicit `Signed in` panel, immediate profile update, Continue action and
zero serious/critical axe findings. Local preview's only console error was the
expected unavailable demo-recording API response, unrelated to wallet chrome.

This document does not claim hosted, deployed, Coston2, backup/PITR or security
PASS. The user-canceled scan 8852 and accepted deferred 027C risk remain
outside this UI slice.
