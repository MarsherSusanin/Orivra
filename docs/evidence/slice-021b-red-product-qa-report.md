# Slice 021B RED — deterministic local Product QA report

## Frozen base

- Commit: `24957228b59b32f0df2d77b902cd177af0489c4b`.
- Tree: `e2813a3eafec08b28f3b88f780e33a5ca1b91e28`.
- Role: independent Contract & Test Designer.
- Scope: public-contract, domain/property, local queue/export tests and this
  evidence only. No production implementation was added.

## Frozen public API

- `ProductQaReportV1Schema` and inferred `ProductQaReportV1` belong to
  `@proofline/contracts`.
- `reduceProductQaReport(events, queueStatus)` produces the aggregate.
- `canonicalSerializeProductQaReport(report)` produces canonical JSON bytes.
- `LocalProductAnalytics.exportQaReport()` is non-throwing and returns those
  aggregate-only canonical bytes.

`ProductQaReportV1` is strict at every level. It contains only:

- version `1`;
- queue status `healthy | recovered | unavailable` and a retained count from
  zero through 500;
- session and journey counters for observed, valid, invalid, completed,
  consumer-failed and resumed evidence;
- exactly nine ordered funnel rows in the current `FUNNEL_STEPS` order, each
  containing only its name plus session and journey counts.

Arithmetic refinements require observed counts to equal valid plus invalid,
outcome counters not to exceed valid evidence, journey aggregates to cover
their session aggregates, step counts not to exceed valid aggregates, and an
unavailable queue to retain zero events. Raw events, identifiers, timestamps
and extra fields are rejected.

## Frozen reducer semantics

- Rejected manifest, preflight or replay evidence may be retried and accepted
  inside the same journey without erasing prior progress.
- Duplicate events count once at both session and journey levels.
- Consumer failure is an optional branch after proof and may continue through
  safe codegen and byte-identical replay.
- `RUN_RESUMED` alone is a valid, non-completed journey.
- A new composer after completed replay starts another journey in the same
  session. A second composer before completion is invalid structural evidence.
- Backward per-session timestamps are invalid.
- Cross-session interleaving does not affect the aggregate or canonical bytes.
- Property tests cover cloned/regrouped evidence for 1–12 complete sessions
  across 50 generated runs.

## Frozen queue/export semantics

- Null and valid persisted state report `healthy`.
- Corrupt persisted state reports `recovered` for the entire adapter lifetime,
  including after later valid emits.
- Storage denial reports `unavailable` with zero retained events and never
  throws into the product flow.
- The newest 500 events are retained; older events are trimmed.
- Export contains no raw events, session IDs, timestamps, URLs or credentials.

## RED evidence

```text
npm run typecheck
```

Result: PASS.

```text
npx vitest run packages/contracts/test/slice021b-product-qa-report.contract.test.ts packages/domain/test/product-qa-report.contract.test.ts --reporter=verbose
```

Result: expected RED, `4` failed and `42` gated/skipped. Every failure is an
intentional missing production contract/API:

1. `ProductQaReportV1Schema production export is missing`;
2. `reduceProductQaReport production export is missing`;
3. `canonicalSerializeProductQaReport production export is missing`;
4. `LocalProductAnalytics.exportQaReport production API is missing`.

The 42 schema, arithmetic, reducer, property and queue/export cases are gated
only until their corresponding public exports exist. They must not be weakened
or removed to reach GREEN.

Existing 021A neighbor evidence remains green:

```text
npx vitest run packages/contracts/test/public-contracts.test.ts packages/domain/test/product-analytics.contract.test.ts packages/domain/test/product-analytics.remediation.test.ts packages/domain/test/product-analytics.test.ts --reporter=dot
```

Result: `4` files PASS, `59/59` tests PASS.
