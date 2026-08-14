# Canonical implementation examples

Этот каталог указывает на маленькие эталонные участки текущей реализации. Новое решение следует сравнивать с ближайшим примером, а не создавать второй архитектурный путь.

| Задача | Эталон |
|---|---|
| Versioned public contracts | `packages/contracts/src/index.ts` и `packages/contracts/test/public-contracts.test.ts` |
| Event-sourced lifecycle и projection | `packages/domain/src/run-lifecycle.ts` и `packages/domain/test/run-lifecycle.test.ts` |
| Idempotent HTTP surface | `apps/api/src/app.ts` и API contract tests |
| PostgreSQL schema evolution | `apps/api/db/migrations/manifest.v1.json` and migrations `001`–`010`; the manifest, not an ad-hoc filename list, is authority |
| Restart-safe command execution | `apps/worker/src/worker.ts` и worker recovery tests |
| Production Coston2 composition | `apps/worker/src/live-runtime.ts` |
| SSRF-safe Web2Json fetch | `packages/fdc-coston2/src/safe-http.ts` и `packages/fdc-coston2/test/safe-http.test.ts` |
| Consumer diagnostics и safe codegen | `packages/domain/src/diagnostics.ts`, `packages/domain/src/codegen.ts` и Solidity tests |
| Persisted Consumer Lab и exact safe artifact | `apps/api/test/slice019-consumer-lab-report.contract.test.ts` и `src/slice019-consumer-lab.contract.test.tsx` |
| Consumer `Ready` route, focus and action ownership | `src/slice030b-run-stage-content-routing.contract.test.tsx` |
| Evidence receipt и read-only fragment handoff | `packages/domain/src/evidence-receipt.ts`, `src/components/IntegrationPackageDialog.tsx` и `src/slice020-handoff-journey-consistency.acceptance.test.tsx` |
| Privacy-safe aggregate QA report | `packages/domain/src/product-analytics.ts` и `packages/domain/test/product-qa-report.contract.test.ts` |
| Web service boundary | `src/services/run-surface.ts` |
| Persisted Action release path | `packages/action/src/runtime.ts` и `persisted-release-path.contract.test.ts` |
| Local MCP boundary and stdio protocol | `packages/mcp/src/index.ts`, `packages/mcp/src/server.ts` and `packages/mcp/test` |
| Hermetic persisted API/worker E2E | `tests/e2e/replay-flow.test.ts`; это не browser gate |
| Browser component acceptance | `src/slice020-handoff-journey-consistency.acceptance.test.tsx`; обязательный manual built-browser gate описан в `docs/runbook.md` |
| Sites routing contract | `worker/index.js` и `tests/sites-worker.test.mjs` |

При добавлении примера выбирайте один representative path, добавляйте рядом test, который доказывает контракт, и обновляйте таблицу только после прохождения полного slice protocol.
