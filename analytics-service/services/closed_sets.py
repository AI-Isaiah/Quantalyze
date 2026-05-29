"""Single source of truth for the analytics-service closed sets.

Python half of B8 (audit-2026-05-07 cross-cutting "closed-set discipline").
The TypeScript half lives in ``src/lib/closed-sets.ts`` (B8a). This module
exists so a closed set / composite-key derivation cannot be silently
re-widened or hand-copied across the analytics worker — the failure mode
flagged repeatedly by the audit (G12.A.3 conflated buy/sell/long/short as
bare ``str``; NEW-C01-09 booked phantom SHORTs from unrecognized sides;
NEW-C01-12 forked the stablecoin suffix list).

It imports nothing from the rest of ``services`` so it can be a leaf in the
import graph (no cycles): every consumer imports FROM here, never the
reverse.

Scope notes (deliberate boundaries — see B8b PR body):

* Trade ``side`` ({buy, sell}) and position direction/state are DISTINCT
  closed sets that audit G12.A.3 found conflated. They are mirrors of the
  DB CHECK constraints in migration 112 (``trades.side``) and the
  position-state column. Keep them separate here too.

* ``STABLECOINS`` is the "treat as cash / skip the price fetch" set. It is
  NOT the same concept as ``position_reconstruction._USD_QUOTE_CURRENCIES``
  (the set of quote currencies that count as USD-denominated for a
  quote-leg decision): DAI is a treat-as-cash stablecoin but almost never a
  perp quote leg, while FDUSD is a live Binance quote leg. Those two sets
  have intentionally different DAI/FDUSD membership and serve different
  decisions, so they are NOT folded together. Only the two genuinely
  same-semantic "treat-as-cash" definitions (equity reconstruction +
  allocator spot valuation) are unified through ``STABLECOINS`` here.

* ``perp_quote`` is the CCXT-format quote extractor used during equity
  replay (linear ``BTC/USDT:USDT`` / inverse ``BTC/USD:BTC``). It is NOT a
  replacement for ``exchange._infer_quote_currency`` (a None-able,
  multi-format — including OKX raw ``BTC-USDT-SWAP`` — validation helper)
  nor for ``equity_reconstruction.split_holdings_symbol_to_base_quote`` (a
  delimiterless suffix splitter returning a ``(base, quote)`` tuple). Those
  are different contracts with different fallbacks (None / suffix-match);
  collapsing them into one parameterized function would average conflicting
  behaviors, so they stay separate by design.
"""

from typing import Literal

# ---------------------------------------------------------------------------
# Trade side — the {buy, sell} fill action.
# Mirror of the DB CHECK on ``trades.side`` (migration 112). This is the
# action taken on a fill; it is NOT the resulting position direction (a
# hedge-mode short is OPENED via a 'sell' fill — G12.A.3).
# ---------------------------------------------------------------------------
TRADE_SIDES: tuple[str, str] = ("buy", "sell")
TRADE_SIDES_SET: frozenset[str] = frozenset(TRADE_SIDES)
Side = Literal["buy", "sell"]


def is_trade_side(value: object) -> bool:
    """True iff ``value`` is a recognized trade side ('buy'/'sell').

    Case-insensitive on the string form; non-strings are not sides. Mirrors
    the membership test used at the fill-ingest boundary and the equity
    replay guard so both agree on exactly one allowlist.
    """
    return isinstance(value, str) and value.lower() in TRADE_SIDES_SET


# ---------------------------------------------------------------------------
# Position direction / state.
# ``PositionDirection`` is the long/short discriminator of an OPEN position
# (what a fill establishes). ``PositionSide`` adds the resting 'flat' state
# used by the FIFO matcher. Renamed out of ``Side`` (2026-05-27 type
# hygiene) to stop the same-name/different-meaning collision with
# ``Side`` above.
# ---------------------------------------------------------------------------
POSITION_DIRECTIONS: tuple[str, str] = ("long", "short")
PositionDirection = Literal["long", "short"]
PositionSide = Literal["long", "short", "flat"]


# ---------------------------------------------------------------------------
# Stablecoins — the "treat as cash, mark at $1, skip the ticker fetch" set.
# Canonical for equity reconstruction + allocator spot valuation. See the
# module docstring for why ``_USD_QUOTE_CURRENCIES`` is deliberately NOT
# unified with this.
# ---------------------------------------------------------------------------
STABLECOINS: frozenset[str] = frozenset(
    {"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"}
)

# NEW-C01-12: extra suffixes recognised ONLY by the holdings-symbol splitter
# (``split_holdings_symbol_to_base_quote``), so it can parse non-USDT-settled
# perps like ``ETHUSDe``. These are intentionally NOT in ``STABLECOINS``
# itself, which drives price-skip logic — a token like ``PYUSDETH`` must not
# be skipped as cash.
STABLECOIN_SPLIT_SUFFIXES: frozenset[str] = frozenset({"USDE", "PYUSD", "USDB"})

# Pre-sorted longest-first so a suffix splitter picks USDC/BUSD/etc before
# USD, avoiding false-positive substring matches.
STABLECOINS_LONGEST_FIRST: tuple[str, ...] = tuple(
    sorted(STABLECOINS | STABLECOIN_SPLIT_SUFFIXES, key=len, reverse=True)
)


# ---------------------------------------------------------------------------
# Quote-currency derivation for the CCXT symbol format used during equity
# replay. Single source for the two byte-identical inline derivations that
# lived in ``_compute_daily_equity`` (the spot-balance loop and the perp
# mark-to-market loop).
# ---------------------------------------------------------------------------
def perp_quote(symbol: str) -> str:
    """Extract the quote currency from a CCXT-normalized symbol.

    CCXT renders linear perpetuals as ``"BTC/USDT:USDT"`` and inverse
    contracts as ``"BTC/USD:BTC"``; spot as ``"BTC/USDT"``. The quote leg is
    the segment after ``/`` with any ``:settle`` suffix stripped
    (``BTC/USD:BTC`` -> ``USD``, not ``USD:BTC``). Falls back to ``"USDT"``
    (the legacy perp-settle assumption) when the symbol has no ``/`` — e.g. a
    stripped holdings code.

    Behavior-identical to the prior inline
    ``raw_symbol.split("/")[-1].split(":")[0].upper() if "/" in raw_symbol
    else "USDT"`` (pinned by golden parity tests).
    """
    if symbol and "/" in symbol:
        return symbol.split("/")[-1].split(":")[0].upper()
    return "USDT"
