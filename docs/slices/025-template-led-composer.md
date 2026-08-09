# Slice 025 — Template-led Composer

Status: RED contract freeze; credential-free.

## Outcome

A visitor can inspect a public, deterministic Web2Json template gallery, open
one immutable detail and start the existing Composer from a verified manifest.
Open-Meteo Berlin current temperature is featured and selected by default.
The accepted `eth-usd` deep link remains byte-compatible with Slice 015.

[ADR 0033](../adr/0033-static-template-catalog-boundary.md) owns the static
catalog, manifest-digest and public HTTP/browser trust boundary.

## Bounded delivery sequence

### 025A — contracts and pure catalog

- strict bounded catalog, summary, detail and provenance V1 schemas;
- pure feature entries `@proofline/contracts/templates` and
  `@proofline/domain/templates` with identity-preserving root re-exports and no
  worker artifact contribution;
- cycle-free `@proofline/contracts/manifest` extraction with identity-preserving
  root re-exports; templates import manifest/template features rather than the
  contracts root, while the worker retains required manifest runtime bytes;
- catalog revision `1`, template revision `1`, canonical IDs
  `open-meteo-current-weather` and `eth-usd`;
- one statically compiled catalog/detail implementation in `packages/domain`;
- pure resolver reparses the manifest, canonicalizes it, recomputes SHA-256 and
  rejects any summary/detail/provenance/manifest mix-and-match;
- exact defensive immutable resolution with canonical manifest bytes.
- `createEthUsdComposerDraft` remains an exact compatibility adapter over
  canonical `eth-usd` resolution and contains no duplicate Coinbase manifest.

The Open-Meteo manifest digest is
`sha256:18cd4d6b5c2d8e84ca0d2004c5a013f7f9c9387eed0d1de23ce00df8f167c4e8`.
The preserved exact ETH/USD manifest digest is
`sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db`.

### 025B — anonymous API representations

- exact `GET /v1/templates` and `GET /v1/templates/:id` before bearer parsing;
- canonical JSON response bytes, response-byte strong ETags and exact 304;
- `public, max-age=300, must-revalidate` on 200/304;
- exact configured-origin CORS compatible with `/v1/networks`, with ordinary
  no-Origin server reads receiving no CORS authority;
- deterministic no-query, 404 and 405 behavior with `no-store` on errors;
- no service/database/worker/source/verifier/RPC call and no new migration.

There is no revisioned HTTP route, alias, redirect, `Content-Location`, latest
selection or query selector. The detail itself identifies immutable revision
`1`. A later revision or route requires a new frozen contract.

### 025C — gallery, detail and Composer selection

- token-free same-origin `/templates` and `/templates/:id` routes;
- one strict client and pure resolver before a template becomes a draft;
- `/runs/new?template=<id>&revision=1` as the canonical selection URL;
- legacy `/runs/new?template=eth-usd` normalized with `replaceState` to revision
  `1`, without changing its exact template manifest;
- a valid restored draft wins. Replacement happens only after an explicit
  destructive confirmation and receives a fresh create idempotency key;
- an applied or edited template is thereafter an authoritative persisted draft;
  click/direct/history selection of another template becomes pending and never
  auto-applies over it when an asynchronous response settles;
- same `{id, revision}` URLs that differ only by Composer step are ordinary
  Back/Forward navigation: exact persisted draft bytes remain unchanged, no
  replacement UI appears and no template detail is fetched again;
- cancel preserves the saved draft byte-for-byte;
- confirmation atomically clears the old pending create intent plus validation,
  trust and submission errors, so later authentication cannot submit replaced
  bytes or their idempotency key;
- replacement review is disabled while authenticated create is in flight and
  becomes available only after a non-navigating settlement;
- the replacement dialog owns and traps focus, Escape preserves the draft and
  pending choice, and focus returns to `Review replacement`;
- invalid ID/revision/detail becomes unavailable and never falls back to the
  default, ETH/USD, a sample or a partially trusted manifest;
- on unedited submit, the exact resolved manifest reaches the existing run
  creation port. Bounded provenance metadata never enters the run request.

The browser may request only same-origin catalog/detail and the existing
persisted Proofline endpoints. It never fetches Coinbase, Open-Meteo, a
documentation host, RPC, compiler or verifier. The API likewise never fetches
a template source. Source I/O remains a later authenticated persisted run
preflight effect.

## Frozen public contract

`Web2JsonTemplateSummaryV1` is strict and contains only bounded canonical `id`,
positive safe-integer `revision`, bounded `title`, bounded `summary`, bounded
`provider`, category `finance | weather`, `featured`, lowercase SHA-256
envelope and the exact `detailPath` derived from the ID.

`Web2JsonTemplateCatalogV1` is strict and contains version/kind,
`catalogRevision: 1` and the ordered two summaries. Exactly one summary is
featured; the first featured item, `open-meteo-current-weather`, is the static
default.

`Web2JsonTemplateDetailV1` is strict and contains
`kind: "web2json-template-detail"`, the exact summary under `template`, the
strict manifest, its exact `manifestCanonicalJson` and exact provenance:

```json
{
  "kind": "proofline-builtin",
  "catalogRevision": 1,
  "templateId": "open-meteo-current-weather",
  "templateRevision": 1,
  "manifestSha256": "sha256:..."
}
```

Strings and aggregate canonical response bytes are bounded; unknown keys,
duplicate IDs, duplicate featured/default identities, mismatched paths, unsafe
URLs and mixed revisions fail closed. No raw source response, sample payload,
token, header, body, verifier data, transaction, compiler artifact, error stack
or arbitrary metadata is a field.

## RED and GREEN gates

The RED wave changes tests and documentation only. GREEN must satisfy:

- contracts/domain 100% statements and branches;
- API and template client at least 90% lines and 85% branches;
- Web at least 85% lines and 80% branches;
- desktop `1488×1058` and mobile `390×844`, keyboard/focus, zero
  serious/critical axe findings, clean console/network, direct/reload/back/
  forward and restored-draft confirmation acceptance;
- production build and Sites deep-route compatibility, preserving `/api`
  fail-closed behavior and protected Sites files.

Focused local evidence is not hosted CI, external Open-Meteo/Coinbase, live
Coston2, Docker or deployment evidence. No broad/full matrix runs in this
slice; the unified credential-free matrix remains scheduled after 029A.
