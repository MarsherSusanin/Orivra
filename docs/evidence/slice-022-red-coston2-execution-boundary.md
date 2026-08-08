# Slice 022 corrective RED — Coston2 execution boundary

## Frozen rejected candidate

- Parent commit: `c09dd6bc1c0e864b82adb58ad4af74eca1d5fc25`
- Parent tree: `05738887ec6e2d67de02f1da1d0192dd9ba42dbd`
- Finding: the generic manifest correctly recognizes Flare for product copy,
  but the same schema is reused by persisted and executable Coston2 paths.
- Scope: tests, Slice Contract clarification and this evidence record only;
  production sources and public implementations are unchanged.

## Frozen implementation contract

`Web2JsonManifestV1` remains the closed UI/API vocabulary `coston2 | flare`.
The next production author must add a dedicated Coston2-only manifest contract
and use it for every persisted or executable boundary: `RUN_CREATED`, proof
bundle content, replay source, verifier preparation, preflight and production
worker/live-adapter entry. A recognized Flare manifest must be rejected before
source fetch, transform, ABI encoding, verifier HTTP, registry, fee, RPC, Relay,
DA or transaction effects. Coston2 fixtures remain valid.

## Expected RED

The focused tests intentionally fail on the rejected candidate because it has
no exported Coston2-only manifest schema, accepts Flare in `RUN_CREATED` and
bundle/replay evidence, and reaches preflight, verifier and worker effects.

Focused command:

```text
npx vitest run \
  packages/contracts/test/slice022-coston2-execution-boundary.contract.test.ts \
  packages/domain/test/slice022-coston2-replay-boundary.contract.test.ts \
  packages/fdc-coston2/test/slice022-coston2-preflight-boundary.contract.test.ts \
  apps/worker/test/slice022-coston2-execution-boundary.contract.test.ts \
  --reporter=verbose
```

Observed result:

```text
Test Files  4 failed (4)
Tests       8 failed (8)
```

All eight failures are intentional and semantic:

- the dedicated Coston2 schema is absent;
- Flare parses in both `RUN_CREATED` and a bundle with chain `114` evidence;
- a checksum-valid Flare replay source is accepted;
- preflight performs five source requests and its downstream transformations,
  verifier preparation and fee quote instead of rejecting before effects;
- direct verifier preparation consumes its HTTP interceptor;
- the production command handler invokes its preflight port;
- the live adapter invokes Coston2 RPC before checking the manifest network.

## Nearest unchanged controls

Command:

```text
npx vitest run \
  packages/contracts/test/slice022-network-capability.contract.test.ts \
  packages/domain/test/bundle-replay.test.ts \
  packages/fdc-coston2/test/preflight.test.ts \
  packages/fdc-coston2/test/verifier.test.ts \
  apps/worker/test/live-runtime-adapter.contract.test.ts \
  apps/worker/test/production-command-pipeline.contract.test.ts \
  --reporter=dot
```

Observed result:

```text
Test Files  6 passed (6)
Tests       41 passed (41)
```

`npm run typecheck` and `git diff --check` pass. The full repository matrix,
coverage, PostgreSQL, browser and live Coston2 gates are not part of this
corrective RED wave.
