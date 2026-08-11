# ADR 0038 — Orivra public display brand

## Status

Accepted and independently verified on exact commit
`3d57840f699c6815502a19b13a5f803ef2b95cbc` / tree
`fc7643f3ec5ab57998ba61f0ee55e1805a7e2143`. Core and Product report
SHA-256 values are recorded in ADR 0039. This remains credential-free local
module evidence, not release authorization, hosting or a security PASS.

## Context

The product needs one public display name before the credential-free OCI freeze
in 028A. The accepted name is **Orivra**. The repository already exposes many
`Proofline`/`proofline` identifiers that are not presentation copy: package
scopes, environment variables, database roles, storage keys, artifact names,
Solidity identifiers, media types, Docker identities and evidence kinds. A
global replacement would break persisted clients, release evidence and
operator automation.

Wallet authentication is also signed user-visible evidence. A new EIP-4361
challenge may not show the old product name, while accepting both names would
silently broaden the server-authored message grammar.

This ADR changes only the public display brand. It does not rename the product's
technical protocol identity and does not supersede prior architecture ADRs.

## Decision

### Public name

`Orivra` is the exact case-sensitive display name for current Web, CLI and
GitHub Action surfaces and current canonical documentation. New public copy
must not present `Proofline` as the product name.

Web document metadata is exact:

- title `Orivra · Web2Json evidence`;
- description `Orivra — observable, verifiable Flare Data Connector runs.`;
- SVG icon `/src/assets/orivra-mark.svg`.

The accepted asset seam is one checked-in local `src/assets/orivra-mark.svg`
with `viewBox="0 0 48 48"`. Sidebar imports that vector, keeps it decorative,
and exposes `Orivra home` on the root link. The SVG contains no script,
`foreignObject`, raster image, event handler, JavaScript URL or remote URL.
The topbar wordmark and all user-facing Web status, error, trust, onboarding,
token and export copy use `Orivra`. Technical class names, Solidity names,
download suffixes and storage keys are not display copy.

### Wallet-auth cutover

`buildEip4361Message` emits exactly:

`Sign in to Orivra and create your default project.`

Origin, URI, Coston2 chain 114, nonce, canonical timestamps, 8192-byte bound and
the exact five-minute lifetime remain byte-identical otherwise. There is no
brand environment variable, client brand input or persistence migration.

Consumption retains durable consume-before-recovery. After consumption the API
reconstructs only the new canonical Orivra message and byte-compares it with
the persisted message. An exact pre-cutover Proofline message, a case variant
or any near-legacy message is `409 CHALLENGE_UNAVAILABLE` before signature
recovery, project/session creation or another effect. There is no dual-message
parser or backward-auth exception. During a rolling cutover, an already-issued
challenge may therefore require the user to request a new one; the disruption
is bounded by the unchanged five-minute challenge expiry.

### CLI and Action

CLI headings and user-visible errors use `Orivra`. The command remains
`proofline`, including exact `Usage: proofline ...` help, package
`@proofline/cli`, bin mapping, `.proofline.json` output suffix and existing
environment variables.

GitHub Action `name`, `description`, summaries and user-visible failures use
`Orivra`. Input IDs `manifest`, `mode`, `bundle`; default
`fixtures/proofline.bundle.json`; `dist/index.js`; `PROOFLINE_*`/GitHub
environment IDs; and artifact names `proofline-replay-evidence` and
`proofline-live-evidence` remain exact. GREEN regenerates the checked-in Node 20
artifact and the existing byte-sync contract must pass; hand-editing dist is
forbidden.

### Compatibility allowlist

The following identities remain exactly Proofline-compatible in 027D:

- root/workspace package names and all `@proofline/*` imports/exports;
- every `PROOFLINE_*` environment/configuration name;
- PostgreSQL database, schema, group/login roles and migration history;
- `proofline:*` storage, quota and idempotency namespaces;
- CLI binary/usage `proofline` and `.proofline.json` filenames;
- Action input/output/default/environment/artifact IDs;
- Solidity `Proofline*` files, libraries, verifier and consumer contract names;
- versioned media types, evidence `kind`/JSON field values and bundle formats;
- Docker repositories, services, labels, project/cache prefixes and
  `/run/proofline/*` paths;
- S3 prefix segment `/proofline/v1`;
- existing test origins such as `proofline.example` and `proofline.test`.

Changing any allowlisted identity requires a separate compatibility/migration
ADR. 027D adds no alias, redirect, data migration, package rename or fallback.

### Documentation and release ordering

Historical ADRs, slices and evidence keep their original Proofline wording.
Current canonical documents explain the Orivra display name and the compatibility
boundary; they do not rewrite historical evidence. Slice 027D is credential-free
and precedes 028A. It creates no hosted, deployed, security-scan or live Coston2
claim.

## Consequences

The public product becomes Orivra without invalidating persisted data, scripts,
packages, evidence or deployment automation. Existing wallet challenges fail
closed across the cutover rather than gaining a second accepted signed message.
The implementation touches public source and generated Action/Web artifacts,
so affected Web, API, CLI and Action coverage, Action artifact sync, build,
Sites and real browser acceptance are mandatory before both independent
verification reports on one stopped tree.
