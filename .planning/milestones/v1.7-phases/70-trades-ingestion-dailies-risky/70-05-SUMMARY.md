---
phase: 70-trades-ingestion-dailies-risky
plan: 05
subsystem: analytics
tags: [deribit, dailies, one-path, ledger, completeness-gate, usd-anchor, funding-count-once, python, tdd]

# Dependency graph
requires:
  - phase: 70-02
    provides: "services/deribit_txn.py — txn_rows_to_daily_records (funding-inclusive single-sum daily records), _LINEAR_CURRENCIES"
  - phase: 70-03
    provides: "services/deribit_ingest.py — fetch_deribit_ledger_daily_records + assert_ledger_complete (re-anchored D-02 gate) + LedgerCompletenessError/LedgerTruncatedError"
provides:
  - "run_derive_broker_dailies_job deribit venue branch: ledger-sourced realized (D-08), EMPTY funding into combine_realized_and_funding (count-once, no funding_fees write), assert_ledger_complete BEFORE upsert (fail-loud, no partial track record), USD equity anchor, identical downstream csv_daily_returns tail"
  - "services/deribit_txn.py::deribit_equity_to_usd — pure per-currency coin-equity × USD index → total USD anchor (raises on a coin/non-USD base)"
  - "services/deribit_ingest.py::fetch_deribit_account_equity_usd — account-summary-derived USD anchor (deribit is NOT covered by services.exchange.fetch_account_equity_usd)"
  - "Revert-proof tests: ledger-sourced (fetch_all_trades raises), empty-funding spy, completeness-gate fail-loud, truncation fail-loud, USD-anchor shape, ONE-path metrics key parity with bybit"
affects: [70-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Venue-forked SOURCE, shared TAIL: the deribit branch only replaces realized-sourcing + funding + anchor; combine / <2-days / key+strategy-mode upsert are byte-unchanged (no forked metrics path — DRB-08)"
    - "Fail-loud gate BEFORE side effect: assert_ledger_complete runs before the csv_daily_returns upsert so a silently-partial ledger returns FAILED with zero rows written"
    - "Pure money-math helper (deribit_equity_to_usd) extracted so the USD-anchor shape is CI-testable without live I/O"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_broker_dailies.py

key-decisions:
  - "fetch_account_equity_usd (services.exchange) does NOT cover deribit — it falls through to fetch_usdt_balance_with_status, and a coin-margined USDT balance is NOT USD equity. Added a deribit-specific fetch_deribit_account_equity_usd that reads private/get_account_summaries, converts each coin-margined currency's equity at its public/get_index_price event index, and passes USD-family currencies through. Money math is the pure deribit_equity_to_usd (raises rather than anchoring to a raw coin quantity — the broker_dailies anchor-shift class)."
  - "The deribit branch runs assert_ledger_complete BEFORE combine/upsert; LedgerCompletenessError (a scope×currency never reached continuation=null) OR LedgerTruncatedError (10028 budget exhausted) → DispatchResult FAILED-permanent with a scrubbed message and NO csv_daily_returns upsert. No partial track record is ever written (re-anchored D-02 gate)."
  - "funding_rows passed to combine_realized_and_funding is [] — funding is inside the ledger settlement cash delta (A3/D-10), summed once. upsert_funding_rows is NEVER referenced in the derive function (grep-verified 0 occurrences) so Deribit rows never touch the funding_fees table (DRB-07 count-once)."
  - "Task 2 required NO production change: combine_realized_and_funding is already exchange-agnostic, so the deribit ledger daily_pnl records (shape-identical to bybit's) flow through it unchanged. The two parity tests are characterization PINS that turn red if a Deribit-specific dailies/metrics path is ever forked."

patterns-established:
  - "Pattern: extract the anchor math into a pure helper so the USD-shape assertion needs no live account read"
  - "Pattern: fetch_all_trades patched to RAISE in the deribit-branch tests — reaching DONE proves the branch never touched the fills path (D-08)"

requirements-completed: [DRB-07, DRB-08]

# Metrics
duration: ~35min
completed: 2026-07-05
---

# Phase 70 Plan 05: Deribit ONE-path dailies wiring Summary

**A `deribit` venue branch in `run_derive_broker_dailies_job` that makes a real Deribit key's per-key dailies honest and completeness-verified: realized returns come from the SINGLE txn-log ledger pass (funding-inclusive settlement, count-once), funding into `combine_realized_and_funding` is EMPTY (no `funding_fees` write), the re-anchored D-02 ledger-completeness gate fails loud BEFORE any upsert, and the equity anchor is a USD-denominated figure — then the SAME exchange-agnostic `combine → trades_to_daily_returns_with_status → csv_daily_returns` tail that Overview/Scenario/factsheet read.**

## Performance
- **Duration:** ~35 min
- **Tasks:** 2 (Task 1 TDD RED→GREEN; Task 2 characterization pins — combine is already exchange-agnostic so no production change)
- **Files:** 4 modified (`job_worker.py` +deribit branch, `deribit_ingest.py` +USD-anchor fetch, `deribit_txn.py` +pure `deribit_equity_to_usd`, `test_broker_dailies.py` +7 tests)

## Accomplishments
- **`run_derive_broker_dailies_job` deribit branch** (`services/job_worker.py`): `elif`-style `if venue == "deribit":` inside the existing `try`. Calls `fetch_deribit_ledger_daily_records(ctx.exchange, None)` ONCE for realized (cites D-08 — realized comes from the ledger cash deltas, never `fetch_all_trades`), runs `assert_ledger_complete` on the completeness report BEFORE anything downstream, passes the ledger records + `[]` funding to `combine_realized_and_funding`, and leaves the `<2-days` handling + key-mode/strategy-mode `csv_daily_returns` upsert UNCHANGED. `LedgerCompletenessError`/`LedgerTruncatedError` → `DispatchResult` FAILED-permanent (scrubbed message), no upsert.
- **`fetch_deribit_account_equity_usd`** (`services/deribit_ingest.py`): the deribit USD anchor (`services.exchange.fetch_account_equity_usd` does not cover deribit). Reads `private/get_account_summaries`, resolves each coin-margined currency's `public/get_index_price` (`{ccy}_usd`), and defers the sum to the pure helper. A read failure or an unresolvable index → `(None, True)` (heuristic-capital DQ flag, never a mis-scaled anchor).
- **`deribit_equity_to_usd`** (`services/deribit_txn.py`, pure/I-O-free): sums per-currency equity into USD — USD-family (`USDC`/`USDT`/`USD`/`EURR`) pass through, coin-margined equity × its USD index; a missing index RAISES `ValueError` rather than anchoring to a raw coin quantity (the anchor-shift class).
- **7 tests** (`tests/test_broker_dailies.py`): `test_deribit_branch_sources_from_ledger` (fetch_all_trades patched to raise), `test_deribit_passes_empty_funding` (combine spy sees `funding==[]` and the ledger records as realized), `test_deribit_completeness_gate_fails_loud` (FAILED + zero upserts), `test_deribit_ledger_truncation_fails_loud`, `test_deribit_equity_anchor_is_usd`, plus the DRB-08 pins `test_deribit_one_path_shape` and `test_deribit_no_specific_metrics_path`.

## Verification
- **Grep-verified acceptance:** the deribit branch calls `fetch_deribit_ledger_daily_records` (not `fetch_all_trades`), runs `assert_ledger_complete` at line 1858 BEFORE the combine (1899)/upsert, passes `funding: list[Any] = []`, and `upsert_funding_rows` appears **0 times** in the derive function.
- **Pure logic proven locally** (no pandas): `deribit_equity_to_usd([BTC 2.0, USDC 5000], {BTC:50000}) == 105_000.0`; a coin currency with no index raises `ValueError`; `fetch_deribit_account_equity_usd` async smoke test (fake exchange) → `(105000.0, False)`; deribit ledger records are byte-shape-identical to a bybit `daily_pnl` record (same key set, `order_type=='daily_pnl'`); inverse `0.002 BTC × 50,000 = +100 USD`.
- **`mypy` clean** on all three modified service modules; `py_compile` clean on all four files.

## Deviations from Plan
None — plan executed exactly as written. `fetch_account_equity_usd` did NOT support deribit (confirmed: non-OKX venues fall through to `fetch_usdt_balance_with_status`), so a summary-based USD anchor was added exactly as the plan's fallback instructed (`<action>`: "if not, compute the USD equity anchor from the account summary … extract into a small testable helper"). Task 2 needed no production change because `combine_realized_and_funding` is already exchange-agnostic; the two parity tests are revert-proof pins, matching the plan's DRB-08/D-15(e) intent.

## Issues Encountered
- Local Python is 3.14 (`.venv`); per CLAUDE.md + the 70-03 summary the pandas-importing suite SIGSEGVs on 3.14 (even importing `services.job_worker`, which transitively imports pandas, faults). The **CI Py3.12 run is the authority**. The five pandas-free assertions (pure helper, async anchor smoke, record-shape parity, both fail-loud FAILED-paths that return before `combine`) are proven locally; the pandas-touching assertions (`combine`/`compute_all_metrics` key parity, the real `pd.Series` upsert iteration in the two DONE-path tests) run in CI — identical deferral to 70-03. No new packages (T-70-SC accepted).

## Threat Coverage (from plan threat_model)
- **T-70-14 (silent partial render):** `assert_ledger_complete` + `LedgerTruncatedError` FAIL the job before the `csv_daily_returns` upsert — zero rows on an incomplete crawl (revert-proof: `test_deribit_completeness_gate_fails_loud` / `test_deribit_ledger_truncation_fails_loud`).
- **T-70-15 (funding double-count / misroute):** `funding_rows=[]` into combine; `upsert_funding_rows` never referenced for deribit (grep 0) — count-once, no separate stream (`test_deribit_passes_empty_funding`).
- **T-70-16 (wrong anchor):** USD anchor via `deribit_equity_to_usd` / `fetch_deribit_account_equity_usd`; a coin/non-USD base raises and the CI shape test asserts the USD figure (`test_deribit_equity_anchor_is_usd`).
- **T-70-SC (package installs):** zero new packages — accepted.

---
*Phase: 70-trades-ingestion-dailies-risky*
*Completed: 2026-07-05*

## Self-Check: PASSED
All four modified files exist on disk; the three task commits (0536e804 test-RED, 545fcae2 feat-GREEN, ad38d7b5 test-pins) are present in git history on `feat/70-deribit-ingestion-dailies`. Pure-logic + async-anchor + shape-parity proven locally; `mypy`/`py_compile` clean; pandas-dependent assertions deferred to CI Py3.12 per the documented Py3.14 segfault constraint. ROADMAP 70-05 marked `[x] [DONE]`.
