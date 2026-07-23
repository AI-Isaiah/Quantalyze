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

import os
from typing import Literal

# ---------------------------------------------------------------------------
# sFOX server/worker go-live gate (Phase 122 / F2 — the STRUCTURAL gate).
#
# Python mirror of the TS `isSfoxEnabledServer()` in src/lib/closed-sets.ts.
# DISTINCT from the TS client-build flag NEXT_PUBLIC_SFOX_ENABLED (which gates
# only the wizard CARD offer): this reads the worker/server env SFOX_ENABLED and
# gates whether a sfox key is ADMITTED for validation (routers/exchange.py
# /validate-key) and for onboard/resync processing (routers/process_key.py's
# per-flow source whitelist) AT ALL. Fail-CLOSED: strict lower-cased "true" —
# unset / "" / "1" / "on" / "TRUE " all read OFF, so a sfox connect fails closed
# honestly (a clean 4xx "not yet available", NEVER a live balance probe, NEVER a
# false-verified draft) until the founder sets SFOX_ENABLED=true on the worker at
# go-live, in lockstep with the Vercel server env of the same name (121/122
# runbook). A `.strip().lower()` normalization is used (not raw `== "true"`) so a
# fat-fingered "true\n" / "True" deploy value still reads ON — this direction is
# safe because it can only ENABLE, and enabling is the founder's explicit intent.
# ---------------------------------------------------------------------------
SFOX_DISABLED_DETAIL = "sFOX integration is not yet available."


def sfox_enabled_server() -> bool:
    """True iff SFOX_ENABLED is set to "true" (fail-closed; see module note)."""
    return (os.getenv("SFOX_ENABLED") or "").strip().lower() == "true"


# ---------------------------------------------------------------------------
# smoothed_mtm worker kill-switch (Phase 134 — SAFE ROLLOUT of the v1.14 basis).
#
# The worker computes a THIRD factsheet basis (`smoothed_mtm`) at derive time for
# every options book (Phases 131-133). A STRUCTURAL mark-hole in that pass
# (`LedgerValuationError`) fails the WHOLE job — cash + MTM headlines included.
# This flag lets the smoothed pass ship DARK: gated OFF (the default), the
# smoothed THIRD pass is SKIPPED ENTIRELY in both the single-key and composite
# derive routes (no ledger build, no dense-marks fetch, no assert_ledger_complete,
# no persist, no metrics_json_by_basis["smoothed_mtm"] key), so a structural
# mark-hole can NEVER fail a real prod job until the founder flips it on after
# monitoring. Flag ON → behavior is exactly as v1.14 built it.
#
# Read per-call (never a module-load const) so a test / go-live env change takes
# effect without a reimport. Fail-CLOSED with the SAME .strip().lower() == "true"
# normalization as sfox_enabled_server above: unset / "" / "1" / "on" / "TRUE "
# all read OFF; only an explicit "true" enables (the ENABLE-only tolerance is safe
# — it can only turn the dark basis on, the founder's explicit go-live intent).
# ---------------------------------------------------------------------------
def is_smoothed_mtm_enabled() -> bool:
    """True iff SMOOTHED_MTM_ENABLED is set to "true" (fail-closed; see note)."""
    return (os.getenv("SMOOTHED_MTM_ENABLED") or "").strip().lower() == "true"


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
# Crypto exchange venues — the "annualize on the crypto (√365) clock" set (#597).
# MD-01 (Fable code-review, Phase 105.1): single-sourced HERE precisely because it
# was hand-copied — the composite blend (``job_worker._COMPOSITE_CRYPTO_VENUES``)
# and the onboarding-teaser preview (``process_key._CRYPTO_VENUES``) held two
# independent literals of the SAME #597 decision. A new venue admitted to one only
# would drift the preview clock (√365) from the blend clock (√252) — the exact
# silent re-widening / hand-copy failure mode this module exists to prevent. Both
# now import from here. ``_COMPOSITE_DEGRADE_VENUES`` derives from it (minus deribit).
# SFOX-05: sfox is spot crypto — it annualizes on the crypto (√365) clock (#597)
# everywhere this canonical set is consumed (_resolve_asset_class → asset_class
# 'crypto'; the composite blend clock). Admitting it HERE (the single MD-01 source)
# proactively closes the known unknown-asset_class √252 blend-underestimation class
# for sfox: a sole sfox crypto leg can never be mis-annualized on the traditional
# clock. (The composite DEGRADABLE-member set is a DIFFERENT question — sfox has no
# ccxt reconstruction path — and is handled at job_worker._COMPOSITE_DEGRADE_VENUES.)
CRYPTO_VENUES: frozenset[str] = frozenset(
    {"deribit", "binance", "okx", "bybit", "sfox"}
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
