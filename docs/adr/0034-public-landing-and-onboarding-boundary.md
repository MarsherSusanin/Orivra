# ADR 0034 — Public landing and onboarding boundary

## Status

Accepted for the Slice 026 RED contract. Production implementation and the two
independent verification reports are pending.

## Context

Proofline already has anonymous static template and canonical URL attack demo
surfaces, but `/` still falls through to authenticated run discovery. Arbitrary
unknown paths fall through to the same Runs state. A visitor therefore cannot
understand the product without entering a wallet-aware surface, while a typo
can look like a valid route.

The landing page must explain the persisted Proofline journey without becoming
a second authority for a template manifest, recording, run or source response.
It must also consume the two existing anonymous contracts independently: an
unavailable optional recording must not hide the static template starting
point, and a catalog failure must not hide accepted persisted demo evidence.

Slice 025 verification also found one nonblocking cache-variant defect. When a
Web origin is configured, cacheable template responses grant CORS only to the
exact origin, but absent- and hostile-Origin 200/304 variants omit
`Vary: Origin`. A shared cache could reuse a non-granted variant for the
configured browser origin. Slice 026 corrects that public cache boundary before
any shared cache is introduced.

This decision refines aggregate-only product instrumentation from ADR 0022 and
consumes the immutable evidence and static catalog boundaries from ADR 0032 and
ADR 0033. It supersedes none of them.

## Decision

### Routes and shell

`/` is the only landing route; `/home` is not an alias. On root, search and hash
are discarded with `history.replaceState({}, "", "/")` before any read,
storage access, analytics emission or rendering of their values. Root mounts no
wallet session provider and ignores injected project/share authority. The
existing explicit `AppProps.runId` remains an authoritative test composition
override even when the test location is `/`; production main supplies none.

The accepted routes `/runs`, `/runs/new`, `/runs/:id`, `/settings`, `/templates`,
`/templates/:id` with its accepted optional trailing slash, and exact
`/demo/canonical-url` keep their existing query and authority semantics.
Arbitrary-path fallback is removed. An unknown route shows only:

- heading `Page unavailable`;
- body `This Proofline route is not available in this build.`;
- `Go home` to `/` and `Open runs` to `/runs`.

This is an honest client UI state, not an HTTP 404 claim. `/home`, nested
template paths and `/demo/canonical-url/` remain unknown.

The Sidebar brand retains accessible name `Proofline home` and links to `/`;
Runs remains `/runs`. Landing has no active rail item. The public Topbar shows
breadcrumb `Overview`, Coston2 and Web2Json, without a proof or run status.

### Public data and trust

Landing performs exactly two independent anonymous, bodyless, same-origin GETs
with `credentials: "omit"`:

1. `/api/v1/templates`, through the existing
   `createTemplateCatalogClient().listTemplates()` boundary;
2. `/api/v1/demo/canonical-url`, through the existing
   `createCanonicalUrlAttackDemoClient().getSummary()` boundary.

There is no new endpoint, schema, package, dependency, database row or product
event. The two regions settle independently and normalize transport or strict
schema failure to their own unavailable state. App-owned request references
deduplicate landing remounts during same-App popstate navigation; a document
reload may revalidate.

The featured identity comes only from a strictly parsed catalog entry whose
`featured` field is true. Landing loads no detail and builds no manifest. Its
exact Composer target is
`/runs/new?template=<encoded-id>&revision=<revision>&step=source`; the accepted
Composer catalog/detail parse and canonical digest checks remain the final
template authority. Landing reuses the existing summary presentation and its
path construction. It contains no fallback catalog/domain constant, provider
URL, title/provider literal, manifest digest, ABI, JQ or manifest copy.

The demo region consumes only the bounded public summary. Availability means
historical persisted evidence is configured; it is not a live landing request.
Landing never loads the recording download or requested URL. It does not call a
wallet/session/network capability, run, source, RPC, compiler, verifier or
provider host and does not create provider anchors, preconnect, DNS prefetch,
prefetch or service-worker cache work.

### Exact content and honest states

The hero is:

- label `Coston2 · Web2Json consumer assurance`;
- heading `Trust the intended URL, not only a valid proof.`;
- lead `Proofline verifies the consumer’s scheme, host, path, and query, then packages reproducible evidence and safe Solidity.`;
- dominant `Browse templates` to `/templates` and secondary `Open runs` to
  `/runs`.

The neutral ordered journey is headed `From proof to integration evidence` and
contains:

1. `Proof available` — `Shown only after the persisted proof stage completes.`
2. `Verify consumer` — `Check scheme, host, path, and query invariants.`
3. `Generate safe consumer` — `Turn evidence-backed findings into deterministic Solidity.`
4. `Open integration package` — `Export the receipt, bundle, manifest, and consumer together.`

These explanatory steps never render as completed evidence.

The featured region is headed `Featured starting point`. Loading copy is
`Loading featured template…`. Ready content is the shared response-derived
summary card and `Use template`. Failure becomes `Featured template
unavailable`, `The built-in catalog could not be verified. No template manifest
was substituted.`, and `Open blank Composer` to `/runs/new?step=source`.

The demo region label is `Canonical URL attack`. Loading copy is `Checking
canonical attack evidence…`. Ready content shows `Persisted evidence available`,
the exact summary statement `Valid proof ≠ trusted URL`, bounded recorded time
and run/outcome counts, and `Inspect evidence` to `/demo/canonical-url`.
Failure becomes `Verified recording unavailable`, `No verified persisted
recording is available for this deployment. Proofline does not substitute a
fixture or synthetic result.`, and `View availability details` to the same
demo route.

Expected absence/unavailability is neutral, not an alert, and never implies
proof or template readiness. Landing copy excludes `live demo`, `current
temperature`, `production ready`, `hosted` and `deployed` claims.

### Cache variant correction

When `publicWebOrigin` is configured, every cacheable template catalog or detail
200 and exact 304 response varies on `Origin`, including absent, configured and
hostile Origin requests. `Vary` is merged and contains the Origin token exactly
once. `Access-Control-Allow-Origin` appears only for the exact configured
origin. Canonical response bytes, strong representation ETag, bodyless 304,
`public, max-age=300, must-revalidate`, dispatch before bearer parsing and port
silence remain unchanged. With no configured Web origin, no CORS authority or
mandatory Origin variation is introduced. Errors and preflight retain their
accepted contracts.

### Metrics and accessibility

Root produces no view, impression, click, template or demo analytics event and
no third-party beacon, SDK, session or queue write. Existing
`COMPOSER_STARTED {entryPoint: "direct"}` begins only when Composer actually
starts and contains no template identity or URL.

Landing has one main and one H1, labelled regions, DOM order equal to visual
order, polite bounded loading status and visible focus. It adds no modal,
carousel or autoplay. The accepted graphite/cyan/green/amber shell, 172px rail
and 85px topbar remain at desktop; mobile preserves the fixed-navigation safe
area, 44px controls, wrapping, viewport-bounded scrolling and reduced motion.

## Consequences

Proofline gains a token-free first explanation and useful starting point while
preserving the existing manifest, recording and persisted-run authorities.
Independent failure is honest and cannot silently substitute a sample.
Unknown routes no longer masquerade as Runs.

Slice 026 changes Web and API behavior but not public schemas, contracts/domain,
PostgreSQL, Redis, worker, CLI, Action, Docker or Caddy. Sites remains a
compatibility package with generic SPA fallback and fail-closed `/api`. The
affected gates are API ≥90% lines/85% branches, Web ≥85%/80%, build/Sites and
real-browser desktop/mobile, keyboard, axe, console/network and history checks.
No credential, live Coston2, hosted or deployed evidence is produced.
