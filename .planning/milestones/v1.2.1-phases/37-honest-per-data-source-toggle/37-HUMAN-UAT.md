---
status: partial
phase: 37-honest-per-data-source-toggle
source: [37-VERIFICATION.md]
started: 2026-06-25
updated: 2026-06-25
---

## Current Test

[awaiting human testing — gated on prod deploy + Phase-35 backfill + an authed book allocator with ≥2 eligible exchange keys]

## Tests

### 1. Data sources control renders in book mode
expected: Log into a book allocator with ≥2 eligible exchange keys. Open the Scenario tab (book mode). The "Data sources" control renders with one switch per connected exchange key — each row shows exchange + nickname (or masked tail), aria-checked=true by default, accent-outline included state. The D3 gate must be satisfied (all active keys have per-key daily history post-backfill).
result: [pending]

### 2. Toggling a source off honestly recomputes the curve + KPIs
expected: With the control visible, toggle one exchange key off. The equity curve redraws and every KPI (Sharpe, vol, maxDD, return) visibly changes to reflect only the remaining included key(s). The excluded row shows aria-checked=false, neutral outline, "Excluded". No stale blended numbers remain.
result: [pending]

### 3. All-excluded honest empty + re-include restores
expected: Toggle off ALL keys → EmptyStateCard ("Select at least one data source") appears, all KPI slots show "—". Re-include one key → curve + live KPIs instantly restore with no stale number, no page error.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

None — all 3 items are deferred-by-construction (authed live-prod on real per-key
data, only verifiable post-deploy + post-backfill). The code paths are proven by
the vitest RTL suite (incl. the mutation-falsifiable DSRC-03 honesty oracle);
these confirm behavior on real data in a live authenticated session.
