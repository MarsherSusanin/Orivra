# ADR 0022 — Local deterministic product QA report

## Status

Accepted for Slice 021B.

## Context

Slice 021A already provides strict privacy-safe events, a bounded local queue and
a deterministic funnel reducer. The reducer is not a public contract, its output
cannot be exported byte-identically, and invalid or recovered queue state is not
visible to QA/CI.

## Decision

`ProductQaReportV1` is a strict aggregate-only public contract. It never includes
raw events, session IDs, timestamps, URLs, manifest data, transaction hashes or
credentials. It reports retained event count, healthy/recovered/unavailable queue
state, valid and invalid session counts, completion/failure/resume counts and the
fixed ordered funnel steps.

One browser analytics session may contain recoverable attempts. Rejected manifest,
preflight or replay outcomes may be followed by a later accepted retry without
erasing prior valid progress. A new `COMPOSER_STARTED` after a completed journey
starts another journey within the same session rather than invalidating historical
completion. Structurally out-of-order evidence remains invalid and is counted.

The domain owns canonical report serialization. Identical retained evidence and
queue status produce identical bytes; there is no wall-clock generation field.
The local adapter exposes a non-throwing export method. There is no external
analytics provider, network transport or user-facing analytics dashboard.

## Consequences

Property tests cover ordering, retries, repeated/interleaved journeys, queue bounds,
corruption and byte determinism. Reporting failure must never block the product
journey. No persistence migration or third-party SDK is introduced.
