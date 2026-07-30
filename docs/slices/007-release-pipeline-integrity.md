# Slice 007 — Release pipeline integrity

## Trigger

Independent verification of tree `1235961d5254e03da0fa22d49604f08d56c06b0f`
failed. Hermetic suites were green, but black-box and static tracing found release
paths that could not complete, could spend relayer funds more than once, or lost
terminal and keyboard state outside the tested happy path.

## User result

One commit/tree intent creates or resumes one persisted run. Replay and live modes
advance through the same append-only command graph, a run can own at most one
relayer transaction, and no client surface receives the worker relayer key. Every
external wait is bounded, terminal failures survive restart, CLI and API share one
readiness error contract, and Consumer Lab keeps focus ownership through codegen.

## Frozen acceptance contract

- A run cannot enqueue or broadcast a second relayer transaction, even with a new
  request idempotency key, after restart, or after reaching a terminal state.
- Relayer identity is unique per run in PostgreSQL. A terminal failure is a
  versioned journal event, survives projection rebuild, and rejects later mutation.
- PR replay and merge/live Actions schedule every required persisted command and
  can reach their release predicate. They resume by stable repository/event/
  commit/tree identity rather than wall clock or process-local sequence.
- GitHub Action accepts no Coston2 private key. The relayer key and raw project
  token used to authorize worker commands exist only in the worker process. The
  synthetic `RUN_LIVE_COSTON2` production path is removed.
- The API returns stable `PREFLIGHT_NOT_READY`; CLI retries it within 60 seconds and
  fails closed on every other response.
- DNS lookup, HTTP fetch, Relay, receipt, and DA waits all share explicit bounded
  deadlines. Timeout cleanup cannot leak an in-flight request.
- Manifest preflight rejects credential-like query names including access tokens,
  client secrets, passwords, and signed-cloud credential parameters.
- Generated Solidity rejects duplicate expected query parameters, regardless of
  whether the matching value is first or last.
- Real PostgreSQL tests prove command conflict/idempotency and restart/resume, not
  only schema/grants/triggers.
- Consumer Lab retains a focused control after safe code generation; Escape closes
  from every state and restores the current opening trigger.
- At 390×844, every next-action control keeps at least eight CSS pixels above fixed
  navigation for both initial and hydrated/retry content.

## Cycle

1. Core Contract & Test Designer freezes relayer, journal, network, CLI, Solidity,
   and PostgreSQL RED contracts.
2. Product Contract & Test Designer freezes Action command-graph, custody,
   idempotency, dialog, and responsive geometry RED contracts.
3. Core writer implements the journal/relayer/network/consumer minimum to GREEN.
4. Surface writer implements persisted CLI/Action paths; Web writer owns the final
   focus and safe-area production change.
5. Root runs all gates, freezes a new tree, and creates two new independent
   verifiers. Prior failing verifiers cannot sign the remediated candidate.
