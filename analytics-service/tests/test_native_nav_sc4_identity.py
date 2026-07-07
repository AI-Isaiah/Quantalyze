"""SC-4 dual-run byte-identity suite (contract §4.2) — Plan 79-04 Task 3.

For a USD-native account the native per-currency core MUST be BIT-EXACT to the
legacy honest core, by construction (contract §4.1):

  1. Branch-1 coalescing — all USD-family currencies collapse into ONE "USD"
     bucket, quantities summed per day in PRODUCER ROW ORDER (no re-association).
  2. The ×1.0 mark is an IEEE-754 no-op — B_USD(d)×1.0 is bit-identical to
     B_USD(d) (including -0.0), so Σ over one bucket is the identity function.
  3. Verbatim reuse of the arithmetic core — the SAME reconstruct_nav backward
     roll, the SAME chain_linked_twr, the SAME _guard_denominator guards, the SAME
     terminal = anchor − upnl wedge subtraction.

This suite dual-runs the legacy path (``reconstruct_nav_and_twr``, fed the per-day
row-order-summed daily_pnl + Σ-equities anchor + flows + wedge exactly as
``trades_to_daily_returns_with_status`` derives them, transforms.py:190-208) vs
the native path (``reconstruct_native_nav_and_twr`` via a TEST-LOCAL adapter shim)
over a synthetic all-USD-family fixture matrix, asserting
``assert_series_equal(check_exact=True)`` AND ``dict(legacy_meta)==dict(native_meta)``.

Comparison level (Task-3 clarification / deviation): the two paths are compared at
the ``reconstruct_nav_and_twr`` CORE boundary, NOT the transforms wrapper. The
transforms wrapper (``trades_to_daily_returns_with_status`` → ``_merge_status_meta``)
DROPS ``twr_chain_broken`` from its returned meta (transforms.py:314-325 carries
only the DQ-01/FLOW-04 keys), so a transforms-level dict comparison could never
achieve the required ``twr_chain_broken`` interior-break parity. The core boundary
is the same-level counterpart of the native core (the transforms-level counterpart
is ``combine_native_ledger``, Phase 80). The shim adds the FLOW-04
``unrealized_pnl_in_anchor`` materiality flag exactly as the legacy core
(nav_twr.py:788) and the Phase-80 adapter do — the pure native core (§1.3 step 6)
emits only the guard + chain-break flags.

§4.1 operations exercised (A–J), each stressed by a named fixture below:
  A per-day pnl accumulation in row order      → multi_usd_family_order_sensitive
  B per-day flow accumulation, same-day collapse → quiet_day_flow
  C anchor scalar: Σ equities                  → every fixture (anchor = Σ terminal)
  D terminal = anchor − upnl                   → wedge_below_5pct / wedge_above_5pct
  E flow-day union into the pnl index          → quiet_day_flow
  F backward roll loop                         → every fixture
  G day-0 prev and r_t = (cur−prev−flow)/prev  → no_flows (day-0), quiet_day_flow
  H guard comparisons (<=0, <DUST, flow-dom)   → neg_nav_interior / dust_day / flow_dominated
  I wedge-materiality anchor>DUST ∧ |upnl|/anchor>0.05 → wedge_above_5pct
  J downstream series                          → (consumed by metrics, out of scope)

Full-history residual-clean invariant (§5): every fixture sets
``terminal_native_equity = Σ pnl + Σ flow + Σ wedge`` so the native inception gate
(``_assert_inception_reconciled``) reconciles to a ~0 pre-history balance — pinning
that the §5 gate does NOT perturb the identity path. A full-history account's
inception day has NO prior capital (prev0 == pre-history ≈ 0), so day-0 is a guard
NaN in BOTH paths — the first real return is day 1.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import pandas as pd
import pytest

from services.external_flows import ExternalFlow
from services.nav_twr import (
    DUST_NAV_FLOOR,
    UNREALIZED_MATERIALITY_RATIO,
    reconstruct_nav_and_twr,
)
from services.native_nav import NativeLedger, reconstruct_native_nav_and_twr

_D0 = pd.Timestamp("2026-01-01")


def _day(i: int) -> pd.Timestamp:
    return _D0 + pd.Timedelta(days=i)


def _iso(i: int) -> str:
    return str(_day(i).date())


@dataclass(frozen=True)
class _Fixture:
    """A synthetic all-USD-family account. ``rows`` are ordered (day_idx, ccy,
    change) tuples — their ORDER is the producer row order (op A). ``wedge`` is
    per-currency terminal uPnL; ``flows`` are (day_idx, ccy, usd_signed)."""

    name: str
    rows: list[tuple[int, str, float]]
    wedge: dict[str, float] = field(default_factory=dict)
    flows: list[tuple[int, str, float]] = field(default_factory=list)


def _terminal_total(fx: _Fixture) -> float:
    """Σ pnl + Σ flow + Σ wedge — the residual-clean terminal equity (§5): the
    backward roll of ``terminal − wedge`` lands at a ~0 pre-history balance."""
    total_pnl = sum(c for (_d, _c, c) in fx.rows)
    total_flow = sum(u for (_d, _c, u) in fx.flows)
    total_wedge = sum(fx.wedge.values())
    return total_pnl + total_flow + total_wedge


def _legacy(fx: _Fixture) -> tuple[pd.Series, dict[str, object]]:
    """Legacy honest core. daily_pnl = per-day sum in ROW ORDER (op A, the
    ``deribit_txn.py:768`` by_day.get(day,0)+usd accumulation the producer feeds
    ``trades_to_daily_returns_with_status``); anchor = Σ equities (op C); wedge in
    ``open_unrealized_usd`` (op D); 4-field flows valued at usd_signed (op B)."""
    by_day: dict[int, float] = {}
    for (d, _ccy, chg) in fx.rows:
        by_day[d] = by_day.get(d, 0.0) + chg
    ordered = sorted(by_day)
    core = pd.Series(
        [by_day[d] for d in ordered],
        index=pd.DatetimeIndex([_day(d) for d in ordered]),
        name="daily_pnl",
    )
    anchor = _terminal_total(fx)
    upnl = sum(fx.wedge.values())
    ext = [ExternalFlow(_iso(d), u, c, u) for (d, c, u) in fx.flows]
    returns, meta = reconstruct_nav_and_twr(
        core, anchor, external_flows=ext or None, open_unrealized_usd=upnl
    )
    return returns, dict(meta)


def _native(fx: _Fixture) -> tuple[pd.Series, dict[str, object]]:
    """Native path via a TEST-LOCAL adapter shim: per-(day,ccy) native pnl summed
    in row order (op A) → NativeLedger (marks EMPTY — branch-1 must NOT appear;
    4-field flows with quantity == usd_signed, the branch-1 identity; full_history
    True) → ``reconstruct_native_nav_and_twr(indexable_currencies=frozenset())``.

    The shim then adds the FLOW-04 ``unrealized_pnl_in_anchor`` flag exactly as the
    legacy core (nav_twr.py:788) / the Phase-80 adapter — the pure native core
    (§1.3 step 6) emits only guard + chain-break flags.

    MUTATION-HONESTY (neuter 4): removing the ``unrealized_pnl_in_anchor`` block
    makes the native meta MISS the flag on the >5% wedge fixture → the dict
    equality reddens (the contract §4.2 'one-sided meta divergence' the suite
    exists to catch).
    """
    per: dict[str, dict[int, float]] = {}
    for (d, ccy, chg) in fx.rows:
        per.setdefault(ccy, {})
        per[ccy][d] = per[ccy].get(d, 0.0) + chg
    native_pnl: dict[str, pd.Series] = {}
    for ccy, dd in per.items():
        ordered = sorted(dd)
        native_pnl[ccy] = pd.Series(
            [dd[d] for d in ordered],
            index=pd.DatetimeIndex([_day(d) for d in ordered]),
            name="native_pnl",
        )
    primary = fx.rows[0][1]
    ledger = NativeLedger(
        native_pnl=native_pnl,
        # All residual-closing equity on the first currency; the coalesced "USD"
        # bucket sums terminal_native_equity across every USD-family currency, so
        # the total equals the legacy anchor (op C).
        terminal_native_equity={primary: _terminal_total(fx)},
        marks={},  # branch-1 mark ≡ 1.0 (IEEE no-op); marks MUST be empty
        native_flows=[ExternalFlow(_iso(d), u, c, u) for (d, c, u) in fx.flows],
        terminal_upnl_native=dict(fx.wedge),
        full_history=True,
    )
    returns, meta_td = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=frozenset()
    )
    meta = dict(meta_td)
    anchor = _terminal_total(fx)
    upnl = sum(fx.wedge.values())
    if anchor > DUST_NAV_FLOOR and abs(upnl) / anchor > UNREALIZED_MATERIALITY_RATIO:
        meta["unrealized_pnl_in_anchor"] = True
        meta["computation_status_hint"] = "complete_with_warnings"
    return returns, meta


# The §4.2 fixture matrix — synthetic all-USDC/USDT/USD accounts. Every terminal
# equity is auto-set residual-clean (_terminal_total) so the §5 inception gate is
# green on the whole matrix.
_FIXTURES: list[_Fixture] = [
    # {no flows}: op G day-0 (prev0 == pre-history), plain roll.
    _Fixture(
        "no_flows",
        [(0, "USDC", 100000.0), (1, "USDC", 50000.0), (2, "USDC", -30000.0)],
    ),
    # {quiet-day flow}: op B same-day flow accumulation + op E flow-day union — a
    # withdrawal on a no-trade day becomes a valid zero-pnl NAV day (r == 0).
    _Fixture(
        "quiet_day_flow",
        [(0, "USDC", 100000.0), (2, "USDC", -20000.0)],
        flows=[(1, "USDC", -5000.0)],
    ),
    # {flow-dominated day}: op H flow_dominated_guard (|flow| >= prev) on an
    # INTERIOR day flanked by valid returns → twr_chain_broken parity.
    _Fixture(
        "flow_dominated",
        [(0, "USDC", 50000.0), (1, "USDC", 10000.0), (2, "USDC", -65000.0),
         (3, "USDC", -15000.0), (4, "USDC", 5000.0)],
        flows=[(2, "USDC", 60000.0)],
    ),
    # {negative-reconstructed-NAV day}: op H negative_nav_guard on an INTERIOR day
    # (retained valid returns on BOTH sides) → twr_chain_broken fires in the legacy
    # AND native meta; a forked/one-sided break detector is caught here.
    _Fixture(
        "neg_nav_interior_break",
        [(0, "USDC", 50000.0), (1, "USDC", 10000.0), (2, "USDC", -65000.0),
         (3, "USDC", 45000.0), (4, "USDC", 5000.0)],
    ),
    # {dust day}: op H dust_nav_guard (0 < prev < DUST_NAV_FLOOR) on an interior day.
    _Fixture(
        "dust_day",
        [(0, "USDC", 50000.0), (1, "USDC", -49500.0), (2, "USDC", 39500.0),
         (3, "USDC", 5000.0)],
    ),
    # {uPnL wedge below 5%}: op D terminal = anchor − upnl; below the materiality
    # ratio ⇒ NO unrealized_pnl_in_anchor in either meta.
    _Fixture(
        "wedge_below_5pct",
        [(0, "USDT", 100000.0), (1, "USDT", 50000.0), (2, "USDT", -30000.0)],
        wedge={"USDT": 5000.0},  # 5000 / 125000 = 4% < 5%
    ),
    # {uPnL wedge above 5%}: op I wedge-materiality → unrealized_pnl_in_anchor
    # parity (legacy core + native shim BOTH flag it).
    _Fixture(
        "wedge_above_5pct",
        [(0, "USDT", 200000.0), (1, "USDT", 40000.0), (2, "USDT", -20000.0)],
        wedge={"USDT": 30000.0},  # 30000 / 250000 = 12% > 5%
    ),
    # {multi-USD-family currencies on the same day}: op A row-order accumulation.
    # Day-1 change values are float64 order-sensitive (1e16 + 1 + 1): the correct
    # left fold is ((1e16+1)+1) == 1e16, but a re-association ((1+1)+1e16) == 1e16+2
    # — 2 ULP apart. The day-1 return is pnl_1 / NAV_0, so the last bit propagates.
    _Fixture(
        "multi_usd_family_order_sensitive",
        [(0, "USDC", 1e15),
         (1, "USDC", 1e16), (1, "USDT", 1.0), (1, "USD", 1.0),
         (2, "USDC", 5e14)],
    ),
]


@pytest.mark.parametrize("fx", _FIXTURES, ids=lambda f: f.name)
def test_dual_run_bit_exact(fx: _Fixture) -> None:
    """The native path is BIT-EXACT (series) and BYTE-EQUAL (meta) to the legacy
    honest core over the whole §4.2 matrix.

    MUTATION-HONESTY (each neuter reddens this suite):
      (1) mutating the native path to sum currencies BEFORE rolling in a DIFFERENT
          order (re-associating `_coalesce_usd_pnl`'s left fold) flips
          `multi_usd_family_order_sensitive`'s check_exact red — GUARANTEED because
          that fixture's day-1 change values are order-sensitive ((a+b)+c != a+(b+c));
          a "nice"-valued fixture would let the re-association pass silently.
      (2) multiplying a branch-1 balance by a recomputed 1.0-ish mark (any
          arithmetic detour that is not the IEEE ×1.0 no-op) flips check_exact red
          via the IEEE premise pinned in `test_ieee_x_times_one_is_bit_identity`.
      (3) deriving day-0 prev differently in the native `_prev0_usd` (prev0 ≠ the
          literal cur − pnl0 − flow0 reduction) flips `no_flows` / `quiet_day_flow`
          red on day 0 (a nonzero prev0 turns the inception-day guard-NaN into a
          finite number).
      (4) a forked/one-sided break detector OR the native shim missing
          `unrealized_pnl_in_anchor` on the >5% wedge fixture flips the meta dict
          equality — the negative-NAV break is INTERIOR (retained BOTH sides) so
          twr_chain_broken MUST appear in BOTH metas; the >5% wedge flag MUST
          appear in both.
    """
    legacy_returns, legacy_meta = _legacy(fx)
    native_returns, native_meta = _native(fx)
    pd.testing.assert_series_equal(
        legacy_returns, native_returns, check_exact=True
    )
    assert dict(legacy_meta) == dict(native_meta)


def test_inception_gate_green_on_matrix() -> None:
    """Every matrix fixture is residual-clean, so the native §5 inception gate
    passes (no ``InceptionReconciliationError``) — pinning that the gate does NOT
    perturb the identity path. If it raised, the parametrized dual-run above would
    already error; this makes the guarantee explicit."""
    for fx in _FIXTURES:
        returns, meta = _native(fx)  # raises InceptionReconciliationError on breach
        assert isinstance(returns, pd.Series)
        assert meta["computation_status_hint"] in (
            "complete", "complete_with_warnings"
        )


def test_ieee_x_times_one_is_bit_identity() -> None:
    """The §4.2 item-4 micro-pin: ``x * 1.0`` is bit-identical to ``x`` for every
    finite/edge float — the branch-1 ×1.0 mark premise, pinned AT the premise so a
    platform/numpy change is caught HERE, not downstream. Covers -0.0, denormals,
    and large magnitudes."""
    sample = [
        0.0, -0.0, 1.0, -1.0,
        5e-324, 2.2e-308,           # subnormal / smallest normal
        1e308, -1e308,              # large magnitudes
        123456.789, -0.000123456,   # typical NAV / return floats
        1e16, 1e16 + 2.0,           # the multi-currency order-sensitive scale
    ]
    for x in sample:
        assert struct.pack("<d", x * 1.0) == struct.pack("<d", x), x
    # -0.0 specifically keeps its sign bit through the multiply.
    assert struct.pack("<d", -0.0 * 1.0) == struct.pack("<d", -0.0)
