# Slice 028A RED — Offline OCI release freeze

Status: Second corrective production-author GREEN locally after Core rejected
exact replacement candidate `1d3324df0929d11a725de3182cb56c8f75d05808`
/ tree `473c5348db4c0f56aa0340e7aef7b492e3298c80`; final freeze and both
verifiers pending on one replacement tree.

Date: 2026-08-11 (Asia/Vladivostok)

Role: Contract & Test Designer; sole shared-tree writer for this wave.

Accepted parent commit: `3d57840f699c6815502a19b13a5f803ef2b95cbc`

Accepted parent tree: `fc7643f3ec5ab57998ba61f0ee55e1805a7e2143`

Architecture decision: [ADR 0039](../adr/0039-offline-oci-release-freeze.md)

Slice contract: [028A](../slices/028a-offline-oci-release-freeze.md)

## Prerequisite truth

Slice 027D independently passed Core and Product verification on the exact
accepted identity. Core report
`/private/tmp/proofline-027d-verifiers/3d57840/core-verifier-rerun.md` has
SHA-256 `16b90f11b3ad91759b18c248f176d756b94491b0eed43c36f84787d26f096ce3`.
Product report `/private/tmp/proofline-027d-verifiers/3d57840/product-verifier.md`
has SHA-256
`8c15ee12b3937c56984f10aa0c50af6888784774a8d63d9b3560d112e78f5137`.
They are local targeted module PASS reports, not hosted, release, deployment,
live-Coston2 or security evidence. Scan 8852 remains user-canceled and its
deferred 027C validation risk remains open.

The local environment reports buildx `v0.25.0-desktop.1` / BuildKit `v0.23.2`
with Linux/amd64 support. This is capability context, not a frozen binary or
image identity. `docker/.prefetch` is absent. RED therefore requires a caller-
supplied private WAL-G input root and forbids a fallback prefetch. The observed
local PostgreSQL recovery image ID is deliberately not recorded as authority.

## Frozen test inventory

The RED wave adds three focused executable files and amends the retained worker
purity contract. Production, dependencies, locks, Dockerfiles, Compose and
generated artifacts remain unchanged:

- `packages/contracts/test/slice028a-frozen-oci-release.contract.test.ts` —
  strict manifest/receipt schemas, tuple/reference/checksum binding;
- `packages/domain/test/slice028a-oci-release.contract.test.ts` — pure OCI
  manifest selection, canonical archive inventory and terminal receipt
  derivation;
- `tests/deployment/slice028a-offline-oci-release.contract.test.mjs` — private
  source/WAL-G authority, exact offline build calls, deterministic archive and
  atomic lifecycle seams;
- retained `apps/worker/test/slice009-production-worker-purity.contract.test.ts`
  freezes the new feature subpaths/root identity and zero worker contribution.

## RED execution chronology

All commands below ran on the same uncommitted tests/docs-only author tree. No
Docker command, buildx, network, prefetch, root build, coverage or generated
artifact command ran.

- `node --check tests/deployment/slice028a-offline-oci-release.contract.test.mjs`
  PASS;
- `npm run typecheck` PASS;
- focused contracts/domain/package command: three files, 46 cases; 31 causal
  intentional RED and 15 retained controls PASS. The failures are exactly the
  absent contract/domain release feature files, package exports and identities;
- focused deployment command: 19 cases; 18 causal intentional RED and one
  retained exact-six-input control PASS. The failures are exactly the absent
  release source/WAL-G authority, OCI packer, orchestrator, publisher and root
  command;
- retained migration-manifest and Action-artifact controls: 18/18 PASS;
- retained 027A image/prefetch/static controls: 23/23 PASS;
- serialized `npm run test:docker:static`: 165 cases; the same 18 new 028A
  intentional failures and all 147 retained/new controls PASS;
- `npm run test:sites`: 36/36 PASS.

The first focused import attempt produced a Vite missing-module collection
error. The RED harness was corrected to import the optional future feature by
runtime URL, so the final run collects every test and fails only at executable
production seams. A schema-only receipt producer mismatch was also moved to
the domain handoff verifier, because a strict pure schema cannot know the
independently expected producer.

After the RED freeze, a fixture-only contradiction was found in the valid fifth
`postgres-recovery` entry: both archive and image-manifest digests used the same
repeated `5` value while the frozen contract correctly requires distinct
identity namespaces. The fifth valid archive fixture now uses a unique repeated
`0` digest; production contracts and the explicit digest-reuse rejection remain
unchanged. The correction rerun kept `npm run typecheck` GREEN, the focused
contracts/domain/package classification at 31 intentional RED plus 15 PASS,
and deployment at 18 intentional RED plus one PASS. A concurrent full-static
attempt produced three incidental retained-control failures; the exact same
165-case static set rerun with `--test-concurrency=1` restored all 147 controls
and only the frozen 18 Slice 028A failures remained.

The first GREEN-compatible deployment subset then exposed a teardown-only
fixture defect: accepted source and WAL-G captures correctly returned nested
mode-`0500` directories and mode-`0400` files, but `afterEach` made only the
outer temporary parent writable before recursive removal. The harness now
walks owned temporary trees with `lstat`, never follows symbolic links, makes
each real nested directory/file removable, and then deletes only the registered
temporary parent. Production mode and symlink assertions are unchanged.

## Boundaries

This RED creates no OCI archive and invokes no Docker, buildx, network,
prefetch, registry, scanner, credential or external effect. It makes no 029A
unified-matrix or 028B publication claim.

## GREEN author chronology

The implementation kept the frozen public contracts unchanged and added pure
release contracts/domain derivation plus import-safe source, WAL-G, OCI archive
and terminal publication orchestration. Final semantic evidence before the
real freeze was: typecheck PASS; focused package/purity 46/46; deployment
19/19; serialized Docker static 165/165; contracts/domain 48 files and 561
tests at exact 100% statements, branches, functions and lines.

The first clean real author freeze ran from commit
`e2248eacb9b7cbe8cced56a8953ad7ef683c3048` / tree
`93136ee9b6b161fd27660829f26ac25caa67bc07`. It used the standalone local
Buildx boundary with `--pull=false`, `--network=none`, no registry, no
credentials and no prefetch. It built the exact five Linux/amd64 images once
and published seven read-only artifacts. The canonical manifest SHA-256 was
`719089b082217392fdaf612f174c4f87f22b4ee1c7e5de9d76e407d36a9de3d8`;
the receipt SHA-256 was
`9bda76d3960de6f1e6bff4a7b710a7f639b6dfa7dbeba14f2636725bca3881a1`.
Independent author rehash and tar inventory checks passed, and the working tree
remained clean.

That first output is author evidence for the implementation identity, not the
terminal handoff for this documentation change. After the status documentation
is committed, the exact final tree must be frozen again and handed unchanged
to two independent verifiers. No hosted, deployed, registry, 029A unified-
matrix or security PASS is claimed.

## Independent Core rejection and corrective RED

Core report `/private/tmp/proofline-028a-verifiers/5613640/core-verifier.md`
has SHA-256
`71bd46709505df7cca9ecf2220c213f52540ecf1e88145ffdc6714864a4a3780`.
It rejects the exact candidate above for two release-boundary blockers:

- pre-existing caller output was detected but then deleted by the shared error
  cleanup, while cleanup `chmod` followed a symbolic link and could mutate an
  external target;
- OCI packing accepted symbolic links at authority-bearing control paths
  `blobs`, `blobs/sha256`, `index.json` and `oci-layout`.

Corrective executable RED preserves pre-existing output bytes and modes,
requires cleanup to unlink without following/chmodding an external target, and
requires all four OCI control paths to be `lstat`-bound real directories/files
before archive output creation. The accepted archive format, modes and public
release schemas are unchanged. The rejected candidate is not independently
verified and its earlier local author output is not release authorization.

Corrective classification on the rejected candidate: syntax and typecheck
PASS; package/contracts/domain 46/46 PASS; deployment 19 retained PASS plus six
causal corrective RED; serialized static 165 retained PASS plus the same six
RED; Sites 36/36 PASS. No Docker, network, build, credential or production
effect ran during this corrective wave.

## Corrective GREEN

The replacement changes only the two release helpers. Publication records
whether this invocation completed the atomic rename and removes the final path
only in that case; a pre-existing caller path is never owned by its failure
cleanup. Symlinks are unlinked directly without `chmod` or traversal. OCI
layout verification now `lstat`-binds `blobs` and `blobs/sha256` as real
directories and `index.json` and `oci-layout` as real regular files before any
read or archive creation.

Post-fix evidence: diff-check and typecheck PASS; focused deployment 25/25,
including all six corrective cases; package/contracts/domain 46/46; serialized
deployment static 171/171. The public manifest/receipt schema, five-image tuple,
Docker inputs, dependencies and locks are unchanged. The replacement still
requires a final real offline freeze and fresh independent Core and Product
PASS reports on one exact committed tree; no prior output or report is reused
as release authorization.

## Residual caller-owned archive rejection

Core report `/private/tmp/proofline-028a-verifiers/1d3324d/core-verifier.md`
has SHA-256
`f83b8f440a020e47fa718a03832dab76adfe61edd658576b2598d55aa265e12f`.
It confirms all first-wave six corrections but rejects exact replacement
`1d3324d` / `473c534` for one residual ownership defect: OCI archive creation
uses exclusive `open(..., "wx")`, then its shared catch removes the caller path
after `EEXIST`. The second corrective RED supplies a valid layout and a
pre-existing mode-`0400` caller archive, requires the fixed rejection, and
preserves its exact bytes and mode. The archive writer may remove only an
output it created during the current invocation. Public release contracts and
the prior six corrections are unchanged.

## Second corrective GREEN

The archive writer now sets its ownership flag only after `open(outputPath,
"wx")` succeeds. Its catch removes the path only when that invocation created
it; an `EEXIST` rejection preserves the caller's exact bytes and mode. The
focused deployment inventory is 26/26 PASS and package/contracts/domain remains
46/46 PASS. The final serialized static and real offline freeze run on the
committed replacement tree; both independent verifiers remain required before
028A completion.
