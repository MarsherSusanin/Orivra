# Slice 021 — Privacy-safe product instrumentation

## User outcome

Proofline can measure whether the product journey succeeds without adding an external analytics dependency or leaking manifest/network evidence.

## Scope

### Foundation 021A

- `ProductEventV1` and `ProductAnalyticsPort.emit`.
- Explicit events for composer, manifest, preflight, submission, proof, consumer failure, safe codegen, bundle replay, and resume.
- Test collector plus a bounded versioned local queue.

### Reporting 021B

- Deterministic funnel reducer and exportable QA/CI report.
- Corrupt local state fails closed and analytics failure never blocks the product flow.

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

## Risk class

Privacy-sensitive local telemetry. No production network or persistence migration.

