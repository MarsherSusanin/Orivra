# Proofline development roles

Every small vertical slice follows one evidence-producing cycle:

`Slice Contract / ADR → RED → GREEN core → GREEN surfaces → refactor → candidate freeze → code verification → product integration verification`

## Roles

| Role | Responsibility | Required artifact |
|---|---|---|
| Proofline Slice Architect | Scope, dependencies, risk class, ADR impact and acceptance criteria | Slice Contract |
| Contract & Test Designer | Public schema plus intentional failing contract, migration and acceptance tests | Frozen RED tests and RED evidence |
| FDC Run Core Implementer | Minimum deterministic state machine, diagnostics, replay, codegen and ports | GREEN core |
| Surface & Adapter Implementer | Web/API/worker/PostgreSQL/FDC/wallet/CLI/Action/Sites integration | GREEN surfaces |
| Core Code Verifier | Read-only review of correctness, determinism, SSRF, relayer, idempotency and edge cases | PASS or findings |
| Product Integration Verifier | Black-box Web/API/CLI/Action/package/live Coston2 verification | PASS or findings with browser/CLI/live evidence |

The root coordinator acts as Slice Architect. Other roles use independent agents when the slice requires code changes.

## Wave rules

- One writer owns the shared tree during a wave; read-only audits may run in parallel.
- Contract/Test Designer demonstrates the expected RED reason and freezes those tests before implementation.
- Core implementation reaches GREEN without introducing surface-specific I/O.
- Surface implementation connects the same public contracts; it does not create an alternate lifecycle.
- Refactor may improve structure but cannot change frozen acceptance contracts.
- Record the candidate commit and tree hash before either verification wave.
- Production authors cannot act as either verifier. The two verifiers must be different agents.
- Verifiers inspect the exact same tree and report findings; they do not patch production code.
- Any production edit after either PASS invalidates both passes and starts a new candidate freeze.
- Merge only after both independent PASS reports exist for the same tree hash.

## Slice Contract minimum

Each Slice Contract names:

- user-visible outcome and explicitly excluded scope;
- affected public schemas/endpoints/events;
- dependency and ADR impact;
- security and data-migration risk class;
- intentional RED tests and expected failure reason;
- hermetic, PostgreSQL, Solidity, browser, Sites or live acceptance gates as applicable;
- evidence required from each verifier.

## Verification baseline

Core verification checks deterministic replay, event ordering, terminal immutability, checksum mutation detection, normalized errors, safe fetch boundaries, relayer authorization and duplicate/restart behavior.

Product integration verification checks the minimal user journey across all affected surfaces, reload persistence, export/reparse, keyboard/accessibility, clean console/network, package contents, Sites routing and—when release-relevant—the persisted Coston2 gate. Commands and environment boundaries are defined in `docs/runbook.md`.
