# Orivra agent policy

## Purpose and sources of truth

Orivra proves whether a Coston2 Web2Json consumer trusts the intended URL,
not merely whether a proof is valid. One strict `Web2JsonManifestV1` becomes
persisted lifecycle evidence, Consumer Lab diagnostics, safe Solidity and a
checksummed integration package.

Use this file as the policy gateway. Detailed truth lives in:

- product and contributor entry point: `README.md`;
- module boundaries and invariants: `ARCHITECTURE.md`;
- local, production, rollback and incident operations: `docs/runbook.md`;
- expensive decisions: `docs/adr/README.md`;
- representative implementation patterns: `docs/examples/README.md`;
- author/verifier separation: `docs/development/roles.md`.
- public, date-free work selection: `https://github.com/users/MarsherSusanin/projects/2`.

## Work cycle

1. Inspect the nearest contract, implementation, tests and ADR before editing.
2. Classify the change using ADR 0047: UI-only, deployment tooling,
   backend/persistence, authority-only refresh, or an explicitly approved
   production incident restoration.
3. Freeze the closest causal RED test, implement the smallest vertical GREEN
   slice, then refactor without weakening the contract.
4. Run the affected commands below and read their complete output.
5. Verify user-facing behavior through the real surface that changed.
6. Update the canonical docs when commands, boundaries or operations change.

One writer MUST own the shared tree during a wave. A production author MUST
NOT act as either release verifier; two independent verifiers inspect one exact
commit/tree. Any production edit invalidates both reports.

## Canonical commands

Start with:

```bash
npm run typecheck
npm test -- --run <nearest-test-file>
```

Use the affected gate, not an invented substitute:

| Boundary | Required commands |
| --- | --- |
| Contracts/domain | `npm run test:core:coverage` |
| API/adapters/CLI/Action | affected tests, `npm run test:coverage:backend` when applicable |
| Worker | affected tests, `npm run test:coverage:worker` |
| Web UI | `npm run test:coverage:web -- --maxWorkers=1`, `npm run build`, `npm run test:sites`, `npm run test:action:artifact` |
| MCP | focused MCP tests, `npm run build:mcp` |
| Deployment tools | focused composition tests, `npm run test:docker:static` |
| PostgreSQL | `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1` |
| Open-source metadata | `npm run check:open-source` |

A skipped Testcontainers suite is not a PostgreSQL PASS. There is no checked-in
`.github/workflows` automation; local commands MUST NOT be described as hosted
CI or merge-queue evidence.

## Architectural boundaries

- `packages/contracts` and `packages/domain` MUST remain pure and deterministic.
- Coston2 network behavior MUST stay behind `packages/fdc-coston2` ports.
- `apps/api` owns authentication, idempotent commands and PostgreSQL
  composition; it MUST NOT receive user or relayer private keys.
- `apps/worker` is the only owner of relayer credentials and external live
  effects. It MUST claim persisted commands and append outcomes.
- Web, CLI, Action and MCP MUST use public contracts and the persisted API path;
  they MUST NOT implement a second lifecycle.
- `@proofline/mcp` is a local stdio replay/evidence connector using existing
  `kind: "cli"` project tokens. It MUST NOT expose wallet, relayer, private-key,
  arbitrary HTTP, RPC or live-submission tools and is never installed on VDS.
- Run events are append-only. Preserve sequence, terminal immutability,
  idempotency and byte-identical replay.
- Production adapters fail closed. Test adapters MUST NOT be importable or
  callable outside `NODE_ENV=test`.
- Add or update an ADR before changing package boundaries, persistence,
  authorization, storage, deployment topology or release authority.

## Security invariants

- MUST NOT commit, log, serialize, echo or publish tokens, private keys,
  verifier keys, database URLs or raw secrets.
- Preserve opaque token digests, read-only share access, project-token mutation
  authority and browser-wallet/session separation.
- Preserve SSRF controls: HTTPS GET, port 443, no redirects, pinned validated
  DNS, private/link-local/metadata denial, timeout and 1 MB cap.
- Preserve relayer limits: chain `114`, registry-resolved `FdcHub`, stored
  request hash, exact fee quote/cap, quota, balance floor and final-effect
  authorization.
- Credentials pasted into chat or a terminal are exposed and MUST be rotated.
  Never copy Swift credentials into the runtime.

## Product and visual contract

- Preserve the Run Cockpit hierarchy from
  `proofline-run-cockpit-reference.png`: navigation, compact top bar, six-stage
  timeline, diagnostics rail, dominant action and evidence strip.
- `Proof available` MUST precede Consumer Lab. A verified proof with no
  consumer evidence is `Consumer · Ready`, not `In progress`; selecting it MUST
  route, scroll and focus the `Verify consumer` action. Completed consumer
  evidence remains addressable by URL.
- Vulnerable diagnostics and generated safe Solidity are separate facts.
  Never claim `safe to integrate` without persisted canonical-safe evidence.
- Route filters, Composer state, active run stage and panels MUST survive reload,
  back and forward.
- Ordinary routes use the global SIWE session. Share/project-token routes show
  only `Shared access` or `Token access` and MUST NOT restore wallet chrome.
- Browser acceptance runs on the operator Mac. Never install Chromium on VDS
  or touch V2BOX, system DNS or the workstation local-IP configuration.

## Production and release boundary

Production is one DigitalOcean VDS using Docker Compose. Caddy is the only
public ingress on 80/443; PostgreSQL, API and worker remain private. Timeweb S3
is the active backup store; MinIO is QA-only. Exact current state, image digests
and rollback commands belong only in `docs/runbook.md`.

Normal release authority requires one clean candidate and independent Core and
Product PASS reports for the same tree. VDS MUST pull immutable GHCR digests;
it MUST NOT build application images. Publication/deployment evidence remains
separate and append-only.

ADR 0047 permits a deadline incident restoration only after explicit operator
approval. It may publish and pin the smallest affected service image after the
focused gate, MUST preserve the prior digest, and MUST verify container digest,
`/api/healthz`, `/api/readyz` and the affected Mac-browser journey. It is not a
release, security, PITR or candidate PASS; deferred normal gates remain debt.

Sites is compatibility-only. Unless the slice explicitly changes Sites, keep
`.openai/hosting.json`, `worker/index.js`,
`scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs` intact.

## Definition of Done

- Requested behavior, public contracts and persisted evidence agree.
- Relevant tests, coverage, typecheck and build gates pass.
- Web changes include desktop/mobile, keyboard, axe, console/network and
  reload/back-forward evidence.
- Operational changes include exact before/after identity and a tested rollback
  boundary.
- Normal release candidates have two independent PASS reports for one tree;
  incident restorations are explicitly labeled non-PASS.
- Commands, architecture, operations and reference examples changed by the
  slice are updated in the canonical documentation.
