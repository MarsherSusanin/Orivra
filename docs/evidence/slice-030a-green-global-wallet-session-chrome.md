# Slice 030A GREEN evidence — global wallet session chrome

Status: corrective Author GREEN; independent reverification pending.

The implementation adds one route-aware wallet session/chrome owner, one
deterministic dependency-free profile component and separate landing grid
contracts. It preserves the existing SIWE API, tab-scoped storage and
twelve-hour expiry. Share/project-token routes never restore or render the
browser identity, and no private token is added to DOM, analytics, history or
logs.

Final author gates PASS: typecheck; focused wallet/landing/Composer 39/39;
serialized Web 72 files / 612 tests; authoritative React coverage 92.16% lines
and 85.74% branches (components 88.63% / 81.37%); production build; Sites
46/46; and Action artifact byte-sync 1/1. The first serialized Web run exposed
a real authority-switch compatibility regression in one retained Composer
test; the provider boundary was corrected without weakening that retained
contract, and the exact no-edit rerun passed 610/610.

The first independent Core wave then rejected the authenticated menu's ARIA
ownership and the sign-out modal's reverse-Tab boundary. Corrective GREEN moves
the descriptive identity block outside the `role=menu` owner and traps dynamic
normal, pending and failed sign-out focus sets. Both causal cases and all 610
retained Web cases pass in the exact corrective run (612/612 total).

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
