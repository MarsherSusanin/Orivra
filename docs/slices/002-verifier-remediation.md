# Slice 002 — Verifier remediation and production readiness

## Trigger

Candidate tree `78979bd70796f845499d5d8d91c8f43bd13511a4` received two independent `FAIL` verdicts. Hermetic correctness and coverage were green, but the release was not executable end to end and several security/restart invariants were incomplete.

## User result

A developer can configure a project token in the Web cockpit, open a deep-linked persisted run, execute the same manifest through runnable API, worker, CLI, and GitHub Action packages, and obtain a safe consumer/bundle from either replay or the real Coston2 runtime. Production composition is concrete; replay adapters remain test-only.

## Boundary

This slice may change production composition, schemas, adapters, persistence queries, package artifacts, Web data binding, and generated Solidity. It may not weaken Slice 001 public schemas, coverage thresholds, the accepted cockpit hierarchy, or the requirement that private keys never cross the API boundary.

Live broadcast still requires externally supplied funded credentials, verifier access, an allowed source, PostgreSQL, and Coston2 availability. Missing external configuration may skip the merge-gate execution locally, but the repository must contain an executable default live runtime and the configured live test must not fail because an implementation is absent.

## Acceptance contracts

### Live runtime

- A production composition root wires verifier preparation, registry resolution, fee cap, request submission, receipt, FlareSystemsManager timing, Relay finalization/root, raw DA proof, local proof integrity, `FdcVerification.verifyWeb2Json`, consumer verification, bundle evidence, and restart-safe persistence.
- Registry-resolved contract names and addresses are captured in the run snapshot. Protocol addresses are not embedded in domain code.
- The transaction hash and exact signed bytes are persisted before broadcast; recovery reuses them and records every broadcast result.
- The live gate rejects replay/simulator adapters, returns commit/tree/run/tx/round/checksum/consumer/broadcast evidence, and is bounded by ten minutes.

### Security and persistence

- SSRF classification canonicalizes IPv4/IPv6 and denies all alternate loopback, mapped, compatible, private, link-local, documentation, multicast, and metadata forms.
- Timeout is enforced by the caller even if a dispatcher ignores `AbortSignal`.
- API commands use strict endpoint-specific schemas. Unknown fields and private-key-shaped material never reach services; a validated transaction hash remains allowed.
- Expired leases are reclaimable with `SKIP LOCKED`; stale claims cannot complete or retry.
- Relayer idempotency binds persisted bytes to the exact command fingerprint and records recovery broadcasts without signing replacements.
- Worker privileges cannot mutate projects, API/share tokens, immutable run evidence, or arbitrary relayer transaction fields.

### Semantic integrity

- Replay validates checksum, schema, ordered lifecycle, run/manifest/request/round/verification consistency, and generated artifact evidence.
- Preflight rejects negative or over-cap fees for wallet and relayer paths.
- The URL attested by the verifier is the canonical URL sampled by preflight. Solidity checks canonical scheme, host/default port, path boundaries, and encoded query values before proof verification.
- Behavioral Solidity acceptance rejects wrong scheme/host/path/query/proof and accepts the canonical proof path.

### Runnable surfaces and Web UX

- `apps/api` and `apps/worker` have Node 22 build/start entrypoints with production configuration validation.
- CLI bin and GitHub Action `main` resolve to generated executable artifacts. Clean package builds reproduce them.
- The Action defaults PRs to replay; merge groups require complete live evidence including commit/tree and no rebroadcast after recorded hash.
- Web deep routes select the run ID, configure a project token in session storage only, hydrate projection/events/evidence from the API, resume after reload, and expose verify/codegen/export without hardcoded run state.
- The accepted fixed rail, compact top bar, six-stage timeline, diagnostics rail, dominant verify action, evidence strip, palette, and density remain intact.

## RED/GREEN and verification

1. Contract/Test Designer freezes remediation tests and expected failures.
2. Runtime/Core Implementer fixes semantic, SSRF, persistence, relayer, replay, fee, and Solidity behavior.
3. Surface/Packaging Implementer adds runnable compositions and Web binding.
4. Candidate tree is frozen only after all existing and new hermetic suites, scoped coverage, clean package builds, Sites, and browser acceptance pass.
5. Two new verifiers inspect the new tree. Neither previous verifier PASS nor previous screenshots can be reused.

External PostgreSQL Testcontainers and live Coston2 execution are reported separately. An unavailable container runtime or missing credentials is not a substitute for production composition tests.
