# Built-in Web2Json template contributions

Orivra's built-in catalog is immutable product configuration. A template is a
replay starting point, not a live-data guarantee or authority to create a
wallet or relayer effect.

## Eligibility

A proposed source must:

- use public HTTPS on the default port 443 with no credentials, userinfo,
  redirects, cookies, or request headers;
- return one bounded JSON body no larger than 1 MiB;
- have a stable, documented host, path, query, JQ projection, and ABI;
- produce five stable samples through Orivra's pinned-DNS SSRF boundary;
- be accepted by the official Flare Web2Json `prepareRequest` verifier;
- have reviewed provider terms and data licensing suitable for an example;
- use `submission.mode: "replay"` and never embed a wallet or relayer effect.

## Review checklist

1. Add a strict manifest and exact consumer URL invariants to the pure domain
   catalog. Do not add runtime discovery, a database row, or a source fetch.
2. Compute SHA-256 over the canonical parsed manifest bytes and freeze it in an
   independent contract fixture.
3. Increment the catalog revision. Preserve every existing template revision,
   digest, and introduction revision byte-for-byte.
4. Keep exactly one featured template first; order all remaining summaries by
   lowercase template ID.
5. Add contract/domain, anonymous API, Web gallery/Composer, and MCP discovery
   coverage. Prove browser and MCP discovery never contact the source host.
6. Record the five-sample and verifier checks without response bodies or
   credentials. A failed check removes the template from the candidate.

Template IDs and revisions are exact. Orivra does not provide aliases,
`latest` selection, arbitrary URL tools, or silent fallback manifests.
