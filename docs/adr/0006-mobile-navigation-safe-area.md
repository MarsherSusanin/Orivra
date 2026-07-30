# ADR 0006 — Fixed mobile navigation owns a reserved safe area

## Status

Accepted for Slice 006.

## Decision

The fixed mobile navigation owns an explicit vertical safe area. Scrollable
cockpit content must reserve enough space for the navigation height, the device
bottom safe-area inset, and an interaction gap. A visible action cannot depend on
being scrolled out from underneath fixed navigation before its complete hit target
becomes usable.

The acceptance boundary is rendered geometry: a control's bottom edge must stay
above the navigation's top edge. Responsive CSS may satisfy that boundary through
content padding or local action spacing, but it must not move or duplicate the
navigation, hide the secondary action, or alter the accepted desktop layout.

## Consequences

Mobile layout tests need a deterministic viewport and bounding-box-capable DOM.
Browser acceptance repeats the same measurement in Chromium because synthetic DOM
layout alone cannot prove actual fixed-position geometry.
