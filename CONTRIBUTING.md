# Contributing to Orivra

Thank you for helping improve Orivra. Contributions should preserve the
project's evidence, authorization, and no-private-key trust boundaries.

## Development setup

Use Node.js 22.14.0 and npm 10.9.2:

```bash
git clone https://github.com/MarsherSusanin/Orivra.git
cd Orivra
nvm use
npm ci
```

Start the local Web client with `npm run dev`. It expects the same-origin `/api`
surface for persisted features; Web-only development must display unavailable
API state honestly rather than substituting fixtures.

## Making a change

1. Select an existing item from the
   [Orivra Public Backlog](https://github.com/users/MarsherSusanin/projects/2)
   or open an issue for substantial product, persistence, package-boundary, or
   trust-boundary changes. Backlog priority describes impact, not a delivery
   date or commitment.
2. Keep the change focused and add or update an ADR when it changes public
   contracts, persistence semantics, trust boundaries, or the release path.
3. Add a failing contract or behavior test before implementation when fixing a
   bug or adding externally visible behavior.
4. Keep `packages/contracts` and `packages/domain` deterministic and free of
   I/O. Keep live Coston2 effects and relayer authority inside the worker.
5. Update user-facing and operator documentation in the same pull request.

Do not weaken a public contract, replace persisted evidence with a fixture, or
introduce a direct browser-to-worker/live-effect path to make a test pass.

## Required checks

Run the smallest affected tests while developing, then run the contributor
gate before opening a pull request:

```bash
npm run check:open-source
npm run typecheck
npm test
npm run build:mcp
npm run build
npm run test:sites
npm run test:action:artifact
```

Changes involving PostgreSQL must also run the unskipped Testcontainers suite:

```bash
PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1
```

The full Docker, recovery, browser, and live-Coston2 gates are documented in
`docs/runbook.md`. A skipped integration test is not a passing result.

## Pull requests

Describe the user problem, the trust boundary affected, tests run, and any
known limitations. Keep commits reviewable and do not mix unrelated refactors
with a behavior or security fix. If `packages/action` or its imported code
changes, include the byte-synchronized checked-in Action artifact.

By submitting a contribution, you agree that it is provided under the Apache
License 2.0 unless the file carries a different explicit SPDX identifier.

## Secrets and security reports

Never commit `.env` files, wallet or relayer private keys, API credentials,
project/share tokens, production host secrets, or real credentials in fixtures.
Use obviously synthetic bounded values in tests.

Do not open a public issue for a suspected vulnerability. Follow
`SECURITY.md` instead. Public issues must not contain credentials, private host
access details, or exploit reproductions.
