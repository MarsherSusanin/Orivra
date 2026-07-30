# Proofline development roles

Every slice runs in this order: Slice Architect → Contract/Test Designer → FDC Run Core Implementer → Surface & Adapter Implementer → refactor → Core Code Verifier → Product Integration Verifier.

- One writer owns the shared tree during a wave.
- RED tests are frozen after the intended failure is demonstrated.
- Production authors cannot act as either verifier.
- The two verifiers must be different agents.
- Verifiers inspect the same recorded tree hash. Any production edit invalidates both passes.
- Verifiers report findings; they never patch production code.
