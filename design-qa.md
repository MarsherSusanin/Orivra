# Proofline design QA

## Comparison setup

- Source reference: `proofline-run-cockpit-reference.png` at its native `1488 × 1058` size.
- Latest implementation capture: `/private/tmp/proofline-clean-native-final-v3.png` at `1488 × 1058`.
- Responsive capture: `/private/tmp/proofline-clean-mobile-final.png` at `390 × 844`.
- Browser: Codex in-app Browser at `http://localhost:4173/`.
- Comparison method: source and latest implementation were inspected together at original resolution after the final code change.

## Visual comparison

1. The `172px` navigation rail, `85px` top bar, right diagnostics column, and `178px` evidence row reproduce the reference shell and hierarchy.
2. Run title, lifecycle divider, six-stage rail, active Proof node, diagnostic card, primary CTA, and evidence columns align to the same regions as the reference. The final CTA is at `742.7–814.7px`; the evidence row begins at `880px`.
3. Typography uses Inter with the reference's compact hierarchy. The desktop run title is `39px`; supporting copy and labels retain the subdued weights and spacing of the render.
4. Color tokens match the dark blue-black cockpit, cyan active state, green completion/proof state, amber diagnostic warning, and cool gray pending state.
5. The selected Proofline mark is derived from the reference asset and placed on the same left alignment as the navigation icons; blending removes the crop background.
6. Above-fold copy matches the selected render, including `ETH/USD snapshot`, `Coston2`, `Web2Json`, the diagnostic, and `0.012345 ETH`.
7. Icons remain consistent outline glyphs with semantic color and accessible text labels. No decorative raster imagery is used beyond the Proofline mark.

## UX and accessibility verification

- The initial state exposes one dominant next action: `Verify consumer`.
- `View details` expands the evidence in place and reports its state with `aria-expanded`.
- The primary path was exercised in the in-app Browser: `Verify consumer` → `Run verification` → `Consumer needs one fix` → `Generate safe consumer` → `Safe consumer generated`.
- The generated result visibly enforces `requireHost(requestUrl, EXPECTED_HOST);`.
- Semantic landmarks, labelled regions, named controls, dialog semantics, visible focus states, keyboard-operable buttons, and reduced-motion support are present.
- At `390 × 844`, the CTA is fully visible (`651–707px`), the active Proof stage is brought into view, the timeline remains intentionally scrollable, and the page has no horizontal overflow.
- At `1488 × 1058`, document width and height equal the viewport; there is no page overflow.
- Browser console verification found no runtime errors or warnings.

## Issues found and resolved

- P2: lifecycle and action block were initially too high. Adjusted heading, timeline, status, metadata, and action rhythm to align the reference geometry.
- P2: CTA text was optically left-aligned. Centered the label independently from the trailing arrow.
- P2: mobile CTA could collide with the bottom navigation and the active Proof stage could start offscreen. Compacted the action block and initialized the timeline scroll around the active stage.
- P2: the first logo substitute did not match the render. Replaced it with the reference-derived Proofline mark, corrected its rail alignment, and blended out the crop background.
- P2: an `8px` internal desktop scroll remained. Reduced bottom padding and verified viewport and document dimensions are equal.
- P2: fee copy used `C2FLR` instead of the reference's `ETH`. Added a regression assertion first, observed the failing test, then corrected the data.

## Intentional extension

The verification dialog is an interaction layer opened only after the reference CTA. It does not alter the above-fold reference composition and turns the static render into a complete, demonstrable product loop.

final result: passed
