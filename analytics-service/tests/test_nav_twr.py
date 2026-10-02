"""Revert-proof correctness tests for services.nav_twr (Phase 73 pure core).

Phase 73 builds the honest replacement for the silent anchor-to-today base
substitution that lives in ``transforms.trades_to_daily_returns_with_status``
(``estimated_start <= 0 -> account_balance`` at L154-159 and the forbidden
``prev_equity.replace(0, initial_capital)`` at L175). The new core:

  * reconstructs a per-day NAV series BACKWARD from the real exchange anchor
    (``NAV_{t-1} = NAV_t - pnl_t - F_t``) — pinned to an independent numpy
    oracle and revert-proof (a sign/term mutation turns the oracle test RED);
  * chain-links a true time-weighted daily return with the flow in the
    NUMERATOR (end-of-day convention) — cross-checked against a hand-derived
    closed-form sub-period chain (the end-of-day flow-numerator convention of
    the deleted forward TWR scalar, retired in Phase 114 E1 backbone absorption);
  * guards EVERY NAV denominator fail-loud (dust / negative / flow-dominated)
    — breaking the chain-link for that day and flagging
    ``complete_with_warnings`` rather than ever fabricating a number;
  * is byte-identical to today's honest daily_pnl return path on flow-less
    input (the SC-4 pin) so Phase 74 can wire callers safely.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from services import nav_twr as nav_twr_mod
from services.nav_twr import (
    BINANCE_DEPOSIT_TERMINUS_DAYS,
    BYBIT_DEPOSIT_TERMINUS_DAYS,
    FLOW_TERMINUS_DAYS_BY_VENUE,
    NAV_TWR_GUARD_KEYS,
    OKX_DEPOSIT_TERMINUS_DAYS,
    PNL_DOM_RATIO,
    FLOW_BOUNDARY_PROXIMITY_DAYS,
    NavReconstructionError,
    _flows_to_daily_usd,
    apply_flow_coverage_terminus,
    chain_linked_twr,
    cumulative_twr_segmented,
    flow_coverage_gap_evidence,
    flow_coverage_terminus_day,
    negative_nav_guard_pre_terminus,
    reconcile_flow_residual,
    reconstruct_nav,
    reconstruct_nav_and_twr,
)
from services.external_flows import ExternalFlow


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_NAV_TWR_SRC = Path(__file__).resolve().parents[1] / "services" / "nav_twr.py"


def _days(n: int, start: str = "2026-01-01") -> pd.DatetimeIndex:
    """A dense daily DatetimeIndex of length ``n`` starting at ``start``."""
    return pd.DatetimeIndex(pd.date_range(start=start, periods=n, freq="D"))


def _pnl(values: list[float], start: str = "2026-01-01") -> pd.Series:
    return pd.Series(values, index=_days(len(values), start), name="daily_pnl")


def _numpy_nav_oracle(
    daily_pnl: pd.Series, terminal_nav: float, flows_by_day: pd.Series
) -> np.ndarray:
    """Independent re-derivation of the backward NAV roll.

    ``NAV_t = terminal - Σ_{k>t}(pnl_k + F_k)`` expressed as a single
    vectorised cumulative-subtraction from the anchor — deliberately NOT the
    iterative form the implementation uses, so an implementation sign/term
    mutation cannot hide behind a shared bug.
    """
    flows = flows_by_day.reindex(daily_pnl.index, fill_value=0.0)
    combined = daily_pnl.to_numpy(dtype=float) + flows.to_numpy(dtype=float)
    return float(terminal_nav) - combined.sum() + np.cumsum(combined)


# ---------------------------------------------------------------------------
# TWR-01 — backward NAV reconstruction vs. numpy oracle (revert-proof)
# ---------------------------------------------------------------------------


def test_backward_nav_matches_numpy_oracle() -> None:
    """The iterative backward roll reproduces the independent numpy
    cumulative-subtraction oracle to floating-point precision."""
    daily_pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = _flows_to_daily_usd(
        [("2026-01-02", 500.0), ("2026-01-04", -200.0)]
    )
    terminal_nav = 10_000.0

    nav = reconstruct_nav(daily_pnl, terminal_nav, flows)
    oracle = _numpy_nav_oracle(daily_pnl, terminal_nav, flows)

    # Last index == the terminal anchor exactly.
    assert nav.iloc[-1] == pytest.approx(terminal_nav, rel=0, abs=1e-9)
    np.testing.assert_allclose(nav.to_numpy(dtype=float), oracle, rtol=1e-12)


def test_nav_roll_mutation_detected() -> None:
    """The oracle test is sensitive: a flipped roll sign (NAV_t + pnl_t) or a
    dropped flow term diverges from the oracle — proving a regression cannot
    slip past ``test_backward_nav_matches_numpy_oracle``."""
    daily_pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = _flows_to_daily_usd([("2026-01-02", 500.0), ("2026-01-04", -200.0)])
    terminal_nav = 10_000.0

    correct = reconstruct_nav(daily_pnl, terminal_nav, flows).to_numpy(dtype=float)
    oracle = _numpy_nav_oracle(daily_pnl, terminal_nav, flows)
    np.testing.assert_allclose(correct, oracle, rtol=1e-12)

    idx = daily_pnl.index
    flows_aligned = flows.reindex(idx, fill_value=0.0).to_numpy(dtype=float)
    pnl_vals = daily_pnl.to_numpy(dtype=float)
    n = len(idx)

    # Mutation A: flip the roll sign (NAV_{t-1} = NAV_t + pnl_t + F_t).
    mutant_sign = np.zeros(n)
    mutant_sign[n - 1] = terminal_nav
    for t in range(n - 1, 0, -1):
        mutant_sign[t - 1] = mutant_sign[t] + pnl_vals[t] + flows_aligned[t]
    assert not np.allclose(mutant_sign, oracle, rtol=1e-12)

    # Mutation B: drop the flow term (NAV_{t-1} = NAV_t - pnl_t).
    mutant_noflow = np.zeros(n)
    mutant_noflow[n - 1] = terminal_nav
    for t in range(n - 1, 0, -1):
        mutant_noflow[t - 1] = mutant_noflow[t] - pnl_vals[t]
    # Flows are non-zero, so dropping them must diverge.
    assert not np.allclose(mutant_noflow, oracle, rtol=1e-12)


def test_flows_to_daily_usd_sums_same_day_multi_flow() -> None:
    """Two flows on one UTC day collapse to a single summed row on the correct
    day; the day-key uses the SAME bucketing as pnl (shared helper)."""
    flows = _flows_to_daily_usd(
        [
            ("2026-01-02", 500.0),
            ("2026-01-02", -150.0),  # same UTC day -> sums to +350
            ("2026-01-05", 1000.0),
        ]
    )
    assert list(flows.index) == [pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-05")]
    assert flows.loc[pd.Timestamp("2026-01-02")] == pytest.approx(350.0)
    assert flows.loc[pd.Timestamp("2026-01-05")] == pytest.approx(1000.0)


def test_flows_to_daily_usd_empty() -> None:
    assert _flows_to_daily_usd([]).empty
    assert _flows_to_daily_usd(None).empty


def test_malformed_flow_usd_fails_loud() -> None:
    """A non-numeric flow amount raises ``NavReconstructionError`` (permanent,
    structural) — never a silent drop or a bare crash."""
    with pytest.raises(NavReconstructionError):
        _flows_to_daily_usd([("2026-01-02", "not-a-number")])


def test_four_field_flow_through_flows_to_daily_usd() -> None:
    """Phase 79-01 SC-2: a 4-field ``ExternalFlow`` (native channel populated)
    passes through ``_flows_to_daily_usd`` — its ``usd_signed`` still sums on its
    UTC day. RED today: ``day_raw, usd_raw = flow`` (nav_twr.py:201) unpacks a
    4-field NamedTuple → ``ValueError: too many values to unpack``."""
    flow = ExternalFlow("2026-01-02", -500.0, "BTC", -0.012)
    out = _flows_to_daily_usd([flow])
    assert list(out.index) == [pd.Timestamp("2026-01-02")]
    assert out.loc[pd.Timestamp("2026-01-02")] == pytest.approx(-500.0)


def test_flows_to_daily_usd_legacy_byte_identical() -> None:
    """Phase 79-01 SC-4: a mix of 2-field ``ExternalFlow`` and bare ``(day, usd)``
    tuples produces the EXACT Series it produces today — the indexed-access fix at
    :201 is byte-identical for every existing caller (check_exact)."""
    mixed = [
        ExternalFlow("2026-01-02", 500.0),   # 2-arg NamedTuple (defaults fill)
        ("2026-01-02", -150.0),              # bare 2-tuple (core docstring allows)
        ExternalFlow("2026-01-05", 1000.0),
    ]
    out = _flows_to_daily_usd(mixed)
    expected = pd.Series(
        [350.0, 1000.0],
        index=pd.DatetimeIndex([pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-05")]),
        name="flows",
    )
    pd.testing.assert_series_equal(out, expected, check_exact=True)


def test_flow_on_no_trade_day_unioned_as_zero_return() -> None:
    """HIGH-1: a flow dated on a day ABSENT from the pnl index (a no-trade day —
    an initial deposit before the first trade, or a terminal / quiet-day
    withdrawal, the LTP068 shape) is UNIONED into the NAV timeline as a zero-pnl
    day and is flow-neutral (r_t == 0). It is NEVER rejected as an orphan (the
    old permanent-FAILED behavior for the MAJORITY of real flow-bearing accounts)
    and NEVER silently dropped (the flow day appears in the returned index).

    Mutation-honest: reverting the ``_union_flow_days`` call in
    ``reconstruct_nav_and_twr`` re-orphans the flow day, ``_align_flows`` raises
    ``NavReconstructionError``, and this test goes RED. The low-level
    ``_align_flows`` raise is preserved as the defensive invariant that makes that
    revert loud (never a silent cash loss)."""
    # pnl on 2026-01-01..03; a sub-NAV withdrawal on 2026-01-05 — a day carrying
    # NO return-bearing row (absent from the pnl index).
    flow_day = pd.Timestamp("2026-01-05")
    ret, meta = reconstruct_nav_and_twr(
        _pnl([100.0, -50.0, 25.0]),  # 2026-01-01..03
        anchor_nav=100_000.0,
        external_flows=[("2026-01-05", -4100.0)],
    )
    # The no-trade flow day is now a valid NAV day (unioned in), and is
    # flow-neutral: pnl_t == 0 and F_t == flow -> r_t == 0.
    assert flow_day in ret.index
    assert ret.loc[flow_day] == pytest.approx(0.0, abs=1e-12)
    # A sub-NAV flow trips no guard: an honest 'complete', not a fabricated move.
    assert meta["computation_status_hint"] == "complete"
    assert "flow_dominated_guard" not in meta
    assert "negative_nav_guard" not in meta
    assert "dust_nav_guard" not in meta


def test_align_flows_orphan_invariant_still_fails_loud() -> None:
    """The ``_align_flows`` orphan raise is preserved as a DEFENSIVE INVARIANT:
    the public entry unions flow days up front so this never fires for a real
    flow, but a direct low-level call with an off-window flow must still fail loud
    rather than silently drop realized cash via ``reindex``. This is the mutation
    detector that makes a reverted HIGH-1 union RED instead of a silent drop."""
    daily_pnl = _pnl([10.0, 20.0, 30.0])  # 2026-01-01..03
    orphan = _flows_to_daily_usd([("2026-06-01", 100.0)])
    with pytest.raises(NavReconstructionError):
        reconstruct_nav(daily_pnl, 1000.0, orphan)


# ---------------------------------------------------------------------------
# TWR-02 — chain-linked r_t (flow in numerator) + cumulative + edge cases
# ---------------------------------------------------------------------------


def test_twr_edge_cases() -> None:
    """day-0 flow, same-day multi-flow, zero-NAV interior day, and a partial
    window each produce the correct chain-linked series."""

    # --- day-0 flow: the flow on the first day is subtracted from the
    # numerator (end-of-day convention); r_0 is formed on the pre-flow base,
    # never divided by a fabricated pre-history NAV. ---
    ret0, meta0 = reconstruct_nav_and_twr(
        _pnl([50.0, 30.0, 20.0]),
        anchor_nav=11_000.0,
        external_flows=[("2026-01-01", 1000.0)],
    )
    # NAV_{-1} = 10950 - 50 - 1000 = 9900; r_0 = (10950-9900-1000)/9900 = 50/9900
    assert ret0.iloc[0] == pytest.approx(50.0 / 9900.0)
    assert meta0["computation_status_hint"] == "complete"

    # --- same-day multi-flow: two flows on 2026-01-02 sum to +200 before
    # entering r_1 that day. ---
    ret1, _ = reconstruct_nav_and_twr(
        _pnl([10.0, 20.0, 30.0]),
        anchor_nav=10_000.0,
        external_flows=[("2026-01-02", 300.0), ("2026-01-02", -100.0)],
    )
    # nav = [9750, 9970, 10000]; r_1 = (9970-9750-200)/9750 = 20/9750
    assert ret1.iloc[1] == pytest.approx(20.0 / 9750.0)

    # --- zero-NAV interior day: NAV_{t-1}==0 breaks the chain-link (r omitted),
    # NEVER a division by zero or a fabricated value. ---
    ret2, meta2 = reconstruct_nav_and_twr(
        _pnl([0.0, -1000.0, 800.0]), anchor_nav=800.0
    )
    # nav = [1000, 0, 800]; r_1 = -1000/1000 = -1.0; r_2 breaks (prev NAV == 0)
    assert ret2.iloc[1] == pytest.approx(-1.0)
    assert np.isnan(ret2.iloc[2])
    assert meta2["computation_status_hint"] == "complete_with_warnings"

    # --- partial window (3 days): correct chain-linked cumulative. ---
    ret3, _ = reconstruct_nav_and_twr(
        _pnl([100.0, -50.0, 25.0]), anchor_nav=10_000.0
    )
    # nav = [10025, 9975, 10000]
    exp_cum = (
        (1.0 + 100.0 / 9925.0)
        * (1.0 - 50.0 / 10025.0)
        * (1.0 + 25.0 / 9975.0)
        - 1.0
    )
    assert cumulative_twr_segmented(ret3)[0] == pytest.approx(exp_cum, rel=1e-12)


def test_twr_agrees_with_hand_derived_chain() -> None:
    """On a shared synthetic fixture the nav_twr per-day chain-linked cumulative
    agrees with a hand-derived closed-form sub-period chain (the same end-of-day
    flow-numerator convention as the retired portfolio_metrics TWR scalar,
    deleted in Phase 114 E1 backbone absorption) to fp tolerance."""
    # Equity (end-of-day) [1000, 1100, 1050, 1200] with a +100 deposit on
    # 2026-01-03. Day 0 has zero pnl/flow so nav_twr's day-0 return is 0 and both
    # methods start from the same base.
    daily_pnl = _pnl([0.0, 100.0, -150.0, 150.0])  # 2026-01-01..04
    returns, meta = reconstruct_nav_and_twr(
        daily_pnl,
        anchor_nav=1200.0,
        external_flows=[("2026-01-03", 100.0)],
    )
    nav_twr_cum = cumulative_twr_segmented(returns)[0]

    # Hand-derived closed-form chain from the fixture numbers, in the same style
    # as the exp_cum expression above. End-of-day flow-numerator convention: the
    # +100 deposit landing on 2026-01-03 is SUBTRACTED from that day's end value
    # before the sub-period ratio is formed. This literal chain is the
    # independent comparator that replaces the deleted forward TWR scalar.
    eq = [1000.0, 1100.0, 1050.0, 1200.0]
    deposit = 100.0
    hand_derived = (
        (eq[1] / eq[0])
        * ((eq[2] - deposit) / eq[1])
        * (eq[3] / eq[2])
        - 1.0
    )

    assert nav_twr_cum == pytest.approx(hand_derived, rel=1e-12)
    assert meta["computation_status_hint"] == "complete"


def test_chain_linked_twr_returns_named_series_and_flags() -> None:
    """chain_linked_twr returns a ``returns``-named Series on a DatetimeIndex and
    a flags dict; a clean flow-less series produces no flags."""
    daily_pnl = _pnl([100.0, 50.0, -25.0])
    flows = _flows_to_daily_usd([])
    nav = reconstruct_nav(daily_pnl, 10_000.0, flows)
    returns, flags = chain_linked_twr(nav, daily_pnl, flows)
    assert returns.name == "returns"
    assert isinstance(returns.index, pd.DatetimeIndex)
    assert flags == {}


# ---------------------------------------------------------------------------
# §1.4 — chain_linked_twr additive ``prev0`` kwarg (native-core day-0 injection)
# ---------------------------------------------------------------------------


def test_prev0_default_byte_identical() -> None:
    """``prev0=None`` (and ``prev0`` absent) is byte-identical to today over
    clean, flow-bearing, and interior-guard-firing fixtures — the §1.4 SC-4
    default-preservation pin (App A #2). Mutation: reverting the default day-0
    path or deriving ``prev`` differently when ``prev0=None`` flips this red."""
    fixtures = [
        ([100.0, 50.0, -25.0], 10_000.0, []),                 # clean
        ([50.0, 30.0, 20.0], 11_000.0, [("2026-01-01", 1000.0)]),  # flow-bearing
        ([0.0, -1000.0, 800.0], 800.0, []),                   # interior zero-NAV
    ]
    for values, terminal, flows in fixtures:
        daily_pnl = _pnl(values)
        fbd = _flows_to_daily_usd(flows)
        nav = reconstruct_nav(daily_pnl, terminal, fbd)
        base_ret, base_flags = chain_linked_twr(nav, daily_pnl, fbd)
        none_ret, none_flags = chain_linked_twr(nav, daily_pnl, fbd, prev0=None)
        pd.testing.assert_series_equal(base_ret, none_ret, check_exact=True)
        assert base_flags == none_flags == chain_linked_twr(nav, daily_pnl, fbd)[1]

    # Self-sufficient golden on the clean fixture: day-0 prev is the reconstructed
    # pre-history capital NAV_0 − pnl_0 − F_0, NOT a dropped-pnl0 shortcut. nav =
    # [9975, 10025, 10000]; prev_0 = 9975 − 100 = 9875. A neuter deriving day-0
    # prev differently when prev0=None (e.g. dropping pnl0) reddens THIS test, not
    # only the sibling corpus.
    clean = _pnl([100.0, 50.0, -25.0])
    clean_fbd = _flows_to_daily_usd([])
    clean_nav = reconstruct_nav(clean, 10_000.0, clean_fbd)
    clean_ret, _ = chain_linked_twr(clean_nav, clean, clean_fbd)
    assert clean_ret.iloc[0] == pytest.approx(100.0 / 9875.0)
    assert clean_ret.iloc[1] == pytest.approx(50.0 / 9975.0)
    assert clean_ret.iloc[2] == pytest.approx(-25.0 / 10025.0)


def test_prev0_supplied_overrides_day0_prev() -> None:
    """With ``prev0=X`` set, day-0 return is ``(nav0 − X − flow0)/X`` and
    ``daily_pnl.iloc[0]`` does NOT enter the day-0 denominator (§1.3/§1.4).
    Fixture where the pnl-derived prev and the supplied ``prev0`` DISAGREE, so the
    prev0 arithmetic must win. Mutation: ignoring ``prev0`` when supplied flips
    this red."""
    daily_pnl = _pnl([100.0, 50.0, -25.0])
    fbd = _flows_to_daily_usd([])
    nav = reconstruct_nav(daily_pnl, 10_000.0, fbd)
    nav0 = float(nav.iloc[0])
    prev0 = 8_000.0  # deliberately != nav0 - pnl0 - flow0 (== nav0 - 100.0)
    assert prev0 != nav0 - 100.0
    returns, flags = chain_linked_twr(nav, daily_pnl, fbd, prev0=prev0)
    assert returns.iloc[0] == pytest.approx((nav0 - prev0 - 0.0) / prev0)
    # t>0 is unaffected — still uses the reconstructed NAV_{t-1}.
    assert returns.iloc[1] == pytest.approx(
        (float(nav.iloc[1]) - nav0 - 0.0) / nav0
    )
    assert flags == {}


def test_prev0_guarded_dust_and_negative() -> None:
    """``_guard_denominator`` applies to the supplied ``prev0`` UNCHANGED (§1.4):
    a dust ``prev0`` fires ``dust_nav_guard`` on day 0; a negative ``prev0`` fires
    ``negative_nav_guard`` — the guarded day is NaN, never a fabricated number.
    Mutation: bypassing ``_guard_denominator`` for a supplied ``prev0`` flips this
    red."""
    daily_pnl = _pnl([100.0, 50.0, -25.0])
    fbd = _flows_to_daily_usd([])
    nav = reconstruct_nav(daily_pnl, 10_000.0, fbd)

    dust_ret, dust_flags = chain_linked_twr(nav, daily_pnl, fbd, prev0=500.0)
    assert np.isnan(dust_ret.iloc[0])
    assert dust_flags.get("dust_nav_guard") is True

    neg_ret, neg_flags = chain_linked_twr(nav, daily_pnl, fbd, prev0=-100.0)
    assert np.isnan(neg_ret.iloc[0])
    assert neg_flags.get("negative_nav_guard") is True


# ---------------------------------------------------------------------------
# DQ-01 — fail-loud NAV-denominator guards (flag, never substitute) + SC-4 pin
# ---------------------------------------------------------------------------


def test_dq_guards_flag_not_substitute() -> None:
    """Each of the three NAV-denominator guards breaks the chain-link for that
    day (r_t = NaN) and raises ``complete_with_warnings`` — NEVER a fabricated
    number. The ``estimated_start <= 0`` account FLAGS rather than silently
    substituting today's balance (the intended divergence from transforms.py)."""

    # --- dust guard: an interior NAV_{t-1} in (0, DUST_NAV_FLOOR) breaks. ---
    ret_dust, meta_dust = reconstruct_nav_and_twr(
        _pnl([0.0, -4500.0, 300.0]), anchor_nav=800.0
    )
    # nav = [5000, 500, 800]; day-2 prev NAV = 500 < 1000 -> dust
    assert np.isnan(ret_dust.iloc[2])
    assert meta_dust.get("dust_nav_guard") is True
    assert meta_dust["computation_status_hint"] == "complete_with_warnings"

    # --- flow-dominated guard: |F_t| >= FLOW_DOM_RATIO * NAV_{t-1} breaks even
    # when the base NAV is healthy (> dust). ---
    ret_fd, meta_fd = reconstruct_nav_and_twr(
        _pnl([0.0, 50.0, 30.0]),
        anchor_nav=4580.0,
        external_flows=[("2026-01-02", 2500.0)],
    )
    # nav = [2000, 4550, 4580]; day-1 prev NAV = 2000, |flow|=2500 >= 2000 -> dom
    assert np.isnan(ret_fd.iloc[1])
    assert meta_fd.get("flow_dominated_guard") is True
    assert meta_fd["computation_status_hint"] == "complete_with_warnings"

    # --- negative reconstructed NAV (the estimated_start <= 0 bug case): the
    # new core FLAGS instead of substituting account_balance. Anchor/balance =
    # 1500 (> the $1000 dust floor so transforms takes the substitution branch,
    # not the heuristic branch); pnl = 2000 => estimated_start = -500. ---
    daily_pnl = _pnl([2000.0])
    ret_neg, meta_neg = reconstruct_nav_and_twr(daily_pnl, anchor_nav=1500.0)
    # NAV_{-1} = 1500 - 2000 = -500 <= 0 -> negative guard, r_0 = NaN
    assert np.isnan(ret_neg.iloc[0])
    assert meta_neg.get("negative_nav_guard") is True
    assert meta_neg["computation_status_hint"] == "complete_with_warnings"

    # Prove the CONVERGENCE: Phase 74 (74-02) wired
    # transforms.trades_to_daily_returns_with_status THROUGH this core, so the
    # old silent balance substitution is GONE. Pre-wiring transforms fabricated
    # r_0 = 2000/1500 = +133% for this SAME estimated_start<=0 input; post-wiring
    # it delegates and AGREES with the core (NaN + negative_nav_guard). This
    # asserts the honesty the wiring delivered — reverting the delegation
    # re-fabricates the magnitude and fails here.
    from services.transforms import trades_to_daily_returns_with_status

    trades = [
        {
            "timestamp": "2026-01-01T00:00:00+00:00",
            "order_type": "daily_pnl",
            "side": "buy",
            "price": 2000.0,
        }
    ]
    wired_returns, wired_meta = trades_to_daily_returns_with_status(
        trades, account_balance=1500.0
    )
    # transforms now delegates -> same honest NaN as the core, not 2000/1500.
    assert np.isnan(wired_returns.iloc[0])
    assert wired_meta.get("negative_nav_guard") is True
    assert wired_meta["computation_status_hint"] == "complete_with_warnings"
    assert np.isnan(ret_neg.iloc[0])  # core and transforms now agree


def test_pnl_dominated_guard_breaks_and_flags_interior_day() -> None:
    """Phase 92 HARD-01: an interior day whose P&L numerator dwarfs a
    small-but-ABOVE-dust prior NAV (``|pnl_t| >= PNL_DOM_RATIO * NAV_{t-1}``,
    r ~ 20) breaks the chain (NaN) + flags ``pnl_dominated_guard`` — the missing
    sibling of ``flow_dominated_guard`` — NEVER emits the ~20x/day return.
    Reverting the call-site guard re-emits r = 20 and reddens the ``isnan``
    assert (mutation-honest)."""
    # nav backward roll = [2000, 42000, 42050]; day-1 prev NAV = 2000 (> dust),
    # pnl_1 = 40000 => |pnl_1| = 20 * prev >= 10 * prev -> P&L-dominated -> guarded.
    ret, meta = reconstruct_nav_and_twr(
        _pnl([100.0, 40000.0, 50.0]), anchor_nav=42050.0
    )
    assert np.isnan(ret.iloc[1])                 # the P&L-dominated day broke
    assert not bool(ret.isna().iloc[0])          # day 0 (prev 1900) is fine
    assert not bool(ret.isna().iloc[2])          # day 2 (prev 42000) is fine
    assert meta.get("pnl_dominated_guard") is True
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_pnl_dominated_guard_boundary_is_inclusive() -> None:
    """The ``>=`` boundary (mirroring FLOW_DOM_RATIO): a day at EXACTLY
    ``PNL_DOM_RATIO * prev`` is guarded. Flipping ``>=`` to ``>`` lets the
    boundary day emit r = PNL_DOM_RATIO and reddens this (mutation-honest,
    Rule 9)."""
    # nav = [2000, 22000, 22050]; pnl_1 = 20000 = PNL_DOM_RATIO * 2000 -> exactly
    # at the cap. prev(day1) = 2000 (> dust).
    ret, meta = reconstruct_nav_and_twr(
        _pnl([100.0, PNL_DOM_RATIO * 2000.0, 50.0]), anchor_nav=22050.0
    )
    assert np.isnan(ret.iloc[1])
    assert meta.get("pnl_dominated_guard") is True
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_below_cap_pnl_day_passes_through_unguarded() -> None:
    """Byte-identity partner: a day at 5x prior NAV (BELOW the 10x cap) passes
    through with the EXACT unguarded return and NO flag — the no-op default that
    keeps every normal account (and the SC-4 pins) byte-identical. Tightening the
    cap below 5 would guard this day and redden the exact-r assert."""
    # nav = [2000, 12000, 12050]; pnl_1 = 10000 = 5 * 2000 -> below the 10x cap.
    ret, meta = reconstruct_nav_and_twr(
        _pnl([100.0, 10000.0, 50.0]), anchor_nav=12050.0
    )
    assert ret.iloc[1] == pytest.approx(10000.0 / 2000.0)  # exact unguarded r = 5.0
    assert "pnl_dominated_guard" not in meta
    assert meta["computation_status_hint"] == "complete"


def test_pnl_dominated_guard_rides_registry() -> None:
    """By-construction propagation: ``pnl_dominated_guard`` is in
    ``NAV_TWR_GUARD_KEYS`` and satisfies the subset pin, so it lifts/promotes
    through every downstream registry (transforms._merge_status_meta, the
    analytics_runner lift, the job_worker pre-stamp) with NO consumer-file edit.
    Removing the registry append flips this RED."""
    assert "pnl_dominated_guard" in NAV_TWR_GUARD_KEYS
    assert set(NAV_TWR_GUARD_KEYS) <= set(nav_twr_mod.NavTWRMeta.__annotations__)


def test_nonfinite_inputs_fail_loud() -> None:
    """HIGH-1 regression: a NaN/Inf anchor, pnl, flow amount, or uPnL must raise
    ``NavReconstructionError`` — it must NEVER sail past the DQ denominator
    guards (every ``nan <op>`` comparison is False, so no guard fires) and emit a
    silent NaN return series stamped ``complete``. Reverting the ``np.isfinite``
    check in ``_coerce_float`` turns each case below RED (the call would return a
    ``complete`` all-/partly-NaN series instead of raising)."""
    good_pnl = _pnl([100.0, 50.0])

    # NaN anchor -> was returns=[nan, nan] with hint='complete' before the fix.
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(good_pnl, anchor_nav=float("nan"))
    # +Inf anchor -> reject (inf-inf arithmetic downstream would yield NaN).
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(good_pnl, anchor_nav=float("inf"))
    # NaN interior pnl -> was silently corrupting two days' returns, still complete.
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(
            _pnl([100.0, float("nan"), 50.0]), anchor_nav=10_000.0
        )
    # NaN external-flow amount.
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(
            good_pnl,
            anchor_nav=10_000.0,
            external_flows=[("2026-01-02", float("nan"))],
        )
    # NaN open_unrealized_usd (folded into terminal_nav).
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(
            good_pnl, anchor_nav=10_000.0, open_unrealized_usd=float("nan")
        )


def test_exactly_zero_prev_nav_flags_negative_guard() -> None:
    """MEDIUM-2 regression: an exactly-0 reconstructed ``NAV_{t-1}`` must flag
    ``negative_nav_guard`` (the ``prev_nav <= 0`` boundary), NOT
    ``dust_nav_guard``. Phase 74 consumers read ``negative_nav_guard`` as the
    honest ``estimated_start <= 0`` divergence signal; mutating the guard to
    ``prev_nav < 0`` lets exactly-0 fall through to the dust guard and mislabels
    the day — this assertion turns that mutation RED (the guard would otherwise
    stay green because 0 is still caught by one guard or the other)."""
    # nav = [1000, 0, 800]; day-2 prev NAV == 0 exactly.
    ret, meta = reconstruct_nav_and_twr(
        _pnl([0.0, -1000.0, 800.0]), anchor_nav=800.0
    )
    assert np.isnan(ret.iloc[2])
    assert meta.get("negative_nav_guard") is True
    assert meta.get("dust_nav_guard") is None  # exactly-0 is negative, not dust
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_no_forbidden_denominator_guards() -> None:
    """Static source-scan: nav_twr.py contains NO clamp/floor/replace(0,...)/clip
    on a NAV denominator — the forbidden silent-substitution class DQ-01 bans."""
    src = _NAV_TWR_SRC.read_text()
    forbidden = [
        r"\.replace\(0",
        r"\.clip\(",
        r"np\.clip\(",
        r"max\([^)]*floor",
        r"np\.maximum\(",
        r"\.fillna\([1-9]",
    ]
    offenders: list[str] = []
    for line in src.splitlines():
        if line.strip().startswith("#"):
            continue  # prose describing the anti-pattern is allowed
        for pat in forbidden:
            if re.search(pat, line):
                offenders.append(f"{pat!r} -> {line.strip()!r}")
    assert offenders == [], f"forbidden denominator substitution(s): {offenders}"


def test_zero_flow_byte_identical() -> None:
    """SC-4: with external_flows=[] and open_unrealized_usd=0.0, for an account
    with account_balance - Σpnl > $1000 (estimated_start > 0), the returns Series
    is byte-identical to today's transforms.py daily_pnl branch."""
    from services.transforms import trades_to_daily_returns_with_status

    pnls = [500.0, -300.0, 800.0, -100.0, 400.0]  # Σ = 1300, base 100k => est_start>0
    account_balance = 100_000.0

    trades = []
    for i, p in enumerate(pnls):
        day = f"2026-01-0{i + 1}"
        trades.append(
            {
                "timestamp": f"{day}T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "buy" if p >= 0 else "sell",
                "price": abs(p),
            }
        )
    old_returns, old_meta = trades_to_daily_returns_with_status(
        trades, account_balance=account_balance
    )

    new_returns, new_meta = reconstruct_nav_and_twr(
        _pnl(pnls),
        anchor_nav=account_balance,
        external_flows=[],
        open_unrealized_usd=0.0,
    )

    pd.testing.assert_series_equal(
        new_returns,
        old_returns,
        check_exact=False,
        rtol=1e-12,
        check_freq=False,
        check_names=False,  # index-name convention ("date" vs input) is cosmetic
    )
    # The honest path with a real balance and no guards fires: complete.
    assert new_meta["computation_status_hint"] == "complete"
    assert old_meta["computation_status_hint"] == "complete"


def test_empty_inputs_degenerate_cleanly() -> None:
    """Empty pnl produces empty Series (no crash); an all-broken series yields a
    NaN cumulative rather than a fabricated 0.0."""
    empty = pd.Series(dtype=float, name="daily_pnl")
    assert reconstruct_nav(empty, 1000.0, _flows_to_daily_usd([])).empty
    ret, meta = reconstruct_nav_and_twr(empty, anchor_nav=1000.0)
    assert ret.empty
    assert meta["computation_status_hint"] == "complete"
    # A single-day series whose only day breaks -> cumulative is NaN, not 0.0.
    ret_neg, _ = reconstruct_nav_and_twr(_pnl([2000.0]), anchor_nav=1500.0)
    assert np.isnan(cumulative_twr_segmented(ret_neg)[0])


# ---------------------------------------------------------------------------
# DQ-03 — cumulative_twr_segmented (§6): no silent chain-bridging
# ---------------------------------------------------------------------------


def test_cumulative_segmented_clean_path_bit_identical() -> None:
    """SC-4 clean path: a no-NaN returns series compounds to the EXACT old
    ``Π(1+r)−1`` product with NO flag — byte-identical to the deleted
    ``cumulative_twr`` on clean input."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(4, "2026-01-01")
    returns = pd.Series([0.01, -0.02, 0.03, 0.015], index=idx, name="returns")
    value, flags = cumulative_twr_segmented(returns)
    # Bit-identical to the old expression (float ops in the same order).
    assert value == float((1.0 + returns).prod() - 1.0)
    assert flags == {}


def test_cumulative_segmented_interior_break_suffix_only() -> None:
    """§6.3 verbatim: an INTERIOR guard-NaN flanked by valid returns on BOTH
    sides compounds ONLY the maximal contiguous suffix after the LAST break and
    raises ``twr_chain_broken`` — the suffix product is provably DIFFERENT from
    the dropna-bridged product, so a regression to bridging fails on the NUMBER,
    not just the flag."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(5, "2026-01-01")
    # Interior NaN at index 2 (01-03), valid on both sides.
    returns = pd.Series(
        [0.10, 0.05, float("nan"), 0.20, -0.10], index=idx, name="returns"
    )
    value, flags = cumulative_twr_segmented(returns)
    suffix_product = float((1.20 * 0.90) - 1.0)  # only 01-04, 01-05
    bridged_product = float((1.10 * 1.05 * 1.20 * 0.90) - 1.0)  # the old bridge
    assert flags == {"twr_chain_broken": True}
    assert value == pytest.approx(suffix_product, rel=1e-12)
    # Mutation-honesty: bridging (a re-added dropna) would yield bridged_product.
    assert suffix_product != pytest.approx(bridged_product)


def test_cumulative_segmented_leading_nan_only_no_flag() -> None:
    """Leading-NaN-only (a DQ-02 terminus / day-0 guard shape) compounds the
    post-NaN suffix with NO new flag — the terminus/DQ-01 machinery already
    flagged the cause, so no double-flag."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(4, "2026-01-01")
    returns = pd.Series(
        [float("nan"), float("nan"), 0.03, 0.02], index=idx, name="returns"
    )
    value, flags = cumulative_twr_segmented(returns)
    assert value == pytest.approx((1.03 * 1.02) - 1.0, rel=1e-12)
    assert flags == {}


def test_cumulative_segmented_multiple_interior_breaks() -> None:
    """Multiple interior breaks: only the maximal contiguous suffix AFTER the
    LAST break is compounded (the anchored, trustworthy segment), single flag.
    Compounding the PREFIX instead of the suffix flips this RED."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(6, "2026-01-01")
    # Interior NaNs at index 1 and 3.
    returns = pd.Series(
        [0.50, float("nan"), 0.10, float("nan"), 0.02, 0.03],
        index=idx,
        name="returns",
    )
    value, flags = cumulative_twr_segmented(returns)
    assert flags == {"twr_chain_broken": True}
    # Suffix after the LAST break (index 3) is [0.02, 0.03].
    assert value == pytest.approx((1.02 * 1.03) - 1.0, rel=1e-12)
    # Prefix-compounding would differ materially — mutation-honest.
    assert value != pytest.approx((1.50 * 1.10 * 1.02 * 1.03) - 1.0)


def test_cumulative_segmented_all_nan_terminal_is_nan() -> None:
    """All-broken series → (NaN, {}): the same terminal case as the deleted
    function; NEVER a fabricated 0.0, and no flag when nothing survived."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(3, "2026-01-01")
    returns = pd.Series([float("nan")] * 3, index=idx, name="returns")
    value, flags = cumulative_twr_segmented(returns)
    assert np.isnan(value)
    assert flags == {}


def test_cumulative_segmented_trailing_nan_no_flag() -> None:
    """Trailing-NaN-only (no valid day AFTER the NaN) is not an interior break:
    compound the leading valid run, NO flag."""
    from services.nav_twr import cumulative_twr_segmented

    idx = _days(4, "2026-01-01")
    returns = pd.Series(
        [0.01, 0.02, 0.03, float("nan")], index=idx, name="returns"
    )
    value, flags = cumulative_twr_segmented(returns)
    assert value == pytest.approx((1.01 * 1.02 * 1.03) - 1.0, rel=1e-12)
    assert flags == {}


def test_cumulative_twr_deleted_no_two_semantics() -> None:
    """§6.2 / App A #4: the old bridging ``cumulative_twr`` is DELETED in the
    same change — two coexisting cumulative semantics is the 'surface conflicts,
    don't average them' violation."""
    with pytest.raises(ImportError):
        from services.nav_twr import cumulative_twr  # noqa: F401


def test_twr_chain_broken_rides_registry() -> None:
    """§6.2 by-construction: ``twr_chain_broken`` is in ``NAV_TWR_GUARD_KEYS``
    and the existing subset pin still holds, so it propagates through every
    downstream registry (transforms._merge_status_meta, the analytics_runner
    lift, the job_worker pre-stamp) with NO consumer-file edits. Removing the
    registry append flips this RED."""
    assert "twr_chain_broken" in NAV_TWR_GUARD_KEYS
    assert set(NAV_TWR_GUARD_KEYS) <= set(nav_twr_mod.NavTWRMeta.__annotations__)


def test_core_sets_twr_chain_broken_on_interior_negative_nav() -> None:
    """A mid-history negative reconstructed NAV (guard-NaN flanked by valid days
    on BOTH sides) surfaces ``twr_chain_broken: True`` AND rides
    ``complete_with_warnings`` — the hint was ALREADY warnings via
    ``negative_nav_guard``, so the key is additive and the status class does not
    change. The SAME cumulative_twr_segmented decides brokenness (one detector)."""
    # nav backward roll = [100000, 0, 80000, 90000, 95000]; day-2 prev NAV == 0.
    ret, meta = reconstruct_nav_and_twr(
        _pnl([0.0, -100000.0, 80000.0, 10000.0, 5000.0]), anchor_nav=95000.0
    )
    assert bool(ret.isna().iloc[2])          # the interior guarded day
    assert not bool(ret.isna().iloc[1])      # valid return before the break
    assert not bool(ret.isna().iloc[4])      # valid return after the break
    assert meta.get("negative_nav_guard") is True
    assert meta.get("twr_chain_broken") is True
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_clean_fixture_has_no_twr_chain_broken() -> None:
    """SC-4 clean path: a no-guard fixture's meta is byte/status-identical to
    today — NO ``twr_chain_broken`` key, status ``complete``."""
    _ret, meta = reconstruct_nav_and_twr(
        _pnl([100.0, -50.0, 25.0]), anchor_nav=10_000.0
    )
    assert "twr_chain_broken" not in meta
    assert meta["computation_status_hint"] == "complete"


def test_leading_day0_guard_has_no_twr_chain_broken() -> None:
    """A day-0-guard-only fixture (leading NaN, no interior break) flags the
    day-0 guard exactly as today but carries NO ``twr_chain_broken`` key —
    leading NaN is not an interior break. A leading-NaN fixture gaining the flag
    flips this RED (clean_and_leading_unchanged)."""
    ret, meta = reconstruct_nav_and_twr(
        _pnl([60000.0, 100.0, 50.0, 25.0]), anchor_nav=50175.0
    )
    assert bool(ret.isna().iloc[0])              # day-0 guard (leading NaN)
    assert not bool(ret.isna().iloc[1:].any())   # every later day valid
    assert meta.get("negative_nav_guard") is True
    assert "twr_chain_broken" not in meta
    assert meta["computation_status_hint"] == "complete_with_warnings"


# ---------------------------------------------------------------------------
# DQ-02 — identity residual (construction-sanity mutation detector)
# ---------------------------------------------------------------------------


def _reconstructed_start(
    daily_pnl: pd.Series, terminal_nav: float, flows_by_day: pd.Series
) -> float:
    """Pre-history reconstructable capital = the day-0 chain-link denominator
    (``NAV_0 - pnl_0 - F_0``) derived from the ACTUAL backward roll — the same
    value ``chain_linked_twr`` uses as ``prev`` for ``t == 0``."""
    nav = reconstruct_nav(daily_pnl, terminal_nav, flows_by_day)
    flows0 = flows_by_day.reindex(nav.index, fill_value=0.0).iloc[0]
    return float(nav.iloc[0] - daily_pnl.iloc[0] - flows0)


def test_reconcile_residual_holds_by_construction() -> None:
    """The identity ``terminal − reconstructed_start − Σpnl − Σflows`` is ~0 by
    construction of the backward roll → ``reconcile_flow_residual`` returns a
    residual within tolerance (never raises) for a well-formed reconstruction."""
    daily_pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = _flows_to_daily_usd([("2026-01-02", 500.0), ("2026-01-04", -200.0)])
    terminal_nav = 10_000.0
    start = _reconstructed_start(daily_pnl, terminal_nav, flows)

    residual = reconcile_flow_residual(terminal_nav, start, daily_pnl, flows)
    assert abs(residual) <= max(1.00, 1e-6 * abs(terminal_nav))
    assert residual == pytest.approx(0.0, abs=1e-6)


def test_reconcile_residual_reddens_on_dropped_flow() -> None:
    """MUTATION (T-76-03-DROP): a flow dropped/mis-valued in the backward roll
    breaks the identity. Here the roll drops the ``- flows[t]`` term, so the
    reconstructed_start no longer matches ``terminal − Σpnl − Σflows`` and
    ``reconcile_flow_residual`` raises ``NavReconstructionError``. This is the
    mutation detector that reddens if the roll ever leaks a flow."""
    daily_pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = _flows_to_daily_usd([("2026-01-02", 500.0), ("2026-01-04", -200.0)])
    terminal_nav = 10_000.0

    # Mutant roll: drop the flow term (NAV_{t-1} = NAV_t - pnl_t only), exactly the
    # bug reconcile must catch. Derive a mutant reconstructed_start from it.
    index = daily_pnl.index
    pnl_vals = daily_pnl.to_numpy(dtype=float)
    flows0 = flows.reindex(index, fill_value=0.0).iloc[0]
    n = len(index)
    mutant = np.empty(n)
    mutant[n - 1] = terminal_nav
    for t in range(n - 1, 0, -1):
        mutant[t - 1] = mutant[t] - pnl_vals[t]  # flow term dropped
    mutant_start = float(mutant[0] - pnl_vals[0] - flows0)

    with pytest.raises(NavReconstructionError):
        reconcile_flow_residual(terminal_nav, mutant_start, daily_pnl, flows)


def test_reconcile_residual_wired_into_reconstruct(monkeypatch) -> None:
    """Revert-proof wiring: ``reconstruct_nav_and_twr`` runs the residual
    self-check internally. Monkeypatching ``reconstruct_nav`` to a flow-dropping
    roll makes the internal ``reconcile_flow_residual`` call raise — so REMOVING
    the internal call from ``reconstruct_nav_and_twr`` turns this test RED."""
    real_reconstruct = nav_twr_mod.reconstruct_nav

    def _flow_dropping_roll(
        daily_pnl: pd.Series, terminal_nav: float, flows_by_day: pd.Series
    ) -> pd.Series:
        nav = real_reconstruct(daily_pnl, terminal_nav, flows_by_day)
        # Corrupt the early NAV as a dropped-flow roll would, WITHOUT touching the
        # terminal anchor — this is exactly the residual's target mutation.
        vals = nav.to_numpy(dtype=float).copy()
        if len(vals) > 1:
            vals[:-1] += 1234.0
        return pd.Series(vals, index=nav.index, name="nav")

    monkeypatch.setattr(nav_twr_mod, "reconstruct_nav", _flow_dropping_roll)
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(
            _pnl([120.0, -80.0, 40.0, 15.0, -30.0]),
            anchor_nav=10_000.0,
            external_flows=[("2026-01-02", 500.0), ("2026-01-04", -200.0)],
        )


def test_reconcile_does_not_detect_wrong_scope_anchor() -> None:
    """HIGH-1 (honesty): the residual is a CONSTRUCTION tautology, NOT a
    wrong-scope guard. In production ``reconstruct_nav_and_twr`` derives
    ``reconstructed_start`` from day-0 of the SAME rolled ``nav`` built off the
    (possibly wrong) anchor — so a mis-scoped anchor (Binance SPOT vs USDⓈ-M,
    Bybit UNIFIED-only vs FUND+UNIFIED) shifts ``terminal`` and
    ``reconstructed_start`` by the SAME amount and the residual stays ~0. This
    test PROVES the wrong-scope anchor SAILS THROUGH the self-check (it does NOT
    raise) so the codebase never again claims the residual is an interim
    wrong-scope net. Wrong scope is caught ONLY at the Phase 78 golden-parity
    panel + founder confirmation."""
    daily_pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = _flows_to_daily_usd([("2026-01-02", 500.0), ("2026-01-04", -200.0)])

    # A wrong-scope anchor 20% below the true capital pool. Crucially, the
    # reconstructed_start is derived FROM this same wrong anchor's rolled nav —
    # exactly as the production path does — NOT from the true anchor.
    wrong_terminal = 100_000.0 * 0.80
    wrong_start = _reconstructed_start(daily_pnl, wrong_terminal, flows)

    # No raise: the identity closes by construction for the wrong anchor too. The
    # factsheet would ship `complete` with silently re-scaled returns — which is
    # precisely why the Phase 78 parity panel, not this residual, is the net.
    residual = reconcile_flow_residual(
        wrong_terminal, wrong_start, daily_pnl, flows
    )
    assert residual == pytest.approx(0.0, abs=1e-6)


def test_reconcile_tolerance_is_relative_for_large_navs() -> None:
    """The tolerance ``max($1, 1e-6·|terminal|)`` scales with account size: a
    sub-dollar float-noise residual passes at any scale, but a residual just over
    the relative band on a large NAV still reddens (no silent absolute blindness)."""
    daily_pnl = _pnl([10.0, 20.0])
    flows = _flows_to_daily_usd([])
    terminal = 5_000_000.0  # 1e-6 * 5e6 = $5 relative tolerance
    start = _reconstructed_start(daily_pnl, terminal, flows)

    # A 50-cent perturbation is float noise → within the $5 relative band.
    assert reconcile_flow_residual(terminal, start + 0.50, daily_pnl, flows) == pytest.approx(
        -0.50, abs=1e-6
    )
    # A $50 perturbation exceeds the $5 relative band → raises.
    with pytest.raises(NavReconstructionError):
        reconcile_flow_residual(terminal, start + 50.0, daily_pnl, flows)


# ---------------------------------------------------------------------------
# DQ-02 — terminus segmentation (retention coverage gap) + transient-vs-terminal
# ---------------------------------------------------------------------------


def test_terminus_segmentation_nans_pre_terminus_and_flags() -> None:
    """T-76-03-GAP: a flow-coverage terminus (a deposit older than a venue's
    deposit-history retention is unfetchable) segments the series at the last
    trustworthy day: pre-terminus returns become NaN (pre-terminus TWR REFUSED,
    never fabricated) and ``flow_coverage_incomplete`` is flagged. The missing old
    deposit is NEVER attributed to performance."""
    idx = _days(6, start="2026-01-01")
    returns = pd.Series(
        [0.01, -0.02, 0.03, 0.01, -0.01, 0.02], index=idx, name="returns"
    )
    terminus = pd.Timestamp("2026-01-04")  # days 01-03 are pre-terminus / untrusted

    segmented, flags = apply_flow_coverage_terminus(returns, terminus)

    # Pre-terminus days refused (NaN); on/after-terminus days preserved verbatim.
    assert segmented.loc[pd.Timestamp("2026-01-01"):pd.Timestamp("2026-01-03")].isna().all()
    assert segmented.loc[pd.Timestamp("2026-01-04")] == pytest.approx(0.01)
    assert segmented.loc[pd.Timestamp("2026-01-06")] == pytest.approx(0.02)
    assert flags == {"flow_coverage_incomplete": True}
    # The gap is NOT rolled into a cumulative number: only trusted days survive.
    # (Leading-NaN-only shape → suffix compounded, NO twr_chain_broken flag: the
    # terminus already flagged flow_coverage_incomplete, no double-flag.)
    seg_value, seg_flags = cumulative_twr_segmented(segmented)
    assert seg_value == pytest.approx((1.01 * 0.99 * 1.02) - 1.0, rel=1e-9)
    assert seg_flags == {}


def test_terminus_segmentation_mutation_removing_segment_fabricates_return() -> None:
    """MUTATION-honest (T-76-03-GAP): if the segment is REMOVED (returns passed
    through unchanged), a fabricated pre-terminus return leaks into the cumulative.
    This asserts the segmented cumulative DIFFERS from the un-segmented one — so a
    revert that stops NaN-ing the pre-terminus window turns the assertion RED."""
    idx = _days(6, start="2026-01-01")
    returns = pd.Series(
        [0.50, -0.40, 0.30, 0.01, -0.01, 0.02], index=idx, name="returns"
    )
    terminus = pd.Timestamp("2026-01-04")

    segmented, _ = apply_flow_coverage_terminus(returns, terminus)
    # The pre-terminus days carried large (fabricated-over-the-gap) returns; the
    # segmented cumulative must EXCLUDE them and thus differ from the raw cumulative.
    assert cumulative_twr_segmented(segmented)[0] != pytest.approx(
        cumulative_twr_segmented(returns)[0]
    )
    assert cumulative_twr_segmented(segmented)[0] == pytest.approx(
        (1.01 * 0.99 * 1.02) - 1.0, rel=1e-9
    )


def test_terminus_none_is_full_coverage_byte_identical() -> None:
    """SC-4 preservation: ``flow_coverage_start_day is None`` (a fully-covered /
    flow-less account, e.g. Binance with no retention cap) returns the series
    UNCHANGED with no flag — fully-covered accounts do not move."""
    idx = _days(4, start="2026-01-01")
    returns = pd.Series([0.01, -0.02, 0.03, 0.01], index=idx, name="returns")

    out, flags = apply_flow_coverage_terminus(returns, None)
    pd.testing.assert_series_equal(out, returns)
    assert flags == {}


def test_terminus_before_first_day_is_no_op() -> None:
    """A terminus at/before the first return day means the whole window is within
    retention → no segmentation, no flag (full coverage)."""
    idx = _days(4, start="2026-02-01")
    returns = pd.Series([0.01, -0.02, 0.03, 0.01], index=idx, name="returns")

    out, flags = apply_flow_coverage_terminus(returns, pd.Timestamp("2026-01-15"))
    pd.testing.assert_series_equal(out, returns)
    assert flags == {}


def test_transient_not_terminal_does_not_segment() -> None:
    """WR-04 transient-vs-terminal: a TRANSIENT fetch error is NOT a coverage
    terminus — it bubbles retryable at the I/O layer and never reaches here as a
    start-day signal. Modelled purely: ``None`` (no clean end-of-history boundary)
    never segments, so a retryable blip cannot over-truncate a good series."""
    idx = _days(5, start="2026-03-01")
    returns = pd.Series([0.02, 0.01, -0.03, 0.04, 0.01], index=idx, name="returns")

    # A transient condition surfaces as "no terminus signal" (None) here.
    out, flags = apply_flow_coverage_terminus(returns, None)
    pd.testing.assert_series_equal(out, returns)
    assert "flow_coverage_incomplete" not in flags


def test_terminus_flag_lifts_to_complete_with_warnings() -> None:
    """The ``flow_coverage_incomplete`` flag flows through the existing meta
    channel: ``_build_nav_meta`` stamps it and downgrades the status hint to
    ``complete_with_warnings`` — no parallel status system is invented."""
    meta = nav_twr_mod._build_nav_meta({"flow_coverage_incomplete": True})
    assert meta["flow_coverage_incomplete"] is True
    assert meta["computation_status_hint"] == "complete_with_warnings"
    # A clean (no-flag) build stays complete and omits the key.
    clean = nav_twr_mod._build_nav_meta({})
    assert clean["computation_status_hint"] == "complete"
    assert "flow_coverage_incomplete" not in clean


# ---------------------------------------------------------------------------
# DQ-02 — per-venue flow-coverage terminus constants (W2)
# ---------------------------------------------------------------------------


def test_per_venue_terminus_constants() -> None:
    """W2: per-venue deposit-history retention is NAMED explicitly. OKX ~90d,
    Bybit ~365d (job_worker.py:1988 'Bybit last 365 days'), Binance None (no known
    retention cap → never segments)."""
    assert OKX_DEPOSIT_TERMINUS_DAYS == 90
    assert BYBIT_DEPOSIT_TERMINUS_DAYS == 365
    assert BINANCE_DEPOSIT_TERMINUS_DAYS is None
    assert FLOW_TERMINUS_DAYS_BY_VENUE == {
        "okx": 90,
        "bybit": 365,
        "binance": None,
    }


def test_flow_coverage_terminus_day_per_venue() -> None:
    """``flow_coverage_terminus_day`` maps (venue, first_return_day, now) to the
    earliest trustworthy day, or None when the window is within retention or the
    venue has no cap. A >365-day-old Bybit deposit SEGMENTS; Binance never does."""
    now = pd.Timestamp("2026-07-06")

    # OKX: first return 200 days ago → older than the 90-day cap → terminus set.
    okx_terminus = flow_coverage_terminus_day(
        "okx", first_return_day=now - pd.Timedelta(days=200), now_utc=now
    )
    assert okx_terminus == (now.normalize() - pd.Timedelta(days=90))

    # Bybit: a deposit 400 days ago is beyond the 365-day cap → terminus set
    # (segments gracefully rather than hard-failing on the residual).
    bybit_terminus = flow_coverage_terminus_day(
        "bybit", first_return_day=now - pd.Timedelta(days=400), now_utc=now
    )
    assert bybit_terminus == (now.normalize() - pd.Timedelta(days=365))

    # Bybit within retention (100 days) → None (full coverage).
    assert (
        flow_coverage_terminus_day(
            "bybit", first_return_day=now - pd.Timedelta(days=100), now_utc=now
        )
        is None
    )

    # Binance: no known retention cap → always None (never segments).
    assert (
        flow_coverage_terminus_day(
            "binance", first_return_day=now - pd.Timedelta(days=1000), now_utc=now
        )
        is None
    )


def test_flow_coverage_terminus_day_feeds_segmentation() -> None:
    """End-to-end (pure): a Bybit window older than 365 days derives a terminus
    that, applied via ``apply_flow_coverage_terminus``, segments + flags — the two
    pure seams compose exactly as 76-04 will wire them."""
    now = pd.Timestamp("2026-07-06")
    idx = pd.DatetimeIndex(
        [now - pd.Timedelta(days=400), now - pd.Timedelta(days=100), now]
    )
    returns = pd.Series([0.10, 0.02, 0.01], index=idx, name="returns")

    terminus = flow_coverage_terminus_day(
        "bybit", first_return_day=idx[0], now_utc=now
    )
    assert terminus is not None
    segmented, flags = apply_flow_coverage_terminus(returns, terminus)
    assert np.isnan(segmented.iloc[0])  # the >365d-old day is refused
    assert flags == {"flow_coverage_incomplete": True}


# ---------------------------------------------------------------------------
# CRITICAL-1 (v1.8 xhigh red team) — the DQ-02 terminus is EVIDENCE-gated.
# ---------------------------------------------------------------------------


def test_flow_gap_evidence_flowless_account_is_false() -> None:
    """A FLOW-LESS account (no external flows) with NO pre-terminus guard has NO
    evidence of a truncated flow → False → the terminus does NOT fire → full
    history retained (the CRITICAL-1 fix / SC-4 byte-identity restoration).
    MUTATION: defaulting to True (the old unconditional gate) → this asserts
    False, so the revert REDs here."""
    floor = pd.Timestamp("2026-04-07")  # now − 90d
    assert not flow_coverage_gap_evidence(
        external_flows=[], retention_floor=floor, pre_terminus_nav_guard_fired=False
    )
    assert not flow_coverage_gap_evidence(
        external_flows=None, retention_floor=floor, pre_terminus_nav_guard_fired=False
    )


def test_flow_gap_evidence_boundary_flow_is_true() -> None:
    """A real fetched flow AT/NEAR the retention floor (within
    FLOW_BOUNDARY_PROXIMITY_DAYS) is boundary evidence that older flows plausibly
    exist beyond the unfetchable bound → True. A flow WELL INSIDE the window (its
    inception flow was captured → complete coverage) → False."""
    floor = pd.Timestamp("2026-04-07")
    near = [ExternalFlow((floor + pd.Timedelta(days=2)).strftime("%Y-%m-%d"), 1000.0)]
    assert flow_coverage_gap_evidence(
        external_flows=near, retention_floor=floor, pre_terminus_nav_guard_fired=False
    )
    far = [
        ExternalFlow(
            (floor + pd.Timedelta(days=FLOW_BOUNDARY_PROXIMITY_DAYS + 5)).strftime(
                "%Y-%m-%d"
            ),
            1000.0,
        )
    ]
    assert not flow_coverage_gap_evidence(
        external_flows=far, retention_floor=floor, pre_terminus_nav_guard_fired=False
    )


def test_flow_gap_evidence_no_retention_cap_is_false() -> None:
    """A no-cap venue (Binance → retention_floor None) cannot have a boundary-flow
    truncation regardless of flows → False (only a manifested guard could fire the
    terminus, and Binance's terminus is None anyway)."""
    near = [ExternalFlow("2026-04-09", 1000.0)]
    assert not flow_coverage_gap_evidence(
        external_flows=near, retention_floor=None, pre_terminus_nav_guard_fired=False
    )


def test_flow_gap_evidence_pre_terminus_guard_short_circuits_true() -> None:
    """A pre-terminus negative-NAV guard is the manifested-harm signal → True even
    for a flow-less account with no boundary flow."""
    assert flow_coverage_gap_evidence(
        external_flows=[], retention_floor=None, pre_terminus_nav_guard_fired=True
    )


def test_flow_gap_evidence_tolerates_tz_aware_floor_vs_naive_flow_day() -> None:
    """The retention floor is built from a tz-AWARE now while ExternalFlow days are
    tz-naive 'YYYY-MM-DD' — the predicate must not raise 'Cannot compare tz-naive
    and tz-aware'. MUTATION: dropping the tz-strip raises → RED."""
    floor = pd.Timestamp("2026-04-07", tz="UTC")
    near = [ExternalFlow("2026-04-09", 1000.0)]  # naive
    assert flow_coverage_gap_evidence(
        external_flows=near, retention_floor=floor, pre_terminus_nav_guard_fired=False
    )


def test_negative_nav_guard_pre_terminus_localizes_to_pre_region() -> None:
    """``negative_nav_guard_pre_terminus`` is True only when the guard fired AND a
    guarded (NaN) day lies BEFORE the terminus — a POST-terminus blow-up must not
    trigger a spurious whole-history truncation."""
    now = pd.Timestamp("2026-07-06")
    terminus = now.normalize() - pd.Timedelta(days=90)
    idx = pd.DatetimeIndex(
        [now - pd.Timedelta(days=120), now - pd.Timedelta(days=100), now]
    )
    # A NaN (guard) on the 120d-old PRE-terminus day → True.
    pre_nan = pd.Series([np.nan, 0.02, 0.01], index=idx, name="returns")
    assert negative_nav_guard_pre_terminus(
        pre_nan, terminus=terminus, negative_nav_guard_fired=True
    )
    # The SAME NaN pattern but guard flag False (some other NaN source) → False.
    assert not negative_nav_guard_pre_terminus(
        pre_nan, terminus=terminus, negative_nav_guard_fired=False
    )
    # A NaN only on the POST-terminus (recent) day → not pre-terminus → False.
    post_nan = pd.Series([0.10, 0.02, np.nan], index=idx, name="returns")
    assert not negative_nav_guard_pre_terminus(
        post_nan, terminus=terminus, negative_nav_guard_fired=True
    )
    # No terminus (no cap) → False.
    assert not negative_nav_guard_pre_terminus(
        pre_nan, terminus=None, negative_nav_guard_fired=True
    )


# ---------------------------------------------------------------------------
# FLOW-04 — terminal uPnL wedge: materiality flag + realized-basis invariant
# ---------------------------------------------------------------------------


def test_terminal_wedge_equivalence_byte_identical() -> None:
    """SC-2/SC-4: the terminal uPnL wedge is a PURE terminal shift, not an
    intra-window operation. ``reconstruct_nav_and_twr(pnl, anchor=A,
    open_unrealized_usd=X)`` produces a returns Series byte-identical (rtol
    1e-12) to ``reconstruct_nav_and_twr(pnl, anchor=A-X, open_unrealized_usd=0)``
    — the wedge only lowers the roll terminal, it never enters any daily
    increment. The META, however, DIVERGES: the wedge call surfaces
    ``unrealized_pnl_in_anchor`` (X is material vs A) while the pre-reduced call
    does not (its uPnL is 0). This is the whole point — the wedge is invisible to
    the return series but visible to the materiality flag.

    Mutation: adding X into any intra-window NAV (e.g. nav.iloc[-1] += X
    post-roll) breaks the byte-identity assertion below."""
    pnls = [500.0, -300.0, 800.0, -100.0, 400.0]
    anchor = 100_000.0
    wedge = 8_000.0  # |X|/A = 0.08 > 0.05 -> material

    ret_wedge, meta_wedge = reconstruct_nav_and_twr(
        _pnl(pnls), anchor_nav=anchor, open_unrealized_usd=wedge
    )
    ret_prered, meta_prered = reconstruct_nav_and_twr(
        _pnl(pnls), anchor_nav=anchor - wedge, open_unrealized_usd=0.0
    )

    pd.testing.assert_series_equal(
        ret_wedge,
        ret_prered,
        check_exact=False,
        rtol=1e-12,
        check_freq=False,
        check_names=False,
    )
    # Series identical; meta diverges on the materiality flag.
    assert meta_wedge.get("unrealized_pnl_in_anchor") is True
    assert meta_wedge["computation_status_hint"] == "complete_with_warnings"
    assert "unrealized_pnl_in_anchor" not in meta_prered
    assert meta_prered["computation_status_hint"] == "complete"


def test_no_step_discontinuity_large_open_position() -> None:
    """SC-2: a large open position across the window end (material wedge X)
    reconstructs with NO step discontinuity at the anchor day. The terminal NAV
    equals A-X and the last-day return equals ``pnl_n / NAV_{n-1}`` with NO uPnL
    term — uPnL never enters an intra-window day.

    Mutation: injecting X into the last intra-window NAV (nav.iloc[-1] or
    NAV_{n-1}) would change the last-day return away from pnl_n/NAV_{n-1} and
    redden this test."""
    pnls = [500.0, -300.0, 800.0, -100.0, 400.0]
    anchor = 100_000.0
    wedge = 20_000.0  # |X|/A = 0.20 -> large, material

    ret, meta = reconstruct_nav_and_twr(
        _pnl(pnls), anchor_nav=anchor, open_unrealized_usd=wedge
    )

    terminal = anchor - wedge
    nav = reconstruct_nav(_pnl(pnls), terminal, _flows_to_daily_usd([]))
    # Terminal is the realized-basis anchor, no step at the endpoint.
    assert nav.iloc[-1] == pytest.approx(terminal, rel=0, abs=1e-9)
    # Day n-1 -> n return is pnl_n / NAV_{n-1}, with NO uPnL term.
    nav_prev = float(nav.iloc[-2])
    expected_last = pnls[-1] / nav_prev
    assert ret.iloc[-1] == pytest.approx(expected_last, rel=1e-12)
    # The material wedge is surfaced as a flag, never spread across the roll.
    assert meta.get("unrealized_pnl_in_anchor") is True


def test_unrealized_pnl_in_anchor_materiality_boundary() -> None:
    """SC-3: ``unrealized_pnl_in_anchor`` fires when |open_unrealized_usd|/anchor
    is strictly ABOVE UNREALIZED_MATERIALITY_RATIO (0.05), is clear at/below, and
    exercises BOTH signs of the wedge. The account base (100k, small pnls, no
    flows) trips no other guard, so the materiality flag is the only signal.

    Mutation: flipping the ``>`` comparator to ``>=`` reddens the exactly-at-5%
    case; flipping it to ``<`` reddens both above-threshold cases."""
    pnls = [500.0, -300.0, 800.0]
    anchor = 100_000.0

    # The const exists and is the locked 5% default.
    assert nav_twr_mod.UNREALIZED_MATERIALITY_RATIO == 0.05

    # Just ABOVE 5% (ratio 0.051), both signs -> flag + complete_with_warnings.
    for wedge in (5_100.0, -5_100.0):
        _, meta = reconstruct_nav_and_twr(
            _pnl(pnls), anchor_nav=anchor, open_unrealized_usd=wedge
        )
        assert meta.get("unrealized_pnl_in_anchor") is True
        assert meta["computation_status_hint"] == "complete_with_warnings"

    # Exactly AT 5% (ratio 0.05) -> NOT material (strict >), stays complete.
    for wedge in (5_000.0, -5_000.0):
        _, meta = reconstruct_nav_and_twr(
            _pnl(pnls), anchor_nav=anchor, open_unrealized_usd=wedge
        )
        assert "unrealized_pnl_in_anchor" not in meta
        assert meta["computation_status_hint"] == "complete"

    # Just BELOW 5% (ratio 0.049), both signs -> key ABSENT, complete.
    for wedge in (4_900.0, -4_900.0):
        _, meta = reconstruct_nav_and_twr(
            _pnl(pnls), anchor_nav=anchor, open_unrealized_usd=wedge
        )
        assert "unrealized_pnl_in_anchor" not in meta
        assert meta["computation_status_hint"] == "complete"


def test_unrealized_pnl_in_anchor_dust_anchor_suppressed() -> None:
    """SC-3 dust guard: a dust/near-zero anchor (<= DUST_NAV_FLOOR) never raises
    the materiality flag on noise. With a $500 anchor (< $1000 floor), even a
    wedge that is a huge FRACTION of the base must not surface
    ``unrealized_pnl_in_anchor`` — the ratio is meaningless on a dust base (and a
    dust NAV is already flagged by the DQ-01 dust guard on its own merits)."""
    # anchor 500 (dust), tiny pnl so the roll stays near the dust base.
    _, meta = reconstruct_nav_and_twr(
        _pnl([10.0]), anchor_nav=500.0, open_unrealized_usd=200.0
    )
    # |200|/500 = 0.40 would be "material" on a healthy base, but the base is
    # dust -> the materiality ratio is NOT evaluated.
    assert "unrealized_pnl_in_anchor" not in meta


def test_no_historical_mark_no_perday_upnl_array() -> None:
    """T-77-03 / Q3 no-fabricated-marks source-scan (mirrors the P73/P76
    forbidden-substitution scans): the uPnL wedge is applied ONLY as a scalar
    subtraction on ``terminal_nav``; NO per-day historical-uPnL Series/array is
    constructed anywhere in the roll. Encodes the Q3 verdict — historical
    open-position marks are NOT retrievable on read-only keys, so a per-day
    true-up is NOT implemented and must never be fabricated.

    Also asserts the realized-basis-intraday / MTM-at-endpoint invariant is
    documented in the module (executable invariant, not just prose)."""
    src = _NAV_TWR_SRC.read_text()

    # No per-day uPnL array / Series / positional indexing of a uPnL stream.
    forbidden = [
        r"unrealized\w*\s*=\s*pd\.Series",
        r"upnl\w*\s*=\s*pd\.Series",
        r"open_unrealized\w*\s*=\s*pd\.Series",
        r"upnl\w*\.iloc",
        r"open_unrealized\w*\.iloc",
        r"for\s+\w+\s+in\s+.*open_unrealized",
    ]
    offenders: list[str] = []
    for line in src.splitlines():
        if line.strip().startswith("#"):
            continue  # prose describing the anti-pattern is allowed
        for pat in forbidden:
            if re.search(pat, line):
                offenders.append(f"{pat!r} -> {line.strip()!r}")
    assert offenders == [], f"per-day uPnL array constructed: {offenders}"

    # The flag exists in the core, and the Q3 invariant is documented verbatim.
    assert "unrealized_pnl_in_anchor" in src
    assert "not retrievable on read-only keys" in src
    assert "never spread across history" in src


def test_material_wedge_does_not_spuriously_breach_reconcile() -> None:
    """SC-2 guard: a non-zero (even large) uPnL wedge must NOT spuriously breach
    the DQ-02 construction residual inside ``reconstruct_nav_and_twr``. The
    terminal and the derived ``reconstructed_start`` shift by the SAME wedge, so
    the roll-vs-Σ identity stays ~0 by construction — the residual detects a
    dropped/mis-valued FLOW, not a legitimate terminal wedge. A material wedge
    completing without ``NavReconstructionError`` proves the wedge is a clean
    terminal shift."""
    pnls = [500.0, -300.0, 800.0, -100.0, 400.0]
    # A large wedge (30% of anchor) still reconstructs cleanly — no false breach.
    ret, meta = reconstruct_nav_and_twr(
        _pnl(pnls),
        anchor_nav=100_000.0,
        external_flows=[("2026-01-03", 2_000.0)],
        open_unrealized_usd=30_000.0,
    )
    assert len(ret) == len(pnls)
    assert meta.get("unrealized_pnl_in_anchor") is True


def test_nav_twr_guard_keys_are_declared_and_single_sourced() -> None:
    """SHOULD-1 (specialist-types): NAV_TWR_GUARD_KEYS is the ONE source of truth
    for the additive warn-flag set. Pin that every key it lists is a DECLARED
    NavTWRMeta field (``set(NAV_TWR_GUARD_KEYS) <= NavTWRMeta.__annotations__``)
    — so a typo in the shared tuple, or a key that never made it into the
    TypedDict, reddens here rather than silently never-promoting downstream. Also
    pin it EXCLUDES the two inherited non-guard keys (a guard key must promote
    status; used_heuristic_capital / balance_error are handled separately).
    """
    from services.nav_twr import NavTWRMeta

    declared = set(NavTWRMeta.__annotations__)
    assert set(NAV_TWR_GUARD_KEYS) <= declared, (
        "every NAV_TWR_GUARD_KEYS entry must be a declared NavTWRMeta field; "
        f"undeclared: {set(NAV_TWR_GUARD_KEYS) - declared}"
    )
    # The inherited non-guard signals must NOT be in the guard set (they promote
    # via their own explicit predicate, not the shared guard iteration).
    assert "used_heuristic_capital" not in NAV_TWR_GUARD_KEYS
    assert "balance_error" not in NAV_TWR_GUARD_KEYS
    # No duplicate keys in the single source.
    assert len(NAV_TWR_GUARD_KEYS) == len(set(NAV_TWR_GUARD_KEYS))
    # The v1.8 warn flags + the v1.9 DQ-03 chain-break key + the Phase 82
    # pre-coverage option-dailies flag + the Phase 92 HARD-01 P&L-dominated guard +
    # the Phase 132 smoothed_mtm pre-mark-retention bucket are all present (regression
    # pin on the closed set).
    assert set(NAV_TWR_GUARD_KEYS) == {
        "dust_nav_guard",
        "negative_nav_guard",
        "flow_dominated_guard",
        "pnl_dominated_guard",
        "flow_coverage_incomplete",
        "unrealized_pnl_in_anchor",
        "unrealized_pnl_unreadable",
        "twr_chain_broken",
        "pre_summary_rollout_option_dailies",
        "pre_mark_retention_option_dailies",
    }


def test_multi_flow_with_one_dominated_day_does_not_poison_neighbors() -> None:
    """H2 (specialist-tests): ONE reconstruction carrying MULTIPLE external flows
    across different days where the middle flow DOMINATES (NaN + flow_dominated_
    guard) while the other flow days produce VALID non-zero returns. Pins the
    ``_union_flow_days`` docstring claim that the union changes WHICH days exist,
    never the guard math — a dominated day must NOT poison a neighbour's
    denominator, and flows must NOT be summed across days.

    Mutation-honest: the exact neighbour returns are load-bearing. If a guarded
    day leaked its NaN into the next day's NAV_{t-1}, or if flows were summed
    across days, r on 01-03 / 01-07 would change and these approx assertions RED.
    Only the dominated day (01-05) is excluded from cumulative_twr.
    """
    pnl = _pnl([100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0])  # 7 days
    flows = [
        ("2026-01-03", 1_000.0),    # normal deposit (|F| < NAV_prev)
        ("2026-01-05", 12_000.0),   # DOMINATING (|F| >= NAV_prev) -> NaN + guard
        ("2026-01-07", 500.0),      # normal deposit
    ]
    ret, meta = reconstruct_nav_and_twr(pnl, anchor_nav=20_000.0, external_flows=flows)

    # NAV backward roll: [5900, 6000, 7100, 7200, 19300, 19400, 20000].
    # Only the dominated day (index 4, 2026-01-05) breaks; the other six days —
    # including BOTH neighbour flow days — carry finite returns.
    nan_mask = ret.isna()
    assert nan_mask.sum() == 1, f"exactly one guarded day expected; got {ret.tolist()}"
    assert bool(nan_mask.iloc[4]), "the dominating-flow day (01-05) must be the NaN"
    assert meta.get("flow_dominated_guard") is True
    assert meta.get("negative_nav_guard") is None
    assert meta.get("dust_nav_guard") is None
    assert meta["computation_status_hint"] == "complete_with_warnings"

    # The two NEIGHBOUR flow days produce their own correct non-zero returns —
    # the guarded day between/around them did not poison the denominators.
    # r_0103 = (7100 - 6000 - 1000)/6000 = 100/6000.
    assert ret.loc[pd.Timestamp("2026-01-03")] == pytest.approx(100.0 / 6000.0)
    # r_0107 = (20000 - 19400 - 500)/19400 = 100/19400.
    assert ret.loc[pd.Timestamp("2026-01-07")] == pytest.approx(100.0 / 19400.0)

    # DQ-03 (§6) BEHAVIOR CHANGE: the dominated day (01-05, index 4) is an
    # INTERIOR break (valid returns on BOTH sides), so the honest cumulative no
    # longer BRIDGES it. It compounds ONLY the maximal contiguous suffix AFTER
    # the last break — the trustworthy segment anchored to the venue terminal:
    # days 01-06 and 01-07. The number consciously CHANGES from the old six-day
    # bridged product; the suffix product differs from the bridge (a regression
    # to bridging would fail on the NUMBER), and twr_chain_broken now rides.
    value, flags = cumulative_twr_segmented(ret)
    suffix = ret.iloc[5:]  # 01-06, 01-07 (after the interior break at index 4)
    expected_suffix = float(np.prod(1.0 + suffix.to_numpy(dtype=float)) - 1.0)
    bridged = float(np.prod(1.0 + ret.dropna().to_numpy(dtype=float)) - 1.0)
    assert flags == {"twr_chain_broken": True}
    assert value == pytest.approx(expected_suffix)
    assert expected_suffix != pytest.approx(bridged)  # honest suffix != bridge
