# ADR 0017 — Persisted preflight Workbench

## Status

Accepted for Slice 016B.

## Context

Slice 016A persists one redacted `PreflightReportV1`, but the Run Cockpit still
shows only a generic lifecycle message while preflight is active or complete.
Fetching the source again in the browser, deriving a second verdict in React,
or exposing private `preflight-evidence` would create a second source of truth
and could leak request material. A report may also be pending, unavailable on a
legacy run, corrupt, ready, attention, or blocked; these states need different
safe actions without starting Slice 017 submission effects.

## Decision

The Run Cockpit renders a Preflight Workbench only for the preflight journey.
It reads the persisted report through `RunSurfaceServices.getPreflightReport`
and treats the parsed `PreflightReportV1` as the only verdict/evidence source.
The browser never fetches the manifest source URL and never reconstructs report
evidence from lifecycle events.

The fixed reading order is:

1. verdict and one dominant next action;
2. fee/cap and request identity;
3. five ordered sample fingerprints;
4. redacted response/JQ shapes and ABI evidence;
5. diagnostics and bounded remediation.

`ready` and `attention` may advance the route from `step=preflight` to
`step=submission`; this is navigation only and performs no wallet, RPC, relayer,
or submission command. `blocked` has no continuation action. A share token is
read-only and therefore never receives a mutation-oriented continuation.

The route query is product state. Workbench navigation preserves `status`, the
supported `panel` value, and the URL fragment. `popstate` restores the selected
step and panel. Unknown step/panel values fail closed to the run's persisted
stage rather than inventing a product state.

Pending is retried only when a newer run sequence is observed. Unavailable and
invalid reports are stable, safe states with no automatic source refetch. Once
a valid report is loaded it is cached for the current run because the public
artifact is immutable.

`PREFLIGHT_COMPLETED` is emitted once only when hydration observes a newer
persisted transition from an unfinished preflight state to completed or failed.
Initial hydration, report rendering, reload, share reads, and repeated polling
do not emit it.

## Consequences

The Workbench remains a React DOM/CSS section within the accepted graphite Run
Cockpit; no chart, Canvas, or second dashboard is added. Desktop keeps the
central cockpit plus diagnostics rail. At mobile width, evidence becomes one
sequential reading column and all essential state remains available without
hover. Submission execution, recovery controls, and Consumer Lab remain outside
Slice 016B.
