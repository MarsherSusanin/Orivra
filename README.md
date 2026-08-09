# Proofline

Proofline — проверочный стенд для Coston2 Web2Json-интеграций. Он показывает,
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
- Action PR-mode герметично воспроизводит переданный canonical bundle без сети;
  готовый workflow и default fixture в репозитории не поставляются.
- Privacy-safe product events сводятся локально в детерминированный
  aggregate-only QA report; внешний analytics provider не используется.
- Persisted live Coston2 gate реализован в коде, работает только через
  API/PostgreSQL/worker path и ограничен одним дедлайном в 10 минут.
- В репозитории пока нет `.github/workflows`, production deployment или
  настроенного merge queue. Поэтому deployed live Coston2 PASS ещё не получен и
  не заменяется симулятором.
- Последний независимо проверенный product candidate: commit `b91b4da`, tree
  `13384b721308a1e1a04319c0391679741fb01760`.

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

Решение пока является только reviewable architecture contract. В репозитории
ещё нет реализованной VDS composition, provisioned DNS, SSH, GHCR/Spaces
credentials, hosted staging или production deployment. Sites сохраняется
только как compatibility artifact; это больше не выбранный production host.

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
- Relayer допускает только Coston2 chain `114` и `FdcHub.requestAttestation`, проверяет calldata, fee caps, quota, balance floor и idempotency.
- FDC-адреса разрешаются через registry; runtime-код не подменяет live flow симуляцией.
- Допустимое имя сети не означает доступный adapter: Flare manifest сохраняется
  клиентом, но `POST /v1/runs` fail-closed отвечает
  `409 NETWORK_CAPABILITY_DISABLED`; persisted evidence остаётся Coston2-only.
- Run history append-only; projection и bundle вычисляются из упорядоченных событий.
- Deployment target закреплён ADR 0029: локально проверенные OCI archives и
  digest manifest публикуются в GHCR byte-preserving, без rebuild, только после
  unified matrix и двух PASS. Затем используются immutable GHCR digests,
  one-shot checksummed migration под PostgreSQL advisory lock, persistent
  database volume, `/healthz`, `/readyz`, worker heartbeat и off-host
  WAL/base-backup PITR. Эти механизмы ещё не реализованы и не являются текущим
  hosted PASS.
- Любой release candidate должен получить два независимых PASS на одном tree hash.

## Документация

- [ARCHITECTURE.md](ARCHITECTURE.md) — границы, потоки данных и trust model.
- [docs/runbook.md](docs/runbook.md) — запуск, миграции, диагностика и release gates.
- [docs/development/roles.md](docs/development/roles.md) — RED → GREEN → verification protocol.
- [docs/development/product-roadmap.md](docs/development/product-roadmap.md) — current product slices and delivery status.
- [docs/adr/README.md](docs/adr/README.md) — индекс архитектурных решений.
- [docs/examples/README.md](docs/examples/README.md) — canonical reference paths.
