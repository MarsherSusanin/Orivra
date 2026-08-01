# ADR 0015 — Composer finalization and draft recovery

## Status

Accepted for Slice 015B.

## Context

The editable Composer draft is intentionally more permissive than persisted run
evidence. Transform needs useful local feedback without implying that a remote
response was fetched or verified. Reload recovery must not turn local storage
into a credential store, and an uncertain create response must not create a
second run.

## Decision

One pure domain finalizer validates Source, Transform, Trust, submission mode,
and fee cap, then returns either stable field-path issues or the exact
`Web2JsonManifestV1` plus canonical JSON bytes. UI validation, preview,
analytics outcome, and submitted manifest all use this result.

`request.abiSignature` uses Flare's JSON ABI-parameter descriptor shape: a root
object with `name` and `type`, optional `internalType`, and recursively valid
`components`. Legacy Solidity-like shorthand is rejected. JSON object key order
and whitespace are normalized before persistence while component array order is
preserved.

The effective request query is built from the source URL and then overridden by
the explicit query editor. Duplicate query keys in the URL are rejected.
Finalization requires exact normalized host equality, segment-safe path-prefix
coverage, and equality between expected and effective query maps. This prevents
the Composer from knowingly producing a consumer policy that omits a
response-affecting request input.

The Web stores one strict V1 draft under a namespaced local key. Raw and decoded
values are bounded to 64 KiB. Unsupported versions, corrupt JSON, oversize data,
and schema-invalid values are rejected atomically; the user gets an explicit
fresh-start action. A valid existing draft wins over a template query parameter
until the user explicitly discards it. Storage denial or quota failure is
non-blocking and visible as a local-only status.

Draft persistence refuses recognized credential material: URL userinfo,
authorization/private-key/token value shapes, and credential-indicating query
keys. This is a deterministic guard for the public-source subset, not a claim
that arbitrary free-form secrets can always be detected. Full source-secret
inspection remains part of persisted preflight in Slice 016. Project/share
tokens, remote source responses, verifier data, tx hashes, and error stacks are
never inputs to the draft store.

Submit is an explicit action. A missing project token opens Connect without
validation or a request. An invalid explicit attempt emits one rejected
`MANIFEST_VALIDATED`; a valid attempt emits one accepted event and calls the run
creation port. While pending, duplicate actions are disabled. Failure preserves
the draft and its idempotency key. Reload does not submit. Explicit retry reuses
the same key. Success parses `CreateRunResultV1`, clears the draft, and derives
`/runs/:encodedRunId?step=preflight` from the validated `runId`; the response
`location` is never trusted as a navigation target.

No remote transform preview exists in 015B. The preview is labelled local-only,
and browser network guards permit only the persisted Proofline run endpoint.

## Consequences

The ETH/USD template has an immediate canonical preview; incomplete drafts show
missing-field guidance instead of invalid manifest JSON. Slice 017A can replace
the utilitarian mode and fee controls with the richer submission decision UI
without changing manifest or idempotency contracts. Slice 016 owns remote
samples, JQ execution evidence, ABI compatibility, registry evidence, and fee
quotes.
