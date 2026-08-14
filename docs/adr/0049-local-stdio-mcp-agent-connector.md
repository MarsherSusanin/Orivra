# ADR 0049: Local stdio MCP agent connector

- Status: accepted
- Date: 2026-08-15

## Context

Users want their own AI agents to inspect Orivra templates and persisted runs,
start safe replay work and consume evidence. A general-purpose HTTP tool would
reopen SSRF and authority boundaries, while placing an agent service on the VDS
would add a new production runtime and credential custodian.

## Decision

Add the private workspace `@proofline/mcp`. It is built and launched from the
user's local checkout as a stdio MCP server. It authenticates to the existing
production API with an existing project token whose persisted kind remains
`cli`; Settings labels that kind `CLI / MCP`.

The server exposes exactly eight tools: template list/detail, project run
list/inspection, replay creation, canonical vulnerable-consumer verification,
safe-consumer generation and in-process bundle validation. It exposes complete
artifacts only through bounded `orivra://` resources. Mutations use stable
operation identifiers and existing API idempotency. Every created manifest is
strictly parsed and forced to `submission.mode = replay` before POST.

The transport writes only MCP JSON-RPC to stdout. Diagnostics use stderr. The
client has an exact route inventory, request deadline, response byte cap,
contract validation and safe typed errors. It never returns or logs the bearer
token. Tool inputs do not accept arbitrary URLs, headers or routes.

Wallet signing, relayer keys, RPC, live submission and Coston2 transactions are
not MCP capabilities. Consumer verification and safe code generation remain
persisted internal operations. The package is neither published to npm nor
installed on the VDS.

Settings may generate a ready MCP client configuration only while the raw token
is already present in the one-time reveal. The checkout path and generated JSON
remain component-local, are copied only after an explicit user action and are
not stored in browser storage, URL state, analytics or logs. Closing the reveal
destroys that state.

## Consequences

- Existing API, PostgreSQL schema, token representation and production topology
  remain unchanged.
- Agents gain a compact, typed and resource-oriented interface without custody
  of wallet or relayer authority.
- Users must build the package locally and protect the copied client config as a
  secret-bearing file.
- Adding tools or routes requires a new boundary review; a universal fetch tool
  is explicitly forbidden.
