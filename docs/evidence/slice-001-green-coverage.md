# Slice 001 coverage hardening GREEN evidence

Date: 2026-07-30

Role: GREEN hardening implementer

Frozen RED commit: `b82dd7d`

## Production changes

- Web2Json verifier preparation now rejects every non-2xx HTTP response before
  accepting `VALID` request bytes. The normalized transport error is retryable,
  includes the operation, endpoint, and status code, and never includes the API key.
- Raw DA proof retrieval now rejects every non-2xx HTTP response before accepting a
  proof-shaped body. The retryable transport evidence includes only the operation,
  endpoint, voting round, and status code; request bytes are not retained.
- The SSRF address policy rejects the three RFC documentation IPv4 ranges and the
  deprecated IPv6 site-local `fec0::/10` range in addition to the existing private,
  loopback, link-local, multicast, mapped, and documentation restrictions.
- Web2Json preflight now requires exactly five determinism samples and emits
  `PREFLIGHT_SAMPLE_COUNT_INVALID` before DNS, HTTP, verifier, or fee-oracle I/O.
- Lifecycle state indicators use an accessible image role for their existing labels,
  removing the serious `aria-prohibited-attr` violation without changing layout or
  visible content.

No frozen test, fixture, coverage configuration, threshold, Sites worker, or visual
style was changed.

## Release gates

```text
npm test
  33 files passed, 1 environment-gated file skipped
  347 tests passed, 1 environment-gated test skipped

npm run test:coverage:backend
  18 files passed, 1 environment-gated file skipped
  217 tests passed, 1 environment-gated test skipped
  statements 98.97% (483/488)
  branches   95.30% (386/405)
  functions  98.59% (70/71)
  lines      99.14% (463/467)

npm run test:coverage:web
  7 files passed, 55 tests passed
  statements 96.83% (245/253)
  branches   91.66% (187/204)
  functions  97.22% (70/72)
  lines      98.23% (223/227)

npm run test:core:coverage
  7 files passed, 72 tests passed
  statements 100% (227/227)
  branches   100% (89/89)
  functions  100% (28/28)
  lines      100% (216/216)

npm run test:integration
  18 files passed, 1 environment-gated file skipped
  217 tests passed, 1 environment-gated test skipped

npm run test:postgres
  3 files passed, 1 Testcontainers file skipped because
  PROOFLINE_TESTCONTAINERS was not enabled
  22 tests passed, 1 environment-gated test skipped

npm run test:solidity
  3 files passed, 31 tests passed

npm run test:e2e
  1 file passed, 2 tests passed

npm run typecheck
  passed

npm run build
  passed; dist/client/index.html, dist/server/index.js, and
  dist/.openai/hosting.json emitted

npm run test:sites
  7 tests passed

git diff --check
  passed
```

The backend coverage command was rerun in isolation after a simultaneous core
coverage process removed Vitest's shared parent `coverage` directory. The isolated
official command passed with the results above; no configuration was altered.
