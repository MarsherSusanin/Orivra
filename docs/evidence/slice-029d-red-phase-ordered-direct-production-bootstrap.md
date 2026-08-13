# Slice 029D RED evidence — phase-ordered direct-production bootstrap

Exact clean base: `361bac3091144fd507dc2e2e04acff91d969b385` / tree
`fe8e7717d0d22af394fc753373402ee41d33d5a2`.

The audit found one first-start authority cycle: static preflight and the
generic production Compose wrapper require backup, replay and hosted-browser
bytes before the private services and public cutover that must create them.
The ordinary worker's refusal to start without canonical replay bytes is a
retained security control, not the defect.

ADR 0045 and the frozen tests separate absent intended outputs from static
authority, add the bounded replay-bootstrap producer, require backup/WAL/PITR
before replay, and defer browser evidence until real public activation. The
same pinned session retains rollback authority until final evidence succeeds.

This wave changes tests/docs only. Current images remain undeployable under the
new contract and must not be published. No production, dependency, lock,
generated artifact, Docker, network, credential, provider or chain effect is
included. Final RED/control counts are appended after focused classification.

## Classification

Syntax and `npm run typecheck` PASS. The new bootstrap suite plus retained
027A/027B Compose lifecycle is 29 controls PASS plus 16 causal intentional RED:
four exact nine-service/dependency failures and twelve missing production-used
phase-runtime, live replay export, browser adapter, phase-aware Compose,
artifact and rollback seams. Serialized deployment static is 261 controls PASS
plus the same 16 RED. Sites is 46/46 PASS. Diff-check is
clean. These failures are the frozen production gap; there is no harness,
fixture, Docker or external-effect failure.

The follow-up causal inventory additionally freezes the live worker+API
Open-Meteo run-to-bundle/report export, immutable selected backup versus
append-only daily backup IDs, the production-used post-activation browser
adapter, early Compose service aliases versus consuming/generic-up denial, and
zero deployment evidence across every producer/seal/validation failure.
