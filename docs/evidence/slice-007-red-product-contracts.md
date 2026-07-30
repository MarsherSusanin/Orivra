# Slice 007 product RED evidence

## Scope

The Product Contract & Test Designer added only new contract tests. Production
sources, package configuration, and every previously frozen test remain unchanged.

The contracts freeze five product/release boundaries:

1. A PR cannot publish replay evidence when the persisted bundle journal is not
   terminal, even if an API projection incorrectly claims `terminal: true`.
2. A relayer manifest starts at `RUN_PREFLIGHT` and drains through the complete
   persisted live graph to a proof bundle, a passing `canonical-safe` consumer,
   one actual broadcast, and zero broadcasts after the recorded hash.
3. Action command idempotency is derived from immutable GitHub repository, event,
   commit, tree, workflow, job, and mode inputs. It is stable across wall-clock and
   process restart, while a changed tree or mode produces a different identity.
4. The production Action is a project-token client: it neither requires nor
   forwards `PROOFLINE_COSTON2_PRIVATE_KEY`. The production worker bootstrap graph
   contains neither the synthetic `RUN_LIVE_COSTON2` command nor a `live-gate`
   import.
5. Consumer Lab retains focus after safe code generation and Escape restores the
   opening trigger. The 390×844 hydrated/retry layout reserves fixed navigation
   height plus eight pixels structurally; root Chromium remains the rendered
   bounding-box authority.

## Expected RED

```text
npx vitest run \
  tests/slice007-product-release-integrity.contract.test.ts \
  src/slice007-consumer-lab-focus.contract.test.tsx \
  src/slice007-mobile-reserve.contract.test.ts \
  --reporter=verbose

Test Files  3 failed (3)
Tests       10 failed | 1 passed (11)
```

The ten failures are semantic and map directly to the frozen contract:

- a nonterminal PR bundle is accepted;
- Action keys change with the clock/process and do not change with tree/mode;
- relayer `RUN_PREFLIGHT` schedules no successor;
- merge Action requires a client private key;
- production Action dependencies expose and forward that key;
- the worker bootstrap graph still includes `RUN_LIVE_COSTON2`/`live-gate`;
- generated Consumer Lab state loses dialog focus and Escape ownership;
- mobile structural reserve is `68px`, not the required `68px + 8px`.

The persisted projection/run-id mismatch control already passes, proving the RED
file can also observe an existing fail-closed identity boundary.

## Frozen-control proof

```text
npx vitest run \
  packages/action/test \
  apps/worker/test/production-command-pipeline.contract.test.ts \
  src/VerificationDialog.async-focus.contract.test.tsx \
  src/mobile-safe-area.contract.test.ts \
  --reporter=dot

Test Files  9 passed (9)
Tests       55 passed (55)
```

```text
npm run typecheck

tsc --noEmit
PASS
```

No live Coston2 request, browser mutation, production write, or network fallback
was used to manufacture this RED.
