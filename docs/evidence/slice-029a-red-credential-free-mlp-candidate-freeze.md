# Slice 029A RED — credential-free MLP candidate freeze

Date: 2026-08-12

ADR 0041 freezes the final local release boundary after 027E received two
independent PASS reports on exact commit
`e42da1ffa689ceb4b3bd43e78f46bd6a3e98eed7` / tree
`18116a629c770f7ea6b4cdfc8e7dd2b814915e2f`.

The RED contracts require a canonical same-tree candidate receipt, the exact
ordered unified matrix, a fresh offline OCI freeze and a canonical checked-in
template/replay expectation verified through local production Compose while
worker remains stopped. The fixture is never imported or described as live
Coston2 evidence. The contracts also freeze minimal no-auth environment, fail-fast execution,
atomic read-only publication and no-follow scoped cleanup.

Expected RED reason: the candidate schema/domain verifier, 029A orchestration,
recorded-product Compose gate and `release:candidate` command do not exist.

Frozen classification:

- `npm run typecheck`: PASS;
- candidate contracts/domain: 17 causal intentional RED;
- candidate lifecycle/product Compose: 16 causal intentional RED;
- nearest 027E/028A Vitest controls: 35/35 PASS;
- nearest 027E/028A Node controls: 36/36 PASS;
- Sites compatibility: 46/46 PASS.

This wave changes tests and documentation only. It does not run Docker, build,
coverage, PostgreSQL, network or credentials and does not claim 029A PASS.
