# Issue 012 — Flare Mainnet Web2Json capability assessment

Status: blocked by upstream Web2Json availability.

## Primary-source result

The official FDC overview states that Web2Json is currently available only on
Coston and Coston2. Flare Mainnet chain identity, RPC and registry contracts are
available, but those facts do not create Web2Json protocol support.

Sources:

- <https://dev.flare.network/>;
- <https://dev.flare.network/network/guides/flare-contracts-registry>;
- <https://dev.flare.network/fdc/overview>.

## Bounded read-only observation

At Mainnet block `67510177` the official RPC returned chain `14`, and the
official registry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` resolved distinct
Mainnet `FdcHub`, `Relay` and `FdcVerification` addresses. The exact public
values are frozen in `FLARE_MAINNET_WEB2JSON_ASSESSMENT_V1` and protected by
contract tests.

No wallet, transaction, relayer, DA request or source fetch was performed.

## Result

- Coston2 behavior is byte-for-contract unchanged.
- Flare remains `upstream-unsupported` in the public capability response.
- Unknown or copied Coston2 execution authority is rejected.
- No Mainnet UI selection, persisted run, proof bundle or live adapter is
  enabled.
- Issue #12 must remain open with the `blocked` label until official upstream
  Web2Json support and the remaining acceptance criteria exist.

Author gates passed: typecheck; focused network-capability contracts 7/7; Core
contracts/domain coverage 62 files and 686 tests at 100% statements, branches,
functions and lines; open-source readiness; diff check.
