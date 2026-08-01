# Slice 015 — Manifest Composer

## User outcome

A developer can start from the ETH/USD template or import a manifest, complete
Source → Transform → Trust → Submit in four clear steps, recover the local
draft after reload, and create exactly one persisted Web2Json run.

## Scope

### 015A — Source and Trust

- Public HTTPS GET source URL and key/value query editor.
- Expected `https` scheme, normalized host, path prefix, and expected query.
- ETH/USD template using Coinbase's unauthenticated spot-price endpoint.
- Strict JSON manifest import with field-level errors.
- Browser code never fetches the arbitrary source URL.

### 015B — Transform and Draft

- JQ and ABI signature editors plus canonical manifest JSON preview.
- Strict, versioned, bounded local draft with reload recovery and explicit reset.
- Corrupt or old drafts are rejected as a whole and can be discarded safely.
- Completing Submit validates once, creates one run through the existing
  idempotent API client, clears the successful draft, and opens `/runs/:id`.
- `MANIFEST_VALIDATED` is emitted once per explicit validation result.

Excluded: browser source fetch, remote transform preview, preflight samples,
fee quote, wallet/relayer execution, and any new API or PostgreSQL endpoint.

## Frozen contracts

- `Web2JsonManifestDraftV1` is a strict local envelope with version, current
  Composer step, draft manifest fields, `updatedAt`, and create idempotency key.
- Draft bytes are capped at 64 KiB. Tokens, credentials, source responses,
  headers, bodies, verifier data, tx hashes, and error stacks are not fields.
- The public `Web2JsonManifestV1Schema` remains the final validator.
- Explicit query-map values override duplicate query keys embedded in the URL.
- Canonical preview is byte-deterministic and excludes draft metadata.
- Template source is `https://api.coinbase.com/v2/prices/ETH-USD/spot`, with
  transform output shaped for a string amount and currency. The endpoint is
  documented as unauthenticated by Coinbase; Proofline still delegates all
  remote access to server-side preflight.

## RED acceptance

- Contracts reject old/extra/oversized/corrupt drafts and unsafe manifests.
- Property tests prove draft round-trip, canonical preview determinism, query
  precedence, and secret-field exclusion.
- Component tests cover template, import, inline validation, step gating,
  reload recovery, reset, storage denial, create rejection, double-click, and
  one successful create/navigation.
- Network guards prove no browser call targets the source host.
- Browser acceptance covers desktop `1488×1058` and mobile `390×844`, keyboard,
  focus, back/forward/reload, no serious/critical axe findings, and clean console.
- Production artifact tests reject source-fetch code paths and draft secrets.

## Dependencies and risk

- Reuses `Web2JsonManifestV1Schema`, canonical JSON, URL canonicalization, the
  existing run client, and Product Analytics from Slice 021A.
- ADR [0014](../adr/0014-local-composer-draft-boundary.md) owns draft trust,
  query precedence, and the one-create boundary.
- Risk class: local persistence and run creation. No custody, relayer, FDC
  network, PostgreSQL migration, or Solidity behavior changes.

