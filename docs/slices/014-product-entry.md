# Slice 014 — Product entry and run discovery

## User outcome

A developer lands on `/runs`, understands the product, starts a Web2Json run, or resumes a recent run without relying on a hardcoded demo cockpit.

## Scope

- Real routes: `/runs`, `/runs/new`, and `/runs/:id`.
- Project-scoped, cursor-paginated `GET /v1/runs`.
- Empty, loading, unauthorized, not-found, active, failed, completed, and resumable states.
- Honest primary navigation and Sites-safe deep links.
- Product analytics foundation from Slice 021A is used for explicit user actions only.

Excluded: manifest fields beyond navigation into Composer, remote preflight evidence, submission, and Consumer Lab redesign.

## Frozen public contract

- `RunSummaryV1` contains version, run identity, network, source host, manifest submission mode, current stage, status, created/updated timestamps, last sequence, and resumable flag.
- `RunListPageV1` contains ordered summaries and an optional opaque next cursor.
- `GET /v1/runs?status=&cursor=&limit=` is project-token only, defaults to 20 items, caps at 50, and orders by `updated_at DESC, id DESC`.
- `status` is absent or `active`, `completed`, or `failed`; malformed cursor, status, or limit fails closed with a stable 400 error.
- Share tokens receive `SHARE_READ_ONLY` and cannot enumerate a project.

## RED acceptance

- Public schema tests reject extra fields and invalid statuses/timestamps/cursors.
- PostgreSQL contracts prove project isolation, stable pagination, filters, empty lists, and previous-schema migration.
- API contracts prove auth, query validation, share denial, and no idempotency requirement for GET.
- Production artifact tests reject `COCKPIT_RUN_ID` and demo-run fallback.
- Browser tests cover `/runs` empty/list/resume, `/runs/:id` reload, not-found, navigation, keyboard, axe, desktop, and mobile.
- Sites tests preserve deep routes and never fall back for `/api` or write requests.

## Risk class

Persistence and product-navigation change; no FDC custody or relayer behavior changes.

