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

import asyncio
import struct
from dataclasses import dataclass, field

import pandas as pd
import pytest

from typing import Any

import services.deribit_ingest as di
from services.broker_dailies import combine_native_ledger, gap_fill_daily_returns
from services.deribit_txn import deribit_equity_to_usd
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


# ===========================================================================
# SHIP GATE (i) — SC-4 dual-run bit-identity against the REAL adapter (80-03 T3).
#
# The tier above dual-runs the legacy core vs a TEST-LOCAL native shim. This tier
# drives the native side through the REAL production adapter
# (``build_deribit_native_ledger``, 80-02) fed synthetic Deribit exchange stubs
# (NO network), then through the REAL ``combine_native_ledger`` (80-03 T1) — the
# exact production seam the job path now takes. The merge is BLOCKED unless this
# tier is bit-exact (check_exact=True series + byte-equal meta) over the whole
# all-USD-family §4.2 matrix. Per D8, byte-identity is asserted ONLY over
# genuinely all-USD-family accounts; a coin/dust account legitimately MOVES and is
# proven excluded (test_dust_account_excluded_from_identity), never falsely
# asserted identical.
# ===========================================================================


def _day_ms(i: int) -> int:
    """UTC epoch-ms for fixture day ``i`` (naive midnight treated as UTC)."""
    return int(_day(i).value // 1_000_000)


def _fixture_currencies(fx: _Fixture) -> list[str]:
    """First-appearance order of every currency in the fixture — the producer row
    order the real crawl's ``enumerate_currencies`` must return so raw_rows (a
    per-currency concatenation) fold in the SAME order the legacy per-day sum does
    (op A). A different enumeration order would re-associate the day-1 fold on the
    order-sensitive fixture and redden check_exact."""
    seen: list[str] = []
    for (_d, c, _chg) in fx.rows:
        if c not in seen:
            seen.append(c)
    for (_d, c, _u) in fx.flows:
        if c not in seen:
            seen.append(c)
    for c in fx.wedge:
        if c not in seen:
            seen.append(c)
    return seen


class _DeribitAdapterStub:
    """A synthetic Deribit exchange: ONE get_account_summaries response for the
    native anchor/wedge read. The crawl I/O primitives (enumerate_*, paginate) are
    monkeypatched onto the ``di`` module; for an all-USD-family account NO index /
    delivery-price endpoint is ever hit (USD-family is never probed, gets no
    marks), so this stub needs only the summaries method."""

    def __init__(self, summaries: list[dict[str, Any]]) -> None:
        self._summaries = summaries

    async def private_get_get_account_summaries(
        self, params: dict[str, Any]
    ) -> Any:
        return {"result": {"summaries": self._summaries}}


def _real_adapter_ledger(
    fx: _Fixture, monkeypatch: Any
) -> tuple[NativeLedger, di.CompletenessReport]:
    """Build a NativeLedger via the REAL build_deribit_native_ledger from synthetic
    Deribit rows/summaries — settlement rows → native pnl, external-flow rows →
    dated flows, per-currency summaries → native anchor/wedge. The residual-clean
    terminal (Σpnl+Σflow+Σwedge) is concentrated on the primary currency so the
    coalesced USD bucket's terminal == the legacy anchor (op C)."""
    currencies = _fixture_currencies(fx)
    primary = fx.rows[0][1]

    rows_by_ccy: dict[str, list[dict[str, Any]]] = {c: [] for c in currencies}
    for (d, ccy, chg) in fx.rows:
        rows_by_ccy[ccy].append(
            {"type": "settlement", "currency": ccy, "change": chg,
             "timestamp": _day_ms(d)}
        )
    for (d, ccy, u) in fx.flows:
        # USD-family external flow: linear pass-through, native change == usd.
        rows_by_ccy.setdefault(ccy, []).append(
            {"type": "withdrawal" if u < 0 else "deposit", "currency": ccy,
             "change": u, "timestamp": _day_ms(d)}
        )

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return list(currencies)

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        return list(rows_by_ccy.get(currency, []))

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)

    # Per-currency native summaries: all residual-closing equity on the primary
    # (equity == the legacy anchor); the wedge sits on its own currency.
    anchor = _terminal_total(fx)
    summaries = [
        {"currency": primary, "equity": anchor,
         "session_upl": float(fx.wedge.get(primary, 0.0))}
    ]
    for ccy in currencies:
        if ccy == primary:
            continue
        summaries.append(
            {"currency": ccy, "equity": 0.0,
             "session_upl": float(fx.wedge.get(ccy, 0.0))}
        )

    stub = _DeribitAdapterStub(summaries)
    return asyncio.run(di.build_deribit_native_ledger(stub))


def _native_real(
    fx: _Fixture, monkeypatch: Any
) -> tuple[pd.Series, dict[str, object]]:
    """The native side through the REAL production seam: build_deribit_native_ledger
    → combine_native_ledger. The FLOW-04 unrealized_pnl_in_anchor materiality flag
    is added exactly as the job_worker deribit branch does (the pure core does not
    emit it — it subtracts the wedge per-currency, App A #6)."""
    ledger, report = _real_adapter_ledger(fx, monkeypatch)
    returns, meta = combine_native_ledger(ledger, report.indexable_currencies)
    anchor = _terminal_total(fx)
    upnl = sum(fx.wedge.values())
    if anchor > DUST_NAV_FLOOR and abs(upnl) / anchor > UNREALIZED_MATERIALITY_RATIO:
        meta["unrealized_pnl_in_anchor"] = True
        meta["computation_status_hint"] = "complete_with_warnings"
    return returns, meta


def _legacy_gapfilled(fx: _Fixture) -> tuple[pd.Series, dict[str, object]]:
    """The legacy core returns gap-filled to the daily calendar so it matches
    combine_native_ledger's gap_fill (a no-op on the contiguous fixtures, applied
    symmetrically to guarantee the comparison is at the same shape)."""
    returns, meta = _legacy(fx)
    return gap_fill_daily_returns(returns), meta


@pytest.mark.parametrize("fx", _FIXTURES, ids=lambda f: f.name)
def test_dual_run_bit_exact_real_adapter(fx: _Fixture, monkeypatch: Any) -> None:
    """SHIP GATE (i): the native path through the REAL build_deribit_native_ledger
    adapter + combine_native_ledger is BIT-EXACT (series) and BYTE-EQUAL (meta) to
    the legacy honest core over the whole all-USD-family §4.2 matrix. This is the
    merge-blocking assertion — a silent return rescale on ANY USD-native account
    (T-80-09) cannot land.

    What each layer of the real seam this pins: the adapter's per-currency native
    pnl (``txn_rows_to_native_daily``), the collapsed anchor (Σ summaries equity),
    the 4-field dated flows, the core's backward roll + §5 inception gate + §6
    chain-break merge, and ``combine_native_ledger``'s gap_fill — every one must
    reproduce the legacy returns bit-for-bit and the legacy guard/chain-break/
    materiality meta byte-for-byte.

    MUTATION-HONESTY: the interior-break fixtures (flow_dominated, neg_nav_interior_
    break) redden the META equality if the native path's twr_chain_broken detection
    forks one-sided; the wedge_above_5pct fixture reddens if the FLOW-04
    unrealized_pnl_in_anchor materiality flag is dropped from the native seam (see
    the neuter in test_real_adapter_materiality_flag_is_load_bearing). op A row-order
    coalescing is pinned at the CORE by the shim tier's neuter (1); op C anchor
    composition by test_anchor_composition_pin_real_adapter; the ×1.0 mark by
    test_ieee_x_times_one_is_bit_identity. (The adapter canonicalises currency order
    via txn_rows_to_native_daily, so the fold is deterministic regardless of crawl
    order — enumerate order is intentionally NOT a divergence vector here.)
    """
    legacy_returns, legacy_meta = _legacy_gapfilled(fx)
    native_returns, native_meta = _native_real(fx, monkeypatch)
    pd.testing.assert_series_equal(
        legacy_returns, native_returns, check_exact=True, check_names=False
    )
    assert dict(legacy_meta) == dict(native_meta)


def test_real_adapter_materiality_flag_is_load_bearing(monkeypatch: Any) -> None:
    """The meta byte-equality in the gate is LOAD-BEARING: the >5% wedge fixture's
    native meta carries unrealized_pnl_in_anchor + complete_with_warnings, matching
    the legacy core. If the native seam DROPPED the materiality flag (the pure core
    does not emit it), this fixture's meta would diverge one-sided — proving the
    gate's dict equality actually catches a dropped warning, not just series."""
    fx = next(f for f in _FIXTURES if f.name == "wedge_above_5pct")
    _legacy_returns, legacy_meta = _legacy_gapfilled(fx)
    _native_returns, native_meta = _native_real(fx, monkeypatch)
    # Both metas MUST carry the material-wedge warning.
    assert legacy_meta.get("unrealized_pnl_in_anchor") is True
    assert native_meta.get("unrealized_pnl_in_anchor") is True
    assert native_meta.get("computation_status_hint") == "complete_with_warnings"
    # And a native meta WITHOUT the flag would break the gate equality.
    dropped = dict(native_meta)
    dropped.pop("unrealized_pnl_in_anchor", None)
    dropped["computation_status_hint"] = "complete"
    assert dict(legacy_meta) != dropped


def test_anchor_composition_pin_real_adapter(monkeypatch: Any) -> None:
    """D8 / op C: with the residual-closing equity DISTRIBUTED across multiple
    USD-family currencies (order-sensitive magnitudes), the coalesced native anchor
    (Σ terminal_native_equity[branch-1] × 1.0) equals deribit_equity_to_usd's float
    computed over the SAME summaries order. A re-ordered/re-associated anchor sum
    would land a different last bit and redden the dual-run's check_exact — this
    test pins the premise directly at the anchor.

    The three summaries' equities are 1e16, 1.0, 1.0 — ((1e16+1)+1) == 1e16+2 but a
    re-association ((1+1)+1e16) == 1e16 (2 ULP apart at this scale)."""
    summaries = [
        {"currency": "USDC", "equity": 1e16, "session_upl": 0.0},
        {"currency": "USDT", "equity": 1.0, "session_upl": 0.0},
        {"currency": "USD", "equity": 1.0, "session_upl": 0.0},
    ]
    # The collapsed USD anchor, summed in summaries order (mark ≡ 1.0 for USD-family).
    collapsed = deribit_equity_to_usd(summaries, {})
    # The native coalesced anchor = Σ terminal_native_equity in the SAME order.
    native_anchor = 0.0
    for s in summaries:
        native_anchor += float(s["equity"]) * 1.0
    assert struct.pack("<d", native_anchor) == struct.pack("<d", collapsed), (
        "the native anchor must be bit-identical to the collapsed anchor in "
        "summaries order (op C)"
    )
    # And the order-sensitivity is real at this scale (guards a "nice" fixture).
    reassociated = (1.0 + 1.0) + 1e16
    assert struct.pack("<d", native_anchor) != struct.pack("<d", reassociated)


def test_dust_account_excluded_from_identity(monkeypatch: Any) -> None:
    """D8: an account carrying coin DUST is NOT byte-identical old-vs-new — the
    native path routes the dust into a marks-valued coin bucket while the legacy
    collapsed anchor folds it into initial capital at the anchor-instant index. Such
    an account legitimately MOVES; it is a parity-panel case (80-04), NOT a gate-i
    identity fixture. This documents the boundary: a dust-bearing account produces a
    native reconstruction that carries the coin bucket (≠ a pure-USD roll), so
    asserting byte-identity on it would be FALSE. We prove the native path yields a
    finite coin-inclusive series (not a refusal) and that it is DISTINCT from the
    pure-USD legacy roll."""
    # A USDC account (settlements) PLUS a nonzero BTC dust settlement + a BTC mark.
    currencies = ["USDC", "BTC"]

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return list(currencies)

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        if currency == "USDC":
            return [
                {"type": "settlement", "currency": "USDC", "change": 100_000.0,
                 "timestamp": _day_ms(0)},
                {"type": "settlement", "currency": "USDC", "change": 50_000.0,
                 "timestamp": _day_ms(1)},
            ]
        if currency == "BTC":
            return [
                {"type": "settlement", "currency": "BTC", "change": 0.01,
                 "timestamp": _day_ms(1)},
            ]
        return []

    async def _index_probe(_ex: Any, _ccy: str, *, oldest_day: str, sleep: Any) -> Any:
        return {_iso(0): 50_000.0, _iso(1): 50_000.0}

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)
    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _index_probe)

    class _CoinStub:
        async def private_get_get_account_summaries(self, params: Any) -> Any:
            # USDC 150k + 0.01 BTC × 50k = 500 in native coin units.
            return {"result": {"summaries": [
                {"currency": "USDC", "equity": 150_000.0, "session_upl": 0.0},
                {"currency": "BTC", "equity": 0.01, "session_upl": 0.0},
            ]}}

        async def public_get_get_index_price(self, params: Any) -> Any:
            return {"result": {"index_price": 50_000.0}}

    stub = _CoinStub()
    ledger, report = asyncio.run(di.build_deribit_native_ledger(stub))
    # The dust BTC is INDEXED and marked — the native path carries a coin bucket.
    assert "BTC" in ledger.marks, "the dust coin must be a marks-valued bucket"
    native_returns, _ = combine_native_ledger(ledger, report.indexable_currencies)
    # A pure-USD legacy roll of the SAME USDC-only activity (no BTC).
    usd_fx = _Fixture(
        "usd_only", [(0, "USDC", 100_000.0), (1, "USDC", 50_000.0)]
    )
    legacy_returns, _ = _legacy_gapfilled(usd_fx)
    # The dust account MOVES relative to the pure-USD roll — NOT byte-identical.
    assert not native_returns.equals(legacy_returns), (
        "a dust-bearing account legitimately differs from a pure-USD roll — it is "
        "a parity-panel MOVED case (80-04), never a gate-i identity fixture (D8)"
    )


def _build_ledger_from_rows(
    rows_by_ccy: dict[str, list[dict[str, Any]]],
    summaries: list[dict[str, Any]],
    currencies: list[str],
    monkeypatch: Any,
) -> tuple[NativeLedger, di.CompletenessReport]:
    """Build a NativeLedger via the REAL ``build_deribit_native_ledger`` from
    explicit per-currency raw rows + summaries (all-USD-family → no index endpoint
    is ever hit)."""

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return list(currencies)

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        return list(rows_by_ccy.get(currency, []))

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)
    stub = _DeribitAdapterStub(summaries)
    return asyncio.run(di.build_deribit_native_ledger(stub))


def test_same_family_swap_is_noop_in_coalesced_usd_bucket(monkeypatch: Any) -> None:
    """SC-4 decision (same-family swap): HIGH-1's native ``swap`` inclusion is
    native-only, so a same-family USDC↔USDT swap is absorbed by the branch-1
    coalesce. A net-zero swap (−100 USDC / +100 USDT, both marked ≡ 1.0) sums to
    EXACTLY 0.0 within the single 'USD' bucket, so it is a NO-OP: the native
    reconstruction of an all-USD account WITH the swap is byte-identical to the SAME
    account WITHOUT it, and it reconciles under the §5 inception gate (no false
    breach). This pins that the swap fix cannot inject a spurious return into a
    USD-native account — it is invisible to the SC-4 byte-identity gate. (A
    cross-collateral swap, where one leg is an INDEXED coin, is the real
    conservation case HIGH-1 reconciles at the integration test.)

    A same-family swap with real slippage would net to a small nonzero USD loss the
    coalesce correctly captures (native being MORE correct than the legacy path that
    drops swaps entirely) — that is a MOVED parity case, not a gate-i fixture."""
    # Baseline: deposit +1,000 USDC (day 0), settlement +50 USDC (day 1). No swap.
    rows_no_swap = {
        "USDC": [
            {"type": "deposit", "currency": "USDC", "change": 1000.0,
             "timestamp": _day_ms(0)},
            {"type": "settlement", "currency": "USDC", "change": 50.0,
             "timestamp": _day_ms(1)},
        ]
    }
    led_no, rep_no = _build_ledger_from_rows(
        rows_no_swap,
        [{"currency": "USDC", "equity": 1050.0, "session_upl": 0.0}],
        ["USDC"],
        monkeypatch,
    )
    ret_no, _ = reconstruct_native_nav_and_twr(
        led_no, indexable_currencies=rep_no.indexable_currencies, venue="deribit"
    )

    # Same account PLUS a net-zero same-family swap on day 1 (−100 USDC / +100 USDT).
    # Terminal shifts −100 USDC / +100 USDT (net zero → coalesced anchor unchanged).
    rows_swap = {
        "USDC": [
            {"type": "deposit", "currency": "USDC", "change": 1000.0,
             "timestamp": _day_ms(0)},
            {"type": "settlement", "currency": "USDC", "change": 50.0,
             "timestamp": _day_ms(1)},
            {"type": "swap", "currency": "USDC", "change": -100.0,
             "timestamp": _day_ms(1)},
        ],
        "USDT": [
            {"type": "swap", "currency": "USDT", "change": 100.0,
             "timestamp": _day_ms(1)},
        ],
    }
    led_sw, rep_sw = _build_ledger_from_rows(
        rows_swap,
        [
            {"currency": "USDC", "equity": 950.0, "session_upl": 0.0},
            {"currency": "USDT", "equity": 100.0, "session_upl": 0.0},
        ],
        ["USDC", "USDT"],
        monkeypatch,
    )
    ret_sw, _ = reconstruct_native_nav_and_twr(
        led_sw, indexable_currencies=rep_sw.indexable_currencies, venue="deribit"
    )

    # The swap legs cancel in the coalesced 'USD' bucket → byte-identical returns.
    pd.testing.assert_series_equal(ret_no, ret_sw, check_exact=True)


# ===========================================================================
# Phase 83 Task 7 — SC-4 byte-identity for an INVERSE (BTC-margined) perp-only
# ledger. The option arms are classification-gated: a ledger with ZERO option
# rows and ZERO summary rows has an EMPTY replay → NO marks fetched → the ΔMTM
# merge is a no-op → the native_pnl dict is BIT-EXACT to the OLD Σchange formula.
# Proven through the REAL build_deribit_native_ledger seam (inverse marks via a
# stubbed settlement index).
# ===========================================================================


def _old_formula_native_pnl(
    rows: list[dict[str, Any]],
) -> dict[str, dict[str, float]]:
    """The PRE-Phase-82 native formula written inline: Σ raw `change` per
    (UTC-day, ccy) over the native cash-bearing types (incl swap), skipping the
    external-flow informational types. A drift on ANY non-option row reddens the
    check below."""
    from services.deribit_txn import (
        _NATIVE_CASH_BEARING_TYPES,
        _NATIVE_INFORMATIONAL_TYPES,
        _row_utc_day,
    )

    acc: dict[tuple[str, str], float] = {}
    for r in rows:
        t = str(r.get("type", ""))
        if t in _NATIVE_INFORMATIONAL_TYPES:
            continue
        if t in _NATIVE_CASH_BEARING_TYPES:
            chg = float(r["change"])
            if chg == 0.0:
                continue
            day = _row_utc_day(r["timestamp"])
            ccy = str(r["currency"]).upper()
            acc[(day, ccy)] = acc.get((day, ccy), 0.0) + chg
    out: dict[str, dict[str, float]] = {}
    for (day, ccy), v in sorted(acc.items()):
        out.setdefault(ccy, {})[day] = v
    return out


def test_inverse_perp_only_ledger_byte_identical_real_adapter(
    monkeypatch: Any,
) -> None:
    """SC-4 (gate i, inverse tier): a BTC perp-only ledger — settlement +
    perp-trade fees + future delivery + negative_balance_fee + swap, ZERO option/
    summary rows — through the REAL adapter yields native_pnl BIT-EXACT to the OLD
    Σchange formula (check_exact). The replay is empty and no coverage window
    exists (classification-gated, not account-flagged).
    """
    from services.deribit_txn import (
        _summary_coverage_windows,
        replay_option_positions,
    )

    btc_rows = [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": 0.5, "index_price": 60000.0, "timestamp": _day_ms(0)},
        {"type": "trade", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": -0.0002, "commission": 0.0002, "timestamp": _day_ms(0)},
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "currency": "BTC",
         "change": 0.02, "index_price": 60000.0, "timestamp": _day_ms(1)},
        {"type": "delivery", "instrument_name": "BTC-27MAR26", "currency": "BTC",
         "change": 0.005, "timestamp": _day_ms(1)},
        {"type": "negative_balance_fee", "currency": "BTC",
         "change": -0.001, "timestamp": _day_ms(1)},
        {"type": "swap", "currency": "BTC", "change": -0.1, "timestamp": _day_ms(2)},
    ]
    currencies = ["BTC"]

    async def _enumerate_scopes(_ex: Any) -> list[Any]:
        return [di.Scope("main", None, True)]

    async def _resolve_scope_auth(_ex: Any, _scope: Any) -> dict[str, Any]:
        return {}

    async def _enumerate_currencies(_ex: Any, _scope: Any, _auth: Any) -> list[str]:
        return list(currencies)

    async def _paginate(
        _ex: Any, _scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[dict[str, Any]]:
        return list(btc_rows) if currency == "BTC" else []

    async def _index_probe(_ex: Any, _ccy: str, *, oldest_day: str, sleep: Any) -> Any:
        return {_iso(0): 60000.0, _iso(1): 60000.0, _iso(2): 60000.0}

    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", _paginate)
    monkeypatch.setattr(di, "fetch_deribit_settlement_index", _index_probe)

    class _BtcStub:
        async def private_get_get_account_summaries(self, params: Any) -> Any:
            # terminal = Σ pnl (full_history residual-clean, no flows/wedge).
            total = sum(
                v for days in _old_formula_native_pnl(btc_rows).values()
                for v in days.values()
            )
            return {"result": {"summaries": [
                {"currency": "BTC", "equity": total, "session_upl": 0.0},
            ]}}

        async def public_get_get_index_price(self, params: Any) -> Any:
            return {"result": {"index_price": 60000.0}}

    ledger, _report = asyncio.run(di.build_deribit_native_ledger(_BtcStub()))

    # BIT-EXACT vs the OLD Σchange formula (golden computed inline).
    golden = _old_formula_native_pnl(btc_rows)["BTC"]
    expected = pd.Series(
        {pd.Timestamp(d): v for d, v in golden.items()}, dtype=float
    ).sort_index()
    pd.testing.assert_series_equal(
        ledger.native_pnl["BTC"], expected, check_exact=True, check_names=False
    )
    # Classification-gating: no summary rows → no coverage window; no option rows
    # → empty replay (the option arms are never consulted on this inverse ledger).
    assert _summary_coverage_windows(btc_rows) == {}
    assert replay_option_positions(btc_rows) == {}
