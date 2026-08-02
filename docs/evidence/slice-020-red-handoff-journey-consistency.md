# Slice 020 RED — hermetic handoff journey consistency

## Frozen candidate

- Commit: `58e0a5080cfd4dd717ba35e5285bd8c7c5941ad1`
- Tree: `bf61003453108df900021708a614ce21629326cb`
- Role: Contract & Test Designer
- Scope: one focused acceptance suite plus this evidence; no production edits.

Reload/discoverability extension base:

- Commit: `95ca24e17330ae5a7eafa6b73745fab709239064`
- Tree: `606aad6f23b4e8e24cc5db8de5dfb8f030002b88`

## Frozen public journey

The acceptance contract uses the real hermetic API/worker composition and the
production browser surface. It freezes this user-visible sequence:

1. create and submit one replay run;
2. receive a real proof and fail the canonical vulnerable consumer with
   `CONSUMER_HOST_MISMATCH`;
3. generate and locally verify the persisted safe Solidity consumer;
4. require `EvidenceReceiptV1.consumerResult` and `ConsumerLabReportV1` to
   expose the same pass result and canonical diagnostic-code set;
   Consumer Lab keeps `consumerIdentity=canonical-vulnerable` and carries the
   compiled safe artifact without inventing a passing safe verification;
5. open Integration Package and download the exact receipt, proof bundle,
   manifest and generated `.sol` bytes;
6. expose the repository-local CLI command and GitHub Action inputs.

The reload acceptance additionally freezes that generated codegen is persisted,
not component-local state. After the failed-consumer dialog is closed, the tree
is unmounted and `/runs/:id` is loaded through a fresh production browser
service. The cockpit must expose exactly one safe primary action named `Resume
Consumer Lab`, `Open Consumer Lab`, or `Open Integration Package`. Following it
must reach the persisted Integration Package without another consumer-
verification POST.

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

Result after the reload extension: expected RED, `2/2` failed tests with five
discriminating assertions:

- Consumer Lab reports `passed=true` while the receipt reports `passed=false`;
- Consumer Lab claims `canonical-safe` although the persisted terminal evidence
  belongs to `canonical-vulnerable`;
- Consumer Lab reports `diagnostics=[]` while the receipt contains
  `CONSUMER_HOST_MISMATCH`;
- Integration Package correctly fails closed with `Persisted handoff evidence
  does not agree byte-for-byte`, so no exact download links are exposed;
- after close, unmount and a fresh `/runs/:id` load, the only primary action is
  still `Retry verification`; no safe resume/open action exposes the already
  persisted safe artifact and handoff.

Neighbor evidence remained green:

```text
npx vitest run src/slice020b-integration-package.contract.test.tsx --reporter=dot
```

Result: `8/8` PASS. This isolates the defect to the real hermetic journey rather
than the component's consistency checks or static artifact rendering.

## Corrective RED extension after rejected candidate

Corrective extension base:

- Commit: `d4d92fdf54859af63c0bbb6e569283128410e49c`
- Tree: `c8f92f930bd765287408893ec6e255cef5642041`
- Role: Contract & Test Designer
- Scope: focused acceptance and evidence only; no production or checked-in
  GitHub Action artifact changes.

The extension freezes two remaining core contracts:

1. Consumer Lab derives every observed scheme, host, path and query value from
   the exact request URL that produced the persisted terminal diagnostic:
   `https://mirror.example.net/prices/eth?currency=USD&source=primary`.
   `CONSUMER_HOST_MISMATCH.evidence.actual`, its `evidence.requestUrl`, and the
   report matrix must agree. The canonical manifest URL is not valid observed
   evidence for this fixture.
2. When the page is closed or unmounted after the terminal vulnerable-consumer
   failure but before codegen, a fresh `/runs/:id` load exposes exactly one
   `Resume Consumer Lab` or `Open Consumer Lab` action. Opening it must restore
   `CONSUMER_HOST_MISMATCH` and offer safe-consumer generation without a `Run
   verification` or `Retry verification` action and without a second
   consumer-verification POST. The user can then generate the persisted safe
   consumer, verify it, and reach Integration Package.

Corrective RED evidence:

```text
npm run typecheck
```

Result: PASS.

```text
npx vitest run src/slice020-handoff-journey-consistency.acceptance.test.tsx --reporter=verbose
```

Result: expected RED, `2` failed and `1` passed:

- the diagnostic correctly persists `actual=mirror.example.net` and the exact
  failing `requestUrl`, but the report matrix incorrectly observes
  `host=api.example.com`;
- the report matrix also adds manifest-only `window=1h` to the observed query
  instead of preserving `currency=USD&source=primary` from the failing URL;
- therefore diagnostic `actual`/`requestUrl` and matrix `observed` disagree;
- after reload before codegen, the cockpit has one safe `Resume Consumer Lab`
  action, but the resumed dialog incorrectly offers `Run verification` instead
  of restoring the persisted terminal evidence and codegen path.

The already-frozen post-codegen reload journey remains green in the same run.

The standalone Action artifact guard was recorded separately without editing
its test, production source, or checked-in artifact:

```text
npx vitest run tests/action-artifact-sync.contract.test.ts --reporter=verbose
```

Result: expected RED, `1/1` failed because `packages/action/dist/index.js` is
not byte-identical to a clean deterministic build of `packages/action/src/entry.ts`.
