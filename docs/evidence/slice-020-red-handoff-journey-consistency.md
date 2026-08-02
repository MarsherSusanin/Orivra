# Slice 020 RED — hermetic handoff journey consistency

## Frozen candidate

- Commit: `58e0a5080cfd4dd717ba35e5285bd8c7c5941ad1`
- Tree: `bf61003453108df900021708a614ce21629326cb`
- Role: Contract & Test Designer
- Scope: one focused acceptance test plus this evidence; no production edits.

## Frozen public journey

The acceptance contract uses the real hermetic API/worker composition and the
production browser surface. It freezes this user-visible sequence:

1. create and submit one replay run;
2. receive a real proof and fail the canonical vulnerable consumer with
   `CONSUMER_HOST_MISMATCH`;
3. generate and locally verify the persisted safe Solidity consumer;
4. require `EvidenceReceiptV1.consumerResult` and `ConsumerLabReportV1` to
   expose the same pass result and canonical diagnostic-code set;
5. open Integration Package and download the exact receipt, proof bundle,
   manifest and generated `.sol` bytes;
6. expose the repository-local CLI command and GitHub Action inputs.

The consistency guard in `IntegrationPackageDialog` remains part of the
contract. The journey must make its persisted inputs agree; the guard must not
be removed or weakened.

## RED evidence

```text
npm run typecheck
```

Result: PASS.

```text
npx vitest run src/slice020-handoff-journey-consistency.acceptance.test.tsx --reporter=verbose
```

Result: expected RED, `1` failed test with three discriminating assertions:

- Consumer Lab reports `passed=true` while the receipt reports `passed=false`;
- Consumer Lab reports `diagnostics=[]` while the receipt contains
  `CONSUMER_HOST_MISMATCH`;
- Integration Package correctly fails closed with `Persisted handoff evidence
  does not agree byte-for-byte`, so no exact download links are exposed.

Neighbor evidence remained green:

```text
npx vitest run src/slice020b-integration-package.contract.test.tsx --reporter=dot
```

Result: `8/8` PASS. This isolates the defect to the real hermetic journey rather
than the component's consistency checks or static artifact rendering.
