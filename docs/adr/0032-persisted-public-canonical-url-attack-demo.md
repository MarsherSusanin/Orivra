# ADR 0032 — Persisted public canonical URL attack demo

Status: Accepted

## Context

ADR 0031 and Slice 024A define an honest canonical URL attack recording. Its
outer bytes contain two independently persisted live Coston2 bundles plus exact
compiler and deterministic local-EVM reproduction evidence. Pure domain replay
proves byte integrity and self-consistency but deliberately cannot authorize
acceptance; only the concrete `packages/fdc-coston2` runtime, after rereading
checked-in sources, recompiling and executing all three calls, returns the
checksum-bound `runtime-verified` authority.

The product now needs to persist and present one such recording. Serving a
checked-in fixture, selecting a latest row, validating only its checksum at API
startup or sending the 6 MiB recording to the browser as the summary would
undo the honest boundary. Import, persistence, anonymous HTTP and browser
presentation therefore require one explicit decision.

## Decision

024B is one vertical contract delivered in three bounded implementation waves:

1. **024B1 — contracts, domain and persistence/import.** A redacted summary is
   derived purely, migration 009 creates immutable storage, and a one-shot
   importer establishes runtime authority before PostgreSQL work.
2. **024B2 — public API and startup cache.** One exact environment digest
   selects one row. Startup validates and caches it once; two anonymous routes
   expose the bounded summary and exact recording bytes.
3. **024B3 — Web and product integration.** `/demo/canonical-url` presents the
   persisted/live and deterministic/local parts honestly and Sites preserves
   the deep route.

The three waves may be implemented and reviewed separately, in this order, but
none may weaken the complete contract frozen by this ADR. 026 consumes the same
summary/client rather than defining another demo authority.

### Strict public summary

`packages/contracts` owns strict
`CanonicalUrlAttackDemoSummaryV1Schema`. It has version `1`, kind
`canonical-url-attack-demo-summary`, status `available`, the exact statement
`Valid proof ≠ trusted URL`, and only:

- `recording`: exact canonical-envelope byte SHA-256, outer content checksum,
  canonical recording time and lowercase 40-hex release commit/tree;
- fixed Coston2 chain `114` and `persisted-api` evidence source;
- `runs.attack` and `runs.control`: bounded run ID, wallet/relayer mode,
  public canonical requested URL, transaction hash, voting round and proof
  SHA-256;
- compiler name/version/EVM target and runtime name/version/hardfork;
- the ordered three transcript outcomes with only proof, calldata, runtime and
  accepted-return/reverted-result SHA-256 evidence. The middle outcome retains
  exact `HostMismatch()` and selector `0xb828610a`;
- literal download path `/v1/demo/canonical-url/recording`.

It contains no canonical bundle, source, standard JSON, bytecode, raw calldata,
raw return/revert bytes, header, token, runtime URL or arbitrary metadata.
Every object is strict. Run IDs are 1–128 safe identifier characters, requested
URLs remain bounded by the accepted 024A public-HTTPS contract, hashes are
lowercase SHA-256 envelopes, release hashes are lowercase 40-hex, and
toolchain versions use the pinned semantic form.

`packages/domain` owns pure
`deriveCanonicalUrlAttackDemoSummary`. It first validates the recording through
the non-authorizing 024A domain boundary, canonically serializes that validated
recording and recomputes its exact UTF-8 byte SHA-256. A different digest is
rejected even when it is a well-formed lowercase SHA-256 envelope; only an exact
match may be projected into the strict summary. It performs no file, PostgreSQL,
compiler, EVM, process-environment or network I/O. Neither replay nor summary
derivation is import authority.

### Immutable PostgreSQL recording

Additive migration `009_canonical_url_attack_recordings.sql` creates
`proofline_private.canonical_url_attack_recordings` with:

- `recording_sha256 bytea PRIMARY KEY`, exactly 32 bytes, covering the exact
  stored canonical envelope bytes and serving as the environment selector;
- unique `recording_checksum bytea`, exact 32-byte outer content checksum, and
  `authority_recording_checksum bytea` constrained to the same value;
- `canonical_bytes bytea` and `canonical_utf8_bytes integer`, constrained to
  `1..6291456` and exactly `octet_length(canonical_bytes)`;
- canonical `recorded_at`, lowercase 40-hex `release_commit_sha` and
  `release_tree_sha`, bounded distinct `attack_run_id`/`control_run_id`;
- literal `runtime_authority = 'fdc-coston2-runtime-v1'`, plus
  `runtime_verified_at` and `imported_at`.

UPDATE, DELETE and TRUNCATE are rejected by append-only triggers. Migration 009
creates the NOLOGIN role `proofline_recording_importer`, revokes PUBLIC, grants
that role only SELECT/INSERT, grants `proofline_api` only SELECT, and grants
`proofline_worker` nothing. No role receives UPDATE, DELETE or TRUNCATE.

### One-shot import authority

The API workspace owns a separate one-shot importer entry, not an ordinary API
route or startup side effect. Its operational form is:

```text
npm --workspace @proofline/api run import:canonical-url-attack -- \
  --recording <canonical-recording-path>
```

The entry requires an explicit path and an importer-role `DATABASE_URL`. It has
no default path, directory scan, HTTP input, project token, wallet/relayer key,
Coston2 RPC or external network behavior.

The importer opens one file handle, obtains bounded bytes and reads one exact
`Buffer`; more than 6 MiB, invalid UTF-8, noncanonical JSON, digest/checksum
mismatch or invalid recording fails before PostgreSQL. It constructs the
concrete 024A FDC runtime over the exact checked-in sources and invokes full
runtime verification on the exact in-memory string. Verification rereads the
sources, recompiles and executes vulnerable/attack, safe/attack and
safe/control. Its returned authority checksum must equal the envelope checksum.

Only after all those operations succeed may the importer connect, issue
`BEGIN`, acquire the fixed transaction advisory lock
`pg_advisory_xact_lock(hashtextextended('proofline:canonical-url-attack-recording-import:v1', 0))`
and insert the exact same Buffer and redundant metadata. Conflict is success
only when every stored byte and metadata field is identical. The importer
rereads the row and byte-compares it before commit; a same-digest or
same-checksum substitution fails and rolls back. Concurrent invocations
serialize under the same lock. Pure replay alone can never reach INSERT.

### Exact startup selection and lightweight cache

The optional environment selector is exactly:

```text
PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256=sha256:<64 lowercase hex>
```

Absent means deliberately unavailable and performs no recording query.
Malformed configuration is fatal before the listener starts. There is no
`latest`, default, query-string selector or directory fallback.

When configured, API startup loads that digest exactly once and validates:

1. selected digest, stored byte count and SHA-256 against the exact row bytes;
2. canonical 024A replay and byte-identical reserialization;
3. stored content checksum, authority checksum, fixed runtime-authority literal,
   release, run IDs and recording time against the envelope.

It then caches a frozen strict summary, its canonical bytes and strong ETag,
plus a private exact recording Buffer and its strong byte-digest ETag. Missing
or corrupt rows yield the same unavailable state. This optional absence does
not yet change readiness; 027B will make a configured-invalid selection degrade
`/readyz`. Startup and reads never import `packages/fdc-coston2`, `solc` or an
EVM and never rerun runtime verification.

`createProoflineApi` validates an injected available cache exactly once during
composition, copies all public strings and exact recording bytes into an owned
private snapshot, and freezes the validated summary snapshot. It retains no
getter, Proxy or mutable caller-owned byte view. An invalid injected cache is
normalized to unavailable before any request is handled. Summary GET, exact
If-None-Match 304 and recording download use only that snapshot: request paths
do not reread caller input, reparse the summary, recanonicalize it or recompute
either SHA-256. Mutation of the caller-owned cache or byte array after
composition cannot change response bytes, ETags or availability.

### Anonymous public HTTP

The exact routes are:

- `GET /v1/demo/canonical-url` — the strict summary;
- `GET /v1/demo/canonical-url/recording` — the exact stored bytes.

They dispatch before bearer authentication. Missing, malformed, valid or
invalid Authorization headers do not change output and do not invoke token
lookup. Query parameters are forbidden and return bounded `400
INVALID_CANONICAL_URL_ATTACK_DEMO_QUERY`. Unsupported methods return bounded
`405 METHOD_NOT_ALLOWED` and `Allow: GET` before auth.

Available responses use `Cache-Control: public, max-age=0, must-revalidate`.
Each representation has a correct strong ETag: summary ETag covers its canonical
summary bytes, while download ETag is the exact recording-byte SHA-256.
Exact `If-None-Match` returns a bodyless 304 for that representation.

The download additionally returns:

- `application/vnd.proofline.canonical-url-attack-recording.v1+json; charset=utf-8`;
- exact `Content-Length`;
- `X-Content-Type-Options: nosniff`;
- `Content-Disposition: attachment` with filename
  `canonical-url-attack-recording-<64 hex digest>.json`.

Only the exact configured Web origin receives CORS authority. Requests with no
Origin remain valid for server-side clients; other origins receive no CORS
grant. Errors use `Cache-Control: no-store`.

Both routes use exactly the same unavailable response, with no reason, ETag or
Retry-After:

```json
{"version":"1","error":{"code":"CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE","message":"Canonical URL attack recording is unavailable"}}
```

### Browser and Sites presentation

`/demo/canonical-url` is public, token-free and wallet-free. It issues exactly
one same-origin `GET /api/v1/demo/canonical-url`. It never restores a wallet,
sends a bearer, preloads the full recording, fetches either requested source
URL, contacts RPC/compiler services or constructs fallback evidence.

Available presentation clearly separates **Persisted Coston2 evidence** from
**Deterministic local EVM replay** and shows the bounded public transaction,
round, checksums and three outcomes. Requested URLs are text, never active
external links. Download is a user-initiated same-origin link only.

HTTP 503, transport failure or invalid summary renders the stable heading
`Canonical attack recording unavailable`. That state contains no sample/fake
hash, evidence timeline, `Proof available` claim or download. The route must
survive direct deep load, reload, back and forward; desktop and mobile layout,
keyboard navigation, visible focus, axe, console and network are product gates.

Sites remains compatibility-only. Its generic SPA fallback must serve
`/demo/canonical-url` while `/api/*` and writes remain fail closed. No Caddy port
or public service boundary changes in 024B.

### Production import and exact selector

The production runtime makes the otherwise optional selector mandatory for the
API service. An operator installs one previously runtime-verified recording as
a root-owned, root-group regular mode-`0400` file below `/opt/orivra/evidence`
and invokes the bounded `production:demo:import` command with its exact byte
SHA-256. The command opens the file with `O_NOFOLLOW`, enforces the 6 MiB cap,
checks metadata and digest before Docker, and runs exactly one foreground
`db-role-bootstrap` container with the importer entrypoint. The importer sees
only the dedicated recording-importer database URL file, not bootstrap or
administrator database authority.

Import happens before recreating the API with the same selector. Only the API
image and its immutable digest change for this restoration; Web, worker, Caddy
and PostgreSQL images remain pinned. Rollback restores the previous API digest
and runtime file. The append-only recording row is retained and ignored by an
API without that selector. Production never selects the most recent row and
never synthesizes a recording when the selected row is absent or invalid.

## Consequences

- A public demo can be enabled only by an exact digest selected from immutable,
  runtime-verified persisted bytes.
- Browser payload is bounded and redacted while exact recording download
  remains available on deliberate user action.
- The ordinary API remains lightweight and cannot accidentally acquire compiler,
  EVM, Coston2 or import authority.
- Missing real evidence is an explicit available/unavailable product state, not
  a reason to ship a fixture or synthetic fallback.
- Migration 009 and importer require real PostgreSQL Testcontainers evidence;
  skipped integration cases are not PASS.
- 024B is credential-free and makes no hosted, deployed or live-recording claim.
