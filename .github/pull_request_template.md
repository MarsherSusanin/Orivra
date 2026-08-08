## Slice outcome

Describe the user-visible outcome and excluded scope.

## Contract and RED evidence

- Slice Contract / ADR:
- Frozen contract, migration and acceptance tests:
- Expected RED failure:

## Implementation

- GREEN core:
- GREEN surfaces:
- Refactor notes:

## Validation

- [ ] Typecheck and affected hermetic tests
- [ ] Applicable coverage gates
- [ ] PostgreSQL Testcontainers, if persistence changed
- [ ] Solidity, if consumer/codegen changed
- [ ] Browser acceptance, if Web changed
- [ ] Build and Sites contract
- [ ] Checked-in Action artifact byte-sync, if Action/contracts/domain changed
- [ ] No secrets or simulation fallback in production artifacts
- [ ] Validation evidence identifies local commands or a real hosted job; this repository currently has no checked-in workflow

## Candidate freeze

- Commit hash:
- Tree hash:
- Core Code Verifier: PASS / findings
- Product Integration Verifier: PASS / findings
- Live Coston2 evidence or documented non-release reason:
- Hosted CI / merge-queue job URL, or `not configured`:
