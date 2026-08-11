# ADR 0041: Credential-free MLP candidate freeze

- Status: Accepted contract; setup-cleanup correction GREEN locally after rejected `78a85e2` / `20c0f41`, replacement candidate pending
- Date: 2026-08-12
- Refines: ADR 0029, ADR 0035, ADR 0039, ADR 0040

## Context

Slices 022–028A and 027E now provide the credential-free product, container,
recovery and OCI-freeze modules. Their focused module evidence is necessary but
does not authorize credentials or deployment. The release boundary still needs
one exact tree on which the complete runbook matrix, a recorded-fixture Compose
journey and a fresh offline OCI freeze all agree.

## Decision

1. Slice 029A runs once on one clean committed tree. It produces a strict
   canonical `CredentialFreeMlpCandidateV1` receipt only after every ordered
   unified gate passes and final Git identity is unchanged.
2. The candidate receipt binds the exact producer commit/tree, the fresh 028A
   manifest SHA-256, receipt SHA-256 and artifact-inventory SHA-256. The 028A
   manifest and receipt must name the same 029A producer; an older module freeze
   is not release authority.
3. The exact gate inventory is typecheck, full tests, contracts/domain
   coverage, backend coverage, Web coverage, real PostgreSQL, Solidity, E2E,
   production build, Sites, Action byte-sync, serialized Docker static, offline
   Docker image/HTTPS, runtime persistence, recovery, fresh OCI release freeze
   and the recorded-product Compose journey. Missing, duplicate, reordered or
   failed gates are invalid.
4. The product journey binds one canonical checked-in fixture containing the
   accepted template/replay expectations, starts the production Caddy/Web/API/
   PostgreSQL composition with `--pull never --no-build`, proves the matching
   public shell and template API/detail through loopback HTTPS, and keeps worker
   stopped. The fixture is read-only expected data: it is not imported into
   PostgreSQL, does not claim live Coston2 provenance and is not a production-
   importable test adapter.
5. The runner constructs a fresh minimal child environment and fresh no-auth
   Docker config. The config exposes only one executable local Compose plugin
   selected from the frozen system-path allowlist; it never reads the user's
   Docker config or credential store. It never runs prefetch, pull, login, push,
   registry operations or the live Coston2 suite. Only loopback HTTPS and
   Docker-local Compose communication belong to the recorded product journey.
   This does not claim daemon-global network isolation.
6. A caller-owned absolute mode-0700 output parent and WAL-G input are required.
   The runner owns only a new absent output path and scoped ignored prefetch
   material derived from that verified input. Any failure removes only owned
   stage/output/prefetch resources and publishes no candidate PASS.
7. The final output is read-only and contains the fresh 028A release directory,
   canonical recorded fixture bytes and canonical candidate receipt. The
   receipt has no timestamps, credentials, absolute paths, operator identity or
   remote publication authority.
8. Two independent release verifiers must PASS the same final 029A tree. Their
   reports are separate immutable evidence; the author receipt alone does not
   authorize 028B. Credentials remain forbidden until both reports exist.

## Consequences

- 028B may consume only the exact OCI bytes and manifest checksum bound by the
  accepted 029A receipt plus two same-tree PASS reports; it never rebuilds.
- 029A remains local, credential-free and non-hosted. 028B owns registry
  publication/staging and 029B owns production promotion/canary.
- Scan 8852 remains user-canceled and the deferred 027C inventory-digest risk
  remains open; 029A does not relabel either as a security PASS.
