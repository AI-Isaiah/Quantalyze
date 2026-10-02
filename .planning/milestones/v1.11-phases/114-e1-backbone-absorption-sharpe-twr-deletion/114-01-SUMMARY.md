---
phase: 114-e1-backbone-absorption-sharpe-twr-deletion
plan: 01
subsystem: analytics-service (metrics parity)
tags: [parity-gate, backbone, sharpe, twr, oracle, census]
requires: [services.metrics.compute_all_metrics, services.portfolio_metrics.compute_twr, routers.portfolio._compute_sharpe_and_vol]
provides: [golden-parity-gate, caller-census-pin]
affects: [114-02, 114-03]
tech-stack:
  added: []
  patterns: [independent-inline-oracle, anti-tautology-divergence-datum, executable-caller-census]
key-files:
  created:
    - analytics-service/tests/test_e1_sharpe_twr_parity.py
  modified: []
decisions:
  - "Parity proven via inline pandas oracle (r.std()·√252, eq[-1]/eq[0]−1), never by calling the deletion targets as their own reference — transitive legacy ≡ backbone with no tautology"
  - "Day-0-exclusion divergence (cumulative_return ≠ legacy endpoint TWR) asserted as a REAL difference; pins that plan 114-02 must derive TWR from equity endpoints, not read cumulative_return"
metrics:
  duration: ~15m
  completed: 2026-07-17
requirements: [BACKBONE-01]
---

# Phase 114 Plan 01: E1 Sharpe/TWR Golden-Parity Gate Summary

Built the independent golden-parity gate for the E1 backbone-absorption deletion:
`analytics-service/tests/test_e1_sharpe_twr_parity.py` (14 tests, GREEN on the
current pre-change tree) proves — with an inline pandas/numpy re-derivation that
never calls the soon-to-be-deleted code as its own reference — that legacy
`_compute_sharpe_and_vol` + `compute_twr` are exactly reproducible from the
unified backbone `compute_all_metrics`, and pins the whole-tree caller census as
an executable, re-runnable sweep.

## Parity result: GREEN

`cd analytics-service && .venv/bin/python -m pytest tests/test_e1_sharpe_twr_parity.py -q`
→ **14 passed** (12 warnings — quantstats noise on the flat/degenerate fixtures,
not failures). `git status` shows ONLY the new test file; zero production files
touched.

Measured parity margins (fixture a, seed 114):
- backbone `volatility` vs oracle: rel 0.0
- backbone `sharpe` vs oracle: rel 1.48e-16 (< REL_TOL 1e-12)
- legacy `_compute_sharpe_and_vol` vs oracle: rel 0.0 on vol/mean/sharpe
- legacy `compute_twr` vs endpoint oracle: rel 0.0
- day-0 divergence: |cumulative_return − legacy TWR| ≈ 9.39e-3 (r_0 = −0.00752),
  and `(1+twr)·(1+r_0)−1 == cumulative_return` to rel 1e-12 (exact reconciliation).

## Caller census (BACKBONE-01 clause 4) — pinned inventory

Whole-tree word-boundary sweep for `compute_twr` and `_compute_sharpe_and_vol`
across `analytics-service/` (excl. `.venv`, `__pycache__`, and the oracle file
itself). 257 `.py` files scanned (>=100 neutered-walk guard). Found-file set
equals the pin exactly:

| File | Symbol(s) | Disposition |
|------|-----------|-------------|
| `routers/portfolio.py` | `_compute_sharpe_and_vol` (L596 def), `compute_twr` (L32 import + call sites L811/L835/L948/L985/L2302/L2306) | DELETE/RE-ROUTE (114-02/03) |
| `services/portfolio_metrics.py` | `compute_twr` def (+2 internal log strings) | DELETE (114-03) |
| `services/equity_reconstruction.py` | `compute_twr` (L2972 method + L3081 self-call) | **EXEMPT** — same-named METHOD on EquityCurveBuilder, Phase 115 / STITCH-02 scope |
| `tests/test_portfolio_metrics.py` | `compute_twr` | migrate 114-03 |
| `tests/test_nav_twr.py` | `compute_twr` (L316 with-events use) | migrate 114-03 |
| `tests/test_portfolio_router_audit_2026_05_07.py` | `_compute_sharpe_and_vol` | migrate 114-03 |
| `tests/test_coverage_extras.py` | `compute_twr` | migrate 114-03 |
| `tests/test_equity_curve_builder.py` | `builder.compute_twr()` METHOD calls | **EXEMPT** — no changes this phase |

**Railway one-off scripts clean (zombie-trap cleared):** grep of every
`analytics-service/scripts/*.py` (bybit_reconcile, deribit_acceptance,
deribit_ground_truth, gen_blend07_fixture, golden_parity, phase12_deploy,
phase12_kill_switch, **phase35_backfill_enqueue**, probe_exchange_egress,
record_cassettes, reset_stuck_computing_rows, zavara_acceptance) → **ZERO hits**.
Encoded as `test_railway_oneoff_scripts_are_clean_of_deletion_targets`.

## CONTEXT corrections recorded

1. **Stale filename:** CONTEXT's `scripts/phase12_backfill_enqueue.py` does NOT
   exist. The real backfill-enqueue one-off is `scripts/phase35_backfill_enqueue.py`
   (verified clean of both deletion targets).
2. **`_compute_sharpe_and_vol` location:** defined in `routers/portfolio.py` L596
   — NOT in `services/portfolio_metrics.py` as CONTEXT claimed.
3. **`equity_reconstruction.py` exemption:** its `compute_twr` (L2972) is a
   same-named METHOD on `EquityCurveBuilder`, NOT the deleted free function; it
   does not import `portfolio_metrics`. Phase 115 (STITCH-02) territory, untouched
   here. `tests/test_equity_curve_builder.py` needs no changes this phase.
4. **KEEP-path importer noted:** `routers/process_key.py` L1018 imports
   `compute_period_returns` from `portfolio_metrics` (must survive the 114-03 delete).
5. **Separate duplicate noted:** `services/portfolio_optimizer.py` has its own
   private `_compute_sharpe` (a different symbol) — NOT a Phase-114 deletion
   target; flagged for a future absorption decision.

## Anti-tautology / semantic-trap coverage

- `TestBackboneDerivationParity.test_day0_exclusion_divergence` asserts the
  backbone `cumulative_return` (Π(1+r)−1, INCLUDING day 0) is NOT ≈ the legacy
  endpoint-ratio TWR (which EXCLUDES day 0), and reconciles the difference to the
  exact `(1+r_0)` factor. This proves the gate CAN fail and pins WHY plan 114-02
  must derive TWR from equity endpoints (`total_return_from_equity`), not read
  `cumulative_return`.
- `TestLegacyParityBaseline.test_sharpe_and_vol_all_nan_returns_nan_vol_without_raising`
  pins the degenerate all-NaN (len 5) graceful baseline: legacy returns exactly
  `(None, None, None, "nan_vol")` WITHOUT raising — the observable behaviour the
  plan-02 helper must reproduce without feeding the full pipeline (the all-NaN
  input slips past compute_all_metrics's `len<2`-only guard).

## Deviations from Plan

None — plan executed exactly as written. Zero production changes; zero packages
installed (T-114-SC accept upheld).

## Downstream

`TestLegacyParityBaseline` and the two legacy imports are TEMPORARY (a header
comment states so) — deleted by plan 114-03 with the symbols. The caller census
`_PINNED_INVENTORY` is updated by 114-03 as the legacy references disappear.

## Self-Check: PASSED

- `analytics-service/tests/test_e1_sharpe_twr_parity.py` — FOUND
- Commit `86f3e282` — FOUND (`test(114-01): golden-parity gate for E1 Sharpe/TWR backbone absorption`)
- 14 tests GREEN; `git status` clean apart from the committed test file
