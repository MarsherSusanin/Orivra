# Slice 020 corrective RED — verifier findings

## Frozen candidate

- Commit: `588332edc62ce6824bbd9012bf1d071d4916ef2b`
- Tree: `502b7ecc8ca4701bcc9e0a7ef183a29a7f57eea8`
- Role: Contract & Test Designer
- Scope: tests and this RED evidence only; no production changes.

## Frozen contracts

1. A share-token reader sees no cockpit `Export bundle` or replay action and
   cannot trigger the replay POST path. Opening Integration Package may still
   perform the authorized persisted GET reads needed to expose the exact
   receipt, bundle, manifest and Solidity artifact bytes.
2. Integration Package fails closed unless `ConsumerLabReportV1.passed` and the
   canonical set of diagnostic codes exactly agree with
   `EvidenceReceiptV1.consumerResult`.
3. `PROOFLINE_WEB_ORIGIN` is validated when the production service is composed:
   HTTPS only, default/443 port, no credentials, root path only, and no query or
   fragment. The production share result is parsed through `ShareLinkV1`, and a
   browser client configured with an expected web origin rejects a valid-looking
   fragment link from another HTTPS origin.

## RED command

```text
npx vitest run src/slice020b-integration-package.contract.test.tsx src/services/slice020b-integration-services.contract.test.ts apps/api/test/slice020-verifier-public-origin.contract.test.ts --reporter=dot
```

Result: `3` test files failed as expected; `11` tests failed and `11` existing
discriminators passed. `npm run typecheck` remained green.

Expected RED reasons:

- the share-reader cockpit still renders `Export bundle`;
- Integration Package still accepts a Consumer Lab pass verdict or diagnostic
  code set that contradicts the receipt;
- the browser client accepts a foreign-origin share URL because it has no
  expected-web-origin binding;
- production composition accepts HTTP, a non-default port, credentials, a
  non-root path, query and fragment origins;
- production `createShare` returns a generated object without validating it
  through `ShareLinkV1`.

These failures are the intended implementation boundary. The tests must not be
weakened to make the slice green.
