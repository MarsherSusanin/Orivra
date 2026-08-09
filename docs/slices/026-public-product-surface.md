# Slice 026 — Public product surface

Status: Production-author GREEN candidate; credential-free; independent Core
and Product verification pending.

## Outcome

A visitor can open `/`, understand why Proofline verifies the intended URL,
choose a strictly parsed featured template starting point and inspect whether
persisted canonical URL attack evidence is configured. The two public regions
remain independent and never require wallet/session authority.

[ADR 0034](../adr/0034-public-landing-and-onboarding-boundary.md) owns root
routing, onboarding trust, cache-variant CORS and the no-new-metrics boundary.

## Frozen vertical contract

### Public route and shell

- exact `/` landing with search/hash normalization before reads or storage;
- brand link `/`, Runs link `/runs`, public `Overview` topbar and no active rail
  item or proof/run status;
- all accepted Runs, Settings, template and exact demo routes preserved;
- unknown and alias paths use one bounded `Page unavailable` client state and
  perform no public/private read;
- explicit injected `AppProps.runId` remains a test composition override.

### Independent anonymous reads

- exactly one strict catalog summary GET and one strict demo summary GET per
  landing document/App request lifecycle;
- same-origin, bodyless, `credentials: "omit"`, without bearer or wallet;
- independent loading, ready and unavailable states, including malformed
  response normalization;
- App-owned request references prevent root remount duplication during
  popstate navigation;
- no template detail, recording download, source/provider, run, wallet,
  network, RPC, compiler, verifier or documentation request.

The landing feature is derived only from `featured:true` in the parsed catalog.
The CTA carries response ID/revision to the accepted Composer resolver. Shared
summary presentation/path logic is reused; there is no second manifest or
provider authority. The demo shows only its bounded historical public summary.

### Honest content

The exact hero, four-step neutral evidence journey, featured loading/ready/
unavailable copy and canonical recording loading/ready/unavailable copy are
owned by ADR 0034. Unavailability never renders fake template/proof readiness,
a fixture, hash, transaction or requested URL. Root emits no analytics event
or local queue/storage write.

### Template cache variants

Catalog and detail 200/304 responses with configured CORS always merge exactly
one `Vary: Origin` token for absent, allowed and hostile Origin. ACAO remains
exact-origin only. Canonical bytes, representation ETag, cache lifetime,
bodyless 304, pre-auth dispatch and zero service calls are unchanged. No Web
origin means no grant and no new mandatory variation.

### Sites and browser acceptance

Sites generic fallback serves root and accepted deep routes while missing
`/api/*` remains fail closed. Protected Sites source and build files do not
change.

GREEN requires typecheck, focused and nearest contracts, API ≥90/85, Web
≥85/80, build and Sites artifacts. Built Chromium must cover 1488×1058 and
390×844 ready/unavailable/mixed states, keyboard/focus/reduced motion, zero
serious/critical axe findings, clean console, direct/reload/back/forward/root
normalization and a complete network ledger. Root must not request the lazy
wallet-provider chunk, detail, recording, Coinbase, Open-Meteo, RPC, compiler
or verifier.

## Scope exclusions

There is no contract/domain schema, database, migration, Redis, dependency,
worker, CLI, Action, Docker, Caddy or deployment change. Caddy same-origin
routing remains Slice 027A. Focused local results are neither hosted CI nor
live/deployed evidence. Any production edit after candidate freeze invalidates
both required independent verifier reports.
