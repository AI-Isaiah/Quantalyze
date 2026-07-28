---
status: passed
phase: 31-graphs-lead-layout-collapsible-controls
source: [31-VERIFICATION.md]
started: 2026-06-23T19:24:00Z
updated: 2026-06-24
resolved: 2026-06-24 via headed /qa — see 31-VERIFICATION.md
---

## Current Test

[complete — resolved 2026-06-24 via headed /qa, see 31-VERIFICATION.md
(`human_verification_resolved` block: Playwright MCP, user-provided allocator login on prod)]

## Tests

### 1. Live collapse UX — graphs lead
expected: On the unified composer, collapsing the "Strategies & weights" controls
visually lets the factsheet graphs lead the surface; re-expanding restores the controls.
(CSS layout / scroll — jsdom cannot verify.)
result: passed — collapsing hides the controls list and the graphs lead the surface
(details.open=false, affordance flips Hide→Show; HIDE-not-UNMOUNT confirmed — list stays
in DOM but is visually clipped; screenshot qa-p31-collapsed-state.png).

### 2. Collapse-state persistence across a real reload
expected: Collapse the controls, reload the page → the controls stay collapsed
(the `composer-collapse:controls` localStorage key, via useCrossTabStorage, survives
a real reload). Sign out on a shared device → the key is purged (cross-account
isolation; CR-01 fix).
result: passed — collapse choice survives reload (composer-collapse:controls='closed',
details stays closed).

### 3. Factsheet Reset view end-to-end (lift regression)
expected: On `/factsheet/[id]/v2`, the renamed `COLLAPSIBLE_OPEN_ALL_EVENT` + the
`onToggle` analytics wiring behave exactly as before — "Reset view" pops all
sections open and section-toggle analytics still fire.
result: passed — collapsing Performance+Distribution then "Reset view" re-opens ALL
sections (allOpen=true); 0 console errors on composer + factsheet.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — all 3 items resolved live 2026-06-24.
