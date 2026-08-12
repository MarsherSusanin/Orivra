# Orivra

Orivra — проверочный стенд для Coston2 Web2Json-интеграций. Он показывает,
может ли smart contract доверять не только полученному proof, но и источнику
данных, генерирует безопасный consumer и собирает воспроизводимый пакет
доказательств для разработчика, аудитора и CI.

## Проблема простыми словами

Валидный FDC proof подтверждает ответ на конкретный запрос. Но плохо написанный
consumer может не проверить, что запрос был отправлен именно на разрешённый
scheme, host, path и query. Это как целая пломба на посылке: она подтверждает,
что содержимое не меняли, но сама по себе не подтверждает нужного отправителя.

Proofline проводит один manifest по пути `preflight → submission → proof →
consumer verification → evidence handoff`. Если consumer принимает proof для
неправильного URL, Consumer Lab показывает отсутствующий invariant, а затем
выдаёт детерминированный safe Solidity consumer.

Решение доказывается парным сценарием:

```text
неправильный URL → proof валиден → vulnerable consumer принимает его
                 → Proofline находит дыру → safe consumer отклоняет его

правильный URL   → proof валиден → safe consumer принимает его
                 → bundle повторно воспроизводится с тем же checksum
```

Run Cockpit оставляет пользователю одну последовательность стадий, следующий
безопасный шаг и точные evidence artifacts вместо набора несвязанных
blockchain-операций.

## Текущий статус

- Завершён pre-infrastructure product journey 014–021: Runs, Composer,
  Preflight Workbench, submission, recovery, Consumer Lab, Integration Package
  и локальный QA report.
- Публичный `GET /v1/networks` различает известную сеть и доступную
  возможность: Coston2 Web2Json включён, Flare Mainnet распознаётся как
  `upstream-unsupported` и отклоняется до создания run или network I/O.
- Slice 025 фиксирует credential-free static template catalog: featured
  Open-Meteo Berlin current temperature и совместимый `eth-usd` выбираются
  через anonymous same-origin API, а manifest повторно canonicalize/hash
  проверяется до Composer без browser/API source-host fetch.
- Slice 026 реализует `/` как token-free public landing: он
  независимо читает только static catalog summary и bounded persisted demo
  summary, не монтирует wallet/session, не подменяет недоступные
  данные fixture и не добавляет analytics event. Unknown routes fail
  honestly, а cacheable template variants с configured Web origin всегда
  варьируются по `Origin`. Production-author candidate ожидает два
  независимых PASS-отчёта.
- API реализует self-service EOA wallet auth: одноразовый пятиминутный
  EIP-4361 challenge создаёт стабильный default project и возвращает случайный
  12-часовой browser project token, сохраняя в PostgreSQL только keyed digest.
  Browser-сессия может просматривать account, однократно выпускать и отзывать
  1–90-дневные CLI/Action tokens и завершать текущую сессию. Runs, deep routes
  и Composer уже используют общий wallet sign-in; следующий Web-срез 023C3A
  подключает `/settings` account view и безопасный one-time token reveal.
- Реализованы, но не размещены Web, PostgreSQL API, restart-safe worker, CLI,
  GitHub Action package и Sites compatibility package. Production target
  выбран в [ADR 0029](docs/adr/0029-digitalocean-vds-deployment.md): один
  DigitalOcean Droplet/VDS с Docker Compose, Caddy, Web, API, worker и
  PostgreSQL. Он ещё не provisioned и не deployed.
- Slice 027A is complete and independently verified under
  [ADR 0035](docs/adr/0035-credential-free-container-runtime-boundary.md).
  The first production-author candidate `20e8d998` was rejected by independent
  Core and Product verification. The replacement satisfies the frozen
  CLI-isolated prefetch, immutable-image validation, split base/runtime
  Compose, exact `https://127.0.0.1` QA, bounded FIFO and read-only Caddy gates;
  two independent reviews PASS exact commit `820f61dd` / tree `ea13cf179`.
  Slice 027B is independently verified under
  [ADR 0036](docs/adr/0036-checksummed-migrations-and-deployment-readiness.md)
  for checksummed migrations, deployment roles, health/readiness and the real
  production-worker heartbeat path. Core and Product both PASS exact commit
  `527c561` / tree `ebdf648`; the SQL heartbeat fixture remains test-only, so no
  actual worker readiness, hosting or deployment is claimed. Slice 027C exact
  candidate `1218e589` / tree `f0d6e325` was rejected by both independent
  verifiers: it emitted no canonical positive restore evidence, used synthetic
  evidence for promotion negatives and reused one random identity as commit and
  tree. Later stash candidate `ccccf5d2` is rejected by security scan
  `ae807f50`: source identity remained mutable, selected backup metadata was
  synthetic, PASS publication was premature and draft evidence could reach
  promotion. Corrective tests/docs-only RED freezes private source snapshots,
  exact WAL-G detail metadata, a terminal canonical three-file handoff and V2
  authorization bound to handoff plus restore. The replacement is now local
  credential-free production-author GREEN: focused recovery contracts, the
  unified matrix, real PostgreSQL, two offline builds and Docker 027A/027B/027C
  gates passed, with exact scoped cleanup. This is not a security PASS. Codex
  Security scan 8852 was canceled by the user before final
  reportability/severity. Its deferred validation risk remains open: a safe
  no-effect fixture published terminal handoff backup bytes whose
  `inventory.canonicalSha256` did not match their entries; the strict parser
  rejected them, while the promotion parser reached its injected effect with
  the self-consistent triad. Core and Product independently PASS exact commit
  `8137970091197160c3d002084a2b778a4d262034` / tree
  `8c594cc58820670aba66e7b3cbd6f1f818420a19`; this does not close or classify
  the deferred scan risk.
- [ADR 0038](docs/adr/0038-orivra-public-brand.md) selects **Orivra** as the
  public display name before 028A. Slice 027D is complete: Core and Product
  independently PASS exact `3d57840` / `fc7643f` after Web metadata/copy, the
  local SVG mark, fail-closed SIWE cutover, CLI/Action generated artifacts,
  affected coverage, Sites and real-browser checks passed. This is local module
  evidence, not release authorization. `@proofline/*`,
  `PROOFLINE_*`, database/storage/evidence, CLI, Action, Solidity, Docker and S3
  identifiers remain compatibility-stable.
- Slice 027E is complete. Core and Product independently PASS exact commit
  `e42da1ffa689ceb4b3bd43e78f46bd6a3e98eed7` / tree
  `18116a629c770f7ea6b4cdfc8e7dd2b814915e2f`; the public URL preview, lazy SIWE
  handoff, canonical `/app/*` routes and desktop/mobile browser contract are
  accepted locally. [ADR 0041](docs/adr/0041-credential-free-mlp-candidate-freeze.md)
  now freezes 029A as the final credential-free unified matrix and same-tree
  release-receipt boundary before any production credential is requested.
- Slice 029A is complete. Core and Product independently PASS exact commit
  `fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` / tree
  `f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`; frozen candidate SHA-256 is
  `8991e7e49f4570702436c269c8f6bd0af7b8f186997bff2a52e6da22f7a0cdda`.
  Core rejected the first ADR 0042 implementation at exact `5322125` /
  `bad14e5` for unbound staging authority, false PASS observations, an unused
  SSH pin and reopened archive bytes. Core then rejected replacement
  `7c2ca21` / `34a5751`: its verified handoff downgraded to a caller-owned
  mutable object across async staging setup. Its next replacement closed that
  alias, but Core rejected `be3270c` / `0c12d82` because caller-owned target
  and run values remained mutable across provisioning. The next replacement
  closed those aliases, but Core rejected `9cb839f` / `fcd0d75` because legacy
  generic cleanup could destroy successful owned staging after PASS evidence.
  The production-author replacement now forbids cleanup/teardown on success
  and retains failure-only scoped teardown. Core and Product independently
  PASS exact commit `70f63cb0c4fac0c7661cb734896575be07edfa70` / tree
  `88ec38335ab9630e1fd8c4d5247101bd046f06eb`. A later authenticated real GHCR
  diagnostic reached blob-upload `POST` 202 but exposed GHCR's singular
  same-repository `/blobs/upload/<opaque-id>` Location, while the adapter froze
  only plural `/blobs/uploads/`. It failed closed on Caddy: zero image IDs,
  publication evidence and staging effects. The narrow production-author
  correction accepted only the exact singular and retained plural forms. A
  subsequent authorized attempt passed auth/POST/Location, then its monolithic
  PUT of the 15,923,972-byte Caddy layer failed with `UND_ERR_SOCKET`; still
  zero image IDs, publication evidence or staging. Its fixed 4 MiB replacement
  then failed on the first PATCH with `UND_ERR_SOCKET` after 4,194,726 bytes
  written and zero read. The fixed 1 MiB replacement then passed its first
  PATCH, but rejected GHCR's unchanged current upload Location as stale. Zero
  images/evidence/staging remain. After that correction, a real 1 MiB PATCH
  still failed with `UND_ERR_SOCKET` after 1,049,677 bytes written and 865 read.
  The production-author replacement on RED base `a47e646` / `7bac35d` fixes
  chunks at 256 KiB while retaining same-current/stale and no-replay rules. A
  real run still failed after roughly two chunks (`bytesWritten=525812`,
  `bytesRead=1346`). The production-author replacement on RED base `696f317` /
  `33edbe3` requires `Connection: close` on upload POST, every PATCH and empty
  final PUT. Core and Product independently PASS exact accepted commit
  `e2744415508650d14bd974b885842232d756e092` / tree
  `907fa93f4b604cd8f48d8ee9734a63e0e68d2440`. The authorized publication then
  placed all five exact frozen manifests in GHCR and independently re-read
  their expected digests. Immutable publication evidence SHA-256 is
  `1fe40038c67adfab8e21e108371bc47e61450296760e87cf5242d7b94113ea10`.
  Isolated DigitalOcean staging was not accepted. ADR 0044 therefore freezes a
  V2 direct-production pilot without fabricating staging evidence. It binds
  the exact publication to DigitalOcean compute, Timeweb S3 shared-pilot
  authority (`https://s3.twcstorage.ru`, `ru-1`, `orivra-backet`, path-style),
  strict typed preflights and deterministic Open-Meteo/ETH consumer registry.
  Explicit Caddy cutover and its canonical checkpoint precede deployment evidence; trusted-clock
  cutover/15m/1h/24h checkpoints are resumable and cannot terminal-PASS early.
  Historical V1 contracts and canonical rollback binding remain parseable but
  cannot authorize V2 effects. Exact candidate `97aae69` / tree `5d8965e` was
  rejected by both Core and Product verification. The corrective replacement
  is local production-author GREEN: nested activation retains rollback
  authority, cutover consumes pre-deployment live evidence, UID 1000 writes
  only run-scoped staging that root seals, and terminal promotion resumes
  idempotently. Browser PASS must come from a canonical
  acceptance artifact, and active backup evidence fixes Timeweb bucket
  `orivra-backet` while historical Spaces parsing stays separate. Exact commit
  and two fresh verifier reports remain pending; no hosted or production PASS
  exists.
- Action PR-mode герметично воспроизводит переданный canonical bundle без сети;
  готовый workflow и default fixture в репозитории не поставляются.
- Canonical URL attack recording contract and trusted local compiler/EVM
  recorder are complete. Slice 024B implements immutable PostgreSQL import,
  exact-digest anonymous API and `/demo/canonical-url`. No recording is bundled
  or selected by default, so the honest public state remains unavailable until
  an exact runtime-verified recording is imported and configured.
- Privacy-safe product events сводятся локально в детерминированный
  aggregate-only QA report; внешний analytics provider не используется.
- Persisted live Coston2 gate реализован в коде, работает только через
  API/PostgreSQL/worker path и ограничен одним дедлайном в 10 минут.
- В репозитории пока нет `.github/workflows`, production deployment или
  настроенного merge queue. Поэтому deployed live Coston2 PASS ещё не получен и
  не заменяется симулятором.
- Последний независимо проверенный product candidate: commit
  `70f63cb0c4fac0c7661cb734896575be07edfa70`, tree
  `88ec38335ab9630e1fd8c4d5247101bd046f06eb`.

## Быстрый старт

Требования: Node.js 22 и npm.

```bash
npm ci
npm run dev
```

`npm run dev` поднимает только Web. Он использует `/api` по умолчанию; для
отдельного backend задайте `VITE_PROOFLINE_API_BASE_URL`. Полный persisted
journey требует отдельно запущенных PostgreSQL, API и worker по
[runbook](docs/runbook.md).

## Основные команды

| Команда | Назначение |
|---|---|
| `npm run dev` | Локальный Web |
| `npm run typecheck` | TypeScript-проверка всего workspace |
| `npm test` | Герметичный набор Vitest |
| `npm run test:core:coverage` | 100% statements/branches для contracts и domain |
| `npm run test:coverage:backend` | Coverage API, worker, CLI, Action и adapters |
| `npm run test:coverage:web` | Coverage React-поверхности |
| `npm run test:postgres` | PostgreSQL contracts; Testcontainers включается отдельно |
| `npm run test:solidity` | Компиляция и проверки canonical consumers |
| `npm run test:e2e` | Герметичный Node replay через API и worker; не запускает browser |
| `npm run build` | Web и Sites compatibility package |
| `npm run test:sites` | Sites compatibility routing и artifact contract |

Полная матрица проверок, конфигурация API/worker и live gate описаны в [операционном runbook](docs/runbook.md).

Browser acceptance — отдельный обязательный **Product Integration Verification**
gate на локальном built/preview Web. Он фиксируется для
конкретных commit/tree и не имеет отдельной автоматизированной repo-команды;
PASS `npm run test:e2e` не заменяет browser PASS. Автоматический CI workflow
сейчас также отсутствует: команды из runbook запускаются вручную.

## Выбранная инфраструктурная граница

Будущий MLP deployment использует один DigitalOcean Droplet/VDS. Docker Compose
запускает на нём Web, API, worker и PostgreSQL, а Caddy остаётся единственным
public ingress и даёт Web same-origin `/api`. Публичны только 80/443; SSH
ограничивается administrator allowlist или VPN. PostgreSQL 5432, API/worker
ports и Docker socket не публикуются.

Репозиторий содержит независимо проверенные replacement 027A и Slice 027B.
027B Core и Product verification PASS exact commit `527c561` / tree
`ebdf648`; это локальное credential-free evidence, не actual-worker или hosted
evidence. ADR 0037 и Slice 027C now have a local production-author GREEN
replacement after both verifiers rejected exact `1218e589` / `f0d6e325` and
scan `ae807f50` rejected stash `ccccf5d2`. The replacement uses an immutable
source snapshot, lossless WAL-G metadata, terminal
`RecoveryEvidenceHandoffV1` and `RestorePromotionAuthorizationV2`, and passed
the focused, unified, real-PostgreSQL, offline-build and Docker A/B/C author
gates. Scan 8852 was user-canceled and is explicitly not a security PASS; its
deferred inventory-digest/promotion-parser validation risk remains open. Core
and Product independently PASS exact commit `8137970` / tree `8c594cc`; scan
8852 remains canceled and is not a security PASS. Slice 027D freezes the Orivra
public display-name cutover before 028A; it does not migrate any Proofline
technical identifier. Core and Product independently PASS exact `3d57840` /
`fc7643f`. Slice 028A is complete: Core and Product independently PASS exact
commit `bdd09e78573fcd2a0310b1b90e3187b6b8f6d135` / tree
`5d0acb9112024e84adfe5b3b907170c6d2d82d0e`; report SHA-256 values are frozen
in ADR 0039. This is credential-free local freeze evidence, not registry
publication, hosted deployment, 029A authorization or a security PASS.
028A–029B по-прежнему владеют release и production
promotion.
DNS, SSH, GHCR/Spaces credentials, hosted staging и production deployment
не provisioned. Sites сохраняется только как
compatibility artifact; это больше не выбранный production host.

Credentials разрешены только после credential-free slices 022–029A, одного
unified local full matrix и двух независимых PASS для одного tree hash.
Детали delivery order, backup/PITR и promotion находятся в
[product roadmap](docs/development/product-roadmap.md) и
[runbook](docs/runbook.md).

## Поток продукта

```text
Web2JsonManifestV1
  → preflight и fee quote
  → wallet или relayer submission
  → receipt и voting round
  → Relay finalization и DA proof
  → FdcVerification.verifyWeb2Json
  → consumer diagnostics
  → safe consumer artifact
  → evidence receipt и integration package
  → canonical bundle и deterministic replay
```

Валидный FDC proof доказывает ответ на запрос, но сам по себе не доказывает, что consumer ограничил доверенный URL. Поэтому safe consumer отдельно проверяет scheme, host, path и query.

## Репозиторий

- `src/` — React Run Cockpit и Web service boundary.
- `apps/api` — HTTP API, authentication и PostgreSQL composition.
- `apps/worker` — persisted command worker и единственное место хранения relayer key.
- `packages/contracts` — versioned public schemas.
- `packages/domain` — pure journal/projection, diagnostics, replay, codegen и
  deterministic product QA reporting.
- `packages/fdc-coston2` — verifier/RPC/registry/Relay/DA adapters.
- `packages/cli` — Node 22 release client.
- `packages/action` — Node 20 GitHub Action: local replay для PR и persisted live path для merge queue.
- `contracts/` — canonical vulnerable и safe Solidity consumers.

Подробности: [архитектура](ARCHITECTURE.md), [роли и TDD-волны](docs/development/roles.md), [ADR index](docs/adr/README.md), [эталонные примеры](docs/examples/README.md).

## Инженерные инварианты

- API никогда не получает пользовательский private key.
- Project/share tokens хранятся только как keyed digest; share token даёт только read access.
- API admission хранит PostgreSQL-clock quota windows: wallet challenges
  ограничены по normalized address и глобально на UTC minute, новые runs — по
  project на UTC day, а nonterminal wallet/relayer runs — persisted active-live
  policy. Exact idempotent create replay возвращается до quota consumption.
- Relayer допускает только Coston2 chain `114` и `FdcHub.requestAttestation`, проверяет calldata, fee caps, quota, balance floor и idempotency.
- FDC-адреса разрешаются через registry; runtime-код не подменяет live flow симуляцией.
- Допустимое имя сети не означает доступный adapter: Flare manifest сохраняется
  клиентом, но `POST /v1/runs` fail-closed отвечает
  `409 NETWORK_CAPABILITY_DISABLED`; persisted evidence остаётся Coston2-only.
- Run history append-only; projection и bundle вычисляются из упорядоченных событий.
- Deployment target закреплён ADR 0029: frozen manifest раздельно хранит
  checksum архивных bytes и OCI image-manifest digest. После unified matrix и
  двух PASS exact OCI archives публикуются в GHCR без rebuild; отдельное
  immutable append-only publication evidence связывает verified remote digest
  с frozen-manifest checksum и только оно авторизует VDS pull. Затем работают
  immutable GHCR digests,
  one-shot checksummed migration под PostgreSQL advisory lock, persistent
  database volume, `/healthz`, `/readyz`, worker heartbeat и off-host
  WAL/base-backup PITR. Локальная credential-free 027B readiness
  independently verified; 027C backup/recovery is independently verified on
  exact `8137970` / `8c594cc`, while canceled scan 8852 is not a security PASS
  and its deferred inventory-digest risk remains open. GHCR publication of the
  five frozen manifests is complete and evidence-bound; isolated staging, VDS
  application deployment and production Spaces credentials have not yet been
  completed. Это не hosted, live-production, фактический RPO/RTO или SLA PASS.
- Rollback разрешён только на prior schema-compatible verified remote digest,
  уже связанный immutable publication evidence с frozen-manifest checksum;
  release manifest сам по себе не является pull authority.
- Любой release candidate должен получить два независимых PASS на одном tree hash.

## Документация

- [ARCHITECTURE.md](ARCHITECTURE.md) — границы, потоки данных и trust model.
- [docs/runbook.md](docs/runbook.md) — запуск, миграции, диагностика и release gates.
- [docs/development/roles.md](docs/development/roles.md) — RED → GREEN → verification protocol.
- [docs/development/product-roadmap.md](docs/development/product-roadmap.md) — current product slices and delivery status.
- [docs/adr/README.md](docs/adr/README.md) — индекс архитектурных решений.
- [docs/examples/README.md](docs/examples/README.md) — canonical reference paths.
