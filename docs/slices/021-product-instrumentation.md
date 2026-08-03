# Slice 021 — Privacy-safe product instrumentation

## User outcome

Proofline can measure whether the product journey succeeds without adding an external analytics dependency or leaking manifest/network evidence.

## Scope

### Foundation 021A

- `ProductEventV1` and `ProductAnalyticsPort.emit`.
- Explicit events for composer, manifest, preflight, submission, proof, consumer failure, safe codegen, bundle replay, and resume.
- Test collector plus a bounded versioned local queue.

### Reporting 021B

- Strict aggregate-only `ProductQaReportV1` with deterministic canonical bytes.
- Retry- and repeated-journey-aware funnel reducer with explicit invalid-session accounting.
- Non-throwing local export for QA/CI; no raw events, session identifiers or timestamps.
- Corrupt local state fails closed and analytics failure never blocks the product flow.

## Delivered public API

- `ProductQaReportV1Schema` rejects extra privacy-sensitive fields and invalid
  counter arithmetic.
- `reduceProductQaReport(events, queueStatus)` handles accepted retries,
  repeated journeys, duplicate events, consumer failure and resume evidence.
- `canonicalSerializeProductQaReport(report)` produces byte-identical canonical
  JSON without a clock-dependent field.
- `LocalProductAnalytics.exportQaReport()` returns only aggregates and preserves
  the queue state `healthy`, `recovered` or `unavailable`.

This remains a QA/CI export. There is no analytics dashboard, network transport
or third-party analytics SDK.

## Frozen privacy contract

- Event metadata is a strict enumerated object and cannot include URL, manifest, query values, tokens, transaction hashes, private keys, response bodies, or error stacks.
- Events are emitted from user actions or confirmed domain transitions, never from React render or hydration-only effects.
- Queue key is versioned, contains at most 500 events, and discards the oldest events first.
- No network transport or third-party SDK is introduced.

## RED acceptance

- Schema and property tests reject extra/sensitive fields and invalid event order.
- Component tests prove one event per action across rerenders and Strict Mode.
- Queue tests cover bounds, corruption, storage denial, and stable export bytes.
- Funnel tests cover partial, resumed, failed, duplicated, and complete sessions.
- Property tests cover retries, repeated/interleaved journeys and byte determinism.

## Risk class

Privacy-sensitive local telemetry. No production network or persistence migration.
