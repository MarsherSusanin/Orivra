# Slice 024A — Honest canonical URL attack recording

## User-visible outcome

Proofline gains a frozen evidence contract and explicit CLI recording path for
the product statement `Valid proof ≠ trusted URL`. A valid recording contains
two independently persisted live Coston2 bundles: an attack source accepted by
the canonical vulnerable consumer but rejected by the canonical safe consumer
with `HostMismatch()`, plus an intended-source control accepted by the safe
consumer.

Until such evidence has actually been recorded, the honest product state is
`canonical attack recording unavailable`. No replay bundle, generated proof,
test-system response or checked-in mock may satisfy this contract.

## Scope and exclusions

This slice changes the public evidence/replay boundary and therefore is governed
by [ADR 0031](../adr/0031-canonical-url-attack-recording.md). It freezes:

- strict `CanonicalUrlAttackRecordingContentV1` and checksummed
  `CanonicalUrlAttackRecordingV1` contracts;
- the pure domain creator, semantic validator, canonical serializer and replay
  boundary;
- deterministic recorder inputs/outputs and the exact three-call EVM result;
- the explicit `proofline demo record` CLI syntax, two persisted-bundle reads,
  recorder port and atomic-output port.

The RED wave adds tests and documentation only. It does not add schemas,
domain implementation, compiler/EVM execution, dependencies, generated CLI
distribution, API routes, PostgreSQL tables, worker behavior, Action behavior,
Web UI or a checked-in recording. 024B API/PostgreSQL/Web persistence and
presentation are explicitly excluded.

No `ProofBundleV1`, run event or manifest field changes. No migration is
required. The existing Sites compatibility files and behavior remain intact.

## Public contract

The recording envelope is strict and capped at exactly 6 MiB canonical UTF-8.
Its outer checksum covers canonical content bytes and is distinct from both
embedded bundle checksums and exact canonical bundle-byte hashes.

The content freezes:

1. canonical recording time and release commit/tree identity;
2. Coston2 chain 114 and persisted API provenance;
3. one shared GET query/JQ/ABI/transformed-shape identity;
4. exact attack/control canonical `ProofBundleV1` strings and their persisted
   run ID, live mode, last sequence, transaction, voting round, proof, checksum,
   byte hash, byte size and canonical URL;
5. exact compiler input/output, source, creation bytecode and runtime bytecode
   hashes;
6. exact local EVM runtime version/hardfork;
7. an ordered tuple in which vulnerable/attack is accepted,
   safe/attack reverts with `HostMismatch()` selector `0xb828610a`, and
   safe/control is accepted, with exact proof/calldata/runtime/result hashes.

The bundles must be different persisted live wallet/relayer runs. Each embedded
string must pass existing byte-canonical `replayProofBundle` semantic integrity
without any modification. Attack and control share method, query, JQ, ABI and
transformed shape but use different source hosts. The control bundle defines
the intended host enforced by the canonical safe consumer.

Unknown keys and any replay, synthetic, test-system, fixture or recorded-replay
provenance fail closed. The validator checks every derivable identity and
cross-link; exact compiler/source hashes that cannot be recomputed from hashes
alone are protected by the outer checksum and must be produced by actual
runtime compilation.

## CLI contract

The sole command is:

```text
proofline demo record --attack-run <id> --control-run <id> \
  --commit <sha> --tree <sha> --out <path>
```

All five options are required. Attack and control IDs must differ. The command
uses `client.exportBundle` once for each explicit ID, invokes
`demoRecorder.recordCanonicalUrlAttack` once with only exact bundle bytes,
run IDs and release identity, validates its canonical recording bytes, then
calls `files.writeTextAtomic`. It never calls ordinary `writeText` for this
artifact. Any read, compile, EVM or validation failure leaves the destination
unchanged.

No local fixture is read and no default path exists. The command does not use
global fetch in unit tests, create runs, sign, broadcast, read wallet/relayer
keys or pass environment/Authorization data to the recorder. A later real
invocation may use only the existing scoped project token inside the persisted
API client to retrieve the two bundles. That invocation is not part of the
credential-free RED or local MLP evidence.

## Security and risk

- **Trust boundary: high.** The artifact distinguishes real persisted live
  evidence from plausible synthetic output and binds exact runtime behavior.
- **Persistence/migration: none in 024A.** Both bundle bytes are existing API
  artifacts; the output is an atomic local file.
- **Secrets: high.** Strict schemas have no credential fields. Token/private-key
  names and raw values are absent from serialized and logged output.
- **Network/SSRF: unchanged.** Pure domain functions perform no I/O. CLI unit
  tests disable external network; the only eventual remote read is the existing
  authenticated persisted API bundle path.
- **Release: medium.** Commit/tree, compiler and runtime identities are evidence,
  but 024A is not 028A/029A release or deployment evidence.

## Frozen RED tests

`packages/contracts/test/slice024a-canonical-url-attack-recording.contract.test.ts`
freezes strict shape, 6 MiB bound, unchanged embedded bundle shape, live-only
provenance, exact identities, fixed transcript tuple, timestamp/release/hash
forms and unknown/secret-key rejection.

`packages/domain/test/slice024a-canonical-url-attack-recording.contract.test.ts`
freezes deterministic create/serialize/replay, byte-identical replay, embedded
bundle semantic validation, exact identity cross-links, attack/control
equivalence and difference, transcript hash/result binding, outer mutation
detection, pre-parse size rejection and redaction.

`packages/cli/test/slice024a-demo-record.contract.test.ts` freezes help,
mandatory options, different run IDs, exact two-bundle reads, one recorder call,
atomic-only output, failure cleanup, zero test network, no signing/secrets and
no default/fallback evidence.

The expected intentional RED reason is absent 024A schema/domain exports and an
unsupported `demo record` command. Existing public contracts are not weakened
to make the tests pass.

## GREEN and verification gates

1. GREEN contracts/domain implements only the frozen strict schema and pure
   semantic boundaries. Run focused tests and the 100% statements/branches
   contracts/domain/codegen gate.
2. GREEN runtime actually compiles exact checked-in sources with the recorded
   standard-JSON toolchain and executes all three calls in the deterministic
   local EVM. Returning a preconstructed transcript is not a pass.
3. GREEN CLI wires existing persisted API bundle reads and an atomic filesystem
   adapter without adding wallet/relayer custody or a fixture fallback. Affected
   CLI coverage is at least 90% lines and 85% branches.
4. Targeted core verification checks bundle immutability, checksum/size
   mutations, semantic cross-links, compiler/EVM binding and fail-closed
   provenance on one recorded tree.
5. Targeted product verification runs the CLI black-box with injected local
   ports, verifies atomic output/reparse and deliberate unavailable/failure
   states, zero unexpected network and no secret/log leakage on that same tree.

No PostgreSQL, browser, Sites, Docker, live Coston2 or hosted gate is claimed by
024A. The unified full matrix still runs once after all credential-free
022–029A work, as required by the runbook.

