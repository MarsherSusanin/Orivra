# Slice 020 GREEN — evidence receipt and integration handoff

## Candidate

- RED 020A: `9b93e8e`.
- GREEN 020A: `b106247`.
- RED 020B: `4f06d62`.
- GREEN/corrective series: `cf83ad5`, `82d287b`, `a69c444`, `4201d6e`,
  `3dc1e05`, `3fa7279`.
- Candidate commit and tree are recorded after this evidence document is
  committed. Both independent verifiers must inspect that exact tree.

## Implemented result

- `EvidenceReceiptV1` is deterministically derived from exact canonical bundle
  bytes and keeps proof, bundle and safe-consumer checksums distinct.
- `GET /v1/runs/:id/receipt` is project/share readable and fails closed on
  stored artifact checksum drift.
- `ShareLinkV1` exposes only an HTTPS, run-bound fragment capability. The raw
  token is not duplicated in a response field or placed in query parameters.
- Web consumes a valid share fragment synchronously, moves it into run-scoped
  session storage and immediately removes it from the address bar/history.
- Integration Package verifies receipt, bundle, Consumer Lab and generated
  Solidity evidence locally before enabling exact-byte downloads.
- Project access receives one idempotent share action. Share access remains
  read-only and has no verify, codegen, replay or share-creation controls.
- The configured public Web origin is accepted only as an HTTPS default-port
  root origin. Generated share links are schema-checked by the API and bound to
  the expected Web origin again by the browser client.
- Integration Package requires exact agreement between Consumer Lab and the
  receipt for both the consumer verdict and canonical diagnostic-code set.
- Repository-local CLI and GitHub Action instructions match the current package
  layout; no unpublished package name is suggested.

## Hermetic and coverage evidence

- `npm run typecheck`: PASS.
- `npm test`: 168 files PASS, 4 infrastructure-conditioned files skipped;
  1488 tests PASS, 14 skipped.
- `npm run test:core:coverage`: 356 tests PASS; statements, branches,
  functions and lines all 100%.
- `npm run test:coverage:backend`: 770 PASS, 14 skipped; 92.08% statements,
  87.76% branches, 92.99% lines.
- `npm run test:coverage:web`: 309 PASS; 87.84% statements, 83.95% branches,
  89.66% lines.
- `npm run test:solidity`: 214 PASS.
- `npm run test:e2e`: 7 PASS, including persisted Consumer Lab handoff and
  exact generated-diff evidence.
- `npm run build`: PASS; required Sites files emitted. The existing Vite
  warning for a JavaScript chunk above 500 kB remains non-blocking.
- `npm run test:sites`: 7 PASS.

## PostgreSQL evidence

The first invocation correctly failed because Docker Desktop was not running;
it was not counted as a pass. After starting the local container runtime:

```text
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
16 files PASS · 114 tests PASS · 0 skipped
```

## Browser acceptance evidence

The production Web build was connected only to the repository hermetic HTTP
composition. No arbitrary manifest source request or external Coston2 effect
was used.

- Chromium / Codex in-app browser, desktop `1488×1058`: cockpit hierarchy,
  Integration Package, exact four download names, focus entry and `Escape`
  restoration PASS.
- Mobile `390×844`: no document horizontal overflow; primary handoff action
  ends above the fixed navigation; dialog fits the viewport width and scrolls
  vertically.
- Reload and Back/Forward preserve `?panel=integration` and the same persisted
  run.
- Generated share URL uses `#share=...` with no query capability. Navigation
  consumes and scrubs the fragment; the shared dialog exposes no mutation
  controls.
- Browser console: no warning/error entries.
- Axe contract for the completed Integration Package: zero serious or critical
  violations. Visible keyboard focus and accessible names were also inspected
  in Chromium.

The browser pass found and caused correction of a missing hermetic
`/consumer-lab` read model and incomplete unified-diff evidence before freeze.
Those corrected paths are now covered by the hermetic E2E suite.

## Independent-verifier corrective wave

The first frozen candidate was not accepted: independent verification found
that a share reader could still invoke the replay-based bundle control, the
public origin boundary was too permissive, and contradictory Consumer Lab and
receipt verdicts were not rejected. Those findings were converted into frozen
RED contracts in `3dc1e05` and closed in `3fa7279`. The complete matrix above
was rerun after the production correction; the earlier verifier signatures are
invalid and are not counted toward release.

## Scope note

Slice 020 is a hermetic product handoff increment. Live Coston2 and deployed
infrastructure acceptance remain separate release gates and are not claimed by
this evidence.
