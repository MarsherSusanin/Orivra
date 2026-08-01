# Slice 016 — Preflight evidence

## User outcome

After creating a run, a developer sees a persisted answer to one question:
"Is this exact Web2Json request ready to submit?" The answer is backed by five
determinism samples, ABI evidence, a single-block registry/fee snapshot, and
bounded remediation. A blocked result never reaches submission.

## Scope

### 016A — Evidence contract and persistence

- Add strict `PreflightReportV1` and redacted JSON-shape contracts.
- Produce five ordered fingerprints from canonical transformed JSON.
- Persist the public report separately from private submission evidence.
- Add one report per run, checksum verification, project/run-share read access,
  and `GET /v1/runs/:id/preflight`.
- Resolve registry addresses and the fee quote at one fixed Coston2 block.
- Replay requires a recorded, validated report sidecar; it never fabricates
  samples or performs live source/RPC access.

### 016B — Preflight Workbench

The reading order is fixed:

1. Verdict and one dominant next action.
2. Fee/cap and request identity.
3. Five sample fingerprints.
4. Redacted response/JQ shape and ABI evidence.
5. Security findings and remediation.

`blocked` cannot continue to submission. `attention` remains actionable but
explicitly calls out bounded evidence such as a truncated shape. The layout is
React DOM/CSS; mobile becomes one sequential list. No chart library, browser
source fetch, raw response, or decorative visualization is added.

## Public contract

`PreflightReportV1` contains:

- `version`, `runId`, `verdict`, `canonicalUrl` and `requestIdentitySha256`;
- exactly five ordered `sampleFingerprints`;
- determinism pass/fail and the exact distinct-fingerprint count;
- redacted, bounded response and transformed JQ shapes;
- ABI compatibility, five checked samples, optional encoded size/checksum;
- Coston2 chain `114`, one block number, registry, `FdcHub`, fee configuration,
  `FdcVerification`, and `Relay` addresses;
- quoted fee, manifest cap and `withinCap`;
- enumerated blockers and bounded diagnostics whose evidence can reference only
  report field names.

All fingerprints/checksums are lowercase `sha256:<64 hex>`. A ready or attention
report has no blockers. A blocked report has at least one blocker. Nondeterminism,
ABI incompatibility, fee-cap failure, or Trust mismatch requires the matching
error diagnostic. A truncated shape produces attention, not a blocker.

No report contains request bytes, calldata, raw scalar values, headers, pinned
IP/DNS evidence, tokens, transaction hashes, error stacks, or private adapter
state. Canonical report bytes are capped at 64 KiB.

Static URL/secret/SSRF rejection happens before remote or RPC I/O and follows the
existing normalized failure path; no partial or invented report is stored. A
blocked report is produced only after five real samples exist.

## Persistence and API

- Private `preflight-evidence` remains the only submission input.
- Public `preflight-report-v1` is a separate canonical artifact.
- A partial unique index permits at most one public report per run.
- `PREFLIGHT_ACCEPTED` remains compact and unchanged.
- Ready/attention atomically persist the accepted event, private evidence,
  public report, and allowed child commands.
- Blocked atomically persists the public report plus terminal preflight failure;
  it persists no private submission evidence or submission child command.
- Retryable transport/verifier/RPC failures store neither partial report nor
  terminal event.

`GET /v1/runs/:id/preflight` returns the parsed report after verifying canonical
bytes and stored SHA-256. A project token is project-scoped. A share token is
read-only and valid only for its own run. Missing/foreign runs return the
existing not-found contract; pending and legacy-unavailable reports are
distinguished; corrupt artifacts fail closed.

## Acceptance

- Contracts/domain remain at 100% statements and branches.
- Fingerprints are invariant to JSON object-key order and sensitive to values,
  types, array order and mutation.
- Shapes never contain scalar values and remain deterministic/bounded.
- All five live samples are fetched through the existing SSRF-safe adapter.
- Registry and fee reads use one explicit block number.
- Replay uses only a recorded sidecar bound to manifest, request identity,
  canonical URL, fee and resolved `FdcHub`.
- Migration `004` passes empty, previous-schema and idempotent Testcontainers
  runs; a second report for the same run is rejected.
- Browser acceptance covers ready, attention and blocked at `1488×1058` and
  `390×844`, keyboard/focus, reload, zero serious/critical axe findings, clean
  console/network, and no source-host browser request.

## Exclusions

Submission signing/broadcast remains Slice 017. Recovery retry controls remain
Slice 018. Consumer evidence remains Slice 019. The public report never replaces
private transaction preparation evidence.

