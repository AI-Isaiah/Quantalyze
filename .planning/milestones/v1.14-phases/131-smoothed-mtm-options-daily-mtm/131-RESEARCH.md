# 131 RESEARCH — Deribit daily option MTM (verified 2026-07-22)

Sources: online Deribit v2 docs research + LIVE probe from the Railway prod worker. Full archived design: `post-v1.8-standalone-phases/83-daily-option-mtm/83-PLAN.md`. Memory: `reference_deribit_api_equity_and_option_marks`.

## Mark source (the load-bearing dependency — VERIFIED)
- ✅ `public/get_tradingview_chart_data` params `{instrument_name, resolution:"1D", start_timestamp, end_timestamp}` (ms) → `result.{status, ticks[], close[]}`. Returns daily marks for EXPIRED options (PROVEN: 4 expired BTC options, status=ok, 401 bars each, real closes). Bars stamped 08:00 UTC = Deribit settlement boundary. Same endpoint the existing `fetch_deribit_perp_daily_index` (deribit_ingest.py:597-691) already uses for perps → clone it.
- ⛔ `get_mark_price_history` → `[]`/400 for options (DVOL-constituents only). Rejected.
- ⛔ `get_last_settlements_by_instrument`, public trades → refuse expired instruments. Rejected.

## Settlement model
- Perps/futures: DAILY settlement 08:00 UTC (`settlement` rows, realized cashflow+funding) → smooth cash curve. Options: cash realized ONLY at expiry (`delivery` row) → lumpy cash. ⇒ smoothing is an OPTIONS-book fix; perp books already smooth on cash.
- `equity = margin_balance + options_value` (per-ccy). NO historical equity-snapshot endpoint; historical equity only via per-row `equity` in `get_transaction_log` (event-timed, no drift between rows). ⚠️Apr-2026 option delivery change: option→future→cash two-step near expiry, final P&L unchanged.

## Position source (VERIFIED live)
Signed post-trade `position` field on option `trade`/`delivery` rows reconstructs the per-day open book per instrument (shorts negative, deliveries zero). Pure replay; no Greeks, no settlement math.

## Reconstruction model (total-preserving)
For currency c, UTC day d:
```
native_pnl[c][d] = Σ change(r)  over cash-bearing rows of (c,d)   [option trade/delivery now FULL change]
                 + ΔMTM[c][d]    where ΔMTM[c][d]=Book[c][d]−Book[c][d−1],
                                 Book[c][d]=Σ_instr position[instr][d]×mark[instr][d]
options_settlement_summary → contributes NOTHING to smoothed_mtm attribution (reconciliation cross-check only)
```
Telescoping: `Σ_d native_pnl = Σchange + Book(last settlement)`. Flat terminal book ⇒ total = Σchange EXACTLY (equals cash_settlement total). Day grid: bar-tick UTC-day = native grid day (same one-day-basis class as `_row_utc_day`; ≤8h skew cancels day-over-day, total exact).

## Fail-loud (D-07)
Missing bar inside an instrument's listed life = STRUCTURAL → `LedgerValuationError` naming instrument+day. NO interpolation, NO session-lump fallback (that IS the bug being removed). Only pre-retention/pre-listing era (instrument whose whole life predates chart retention ~2.5yr) stays cash-basis + `complete_with_warnings`.

## Why naive per-day MTM spikes (motivates smoothing)
Option value convex, gamma explodes near 0-DTE; premium collapses to zero at expiry realizing as one lumpy `delivery`; the existing `mark_to_market` summary channel lumps a whole session delta (weeks of accrual) onto the single settlement day (live: 94%/day, Aug-2025 +3305% on Phoenix key 95089958, total correct).
