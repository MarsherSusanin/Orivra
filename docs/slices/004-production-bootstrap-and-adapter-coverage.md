# Slice 004 — Testable production bootstrap and adapter coverage

## Trigger

After Slice 003, the full hermetic suite passes but the backend release coverage
gate falls to 64.5% lines and 65.86% branches. The failure is structural: live
network construction, worker lifecycle, CLI/Action production adapters, and API
bootstrap are embedded in side-effectful entry modules, while
`production-service.ts` was accidentally omitted from the measured scope.

## User result

Every production surface can be constructed and exercised with injected ports,
without network access, process mutation, real sleeps, or credentials. Executable
package shims invoke those tested factories and contain no policy or branching.

## Boundary

This slice may refactor composition and add dependency injection, but may not alter
public API/CLI/Action behavior, lifecycle schemas, security policy, the cockpit, or
the live Coston2 protocol sequence. Coverage thresholds remain at least 90% lines
and 85% branches for production API/adapters/CLI/Action.

## Acceptance contracts

- `createLiveCoston2PipelinePorts` accepts injectable RPC, DA, DNS/HTTPS, JQ, and
  clock dependencies. Recorded fixtures exercise every stage without live I/O.
- The merge-gate runtime coordinates the same staged ports instead of duplicating
  a second RPC/DA lifecycle.
- Worker bootstrap and loop are independently testable. Required environment,
  complete handler wiring, idle sleep, stop, pool shutdown, live-only composition,
  and secret-safe logging are contracts.
- CLI production dependencies inject fetch/files/wallet/clock. Bearer credentials
  remain headers-only; paths are encoded; errors redact tokens and keys; polling is
  bounded under a fake clock.
- Action entry dependencies inject core/artifact/files/replay/live gate. PR and
  merge behavior, immutable evidence, upload order, and generic secret-safe failure
  are testable without GitHub services.
- Production service, PostgreSQL repository, API bootstrap, worker, live adapter,
  CLI, and Action are explicitly included in coverage.
- Only invocation shims of a few branch-free lines may be excluded. File-name
  globs and broad entry exclusions are forbidden.

## Cycle

1. Contract/Test Designer freezes bootstrap/adapter RED contracts.
2. Surface implementer extracts injectable production factories and removes the
   duplicated monolithic runtime path.
3. Test designer expands repository/service branch cases with no production
   behavior changes.
4. Root reruns core 100%, backend 90/85, Web 85/80, package builds, full hermetic,
   Sites, Solidity, and browser acceptance.
5. Candidate tree is frozen only after all hermetic gates pass.
