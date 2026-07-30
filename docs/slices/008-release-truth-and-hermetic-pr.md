# Slice 008 — Release truth and hermetic PR

## Trigger

Independent Core and Product verification of commit
`c192ed2a6f7a35ac4e0685833559bbbe452cab56`, tree
`94d0726644131b810f4161eedd5c652c1d31e15f`, failed. The candidate was
hermetically green, but production tracing reproduced false consumer success,
duplicate relayer broadcast after a crash, an API-backed PR Action, and blocked
post-result actions.

## User result

Consumer Lab deliberately verifies the canonical vulnerable consumer and shows
the evidence that failed. Safe code generation and read-only sharing remain
available after the run result. CLI help works with no credentials. Pull requests
replay a checked-in canonical bundle with zero network access; only merge queue
uses the persisted Coston2 API path.

## Frozen acceptance contract

- A failed consumer projection without valid diagnostic evidence must fail closed.
  It can never be rendered or published as `CONSUMER_VERIFIED`.
- `GET /v1/runs/:id` exposes the latest versioned consumer diagnostics from the
  journal. API and Web preserve their codes, evidence, and remediation.
- Web submits `consumer: canonical-vulnerable`. Proof verification does not
  automatically race it with canonical-safe verification. CLI and the live Action
  request canonical-safe explicitly when they need a release predicate.
- Safe consumer codegen and read-only share-token creation are permitted for an
  owned terminal run. They do not append or rewrite run events. Other new terminal
  mutations remain `409 RUN_TERMINAL`.
- An identical accepted idempotency intent may be read back after terminal state;
  a new or conflicting intent remains forbidden.
- A relayer persists one broadcast-attempt claim before external RPC I/O. Once an
  attempt exists, automatic recovery never calls `sendRawTransaction` again. An
  ambiguous missing transaction fails closed for manual recovery. Release evidence
  counts durable attempts rather than only successful post-RPC markers.
- Relayer balance validation reserves attestation value plus worst-case gas cost.
  Missing or invalid gas-price evidence fails closed before signing.
- Credential-like query names reject separator/case/version variants including
  `api_key_v2`, `access_token_v2`, `authorization_token`, `credential`, `jwt`, and
  `X-Amz-Security-Token` in both URL and manifest query sources.
- Pull-request Action replay reads and verifies a local canonical ProofBundleV1,
  matches its manifest to the requested manifest, and performs zero fetch calls.
  Merge queue alone requires API/project credentials and uses the persisted live
  path.
- Action dependency construction is inside its failure boundary. Configuration
  errors publish one redacted message without a raw stack.
- `proofline --help`, `proofline help`, and command help exit zero without API URL,
  project token, RPC, or wallet credentials.

## RED evidence required

The Contract & Test Designer must demonstrate each semantic failure against the
frozen Slice 007 candidate, including a two-invocation crash reproduction for
relayer broadcast, a no-network PR Action spy, and terminal PostgreSQL cases for
codegen/share/idempotency. Existing green controls remain unchanged.

## Cycle

1. One independent Contract & Test Designer freezes RED tests only.
2. Core writer fixes diagnostics, lifecycle ownership, relayer crash safety,
   credential rejection, gas reserve, and terminal idempotency.
3. Surface writer fixes Web intent, hermetic Action replay, Action entry boundary,
   and offline CLI help.
4. Root refactors without changing contracts, runs all release gates, and freezes
   a new commit/tree.
5. Two fresh read-only verifiers sign the same tree. Neither failing Slice 007
   verifier may author or sign the new candidate.
