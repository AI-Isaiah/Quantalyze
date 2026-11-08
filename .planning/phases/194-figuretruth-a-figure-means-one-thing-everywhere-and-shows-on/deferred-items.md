# Phase 194 deferred items (out of scope for the plan that found them)

## Found by 194-02 (2026-11-07)

- `src/lib/factsheet/compute.conventions.test.ts`, "fixture B" and "fixture C" (D-36 FROZEN snapshot):
  `skew` differs in the last digit (`-0.11360716852722537` expected, `-0.11360716852722538` received;
  `0.036844507138639` expected, `0.036844507138638946` received). It fails identically with the 3M
  window constant set back to 90 (measured), and nothing 194-02 changed feeds `skew`, so it predates
  194-02. Likely a Node/V8 float-summation difference between the frozen snapshot's
  machine and this one. Not fixed here.
- `analytics-service/tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`:
  fails locally only because `pytest-xdist` is not installed in this Python (`unrecognized arguments: -n --dist`).
  Environmental; CI installs it.

## Found by 194-21 (2026-11-07)

- `src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx` (`computeBookAlphaBeta`) is not gated by D-15.
  The Overview's alpha for the same book now goes through `buildComparatorBlock`'s record gate, so a book whose total record is
  under 90 days (crypto basis) prints a dash in the Overview's alpha cell while the widget beside it still prints an annualized
  alpha. D-69 ("one number or neither") held before 194-21 and no longer holds on a short book. No 194 plan names the widget.
  `AlphaBetaDecomposition.book-btc.test.tsx` was edited so its parity cases run on a record that clears D-15 (90 unpaired
  earlier days), which keeps them testing the paired count and does not hide this gap. Needs the same `figureRecord` /
  `gateAnnualized` verdict in the widget, built from the book's record, plus a parity case on a short book.
- `src/app/(dashboard)/allocations/RiskTabPanel.book-series.test.tsx` ("VaR renders a value computed from the book's 60 daily
  returns") failed once in a 332-file run at machine load and passed alone and on the next full run. Not touched by 194-21.

## Found by 194-06 (2026-11-07)

- `src/app/factsheet/[id]/v2/MetricsColumn.arithmetic-windows.test.tsx` (2 tests: "arithmetic: Month-to-date ... 3 Month ..."
  and "geometric (no method)"): the `p3m` cell reads `+36.42%` where the test expects `+36.85%`, and `+42.50%` where it
  expects `+43.12%`. A 3 Month window figure, so it is the D-03 calendar 3M change from plans 02/03 meeting a fixture that
  predates it. 194-06 changes no factsheet file (it touches `StrategyTable`, `queries.ts`, `types.ts` and their tests), so
  this predates it. Not fixed here; the plan that owns the factsheet rail's 3M cell should re-derive the expected values.
- `StrategyGrid.tsx` (grid mode) still prints `formatPercent(s.analytics.cagr)` ungated, so a card can show a CAGR the
  table withholds. It is outside 194-06's `files_modified` and the plan names only the table's cells. Needs the same
  `figureRecord` / `gateAnnualized` call (the row record builder `rowRecord` lives in `StrategyTable.tsx`; share it from
  a small module first, since `StrategyTable` imports `StrategyGrid`).

## Found by 194-08 (2026-11-07)

- OG share card (`src/app/api/og/factsheet/[id]/route.tsx`, census row B3, assigned to Phase 194.1 by D-10) does not read
  the D-15 record gate. Since plan 08 the factsheet KPI strip withholds CAGR, Sharpe, Sortino, Calmar and Ann. Vol on a
  short TOTAL record, so for a 25-point crypto record the strip prints a dash and the card still prints the stored Sharpe.
  `route.stored-parity.test.tsx` now gives its strip a cleared record by default and carries one `KNOWN DIVERGENCE (B3,
  Phase 194.1)` case that pins the disagreement; 194.1 gating the card turns that case red, and its author deletes it.
- `compute.conventions.test.ts` fixtures B and C fail at this base, as the brief lists (not this plan's).
