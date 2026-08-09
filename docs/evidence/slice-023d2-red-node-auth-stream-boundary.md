# Slice 023D2 RED — Node public-auth stream boundary

Date: 2026-08-09

## Scope and freeze

This Contract/Test Designer wave adds the 023D2 Slice Contract, one semantic
real-loopback/raw-socket test suite and canonical documentation only. It does
not edit API production code, dependencies, public schemas, SQL, Web, worker,
CLI, Action, Sites or Docker/VDS composition.

The frozen boundary applies only to exact public wallet-auth POST pathnames,
including query variants. It requires fixed local Fetch routing independent of
Host, header-first Origin/encoding/framing admission, decoded byte counting at
8192/8193, one absolute 10-second deadline, deterministic failure cleanup and
guarded `Expect: 100-continue`. Explicit residual routes remain uncapped by this
slice.

## Intentional RED

Run with loopback permission:

```sh
npx vitest run \
  apps/api/test/slice023d2-node-auth-stream-boundary.contract.test.ts \
  --reporter=verbose
```

The frozen run contains 31 cases: 14 intentional failures and 17 passing
controls. There are no unhandled test-process errors.

The 14 failures map exactly to absent production behavior:

1. both auth paths still derive their Fetch URL from hostile Host;
2. missing/wrong Origin and any Content-Encoding wait for the declared body
   instead of rejecting from headers;
3. declared Content-Length 8193 waits for bytes on both auth paths;
4. chunked decoded byte 8193 is buffered and dispatched;
5. progress can keep a chunked body open forever because no absolute deadline
   exists;
6. parseable non-exact Transfer-Encoding is dispatched;
7. an iterator error rejects the request-listener promise and is not normalized;
8. oversized `Expect: 100-continue` receives no header-only final rejection;
9. valid `Expect: 100-continue` receives no guarded interim response.

Passing controls prove exact 8192 Content-Length and chunked bodies still
dispatch, residual/method routes remain uncapped, duplicate/comma/conflicting
framing receives Node's bare 400, short Content-Length and client abort do not
dispatch, the server survives those failures, and GET/HEAD/empty DELETE remain
bodyless at the Fetch boundary.

The initial sandboxed invocation could not bind loopback and reported `EPERM`;
it is environment evidence only. The recorded RED result above is the approved
loopback rerun, not a network or hosted test.

## Nearest unchanged baseline

The nearest unchanged baseline is:

```sh
npx vitest run \
  apps/api/test/bootstrap-coverage.test.ts \
  apps/api/test/slice023a-wallet-auth-routes.contract.test.ts \
  apps/api/test/slice023b1-cors-readiness.contract.test.ts \
  apps/api/test/slice023b2-node-empty-delete.contract.test.ts
```

Result: 4 files PASS, 50 tests PASS. `npm run typecheck` is PASS and
`git diff --check` is clean. This RED wave claims no backend coverage,
PostgreSQL, browser, Sites, Docker, hosted or live Coston2 PASS.
