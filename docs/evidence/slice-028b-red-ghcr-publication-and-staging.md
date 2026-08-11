# Slice 028B RED — GHCR publication and DigitalOcean staging

Date: 2026-08-12 (Asia/Vladivostok)

Status: Intentional RED; production contracts/adapters/commands do not exist.

## Authorized predecessor

029A is complete on exact commit
`fc2f6e0677c64dc4f2ee90a85219bcc9f8c9bfbc` / tree
`f7cebc6ed3842f296b3be1c96645e2dd8cdfe5bd`. The frozen candidate file SHA-256
is `8991e7e49f4570702436c269c8f6bd0af7b8f186997bff2a52e6da22f7a0cdda`.

- Core PASS report:
  `/private/tmp/proofline-029a-verifiers/fc2f6e0/core-verifier.md`, SHA-256
  `d03dd65f00b120420734cba2d6473ccb8bcb0e9cd8f614174f8939a93533b60b`.
- Product PASS report:
  `/private/tmp/proofline-029a-verifiers/fc2f6e0/product-verifier.md`, SHA-256
  `b396a60978279a48db4220d873ce5188b4848cf769d7715d30f828fb1092bd11`.

Both reports are local credential-free release verification, not security,
registry, hosted or deployment evidence. The 029A frozen output remains
read-only and outside this RED commit.

## Frozen RED

The contracts reject inferred/mutable GHCR mappings, schema extras, secrets,
paths, reordered/missing images, remote `archiveSha256`, mutable tags,
write-capable staging pulls, production targets and missing staging checks.
Pure domain tests bind exact candidate/release/report bytes, derive only five
immutable remote references and reject any byte, producer, report, mapping or
remote-digest substitution.

Credential-free fake adapters freeze the effect boundary:

1. minimal file-only GHCR/DO/SSH inputs strip ambient authority;
2. safe bounded OCI inspection rejects traversal, links, duplicates and
   unreachable/missing blobs;
3. all five archives verify before the first registry effect;
4. remote digest is checked only against `imageManifestDigest`;
5. partial publication writes no PASS and cannot start staging;
6. conditional-create evidence preserves an existing caller record;
7. staging explicitly pulls and rechecks exact digest references, then runs
   migration/readiness/real-heartbeat/browser/PITR/live checks in staging only;
8. cleanup remains scoped/no-follow and retains the first causal failure.

Expected RED reason: `@proofline/contracts/publication`,
`@proofline/domain/publication`, `scripts/ghcr-publication-runtime.mjs` and
`scripts/digitalocean-staging-runtime.mjs` are absent, as are package exports
and root identity. No production implementation, dependency, lock, Docker
configuration or generated artifact is changed in this wave.

## RED classification

- syntax and repository typecheck: PASS;
- focused contracts/domain/purity: 42 PASS and 8 intentional RED;
- focused GHCR/staging runtime plus retained DigitalOcean roadmap: 15 PASS and
  10 intentional RED;
- retained 028A/029A/Action pure controls: 48/48 PASS;
- retained 028A/029A deployment controls: 48/48 PASS;
- serialized deployment static: 194 PASS and the same 10 intentional RED;
- Sites compatibility: 46/46 PASS.

All 18 RED cases are caused by the deliberately absent publication feature,
package exports and credentialed runtime seams named above. No retained control
regressed and no test performed a registry, host, Docker or credential effect.

No registry, Docker, network, credential, SSH, DigitalOcean, Spaces, live
Coston2 or frozen-candidate write is performed. No hosted/deployed/security
PASS or 029B authority is claimed.

## Fixture digest correction

The initial RED fixture accidentally assigned the fifth `postgres-recovery`
archive and image-manifest the same synthetic SHA-256 digit, contradicting the
frozen distinct-digest invariant before production could be exercised. The two
affected fixtures now use `a` through `e` for archive digests and `1` through
`5` for image-manifest digests. No schema, runtime or effect contract changed;
the stashed production WIP was not applied.
