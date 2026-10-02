---
status: partial
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
source: [147-VERIFICATION.md]
started: 2026-08-05T09:10:00Z
updated: 2026-08-05T09:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. PROD founder walkthrough — add MT5 strategy `4eab92b0` to a scenario, REFRESH mid-walkthrough
expected: Overlapping-days matches the stored span at N−1 (≈135 vs 136 stored — differencing consumes day one; never assert 136); every metric non-zero; the anchor SURVIVES the refresh (P6 hydration effect).
result: [pending]

### 2. A1 composite check — `SELECT data_quality_flags->'composite' FROM strategy_analytics WHERE strategy_id='4eab92b0…'`
expected: If `true`, the factsheet renders the composite `csv_daily_returns` arithmetic curve while the composer gets the differenced `returns_series` (RESEARCH P8) — re-derive the expected day-count BEFORE judging SC1; record the divergence as known/reviewed, not a defect.
result: PASSED 2026-08-05 (orchestrator PROD read) — composite is NULL (not a composite); returns_series_len=136, csv_days=136 → composer expectation is 135 overlapping days (N−1), no divergence to re-derive.

### 3. A2 missing-row census — `SELECT count(*) FROM strategies s LEFT JOIN strategy_analytics a ON a.strategy_id=s.id WHERE a.strategy_id IS NULL`
expected: Count recorded in the acceptance write-up; the 16h age bound is correct defence-in-depth regardless.
result: PASSED 2026-08-05 (orchestrator PROD read) — 4 strategies have no strategy_analytics row on PROD; age bound is live defence, count recorded.

### 4. OG re-unfurl — request the factsheet OG card with a cache-busting query string
expected: Corrected card (real metrics, finite sparkline) appears. A stale unfurl within the 24h CDN TTL / 7d SWR window is NOT a regression (P10).
result: [pending]

## Summary

total: 4
passed: 2
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
