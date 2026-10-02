---
phase: 71-allocator-positions
reviewed: 2026-07-05T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - analytics-service/services/positions.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/equity_reconstruction.py
  - src/lib/notes/scope-ref.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: findings
---

# Phase 71: Code Review Report

**Reviewed:** 2026-07-05
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the DRB-09 Deribit allocator-positions change: the new
`_normalize_deribit_position` inverse/linear mapping, the single-source
`classify_instrument_settlement`, the lifted f3 Path-B (spot returns `[]`),
the equity-refresh `venue=='deribit'` skip, and the widened notes scope_ref
regex.

The **money-carrying inverse path is correct and well-tested**: coin-settled
PnL is converted at `index_price`, size_base/size_usd read the right raw
`info` fields, and every conversion guard **fails loud** (empty `info`, no
usable index, unknown coin-margined currency) with per-position containment so
one anomaly can't drop the whole batch. The classifier is genuinely
single-sourced with the ledger. Prior red-team fixes (single-source
classifier, per-position resilience, notes 403) all landed correctly and the
`DeribitNotSupportedError` removal left no dangling references. No BLOCKERs.

Three WARNINGs remain, all around **display value on the allocator Holdings
panel** (equity is correctly excluded from the curve, so none corrupt the
equity math or PnL): options `value_usd` uses the underlying-notional
convention which materially overstates option positions; the linear-USDC
`size` denomination is unverified against a real account; and the batch
normalizer now swallows `ValueError` for *all* venues, not just Deribit.

## Warnings

### WR-01: Option `value_usd`/`size_usd` = contracts × index materially overstates option positions

**File:** `analytics-service/services/positions.py:161-166` (option branch of `_normalize_deribit_position`)
**Issue:** For `option_style` positions, `size_usd = abs(size) * index_price`
(contracts × underlying spot). This is the underlying *notional*, not the
option's market value. A 5-contract BTC option at a $50k index reports
`size_usd = $250,000`; the actual position value (premium × contracts) may be
a few thousand dollars — a ~50× overstatement. This flows straight into
`allocator_positions._fetch_derivative_rows` → `value_usd` on the Holdings
panel. The docstring only acknowledges option *mark/average premium* as a
"known minor display imperfection" and does not call out that `value_usd`
itself is grossly overstated for options. `cost_basis_usd`
(`entry_price` × qty, where `entry_price` is the premium-in-coin) is likewise
a mixed-unit nonsense figure for options. The equity curve is unaffected
(Deribit is skipped in the daily job), so this is display-only — but it is
money-adjacent and larger than "minor."
**Fix:** Either (a) label the panel column "Notional" (consistent with the
futures convention) so the number is honest, or (b) for options set
`size_usd = abs(size) * mark_price * index_price` (contracts × premium-in-coin
× coin→USD) to report true option position value, and set option
`cost_basis_usd` from `average_price` × qty × index rather than raw
premium × qty. Document whichever convention the panel expects.

### WR-02: Linear-USDC `size` denomination is unverified — risks swapping size_base/size_usd on exactly the P72 onboarding accounts

**File:** `analytics-service/services/positions.py:167-170` (futures/perps branch)
**Issue:** For linear instruments the code assumes `size` = quote-ccy notional
(USD) and `size_currency` = base coin, identical to the inverse path. The
author's own test comment (`test_linear_usdc_perp_pnl_passthrough`) flags that
Deribit has historically changed USDC-instrument field denomination and defers
verification to P72 live onboarding. Per project memory the live LTP accounts
are USDC/USDT — i.e. the linear path is precisely the one that will carry real
money first, yet it is the *unverified* path. If Deribit reports linear `size`
in base coin (not USD), `size_base` and `size_usd` are swapped for every live
linear position (PnL passthrough stays correct; only the size fields invert).
**Fix:** Before P72 relies on this for display, capture one real
`fetch_positions()` payload from a USDC/USDT Deribit account and assert the
`size` vs `size_currency` denomination, then either confirm the mapping or
branch linear vs inverse size handling. Keep the acceptance gate explicit in
P72, not implicit in a test comment.

### WR-03: Batch normalizer now swallows `ValueError` for all venues, silently dropping malformed non-Deribit positions

**File:** `analytics-service/services/positions.py:264-278` (`_normalize_ccxt_positions`)
**Issue:** The refactor wraps `_normalize_ccxt_position` in `try/except
ValueError` for every exchange, not just Deribit. The docstring asserts
"Non-Deribit normalization never raises," but the linear path does raw
`float()` coercion on exchange-supplied fields
(`float(pos.get("notional") or 0)`, `entryPrice`, `markPrice`,
`unrealizedPnl`); a malformed numeric (e.g. `"N/A"`) raises `ValueError`.
Previously that aborted the batch loudly; now a real Bybit/OKX/Binance
position is silently dropped with only a warning log, and the sync reports the
remaining positions as complete — hiding a live position. Low likelihood
(CCXT normalizes to float/None) but a silent-failure regression that widens
blast radius beyond the intended Deribit scope.
**Fix:** Scope the tolerant skip to Deribit only, e.g.
`except ValueError as exc: if exchange_name != "deribit": raise` (or catch a
narrow custom `DeribitNormalizeError`), so non-Deribit malformed data still
fails loud. Correct the docstring's inaccurate invariant either way.

## Info

### IN-01: Combo instruments (`option_combo`/`future_combo`) fall through single-leg size logic

**File:** `analytics-service/services/positions.py:135` (`option_style = "option" in kind`)
**Issue:** `option_combo` correctly sets `option_style`, but `future_combo`
takes the futures branch and both are treated as single-leg instruments for
size/notional. Multi-leg combos have different size semantics; the numbers
may be off. Unlikely to appear on an allocator display key and not
money-critical (equity excluded), but unverified.
**Fix:** Add a fixture for a combo `kind` or explicitly document that combos
are out of scope for the position display.

### IN-02: Linear option shows `size_usd = 0` when `index_price` is 0

**File:** `analytics-service/services/positions.py:164-166`
**Issue:** For a *linear* option (coin_settled=False, so the PnL block never
requires index), the option branch computes
`size_usd = abs(size) * (index_price if index_price > 0 else 0.0)`. With a
missing/zero `index_price` this silently yields `size_usd = 0` while the
position still renders — an inconsistent zero-notional row rather than a
fail-loud. Coin-settled options can't hit this (the PnL block already raised),
so it only affects linear options with absent index.
**Fix:** Minor; either fall back to `mark_price`-derived notional for linear
options or accept the 0 as intentional and note it in the docstring.

## Non-issues verified

- `classify_instrument_settlement` is genuinely single-sourced with the ledger
  (`_INVERSE_CURRENCIES`/`_LINEAR_MARGIN_MARKERS`), fails loud on unknown coin,
  and the `[A-Z0-9_-]` regex `-` is correctly placed last (literal, no range).
- Equity-refresh `venue=='deribit'` guard reads a column (`venue`) that
  `_fetch_today_holdings` actually selects; consistent with the reconstruct
  skip. Correct.
- `DeribitNotSupportedError` removal from `allocator_positions` has no dangling
  runtime references; the separate `equity_reconstruction` class is preserved
  and tests assert the allocator one is gone.
- Deribit spot `return []` correctly renders derivatives instead of the old
  whole-sync error. VERSION + package.json both bumped.

---

_Reviewed: 2026-07-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
