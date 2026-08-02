# Proofline

Proofline — developer tool для Coston2 Web2Json: один versioned manifest проходит preflight, отправку, voting round, получение proof, on-chain verification, проверку consumer-инвариантов и экспорт воспроизводимого evidence bundle.

Продуктовая поверхность построена вокруг Run Cockpit: пользователь видит одну последовательность стадий, следующий безопасный шаг и доказательства результата, а не набор несвязанных blockchain-операций.

## Текущий статус

- Реализованы Web, PostgreSQL API, restart-safe worker, CLI, GitHub Action и Sites package.
- PR-путь герметичен и воспроизводит canonical bundle без сети.
- Live Coston2 release gate работает только через persisted API/worker path и ограничен одним общим дедлайном в 10 минут.
- Размещение API, worker и PostgreSQL ещё не выбрано. До подключения инфраструктуры live gate остаётся операционно заблокированным, но не заменяется симулятором.

## Быстрый старт

Требования: Node.js 22 и npm.

```bash
npm ci
npm run dev
```

Локальный Web использует `/api` по умолчанию. Для отдельного API задайте `VITE_PROOFLINE_API_BASE_URL` перед запуском Vite.

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
| `npm run build` | Web/Sites release package |
| `npm run test:sites` | Sites routing и artifact contract |

Полная матрица проверок, конфигурация API/worker и live gate описаны в [операционном runbook](docs/runbook.md).

Browser acceptance — отдельный обязательный **Product Integration Verification** gate на локальном built/preview Web. Он фиксируется для конкретных commit/tree и не имеет отдельной автоматизированной repo-команды; PASS `npm run test:e2e` не заменяет browser PASS.

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
  → canonical bundle и deterministic replay
```

Валидный FDC proof доказывает ответ на запрос, но сам по себе не доказывает, что consumer ограничил доверенный URL. Поэтому safe consumer отдельно проверяет scheme, host, path и query.

## Репозиторий

- `src/` — React Run Cockpit и Web service boundary.
- `apps/api` — HTTP API, authentication и PostgreSQL composition.
- `apps/worker` — persisted command worker и единственное место хранения relayer key.
- `packages/contracts` — versioned public schemas.
- `packages/domain` — pure event journal, projection, diagnostics, replay и codegen.
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
- Run history append-only; projection и bundle вычисляются из упорядоченных событий.
- Любой release candidate должен получить два независимых PASS на одном tree hash.

## Документация

- [ARCHITECTURE.md](ARCHITECTURE.md) — границы, потоки данных и trust model.
- [docs/runbook.md](docs/runbook.md) — запуск, миграции, диагностика и release gates.
- [docs/development/roles.md](docs/development/roles.md) — RED → GREEN → verification protocol.
- [docs/adr/README.md](docs/adr/README.md) — индекс архитектурных решений.
- [docs/examples/README.md](docs/examples/README.md) — canonical reference paths.
