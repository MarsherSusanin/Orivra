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
The retained deployment role-bootstrap may still receive its unused least-
privilege importer database secret; the gate forbids invoking the importer,
supplying `--recording` or issuing direct SQL, rather than hiding required
Compose configuration.

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

## Production GREEN checkpoint

The follow-up production wave implements the candidate contracts/domain
binding, strict serial orchestration, worker-stopped production Compose journey
and atomic terminal runner. Before candidate freeze: typecheck PASS; focused
candidate contracts/domain 18/18 PASS; focused lifecycle/product 16/16 PASS;
serialized deployment static 188/188 PASS; contracts/domain coverage 50 files,
579 tests and exact 100% statements/branches/functions/lines. No credential,
registry, external-network or hosted claim is made. The one-shot unified run and
two independent verifier reports remain pending on the final committed tree.

The first terminal attempt on `331cce9` stopped at the full-unit gate before
Docker or candidate publication because the production landing placeholder
still contained the forbidden historical `api.example.com` demo marker. The
candidate lifecycle removed its scoped prefetch/stage and published no PASS.
The corrective tree replaces only that visible placeholder with a neutral
reserved example endpoint and must repeat the unified matrix from the start.
The same failed run also exposed that the owned-tree helper used `fs.rm`
without recursion for an already emptied directory, leaving private stage/temp
directories behind. The correction uses `rmdir` only after the no-follow walk
and strengthens the fixture to prove owned removal plus external symlink-target
byte/mode preservation. The exact failed-run residues are removed separately;
no caller-owned path is broadened into cleanup authority.
