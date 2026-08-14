# Security policy

## Supported versions

Orivra is a hackathon-stage open-source project. Security fixes are applied to
the current `main` branch only. Historical commits, local forks, generated
artifacts built from other revisions, and privately modified deployments are
not supported.

## Reporting a vulnerability

Please do not disclose a vulnerability in a public issue, discussion, pull
request, or social channel.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/MarsherSusanin/Orivra/security/advisories/new>

Include the affected revision, entry point, attacker prerequisites, impact, and
a minimal reproduction when possible. Do not include real wallet keys, project
tokens, relayer keys, production credentials, or personal data. If a report
depends on a credential, replace it with a synthetic value and describe its
scope.

The maintainers will acknowledge reports and coordinate remediation on a
best-effort basis. No response-time or bounty commitment is currently offered.

## Security boundaries

- The browser and API never receive the worker relayer private key.
- The API stores keyed token digests rather than raw project or share tokens.
- Live effects are worker-owned, project-authorized, bounded to Coston2 chain
  114, and persisted before retry-sensitive operations.
- Replay mode is evidence-only and must not broadcast a blockchain transaction.
- Source preflight is HTTPS GET only, with DNS/IP validation, no redirects, a
  timeout, and a bounded response body.
- Share and caller-supplied project-token access must not restore browser-wallet
  authority.

These are design invariants, not a claim that the project has completed an
independent security audit. Dependency, secret, unit, and integration checks
reduce risk but do not prove the absence of vulnerabilities.

## Credential exposure

Treat credentials pasted into chat, logs, issues, screenshots, or terminal
recordings as exposed even when they never entered Git. Revoke or rotate them at
the provider, remove any durable copies, and verify that replacements are stored
only in operator-owned secret files or an appropriate secret manager.
