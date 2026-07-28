---
status: partial
phase: 38-composer-factsheet-parity-blank-mode-fix
source: [38-VERIFICATION.md]
started: 2026-06-25
updated: 2026-06-25
---

## Current Test

[awaiting human testing — needs a deployed build + an authed Chromium session; JSDOM cannot simulate D3 zoom / real SVG events]

## Tests

### 1. Factsheet-grade interactions + shared brush-zoom window (PARITY-01)
expected: Open the scenario composer on a real allocator with a live book. Wheel-zoom the equity chart, drag the MasterBrush window, use keyboard arrow nav — all behave exactly as on the factsheet page, and the drawdown panel moves in sync with the equity panel (shared xRange).
result: [pending]

### 2. Blank-slate scenario overlay end-to-end (PARITY-03)
expected: Open the composer in blank-slate mode (allocator with no connected keys / empty book), add a scenario. The equity projection shows the scenario overlay (not "Equity data warming up"), the "PROJECTED — hypothetical" pill is visible, and NO fabricated live-book baseline line is drawn (only the scenario line).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

None — both items are deferred-by-construction (real D3 zoom/drag/keyboard feel + authed blank-slate render only verifiable in a deployed authed Chromium session). The code paths are proven by the vitest RTL suite (incl. the mutation-falsifiable PARITY-03 blank-slate cases and the shared-window test); these confirm behavior + feel on the live build.
