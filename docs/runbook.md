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

## 3. PostgreSQL и миграции

Применяйте миграции строго по номеру к пустой или поддерживаемой предыдущей схеме:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/001_initial.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/migrations/002_one_active_submission.sql
```

Автоматизированного production migration runner и down migrations в репозитории нет. Перед инфраструктурным rollout необходимо выбрать владельца миграций и backup/restore процедуру; до этого безопасная стратегия изменения схемы — additive migration и roll-forward.

В репозитории также нет production-команды для первичного выпуска project token. Не создавайте token rows вручную без согласованного provisioning flow: API ожидает keyed digest, а не raw token.

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
| `PROOFLINE_WEB_ORIGIN` | optional | Public Web origin для share links |

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

## 7. Проверки перед candidate freeze

Минимальная герметичная проверка:

```bash
npm run typecheck
npm test
npm run test:core:coverage
npm run test:coverage:backend
npm run test:coverage:web
npm run test:solidity
npm run build
npm run test:sites
```

Настоящий PostgreSQL:

```bash
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

Если Docker Desktop socket не обнаруживается автоматически, задайте корректный `DOCKER_HOST` для своей машины. Без `PROOFLINE_TESTCONTAINERS=1` integration cases намеренно пропускаются и не являются PostgreSQL PASS.

Browser acceptance:

```bash
npm run test:e2e
```

Проверяются desktop `1488×1058`, mobile `390×844`, keyboard/focus/Escape, axe, console/network, reload persistence и export/reparse.

## 8. Sites package

```bash
npm run build
npm run test:sites
```

Обе команды обязательны перед handoff. Результат должен содержать:

- `dist/client/index.html`;
- `dist/server/index.js`;
- `dist/.openai/hosting.json`.

Не изменяйте без отдельного slice contract `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` и `tests/sites-worker.test.mjs`. Sites обслуживает Web и deep links; `/api` и любые write requests обязаны fail closed без SPA fallback.

## 9. GitHub Action и live gate

PR использует local canonical bundle (`PROOFLINE_REPLAY_BUNDLE_PATH`) и не должен обращаться к сети. Merge queue требует:

| Переменная | Назначение |
|---|---|
| `PROOFLINE_API_URL` | Размещённый persisted API |
| `PROOFLINE_PROJECT_TOKEN` | Project-scoped capability token |
| `GITHUB_SHA` | Exact 40-hex commit hash |
| `PROOFLINE_TREE_HASH` | Exact 40-hex candidate tree hash |
| Action input `manifest` | Manifest file path |

Live flow имеет один общий timeout 10 минут. PASS требует persisted run identity, tx hash, voting round, proof checksum, успешную consumer verification, byte-identical replay и отсутствие rebroadcast после записанного tx hash.

До выбора инфраструктуры этот gate ожидаемо блокирован отсутствием API/worker/PostgreSQL и их secrets. Не переводите merge queue на direct-worker или simulation fallback.

## 10. Диагностика

Проверяйте состояние в таком порядке:

1. API доступен и подключён к той же базе, что worker.
2. В `run_events` sequence строго возрастает и нет событий после terminal state.
3. В `run_commands` нет потерянной lease; attempt записан до external I/O.
4. Для submission с tx hash в `relayer_transactions` есть immutable audit evidence.
5. Ошибка классифицирована как configuration, transport, timeout, not-finalized, consensus-miss, schema-invalid, proof-invalid или consumer-invariant.
6. Публикуемые logs и Action summaries не содержат tokens, API keys или private keys.

Upstream Coston2 outage блокирует release. Override возможен только через отдельное решение Slice Architect с health evidence и полностью зелёным hermetic suite.

## 11. Rollback и восстановление

- Web/API/worker artifact rollback зависит от ещё не выбранного hosting provider и пока не автоматизирован.
- Не откатывайте journal или migration destructive SQL вручную.
- При ошибке приложения верните предыдущий совместимый artifact; при ошибке схемы выпускайте forward migration либо восстанавливайте подтверждённый backup по процедуре выбранной платформы.
- После любого production edit или изменения candidate tree повторите обе независимые verification waves на новом tree hash.

