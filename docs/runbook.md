# Proofline runbook

## 1. Предварительные требования

- Node.js 22 и npm для Web, API, worker и CLI.
- Docker-compatible runtime для настоящих PostgreSQL Testcontainers tests.
- PostgreSQL для API/worker runtime.
- Node.js 20 используется bundled GitHub Action runtime и не является основным локальным runtime.

Установить точные зависимости:

```bash
npm ci
```

## 2. Локальный Web

```bash
npm run dev
```

По умолчанию Web обращается к `/api`. Для отдельного backend задайте `VITE_PROOFLINE_API_BASE_URL` в локальном окружении. Не коммитьте `.env` с credentials.

Эта команда поднимает только Vite Web. В репозитории нет Docker Compose или
одной команды для полного стека: persisted journey требует отдельно запущенных
PostgreSQL, API и worker. Без API интерфейс обязан показывать честное
configuration/network state, а не demo run.

## 3. PostgreSQL и миграции

Применяйте миграции строго по номеру к пустой или поддерживаемой предыдущей схеме:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/001_initial.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/002_one_active_submission.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/003_run_discovery.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/004_preflight_report.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/005_explicit_submission_authority.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/006_wallet_identity_sessions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/007_account_token_management.sql
```

Автоматизированного production migration runner и down migrations в репозитории нет. Перед инфраструктурным rollout необходимо выбрать владельца миграций и backup/restore процедуру; до этого безопасная стратегия изменения схемы — additive migration и roll-forward.

Первичный browser project token выпускают только публичные wallet-auth routes:
сервер создаёт пятиминутный EIP-4361 challenge, а валидная локально проверенная
EOA signature получает 12-часовую session для одного default project. Raw token
возвращается один раз; база хранит только keyed digest. Не создавайте token rows
вручную. Только browser session может использовать `GET /v1/account`, выпускать
CLI/Action token через `POST /v1/account/tokens`, отзывать его через
`DELETE /v1/account/tokens/:tokenId` и завершать текущую session через
`DELETE /v1/auth/wallet/sessions/current`. Issuance требует новый
`Idempotency-Key: token_issue_<64 lowercase hex>`; raw token возвращается только
при первом committed effect и не может быть восстановлен повтором запроса.

## 4. API

Сборка и запуск:

```bash
npm run build --workspace apps/api
npm run start --workspace apps/api
```

| Переменная | Требование | Назначение |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PROOFLINE_TOKEN_DIGEST_KEY` | required | Key для digest project/share tokens |
| `PORT` | optional, default `8080` | HTTP port |
| `PROOFLINE_API_DB_POOL_SIZE` | optional, default `10` | PostgreSQL pool size |
| `PROOFLINE_WEB_ORIGIN` | required | Единственный exact public HTTPS root Origin для wallet auth, `/v1/*` browser CORS и share links; placeholder/default отсутствует |

API должен завершаться с ошибкой до начала обслуживания запросов, если обязательная конфигурация отсутствует.

## 5. Worker

Сборка и запуск:

```bash
npm run build --workspace apps/worker
npm run start --workspace apps/worker
```

Обязательная конфигурация:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Та же база, что у API |
| `PROOFLINE_VERIFIER_API_KEY` | Credential Web2Json verifier |
| `PROOFLINE_COSTON2_PRIVATE_KEY` | Отдельный low-balance relayer key; только worker |
| `PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI` | Беззнаковый глобальный fee cap |
| `PROOFLINE_RELAYER_BALANCE_FLOOR_WEI` | Минимальный остаток relayer |
| `PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA` | Положительный per-project daily quota |
| `PROOFLINE_SAFE_CONSUMER_ADDRESS` | Адрес canonical safe consumer |
| `PROOFLINE_REPLAY_BUNDLE_PATH` | Canonical local replay fixture для replay commands |
| `PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH` | Recorded public preflight report sidecar, обязательный companion для `PROOFLINE_REPLAY_BUNDLE_PATH`; отсутствие или mismatch останавливает replay до любых live I/O |

Дополнительная конфигурация:

| Переменная | Default / назначение |
|---|---|
| `PROOFLINE_VERIFIER_URL` | Официальный Coston2 verifier endpoint |
| `PROOFLINE_COSTON2_RPC_URL` | Coston2 RPC adapter default |
| `PROOFLINE_COSTON2_DA_URL` | Coston2 DA adapter default |
| `PROOFLINE_RECEIPT_POLL_TIMEOUT_MS` | Bounded receipt polling |
| `PROOFLINE_DA_TIMEOUT_MS` | Bounded DA polling |
| `PROOFLINE_WORKER_DB_POOL_SIZE` | default `4` |
| `PROOFLINE_WORKER_MAX_ATTEMPTS` | default `8` |
| `PROOFLINE_WORKER_LEASE_HEARTBEAT_MS` | default `10000` |

Worker пишет structured JSON в stdout/stderr и корректно завершает loop по `SIGINT`/`SIGTERM`.

## 6. CLI

```bash
npm run build --workspace packages/cli
node packages/cli/dist/index.js --help
```

Production API commands требуют `PROOFLINE_API_URL` и `PROOFLINE_PROJECT_TOKEN`. Wallet signing использует локальный `PROOFLINE_COSTON2_PRIVATE_KEY`; private key не отправляется API. Доступные команды: `run create`, `run watch`, `run verify`, `bundle export`, `replay`.

### Локальный Product QA report

Web хранит не более 500 валидированных `ProductEventV1` под versioned key
`proofline:product-analytics:v1`. Публичный aggregate-only export сейчас
доступен программно через `LocalProductAnalytics.exportQaReport()`; отдельной
UI-кнопки, CLI-команды и сетевого analytics endpoint нет.

QA tooling должен экспортировать только canonical `ProductQaReportV1`. Не
выгружайте содержимое localStorage напрямую: локальная очередь содержит opaque
session ID и timestamps, хотя её metadata ограничена публичным контрактом.

## 7. Ритм проверок и candidate freeze

Внутренний TDD-цикл не запускает весь репозиторий после каждой правки:

1. `RED` — новый focused contract/acceptance test и ближайший зелёный baseline.
2. `GREEN` — focused tests изменяемого package и прямых потребителей.
3. Перед коммитом волны — `npm run typecheck`, affected regression и affected
   coverage gate.
4. Перед freeze каждого вертикального среза — полная матрица ниже.

Изменение public schema, миграции, auth/trust boundary, journal/replay,
workspace/build graph, Action artifact или Sites запускает соответствующие
полные gates уже в affected regression. Полный проход нельзя откладывать до
окончания нескольких срезов.

### Полная матрица перед freeze

Минимальная герметичная проверка:

```bash
npm run typecheck
npm test
npm run test:core:coverage
npm run test:coverage:backend
npm run test:coverage:web
npm run test:solidity
npm run test:e2e
npm run build
npm run test:sites
npx vitest run tests/action-artifact-sync.contract.test.ts --reporter=verbose
```

Standalone Action artifact-sync test обязателен после изменения
`packages/action`, public contracts или импортируемого domain-кода. Checked-in
`packages/action/dist/index.js` должен быть byte-identical чистой Node 20 build.

Настоящий PostgreSQL:

```bash
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

Если Docker Desktop socket не обнаруживается автоматически, задайте корректный `DOCKER_HOST` для своей машины. Без `PROOFLINE_TESTCONTAINERS=1` integration cases намеренно пропускаются и не являются PostgreSQL PASS.

`npm run test:e2e` — это герметичный Node-сценарий, который проходит persisted API и worker через replay evidence. Он не запускает браузер, не проверяет отрисовку Web и не доказывает browser acceptance.

### Product Integration Verification: Browser acceptance

Это отдельный обязательный gate Product Integration Verifier. Перед проверкой зафиксируйте candidate identity и больше не изменяйте production tree:

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
npm run build
npm run preview
```

Откройте локальный built/preview Web в доступном browser harness и сохраните evidence для того же commit/tree:

1. Пройдите обязательный journey в desktop viewport `1488×1058` и mobile viewport `390×844`.
2. Проверьте keyboard navigation, видимый focus и закрытие вторичных поверхностей по `Escape`.
3. Запустите axe; результат обязан содержать `0` serious и `0` critical violations.
4. Проверьте application console и network: без ошибок приложения, неожиданных failed requests и browser fetch произвольного source URL.
5. Проверьте reload, back и forward, восстановление URL state, persisted draft/run/evidence и export с повторным parse.
6. Запишите commit hash, tree hash, оба viewport, browser/harness, результаты axe, console/network и итоговый PASS либо findings.

В репозитории пока нет команды, которая автоматизирует этот browser gate или выдаёт за него PASS. `npm run test:e2e` PASS не заменяет browser PASS; Product Integration Verification нельзя отметить PASS только на основании `test:e2e`.

## 8. Sites package

```bash
npm run build
npm run test:sites
```

Обе команды обязательны перед handoff. Результат должен содержать:

- `dist/client/index.html`;
- `dist/server/index.js`;
- `dist/.openai/hosting.json`.

Текущая Vite build проходит, но предупреждает о JavaScript chunk больше 500 kB.
Это известный non-blocking performance warning, а не подтверждение оптимального
bundle size.

Не изменяйте без отдельного slice contract `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` и `tests/sites-worker.test.mjs`. Sites обслуживает Web и deep links; `/api` и любые write requests обязаны fail closed без SPA fallback.

## 9. GitHub Action и live gate

PR использует local canonical bundle (`PROOFLINE_REPLAY_BUNDLE_PATH`) и не должен обращаться к сети. `packages/action/action.yml` содержит default
`fixtures/proofline.bundle.json`, но такой fixture не входит в репозиторий:
вызывающий workflow обязан передать существующий `bundle` path или сначала
создать и проверить canonical bundle. Merge queue требует:

| Переменная | Назначение |
|---|---|
| `PROOFLINE_API_URL` | Размещённый persisted API |
| `PROOFLINE_PROJECT_TOKEN` | Project-scoped capability token |
| `PROOFLINE_LIVE_MANIFEST` | Manifest file path для `npm run test:live:coston2` |
| `GITHUB_SHA` | Exact 40-hex commit hash |
| `PROOFLINE_TREE_HASH` | Exact 40-hex candidate tree hash |
| Action input `manifest` | Manifest file path |

Live flow имеет один общий timeout 10 минут. PASS требует persisted run identity, tx hash, voting round, proof checksum, успешную consumer verification, byte-identical replay и отсутствие rebroadcast после записанного tx hash.

В репозитории нет `.github/workflows`; `packages/action/action.yml` — готовый
Action package, а не доказательство настроенного CI. До выбора инфраструктуры
live gate ожидаемо блокирован отсутствием размещённых API/worker/PostgreSQL,
provisioning и secrets. Не переводите merge queue на direct-worker или
simulation fallback.

## 10. Наблюдаемость и диагностика

Сегодня worker пишет structured JSON в stdout/stderr. Production metrics,
distributed traces, alerting и централизованное log storage не настроены; их
нельзя указывать как доступные сигналы до выбора инфраструктуры. API не должен
логировать authorization headers или request bodies с capabilities.

Проверяйте состояние в таком порядке:

1. API доступен и подключён к той же базе, что worker.
2. В `run_events` sequence строго возрастает и нет событий после terminal state.
3. В `run_commands` нет потерянной lease; attempt записан до external I/O.
4. Для submission с tx hash в `relayer_transactions` есть immutable audit evidence.
5. Ошибка классифицирована как configuration, transport, timeout, not-finalized, consensus-miss, schema-invalid, proof-invalid или consumer-invariant.
6. Публикуемые logs и Action summaries не содержат tokens, API keys или private keys.

Upstream Coston2 outage блокирует release. Override возможен только через отдельное решение Slice Architect с health evidence и полностью зелёным hermetic suite.

Минимальная incident-процедура до появления provider-specific tooling:

1. Остановить новые live submissions, сохранив read-only доступ к evidence.
2. Зафиксировать commit/tree, run ID, last sequence, command attempt/lease и
   наличие transaction hash без публикации capabilities.
3. Определить границу сбоя: API/DB, worker, RPC, verifier, Relay или DA.
4. Если transaction hash уже записан, разрешены только observation/resume —
   rebroadcast запрещён.
5. После mitigation повторить hermetic gates; live gate повторять только когда
   journal показывает, что новый effect безопасен.

## 11. Rollback и восстановление

- Web/API/worker artifact rollback зависит от ещё не выбранного hosting provider и пока не автоматизирован.
- Не откатывайте journal или migration destructive SQL вручную.
- При ошибке приложения верните предыдущий совместимый artifact; при ошибке схемы выпускайте forward migration либо восстанавливайте подтверждённый backup по процедуре выбранной платформы.
- После любого production edit или изменения candidate tree повторите обе независимые verification waves на новом tree hash.
