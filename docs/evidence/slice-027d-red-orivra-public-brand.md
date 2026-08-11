# Slice 027D RED — Orivra public display brand

Status: Intentional RED contract; production implementation absent.

Date: 2026-08-11 (Asia/Vladivostok)

Role: Contract & Test Designer; sole shared-tree writer for this wave.

Accepted parent commit: `8137970091197160c3d002084a2b778a4d262034`

Accepted parent tree: `8c594cc58820670aba66e7b3cbd6f1f818420a19`

Architecture decision: [ADR 0038](../adr/0038-orivra-public-brand.md)

Slice contract: [027D](../slices/027d-orivra-public-brand.md)

## Prerequisite truth

Slice 027C received independent Core and Product PASS on the exact accepted
parent identity above. This does not turn user-canceled Codex Security scan
8852 into a PASS. Its deferred handoff inventory-digest validation risk remains
open and is not claimed fixed by 027D. Neither 027C nor this RED wave is hosted,
deployed, production-Spaces, live Coston2, actual RPO/RTO or SLA evidence.

## Frozen test inventory

The RED wave adds five test files and changes no production, asset, generated
dist, dependency, lock, Docker or protected Sites source:

- `src/slice027d-orivra-public-brand.contract.test.tsx` — document metadata,
  local SVG seam, persistent shell, unknown route and bounded current Web copy;
- `apps/api/test/slice027d-orivra-wallet-auth-cutover.contract.test.ts` — exact
  Orivra challenge, fail-closed exact/near-legacy messages, unchanged five-minute
  TTL and no new brand configuration authority;
- `packages/cli/test/slice027d-orivra-brand.contract.test.ts` — Orivra display
  with exact lowercase bin/Usage compatibility;
- `packages/action/test/slice027d-orivra-brand.contract.test.ts` — Action
  metadata/runtime display, stable IDs and later generated-artifact sync;
- `tests/slice027d-orivra-compatibility.contract.test.ts` — exact package,
  env/persistence/storage, Solidity/media/Docker/S3 and Sites/test-origin
  compatibility controls.

The first focused execution is 20 cases: 12 causal intentional RED and eight
compatibility controls PASS. The failures are exactly absent Orivra HTML/SVG/
Web copy, new SIWE output plus legacy rejection, CLI display strings, Action
metadata/summary and generated artifact. There are no compile, fixture,
timeout or unhandled harness failures.

```sh
npm run typecheck

npx vitest run \
  src/slice027d-orivra-public-brand.contract.test.tsx \
  apps/api/test/slice027d-orivra-wallet-auth-cutover.contract.test.ts \
  packages/cli/test/slice027d-orivra-brand.contract.test.ts \
  packages/action/test/slice027d-orivra-brand.contract.test.ts \
  tests/slice027d-orivra-compatibility.contract.test.ts
```

Typecheck PASS. Focused result: 5 files, 20 cases, 12 intentional RED and eight
controls PASS.

Nearest accepted wallet-auth, CLI, Action, landing and accessibility controls
are 8 files / 62 cases PASS with zero skip. `npm run test:sites` remains
36/36 PASS against the existing built artifacts. The RED author did not run a
root build, coverage, Docker, network or external effect; generated Web/Action
artifacts intentionally remain the pre-027D bytes until production GREEN.

## GREEN and verification requirements

Production must satisfy the frozen cases without renaming an allowlisted
technical identifier or accepting a second SIWE message grammar. Then run the
nearest Web/API/CLI/Action controls, affected coverage gates, Action artifact
sync, root build and Sites 36. Product Integration Verification must inspect the
built Web in desktop/mobile Chrome, including metadata/vector load, keyboard,
axe, console/network, history and all public routes. Two different verifiers
must PASS the same stopped tree before 028A.

Historical ADR/slice/evidence wording remains unchanged. This local RED record
is not hosted CI, deployment, security PASS or live evidence.
