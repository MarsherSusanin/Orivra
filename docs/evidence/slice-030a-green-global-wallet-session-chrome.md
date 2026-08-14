# Slice 030A GREEN evidence — global wallet session chrome

Status: Author GREEN; exact final commit/tree and independent report identities
are appended only after the clean verification wave.

The implementation adds one route-aware wallet session/chrome owner, one
deterministic dependency-free profile component and separate landing grid
contracts. It preserves the existing SIWE API, tab-scoped storage and
twelve-hour expiry. Share/project-token routes never restore or render the
browser identity, and no private token is added to DOM, analytics, history or
logs.

Final author gates PASS: typecheck; focused wallet/landing/Composer 37/37;
serialized Web 72 files / 610 tests; authoritative React coverage 92.20% lines
and 85.69% branches (components 88.66% / 81.20%); production build; Sites
46/46; and Action artifact byte-sync 1/1. The first serialized Web run exposed
a real authority-switch compatibility regression in one retained Composer
test; the provider boundary was corrected without weakening that retained
contract, and the exact no-edit rerun passed 610/610.

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
