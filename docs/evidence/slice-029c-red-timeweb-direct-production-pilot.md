# Slice 029C RED evidence — Timeweb direct-production pilot

Date: 2026-08-12

## Exact baseline

- commit `99918ab43c2186286f8fd0f116dcff6e13f7aba6`;
- tree `a24d08a47fb30a30edc1eeb3c5511c55e00fde8b`;
- initial status clean;
- Product FAIL report SHA-256
  `2186ed3400ac917409f26c2fde6653d9a70dd8b6dd015233970ba32e0811ead9`.

Product verification proved two P1 failures: generic `{status:"passed"}`
preflights reached provisioning, and all synthetic seven-day checkpoints plus
terminal evidence completed in milliseconds. It also found no explicit
cutover effect. The corrected rollback V1 byte/checksum binding is retained as
a GREEN compatibility control.

## Frozen intentional failures

The tests require absent V2 contracts and runtime seams for exact Timeweb
shared-pilot authority, direct production without staging, typed preflights,
the ordered Open-Meteo/ETH safe-consumer registry, explicit Caddy cutover and a
trusted-clock resumable 24-hour acceptance chain. Generic preflight objects,
partial consumer deployment, early/fabricated checkpoints, V1-only effect
authority or noncanonical inputs must cause zero PASS/effect.

No credential value or rotation deadline is recorded. Shared-pilot authority
is not described as least privilege. MinIO remains QA-only; Swift is outside
the runtime. No network, Docker, production or hosted effect runs in RED.

## Gate chronology

- syntax and typecheck: PASS;
- focused V2 plus retained 029B/Slice009 purity: 43 retained controls PASS and
  10 intentional RED from absent V2 exports/domain seams;
- focused deployment: 7 retained 029B controls PASS and 3 intentional RED from
  absent direct-pilot/resume runtime entrypoints;
- serialized deployment static: 221 retained controls PASS and the same 3
  intentional RED;
- Sites compatibility: 46/46 PASS after retaining the historical 029B
  credentialed promotion/canary statement.

Only tests and canonical documentation belong to this commit.

## Retained 027B compatibility correction

The first GREEN implementation pause exposed stale retained 027B assertions:
they still authorized one global `PROOFLINE_SAFE_CONSUMER_ADDRESS` and exactly
two worker bind mounts. The corrected contract requires the host
`PROOFLINE_SAFE_CONSUMER_REGISTRY_FILE`, mounted read-only at
`/run/proofline/evidence/safe-consumer-registry.v1.json`, as the third evidence
input. A missing registry file must fail in the production wrapper before its
Docker adapter is invoked. The old address is absent from the rendered worker
environment. The paused production stash was inspected read-only and was
neither applied nor modified.

The corrected retained 027B file classifies 10 controls PASS and three causal
RED cases. The combined focused deployment set classifies 17 controls PASS and
six intentional RED cases; the 029C pure/purity set remains 19 PASS and ten
intentional RED. Serialized static exposed only those intentional failures plus
the retained TERM-reap timing control under load; its isolated 12/12 rerun PASS.
Sites remains 46/46 PASS.
