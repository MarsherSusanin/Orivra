# Slice 031 GREEN — production canonical URL demo restoration

Status: author GREEN; live Coston2 recording and production deployment pending

## Implemented boundary

- The canonical safe Solidity consumer now binds the exact Open-Meteo host,
  path and six template query values.
- The attack response is deterministic checked-in JSON suitable for a
  commit-pinned GitHub-backed jsDelivr request with an
  `application/json` response.
- Recording runtime tests use identical Open-Meteo query, JQ and ABI authority
  for the different-host attack and control.
- The production recorder derives the only accepted jsDelivr GitHub path
  from the recording's lowercase release commit. A different commit, host,
  repository or artifact path fails before compiler, EVM or import authority.
- Production Compose requires one exact recording SHA selector for API.
- Production runtime parsing rejects a missing, malformed or overridden
  selector before any Compose or Docker effect.
- The operator importer accepts only an absolute root-owned mode-0400,
  no-follow, bounded recording below `/opt/orivra/evidence`, then performs one
  foreground dedicated-role import.
- API import reads through a no-follow handle and isolates the importer login
  from bootstrap/administrator database authority.

## Author verification

- `npm run typecheck` — PASS.
- Focused FDC runtime/restoration — 15 files and 209 tests PASS; affected
  canonical recording runtime is 100% statements, branches, functions and
  lines.
- Contracts/domain coverage — 59 files and 667 tests PASS at 100% statements,
  branches, functions and lines.
- Backend coverage — 124 files and 1,243 tests PASS; aggregate 91.81% lines and
  86.99% branches. The five PostgreSQL files are intentionally disabled in
  that coverage invocation and were run separately with real Testcontainers.
- Real `PROOFLINE_TESTCONTAINERS=1` PostgreSQL — 22 files and 163 tests PASS,
  zero skips.
- Full application matrix — 271 files and 2,610 tests PASS. Its 43 conditional
  skips are the same PostgreSQL cases proven by the separate zero-skip gate.
- Serialized deployment static — 311/311 PASS, including symlink,
  owner/mode, oversized-file and nonzero-importer negative controls.
- Production build, Sites 46/46 and Action artifact 1/1 — PASS.

No wallet, Coston2, registry, VDS, database, DNS, V2BOX or browser effect was
performed by these author checks. This file is not a release, deployment or
security PASS. The exact attack commit/run and recording SHA remain deliberately
unset until a clean verified tree is published and the user confirms the one
Coston2 wallet transaction.

## Live preflight compatibility correction

The first real wallet run
`536dab30-f719-46f1-ba8b-4d09b445e794` created no Coston2 effect. Its eight
preflight attempts exhausted with the bounded `FDC_TRANSPORT` classification.
A production-side bounded probe established two independent causes: the
installed verifier key returned HTTP 401, while the documented public testnet
key reached the verifier and exposed `INVALID RESPONSE CONTENT TYPE` for
GitHub Raw. The same exact checked-in bytes served through commit-pinned
jsDelivr returned `Content-Type: application/json` and verifier status
`VALID`. The terminal run remains append-only incident evidence and is not
reused. Corrective tests require the exact jsDelivr host, repository, commit
and artifact path and explicitly reject GitHub Raw before source/compiler/EVM
effects.

## Corrective verifier wave

The first frozen candidate `ff4d21ab4c4fe74dea7e48b599134fd0a966f8fa`
was rejected by Product verification because its release identity and attack
URL were independently valid but not cross-bound. The sealed mode-0400 report
is `/private/tmp/proofline-slice031-verifiers/ff4d21a/product-verifier.md`
(SHA-256
`ed019f7e0577d8793bbaf6d0c1bc33a18959d75939050a07f0835b2d041046e0`).
The corrective tests reproduce a different release commit and unrelated
host/repository/artifact paths as internally valid persisted bundles, and the
production runtime now rejects all four before reading checked-in sources.
