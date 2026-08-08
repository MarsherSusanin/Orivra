# Proofline ADR index

ADR фиксирует архитектурное решение, которое меняет границы пакетов, trust model, persistence, release path или пользовательский контракт. Новый ADR создаётся до реализации, получает следующий свободный номер и содержит context, decision, consequences и status. Исторические gaps в нумерации допустимы; существующие номера не переиспользуются.

| ADR | Решение |
|---|---|
| [0001](0001-proofline-control-plane.md) | Control-plane boundaries и dependency direction |
| [0002](0002-production-composition-and-evidence.md) | Production composition и typed evidence как release artifact |
| [0003](0003-persisted-command-outcomes.md) | Persisted command outcomes как orchestration boundary |
| [0005](0005-one-persisted-release-path.md) | Один persisted release path для CLI, Action и live gates |
| [0006](0006-mobile-navigation-safe-area.md) | Reserved safe area для fixed mobile navigation |
| [0007](0007-one-terminal-release-command-graph.md) | Один terminal release command graph на run |
| [0008](0008-attempt-before-io-and-local-pr-replay.md) | Attempt before I/O и local PR replay |
| [0009](0009-no-test-custody-code-in-worker-artifact.md) | Test custody code не попадает в worker artifact |
| [0010](0010-manifest-owned-submission-and-evidence-ui.md) | Submission mode принадлежит manifest; UI выводится из evidence |
| [0011](0011-authorize-at-final-relayer-effect.md) | Повторная авторизация непосредственно перед relayer effect |
| [0012](0012-one-persisted-live-gate.md) | Единственный live gate проходит через API/PostgreSQL/worker |
| [0013](0013-single-deadline-and-bound-evidence.md) | Один deadline и commit/tree-bound release evidence |
| [0014](0014-local-composer-draft-boundary.md) | Versioned local Composer draft и один idempotent create boundary |
| [0015](0015-composer-finalization-and-draft-recovery.md) | Composer finalization и безопасное восстановление draft |
| [0016](0016-public-preflight-report-boundary.md) | Redacted persisted preflight report как public evidence boundary |
| [0017](0017-persisted-preflight-workbench.md) | Persisted preflight Workbench, URL state и transition analytics |
| [0018](0018-explicit-submission-confirmation.md) | Explicit confirmation как единственная граница wallet/relayer/replay submission |
| [0019](0019-journal-derived-run-recovery.md) | Restart-safe recovery выводится из append-only journal и persisted command queue |
| [0020](0020-persisted-consumer-lab-report.md) | Consumer Lab выводится из persisted consumer evidence и exact safe artifact bytes |
| [0021](0021-evidence-receipt-and-secure-handoff.md) | Evidence receipt выводится из canonical bundle; share handoff использует только URL fragment |
| [0022](0022-local-product-qa-report.md) | Локальная аналитика экспортирует aggregate-only deterministic QA/CI report |
| [0023](0023-network-capability-boundary.md) | Известная сеть отделена от разрешённой Web2Json capability; Flare fail-closed до I/O |
| [0024](0024-wallet-identity-and-self-service-access.md) | Server-authored EIP-4361 выдаёт session-only project access без клиентского message authority |

Если решение заменено, исходный ADR остаётся в истории со статусом superseded и ссылкой на новый документ. Не переписывайте принятую историю под текущее состояние.
