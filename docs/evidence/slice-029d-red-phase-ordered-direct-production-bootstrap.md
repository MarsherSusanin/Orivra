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

## Submission-mode identity corrective RED

The active public Open-Meteo and ETH manifests are both canonical replay-mode
bytes. API/worker relayer effects require a persisted relayer-mode manifest, so
using those replay SHAs for the 029D live gates is impossible. The correction
preserves public replay compatibility and freezes separate submission-only
relayer identities: Open-Meteo
`sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6`
(927 bytes) and ETH/USD
`sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f`
(629 bytes).

Safe-consumer registry remains replay-keyed. A strict pure alias proves the
live relayer/replay manifests differ only at submission mode and produce the
same consumer bytes before any RPC. Replay bootstrap records relayer source and
replay target identities after terminal proof/consumer validation. Raw or
cross-source aliasing is intentional RED and cannot be hidden by mocks.

This correction was frozen from exact clean base
`504f9edc994eb982ce3678de346b686d762c6541` / tree
`1ac4f19cabe4ba422dbf5cd70e6b9d625d04e30f`. Typecheck and all 46 Sites
controls pass. Focused domain classification is 5 controls PASS / 3 intentional
RED; exact 029D deployment classification is 1 control PASS / 14 intentional
RED; the retained 029C+029D integration set is 27 PASS / 26 intentional RED.
Serialized deployment static is 249 PASS / 30 intentional RED, all at the
already frozen missing phase-order or new relayer/alias/schema production
boundaries. No Docker, network, credential, server, build or production effect
was run.

## Hosted browser VDS handoff corrective RED

The production-used operator browser adapter now has one bounded handoff:
after Caddy activation it sends canonical acceptance bytes and their digest to
the exact allowlisted `append-browser-acceptance` host command. The host alone
strict-parses and no-replace publishes the mode-0400 JSON/checksum pair under
`/opt/orivra/evidence/browser/`. Caller paths, noncanonical bytes, wrong origin
or checksum, generic file writers and the obsolete root-level browser paths are
rejected. The returned digest—not an in-memory observation—is frozen as canary
and deployment authority. Any append or subsequent failure rolls Caddy back
before pinned-session close and produces zero deployment PASS.

On exact clean base `3f1f66924827e4b6df4f04cdebc8ced463a6d0bc` /
`d19d0f013c363c7357c8803fdabe13e05fc4e5fe`, typecheck and 46 Sites
controls pass. The browser/host focus is 12 PASS / 18 intentional RED;
serialized deployment static is 248 PASS / 34 intentional RED. New failures
are confined to the missing exact host allowlist/append, returned-digest
authority and canonical browser-directory production surfaces.

The follow-up V2 correction makes `cutover.browserAcceptanceSha256` mandatory
in `ProductionDeploymentEvidenceV2` canonical bytes/checksum and cross-binds it
to the exact host append receipt. Missing, malformed or receipt-mismatched SHA
fails before deployment evidence append. Historical V1 schemas and bytes are
unchanged. Typecheck and syntax pass; the pure focus is 13 control PASS / 2
intentional RED, the four deployment files are 20 control PASS / 24
intentional RED, serialized deployment static remains 248 control PASS / 34
intentional RED, and Sites remains 46 PASS. The two new pure failures are the
absent V2 schema field and its consequent fail-closed rollback parse; the
deployment failures remain confined to the already frozen production seams.
