# Slice 001 coverage hardening RED evidence

Date: 2026-07-30

Role: Contract & Test Designer

Base production commit: `8d2cb49`

## Frozen boundary

This wave changes no production module, existing test/fixture, Sites worker, or visual
surface. It adds focused public-behavior tests, `axe-core`, and two explicit release
coverage configurations:

- backend/adapters/API/worker/CLI/Action: at least 90% lines and 85% branches;
- Web/React: at least 85% lines and 80% branches.

The existing pure contracts/domain gate remains unchanged at 100% statements,
branches, functions, and lines.

## Original release-gate RED

Before adding this wave, the repository-wide measurement was:

```text
npm run test:coverage
  23 files passed, 1 skipped
  211 tests passed, 1 skipped
  statements 82.89% (785/947)
  branches   75.70% (508/671)
  functions  81.06% (137/169)
  lines      84.58% (752/889)
```

The numeric release gate was therefore RED even though the previous behavioral suite
was green.

## Added contract coverage

- API malformed cursor/body/route, nested private-key rejection, project/share token
  scope, unauthorized opaque tokens, and stable service-error envelopes.
- PostgreSQL idempotent and ordered journal append, run-not-found rollback, command
  claim/empty/rollback, ordered multi-event completion, canonical artifact persistence,
  artifact/lease atomic rollback, stale completion, retry/dead behavior, and release.
- Worker all-live production composition, missing handlers, non-object failures,
  categorized default messages, and completion-before-log ordering.
- Live gate secret/timeout/runtime boundaries and validated handoff to the injected
  live runtime.
- GitHub Action replay/live upload order, every incomplete live-evidence branch, and
  exception redaction.
- FDC fee/schema/transport behavior, non-2xx verifier and DA behavior, raw DA schema
  variants, safe HTTP bounds/status/body/DNS/dispatcher behavior, public-address
  classification, exact five-sample preflight, and error/evidence redaction.
- Browser client privacy-mode storage, cursor recovery, non-JSON/JSON/transport errors,
  direct and nested wallet transactions, URL encoding, replay parsing, wrong chain,
  missing account, invalid tx hash, and rejected wallet transport.
- Live Run Surface immediate result, bounded polling success/failure/timeout, every
  scheme/host/path/query diagnostic mapping, project-token authorization, safe
  generation/export/replay/resume, deterministic command keys, and test adapter.
- React bundle mismatch/error, session token/resume, generation retry/redaction, both
  focus-wrap directions, explicit close focus restoration, evidence copy, mobile
  timeline behavior, and axe scans for cockpit and Consumer Lab.

## Coverage after focused tests

Because the new contract tests correctly expose production defects, the official
threshold commands remain RED. To measure the coverage contribution without hiding or
changing those tests, the same configs were run once with only the named failing
contract cases filtered at the CLI:

```text
backend passing-test subset
  18 files passed, 1 skipped
  207 tests passed, 11 skipped
  lines      99.12% (454/458)
  branches   95.39% (373/391)
  functions  98.59% (70/71)
  statements 98.95% (474/479)

web passing-test subset
  6 files passed
  53 tests passed
  lines      98.23% (223/227)
  branches   91.66% (187/204)
  functions  97.22% (70/72)
  statements 96.83% (245/253)

npm run test:core:coverage
  7 files passed
  72 tests passed
  statements 100%
  branches   100%
  functions  100%
  lines      100%
```

The filters were measurement-only commands. They are not committed scripts, do not
lower a threshold, and do not exclude any production file from either release config.

## Intended remaining RED defects

The full suite now has 335 passing tests, 12 failing contract cases, and one
environment-gated Testcontainers skip. The 12 cases represent five production defect
clusters:

1. The DA client accepts a valid-looking proof body returned with HTTP 503.
2. The Web2Json verifier client accepts `VALID` request bytes returned with HTTP 500.
3. The public-IP policy accepts RFC documentation IPv4 ranges (`192.0.2.0/24`,
   `198.51.100.0/24`, `203.0.113.0/24`) and deprecated site-local IPv6 (`fec0::/10`).
4. Preflight accepts any sample count instead of requiring exactly five.
5. The timeline puts `aria-label` on role-less `span` nodes, producing one serious
   `aria-prohibited-attr` axe violation across the six lifecycle stages.

The numbered list has five independently actionable defects; table-driven boundary
cases account for the 12 failing tests.

## Non-RED verification

```text
npm run typecheck
  passed

npm run build
  passed; Sites client/server/hosting artifacts emitted

npm run test:sites
  7 tests passed

git diff --check
  passed
```

The next implementer must change only production behavior required by these frozen
tests. No test, threshold, include scope, or axe rule may be weakened.
