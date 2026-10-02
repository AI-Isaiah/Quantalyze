---
phase: 78-golden-parity-p72-acceptance-gating
plan: 01
subsystem: analytics-service
tags: [golden-parity, frozen-oracle, twr, acc-01, mutation-honest]
requires:
  - "9a1e7b8e:analytics-service/services/transforms.py (pre-73 anchor-to-today formula, both branches)"
provides:
  - "scripts/golden_parity.py::old_anchor_to_today_returns (frozen daily_pnl-branch oracle)"
  - "scripts/golden_parity.py::old_anchor_to_today_returns_from_trades (frozen individual-trades branch)"
  - "tests/fixtures/golden_parity/oracle_pre73_expected.json (independent pre-73 witness)"
  - "tests/test_golden_parity.py::test_oracle_matches_pre73_golden (mutation-honest golden pin)"
affects:
  - "78-02 (the panel gate driver builds on this frozen oracle for the OLD side of the dual-compute)"
tech-stack:
  added: []
  patterns:
    - "Frozen-oracle verbatim transcription (provenance-commented to a git ref, no runtime import of deleted code)"
    - "Independent golden witness captured once from real old code via throwaway git worktree"
key-files:
  created:
    - analytics-service/scripts/golden_parity.py
    - analytics-service/tests/test_golden_parity.py
    - analytics-service/tests/fixtures/golden_parity/oracle_input.json
    - analytics-service/tests/fixtures/golden_parity/oracle_pre73_expected.json
  modified: []
decisions:
  - "Runtime oracle is a PURE transcription (stdlib+pandas, zero service-graph imports); only the pinning WITNESS is sourced from the real old module, once, offline — preserving both determinism and independence."
metrics:
  duration: ~35m
  completed: 2026-07-07
---

# Phase 78 Plan 01: Frozen Anchor-to-Today Oracle Summary

Stood up the load-bearing OLD half of the ACC-01 golden-parity gate: a pure,
provenance-pinned transcription of the deleted pre-73 anchor-to-today formula
(both branches) plus an independently-captured pre-73 golden series that fails
the pin if the transcription ever drifts.

## What Was Built

- **`scripts/golden_parity.py`** — two pure functions transcribed verbatim from
  `9a1e7b8e:services/transforms.py` L148-215:
  - `old_anchor_to_today_returns(daily_pnl, account_balance)` — the daily_pnl
    branch (LTP path), including the dust floor ($1000), the
    `estimated_start = account_balance - total_pnl` anchor, the
    `estimated_start > 0 else account_balance` fallback that IS the +458% LTP068
    bug, the heuristic-capital else-branch, `equity = initial_capital + cumsum`,
    and the `prev_equity.shift(1).fillna(initial_capital).replace(0, initial_capital)`
    divide-guard.
  - `old_anchor_to_today_returns_from_trades(trades, account_balance)` — the
    parallel individual-trades branch (Open Question 2), covered-by-transcription.
  - stdlib + pandas only; NO import of `services.transforms` / `services.nav_twr`
    (the runtime oracle stays frozen and dependency-free per RESEARCH Pattern 1).
- **`tests/fixtures/golden_parity/oracle_input.json`** — deterministic
  daily_pnl-branch input covering BOTH regimes: an `estimated_start > 0` control
  and an `estimated_start <= 0` (LTP068 profits-withdrawn) case.
- **`tests/fixtures/golden_parity/oracle_pre73_expected.json`** — the independent
  witness, captured ONCE from the REAL
  `services.transforms.trades_to_daily_returns_with_status` at ref `9a1e7b8e`
  via a throwaway `git worktree` (removed after capture), NOT from the Task-1
  transcription.
- **`tests/test_golden_parity.py::test_oracle_matches_pre73_golden`** — pins the
  live oracle to the witness with `assert_series_equal` at rtol 1e-9 across both
  regimes.

## Verification Evidence

- **Golden pin:** `test_oracle_matches_pre73_golden` — **1 passed** in the CI-3.12
  venv.
- **Mutation-honesty (RED-on-neuter, reverted):** dropping the
  `estimated_start <= 0 -> account_balance` fallback (`initial_capital = estimated_start`)
  turned the pin **RED** (`1 failed`); reverting restored **GREEN** (`1 passed`).
  The oracle file was restored to its committed content via `git checkout --`.
- **Witness sanity (manual):** LTP068-shape returns `[0.6, 0.5, -0.0833]` (from
  the buggy $5000 fallback base) vs the control `[0.01026, 0.02030, -0.00498]`
  (from the honest $97,500 anchor) — the inflation is exactly the mechanism the
  gate must expose.
- **Full analytics suite:** **3148 passed / 92 skipped** in the CI-3.12 venv
  (baseline 3147 + this plan's 1 new test). Green; all prior P73–P77 pins intact.

## Commits

- `3875f959` — feat(78-01): frozen anchor-to-today oracle (both branches, transcribed from 9a1e7b8e)
- `50ea07b5` — test(78-01): golden-pin the frozen oracle against an independent pre-73 witness

## Deviations from Plan

**1. [Rule 1 - Bug] Expected-series index name mismatch in the golden pin.**
- **Found during:** Task 2 (first test run).
- **Issue:** The real pre-73 code (and the oracle) wrap
  `pd.DatetimeIndex(groupby-by-"date" index)`, so the returns index carries
  `name="date"`. The witness JSON stores only date+value pairs, so the initial
  expected-series reconstruction produced an unnamed index — `assert_series_equal`
  failed on `names are different ['date'] vs [None]`.
- **Fix:** Set `name="date"` on the reconstructed expected DatetimeIndex to match
  the real code's output shape (byte-identity, not a tolerance fudge).
- **Files modified:** `tests/test_golden_parity.py`.
- **Commit:** folded into `50ea07b5`.

No other deviations. The runtime oracle is a pure transcription; the witness is
independent; the scope fence (`golden_parity.py`, `test_golden_parity.py`,
`fixtures/golden_parity/*`) was respected — `transforms.py`, `metrics.py`,
`nav_twr.py`, `deribit_linear_external_flow_usd`, and the P74 pins were untouched.

## Known Stubs

None. Both oracle branches are fully implemented; the individual-trades branch is
covered-by-transcription (fixture coverage lives on the daily_pnl / LTP path per
RESEARCH Open Question 2). 78-02 wires the driver + per-venue panel that exercises
the oracle end-to-end.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/golden_parity.py
- FOUND: analytics-service/tests/test_golden_parity.py
- FOUND: analytics-service/tests/fixtures/golden_parity/oracle_input.json
- FOUND: analytics-service/tests/fixtures/golden_parity/oracle_pre73_expected.json
- FOUND: commit 3875f959
- FOUND: commit 50ea07b5
