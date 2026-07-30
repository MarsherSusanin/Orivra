# Slice 001 surface RED evidence

Date: 2026-07-30

Role: Contract & Test Designer

Base production commit: `bae0274`

## Frozen contract boundary

This wave adds tests, public action metadata, package/test scaffolding, recorded fixtures, and no production implementation. The accepted Run Cockpit layout and all files frozen by the core RED commit remain unchanged.

The new contracts cover:

- defensive public schemas, canonical JSON/SHA-256, journal, projection, diagnostics, code generation, mutation, and replay branches;
- HTTPS GET/443-only URL validation, DNS validation/pinning, IPv4/IPv6 private/loopback/link-local/metadata/multicast/reserved denial, rebinding, redirect denial, timeout, and one-MiB cap;
- exact Web2Json verifier payload/status/bytes32 encoding, five-sample deterministic preflight, secret rejection, JQ/ABI compatibility, dynamic registry/fee, chain-114 wallet transaction, round derivation, Relay finality, raw DA request, local proof integrity, on-chain `verifyWeb2Json`, and normalized errors;
- relayer target/calldata/value/cap/quota/balance policy, persist-before-broadcast, exact raw-transaction recovery, hash mismatch, and recursive secret redaction;
- transactional PostgreSQL migration, least privilege, append-only events, opaque keyed token digests, canonical artifact bytes, `SKIP LOCKED` leases, restart safety, empty/idempotent/previous-schema migration, and a real Testcontainers contract;
- every v1 API route, project/share authorization, idempotency headers, share read-only scope, 256-bit token shape, and user-private-key rejection;
- worker replay fail-closed composition, short claim transaction, retry evidence, restart recovery, and log redaction;
- CLI `run create/watch/verify`, wallet-local signing, `bundle export`, replay, and GitHub Action replay/live merge-gate behavior;
- live-service injection into the accepted Web cockpit, error/retry, modal keyboard/focus/Escape, bundle export/reparse, browser run persistence, and EIP-1193 signing;
- canonical vulnerable/safe Solidity pair, invariant-before-proof ordering, and `solc` compilation;
- Sites deep routes, `/api` isolation, missing-asset 404 behavior, hermetic end-to-end replay/restart, and a separately configured 10-minute live Coston2 gate.

## Existing green evidence

```text
npm run test:contracts
  2 files passed; 28 tests passed

npm run test:core
  5 files passed; 44 tests passed

npm run build
  Vite build passed; Sites artifacts prepared
```

The original cockpit suite is still green inside `npm run test:web`: `src/App.test.tsx` has 3/3 passing tests. No visual production file changed.

## Intended RED evidence

### Pure-core coverage refactor gate

```text
npm run test:core:coverage
  72/72 tests pass
  statements 100%
  functions 100%
  lines 100%
  branches 97.84% (91/93)
  threshold failure: run-lifecycle.ts branches at lines 44 and 124
```

Both remaining branches are unreachable after the existing journal/terminal guards. No coverage ignore was added. GREEN must remove the dead conditional alternatives without changing the frozen behavioral contracts.

### Adapter/API/worker/CLI/Action/Postgres

```text
npm run test:integration
  expected missing production modules:
  packages/fdc-coston2/src/{safe-http,preflight,verifier,coston2,errors,relayer}
  apps/api/src/{app,postgres}
  apps/worker/src/worker
  packages/{cli,action}/src/index
  expected missing migration:
  apps/api/db/migrations/001_initial.sql
```

`npm run test:postgres` fails for the same missing migration/repository. A forced Testcontainers run was attempted because Docker CLI reports server `28.3.2`; the Node Testcontainers runtime could not bind the active macOS `desktop-linux` socket, so the container contract remains opt-in through `PROOFLINE_TESTCONTAINERS=1` until that runtime integration is available. Static SQL contracts are always enabled.

### Web

```text
npm run test:web
  existing App tests: 3 passed
  new surface tests: 4 expected failures
    service-backed verification is not wired
    focus trap/Escape/restore is absent
    evidence-backed error/retry is absent
    bundle export/reparse action is absent
  expected missing module: src/services/run-client.ts
```

`npm run typecheck` fails only because the intentionally absent `src/services/run-client.ts` is imported by the new browser contract.

### Sites

```text
npm run test:sites
  5 passed; 2 expected failures
  RED: HTML-accepting /api request receives SPA shell
  RED: missing asset-like path receives SPA shell
```

The original four Sites tests pass, as does the new deep-route query contract.

### Solidity and end-to-end

```text
npx vitest run contracts/test
  expected missing canonical Solidity files:
  contracts/ProoflineUrlInvariant.sol
  contracts/CanonicalVulnerableWeb2JsonConsumer.sol
  contracts/CanonicalSafeWeb2JsonConsumer.sol

npm run test:e2e
  expected missing hermetic composition:
  apps/api/src/test-system.ts
```

`npm run test:live:coston2` is deliberately separate from the hermetic suite and requires all four explicit live environment values. No live transaction was attempted during RED.

## GREEN rule

These tests and fixtures are frozen after this commit. The Surface & Adapter Implementer may add production implementation and perform behavior-preserving refactors, but must not weaken, skip, or rewrite the tests. Any contract ambiguity returns to the Slice Architect and Contract & Test Designer.
