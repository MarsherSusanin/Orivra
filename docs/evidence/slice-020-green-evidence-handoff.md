# Slice 020 GREEN — evidence receipt and integration handoff

## Candidate

- RED 020A: `9b93e8e`.
- GREEN 020A: `b106247`.
- RED 020B: `4f06d62`.
- GREEN/corrective series: `cf83ad5`, `82d287b`, `a69c444`, `4201d6e`,
  `3dc1e05`, `3fa7279`, `95ca24e`, `9a57aa4`, `801c0bf`, `b824b28`,
  `8379417`, `f97df13`, `8b1d4ce`.
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
- `npm test`: 169 files PASS, 4 infrastructure-conditioned files skipped;
  1491 tests PASS, 14 skipped.
- `npm run test:core:coverage`: 356 tests PASS; statements, branches,
  functions and lines all 100%.
- `npm run test:coverage:backend`: 770 PASS, 14 skipped; 92.08% statements,
  87.76% branches, 92.99% lines.
- `npm run test:coverage:web`: 312 PASS; 89.04% statements, 84.54% branches,
  91.07% lines. The Web gate explicitly excludes `apps/**`; imported hermetic
  API code remains covered by the separate backend gate.
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

The next Product Integration Verification correctly found that the real
hermetic vulnerable-consumer journey could not reach handoff: Consumer Lab
invented a passing safe verification while the receipt retained the vulnerable
failure, and reload exposed only a terminal retry action. The finding became
two full-path RED acceptance tests in `95ca24e` and `9a57aa4`. The correction:

- preserves `canonical-vulnerable`, failure and diagnostic evidence in both
  Consumer Lab and receipt;
- carries the separately compiled safe artifact without claiming it was
  executed successfully;
- resumes persisted Consumer Lab after reload without a second terminal
  verification POST;
- uses the canonical generated contract identity required by the bundle
  checksum.

The complete matrix above, including real PostgreSQL, was rerun after this
production correction. All earlier verifier decisions are invalidated; two new
independent PASS decisions are required on the final tree recorded after this
document is committed.

A later rejected candidate exposed three further release edges. They were
frozen in `f97df13` and closed in `8b1d4ce`:

- reload before codegen reconstructs persisted vulnerable failure and offers
  codegen directly; it never exposes or sends another terminal verification;
- Consumer Lab matrix values come from the exact request URL that produced the
  diagnostic, so observed host/query and diagnostic provenance agree;
- the checked-in GitHub Action artifact is regenerated and independently
  byte-identical to a clean deterministic node20 build.

The full matrix and standalone Action artifact-sync test were rerun again after
these corrections. As before, no earlier verifier decision applies to the next
candidate tree.

## Scope note

Slice 020 is a hermetic product handoff increment. Live Coston2 and deployed
infrastructure acceptance remain separate release gates and are not claimed by
this evidence.
