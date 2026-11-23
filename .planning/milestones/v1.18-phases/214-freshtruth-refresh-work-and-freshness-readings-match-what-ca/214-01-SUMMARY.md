---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 01
subsystem: analytics-service
tags: [mt5, diagnosis, characterization-test, freshness]
requires: []
provides:
  - "SC-1 diagnosis record (verdict H1) in 214-DIAGNOSIS.md"
  - "Executable pin: an MT5 series ends on its last ledger-activity day"
affects: [214-03, 214-06]
tech-stack:
  added: []
  patterns: ["characterization test with a neuter-to-RED drill"]
key-files:
  created:
    - analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py
    - .planning/phases/214-freshtruth-refresh-work-and-freshness-readings-match-what-ca/214-DIAGNOSIS.md
  modified: []
key-decisions:
  - "No production code changed: trailing flat days of a ledger-complete account are a routed design property, contained by SC-2's cap"
metrics:
  duration: "about 15 minutes"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: e8e52217bb3e0aacd62251552ddfef9f24cae475
plan_head_after: 27b4efbb77a7d3104add6834002ecd9ccaaccb47
---

# Phase 214 Plan 01: SC-1 diagnosis of the 36-day MT5 series Summary

Verdict H1 recorded and pinned: a ledger-complete MT5 series ends on its last ledger-activity day, so a daily re-derive of an idle account cannot advance `last_return_date`.

## What was built

- `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py`: five pytest cases over the RESEARCH matrix (A healthy, B blow-up then withdrawal, C dust, D idle after withdrawal, E still trading). Fixed 2025 dates, no wall-clock reads.
- `214-DIAGNOSIS.md`: seven sections (verdict, evidence, inferred flag reconciliation, why the cap, routed design property, two residuals, what SC-4 should find). Ages, dates and counts only.

## SC-7 neuter drill (N1)

Backed up `services/broker_dailies.py` to `$TMPDIR/broker_dailies.py.bak`, changed the `pd.date_range` end in `gap_fill_daily_returns` from `returns.index.max()` to `pd.Timestamp.today().normalize()`.

RED: 5 failed. Quoted lines:

```
AssertionError: assert Timestamp('2026-11-14 00:00:00') == Timestamp('2025-10-07 00:00:00')
AssertionError: assert Timestamp('2026-11-14 00:00:00') == Timestamp('2025-10-09 00:00:00')
AssertionError: assert Timestamp('2026-11-14 00:00:00') == Timestamp('2025-10-13 00:00:00')
5 failed in 5.11s
```

Restore: `cp` back, then `cmp` exit 0, `git diff --quiet -- analytics-service/services/` exit 0. GREEN after restore: `5 passed`.

## Measured values vs RESEARCH's table

Case C matched RESEARCH exactly (10-10 and 10-13 NaN with `dust_nav_guard` True, 10-11 and 10-12 gap-filled 0.0). The test also pins that the last NON-NaN row (what the derive stores) is 10-12, a gap-filled 0.0, while the index reaches the last deal day. Case D was run with equity 40 (dust): the series ends on the withdrawal day with a stored 0.0 and `dust_nav_guard` True. The synthetic cases start on a 2025-09-29 deposit; the first row is the deposit day.

## Deviations from Plan

None. Plan executed as written.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-214-01 (identifiers in a public file) mitigated: the verify greps found 0 UUID-shaped strings and 0 home paths in `214-DIAGNOSIS.md`. T-214-02 mitigated by the byte restore and `git diff --quiet`.

## Verification

- `cd analytics-service && python3 -m pytest tests/test_mt5_series_end_is_last_ledger_day.py -q`: 5 passed.
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 before any edit.
- Acceptance greps: 5 `def test_`, 3 `combine_mt5_deal_ledger`, 0 wall-clock reads in the test; 7 `## ` sections, `H1` x3, `gap_fill_daily_returns` x3, `inferred` x3, `tiny_base_days` and `headline_since` named, 0 home paths in the diagnosis.

## Commits

- 74719f378: test(214-01): pin that an MT5 series ends on its last ledger-activity day
- 27b4efbb7: docs(214-01): record the SC-1 diagnosis of the 36-day MT5 series (verdict H1)

## Self-Check: PASSED

Both created files exist; both commits are ancestors of HEAD; STATE.md and ROADMAP.md untouched.
