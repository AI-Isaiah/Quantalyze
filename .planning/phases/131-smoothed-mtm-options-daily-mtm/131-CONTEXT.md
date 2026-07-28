# Phase 131 — Smoothed MTM (options daily mark-to-market) — the third factsheet basis

**Milestone:** v1.14 (Options MTM smoothing — standalone phases 82/83 brought forward).
**Origin:** archived `.planning/milestones/post-v1.8-standalone-phases/83-daily-option-mtm/83-PLAN.md`
(Phase 83, "daily-option-mtm"), reframed per founder direction 2026-07-22 as a **third selectable
factsheet `pnl_basis`** rather than an in-place replacement of the native attribution.

## Founder intent (2026-07-22)
- "smoothing of MTM, as the third option for factsheet cash basis, MTM, and smoothed MTM."
- "ideally MTM already gives the daily worth of the options."

## Design decision (governs this phase)
Keep **three** factsheet bases, additive — the existing two are byte-untouched:
1. `cash_settlement` *(exists)* — realized cash flows. Lumpy for options (cash only at expiry `delivery`), exact for perps (daily 08:00-UTC settlement). Default / headline / peer-rank basis. UNCHANGED.
2. `mark_to_market` *(exists)* — the exchange's own summary channel (`options_settlement_summary` = realized_pl+unrealized_pl lumped onto the settlement day). Clean for perp/USD-native books; on an un-smoothed options book it spikes (94%/day live evidence) and is honestly gated OFF (`mark_to_market_available` → `unsmoothed_options_book`). UNCHANGED.
3. `smoothed_mtm` **(NEW)** — daily ΔMTM redistribution: full cash `change` on option rows + per-(day,ccy) `Book[d]−Book[d−1]` where `Book[d]=Σ_instr position[instr][d]×mark[instr][d]`. Spreads each session-lump P&L across the days it accrued → the honest daily option worth. For perp/clean books it converges with `mark_to_market` and cash. This is the basis that **opens** the `unsmoothed_options_book` gate.

`smoothed_mtm` is the DAILY-MARK version of "MTM done right" the founder means by "ideally MTM already gives the daily worth." It is total-preserving (telescoping): `Σ_d native_pnl[c][d] = Σchange + Book(last settlement)`.

## Verified feasibility (2026-07-22, this session — encode, do not re-derive)
- **Mark source WORKS**: `public/get_tradingview_chart_data resolution=1D` returns daily marks for **EXPIRED** option instruments — PROVEN live from the Railway worker against 4 expired BTC options (Dec-24…Sep-25 expiries): each `status=ok`, 401 daily bars, real closes, bars stamped 08:00 UTC (Deribit settlement boundary). This is the plan's assumed source, now independently confirmed.
- **Dead end (do not use)**: `public/get_mark_price_history` returns `[]`/HTTP-400 for options (only DVOL-constituents). The archived plan's rejected-alternatives note is correct.
- Settlement model: perps settle daily (smooth cash), options at expiry only (lumpy cash) → smoothing is specifically an OPTIONS-book fix. ⚠️Apr-2026 delivery change: ITM option → physical settle into future → future delivers to cash (tolerate two log rows near expiry; final P&L unchanged).
- See memory `reference_deribit_api_equity_and_option_marks`.

## NOT in scope for the pure-core sub-phase (gated on founder review of the toggle wiring)
The archived plan's Tasks 4–6 (rework `txn_rows_to_native_daily` attribution, `assert_balance_identity` two-channel rework) were framed as a REPLACEMENT. Under the third-basis framing they become a NEW branch gated on `pnl_basis == "smoothed_mtm"`, leaving cash + mark_to_market byte-identical. The frontend SegmentedControl third option + worker persistence (both routes) land after the pure core is proven.

## Success criteria (phase goal)
A Deribit options book renders a `smoothed_mtm` factsheet whose daily series has NO session-lump spikes (|daily| sane), the `smoothed_mtm` total equals the `cash_settlement` total on a flat terminal book (redistribution preserves the sum), perp-only / USD-native books stay byte-identical (SC-4) with ZERO option-mark fetches, and sparse marks inside a listed instrument's life FAIL LOUD (no interpolation, no session-lump fallback).
