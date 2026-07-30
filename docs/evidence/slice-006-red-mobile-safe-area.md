# Slice 006 RED — mobile action safe area

## Browser evidence

The production build was opened at the accepted deep route with authenticated
fixture API responses and a 390×844 Chromium viewport. Bounding boxes were:

- `Export bundle`: `x=170.88`, `y=769`, `width=124.23`, `height=32`;
- fixed `.sidebar`: `x=0`, `y=776`, `width=390`, `height=68`.

The secondary action therefore extended to `y=801`, overlapping navigation by 25
CSS pixels. The required eight-pixel interaction gap was missed by 33 pixels.

## Frozen RED

`src/mobile-safe-area.contract.test.ts` loads the shipped stylesheet into the
hermetic DOM and evaluates the responsive cascade at 1488 and 390 CSS pixels. The
desktop control remains inline. The mobile contract confirms fixed 68px navigation
and its existing shell reserve, then rejects stacking the secondary action into a
second footer row—the causal layout change that produced the measured overlap.

The hermetic DOM cannot produce trustworthy bounding boxes. Root browser
acceptance remains authoritative for the final geometric invariant:

`secondaryAction.bottom + 8 <= fixedNavigation.top`

The Surface Implementer may change responsive layout only. This frozen test,
navigation placement, desktop geometry, and browser inequality must not be
weakened.
