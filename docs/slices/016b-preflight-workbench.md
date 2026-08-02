# Slice 016B — Preflight Workbench

## Slice contract

### User outcome

A developer opening a newly created Web2Json run can decide whether the exact
request is safe to submit by reading one persisted report in a fixed order. The
surface communicates ready, attention, and blocked without requiring docs and
without hiding essential evidence behind hover.

### Production boundary

- The only data input is `GET /v1/runs/:id/preflight` through
  `RunSurfaceServices.getPreflightReport`.
- No browser request may target the manifest source host.
- The report is parsed before rendering. Invalid, pending, unavailable, and
  transport failures use stable safe UI copy; secrets and raw stacks are never
  rendered.
- A valid report is immutable and cached for the current run. Pending may be
  retried after a strictly newer run sequence; unavailable and invalid do not
  create a refetch loop.
- Project access may navigate to the next step. Share access is read-only.
- Navigation to `step=submission` creates no transaction, wallet/RPC call,
  relayer command, or `SUBMISSION_REQUESTED` event.

### Surface contract

The Workbench replaces the generic next-action block while `step=preflight` and
uses this reading order:

1. `Ready to submit`, `Review before submission`, or `Submission blocked`.
2. Canonical URL, request SHA-256, quoted fee/cap, chain 114, registry block,
   registry and resolved `FdcHub`.
3. Five numbered sample fingerprints and determinism result.
4. Redacted source shape, transformed JQ shape, and ABI compatibility.
5. Stable diagnostics, evidence field labels, and remediation.

Ready and attention expose one dominant `Continue to submission` action for a
project token. Blocked exposes remediation only. Loading and pending explain
that persisted evidence is still being prepared. Legacy unavailable and invalid
artifacts fail closed. Desktop preserves the accepted cockpit hierarchy;
`390×844` becomes one ordered column. React DOM/CSS is the only renderer.

### Route and analytics contract

- Supported run steps are `preflight` and `submission` for this slice.
- Step changes preserve supported `status`, `panel=diagnostics`, and the hash.
- Back, forward, and reload restore the same step and panel.
- `PREFLIGHT_COMPLETED` emits once from a newly observed persisted transition:
  completed maps to `accepted`, failed maps to `rejected`.
- Initial hydration, reload, report load/render, polling the same sequence, and
  share access emit nothing.

## RED acceptance

- Contract tests cover the service port, typed safe client errors, every report
  state, strict reading order, exactly five samples, ready/attention/blocked
  action policy, project/share behavior, route history, immutable caching, and
  analytics deduplication.
- Browser acceptance covers `1488×1058` and `390×844`, keyboard focus, Back and
  Forward, reload, axe with zero serious/critical findings, clean console and
  network, and zero source-host calls.
- Existing coverage gates, typecheck, build, Sites, and production-truth tests
  remain green.

## Exclusions

Slice 016B does not prepare or submit a transaction, call a wallet, start a
relayer command, add recovery semantics, or implement Consumer Lab. Those begin
only in later slices and are intentionally not started in this delivery.
