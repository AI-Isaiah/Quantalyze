---
status: partial
phase: 21-surfacing-correlation-honest-projection
source: [21-VERIFICATION.md]
started: 2026-06-21
updated: 2026-06-21
---

## Current Test

[awaiting human / post-deploy /qa browser testing]

## Tests

### 1. Scenario tab placement + keyboard nav
expected: The own-book Scenario tab is visible in the dashboard tablist (not only via `?tab=scenario`), is selected when navigated to, and ArrowLeft/Right reaches it as the last visible tab. (Logic proven: `scenario` in `VISIBLE_TAB_KEYS`, AllocationsTabs tests green.)
result: [pending]

### 2. PROJECTED badge appearance
expected: A persistent "PROJECTED — hypothetical, not your live book" pill renders on the projection header of BOTH the own-book composer and the /scenarios Sandbox as a calm neutral outline (NOT accent-filled, NOT amber/red, no role=alert). (Logic proven: token classes asserted in tests.)
result: [pending]

### 3. Strategy Sandbox sidebar gating
expected: An allocator sees the "Strategy Sandbox" sidebar link (with "Example universe" badge); a strategy-manager and an admin-only user see NO link. (Logic proven: gated on `isAllocator`, Sidebar tests green; server gate at scenarios/page.tsx unchanged.)
result: [pending]

### 4. Heatmap scroll at large N
expected: A scenario with >10 strategies renders ALL strategies in a scrollable (max-h-70vh, both-axis) container with legible cells — no truncation, no layout push. (Logic proven: pickTopTenByAvgCorr removed, in-component scroll container; tests green.)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

(none — all automated must-haves verified 9/9; these are visual confirmations deferred to post-deploy /qa)
