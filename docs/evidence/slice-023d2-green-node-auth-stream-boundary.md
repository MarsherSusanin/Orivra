# Slice 023D2 GREEN — Node public-auth stream boundary

Date: 2026-08-09

## Implementation

The production Node bridge now applies the frozen pre-buffer boundary only to
the two exact wallet-auth POST pathnames. Production routing uses the configured
loopback port rather than `Host`, rejects Origin, content encoding, transfer
coding and declared oversize in the frozen order, and counts at most 8192
decoded bytes under one monotonic absolute deadline. Direct rejections use the
private ErrorV1 envelope and exact-origin CORS authority, then close the
connection after the response is flushed.

The production server factory owns both `request` and `checkContinue`, so an
interim response is emitted only after guarded headers pass. A missing Web
origin and a deadline override fail closed outside `NODE_ENV=test`; the latter
exists only for the frozen short-deadline harness. Residual request bodies and
GET, HEAD and empty DELETE behavior remain unchanged. No public schema,
dependency, SQL, PostgreSQL, Web, worker, CLI, Action, Sites or Docker/VDS code
changed.

## Focused and nearest evidence

With approved temporary loopback binding:

```sh
npx vitest run \
  apps/api/test/slice023d2-node-auth-stream-boundary.contract.test.ts
```

Result: 1 file PASS, 31 tests PASS. This includes exact 8192 and rejected 8193
Content-Length/chunked bodies, one absolute deadline, parser-owned bare 400,
premature EOF, abort, iterator failure, connection cleanup and guarded
`100-continue`.

The focused suite plus the unchanged bootstrap/023A/023B1/023B2 baseline is 5
files PASS and 81 tests PASS. `npm run typecheck` is PASS.

## Coverage and build

```sh
npm run test:coverage:backend
npm run build --workspace @proofline/api
git diff --check
```

Backend coverage is PASS: 99 files passed, 4 PostgreSQL files skipped; 909
tests passed and 30 PostgreSQL tests skipped. The affected API package reports
90.76% lines and 85.49% branches. The complete configured backend reports
91.85% lines and 86.73% branches. The API build is PASS and emits the ignored
`apps/api/dist/server.js` artifact. Diff validation is clean.

The skipped PostgreSQL suites are not claimed as PostgreSQL evidence. This
slice requires no schema gate and claims no browser, Sites, Docker, hosted or
live Coston2 PASS. The unified credential-free 022–029A matrix remains the
candidate-freeze gate.
