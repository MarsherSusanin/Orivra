# Proofline agent policy

## Purpose

Proofline proves whether a Coston2 Web2Json consumer trusts the intended URL,
not merely a valid proof. It turns one `Web2JsonManifestV1` into persisted
consumer evidence, safe Solidity and a reproducible integration package.

Canonical docs: `README.md`, `ARCHITECTURE.md`, `docs/runbook.md`, `docs/development/roles.md`, and `docs/adr/README.md`.

## Development protocol

- Work in small vertical slices: architect → RED contracts/tests → GREEN core → GREEN surfaces → refactor → code verification → product integration verification.
- One writer owns the shared tree during a wave. Read-only audits may run in parallel.
- Freeze intentional RED tests before implementation. Do not weaken public contracts to reach GREEN.
- A production author cannot be either verifier; the two verifiers must be different agents.
- Both verifiers inspect one recorded tree hash. Any production change invalidates both passes.
- Add or update an ADR before changing package boundaries, persistence semantics, trust boundaries, or the release path.

Full role definitions and evidence requirements: `docs/development/roles.md`.

## Architecture boundaries

- Keep `packages/contracts` and `packages/domain` pure and deterministic.
- Keep FDC network behavior behind `packages/fdc-coston2` ports/adapters.
- API owns authentication, idempotent commands and PostgreSQL composition; it never receives user or relayer private keys.
- Worker is the only owner of the relayer key and external live effects.
- Web, CLI and Action consume public contracts and the persisted API path; do not add a direct live-worker release gate.
- Run events are append-only. Preserve ordering, terminal immutability, idempotency and byte-identical replay.
- Production adapters fail closed. Test adapters must not be importable or callable outside `NODE_ENV=test`.

## Security invariants

- Never commit, log, serialize, echo or publish tokens, verifier keys, private keys or raw secrets.
- Preserve 256-bit opaque tokens, keyed digests, read-only run-scoped share access, and project-token mutation authorization.
- Preserve SSRF controls: HTTPS GET only, port 443, no redirects, pinned validated DNS, private/link-local/metadata denial, timeout and 1 MB cap.
- Preserve relayer limits: chain `114`, registry-resolved `FdcHub.requestAttestation`, stored request hash, exact fee quote/caps, quota, balance floor and final-effect authorization.

## Deployment boundary

- [ADR 0029](docs/adr/0029-digitalocean-vds-deployment.md) selects one
  DigitalOcean Droplet/VDS with Docker Compose. Caddy is the only public ingress
  and routes Web plus same-origin `/api` to the API; API, worker and PostgreSQL
  remain on private Compose networks.
- Public application ingress is limited to 80/443. SSH is restricted to an
  explicit administrator allowlist or VPN. PostgreSQL 5432 is internal only and
  not exposed; API/worker host ports and the Docker socket are never public or
  mounted into application containers.
- Sites is a compatibility package, not the selected production host. Keep its
  accepted artifacts and tests until a separate deprecation slice, and add the
  Docker/Caddy routing gate rather than weakening Sites routing contracts.
- Production images come from GHCR by immutable digest. Migration is a one-shot
  checksummed job under a PostgreSQL advisory lock before app startup;
  `/healthz`, `/readyz`, schema verification, worker heartbeat and the
  persistent PostgreSQL volume remain separate acceptance evidence.
- Database recovery requires off-host WAL plus base backup PITR in private
  S3-compatible Spaces and a credential-free MinIO restore drill. A Droplet
  backup is secondary host recovery, not database restore evidence.
- Do not request or use DNS, SSH, DigitalOcean, GHCR pull, Spaces or live
  Coston2 credentials before credential-free 022–029A, the unified full matrix
  and two independent PASS reports for one tree hash. Do not claim hosted or
  deployed evidence before 028B actually runs.

## Visual contract

- The accepted source is `proofline-run-cockpit-reference.png`.
- Preserve the Run Cockpit hierarchy: fixed navigation rail, compact top bar,
  central attestation timeline, right diagnostics rail, one dominant action and
  bottom evidence strip.
- Preserve the flow `Proof available` → `Verify consumer` → evidence-backed
  invariant result → safe consumer generation → `Open integration package`.
- Show `Proof available`, consumer verification and bundle export only after the persisted proof stage is `completed`; earlier states surface the current stage without implying proof readiness.
- Keep route filters, Composer step and the active secondary panel in restorable
  URL state so reload, back and forward preserve the user's context.
- Keep the dark graphite palette, cyan active state, green completed state, amber diagnostic state, thin dividers, compact developer-tool density, and code-native English UI copy.
- Build Web UI in `src/`. Treat an accepted generated mock as source of truth for layout, component anatomy, density, spacing, color, typography, visible content and hierarchy.
- Before substantial visual changes, use Product Design `get-context` when the visual source is unclear or conflicts with the current goal.
- For visual work, run the local server and inspect the browser yourself; do not hand server-start work to the user when the environment can do it.
- Record durable product-specific design decisions in this file.

## Validation

Start with `npm run typecheck` and the narrowest affected tests. Each module
uses focused TDD and targeted verification. Run the unified full matrix once
after all credential-free 022–029A modules and before the MLP candidate freeze,
as defined in `docs/runbook.md`.

There is no checked-in `.github/workflows` automation yet. Do not describe a
local PASS as a hosted CI, merge-queue or deployed Coston2 PASS.

Coverage gates:

- contracts/domain/codegen: 100% statements and branches;
- API/adapters/CLI/Action: at least 90% lines and 85% branches;
- React: at least 85% lines and 80% branches plus browser acceptance.

For real PostgreSQL evidence use `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1`. A skipped Testcontainers suite is not a PASS.

Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact unless the slice explicitly changes Sites behavior. Before Sites compatibility handoff run `npm run build` and `npm run test:sites`; require `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Definition of Done

- Requested behavior and frozen contracts agree; no public contract was weakened.
- Typecheck, affected tests and affected coverage gates PASS.
- Before the unified MLP candidate freeze, the complete runbook matrix and real
  Testcontainers PostgreSQL PASS; skipped integration cases are not evidence.
- A Web change has black-box desktop/mobile, keyboard, axe, console/network and
  reload/back-forward evidence.
- A release candidate has two independent PASS reports for one exact tree hash.
- Commands, boundaries, operations and reference examples changed by the slice
  are updated in the canonical documentation.
