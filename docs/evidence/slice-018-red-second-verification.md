# Slice 018 second verification RED

Candidate tree `5e43d607faa0fb1799f1c1c1a9f7aa3c257020fb` received an independent
Core Verification NOT PASS. Corrective contracts freeze three regressions:

1. an expired leased attempt must be journaled before the next `RUN_RESUMED`;
2. recovery messages reject credential, private URL, stack and private-key text;
3. an event feed ahead of its earlier projection snapshot is not reported current.

The focused RED command is:

```bash
npx vitest run packages/contracts/test/slice018-recovery.contract.test.ts apps/api/test/postgres/slice018-recovery-journal.contract.test.ts src/slice018-recovery-surface.contract.test.tsx
```

Expected failures are the new message-vocabulary rejection, attempt-three audit
pair, and projection/event race state.
