# Slice 018 corrective RED — verifier findings

The first frozen candidate `dcabb2b9d5cc6d975c090287f8ae57d3eba027c4`
received neither independent PASS. Core Verification found five restart and
trust-boundary gaps that the initial suite did not cover.

The corrective RED adds tests before production changes for:

- lease reclaim after an already persisted `RUN_RESUMED`;
- terminal recovery overriding stale retryable annotations;
- bounded recovery error evidence rejecting nested stacks, private URLs and
  token-like fields;
- exact persisted-manifest handoff to a newly keyed Composer draft;
- missing-middle journal detection and pagination beyond the 1000-event page.

Focused execution must fail on the pre-correction candidate for these exact
reasons. Existing no-rebroadcast, terminal immutability, share read-only and
redaction controls remain unchanged.
