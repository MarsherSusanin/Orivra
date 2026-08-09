# Slice 023C1 corrective RED — verifier findings

## Rejected candidate

- Commit: `33238899e0d2ea3d1627268a2f1c9253a83a4b1a`
- Tree: `ca021aa35cbb3db265ae32f8eb486639e3168139`
- Core Code Verification: FAIL.
- Product Integration Verification: FAIL.

Both verifiers independently reproduced an affected-module branch coverage
failure and a non-terminal close. Product verification additionally proved that
the regex-based HTTP code parser can reflect an attacker-controlled
`PROJECT_<64 uppercase hex>` value through the public error `code` field.

## Frozen corrections

The two original RED files remain unchanged. Corrective tests add only the
confirmed trust-boundary decisions:

1. `close()` remains terminal after every later existing public action, with no
   storage or service effect.
2. HTTP codes come from the explicit status-compatible ADR allowlist. The
   untrusted envelope contributes only `error.code`; every other field is
   discarded. Unknown, overlong, lowercase, secret-shaped and mismatched codes
   fall back to `HTTP_<status>` without attacker bytes, while extras do not
   invalidate an otherwise safe code.
3. Decision-useful client/controller branches cover base and request input,
   response parsing, malformed HTTP, retry evidence, storage denial,
   invalid-authority recovery, stale success/failure, single-flight,
   sign-out/retry/forget and terminal paths.

Future quota codes remain out of scope. The controller has no subscription API,
so the correction does not invent one.

## Intentional semantic RED

```text
npx vitest run \
  src/services/slice023c1-wallet-access-corrective.contract.test.ts \
  src/services/slice023c1-wallet-session-controller-corrective.contract.test.ts \
  --reporter=dot
```

Observed on the rejected production candidate:

```text
Test Files  2 failed (2)
Tests       5 failed | 47 passed (52)
```

Four failures are the bounded error-code poison table. One failure proves that
post-close `forgetBrowser` still removes storage and `cancelPending` replaces
the closed state. Safe `REQUEST_FAILED` survives untrusted extra fields while
their message, stack and secrets remain absent from the thrown error. All other
new cases are green against the existing candidate; there are no incidental
failures.

## Coverage evidence

The rejected candidate's original affected-only command reports:

```text
All new modules       89.47% lines / 73.23% branches
wallet-access-client  95.34% lines / 81.35% branches
session-controller    85.91% lines / 67.46% branches
```

This is below the required branch gate even though aggregate Web coverage is
green. Running the original tests plus every currently green corrective case
(excluding only the two semantic RED test names) reports:

```text
Test Files  4 passed (4)
Tests       57 passed | 10 intentionally filtered cases
All new modules       100% lines / 93.66% branches
```

This filtered measurement is branch-design evidence, not a GREEN or coverage
PASS. After production correction, the full four-file affected command must
run without exclusions and meet at least 85% lines and above 80% branches.

## Scope and baseline

`npm run typecheck` remains green. The nearest unchanged 023A contracts and Web
transport/product-entry tests remain the baseline recorded in the original RED
evidence. No production, public schema, dependency, React, browser, build,
Sites or full repository change is part of this correction.
