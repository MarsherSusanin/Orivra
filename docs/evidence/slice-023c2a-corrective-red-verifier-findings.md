# Slice 023C2A corrective RED — verifier findings

## Rejected candidate

Candidate `dccbe6ddf8ea0bf1e5e76cab46e1ef257a6f929c`, tree
`94223c2cdf266f18a417847126fecb4c604740d1`, passed the original frozen tests
but was rejected by both independent verifiers.

They reproduced four trust-boundary failures:

1. a provider-created or mutated exported `WalletProviderError` escaped by
   identity with arbitrary code/message/cause/data;
2. a throwing capability Proxy escaped raw from schema parsing;
3. a provider mutated shared add-chain metadata and poisoned the RPC URL seen
   by a later adapter;
4. connect/sign flights aliased distinct provider, capability and message
   intents.

## Corrective RED

`src/services/slice023c2a-wallet-provider-corrective.contract.test.ts`
freezes six decision-complete cases:

- external same-class, Proxy and hostile values are always normalized and only
  a safely read own numeric `4001` is a user rejection;
- exceptional capability parsing returns `NETWORK_CAPABILITY_INVALID` before
  provider I/O with no raw identity;
- add-chain metadata is exact, fresh and deeply immutable per request;
- connect and sign coalesce only identical canonical intents and reject a
  different pending intent as `WALLET_OPERATION_IN_PROGRESS`.

Expected RED is semantic rather than import failure: the original candidate
leaks forged errors and capability exceptions, exposes mutable shared metadata,
and returns aliased successful results for distinct pending intents. Accepted
original tests and direct consumers remain the neighbor baseline. A production
fix must rerun affected Web coverage at at least 85% lines and above 80%
branches; no UI/build/browser/Sites claim belongs to this corrective wave.

Recorded evidence:

- `npm run typecheck`: PASS;
- corrective contract: 1 file, 6/6 expected semantic failures, with no timeout
  or unrelated import failure;
- original 023C2A plus direct 023C1/network consumers: 6 files, 83/83 PASS;
- accepted-candidate adapter coverage on the original frozen contract: 92.89%
  lines and 85.29% branches. Corrective coverage is not claimed until the new
  production behavior reaches GREEN.
