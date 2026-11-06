---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 01
subsystem: measurement
tags: [sc-1, prod-read-only, derivegaps, census]
requires: []
provides:
  - "SC-1 database half: PROD counts for Gaps 1 to 3 and the strategy-path exposure"
affects: [186-04, 186-14]
tech-stack:
  added: []
  patterns: [read-only PROD census through the marker-gated CLI]
key-files:
  created:
    - .planning/phases/186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed/186-01-SUMMARY.md
  modified: []
decisions: []
metrics:
  duration: "~10 min"
  completed: 2026-11-03
status: complete
actuals:
  tokens: 2500
  tasks: 2
  commits: 0
plan_head_before: 57d07c9499a7436200d42d1de1f69b3c3e9b5dad
plan_head_after: 57d07c9499a7436200d42d1de1f69b3c3e9b5dad
---

# Phase 186 Plan 01: SC-1 database counts Summary

Read-only PROD counts for the derive-gap phase, taken after the marker named PRODUCTION: the database holds no eligible failing key and no stored curve carrying a gap token, so the Gap 3 population is empty today.

## Readings

marker: PRODUCTION
rls: bypasses_rls=true

The marker was run alone and first, and its answer equalled `database_marker` in the prober manifest. The `rls` probe answered `bypasses_rls`. Every other query ran in its own call. No writing statement was run. `commits: 0` in the frontmatter is the measured count of code commits for this plan (docs-only plan; the SUMMARY is the plan's only commit and it is recorded by the orchestrator).

### Gap 1 proxy (strategy_analytics data_quality_flags)

sc1-db: g1 dq.daily_pnl_fetch_error 0
sc1-db: g1 dq.daily_pnl_truncated_bybit 0
sc1-db: g1 dq.daily_pnl_truncated_okx 0
sc1-db: g1 strategy_analytics_rows 45

### Gap 2 candidates (live Bybit keys, stored key_inputs flows)

sc1-db: g2 bybit_live_keys 1
sc1-db: g2 bybit_live_keys_stored_flows_positive 0
sc1-db: g2 bybit_live_keys_stored_flows_zero 1
sc1-db: g2 bybit_live_keys_stored_flows_zero_and_anchor_positive 1
sc1-db: g2 bybit_live_keys_with_key_inputs 1

### Gap 3 (key states and stored curves)

sc1-db: g3 eligible_failing_keys 0
sc1-db: g3 eligible_keys 26
sc1-db: g3 equity_curve_rows 7
sc1-db: g3 equity_curve_rows.failing_key_series_ended 0
sc1-db: g3 equity_curve_rows.refusal_compose_empty_blocked 0
sc1-db: g3 equity_curve_rows.refusal_compose_incomplete 0
sc1-db: g3 failing.no_returns_no_inputs 0
sc1-db: g3 failing.no_returns_with_inputs 0
sc1-db: g3 failing.series_ended_before_book_last_day 0
sc1-db: g3 failing.series_reaches_book_last_day 0
sc1-db: g3 owners_with_failing_key 0
sc1-db: g3 owners_with_failing_key_and_a_working_key 0

### Strategy-path exposure

sc1-db: g5 composite_strategies_with_bybit_member 0
sc1-db: g5 composite_strategies_with_ccxt_member 0
sc1-db: g5 equity_curve_rows.shared_account_no_working_key 0
sc1-db: g5 strategies_single_key_ccxt 5
sc1-db: g5 strategies_single_key_ccxt.bybit 1
sc1-db: g5 strategies_single_key_ccxt.okx 4

### Census labels c, d, e

sc1-census: c eligible_keys 26
sc1-census: c eligible_keys_missing_key_inputs 0
sc1-census: c eligible_keys_missing_returns 1
sc1-census: c owners_missing_either 1
sc1-census: c owners_missing_key_inputs 0
sc1-census: c owners_missing_returns 1
sc1-census: c owners_with_eligible_keys 7
sc1-census: d degrade_reason=classified_rotation 3
sc1-census: d degrade_reason=window_truncated 4
sc1-census: d equity_curve_rows 7
sc1-census: d version=2,is_trustworthy=true 7
sc1-census: e owners_with_eligible_keys 7
sc1-census: e ready 7

## Reading

- Gap 1 (`g1`): the incremental-sync proxy shows `dq.daily_pnl_truncated_okx`, `dq.daily_pnl_truncated_bybit` and `dq.daily_pnl_fetch_error` all at 0 across 45 `strategy_analytics_rows`. This is a lower bound only: it reflects the flags the incremental strategy sync stamped, not the derive's full-history read, so the real Gap 1 count is plan 186-04's probe.
- Gap 2 (`g2`): `bybit_live_keys` is 1, with `bybit_live_keys_with_key_inputs` 1, `bybit_live_keys_stored_flows_zero` 1 and `bybit_live_keys_stored_flows_zero_and_anchor_positive` 1. That one key is a candidate (empty stored flows, positive anchor); this does not prove an internal transfer exists, the probe does.
- Gap 3 (`g3`): `eligible_failing_keys` is 0 of 26 `eligible_keys`, so every `failing.*` bucket and both owner buckets are 0, and no stored curve carries the legacy token (`equity_curve_rows.failing_key_series_ended` 0, `equity_curve_rows.refusal_compose_incomplete` 0, `equity_curve_rows.refusal_compose_empty_blocked` 0 across 7 `equity_curve_rows`). The compose bug is real in code but affects no key or curve on PROD at this reading, which is the baseline plan 186-14 compares against.
- Strategy path (`g5`): `strategies_single_key_ccxt` is 5 (`strategies_single_key_ccxt.okx` 4, `strategies_single_key_ccxt.bybit` 1), while `composite_strategies_with_ccxt_member` and `composite_strategies_with_bybit_member` are both 0 and `equity_curve_rows.shared_account_no_working_key` is 0. For plan 186-04's gate: the composite member path question has no PROD population, and the shared-account-with-no-working-key question has no stored row.
- Census: `sc1-census: c eligible_keys_missing_returns` is 1 (one owner, `owners_missing_returns` 1) with `eligible_keys_missing_key_inputs` 0; `sc1-census: d` shows 7 curves, all `version=2,is_trustworthy=true`, carrying `degrade_reason=window_truncated` on 4 and `degrade_reason=classified_rotation` on 3; `sc1-census: e` shows all 7 owners `ready`.
- Gap 4 has no database count: the dropped same-hour funding leg is dropped before insert and `funding_fees` cannot show it. Plan 186-04's probe is the only measurement.

## Deviations from Plan

None - plan executed exactly as written. The scratch directory used was the orchestrator-assigned one rather than the `$HOME/.cache` default in the plan's standing rules; nothing from it is tracked.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. Only aggregate `bucket, n` rows crossed into this file; no identifier, label, amount or path.

## Self-Check: PASSED

- Task 1 automated verify passed (all nine SQL files start with SELECT or WITH, no writing keyword in the four hand-written files, no scratch file tracked).
- Marker ran alone and first and equalled the manifest value; `rls` answered `bypasses_rls`.
