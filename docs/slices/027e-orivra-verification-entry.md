# Slice 027E — Orivra verification entry

## Outcome

An anonymous Web3 developer can enter one public HTTPS API endpoint on `/`, inspect the local trust boundary, continue through the existing wallet sign-in and resume a prefilled Composer at `/app/runs/new?step=source`.

## Frozen contract

- No browser request to the entered source URL.
- No provider discovery, wallet session restore, private API call or storage read during passive root render.
- Strict bounded `Web2JsonManifestDraftV1` handoff; sensitive and duplicate query entries fail closed.
- Saved Composer drafts are never silently overwritten.
- Existing SIWE, EOA-only, chain-114 and lazy-provider contracts stay unchanged.
- Public `ShareLinkV1` stays `/runs/:id#share=…`; emitted product navigation uses `/app/*`.
- No DNS, deployment, Coston2 or other credentials are used.

## Verification

Start with the landing handoff and route contracts, then typecheck and the narrow Web contracts. After GREEN, run Web coverage, build, Sites compatibility, and desktop/mobile browser acceptance including keyboard, axe, console/network and history restoration.

## Candidate status

Production-author GREEN candidate; independent Core and Product verification is pending for one exact committed tree.

- `npm run typecheck`: PASS.
- Web contracts: 176 suites and 601 tests PASS.
- React coverage: 89.25% lines and 81.59% branches for `src/components`; repository Web coverage is 92.57% lines and 85.91% branches.
- `npm run build`: PASS with `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json` present.
- `npm run test:sites`: 46 tests PASS, including canonical and legacy deep-route fallback plus `/api` fail-closed routing.
- Browser acceptance: 1440×1000 desktop and 390×844 mobile PASS; keyboard Escape/focus behavior, reload/back-forward handoff restoration, serious/critical axe scan, zero app console errors under local summary fixtures, and a request log containing only the two existing same-origin landing summary reads PASS.
- No entered source endpoint, wallet provider or private API request was observed before the explicit product action.

Slice 028A production and frozen output are unchanged. Its accepted exact-tree Core and Product PASS report identities are recorded only in the canonical release status documents.
