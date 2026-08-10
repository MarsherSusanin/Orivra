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

Эта команда поднимает только Vite Web. Slice 027A implements the credential-free
Docker files and gates under [ADR 0035](adr/0035-credential-free-container-runtime-boundary.md),
but its bounded QA command is not a full-stack readiness command: it starts no
worker and performs no migration. Persisted journey требует отдельно запущенных
PostgreSQL, API и worker. Без API интерфейс обязан показывать честное
configuration/network state, а не demo run.

### Выбранная VDS topology, частично реализованная локально

[ADR 0029](adr/0029-digitalocean-vds-deployment.md) выбирает один
DigitalOcean Droplet/VDS. Docker Compose должен запускать Web, API, worker и
PostgreSQL на том же VDS. Caddy остаётся единственным public reverse proxy,
завершает TLS и передаёт same-origin `/api/*` в API. Sites остаётся
compatibility-only artifact, а не production host.

DigitalOcean Cloud Firewall и host firewall разрешают public inbound только на
80/443. SSH restricted административным allowlist или VPN. Не expose host port
5432; API и worker не получают public host ports. Не монтируйте Docker socket в
Web, API, worker, migration или backup containers. PostgreSQL хранит данные в
persistent named volume, отдельном для production и temporary staging.

028A — local release composition. It builds and exports OCI archives, then must
verify them. The frozen release manifest stores per-image `archiveSha256`,
`imageManifestDigest`, `platform` and `repository`/`reference` fields.
`archiveSha256` covers exact OCI archive bytes and is distinct from
`imageManifestDigest`, which identifies the OCI image manifest or index. The
frozen release manifest binds commit and tree; its canonical JSON has its own
SHA-256 checksum, `frozenReleaseManifestSha256`. 028A runs without registry or
GHCR credentials and with no registry access, external network or push.

028B is credentialed and starts only after the unified matrix and two PASS
reports. It performs byte-preserving load/copy/push of exact OCI archive bytes.
It verifies `archiveSha256` before load/copy/push publication; an
`archiveSha256` mismatch aborts. It copies and pushes with no rebuild. The GHCR remote image digest only
matches `imageManifestDigest`; never compare the remote digest with
`archiveSha256`. Digest mismatch aborts; an `imageManifestDigest` mismatch
aborts before staging pull.

Publication/deployment evidence is a separate external record, immutable and
append-only. Publication/deployment evidence contains
`frozenReleaseManifestSha256`, commit, tree, remote repositories and remote
digests, timestamp, operator and run ID. Publication evidence does not mutate frozen release manifest,
does not mutate candidate tree and does not mutate image bytes. The VDS pulls only a verified remote digest
that publication evidence binds through
`frozenReleaseManifestSha256`; its GHCR pull credential is read-only.

Release composition получает Web/API/worker по immutable image digest
(`@sha256`). One-shot migration job из exact release image проверяет
checksummed migration history, удерживает PostgreSQL advisory lock, применяет
изменения и подтверждает schema version before API/worker app startup. API и
worker не выполняют migration при собственном старте.

`/healthz` является process-only liveness. `/readyz` проверяет database,
verified schema version и worker heartbeat; stale heartbeat возвращает
`503 not-ready`, даже если containers продолжают работать. Heartbeat authority
starts only after exact secret and application-role URL resolution, pure typed
runtime parsing, one-shot replay-evidence loading, exact schema verification
and full repository/live-pipeline construction, immediately before the claim
loop. Candidates `4ac66f9` / tree `477f679` and `a6fb729` / tree `2a1dfc8` are
both rejected. The latter retained lazy safe-consumer/replay reads and an
incomplete production Compose worker environment. Этот раздел не является
actual-worker, hosted или deployed PASS.

### Slice 027A local container gate

ADR 0035 splits the credential-free container boundary into image/secret,
topology/routing and real-Docker waves. The first candidate `20e8d998` is
rejected. Its corrective replacement `464e797` is also rejected: production
selected QA-only internal TLS instead of automatic public ACME, and setup
failures could bypass temporary-secret or port-probe cleanup. The second
corrective production-author result and two independent reviews make the
focused contracts and local Docker gates PASS on exact commit `820f61dd` / tree
`ea13cf179`:

```bash
npm run test:docker:static
npm run docker:prefetch
npm run test:docker
```

`docker:prefetch` validates only the exact checked-in Node 22.14.0, Caddy
2.10.2 and PostgreSQL 17.6 official index/Linux-amd64 manifests. Every
registry-capable child uses a fresh mode-0700 Docker CLI directory with exact
no-auth configuration and stripped ambient auth/token/key inputs, cleaned on
success or failure. This is CLI-side isolation only; it cannot prove the Docker
daemon has no global credential state. The build repeat uses BuildKit
`--network=none`, npm offline cache and `pull_policy: never`.

Production operators must use the executable policy wrapper:

```bash
npm run compose:production -- config
npm run compose:production -- --runtime config
```

It validates lowercase `repository@sha256:<64 lowercase hex>` Caddy/Web image
inputs for the base and API/worker inputs for the runtime overlay before any
Docker effect. A tag, uppercase, short or arbitrary reference fails. Direct
`docker compose` is an implementation detail, not an authorized production
entry. QA local tags are runner-owned constants and never enter this wrapper.

Base `compose.yaml` contains only Caddy/Web and renders without runtime image,
database or secret-path configuration. `deploy/compose.runtime.yaml` adds the
gated API/worker/PostgreSQL services; QA combines both with its exact override.
Production `deploy/caddy/Caddyfile` contains neither `tls internal` nor
loopback `default_sni`; automatic HTTPS/ACME is authoritative. Exact
`deploy/caddy/Caddyfile.qa` owns those loopback-only directives and only
`deploy/compose.qa.yaml` selects it through a read-only bind override.

The QA smoke uses a unique temporary Compose project and exact
`PROOFLINE_PUBLIC_ORIGIN=https://127.0.0.1`. Before Compose, a bounded bind
preflight must obtain `127.0.0.1:443`; unavailable port 443 fails without skip
or alternate origin. `public_edge` remains non-internal for Docker Desktop,
but Caddy is its only member and published service. Caddy QA-only internal TLS
and the API browser origin derive from the same variable. QA explicitly starts
only Caddy, Web, PostgreSQL and API, then checks Web/deep routes, the DB-free
anonymous template endpoint, exact allowed-origin wallet-auth OPTIONS 204 with
ACAO/Vary and hostile-origin denial without ACAO. It creates no challenge,
signature, wallet or live effect. It never starts worker or supplies live
verifier/Coston2 credentials. An HTTPS request ledger allows only the default
loopback origin and rejects Coinbase, Open-Meteo, verifier and Coston2 RPC
hosts. Temporary secret-directory cleanup begins immediately after creation,
before any write or Compose setup, and exact port-probe removal is attempted
after successful and ambiguous Docker reservation outcomes. Exact `/api` and
`/api/*` strip the prefix once and never SPA-fallback; missing asset-like paths
remain 404. Live inspection, not Compose text, proves the Caddy host binding
and absence of other published ports. The topology alone is not DNS/provider
denial evidence. Cleanup is scoped to that temporary project and its secret
directory.

Compose mounts API `DATABASE_URL_FILE` and
`PROOFLINE_TOKEN_DIGEST_KEY_FILE`; worker `DATABASE_URL_FILE`,
`PROOFLINE_VERIFIER_API_KEY_FILE` and
`PROOFLINE_COSTON2_PRIVATE_KEY_FILE`; the importer only
`DATABASE_URL_FILE`. Direct values remain an XOR-compatible non-Compose input,
but Compose never embeds them. PostgreSQL uses its native password-file input.
Secret files are opened `O_NOFOLLOW|O_NONBLOCK` and must be regular; a FIFO
must fail with the fixed error without blocking. Caddy is non-root/read-only,
has bounded `/tmp`, and only named `/data` and `/config` are writable.
Do not commit `.env`, `.env.*`, dummy relayer/verifier credentials or a
production test adapter.

After this generic secret reader, each application validates its exact private
database authority before Pool creation: API `proofline_api_login`, worker
`proofline_worker_login`, recording importer
`proofline_recording_importer_login`, and migration runner
`proofline_migrator_login`, all at `postgres:5432/proofline` with non-empty
password and no query/fragment. Swapping roles or using the administrator URL
fails with the same fixed redacted deployment-configuration error.

The historical `runtime-after-027b` profile is removed. The runtime overlay now
owns exact API-image `db-role-bootstrap` and `migrator` one-shot jobs, immutable
checksum history, `/healthz`, `/readyz` and the persisted deployment-worker
heartbeat. Production runtime `up` must go through the immutable-reference
wrapper, which forces one-shot recreation and rejects `start`/`restart`:

```bash
npm run compose:production -- --runtime up --detach
```

The runtime wrapper additionally requires the worker's nonsecret fee cap,
balance floor, daily quota and non-zero safe-consumer address. Public recorded
replay inputs come from required host paths
`PROOFLINE_WORKER_REPLAY_BUNDLE_FILE` and
`PROOFLINE_WORKER_REPLAY_PREFLIGHT_REPORT_FILE`, mounted read-only with host-path
creation disabled at `/run/proofline/replay/bundle.json` and
`/run/proofline/replay/preflight-report.json`. They are not Docker secrets. QA
may bind accepted recorded fixtures while still leaving worker stopped.

`pg_isready` remains engine liveness only. Promotion still requires `/readyz`;
the command-lease heartbeat and the test-only SQL fixture are not actual
deployment-worker readiness.

Database recovery contract использует continuous WAL archive и base backup для
PITR в private S3-compatible DigitalOcean Spaces. До получения
credentials локальный Docker gate выполняет MinIO restore drill в новый
изолированный PostgreSQL volume. A Droplet backup does not replace the database
backup or PITR plan. Он остаётся только дополнительным host-recovery snapshot.

Официальные operational references:

- [DigitalOcean Cloud Firewalls](https://docs.digitalocean.com/products/networking/firewalls/getting-started/quickstart/);
- [DigitalOcean Droplet backup behavior](https://docs.digitalocean.com/products/backups/details/features/);
- [DigitalOcean Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/);
- [Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/);
- [PostgreSQL continuous archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html).

## 3. PostgreSQL и миграции

Production migration authority is the strict checked-in manifest and the
one-shot API-image jobs. Do not apply individual files with ad-hoc `psql`.
The manifest executes this immutable history in order:

1. `apps/api/db/migrations/001_initial.sql`
2. `apps/api/db/migrations/002_one_active_submission.sql`
3. `apps/api/db/migrations/003_run_discovery.sql`
4. `apps/api/db/migrations/004_preflight_report.sql`
5. `apps/api/db/migrations/005_explicit_submission_authority.sql`
6. `apps/api/db/migrations/006_wallet_identity_sessions.sql`
7. `apps/api/db/migrations/007_account_token_management.sql`
8. `apps/api/db/migrations/008_persisted_admission_quotas.sql`
9. `apps/api/db/migrations/009_canonical_url_attack_recordings.sql`
10. `apps/api/db/migrations/010_deployment_lifecycle.sql`

Before API/worker startup, Compose performs exact ordering:

`postgres healthy → db-role-bootstrap completed → migrator completed → API/worker`.

For credential-free local acceptance run:

```bash
npm run test:docker:static
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
npm run test:docker
npm run test:docker:runtime
```

The runtime gate uses fresh random file secrets and an explicit test-only SQL
heartbeat fixture; it never starts worker. It proves missing → ready → stale,
database stop/restart, persistent volume identity and idempotent one-shot jobs.
Production remains additive/roll-forward only; no down-migration command exists.
Hosting is not provisioned and independent verification is pending.

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
| `PROOFLINE_WALLET_CHALLENGE_ADDRESS_MINUTE_LIMIT` | optional, default `5`, range `1..60` | Persisted wallet challenges per normalized address per UTC minute |
| `PROOFLINE_WALLET_CHALLENGE_GLOBAL_MINUTE_LIMIT` | optional, default `300`, range `1..10000` | Persisted global wallet challenges per UTC minute; must be at least the address limit |
| `PROOFLINE_PROJECT_RUN_DAILY_LIMIT` | optional, default `100`, range `1..10000` | New persisted runs per project per UTC day; idempotent replay does not consume again |
| `PROOFLINE_PROJECT_ACTIVE_LIVE_RUN_LIMIT` | optional, default `3`, range `1..100` | Nonterminal wallet/relayer runs per project; replay is excluded |
| `PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256` | optional, no default | Exact `sha256:<64 lowercase hex>` immutable 024B recording selector; absence deliberately keeps the public demo unavailable without querying for a latest row |

API должен завершаться с ошибкой до начала обслуживания запросов, если обязательная конфигурация отсутствует или quota limit не является canonical bounded integer. PostgreSQL clock выбирает quota windows; первый row фиксирует limit до конца своего окна. Active-live cap также фиксируется persisted `active_live` project policy row на UTC сутки с `used_count = 0`, поэтому rolling API processes читают один limit; новое UTC-окно может принять новый bounded config. Quota responses используют только нормализованные `429 WALLET_CHALLENGE_RATE_LIMITED`, `429 PROJECT_RUN_QUOTA_EXHAUSTED` или `409 ACTIVE_LIVE_RUN_LIMIT_REACHED`; только 429 содержит bounded integer `Retry-After`.

Node bridge не использует `Host` как URL/proxy authority: внутренний Fetch URL
строится от fixed loopback base и configured listen port. Только два exact
public wallet-auth POST pathnames, также с query, получают pre-buffer transport
boundary. До body read bridge требует exact `PROOFLINE_WEB_ORIGIN`, отсутствие
`Content-Encoding`, допустимое Content-Length/Transfer-Encoding framing и
отклоняет declared length больше 8192. Streaming read принимает максимум 8192
decoded bytes и имеет один absolute deadline 10000 ms; production deadline не
настраивается environment variable и более короткое значение разрешено только
test harness. Rejection/timeout/abort закрывают connection и не вызывают Fetch
API/service. Guarded `checkContinue` выдаёт `100 Continue` только после
header admission. Остальные routes сохраняют текущую bridge semantics; 023D2
не является общим upload-limit slice.

Focused credential-free 023D2 gate после GREEN:

```bash
npx vitest run \
  apps/api/test/slice023d2-node-auth-stream-boundary.contract.test.ts
```

Команда использует только temporary loopback listener и raw local sockets. Она
не обращается к external network и не является Docker, hosted или deployed
evidence.

Migration 008 выдаёт `proofline_api` только `SELECT`, `INSERT`, `DELETE` и
column-level `UPDATE (used_count)` для quota windows плюс bounded stale
challenge cleanup. `proofline_worker` не получает quota/challenge authority.
API удаляет максимум 100 quota windows и 100 wallet challenges за attempt и
только если их expiry/window end старше PostgreSQL clock минимум на 24 часа;
cleanup failure не отменяет уже принятое admission.

### Canonical URL attack demo (024B GREEN)

Migration 009 and the separate one-shot importer are implemented. Import is not
an API startup side effect and is never an HTTP route:

```bash
npm --workspace @proofline/api run import:canonical-url-attack -- \
  --recording <canonical-recording-path>
```

Run it with `DATABASE_URL` authorized as the dedicated
`proofline_recording_importer` role. The command has no default path and no
project token, wallet/relayer key, RPC or external network behavior. It reads
one explicit file up to 6 MiB, runs the concrete checked-in-source compile and
three-call local EVM verifier before its PostgreSQL transaction, then inserts
the exact same Buffer under the fixed import advisory lock. Re-import succeeds
only for byte- and metadata-identical evidence.

After API startup selects one exact configured digest, these routes are public
and bearer-independent:

```text
GET /v1/demo/canonical-url
GET /v1/demo/canonical-url/recording
```

The first returns a bounded strict summary. The second returns exact stored
recording bytes only on a user request. Both use public zero-age revalidation
and representation-correct ETags. Query selection is forbidden. Missing or
corrupt selection returns the same no-store
`503 CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE`; no fixture or latest-row
fallback is permitted. These are executable local surfaces; an absent selector
or missing/corrupt selected row deliberately preserves the same honest 503.

## 5. Worker

Сборка и запуск:

```bash
npm run build --workspace apps/worker
npm run start --workspace apps/worker
```

Обязательная конфигурация:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Exact `proofline_worker_login` URL for `postgres:5432/proofline`; no query/fragment |
| `PROOFLINE_VERIFIER_API_KEY` | Credential Web2Json verifier |
| `PROOFLINE_COSTON2_PRIVATE_KEY` | Отдельный low-balance relayer key; только worker |
| `PROOFLINE_RELAYER_GLOBAL_FEE_CAP_WEI` | Беззнаковый глобальный fee cap |
| `PROOFLINE_RELAYER_BALANCE_FLOOR_WEI` | Минимальный остаток relayer |
| `PROOFLINE_RELAYER_DAILY_PROJECT_QUOTA` | Положительный per-project daily quota |
| `PROOFLINE_SAFE_CONSUMER_ADDRESS` | Адрес canonical safe consumer |
| `PROOFLINE_REPLAY_BUNDLE_PATH` | Absolute regular canonical terminal-PASS ProofBundle, at most 2,200,000 bytes; Compose fixes the container path |
| `PROOFLINE_REPLAY_PREFLIGHT_REPORT_PATH` | Absolute regular canonical bound PreflightReportV1, at most 65,536 bytes; Compose fixes the container path |

Дополнительная конфигурация:

| Переменная | Default / назначение |
|---|---|
| `PROOFLINE_VERIFIER_URL` | Strict HTTPS root, default official Coston2 verifier |
| `PROOFLINE_COSTON2_RPC_URL` | Strict HTTPS/443, path allowed, default official Coston2 RPC |
| `PROOFLINE_COSTON2_DA_URL` | Strict HTTPS root, default official Coston2 DA |
| `PROOFLINE_RECEIPT_POLL_TIMEOUT_MS` | default `25000`, maximum `30000` |
| `PROOFLINE_DA_TIMEOUT_MS` | default `15000`, maximum `30000` |
| `PROOFLINE_WORKER_DB_POOL_SIZE` | default `4`, range `1..32` |
| `PROOFLINE_WORKER_MAX_ATTEMPTS` | default `8`, range `1..100` |
| `PROOFLINE_WORKER_LEASE_HEARTBEAT_MS` | default `10000`, range `1000..29000` |

Worker eagerly parses all of the above, derives and retains only the relayer
account rather than the raw key in its typed config, then opens and validates
both replay files once before creating its Pool. Any parse, open, UTF-8,
canonicality, checksum, terminal-status or report-binding failure is only
`WORKER_RUNTIME_CONFIGURATION_INVALID` / `Worker runtime configuration is
invalid`, with no value/path/cause. Worker пишет structured JSON в stdout/stderr
и корректно завершает loop по `SIGINT`/`SIGTERM`.

## 6. CLI

```bash
npm run build --workspace packages/cli
node packages/cli/dist/index.js --help
```

Production API commands требуют `PROOFLINE_API_URL` и `PROOFLINE_PROJECT_TOKEN`. Wallet signing использует локальный `PROOFLINE_COSTON2_PRIVATE_KEY`; private key не отправляется API. Доступные команды: `run create`, `run watch`, `run verify`, `bundle export`, `replay`, `demo record`.

Canonical URL attack recording не имеет default fixture или replay fallback:

```bash
proofline demo record --attack-run <persisted-live-run-id> \
  --control-run <persisted-live-run-id> --commit <40-hex-commit> \
  --tree <40-hex-tree> --out <recording-path>
```

Все пять опций обязательны ровно один раз, run ID должны различаться, а run/release/output значения проходят bounded грамматику до любого I/O. Packaged CLI всегда подключает concrete `packages/fdc-coston2` runtime: команда читает ровно два persisted bundle не более 2 200 000 UTF-8 bytes и 64 Merkle nodes каждый, перекомпилирует exact checked-in Solidity через pinned canonical standard JSON, выполняет три вызова в fresh Cancun `@ethereumjs/vm`, затем независимо повторяет runtime verification до atomic rename. Raw calldata/results не дублируются в recording: runtime выводит и сверяет их transcript hashes. Ошибка source read всегда возвращает code `CANONICAL_SOURCE_READ_FAILED` и сообщение `Canonical URL attack source read failed` без OS code, path, filename и stack. Любая read/compile/EVM/verify ошибка оставляет destination неизменённым; fixture/replay fallback и wallet/relayer effect отсутствуют.

### Static template catalog (Slice 025)

Public discovery is limited to exact no-query reads:

```text
GET /v1/templates
GET /v1/templates/open-meteo-current-weather
GET /v1/templates/eth-usd
```

The catalog is compiled into the pure domain package. Do not provision a table,
Redis cache, source proxy or dynamic registry for it. A detail is usable only
after strict manifest parse, exact canonical JSON equality and recomputed
manifest SHA-256 agree with summary and built-in provenance. HTTP ETags cover
the canonical response bytes and are distinct from the embedded manifest hash.

Web uses only same-origin `/api/v1/templates*`. During gallery, detail,
selection, replacement and reload/back-forward verification, reject any
browser request, preconnect, prefetch, image, active source link or service
worker request to `api.open-meteo.com` or `api.coinbase.com`. Template selection
does not fetch a source response; that remains an authenticated persisted
preflight effect. A saved valid Composer draft must survive until the user
confirms replacement, and cancellation must preserve its exact local bytes.

Focused GREEN verification starts with typecheck and the Slice 025 contract
matrix recorded in `docs/evidence/slice-025-red-template-led-composer.md`, then
the contracts/domain, API/client and Web coverage thresholds from AGENTS.md.
The production-author result and its bounded Browser limitation are recorded in
`docs/evidence/slice-025-green-template-led-composer.md`.
Before Sites handoff run `npm run build` and `npm run test:sites`; the generic
SPA fallback must serve `/templates` and detail routes while `/api` stays fail
closed. These are local credential-free gates, not Open-Meteo/Coinbase, live
Coston2, Docker, hosted or deployed evidence.

### Public landing (Slice 026)

Exact `/` is the only landing path. It normalizes away root query/fragment and
performs only two independent same-origin anonymous reads:

```text
GET /api/v1/templates
GET /api/v1/demo/canonical-url
```

Do not configure a wallet token, template source, recording download or
provider/RPC/compiler endpoint for landing. Missing or invalid data is expected
to render the corresponding neutral unavailable region. With
`PROOFLINE_WEB_ORIGIN` configured, verify `Vary: Origin` on catalog and detail
200/304 responses for absent, exact and hostile Origin; ACAO remains exact-only.

The frozen RED commands and first-run counts are recorded in
`docs/evidence/slice-026-red-public-product-surface.md`. Production-author GREEN
commands, coverage, artifacts and browser acceptance are recorded in
`docs/evidence/slice-026-green-public-product-surface.md`. Two independent
verifiers must still inspect one exact candidate tree. This is credential-free
local evidence; Caddy and deployment remain later slices.

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
4. После refactor — те же focused/affected gates и targeted verification.

Изменение public schema, миграции, auth/trust boundary, journal/replay,
workspace/build graph, Action artifact или Sites запускает соответствующие
affected gates сразу, но не несвязанный repository matrix. Для MLP 022–029A
полная матрица запускается once after все credential-free modules завершены.

029A is the credential-free local MLP validation and freeze. Product gates and
user testing use recorded fixtures through local Docker Compose. 029A runs with
no credentials and no external network. The whole 022–029A range remains
credential-free.

029B is the credentialed production promotion and canary. 029B starts only
after 028B has published and staged the exact frozen candidate.

### Единая полная матрица перед MLP candidate freeze

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

После добавления 027A–029A эта unified full matrix должна включать Docker image,
Compose routing, migration concurrency, restart/persistence и MinIO
backup/restore gates. До появления соответствующих checked-in commands нельзя
заявлять их PASS.

После единого full PASS фиксируются commit и tree hash. Два independent
verifier одновременно, read-only, проверяют один и тот же tree. Credentials для
DNS, SSH и Spaces выдаются strictly only after 022–029A, unified full matrix и
два независимых PASS; 028B не может начинаться раньше. Любая production-правка
после freeze требует affected RED/fix, повторной unified matrix и нового exact
tree hash.

Release authorization requires two independent PASS reports for that exact
tree hash.

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

Это compatibility gate, а не выбранный production host. VDS Docker/Caddy
routing станет отдельным production-hosting gate в 027A; существующий Sites
contract сохраняется до отдельного deprecation slice.

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
Action package, а не доказательство настроенного CI. DigitalOcean VDS target
выбран ADR 0029, но hosting is not yet provisioned. Live gate ожидаемо
блокирован отсутствием размещённых API/worker/PostgreSQL, DNS, restricted SSH,
Spaces/backup evidence и secrets. Не переводите merge queue на direct-worker
или simulation fallback.

## 10. Наблюдаемость и диагностика

Сегодня worker пишет structured JSON в stdout/stderr. Production metrics,
distributed traces, alerting и централизованное log storage не настроены; их
нельзя указывать как доступные сигналы до выбора инфраструктуры. API не должен
логировать authorization headers или request bodies с capabilities.

027B разделяет `/healthz`, `/readyz` и persisted worker heartbeat.
Container-running state сам по себе не доказывает readiness. До GREEN этих
сигналов их нельзя описывать как действующий monitoring.
Worker получает heartbeat authority только после единственного strict runtime
parser, одноразовой canonical replay load и schema gate. Production live ports
не принимают Environment: DB URL/password, verifier API key, replay paths и
deployment identity не могут находиться в repository/worker/live slices даже
если TypeScript структурно допускает более широкий объект.

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

- Target provider выбран в ADR 0029, но VDS promotion/rollback automation ещё
  не реализована и hosting is not currently deployed.
- Staging и production выбирают verified remote digest из отдельного
  publication evidence, связанного с frozen release manifest checksum;
  server-side
  rebuild запрещён.
- Application rollback selects only a prior schema-compatible verified remote digest
  from its prior immutable publication/deployment evidence. That prior
  publication/deployment evidence binds the digest to the corresponding
  `frozenReleaseManifestSha256`. The frozen release manifest supplies schema compatibility metadata
  and is never pull authority. An unpublished digest is forbidden for rollback;
  an unverified digest is forbidden. Evidence mismatch blocks rollback, and
  missing publication/deployment evidence blocks rollback.
- Database schema rollback remains forward repair or new-volume restore. Не
  откатывайте journal или migration destructive SQL вручную. При ошибке схемы
  восстанавливайте подтверждённый WAL/base-backup PITR в новый PostgreSQL
  volume, проверяйте его и только затем выполняйте явное переключение.
- 027C должен доказать MinIO restore drill локально. Droplet backup не считается
  database restore evidence.
- 028B получает credentials только после credential-free 022–029A, unified
  full matrix и двух independent PASS на одном tree hash. 029B затем выполняет
  production promotion и canary без rebuild candidate images, only after 028B.
- После любого production edit или изменения candidate tree повторите affected
  RED/GREEN, unified matrix и обе независимые verification waves на новом tree
  hash.
