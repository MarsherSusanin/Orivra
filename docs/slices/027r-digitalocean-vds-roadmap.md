# Slice 027R — DigitalOcean VDS documentation boundary

## Outcome

Proofline has one reviewable, credential-free deployment decision before any
server is provisioned: a single DigitalOcean Droplet/VDS runs the Web, API,
worker and PostgreSQL through Docker Compose behind Caddy. The roadmap makes
the later credential gate explicit without claiming that hosting exists.

## Frozen architecture contract

- ADR 0029 is accepted and narrowly supersedes only the Sites-hosting portions
  of ADR 0001, ADR 0021 and ADR 0024. Their security, evidence and access
  decisions otherwise remain accepted.
- Caddy is the only public application ingress and provides same-origin `/api`
  routing. Only ports 80/443 are public; SSH is restricted. PostgreSQL 5432,
  API/worker ports and the Docker socket are never host-public.
- Web, API, worker and PostgreSQL run on the same VDS through Docker Compose.
  PostgreSQL owns a persistent volume. Sites remains a compatibility package,
  not the selected production host.
- GHCR images are selected by immutable digest. A one-shot migration job checks
  migration checksums, holds a PostgreSQL advisory lock and verifies the schema
  before application services start.
- Process health, database/schema readiness and a worker heartbeat remain
  distinct signals.
- Database recovery uses off-host WAL archiving plus base backups for PITR in a
  private S3-compatible DigitalOcean Spaces bucket. A local MinIO restore drill
  is required before credentials. A Droplet image backup is not the database
  backup or PITR plan.

## Frozen delivery order

Credential-free work covers 022–029A, including 027A/B/C and the 028A local
release composition. Development keeps focused TDD per module. One unified
local full matrix runs only after those modules are complete; two independent
verifiers then sign the same tree. The 028B credential gate may authorize DNS,
restricted SSH and Spaces configuration only after that evidence. Slice 029
owns promotion and canary operations.

No infrastructure, credentials, DNS, SSH session, Spaces bucket or network
effect belongs to this RED. It adds no hosted, deployed or live Coston2 claim.

## Frozen documentation surfaces

- `docs/adr/0029-digitalocean-vds-deployment.md` and the ADR index;
- ADR 0001, 0021 and 0024 narrow supersession notes;
- `README.md`, `ARCHITECTURE.md`, `docs/runbook.md`;
- `docs/development/product-roadmap.md` and `docs/development/roles.md`;
- `AGENTS.md` and `.github/pull_request_template.md`.

The bounded contract is
`node --test tests/slice027r-digitalocean-vds-roadmap.contract.test.mjs`.
