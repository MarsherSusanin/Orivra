# Canonical implementation examples

Этот каталог указывает на маленькие эталонные участки текущей реализации. Новое решение следует сравнивать с ближайшим примером, а не создавать второй архитектурный путь.

| Задача | Эталон |
|---|---|
| Versioned public contracts | `packages/contracts/src/index.ts` и `packages/contracts/test/public-contracts.test.ts` |
| Event-sourced lifecycle и projection | `packages/domain/src/run-lifecycle.ts` и `packages/domain/test/run-lifecycle.test.ts` |
| Idempotent HTTP surface | `apps/api/src/app.ts` и API contract tests |
| PostgreSQL schema evolution | `apps/api/db/migrations/001_initial.sql`, затем `002_one_active_submission.sql` |
| Restart-safe command execution | `apps/worker/src/worker.ts` и worker recovery tests |
| Production Coston2 composition | `apps/worker/src/live-runtime.ts` |
| SSRF-safe Web2Json fetch | `packages/fdc-coston2/src/safe-http.ts` и `packages/fdc-coston2/test/safe-http.test.ts` |
| Consumer diagnostics и safe codegen | `packages/domain/src/diagnostics.ts`, `packages/domain/src/codegen.ts` и Solidity tests |
| Web service boundary | `src/services/run-surface.ts` |
| Persisted Action release path | `packages/action/src/runtime.ts` и `persisted-release-path.contract.test.ts` |
| Browser acceptance | `tests/e2e/replay-flow.test.ts` |
| Sites routing contract | `worker/index.js` и `tests/sites-worker.test.mjs` |

При добавлении примера выбирайте один representative path, добавляйте рядом test, который доказывает контракт, и обновляйте таблицу только после прохождения полного slice protocol.
