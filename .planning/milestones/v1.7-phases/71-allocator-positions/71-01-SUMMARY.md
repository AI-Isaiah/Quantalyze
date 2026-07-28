# Phase 71 — Summary: Allocator Deribit Positions (DRB-09)

**Status:** implemented + reviewed (2 opus reviewers, both SHIP-WITH-FIXES → all fixed)
**No DB migration** — pure Python (+ 1 TS one-liner: notes scope regex).

## Review outcomes (fixed at root, mutation-verified)
- **HIGH (correctness specialist):** coin-vs-USD settlement now uses the
  single-source, instrument-name classifier `deribit_txn.classify_instrument_settlement`
  (fail-loud on unknown coin), NOT the ccxt-symbol `_is_inverse_perp` — closes
  the silent-misclassification window (unresolved market → symbol lacks `:` →
  coin-settled mis-read as linear → uPnL ~index× understated) and the Rule-7
  classifier fork.
- **MEDIUM (red team):** `_normalize_ccxt_positions` now skips + logs a single
  un-normalizable Deribit position instead of aborting the whole batch — one
  anomalous instrument no longer hides every other position (SC2).
- **MEDIUM (red team):** `src/lib/notes/scope-ref.ts` `HOLDING_SCOPE_RE` widened
  to admit `-`/`_` Deribit instrument symbols — the notes PATCH no longer 403s
  on a Deribit holding (newly reachable once Deribit rows render).
- **MEDIUM (correctness specialist), deferred to P72:** linear `size`=quote-ccy
  denomination is per the verified Deribit docs (same rule as the verified
  inverse path); the LTP accounts are USDC/USDT, so P72 onboarding is the live
  acceptance gate. PnL passthrough is correct regardless.
- **LOW:** comment rot fixed (equity_reconstruction DeribitNotSupportedError
  docstring); option entry/mark-in-coin remains a documented display imperfection.

## What shipped
An allocator can connect a Deribit key and see their derivative positions. The
last deliberate block (f3 Path-B `DeribitNotSupportedError`) is lifted.

### 1. Deribit-aware position normalization — `services/positions.py`
New `_normalize_deribit_position()` + a `deribit` branch in
`_normalize_ccxt_position()`. Reads the raw Deribit `info` (authoritative per
the /private/get_position docs), correcting CCXT's Deribit-inverted unified
mapping:
- `size_base` = base-coin qty (`size_currency` for futures; `size` for options)
- `size_usd` = USD notional (`size` for futures; `contracts·index` for options)
- `unrealized_pnl` = USD: inverse (coin-settled) `floating_profit_loss·index_price`;
  linear (USDC) pass-through
- `symbol` = `instrument_name` (BTC-PERPETUAL, …); coin-settled detection via
  the single-source `deribit_txn.classify_instrument_settlement` (instrument-name
  markers, fail-loud on unknown coin); fail-loud if no positive coin→USD rate.
Linear / other exchanges: untouched.

### 2. Lift the block — `services/allocator_positions.py`
`_fetch_spot_rows` returns `[]` for Deribit (spot deferred) instead of raising;
the `DeribitNotSupportedError` class + raise are deleted (the separate
`equity_reconstruction` copy stays — reconstruction deferral, SC-3). Deribit
sync now completes with derivative rows.

### 3. Equity-leak guard — `services/equity_reconstruction.py`
`run_refresh_allocator_equity_daily_job` skips `venue=='deribit'` holdings so a
MIXED allocator (Deribit + Bybit) doesn't leak collateral-less Deribit uPnL into
the allocator equity curve. (reconstruct already skips deribit; Deribit-only
allocators never reach refresh — enqueue is gated on existing snapshots.)

## Tests (all mutation-verified)
- `tests/test_positions.py::TestFetchPositionsDeribit` — inverse short, linear
  USDC pass-through, option coin→USD, zero-filter, index-guard fail-loud.
- `tests/test_allocator_positions.py` — Deribit renders derivatives + spot
  deferred (no exception, fetch_balance not called); error-class removed.
- `tests/test_equity_reconstruction.py::test_refresh_daily_excludes_deribit_derivatives`.

## Gates
Full suite 2867 passed / 92 skipped (py3.12 CI venv); `mypy --strict` clean on
changed services; source ruff-clean.

## SC mapping
1. No DeribitNotSupportedError, sync completes → §2.
2. Derivatives render, inverse normalized → §1.
3. Deribit equity deferred (no leak) → §3 + reconstruct guard unchanged.
