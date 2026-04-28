# Phase 12 Deferred Items

Items discovered during phase execution but out of scope for current plans.

## Pre-existing test failures (not caused by Phase 12 work)

### test_drain_100_jobs (test_worker_load.py)

- **Discovered:** 2026-04-28 during Plan 12-04 execution
- **File:** `analytics-service/tests/test_worker_load.py:76`
- **Failure:** `mock_dispatch.await_count == total_jobs` → `assert 0 == 100`
- **Root cause:** Pre-existing — confirmed via `git stash`; the test fails on
  `feature/v0.17-sprint-12` BEFORE Plan 12-04's `position_reconstruction.py`
  edit. The mock no longer matches whatever shape the worker dispatch loop
  expects (likely related to the priority-aware claim refactor in Plan 12-07).
- **Suggested follow-up:** Triage in Plan 12-09 (sibling-table parity) or as
  part of a focused worker-test refresh in v0.17.1.

### Pre-existing TS test fixture drift (Plan 12-02 TradeMetrics expansion)

- **Discovered:** 2026-04-28 during Plan 12-09 execution (`npx tsc --noEmit`)
- **Files:**
  - `src/components/strategy/MetricPanel.test.tsx:118` — uses obsolete
    `total_trades` key that does not exist on the frozen `TradeMetrics`
    interface in `src/lib/types.ts`.
  - `src/components/strategy/PositionsTab.test.tsx:31, 106` — fixture object
    missing the 7 derived fields (`expectancy`, `risk_reward_ratio`,
    `weighted_risk_reward_ratio`, `sqn`, `profit_factor_long`,
    `profit_factor_short`, `trade_mix?`) and the 5 reconstruct-positions
    extension fields (`avg_winning_trade`, `avg_losing_trade`,
    `winners_count`, `losers_count`, `realized_pnl_per_trade`).
- **Root cause:** Plan 12-02 expanded the `TradeMetrics` interface to lock in
  the D-13 / H-F frozen contract (`src/lib/types.ts:148-157`); these two test
  files were not migrated alongside that expansion.
- **Suggested follow-up:** Pick up in Phase 14a/14b when these components are
  consumed end-to-end, or in a focused TS test-fixture refresh in v0.17.1. They
  do NOT block Plan 12-09's own contract — `metrics-parity.test.ts` typechecks
  cleanly and runs green.
