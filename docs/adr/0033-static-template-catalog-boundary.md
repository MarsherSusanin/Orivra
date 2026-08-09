# ADR 0033 — Static immutable template catalog boundary

## Status

Accepted for the Slice 025 RED contract freeze.

## Context

The Composer currently recognizes one `eth-usd` query value inside the Web
bundle and constructs that draft locally. There is no public catalog contract,
no independently verifiable template provenance and no way to feature a useful
default without teaching API and browser surfaces separate manifest copies.
That duplication would let catalog metadata, a manifest digest and the manifest
submitted to `POST /v1/runs` drift apart.

Template discovery is public product configuration, not persisted run evidence.
It must not introduce a database, source-host fetch, dynamic registry, clock or
credential dependency. A template may help start a draft, but neither its title
nor provenance authorizes a run: the exact strictly parsed manifest remains the
only run authority.

## Decision

Proofline owns one versioned, statically compiled catalog in the pure domain
package. Catalog revision `1` contains exactly two immutable template revisions:

- featured/default `open-meteo-current-weather`, revision `1`;
- existing `eth-usd`, revision `1`, preserving the exact Slice 015 Coinbase
  manifest and the established `/runs/new?template=eth-usd` deep link.

Template IDs are lowercase slugs of 1–64 characters and revisions are positive
safe integers. `eth-usd` remains the canonical ID. Slice 025 adds no alias,
redirect, `Content-Location`, latest lookup or revisioned HTTP route.

The package boundary is explicit: strict schemas live in the effect-free
`@proofline/contracts/templates` feature entry and catalog/resolution in
`@proofline/domain/templates`. Existing root entries re-export the exact same
runtime identities for compatibility. Both packages retain `sideEffects:false`;
every module has effect-free initialization. The production worker imports
neither feature and a fresh bundled worker must receive zero output bytes from
both template leaves.

The cycle-free manifest boundary is
`@proofline/contracts/manifest`. It owns the Web2Json manifest schemas and
public URL/ABI helpers previously declared in the root barrel; the root
re-exports the same runtime identities. The contracts template feature imports
the relative manifest feature, never the root barrel, while the domain template
feature imports only `@proofline/contracts/templates` and
`@proofline/contracts/manifest`. A fresh worker retains non-zero manifest
runtime contribution but receives zero bytes from either template leaf.

The Open-Meteo template is the Coston2 replay-mode Berlin current-temperature
manifest. It uses HTTPS GET `https://api.open-meteo.com/v1/forecast` with the
exact query `latitude=52.52`, `longitude=13.41`,
`current=temperature_2m`, `temperature_unit=celsius`, `timezone=UTC` and
`forecast_days=1`. Its JQ is
`.current | {temperatureTenthsCelsius: (.temperature_2m * 10 | round), observedAt: .time}`
and its official JSON ABI parameter is one `data` tuple with an `int256`
`temperatureTenthsCelsius` followed by a `string` `observedAt`. Trust binds the
exact scheme, host, `/v1/forecast` path and complete query. Submission is replay
with fee cap `20000000000000000` wei.

The public contracts are strict and bounded:

- a summary identifies ID, revision, title, summary, provider, the closed
  `finance | weather` category, featured state, manifest SHA-256 and exact
  detail path;
- the catalog is an ordered page with featured/default
  `open-meteo-current-weather` first and `eth-usd` second;
- detail contains the matching summary as `template`, strict
  `Web2JsonManifestV1`, its exact canonical JSON and provenance exactly
  `{kind: "proofline-builtin", catalogRevision: 1, templateId,
  templateRevision, manifestSha256}`;
- the strict detail returned by pure resolution contains the reparsed manifest
  and exact canonical JSON; it is also the API detail representation.

The resolver reparses every untrusted contract value with
`Web2JsonManifestV1Schema`, canonicalizes that parsed value, recomputes
`sha256:<64 lowercase hex>` over the canonical UTF-8 bytes and requires exact
catalog, detail, provenance, ID, revision, source-host, path and digest
agreement. Mix-and-match summary/detail/canonical JSON/manifest/provenance
values fail closed.
Pure return values are defensive immutable snapshots. Catalog metadata and a
previously computed digest never substitute for this resolution.

The API exposes only anonymous exact `GET /v1/templates` and
`GET /v1/templates/:id`. Query strings are rejected. A detail response contains
the statically selected immutable revision `1`; it is not a latest lookup.
Unknown or malformed IDs receive one bounded `404` with `no-store`; unsupported
methods receive bounded `405`, `Allow: GET` and `no-store`. Public dispatch
happens before bearer parsing and never invokes PostgreSQL, worker, registry,
RPC, verifier, Relay, DA or source-host ports.

Each success body is the canonical JSON representation. Its strong ETag is the
SHA-256 of those exact response bytes, not the manifest digest. Success and
exact `If-None-Match` 304 use
`public, max-age=300, must-revalidate`; 304 repeats ETag, cache and applicable
exact-origin CORS. Server-to-server requests without `Origin` remain allowed
without a CORS grant, while an exact configured Web origin receives the same
origin authority as `/v1/networks`.

Web adds same-origin gallery and detail routes and a strict template client.
The client resolves detail again before producing a draft and performs no
browser request to Coinbase, Open-Meteo, documentation, RPC or compiler hosts.
The canonical Composer selection URL is
`/runs/new?template=<id>&revision=1`; the accepted legacy
`/runs/new?template=eth-usd` is normalized with `replaceState` to revision `1`.
An absent or mismatched revision is unavailable rather than silently selecting
another revision.

A valid saved Composer draft always wins. A requested template is shown as a
non-destructive pending choice and can replace that draft only after an explicit
confirmation. Replacement creates a new Composer idempotency key. Cancelling
preserves every saved byte. With no saved draft, a valid resolved template
creates the editable draft. On an unedited submission, `createRun` receives the
exact resolved manifest; after edits, the existing finalizer and
`Web2JsonManifestV1Schema` remain the sole authority. Public provenance is
bounded display metadata and is never copied into the run request.

An applied template becomes the authoritative current and persisted draft as
soon as it is created; later edits strengthen rather than weaken that authority.
A later template selection through click, direct URL, back or forward is always
a pending replacement and cannot overwrite those bytes without confirmation.
An asynchronous detail response may auto-apply only if its selection is still
current and no authoritative current or persisted draft exists when the response
settles.

Confirmed replacement is one state transition: it installs the newly resolved
draft and fresh idempotency key while clearing the old pending create intent,
submission error, validation errors, trust-dirty/validation state and pending
focus. Later authentication therefore cannot submit the replaced manifest or
key. While an authenticated `createRun` call is in flight, Review replacement
remains visible but disabled and cannot open the dialog or change draft bytes;
it becomes available only if that call settles without navigation to a run.

The replacement confirmation is a real modal focus boundary. Opening it focuses
`Keep saved draft`; Tab and Shift+Tab wrap between its controls. Escape closes
without changing the draft or pending URL selection and restores focus to
`Review replacement`.

The compatibility export `createEthUsdComposerDraft` is a thin adapter over
canonical `eth-usd` catalog resolution. It contains no second Coinbase URL,
JQ, ABI or manifest literal. It preserves the exact draft behavior and copies
only the caller's fresh `updatedAt` and `createIdempotencyKey` into the draft
derived from the resolved manifest.

## Consequences

The product gains a useful default without runtime discovery or a second source
fetch path. Catalog and detail responses are deterministic across processes for
one release, while short revalidation permits later release changes to the same
public URLs.

Slice 025 requires contracts/domain 100% statement and branch coverage,
API/client at least 90% lines and 85% branches, Web at least 85% lines and 80%
branches, and browser/Sites acceptance for direct routes, reload, back/forward,
desktop/mobile, keyboard, axe, console and network containment. A future
template revision, alias, remote catalog, persistence model or additional public
route requires a new frozen contract and, where the trust boundary changes, a
new ADR.

No PostgreSQL migration, Redis dependency, source response, credential, live
Coston2 effect, Docker/deployment behavior or hosted evidence is added.
