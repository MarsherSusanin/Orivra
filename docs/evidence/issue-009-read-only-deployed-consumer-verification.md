# Issue 009 — deployed consumer verification evidence

Status: Author GREEN; independent verification pending.

## Causal boundaries

- strict request: chain 114 and address only;
- exact safe source recompilation with pinned compiler settings;
- persisted preflight registry cross-binding;
- one operator-owned, block-bound `eth_getCode` observation;
- exact runtime bytecode SHA-256 comparison;
- honest verified, mismatched, unavailable and proxy-unsupported outcomes;
- append-only evidence bound to the accepted auxiliary command;
- retry and lease recovery cannot append run events, fail the terminal run or
  cancel sibling commands;
- Web polling cannot accept evidence from an older command;
- no wallet, relayer, deployment, caller-supplied RPC or proxy-certification
  authority.

## Focused author evidence

The author worktree passed:

- typecheck;
- the focused contracts, worker, API/PostgreSQL and Web causal suites;
- Core coverage: 61 files, 683 tests, 100% statements, branches, functions and
  lines;
- backend coverage: 127 files, 1,258 tests, 91.39% lines and 86.76% branches;
- worker coverage: 27 files, 275 tests, 90.09% lines and 86.11% branches;
- Web coverage: 73 files, 630 tests, 91.69% lines and 85.11% branches;
- full default-mode Vitest matrix: 276 files and 2,647 passing tests, with 43
  configured skips; the separately required PostgreSQL matrix below has none;
- real Testcontainers PostgreSQL: 22 files and 165/165 tests with zero skips;
- worker and Web builds, Sites 46/46 and Action artifact 1/1.

Independent verifier evidence is recorded only after this implementation is
frozen to an exact commit and tree.
