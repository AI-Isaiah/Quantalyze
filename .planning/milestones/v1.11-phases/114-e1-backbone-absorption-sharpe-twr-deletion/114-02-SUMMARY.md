---
phase: 114-e1-backbone-absorption-sharpe-twr-deletion
plan: 02
subsystem: analytics-service (metrics backbone absorption)
tags: [backbone, sharpe, twr, re-route, byte-parity, anti-500]
requires: [services.metrics.compute_all_metrics, golden-parity-gate]
provides: [total_return_from_equity, sharpe_vol_status_from_backbone, portfolio-callsites-rerouted]
affects: [114-03]
tech-stack:
  added: []
  patterns: [backbone-derived-helper, pre-pipeline-degenerate-guard, endpoint-ratio-twr, oracle-pinned-helper]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/routers/portfolio.py
    - analytics-service/tests/test_e1_sharpe_twr_parity.py
decisions:
  - "TWR derives from the equity ENDPOINT ratio (eq[-1]/eq[0]-1) in total_return_from_equity, NOT from backbone cumulative_return (which includes day 0) — the 114-01 oracle asserts that day-0 divergence, so reading cumulative_return would shift displayed numbers"
  - "sharpe_vol_status_from_backbone has TWO pre-backbone guards (len<=1 -> insufficient_history, pd.isna(std) -> nan_vol) so a degenerate all-NaN len>=2 series never reaches compute_all_metrics — anti-500 graceful path, proven structural by a monkeypatch-raise test"
  - "Legacy nan_mean/nan_sharpe documented as proven-unreachable dead branches under pandas skipna, NOT synthesized; mean_ret dropped from the 4-tuple because both call sites discard it"
  - "Legacy defs (_compute_sharpe_and_vol, compute_twr) KEPT this wave — only their USES are gone, so a parity failure aborts with nothing deleted (delete is 114-03)"
metrics:
  duration: ~20m
  completed: 2026-07-17
requirements: [BACKBONE-01]
---

# Phase 114 Plan 02: E1 Backbone Absorption — Re-route Summary

Re-routed all six legacy Sharpe/vol/TWR call sites in
`analytics-service/routers/portfolio.py` onto two new backbone-derived helpers in
`services/metrics.py`, byte-preserving displayed numbers and the
vol_status/sharpe_status data-quality channel. Legacy definitions stay in place
(their delete is the gated job of plan 114-03) — this wave removes only their
USES, so it is fully reversible and every legacy test stays green with zero edits.

## Result: GREEN

- `tests/test_e1_sharpe_twr_parity.py` — **21 passed** (14 original 114-01 pins +
  7 new permanent helper pins), including the degenerate all-NaN status-parity
  test and the monkeypatch structural-short-circuit proof.
- `tests/test_metrics.py` — **151 passed** (no regression to compute_all_metrics).
- Full analytics suite `pytest -q -p no:cacheprovider` — **3701 passed, 93
  skipped, 0 failed**, with ZERO test-file edits in Task 2 (byte-parity: any
  edit would have been a parity break).

## What changed

### New helpers (`services/metrics.py`, co-located below `compute_all_metrics`)
- `total_return_from_equity(equity) -> float | None`: endpoint-ratio total
  return with the legacy None guards (None / len<2 / zero first value → None,
  the zero-first case logging an M-0698-shaped warning).
- `sharpe_vol_status_from_backbone(returns, periods_per_year=252) -> (vol,
  sharpe, status)`: reads `volatility`/`sharpe` from `compute_all_metrics`,
  fronted by two pre-backbone guards.

### Six re-routed call sites (`routers/portfolio.py`)
1. L32 import — drop the legacy TWR-scalar import; add the two new helpers.
2. Per-strategy TWR loop → `total_return_from_equity(eq)`.
3. Portfolio TWR → `total_return_from_equity((1+portfolio_returns_series).cumprod())`.
4. Benchmark BTC TWR → `total_return_from_equity((1+b_aligned).cumprod())`.
5. Portfolio Sharpe/vol → `sharpe_vol_status_from_backbone(...)` (3-wide tuple).
6. verify_strategy TWR + Sharpe/vol → both helpers; comment updated to note the
   unified-backbone derivation.

`compute_twr` no longer appears in `portfolio.py` at all;
`_compute_sharpe_and_vol` appears ONLY at its def block (L601) — zero call sites.
The `vol_status`/`sharpe_status` persistence dict lines (L1089-1090) are
byte-unchanged.

## Verifier-guidance note (WARNING 2 — required)

The ROADMAP goal "the allocator/scenario Sharpe and TWR DERIVE from the one
backbone (`compute_all_metrics`)" is satisfied in the intended
**single-home-in-the-backbone-MODULE** sense:

- Sharpe/vol are read DIRECTLY from `compute_all_metrics` output.
- TWR is computed by `total_return_from_equity` — an endpoint-ratio
  (`eq.iloc[-1]/eq.iloc[0]-1`) helper **CO-LOCATED in `services/metrics.py`** (the
  backbone module), rather than a value read out of the `MetricsResult` dict.

This is the deliberate, byte-identical choice. The 114-01 oracle
(`test_day0_exclusion_divergence`) asserts that `cumulative_return` differs from
the legacy endpoint-ratio TWR by exactly the day-0 `(1+r_0)` factor, so reading
`cumulative_return` WOULD change displayed numbers. Downstream verifiers must NOT
flag "TWR does not literally come out of `compute_all_metrics`" as a goal-miss —
the goal is single-source-in-the-backbone-module, and that is met.

## Anti-500 / dead-branch notes

- The degenerate all-NaN (len>=2) fixture returns exactly `(None, None,
  "nan_vol")` WITHOUT raising — the `pd.isna(returns.std())` guard keeps it out of
  the full pipeline (monthly resample / cumprod / qs.stats.*). A monkeypatch test
  patches `compute_all_metrics` to raise and proves the degenerate paths (1-sample
  and all-NaN) STILL return the graceful tuples, i.e. the short-circuit is
  structural, not incidental.
- Legacy `nan_mean`/`nan_sharpe` are documented in the helper docstring as
  proven-unreachable dead branches under pandas skipna and are NOT synthesized.
- WORDING: no new comment/docstring in `metrics.py` or `portfolio.py` contains the
  bare deletion-target token (the 114-01 caller census, which scans tree-wide for
  both symbols, stays green — `metrics.py` has 0 occurrences).

## Deviations from Plan

None functionally. One wording adjustment inside Task 1: the plan's WARNING-3
only called out the `compute_twr` token, but the 114-01 caller census also scans
for the Sharpe-helper token tree-wide. An initial docstring draft referenced the
bare legacy Sharpe-helper symbol, tripping the census (metrics.py appeared as a
"new caller"); reworded to "the deleted legacy Sharpe/vol helper" so the census
stays green. No behavior change; caught by the gate as designed.

## Downstream (114-03)

Legacy `_compute_sharpe_and_vol` (portfolio.py L601 def) and `compute_twr`
(portfolio_metrics.py) are now dead code — no production call sites remain. Plan
114-03 performs the gated delete + census-pin update + legacy-test migration.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` — FOUND (both helpers present)
- `analytics-service/routers/portfolio.py` — FOUND (six sites re-routed)
- `analytics-service/tests/test_e1_sharpe_twr_parity.py` — FOUND (21 tests)
- Commit `13717bb9` (Task 1) — FOUND
- Commit `81d91c18` (Task 2) — FOUND
- Oracle + status-parity + monkeypatch tests GREEN; full suite 3701 passed
