# ADR 0047: Risk-classified release lanes

- Status: Accepted
- Date: 2026-08-14
- Refines: ADR 0029, ADR 0039, ADR 0041, ADR 0042 and the development protocol

## Context

One uniform release loop makes a UI-only change pay the same repeated cost as a
schema or production-runtime change. Rebuilding and re-freezing an already
accepted immutable candidate for a later publisher-authority documentation
refresh adds no evidence about its bytes. Conversely, mixing deployment-tool
changes into a UI candidate can hide composition failures until a real host.

The Definition of Done, affected coverage thresholds, immutable candidate and
two-independent-verifier rules remain mandatory. This decision changes the
order and repetition of work according to risk; it does not turn a focused
PASS into hosted CI, security, deployment, PITR or live-Coston2 evidence.

## Decision

### Lane A — UI-only

Lane A is allowed only when the complete diff is limited to Web `src/`, its
tests and directly related current documentation. It must not change deployment
runtime/tools, Compose/Docker, API/backend, contracts/domain semantics,
migrations/schema, worker/live effects, storage/recovery, dependencies or lock
files.

The author runs typecheck, focused Web tests and required Web coverage, build,
Sites and Action compatibility, followed by real Mac desktop/mobile browser
acceptance including keyboard, axe, console/network and reload/back-forward.
After focused GREEN there is at most one full candidate freeze. Core and Product
release verifiers then inspect that one immutable candidate/tree in parallel,
once. A verifier blocker stops the lane for replanning; it does not start a
serial patch/freeze/verifier loop.

### Lane B — deployment-runtime tools

Any change to deployment scripts, production wrappers, Compose/Docker/runtime
configuration, publication, recovery, host commands or evidence orchestration
is a separate pre-release slice. It receives causal RED/GREEN and
composition-real tests before candidate creation. It is never mixed into a
Lane-A UI candidate. The affected production boundary, static deployment
inventory and required integration controls pass before the one candidate
freeze and parallel release verification.

### Lane C — backend and persistent authority

Any API/backend, contracts/domain behavior, migration/schema, worker/live
effect, PostgreSQL, object-storage, WAL/PITR or persistence change uses the full
runbook matrix, affected coverage, real PostgreSQL where required, one immutable
candidate freeze and two parallel release verifiers. A skipped integration
suite is not evidence.

### Authority-only refresh after acceptance

After a candidate and both release reports are accepted, a docs/publisher
allowlist refresh may bind only those existing exact immutable bytes and
checksums. It runs syntax/typecheck, the causal publisher-authority test,
serialized static compatibility and Sites as affected. It must not rebuild,
rerun the full matrix, mutate the candidate, recreate archives or re-freeze.
Any code or artifact change outside the exact allowlist/docs boundary is not an
authority refresh and returns to Lane B or C.

### Time-boxed fail-fast checkpoints

- scope classification and file inventory: ten minutes maximum;
- focused RED/GREEN to a reviewable result: twenty minutes maximum;
- candidate freeze: once per accepted scoped implementation;
- Core and Product release verification: dispatched in parallel against the
  same stopped tree and immutable candidate.

These are stop-and-replan checkpoints, not permission to skip tests. A blocker,
scope leak, frozen-contract contradiction or failed gate stops the wave. The
team records the cause and chooses a new bounded slice instead of accumulating
serial emergency patches in the candidate.

### Host and workstation safety

Browser acceptance runs on the operator Mac. Chromium or browser tooling is
not installed on the VDS. Release automation must not read, start, stop,
reconfigure or otherwise touch V2BOX, system DNS or the workstation's local IP
configuration. VDS verification remains limited to the explicitly authorized
deployment boundary and never substitutes for Mac browser acceptance.

### Deadline-bound production incident restoration

When production is already public and a user-visible path is broken during an
explicit deadline window, the operator may use a bounded incident-restoration
iteration instead of starting a new candidate freeze for every diagnosis. This
is an operational recovery lane, not a release PASS:

1. identify one causal blocker from production evidence without exposing
   secrets;
2. change only the smallest affected boundary and add the closest causal
   regression test;
3. require typecheck plus that focused test before publishing exactly one new
   immutable image for the affected service;
4. pin the VDS to its exact digest, preserving the prior digest and source
   symlink as rollback authority;
5. require `/healthz`, `/readyz`, container digest and the affected real user
   journey from the operator Mac before continuing to the next blocker.

The VDS pulls and runs the image; it does not compile the application. Browser
verification remains Mac-only. The incident log must name every deliberately
deferred gate. After the deadline, the resulting tree returns to its normal
Lane B or Lane C verification, complete candidate freeze and two independent
reports. Until that completes, do not claim a new candidate, security, PITR or
full release PASS.

## Consequences

- Small UI changes retain all affected product gates with one freeze/verifier
  cycle rather than repeated full release loops.
- Deployment composition is proven before it can contaminate a UI candidate.
- Backend, schema, worker and storage changes retain the full matrix.
- An accepted candidate stays immutable; a publisher-authority refresh changes
  only future acceptance of its exact receipts.
- Existing Definition of Done, security invariants, coverage thresholds and
  two-verifier independence are unchanged.
- A deadline restoration can recover the live user journey quickly while
  leaving an explicit, non-PASS audit debt for the normal post-deadline lane.
