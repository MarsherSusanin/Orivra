# Slice 031 GREEN — production canonical URL demo restoration

Status: author GREEN; live Coston2 recording and production deployment pending

## Implemented boundary

- The canonical safe Solidity consumer now binds the exact Open-Meteo host,
  path and six template query values.
- The attack response is deterministic checked-in JSON suitable for a
  commit-pinned `raw.githubusercontent.com` request.
- Recording runtime tests use identical Open-Meteo query, JQ and ABI authority
  for the different-host attack and control.
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
- Focused FDC runtime/restoration — 15 files and 205 tests PASS; affected
  canonical recording runtime is 100% statements, branches, functions and
  lines.
- Contracts/domain coverage — 59 files and 667 tests PASS at 100% statements,
  branches, functions and lines.
- Backend coverage — 124 files and 1,238 tests PASS; aggregate 91.78% lines and
  86.92% branches. The five PostgreSQL files are intentionally disabled in
  that coverage invocation and were run separately with real Testcontainers.
- Real `PROOFLINE_TESTCONTAINERS=1` PostgreSQL — 22 files and 163 tests PASS,
  zero skips.
- Full application matrix — 271 files and 2,606 tests PASS. Its 43 conditional
  skips are the same PostgreSQL cases proven by the separate zero-skip gate.
- Serialized deployment static — 311/311 PASS, including symlink,
  owner/mode, oversized-file and nonzero-importer negative controls.
- Production build, Sites 46/46 and Action artifact 1/1 — PASS.

No wallet, Coston2, registry, VDS, database, DNS, V2BOX or browser effect was
performed by these author checks. This file is not a release, deployment or
security PASS. The exact attack commit/run and recording SHA remain deliberately
unset until a clean verified tree is published and the user confirms the one
Coston2 wallet transaction.
