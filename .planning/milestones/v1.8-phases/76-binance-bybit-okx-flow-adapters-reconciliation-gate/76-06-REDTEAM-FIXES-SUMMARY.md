---
phase: 76
plan: 06-redteam-fixes
subsystem: analytics / flow-aware TWR (v1.8 FLOW-03 + DQ-01/DQ-02)
branch: v1.8-flow-aware-twr
tags: [honesty, own-transfer-filter, dq-guard-bridge, flag-clearing, pagination-dedup]
requires: [76-01, 76-02, 76-03, 76-04]
provides: [phase-76 red-team closure]
affects: [nav_twr, ccxt_flows, ccxt_flow_fetch, job_worker, analytics_runner]
metrics:
  findings: 6
  commits: 5
  new_tests: 9
  suite: "3092 pass / 92 skip (CI-3.12; baseline 3083)"
  completed: 2026-07-06
---

# Phase 76 Plan 06: Red-Team Findings Closure Summary

Closed the 6 phase-76 red-team findings (1 HIGH honesty, 3 MEDIUM, 2 LOW) on
`v1.8-flow-aware-twr`, sequential on the main working tree, each committed
atomically with a mutation-honest regression test where it was a behavior fix.
`transforms.py` untouched (P74 byte-identity pins stay green).

## Findings

| # | Finding | Commit | Kind |
|---|---------|--------|------|
| HIGH-1 | Residual is a construction tautology, was mis-sold as wrong-scope protection | `536fd889` | honesty (no behavior change) |
| MED-1/LOW-2 | None/missing internal marker silently dropped (deposit overstatement / withdrawal understatement) | `dd44c1b1` | behavior |
| MED-2 | DQ-01 guard flags never bridged to the broker factsheet (closes P74 TODO) | `d87d3275` | behavior |
| MED-3 | flow_coverage / guard flags sticky-monotonic across re-derive | `ab12bfa1` | behavior |
| LOW-1 | Pagination window boundary double-counts a boundary-timestamp flow | `698119b5` | behavior |

## What changed

- **HIGH-1** — `reconcile_flow_residual` derives `reconstructed_start` from the
  same rolled NAV, so `residual ≡ 0` for ANY anchor: it detects a roll-loop-vs-Σ
  CODE divergence (dropped/mis-valued flow), NOT an economically-wrong
  anchor/wallet-scope. Corrected the docstring, raise message, and wiring comment;
  rewrote the false `test_reconcile_wallet_scope_mismatch_fails_loud` into
  `test_reconcile_does_not_detect_wrong_scope_anchor`, which PROVES a 20%-low
  anchor sails through (does not raise). Rewrote `76-05-CHECKPOINT.md`: wrong-scope
  has NO automated interim net — caught only at the Phase 78 golden-parity panel +
  founder confirmation; no production factsheet ships first. Residual kept as-is
  (a valid construction check).
- **MED-1/LOW-2** — `ccxt_flows._is_external`: exclude a row ONLY when EXPLICITLY
  internal (`internal is True` / `withdrawType == '1'`); an unclassifiable
  (None/missing) marker is treated as EXTERNAL (kept) for both deposits and
  withdrawals — the anti-overstatement, never-lose-cash direction, consistent with
  the OKX structural stance. Binance `is False → is not True`; bybit
  `== '0' → != '1'`. Module docstring updated.
- **MED-2** — `derive_broker_dailies` now pre-stamps the DQ-01 guard flags
  (`negative_nav_guard` / `dust_nav_guard` / `flow_dominated_guard`) onto
  `strategy_analytics.data_quality_flags` via the same channel as
  `flow_coverage_incomplete`; `run_csv_strategy_analytics` reads/preserves/promotes
  all four → `complete_with_warnings`. Closes the P74 broker→CSV guard-meta gap
  (TODOS.md item marked CLOSED).
- **MED-3** — the pre-stamp is now UNCONDITIONAL and writes the full current flag
  state; the upsert wholesale-replaces the `data_quality_flags` JSONB column, so a
  clean re-derive writes `{csv_source: True}` and clears stale flags before the CSV
  run reads them (healed account → `complete`).
- **LOW-1** — `fetch_ccxt_transfers` dedups collected rows by ccxt transfer `id`,
  killing the boundary double-count from overlapping 90-day windows.

## Files

- `analytics-service/services/nav_twr.py` (HIGH-1 docstring/message/comment)
- `analytics-service/services/ccxt_flows.py` (MED-1/LOW-2 filter + docstring)
- `analytics-service/services/ccxt_flow_fetch.py` (LOW-1 dedup)
- `analytics-service/services/job_worker.py` (MED-2 pre-stamp, MED-3 unconditional)
- `analytics-service/services/analytics_runner.py` (MED-2 read/preserve/promote)
- `analytics-service/tests/{test_nav_twr,test_ccxt_flows,test_exchange_pagination,test_job_worker,test_analytics_runner}.py`
- `TODOS.md` (P74 item CLOSED)
- `.planning/.../76-05-CHECKPOINT.md` (honesty rewrite, local)

## Deviations from Plan

None beyond the HIGH-1-scoped rewrite of the false wallet-scope test (which the
finding explicitly requires — a test asserting a false safety net is corrected to
tell the truth). No architectural changes; no auth gates.

## Self-Check: PASSED

All 5 commits present (`536fd889`, `dd44c1b1`, `d87d3275`, `ab12bfa1`,
`698119b5`); full analytics suite 3092 pass / 92 skip in CI-3.12; no existing test
red (baseline 3083 grew by the 9 new mutation-honest tests).
