# ADR 0016 — Public preflight report boundary

## Status

Accepted for Slice 016.

## Context

Proofline already persists `preflight-evidence`, but that artifact contains
request bytes, calldata, quoted value and resolved transaction targets. It is a
private operational input for wallet and relayer flows, not a safe product
report. The existing preflight also throws on nondeterminism, ABI mismatch and
fee-cap failure, so the user cannot inspect a durable blocked verdict.

Replay bundles do not contain the five original transformed samples. Registry
resolution and fee reads currently use independent latest-block reads, which is
not a defensible network snapshot.

## Decision

Proofline persists two different artifacts:

- `preflight-evidence`: private submission material, never returned by a public
  report endpoint;
- `preflight-report-v1`: strict, redacted, checksummed evidence for product,
  share and replay surfaces.

The report is derived from five real samples. Each transformed result is
canonical-JSON serialized before SHA-256 fingerprinting, so object key order is
irrelevant while values, types and array order remain significant. JSON shape
is represented by bounded path/type nodes and contains no scalar values.

Nondeterminism, ABI incompatibility, fee-cap failure and manifest Trust mismatch
become a persisted blocked report rather than an exception. Static secret, URL,
SSRF, verifier transport and RPC failures continue through normalized failure
handling and never produce partial reports. This preserves the invariant that
all five published fingerprints correspond to actual samples.

The live adapter obtains one block number before registry resolution. Every
registry address read and the fee quote use that exact block. The snapshot
records the registry, `FdcHub`, fee configuration, `FdcVerification` and `Relay`.

Replay accepts only a separately recorded `PreflightReportV1` sidecar. The
worker validates its manifest-derived request identity, canonical URL, fee cap,
resolved `FdcHub` and bundle preflight evidence before persisting it for the new
run. Missing or mismatched sidecars fail closed. Replay never invents sample
fingerprints and never performs live fetch/RPC.

The API reads canonical artifact bytes, recomputes the digest, parses the public
schema, and verifies `report.runId` before returning. Artifact metadata is not
trusted. A partial unique PostgreSQL index enforces one report per run.

## Consequences

Ready and attention outcomes keep the existing compact `PREFLIGHT_ACCEPTED`
event and private evidence. Blocked outcomes terminate the preflight stage and
cannot enqueue submission. Older runs without a report stay readable but return
an explicit unavailable state; they are never silently refetched or backfilled.
The Workbench can render one truthful persisted object without access to wallet
or relayer material.

