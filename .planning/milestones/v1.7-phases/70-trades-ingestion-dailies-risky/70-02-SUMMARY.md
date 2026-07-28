---
phase: 70-trades-ingestion-dailies-risky
plan: 02
subsystem: analytics
tags: [deribit, txn-log, coin-margined, funding, daily-returns, python, tdd]

# Dependency graph
requires:
  - phase: 70-01
    provides: LOCKED Deribit ingestion design (docs/deribit-ingestion-design.md) + Wave-0 evidence (settlement carries event-time index_price; funding is settlement-bundled; txn-log type universe)
provides:
  - "services/deribit_txn.py — pure, I/O-free correctness core: classify_instrument (single definition, D-05), txn_cashflow_to_usd (event-time inverse coin→USD, D-07/D-08), CASH_BEARING_TYPES/INFORMATIONAL_TYPES, txn_rows_to_daily_records (funding-inclusive count-once sum per UTC day, D-10)"
  - "Revert-proof hand-computed inverse fixtures (short/long, credit+/debit−) + fail-loud unknown-type guard"
  - "Harness classify_instrument now imported from services.deribit_txn (single definition)"
affects: [70-03, 70-04, 70-05, 70-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure correctness core (stdlib+typing only) — no ccxt/pandas/supabase/services.exchange importable, enforced by an ast-based structural test"
    - "Single-sum realized stream (no separate funding tuple): funding is inside settlement cashflow"
    - "Fail-loud on any unobserved txn-log type carrying nonzero cashflow (no pre-parking of unobserved types)"

key-files:
  created:
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_deribit_txn.py
  modified:
    - analytics-service/scripts/deribit_ground_truth.py
    - analytics-service/tests/test_deribit_ground_truth.py

key-decisions:
  - "txn_rows_to_daily_records returns a SINGLE list[dict] of daily_pnl records (NOT the prior (realized, funding) tuple) — funding is settlement-bundled on Deribit, so a separate funding stream would double-count"
  - "Zero-cashflow cash-bearing rows (A3 trade rows) contribute 0 without requiring an index_price; only nonzero cashflow triggers conversion — keeps trade rows lacking index_price from spuriously failing while preserving D-07 fail-loud for real inverse cash"
  - "Unobserved types (options_settlement_summary/negative_balance_fee/correction/swap) are in NEITHER type set — they fail loud on nonzero cashflow, forcing an evidence-grounded decision on first appearance"
  - "linear detection is instrument-name markers OR classify=linear_perpetual OR USD-family settlement currency (USDC/USDT/USD/EURR)"

patterns-established:
  - "Pattern: ast-based structural import test proves a module cannot reach an I/O/perp-fill surface (docstring may name forbidden modules to say it does NOT import them)"
  - "Pattern: revert-proof money-math tests — neutering the ×index multiply or double-counting settlement turns tests red"

requirements-completed: [DRB-05, DRB-06, DRB-07]

# Metrics
duration: ~35min
completed: 2026-07-05
---

# Phase 70 Plan 02: Deribit txn-log correctness core Summary

**Pure, I/O-free Deribit ledger core: event-time inverse coin→USD conversion (ledger-sign-trusted), a funding-inclusive count-once cash-bearing single-sum to daily_pnl records, and classify_instrument lifted to a single definition — all locked by revert-proof hand-computed fixtures.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 4 (2 created, 2 modified)
- **Tests:** 45 targeted (24 new in test_deribit_txn.py) green

## Accomplishments
- `txn_cashflow_to_usd`: inverse coin→USD = `cashflow × row.index_price` at the row's OWN event-time; linear/USD-family passthrough with NO index multiplication; fail-loud (ValueError naming the row id) on an inverse row missing index_price — never a current/period-end fallback (D-07). Ledger credit(+)/debit(−) sign trusted verbatim.
- Hand-computed sign-correct fixtures (short: 0.05×2000=100.0, −0.031×1850=−57.35; long: −0.02×50000=−1000.0, 0.004×61250=245.0; linear 12.5 passthrough) — each revert-proof (dropping the ×index or flipping the sign turns ≥1 test red).
- `CASH_BEARING_TYPES = {trade, settlement, delivery}` / `INFORMATIONAL_TYPES = {transfer, deposit, withdrawal, usdc_reward}` pinned EXACTLY to the Wave-0 evidence type universe; disjoint; no unobserved type pre-parked.
- `txn_rows_to_daily_records(rows) -> list[dict]`: one `daily_pnl` record per UTC day (side encodes sign, price = abs USD, timestamp ISO8601 UTC 00:00:00). Funding-inclusive settlement summed ONCE — a double-count turns the count-once test red. Unobserved type + nonzero cashflow → fail loud; zero-cashflow unknown → ignored.
- Options enter as realized cash via their delivery/settlement cash delta (never perp fill math); ast structural test proves the module imports no ccxt/pandas/supabase/services.exchange.
- `classify_instrument` (+ `_LINEAR_MARGIN_MARKERS`/`_FUTURE_EXPIRY_RE`) lifted verbatim to `services.deribit_txn`; harness imports it back and defines NO local copy.

## Task Commits

1. **Task 1 RED: inverse coin→USD + classify fixtures** - `85086fc` (test)
2. **Task 1 GREEN: pure deribit_txn primitives** - `229a3bf` (feat)
3. **Task 2 RED: cash-bearing single-sum + fail-loud + options tests** - `d71c804` (test)
4. **Task 2 GREEN: daily records + harness classify import swap** - `cd010db` (feat)

## Files Created/Modified
- `analytics-service/services/deribit_txn.py` - PURE module (stdlib+typing only): classify_instrument, txn_cashflow_to_usd, CASH_BEARING/INFORMATIONAL type sets, txn_rows_to_daily_records
- `analytics-service/tests/test_deribit_txn.py` - 24 revert-proof tests (hand-computed inverse fixtures, linear passthrough, fail-loud, type-set pins/disjointness, count-once single-sum, options-as-cashflow, daily-record shape)
- `analytics-service/scripts/deribit_ground_truth.py` - deleted local classify_instrument + constants; imports from services.deribit_txn (single definition)
- `analytics-service/tests/test_deribit_ground_truth.py` - removed the now-duplicated classification-behavior tests (single home is test_deribit_txn.py); classify_instrument import retained for the summarize_txn_log diversity assertion

## Interface for 70-03
```python
txn_rows_to_daily_records(rows: Sequence[Mapping[str, Any]]) -> list[dict]
```
Returns a SINGLE list of `daily_pnl`-shaped records (one per UTC day) — NOT a `(realized, funding)` tuple. Keys: `{exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type}`, `order_type="daily_pnl"`, `side` "buy"/"sell" encodes the signed day-sum, `price = abs(USD)`, `timestamp` ISO8601 UTC at `00:00:00`. Feeds `trades_to_daily_returns_with_status` / `combine_realized_and_funding` (Deribit funding_rows will be EMPTY — funding is inside settlement).

## Decisions Made
See frontmatter `key-decisions`. Notably: single-list return (no funding tuple); zero-cashflow short-circuit before conversion; unobserved types left in neither set to force fail-loud; linear detection via markers OR classify OR USD-family currency.

## Deviations from Plan

None - plan executed exactly as written. (One test-authoring correction, not a plan deviation: the options structural test initially matched the docstring text naming forbidden modules; switched to an ast-based import inspection so it asserts real imports rather than substrings. Same commit as Task 2 GREEN.)

## Issues Encountered
- Local Python is 3.14 (`.venv`); per CLAUDE.md the full suite segfaults on 3.14, so verification ran ONLY the two targeted test files (CI Py3.12 is the full-suite authority). ruff is not installed in the local venv; mypy on `services/deribit_txn.py` passed clean.
- STATE blocker (ccxt 4.5.46 vs pinned 4.5.59) is irrelevant here: `deribit_txn.py` imports nothing beyond stdlib/typing, and the targeted tests exercise only the pure layer (harness ccxt import is lazy, inside `run()`).

## Next Phase Readiness
- 70-03 can wire `txn_rows_to_daily_records` into the fetch/ingestion path against the documented single-list contract.
- No separate funding ingestion/dedup path is needed (70-04 as originally written is superseded by the settlement count-once sum).

---
*Phase: 70-trades-ingestion-dailies-risky*
*Completed: 2026-07-05*

## Self-Check: PASSED

All created files exist on disk; all four task commits (85086fc, 229a3bf, d71c804, cd010db) present in git history.
