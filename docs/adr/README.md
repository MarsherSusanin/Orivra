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
| [0025](0025-lazy-browser-wallet-provider-boundary.md) | Ленивый EIP-6963/EIP-1193 adapter проверяет enabled Coston2 EOA до подписи |
| [0026](0026-wallet-session-context-and-lazy-sign-in-dialog.md) | Один wallet-session context лениво подключает доступный Coston2 sign-in dialog |
| [0027](0027-app-wallet-authority-and-pending-composer-intent.md) | App сводит wallet/share/embed authority в один root и возобновляет ровно один Composer intent |
| [0028](0028-settings-one-time-token-issue.md) | Settings выдаёт CLI/Action token только из browser session и удерживает raw secret в one-time reveal |
| [0029](0029-digitalocean-vds-deployment.md) | DigitalOcean VDS запускает same-origin Docker Compose stack за Caddy с credential-gated release |
| [0030](0030-persisted-api-admission-quotas.md) | PostgreSQL-clock quota windows ограничивают wallet challenges, daily runs и active live runs без нарушения idempotent replay |
| [0031](0031-canonical-url-attack-recording.md) | Два независимых persisted live bundle и детерминированный EVM transcript доказывают URL attack без synthetic fallback |
| [0032](0032-persisted-public-canonical-url-attack-demo.md) | Runtime-verified recording импортируется в immutable PostgreSQL и публикуется через bounded anonymous API/Web demo |
| [0033](0033-static-template-catalog-boundary.md) | Статический immutable catalog связывает public template metadata с exact canonical manifest bytes без DB или source fetch |
| [0034](0034-public-landing-and-onboarding-boundary.md) | Публичный landing независимо потребляет static templates и persisted demo без wallet, fallback authority или cache-variant CORS ошибки |
| [0035](0035-credential-free-container-runtime-boundary.md) | CLI-isolated pinned images, nonblocking Docker-secret files, split private Compose topology and exact HTTPS Caddy/Web routing without fabricated readiness |
| [0036](0036-checksummed-migrations-and-deployment-readiness.md) | Immutable migration checksums, least-privilege deployment roles and persisted worker heartbeat separate process health from application readiness |
| [0037](0037-wal-archiving-and-pitr-recovery.md) | Encrypted WAL-G archive, evidence-bound base backup and paused new-volume PITR are proved locally against private MinIO |
| [0038](0038-orivra-public-brand.md) | Orivra becomes the public display name while Proofline protocol, package, persistence and deployment identifiers remain compatible |
| [0039](0039-offline-oci-release-freeze.md) | Five exact Linux/amd64 OCI archives are built once offline and frozen under distinct archive/image digests plus a non-circular receipt |
| [0040](0040-orivra-verification-entry.md) | Public Orivra URL preview hands a bounded local draft to protected canonical `/app/*` routes without fetching the source or changing ShareLinkV1 |
| [0041](0041-credential-free-mlp-candidate-freeze.md) | One clean tree binds the complete credential-free matrix, recorded-fixture Compose journey and fresh offline OCI freeze into a canonical candidate receipt |
| [0042](0042-byte-preserving-ghcr-publication-and-digitalocean-staging.md) | Explicit GHCR targets, byte-preserving image publication and isolated DigitalOcean staging consume one verified frozen candidate without rebuild or production promotion |

Если решение заменено, исходный ADR остаётся в истории со статусом superseded и ссылкой на новый документ. Не переписывайте принятую историю под текущее состояние.
