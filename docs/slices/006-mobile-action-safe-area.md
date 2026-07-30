# Slice 006 — Mobile action safe area

## Trigger

The authenticated 390×844 browser gate found that the secondary `Export bundle`
action occupied vertical coordinates 769–801 while the fixed mobile navigation
started at 776. The action remained in the accessibility tree, but 25 pixels of
its hit target were visually and physically covered by navigation.

## User result

At the initial mobile cockpit position, the complete next-action block is visible
above fixed navigation. The primary and secondary actions remain reachable by
pointer and keyboard without scrolling to reveal a covered hit target. Desktop
composition remains unchanged.

## Frozen acceptance contract

- At a 390×844 viewport, the bottom edge of every visible next-action interactive
  control is at least eight CSS pixels above the top edge of fixed navigation.
- The contract measures rendered bounding boxes rather than relying on a CSS class
  name or a particular spacing implementation.
- The 1488×1058 layout keeps its accepted cockpit geometry.
- The mobile navigation remains fixed and honors the device safe-area inset.
- Keyboard focus, Consumer Lab Escape behavior, hydration, and bundle replay stay
  green.

## Cycle

1. Contract & Test Designer adds the rendered-layout RED and records the measured
   overlap.
2. Surface Implementer makes the smallest responsive production change to GREEN.
3. Root reruns Web coverage/build and authenticated desktop/mobile browser gates.
4. A new candidate tree is frozen only after the browser geometry, axe, console,
   and network checks pass.
