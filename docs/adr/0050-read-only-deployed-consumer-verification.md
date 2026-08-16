# ADR 0050: Read-only deployed consumer verification

Status: accepted

## Context

Consumer Lab can generate and compile a URL-bound Solidity consumer, but source
and compiler evidence alone do not prove that a particular Coston2 address
contains those bytes. Treating an address as verified from user input, a block
explorer label, or a successful proof call would collapse deployment authority
into presentation state.

## Decision

Orivra exposes one post-terminal auxiliary command,
`VERIFY_DEPLOYED_CONSUMER`. The API accepts only chain 114 and an EVM address;
callers cannot provide an RPC endpoint, registry, expected digest, compiler
version, or source. The worker:

1. reloads the terminal run, persisted preflight registry and exact safe
   consumer source;
2. recompiles that source with pinned `solc-0.8.36` production settings;
3. observes `eth_getCode` at one recorded Coston2 block through the existing
   operator-owned, bounded RPC adapter;
4. compares the observed runtime-bytecode SHA-256 with the reproduced runtime
   SHA-256; and
5. appends strict `deployed-consumer-evidence-v1` bytes bound to the auxiliary
   command, run, address, block, registry, compiler and source.

The four public states are `verified`, `mismatched`, `unavailable`, and
`proxy-unsupported`. Minimal EIP-1167 proxies are detected but their
implementation is not followed. No other proxy inference is attempted.

The auxiliary command never appends run lifecycle events, changes the terminal
projection, cancels sibling commands, signs a transaction, or uses wallet or
relayer authority. Retry and expired-lease recovery remain internal to the
auxiliary command. The Web surface polls for evidence carrying the exact
accepted command ID, preventing an older observation from satisfying a newer
request.

## Consequences

- A verified result means exact direct-deployment runtime bytes at one observed
  Coston2 block, not source-code verification, ownership, audit, or future
  immutability.
- A mismatch and missing code are preserved as evidence rather than converted
  to transport failures.
- Proxy deployments fail closed as unsupported until a separate explicit proxy
  authority model is accepted.
- The worker remains the only network observer; API and browser do not receive
  Coston2 RPC authority.
