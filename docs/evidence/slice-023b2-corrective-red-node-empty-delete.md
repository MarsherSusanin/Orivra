# Slice 023B2 corrective RED — Node empty DELETE

## Rejected candidate

- Commit: `af69b15a2e156864e19a469c7cbc3e98a92d48c2`
- Tree: `b838b99bf88164e9b9adcf28f8659814b1ba092e`
- Role: Contract & Test Designer; tests/evidence only.

Both independent verifiers reproduced one P1 integration defect. The production
Node adapter buffered an empty DELETE as `Buffer.alloc(0)`. Fetch therefore
exposed a non-null body stream and the strict current-session route returned
`400 INVALID_REQUEST_BODY` before calling revocation, rather than empty `204`.

## Corrective contract

The black-box test starts a real loopback Node server through
`createNodeRequestHandler` and the actual API route. An empty current-session
DELETE must arrive at Fetch with `body === null`, call revocation once and return
empty `204` with private headers and exact-origin CORS. It covers absent content
framing, explicit `Content-Length: 0`, and a zero-length chunked request where
the Node client supports it.

Any nonzero DELETE byte remains `400` and never reaches the service. Empty and
invalid-JSON wallet-auth POSTs retain their existing `400 INVALID_JSON`
behavior. GET and HEAD remain bodyless. No general Node streaming/body-limit
work is pulled forward from 023D.

## Intentional RED

The sandboxed first run could not open a loopback listener and is not semantic
evidence. The exact focused command was rerun with loopback permission:

```text
npx vitest run \
  apps/api/test/slice023b2-node-empty-delete.contract.test.ts \
  --reporter=verbose
```

Observed:

```text
Test Files  1 failed (1)
Tests       3 failed | 5 passed (8)
```

Only the three zero-byte DELETE framing variants fail, each with observed 400
instead of 204. Nonzero DELETE rejection, empty/invalid POST handling and
GET/HEAD bodylessness remain green.

## Nearest green baseline

```text
npx vitest run \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice023b2-account-token-routes.contract.test.ts \
  --reporter=dot
```

Observed: 2 files and 25 tests PASS. `npm run typecheck` and
`git diff --check` pass. No production source, SQL, public schema, dependency,
coverage, real PostgreSQL or full-suite PASS is claimed.
