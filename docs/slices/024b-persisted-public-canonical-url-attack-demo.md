# Slice 024B — Persisted public canonical URL attack demo

Status: Production-author GREEN candidate rejected by independent Core and
Product verification; corrective RED frozen.

## Outcome

Proofline can import one exact 024A recording only after full trusted runtime
verification, persist its exact bytes immutably, select it by an explicit digest
and present a bounded anonymous summary at `/demo/canonical-url`. Without a
selected valid row the API and Web say the recording is unavailable; neither
ships a sample, fixture or synthetic replacement.

The persistence, public HTTP and browser trust-boundary change is governed by
[ADR 0032](../adr/0032-persisted-public-canonical-url-attack-demo.md). ADR 0031
continues to own recording construction and trusted compiler/EVM verification.

## Bounded delivery sequence

### 024B1 — summary, persistence and import

- strict `CanonicalUrlAttackDemoSummaryV1Schema` and pure deterministic
  derivation from a valid 024A recording plus a recomputed, exact matching
  canonical-byte SHA-256; a different well-formed digest is rejected;
- additive immutable migration
  `009_canonical_url_attack_recordings.sql`, importer/API/worker least
  privilege and real PostgreSQL constraints;
- one-shot API-workspace importer which verifies exact in-memory bytes with the
  concrete FDC runtime before transaction/advisory lock, inserts the same Buffer
  and accepts conflict only when bytes plus metadata are identical.

Pure domain replay is explicitly non-authorizing. The importer has no HTTP,
default path, path scan, project token, wallet/relayer effect or external
network.

### 024B2 — exact API selection and public routes

- optional exact selector
  `PROOFLINE_CANONICAL_URL_ATTACK_RECORDING_SHA256=sha256:<64 lowercase>`;
- absent means unavailable/no query, malformed is fatal before listen, and
  exact configured row is loaded/validated once into a frozen lightweight
  cache without compiler/EVM imports;
- `createProoflineApi` validates, copies and freezes that injected cache once at
  composition; requests retain no caller-owned getter/Proxy/byte view and do no
  summary revalidation, canonicalization or SHA-256 work;
- anonymous exact summary/download GET routes, representation-correct ETags,
  revalidation, exact-origin CORS, query/method rejection and bearer
  independence;
- uniform bounded no-store 503 for absent/corrupt evidence.

### 024B3 — Web and Sites

- `/demo/canonical-url` makes one token-free same-origin summary request;
- available UI separates persisted Coston2 evidence from deterministic local
  EVM results and offers an explicit exact recording download;
- unavailable UI has stable honest copy and no proof-ready, fake or fallback
  content;
- no wallet restore, recording preload, source/RPC/compiler fetch or active
  link to a requested source;
- direct/reload/back/forward, desktop/mobile, keyboard/focus, axe,
  console/network acceptance; Sites generic deep route remains compatible and
  `/api` remains fail closed.

026 must reuse the same summary schema and client. 024B adds no worker behavior,
Action/CLI release gate, Caddy port, Docker composition, credential request or
deployment claim.

## Frozen public summary

The available summary contains only version/kind/status/statement, exact
recording digest/checksum/time/release, fixed Coston2 identity, attack/control
public run/URL/transaction/round/proof hashes, toolchain versions, the ordered
three hash-only outcomes and the fixed download path. It excludes both bundle
strings, all reproduction source/standard JSON/bytecode, raw calldata and
return/revert bytes, tokens and arbitrary metadata.

## Persistence and runtime authority

Migration 009 stores exact canonical bytes under their byte SHA-256, records
the distinct content checksum and equal runtime-authority checksum, limits the
row to 6 MiB, redundantly constrains release/run/runtime identity and denies all
mutation. `proofline_recording_importer` gets SELECT/INSERT,
`proofline_api` gets SELECT, and worker/PUBLIC get no authority.

The one-shot importer performs bounded single-handle read, fatal UTF-8 and
canonical replay, byte digest, full exact-source recompile and three-call EVM
verification before `BEGIN`. Inside the transaction it acquires the fixed
024B advisory lock, inserts or verifies byte-identical existing evidence,
rereads exact bytes and commits. Same digest/checksum with changed evidence is
an error.

## HTTP acceptance

`GET /v1/demo/canonical-url` returns the summary and
`GET /v1/demo/canonical-url/recording` returns the exact bytes with the frozen
vendor media type, byte length, nosniff and digest filename. Summary and
recording use strong ETags for their own bytes and public zero-age
revalidation. Exact If-None-Match returns 304. Query is never a selector and
unsupported methods never enter auth. Both unavailable paths return exactly
`503 CANONICAL_URL_ATTACK_RECORDING_UNAVAILABLE` with message
`Canonical URL attack recording is unavailable`, no reason/ETag/retry and
`no-store`.

## RED and GREEN gates

The frozen RED wave changed tests and documentation only. The production
implementation then proceeded in order B1, B2 and B3 without weakening those
contracts. Candidate gates require:

- contracts/domain 100% statements and branches;
- importer/API at least 90% lines and 85% branches;
- migration 009 static tests and
  `PROOFLINE_TESTCONTAINERS=1 npm run test:postgres -- --maxWorkers=1` with no
  skipped integration case treated as PASS;
- Web at least 85% lines and 80% branches plus local built browser acceptance
  at desktop `1488×1058` and mobile `390×844`, keyboard/focus, axe with zero
  serious/critical violations, console/network and reload/back/forward;
- `npm run build` and `npm run test:sites`, preserving protected Sites files.

Focused gates are local evidence, not hosted CI, live Coston2, Docker or
deployment evidence. The unified full matrix still runs once after all
credential-free 022–029A work.
