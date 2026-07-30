# Slice 005 — Final verifier remediation

## Trigger

Frozen candidate `9b80bae69300c0cc64d111f0b01ceb638f2e4e40` failed both independent
verifiers. Hermetic coverage and browser layout were green, but real package
execution, PostgreSQL readiness, CLI/Action orchestration, relayer safety,
lifecycle semantics, replay integrity, IPv6 policy, Solidity behavior, and async
dialog focus still contained release blockers.

## User result

The same manifest enters one persisted run through Web, CLI, or Action; wallet and
relayer submissions wait for durable preflight, the relayer identity is committed
before broadcast, every wait is bounded and restart-safe, terminal failures remain
visible, and the exported bundle is byte-canonical and semantically complete.

## Frozen remediation contracts

- PostgreSQL Testcontainers waits for the final database startup and proves empty
  plus previous-schema migration with Docker.
- Built worker and Action artifacts execute under their declared Node runtimes.
- CLI relayer invokes submission; wallet waits for preflight before preparation.
  PR Action replays a manifest through the persisted API path, and merge Action
  uses that same persisted run rather than a synthetic in-memory run.
- Receipt/Relay/DA polling is bounded. `ROUND_FINALIZED` is appended only after
  Relay finalization. Retry exhaustion and nonretryable errors become observable
  terminal run evidence.
- Project/global quota and balance policies are persisted inputs. Active leases
  heartbeat during external I/O. Relayer recovery validates fingerprint and signed
  transaction identity; a recorded successful broadcast is never rebroadcast.
- Worker privileges cannot rewrite immutable relayer identity fields.
- Replay rejects noncanonical input bytes, inconsistent proof hashes, and missing
  generated-consumer evidence. API `byteIdentical` reports an actual comparison.
- IPv6 benchmarking, documentation, ORCHID, and other special-use ranges fail
  closed.
- Generated URL checks compare canonical encoded query values. Behavioral Solidity
  tests execute correct and wrong scheme/host/path/query/proof cases in an EVM.
- Concurrent identical run creation returns the same idempotent result; conflicting
  intent returns 409, never a unique-violation 500.
- Async verification results retain dialog focus ownership; Escape closes and
  restores the trigger.

## Cycle

1. Contract/Test Designers freeze core/security and product/runtime RED contracts.
2. Core writer fixes replay, SSRF, Solidity, idempotency, lifecycle, relayer, and
   persistence.
3. Surface writer fixes CLI/Action/package execution and dialog focus.
4. Root runs Docker PostgreSQL, behavioral Solidity, all coverage/build/browser
   gates, then freezes a new tree.
5. Two newly created independent verifiers must PASS that exact tree.
