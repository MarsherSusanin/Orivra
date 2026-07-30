# ADR 0010 — Manifest-owned submission and evidence-driven UI

## Status

Accepted for Slice 010.

## Decision

The submission mode stored in `Web2JsonManifestV1` is the authorization boundary,
not a client hint. API requests, persisted commands, and worker handlers all prove
their mode against that manifest before external effects. PostgreSQL adds one
cross-kind uniqueness invariant for wallet attachment and relayer submission so a
race or internal caller cannot construct two spend paths.

Consumer checklist state is evidence-derived. Stable diagnostic codes remain useful
for a single invariant, while `DiagnosticV1.evidence.missingChecks` represents a
versioned set of additional failed invariants. UI combines both sources, accepts
only known checklist keys, and fails closed when overall diagnostic evidence is
missing.

Mobile safe-area ownership belongs to the whole action footer. The reserved region
must include primary action, secondary bundle action, and explanatory copy; testing
only clickable controls is insufficient because covered guidance is still a broken
workflow.

## Consequences

Existing coverage that intentionally enqueues both submission command kinds for one
run is invalid and must be reconciled after RED is demonstrated. PostgreSQL
migration and real-container tests cover the new cross-kind invariant. Browser
acceptance measures every footer child against fixed navigation at 390×844.
