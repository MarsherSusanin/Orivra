# Slice 005 RED evidence — behavioral Solidity/EVM gate

## Ordering and dependency boundary

- Parent RED contract commit: `4d18db8`
- Production source and configuration remain unchanged.
- Exact hermetic dev dependencies:
  - `@ethereumjs/vm@10.1.2`
  - `@ethereumjs/common@10.1.2`
  - `@ethereumjs/util@10.1.2`
- The test performs no RPC, public network, Docker, or external process calls.

## Behavioral contract

The gate compiles the actual source emitted by
`generateSafeWeb2JsonConsumer`, the repository
`ProoflineUrlInvariant.sol`, and a deterministic test verifier with
`solc`. It then executes the generated deployed bytecode inside
`@ethereumjs/vm`.

The exact trusted HTTPS scheme, host, path, and query is accepted only when the
mock proof verifier returns true. Separate EVM executions must revert for:

1. wrong scheme;
2. wrong host;
3. wrong path;
4. wrong query;
5. invalid proof with otherwise correct URL evidence.

This is an execution gate over Solidity bytecode, not a source-text or
compile-only assertion.

## Captured run

```text
npx vitest run \
  contracts/test/consumer-behavior-evm.contract.test.ts \
  --reporter=verbose
```

Observed result: **1 file passed, 6 tests passed**.

Full Solidity suite:

```text
npm run test:solidity
```

Observed result: **4 files passed, 37 tests passed**.

Compile gate:

```text
npm run typecheck
```

Observed result: **PASS**.

The RED implementation gaps remain those frozen in the parent commit; this
second ordered commit establishes the required behavioral Solidity execution
gate before production work begins.
