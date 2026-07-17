"""Phase 115 (E2) shared derivation fixtures — pure, deterministic, no I/O.

These builders encode the STITCH scenarios (STITCH-01 blend, STITCH-03/04 $-equity
backward replay, STITCH-05/06 cashflow + synthetic-seam ledger) so plans 02/03/04/05
import them READ-ONLY. No supabase, no network, no filesystem — every value here is
hand-derivable from the constants below.

Scenario map:
  * Keys A and B are FULLY CONCURRENT over the same 60-day window with DIFFERENT
    return paths — the capital-weighted BLEND case (STITCH-01, Landmine L1: concurrent
    coverage is a blend, NEVER the disjoint-window stitch — do not feed A/B through
    assert_windows_disjoint, it will correctly refuse).
  * Key C is ROTATED: its window ENDS the day before replacement key D BEGINS — a
    genuine SEQUENTIAL seam. Windows are half-open [start, end) per the ONE shared
    overlap convention (tests/fixtures/window_overlap_convention.json): C.end == D.start
    so the handoff boundary does NOT overlap. This is the STITCH-06 seam case (the
    boundary equity jump is a SYNTHETIC flow through the same ledger; TWR stays clean).
  * Flow fixtures: one mid-window deposit (positive), one withdrawal (negative,
    fee-debit sign convention), and one flow on a NO-TRADE day (a union day with no
    return — the nav_twr HIGH-1 shape).
  * Anchor fixtures: round terminal equities for backward replay + an anchor=None
    variant for the honest-degradation path (no anchor -> perf-curve WITHOUT a $-curve,
    never invented data).
  * A deribit-flavored per-key variant (venue tag) so plan 04's dogfooding-gap tests
    share the exact series shape.

CONVENTION: this module is created ONCE in wave 1 and imported afterwards. Later test
files add their OWN LOCAL fixtures rather than editing this module (so a plan-05 tweak
cannot silently perturb a plan-02 test). Treat everything here as frozen shared input.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from services.external_flows import ExternalFlow

# ---------------------------------------------------------------------------
# Constants (everything below is derivable from these)
# ---------------------------------------------------------------------------

WINDOW_START = date(2026, 3, 1)          # concurrent A/B (and rotated C) start here
CONCURRENT_DAYS = 60                     # A and B span [2026-03-01, 2026-04-30)
ROTATED_C_DAYS = 20                      # C: [2026-03-01, 2026-03-21)
ROTATED_D_DAYS = 20                      # D: [2026-03-21, 2026-04-10)


def _iso(d: date) -> str:
    return d.isoformat()


def _iso_range(start: date, n_days: int) -> list[str]:
    return [_iso(start + timedelta(days=i)) for i in range(n_days)]


# ---------------------------------------------------------------------------
# (a) per-key return series builder
# ---------------------------------------------------------------------------

def make_per_key_returns(
    key_id: str,
    start_day: date | str,
    n_days: int,
    daily: float,
) -> pd.Series:
    """A deterministic per-key daily-return Series indexed by ISO day strings.

    Constant `daily` return over `n_days` starting at `start_day`. Index entries are
    'YYYY-MM-DD' strings (matching reconstruct_symbol_returns / csv_daily_returns day
    keys); name == key_id. Pure — no rounding surprises, no I/O.
    """
    if isinstance(start_day, str):
        start_day = date.fromisoformat(start_day)
    idx = _iso_range(start_day, n_days)
    return pd.Series([daily] * n_days, index=idx, name=key_id)


# ---------------------------------------------------------------------------
# (b) canonical three-key (+ replacement D) scenario
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class KeyFixture:
    key_id: str
    venue: str
    window_start: str          # half-open [start, end)
    window_end: str            # exclusive; matches window_overlap_convention.json
    returns: pd.Series
    terminal_equity: float | None   # anchor for backward replay; None = honest degradation


def _key_a() -> KeyFixture:
    r = make_per_key_returns("key-A", WINDOW_START, CONCURRENT_DAYS, daily=0.005)
    end = WINDOW_START + timedelta(days=CONCURRENT_DAYS)   # 2026-04-30
    return KeyFixture("key-A", "binance", _iso(WINDOW_START), _iso(end), r, terminal_equity=120000.0)


def _key_b() -> KeyFixture:
    # Concurrent with A over the SAME window, DIFFERENT path (down-drift).
    r = make_per_key_returns("key-B", WINDOW_START, CONCURRENT_DAYS, daily=-0.002)
    end = WINDOW_START + timedelta(days=CONCURRENT_DAYS)
    return KeyFixture("key-B", "okx", _iso(WINDOW_START), _iso(end), r, terminal_equity=80000.0)


def _key_c() -> KeyFixture:
    # Rotated: window ends the day BEFORE D begins.
    r = make_per_key_returns("key-C", WINDOW_START, ROTATED_C_DAYS, daily=0.003)
    end = WINDOW_START + timedelta(days=ROTATED_C_DAYS)     # 2026-03-21 (exclusive)
    return KeyFixture("key-C", "binance", _iso(WINDOW_START), _iso(end), r, terminal_equity=50000.0)


def _key_d() -> KeyFixture:
    # Replacement: starts exactly at C's exclusive end (adjacent half-open, no overlap).
    d_start = WINDOW_START + timedelta(days=ROTATED_C_DAYS)  # 2026-03-21
    r = make_per_key_returns("key-D", d_start, ROTATED_D_DAYS, daily=-0.001)
    d_end = d_start + timedelta(days=ROTATED_D_DAYS)         # 2026-04-10
    return KeyFixture("key-D", "binance", _iso(d_start), _iso(d_end), r, terminal_equity=60000.0)


def concurrent_pair() -> tuple[KeyFixture, KeyFixture]:
    """Keys A + B: fully concurrent, different paths — the capital-weighted BLEND case."""
    return _key_a(), _key_b()


def rotated_seam_pair() -> tuple[KeyFixture, KeyFixture]:
    """Keys C + D: sequential coverage with a half-open handoff seam (STITCH-06)."""
    return _key_c(), _key_d()


def three_key_scenario() -> dict[str, KeyFixture]:
    """Canonical scenario: A+B concurrent, C rotated into D (sequential seam)."""
    a, b = concurrent_pair()
    c, d = rotated_seam_pair()
    return {"A": a, "B": b, "C": c, "D": d}


# ---------------------------------------------------------------------------
# (c) real-flow fixtures (one deposit, one withdrawal, one no-trade-day union flow)
# ---------------------------------------------------------------------------

# Days present in the concurrent A/B return index.
_DEPOSIT_DAY = _iso(WINDOW_START + timedelta(days=9))    # 2026-03-10, mid-window
_WITHDRAWAL_DAY = _iso(WINDOW_START + timedelta(days=19))  # 2026-03-20, mid-window
# A day with NO return in the index (pre-start) — the nav_twr HIGH-1 union-day shape.
_NO_TRADE_DAY = _iso(WINDOW_START - timedelta(days=1))   # 2026-02-28


def real_flows() -> list[ExternalFlow]:
    """A mid-window deposit (+), a withdrawal (-, fee-debit sign convention), and a
    flow on a no-trade day (union day, no matching return). Deposit POSITIVE /
    withdrawal NEGATIVE per external_flows.py + nav_twr.py:28-29."""
    return [
        ExternalFlow(_DEPOSIT_DAY, 10000.0),        # deposit / reward-in POSITIVE
        ExternalFlow(_WITHDRAWAL_DAY, -5000.0),     # withdrawal (incl. fee debit) NEGATIVE
        ExternalFlow(_NO_TRADE_DAY, 2500.0),        # union day: flow with no same-day return
    ]


FLOW_DAYS = {
    "deposit": _DEPOSIT_DAY,
    "withdrawal": _WITHDRAWAL_DAY,
    "no_trade": _NO_TRADE_DAY,
}


# ---------------------------------------------------------------------------
# (d) anchor fixtures (round terminals + anchor=None honest-degradation variant)
# ---------------------------------------------------------------------------

# Round terminal equities keyed by fixture id — chosen for hand-checkable backward
# replay (NAV_{t-1} = NAV_t - pnl_t - F_t from the terminal anchor).
ANCHORS: dict[str, float] = {
    "key-A": 120000.0,
    "key-B": 80000.0,
    "key-C": 50000.0,
    "key-D": 60000.0,
}

# Honest-degradation: no anchor available -> derive the perf-curve but NO $-curve
# (never invent data). Plans 03/05 assert the degraded shape against this.
ANCHOR_NONE: None = None


# ---------------------------------------------------------------------------
# (e) deribit-flavored per-key variant (venue tag) for plan 04's gap-closure tests
# ---------------------------------------------------------------------------

def deribit_key_returns(key_id: str = "key-deribit", n_days: int = 60, daily: float = 0.004) -> KeyFixture:
    """A per-key series with the SAME shape as the ccxt keys but tagged venue=deribit,
    so plan 04 (all-deribit dogfooding gap-closure) shares the exact fixture shape."""
    r = make_per_key_returns(key_id, WINDOW_START, n_days, daily=daily)
    end = WINDOW_START + timedelta(days=n_days)
    return KeyFixture(key_id, "deribit", _iso(WINDOW_START), _iso(end), r, terminal_equity=40000.0)
