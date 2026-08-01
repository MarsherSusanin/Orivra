# Proofline agent policy

## Purpose

Proofline turns one Coston2 `Web2JsonManifestV1` into persisted, evidence-backed proof and consumer verification. Optimize for a short, understandable user flow and a reproducible result.

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

## Visual contract

- The accepted source is `proofline-run-cockpit-reference.png`.
- Preserve the Run Cockpit hierarchy: fixed navigation rail, compact top bar, central attestation timeline, right diagnostics rail, one dominant `Verify consumer` action, and bottom evidence strip.
- Preserve the flow `Proof available` → consumer verification → evidence-backed invariant result → safe consumer generation.
- Keep the dark graphite palette, cyan active state, green completed state, amber diagnostic state, thin dividers, compact developer-tool density, and code-native English UI copy.
- Build Web UI in `src/`. Treat an accepted generated mock as source of truth for layout, component anatomy, density, spacing, color, typography, visible content and hierarchy.
- Before substantial visual changes, use Product Design `get-context` when the visual source is unclear or conflicts with the current goal.
- For visual work, run the local server and inspect the browser yourself; do not hand server-start work to the user when the environment can do it.
- Record durable product-specific design decisions in this file.

## Validation

Start with `npm run typecheck` and the narrowest affected tests. Before candidate freeze run the matrix in `docs/runbook.md`.

Coverage gates:

- contracts/domain/codegen: 100% statements and branches;
- API/adapters/CLI/Action: at least 90% lines and 85% branches;
- React: at least 85% lines and 80% branches plus browser acceptance.

For real PostgreSQL evidence use `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1`. A skipped Testcontainers suite is not a PASS.

Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact unless the slice explicitly changes Sites behavior. Before Sites handoff run `npm run build` and `npm run test:sites`; require `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
