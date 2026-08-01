# ADR 0014 — Local Composer draft and one create boundary

## Status

Accepted for Slice 015.

## Context

The Manifest Composer needs reload recovery before infrastructure deployment,
but a browser draft is not trusted run evidence. It must not contain project
tokens, source responses, credentials, verifier output, or any server-derived
preflight result. The same source URL can contain query parameters while the
manifest also has an explicit query map, so their precedence must be stable.

## Decision

Proofline stores one versioned `Web2JsonManifestDraftV1` envelope in local
storage. The draft contains only user-authored manifest fields, its current
Composer step, and a monotonically updated ISO timestamp. Decoding is strict:
unknown versions, schema-invalid data, oversized data, and corrupt JSON are
discarded without partial recovery. Storage denial never blocks the current
in-memory editing session.

Canonical manifest construction is a pure domain operation. Query values from
the explicit manifest query map override same-named values already present in
the source URL. Canonical JSON preview uses the repository canonical serializer;
it never includes local draft metadata.

The browser never fetches the arbitrary source URL. Completing the Composer
validates the strict public manifest, emits the bounded product event, and calls
the existing `POST /v1/runs` boundary once with an idempotency key stable for the
validated draft. A successful create clears the draft and navigates to the
persisted run. A rejected or interrupted request preserves the draft and the
same idempotency key for a safe retry.

## Consequences

Draft recovery is useful but is not evidence and cannot unlock submission. A
remote transform preview remains unavailable until Slice 016 persists a
preflight report. The API and PostgreSQL schemas do not change in Slice 015.

