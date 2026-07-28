# Phase 34 — Deferred / Out-of-Scope Items

Discovered during execution; logged but NOT fixed (Scope Boundary).

## 34-01 (Explicit unified annualization)

- **Local `pandera` not installed** — `analytics-service/tests/test_mt5_golden_fixtures.py`
  fails at collection with `ModuleNotFoundError: No module named 'pandera'` (the MT5 module
  imports `services.csv_validator` → `pandera`). Pre-existing local-env gap, unrelated to the
  annualization change; CI installs `pandera`. Not in this plan's `requirements`
  ([ANNUAL-01, ANNUAL-03, ANNUAL-04]). No action — install `pandera` locally if MT5 tests
  must run on this machine.

- **ANNUAL-05 `equity_reconstruction.compute_sharpe` 365→252 convergence** — explicitly out of
  scope for plan 34-01 (its frontmatter covers ANNUAL-01/03/04 only). Follow-up plan should
  flip the default, recompute 4 hand-maintained `expected_sharpe` golden literals
  (×√(252/365)≈0.8312), and update 2 cross-check literals. The shared
  `DEFAULT_PERIODS_PER_YEAR` constant is now importable for it.

- **MT5 doc-block refresh** (`test_mt5_golden_fixtures.py:21-31`) — a CONTEXT item for the phase,
  deferred to a later plan. Resolved MT5 basis stays 252; only the doc comment needs updating
  to describe the explicit-param design.
