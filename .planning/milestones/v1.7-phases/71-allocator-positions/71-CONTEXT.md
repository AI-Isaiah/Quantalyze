# Phase 71: Allocator Positions - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Mode:** Autonomous (grounded in Deribit API docs + CCXT source)

<domain>
## Phase Boundary

An allocator can connect a Deribit key and see their **derivative** positions on
the Holdings panel. The last deliberate block (f3 Path-B `DeribitNotSupportedError`)
is lifted. Spot ingestion for Deribit stays deferred (no spot path). Equity
reconstruction for Deribit stays deferred (dailies come via the P70 realized+funding
CSV path, never reconstruction).

Requirement: DRB-09.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### D-1 — Lift the block, don't error
`allocator_positions._fetch_spot_rows` currently RAISES `DeribitNotSupportedError`
for Deribit BEFORE any network call, and `fetch_allocator_holdings` calls it
OUTSIDE the try/except — so today a Deribit allocator key fails the whole sync
(sync_status='error') and NO derivative positions render.

**Fix:** for Deribit, spot returns `[]` gracefully (Deribit is derivatives-first;
spot is deliberately deferred). The derivative side (`_fetch_derivative_rows` →
`fetch_positions`) then runs and its rows persist. Whole sync → 'complete'.

The unraised `allocator_positions.DeribitNotSupportedError` class + its raise are
removed (root-cause clean; it existed solely to defer Deribit spot). The SEPARATE
`equity_reconstruction.DeribitNotSupportedError` is KEPT — that deferral (SC-3)
stands.

### D-2 — Deribit position field semantics (GROUNDED, authoritative)
From Deribit `/private/get_position` official docs + CCXT 4.5.x `parse_position`:

| Deribit raw field (`pos["info"]`) | Unit | Meaning |
|---|---|---|
| `size` | **quote ccy (USD/USDC)** for futures/perps; base ccy for options | signed position size |
| `size_currency` | **base ccy (BTC/ETH)** — futures only | coin amount |
| `floating_profit_loss` | **settle ccy** — BTC/ETH for inverse, USDC for linear | unrealized PnL |
| `average_price`, `mark_price`, `index_price` | **USD** | prices |
| `direction` | `buy`/`sell`/`zero` | side |
| `kind` | `future`/`option`/`spot`/`future_combo`/`option_combo` | instrument kind |

CCXT unified INVERTS this vs the linear assumption baked into
`_normalize_ccxt_position`: CCXT `contracts`=`size` (USD notional),
`notional`=abs(`size_currency`) (coin), `unrealizedPnl`=`floating_profit_loss`
(coin for inverse). Trusting the linear mapping would swap quantity/value and
leave PnL ~1e5× wrong for inverse.

**Fix:** a Deribit-aware branch in `_normalize_ccxt_position` reading raw `info`
(ground truth, matches the docs), mapping to our schema:
- `symbol` = `instrument_name` (e.g. `BTC-PERPETUAL`, `BTC-27DEC24`) — what the
  user sees on Deribit; no ambiguous suffix-stripping.
- `size_base` (quantity) = abs(base coin) = futures→`size_currency`; options→`size`.
- `size_usd` (value_usd) = abs(USD notional) = futures→`size`; options→
  `abs(size)·index_price` (contracts × index = USD exposure).
- `entry_price` = `average_price` (USD); `mark_price` = `mark_price` (USD).
- `unrealized_pnl` (USD):
  - inverse (settle ccy == base, e.g. `BTC/USD:BTC`) OR options →
    `floating_profit_loss (coin) × index_price` — the P70 coin→USD-at-index
    convention.
  - linear (settle == USDC) → `floating_profit_loss` passes through (already ≈USD).
- `side`: buy→long, sell→short, zero/0-size→filtered out.
- index guard: coin→USD conversion requires `index_price > 0`; if missing/≤0
  fall back to `mark_price`; if both ≤0 → FAIL LOUD (can't value honestly, per
  no-invented-data). Reuse `equity_reconstruction._is_inverse_perp` for the
  inverse test (settle-ccy == base, tolerates the FUTURES `-DDMMMYY` suffix).

Linear/non-Deribit exchanges (Binance/OKX/Bybit) keep the EXISTING mapping
untouched (contracts×contractSize=base, notional=USD, pnl=USD).

### D-3 — Options / combos: correct-or-loud, not gold-plated
Deribit option `size` is in base ccy (contracts≈coins), `floating_profit_loss` in
coin. Render them with the honest coin quantity + coin→USD PnL and USD exposure =
`contracts·index_price`. No Black-Scholes, no option-mark USD valuation (YAGNI —
these accounts are perp/future-dominant and often flat at onboarding). One fixture
proves the units.
</decisions>

<code_context>
## Existing Code Insights
- `services/allocator_positions.py` — `_fetch_spot_rows` (the block),
  `fetch_allocator_holdings` (spot-outside-try structure), `_fetch_derivative_rows`
  (already Deribit-capable, reuses `positions.fetch_positions`).
- `services/positions.py::_normalize_ccxt_position` — the linear-only normalizer
  to make Deribit-aware.
- `services/equity_reconstruction.py::_is_inverse_perp` — reusable inverse test.
- `tests/test_allocator_positions.py::test_deribit_balance_per_currency_shape` —
  encodes the OLD raise behavior; rewrite to the NEW render-derivatives intent.
</code_context>

<specifics>
## Success Criteria (what must be TRUE)
1. A Deribit allocator key no longer hits `DeribitNotSupportedError`; sync completes.
2. Deribit derivative positions render with inverse contracts normalized correctly
   (`_normalize_ccxt_position` Deribit branch, hand-computed fixtures).
3. Equity reconstruction for Deribit stays deferred + documented.
</specifics>

<deferred>
## Deferred (out of scope, documented)
- Deribit spot ingestion (f3 Path-A) — deferred; spot returns [].
- Deribit equity reconstruction — deferred (SC-3); dailies via P70 CSV path.
- Option USD mark valuation (Black-Scholes) — YAGNI.
</deferred>
