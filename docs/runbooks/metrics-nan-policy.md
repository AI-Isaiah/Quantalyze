# Metrics NaN policy (B3, audit-2026-05-07)

**Status**: active

This runbook is the single source of truth for how NaN, empty buckets, and
zero-return windows are treated across the metrics layer. Three classes
of bugs (NEW-C02-03, NEW-C02-04, NEW-C02-05) all stemmed from per-file
NaN-handling drift. The rules below are enforced by the closures
documented inline and the tests cited at each section.

## Rule 1 — Headline scalars share one NaN policy

The headline scalars on the strategy factsheet — `cumulative_return`,
`total_return`, `cagr`, `sharpe`, `sortino`, `max_drawdown` — must be
computed over the **same `returns` series**. Either all `dropna()` or
all `fillna(0)`, never a mix.

The repo's chosen policy is `dropna()`: a NaN in the input series means
"no observation," not "zero return." `cumulative_return` previously
called `fillna(0)` while the other scalars used the raw NaN-bearing
series — so two LPs reading the same factsheet would see a higher
cumulative return number than the Sharpe / max-DD implied.

- **Producer site**: `analytics-service/services/metrics.py` —
  see the `NEW-C02-05` comment at the headline-scalar block.
- **Closure test**: `analytics-service/tests/test_metrics.py` ::
  `test_headline_scalars_same_nan_policy` (and the cluster of
  NEW-C02-05 regression tests adjacent).

## Rule 2 — Resample buckets reject empty calendar periods

Monthly / weekly / VaR-1M-99 cells use `resample(...).agg(min_count=1)`
followed by `.dropna()`. `min_count=1` makes pandas emit NaN — not zero
— for buckets containing no observations; the `.dropna()` removes those
NaN cells from the rendered grid so an empty period reads as `—`, never
as `0.00%`.

Pre-fix: `resample("ME").mean()` returned 0 for empty months, which the
factsheet then rendered as a confident "0.0%" cell, indistinguishable
from a real flat month. A January→March history with no February
observations rendered as if February were flat — exactly the bias
NEW-C02-04 closed.

- **Producer site**: `analytics-service/services/metrics.py` —
  `NEW-C02-04` comments at the resample blocks (monthly + weekly).
- **Closure test**: `analytics-service/tests/test_metrics.py` ::
  `test_no_phantom_zero_for_empty_calendar_bucket` and the weekly
  variant.

## Rule 3 — Streak counters use symmetric strict masks

`consecutive_wins` and `consecutive_losses` both use the **strict**
comparison `(returns > 0)` / `(returns < 0)`. Flat days (`returns == 0`)
and NaN gaps break **both** streaks symmetrically.

Pre-fix: `consecutive_losses` counted flat days AND NaN gaps as losses,
producing values much higher than `consecutive_wins` even on a balanced
series. The asymmetry biased the "worst loss streak" KPI on every
factsheet.

- **Producer site**: `analytics-service/services/metrics.py` — the
  streak block carries a `NEW-C02-03` comment documenting the strict
  comparison contract.
- **Closure test**: `analytics-service/tests/test_metrics.py` ::
  `test_streak_counters_symmetric_with_flats_and_nans`.

## Rule 4 — Annualize over business days (B3 followup)

Annualized scalars (`cagr`, `volatility`, `sharpe`, `sortino`) must use
`periods=252` only when the input series is at business-day frequency.
Calendar-daily series (Saturdays / Sundays present) must either
`resample("B")` or use `periods=365` — never `periods=252` against a
calendar series.

Pre-fix: a calendar-daily series annualized with `periods=252` inflated
volatility by ~`sqrt(365/252)` ≈ 1.20×, deflating Sharpe / Sortino by
the inverse. NEW-C01-15 closed this for the equity-reconstruction path
(`analytics-service/services/equity_reconstruction.py`); future
annualization sites must honor the same rule.

- **Closure test**: `analytics-service/tests/test_equity_reconstruction.py` ::
  `test_calendar_vs_business_day_annualization_matches_within_001`.

## Rule 5 — Window-coincident metric pairs

Any code path that compares a "current" metric to a "proposed" metric
(simulator delta chips, match-engine portfolio-fit components, portfolio
bridge) MUST score both metrics over the **same** date intersection.

Use the shared helper `analytics-service/services/window_alignment.py`
:: `align_current_and_proposed`. Do NOT inline a `pd.concat(...).dropna()`
- that is exactly the drift NEW-C08-01 / NEW-C11-03 closed for the two
existing sites; a future third site that inlines its own join will
silently re-introduce the structural bug.

- **Closure tests**: `analytics-service/tests/test_window_alignment.py`
  pins the helper contract; the call sites have their own regression
  specs (`test_simulator_scoring.py`, `test_match_engine.py`).

## Rule 6 — Truthy fields vs `is not None`

For numeric DB fields where `0` is a legitimate, semantically distinct
value (`current_weight`, `total_aum`, `cum_return`), use `is not None`
to test presence — never bare truthiness. `if row.get("current_weight"):`
silently treats a paused 0%-weight strategy as missing, then defaults to
1.0 on the rebase pass — producing a portfolio where the paused
strategy dominates the allocation (NEW-C19-05).

The full sweep of sites that needed this correction is documented in
the closure comments at each call site (`NEW-C19-04`, `NEW-C19-05`,
`NEW-C19-06`, and a B3.4 sweep of adjacent analytics callers).

## Closing checklist

When adding a new metric or chart:

1. [ ] Does it consume `returns`? If yes — does it follow Rule 1 (same
       NaN policy as the headline block)?
2. [ ] Does it resample to a calendar bucket (monthly, weekly, VaR-1M)?
       If yes — does it use `min_count=1 + dropna`? (Rule 2)
3. [ ] Does it count a streak / consecutive event? If yes — does it use
       a symmetric strict mask, not `>=` / `<=`? (Rule 3)
4. [ ] Does it annualize? If yes — is the input series at business-day
       frequency or calendar-daily? (Rule 4)
5. [ ] Does it compare current-vs-proposed metrics? If yes — does it
       go through `align_current_and_proposed`? (Rule 5)
6. [ ] Does it test a numeric field for presence? If yes — `is not None`
       or `key in dict`, never bare truthiness? (Rule 6)

A new metric that fails any checkbox should NOT be merged until the
matching closure test exists.
