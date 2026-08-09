# Slice 023D2 — Node public-auth stream boundary

## Outcome and exclusions

Unauthenticated wallet challenge/session bodies are rejected before unbounded
Node buffering. The bridge uses fixed routing identity, validates authority and
framing before reads, accepts at most 8192 decoded bytes under one absolute
deadline and cleans up every rejected or aborted stream.

This module changes only Node API composition. It does not change public
success schemas, PostgreSQL, quotas, bearer/share semantics, Web UI, worker,
CLI, Action, Sites, Docker/VDS deployment or the body behavior of residual
routes. The existing Fetch-level 8 KiB validation remains defense in depth.

## Frozen transport contract

The guarded paths are exactly:

- `POST /v1/auth/wallet/challenges`;
- `POST /v1/auth/wallet/sessions`.

Any query is included in the guard because matching uses method and pathname.
Another method, trailing slash or pathname is residual and retains the current
uncapped general bridge. All Fetch Request URLs use
`http://127.0.0.1:<configured port>` plus the received origin-form path/query;
`Host` is forwarded only as an HTTP header and never selects routing authority.

Before body iteration the bridge enforces this order:

1. exact configured Origin, else private `403 AUTH_ORIGIN_FORBIDDEN`;
2. absent Content-Encoding, else private
   `415 UNSUPPORTED_CONTENT_ENCODING`;
3. no transfer coding or one exact `chunked` coding, else private
   `400 INVALID_REQUEST_BODY` when llhttp admitted the request;
4. Content-Length at most 8192, else private
   `413 REQUEST_BODY_TOO_LARGE` without waiting for bytes.

Node/llhttp remains owner of syntax it rejects before the request listener:
duplicate or comma Content-Length, Content-Length plus Transfer-Encoding and
framing conflicts receive one bare `400` with `Connection: close`, no JSON and
no CORS authority.

Body iteration counts decoded bytes, accepts exactly 8192 and stops on byte
8193 with private `413 REQUEST_BODY_TOO_LARGE`. One absolute 10000 ms deadline
starts at handler entry and is never reset by progress; only tests may inject a
shorter value. Timeout is private `408 REQUEST_BODY_TIMEOUT`. Iterator failure
is private `400 INVALID_REQUEST_BODY` when writable. Premature EOF may be a
bare Node `400`; an already aborted client receives no invented response.

Every direct JSON rejection uses canonical ErrorV1 safe copy, private cache and
referrer headers, `Connection: close`, and exact-origin CORS only after the
Origin has itself passed. It never calls `api.fetch`. Timers, iterator and
socket ownership are settled on success, rejection, timeout and abort; the
request listener never leaves an unhandled rejection. For
`Expect: 100-continue`, the same guard handles `checkContinue`: invalid headers
receive only the final rejection and valid headers receive exactly one interim
`100` before body bytes are requested.

## Risk and ADR impact

Security risk is high because this is the unauthenticated Node memory/slow-body
boundary. ADR 0024 is extended in place; package boundaries, persistence and
release path do not change. No migration, dependency, credential or external
network is required.

## Frozen RED and expected reason

The real loopback/raw-socket suite freezes fixed routing, exact scope,
header-before-body rejection, Content-Length and chunked 8192/8193 behavior,
absolute deadline, parser conflicts, premature EOF, client abort, injected
stream failure, connection cleanup, guarded `100-continue` and unchanged
GET/HEAD/empty DELETE plus residual POST behavior.

Expected RED is limited to the current bridge buffering every request before
route/origin/framing admission, trusting Host for the Fetch URL, having no
stream byte/deadline/error normalization and not owning `checkContinue`.
Accepted 8192, bodyless requests, residual routing, llhttp bare errors and
short-body non-dispatch remain GREEN controls.

## Acceptance gates

RED records the focused suite plus the nearest unchanged 023A/B1/B2/bootstrap
baseline, `npm run typecheck` and `git diff --check`. GREEN adds focused API
coverage at least 90% lines and 85% branches and an API build. It requires
no PostgreSQL, browser, Sites or Docker gate because none of those surfaces
changes. This is a credential-free module gate, not the unified 022–029A
candidate matrix and not hosted/deployed evidence.

Core verification reviews route identity, framing ambiguity, byte/deadline
boundaries, stream ownership and failure cleanup. Product integration
verification repeats the exact raw HTTP/CORS/status behavior, confirms ordinary
auth success and residual route regressions, and inspects the same recorded
tree hash.
