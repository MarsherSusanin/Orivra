# Slice 023C2A RED — lazy wallet provider adapter

## Frozen boundary

The Contract & Test Designer froze one pure adapter boundary before production:

- no provider/global/RPC access on module import or adapter construction;
- explicit EIP-6963 discovery, stable UUID deduplication, multiple-provider
  output and legacy fallback only when no valid announcement exists;
- strict enabled-Coston2 capability before effects;
- accounts, chain switch/add/verification and `eth_getCode` in exact order;
- EOA-only signing with exact `personal_sign` parameters;
- bounded rejection/provider/unsupported/cancelled evidence without raw wallet
  errors;
- single-flight, cancellation and stale-result safety.

## Expected RED

Command:

```text
npx vitest run src/services/slice023c2a-lazy-wallet-provider-adapter.contract.test.ts
```

Expected failure: the frozen test cannot import
`src/services/wallet-provider-adapter.ts`, because production implementation is
intentionally absent. No assertion is expected to fail for an unrelated
baseline reason.

Recorded result: one file and all 12 frozen cases fail at the same dynamic
import with `ERR_MODULE_NOT_FOUND`. `npm run typecheck` passes, and the four
accepted 023C1 files plus the Slice 022 network-capability contract pass 71/71.

`npm run typecheck` and the unchanged 023C1/network-capability tests are run
separately to prove that the tests/docs-only freeze does not weaken the accepted
baseline. A full Web, build, browser, Sites, PostgreSQL or live Coston2 run is
outside this RED wave.
