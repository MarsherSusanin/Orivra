# Slice 001 Web/Sites GREEN evidence

Date: 2026-07-30

Role: Surface & Adapter Implementer (Web/Sites writer)

Base commit: `9411d1c`

## Implemented boundary

- Added the project-token browser client for create, projection/event reads, wallet submission preparation, tx-hash attachment, consumer verification, safe codegen, bundle export, replay, and local run/cursor resume.
- Kept user signing in EIP-1193: chain `0x72` is selected in-wallet and the API receives only the resulting transaction hash.
- Replaced the runtime simulator import with an injected service port. The deterministic adapter is guarded by Vite test mode and is absent from the production bundle.
- Preserved the accepted Run Cockpit hierarchy while adding a compact secondary bundle export/replay control.
- Added modal focus-on-open, Tab containment, Escape close, trigger focus restoration, evidence-backed retry, service-backed verification, and service-backed safe-consumer generation.
- Tightened Sites fallback: `/api`, every write method, and missing asset-like paths retain the original 404; HTML deep routes still resolve to the app shell.
- Registered `apps/web` workspace metadata while retaining `src/` as the canonical Web source required by `AGENTS.md`.

No frozen RED test, fixture, or backend production file was changed.

## GREEN evidence

```text
npm run test:web
  3 files passed; 11 tests passed

npm run test:sites
  7 tests passed

npm test
  23 files passed, 1 skipped; 211 tests passed, 1 skipped

npm run test:integration
  12 files passed, 1 skipped; 125 tests passed, 1 skipped

npm run test:e2e
  1 file passed; 2 tests passed

npm run typecheck
  passed

npm run build
  Vite production build passed
  dist/client/index.html emitted
  dist/server/index.js emitted
  dist/.openai/hosting.json emitted
```

Production output inspection found no `simulateConsumerVerification`, deterministic-adapter guard text, or legacy diagnostic fixture strings.

## Coverage measurement

`npm run test:coverage` passes as a command and reports the repository aggregate at 84.68% lines and 75.93% branches. This does **not** satisfy the release thresholds stated in the slice plan for every surface category; notably the newly introduced live service orchestration has only indirect frozen-contract coverage. This wave did not add or weaken tests because the implementer is not the Contract & Test Designer. A subsequent RED hardening wave is required before treating the numeric coverage gate as PASS.

## Verification boundary

This evidence is an author report, not either independent verifier PASS. Browser acceptance and source-image comparison remain intentionally unperformed until the candidate tree is frozen for Product Integration Verification.
