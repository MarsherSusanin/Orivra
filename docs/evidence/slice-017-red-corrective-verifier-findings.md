# Slice 017 corrective RED — verifier findings

## Frozen rejected candidate

- Parent commit: `fbbc93b24006fa6aa5c196a583b5b2f15f4d162b`
- Parent tree: `9fa37f64c67158a856c194fb6e8584e9e7d64614`
- Scope: tests and this evidence record only; production sources, public
  schemas, migrations, package manifests and release artifacts are unchanged.

This corrective wave converts the independent verifier findings into focused
behavioral contracts before another production-author wave. It does not weaken
the frozen Slice 017 public schemas or rerun the full repository matrix.

## Focused RED

Command:

```text
npx vitest run \
  packages/cli/test/submission-readiness.contract.test.ts \
  packages/cli/test/slice017-submission-response-hardening.contract.test.ts \
  src/services/slice017-wallet-recovery.contract.test.ts \
  packages/action/test/slice007-release-validation-coverage.test.ts \
  --reporter=verbose
```

Observed result:

```text
Test Files  3 failed | 1 passed (4)
Tests       11 failed | 28 passed (39)
```

All 11 failures are intentional and semantic:

- The production CLI rejects the real `409` `PREFLIGHT_NOT_READY` response
  instead of retrying the same submission command, so the success and bounded
  timeout paths fail. Its superseded `404` special case still retries instead
  of failing closed.
- The CLI accepts six invalid successful submission bodies: missing or wrong
  version, wrong run identity, wrong requested mode, wrong effect owner and a
  malformed Coston2 wallet transaction.
- The CLI also accepts an unknown-field response containing unsafe raw values,
  rather than rejecting it with a sanitized submission-response error.
- Browser wallet recovery recognizes rejection text but not the normative
  EIP-1193 numeric `code: 4001`; it therefore leaves the pending probe and
  prevents a safe retry of the same run.

The 28 green discriminators prove that strict wallet, relayer and replay happy
paths remain expressible, the exact validated wallet transaction reaches the
local signer, non-`4001` ambiguous provider failures retain the marker and fail
closed, and the Action already retries a `409` readiness code with one stable
command identity.

## Nearest unchanged controls

Command:

```text
npx vitest run \
  packages/contracts/test/slice017-submission-response.contract.test.ts \
  packages/cli/test/production-adapter.contract.test.ts \
  packages/cli/test/production-adapter-coverage.test.ts \
  packages/cli/test/slice005-readiness-branch-coverage.test.ts \
  src/services/run-client.test.ts \
  src/services/run-client-hardening.test.ts \
  --reporter=dot
```

Observed result:

```text
Test Files  6 passed (6)
Tests       52 passed (52)
```

`npm run typecheck` and `git diff --check` pass. No full suite, coverage run,
browser acceptance or live network gate was run in this RED wave.

## Frozen implementation contract

The next production author must preserve one deterministic idempotency key for
all retries of a CLI submission command, retry only `409` plus the stable
`PREFLIGHT_NOT_READY` code until strict success or the bounded deadline, parse
the full `SubmissionResponseV1Schema`, verify requested run and mode identity,
return only the validated wallet transaction for wallet mode and the validated
envelope for relayer/replay, and surface no raw response data.

Numeric EIP-1193 `4001` is a user rejection regardless of message: remove only
the pending probe, never attach, and allow the same run to retry. Other
ambiguous send failures retain the probe and continue to refuse rebroadcast.
