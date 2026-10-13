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

import math
import random
import re
from fractions import Fraction
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from services import nav_twr as nav_twr_mod
from services.account_unit import USD_FLOORS, classify_account_currency
from services.nav_twr import (
    BINANCE_DEPOSIT_TERMINUS_DAYS,
    BYBIT_DEPOSIT_TERMINUS_DAYS,
    FLOW_TERMINUS_DAYS_BY_VENUE,
    NAV_TWR_ANNOTATION_KEYS,
    NAV_TWR_GUARD_KEYS,
    OKX_DEPOSIT_TERMINUS_DAYS,
    PNL_DOM_RATIO,
    FLOW_BOUNDARY_PROXIMITY_DAYS,
    DayTiming,
    NavReconstructionError,
    _build_nav_meta,
    _flows_to_daily_usd,
    _guard_denominator,
    _timed_day_return,
    apply_flow_coverage_terminus,
    ccxt_history_reaches_inception,
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

    # D-27: the USD dust floor is 100 (it was 1000), so the dust leg is a positive base UNDER
    # 100; 500 is now a measured base.
    dust_ret, dust_flags = chain_linked_twr(nav, daily_pnl, fbd, prev0=50.0)
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

    # --- dust guard: an interior NAV_{t-1} in (0, DUST_NAV_FLOOR) breaks. D-27: the USD
    # floor is 100 (was 1000), so the dust leg sits on a base of 50, not 500. ---
    ret_dust, meta_dust = reconstruct_nav_and_twr(
        _pnl([0.0, -4950.0, 300.0]), anchor_nav=350.0
    )
    # nav = [5000, 50, 350]; day-2 prev NAV = 50 < 100 -> dust
    assert np.isnan(ret_dust.iloc[2])
    assert meta_dust.get("dust_nav_guard") is True
    assert meta_dust["computation_status_hint"] == "complete_with_warnings"

    # --- a dominating flow is NOT a guard (164.6.6.2.3 D-05): |F_t| = 2500 on a 2000
    # base is measured, not dropped; the flow counts at the end of the day (D-07) and
    # that is an annotation, never a warning. ---
    ret_fd, meta_fd = reconstruct_nav_and_twr(
        _pnl([0.0, 50.0, 30.0]),
        anchor_nav=4580.0,
        external_flows=[("2026-01-02", 2500.0)],
    )
    # nav = [2000, 4550, 4580]; day-1 prev NAV = 2000, r = (4550 - 2000 - 2500)/2000
    assert ret_fd.iloc[1] == pytest.approx(0.025, abs=1e-15)
    assert "flow_dominated_guard" not in meta_fd
    assert meta_fd["computation_status_hint"] == "complete"

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


def test_native_unit_is_not_a_guard_key() -> None:
    """D-08: the account's unit is a property, not a warning. A ``native_unit`` key in the
    guard registry would promote every BTC account to ``complete_with_warnings``; in the
    meta it would be one more field every consumer must know to ignore."""
    assert "native_unit" not in NAV_TWR_GUARD_KEYS
    assert "native_unit" not in nav_twr_mod.NavTWRMeta.__annotations__


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
    the materiality flag on noise. With a $50 anchor (< the $100 floor, 167.1.2 D-27;
    it was a $500 anchor under the old $1000 floor), even a wedge that is a huge
    FRACTION of the base must not surface ``unrealized_pnl_in_anchor`` — the ratio is
    meaningless on a dust base (and a dust NAV is already flagged by the DQ-01 dust
    guard on its own merits)."""
    # anchor 50 (dust), tiny pnl so the roll stays near the dust base.
    _, meta = reconstruct_nav_and_twr(
        _pnl([10.0]), anchor_nav=50.0, open_unrealized_usd=20.0
    )
    # |20|/50 = 0.40 would be "material" on a healthy base, but the base is
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
    # 164.6.6.2.3 D-05: nine keys. The flow-dominance guard is retired and lives only in
    # NAV_TWR_LEGACY_GUARD_KEYS (pinned below).
    assert set(NAV_TWR_GUARD_KEYS) == {
        "dust_nav_guard",
        "negative_nav_guard",
        "pnl_dominated_guard",
        "flow_coverage_incomplete",
        "unrealized_pnl_in_anchor",
        "unrealized_pnl_unreadable",
        "twr_chain_broken",
        "pre_summary_rollout_option_dailies",
        "pre_mark_retention_option_dailies",
    }
    assert len(NAV_TWR_GUARD_KEYS) == 9


def test_retired_flow_dominated_key_is_carry_only_and_disjoint() -> None:
    """164.6.6.2.3 D-05 / D-14. The flow-dominance key can no longer be emitted (it is not a
    NavTWRMeta member and not a guard key), yet a STORED flag must still be carried until the
    Wave 5 recompute, so it lives in the carry-only NAV_TWR_LEGACY_GUARD_KEYS. The tuple must
    share no member with the emitted guards or the annotations: a key in two loops would be
    carried with two different promotion rules. Re-adding the key to NAV_TWR_GUARD_KEYS fails
    here (and at import, via the module-level assert)."""
    from services.nav_twr import (
        NAV_TWR_ANNOTATION_KEYS,
        NAV_TWR_LEGACY_GUARD_KEYS,
        NavTWRMeta,
    )

    assert NAV_TWR_LEGACY_GUARD_KEYS == ("flow_dominated_guard",)
    assert not set(NAV_TWR_LEGACY_GUARD_KEYS) & set(NAV_TWR_GUARD_KEYS)
    assert not set(NAV_TWR_LEGACY_GUARD_KEYS) & set(NAV_TWR_ANNOTATION_KEYS)
    assert not set(NAV_TWR_LEGACY_GUARD_KEYS) & set(NavTWRMeta.__annotations__)
    # Nothing the core returns can name it, however large the flow: a 10000x deposit.
    _ret, meta = reconstruct_nav_and_twr(
        _pnl([1.0, 1.0, 1.0]),
        anchor_nav=1_000_000.0,
        external_flows=[("2026-01-02", 999_000.0)],
    )
    assert "flow_dominated_guard" not in meta


def test_multi_flow_with_one_dominating_flow_day_is_measured_at_day_level() -> None:
    """H2 (specialist-tests), moved by 164.6.6.2.3 D-05. ONE reconstruction carrying MULTIPLE
    external flows across different days where the middle flow (12000 on a 7200 base) used
    to DOMINATE (NaN + the retired flow-dominance flag). A flow, however large, no longer
    drops a day: all seven days are measured, the flow counts at the end of its day (D-07)
    and the annotation says so.

    Hand arithmetic, independent of the code: NAV = [5900, 6000, 7100, 7200, 19300, 19400,
    20000] and every day earns +100 on the previous close (day 0: 5800), so
    r = 100 / [5800, 5900, 6000, 7100, 7200, 19300, 19400]. The dominating day (01-05) is
    100 / 7200, NOT a function of the 12000 deposit, and a guarded day cannot poison a
    neighbour's denominator, nor can flows be summed across days (those would move the
    neighbours). Mutation-honest: restoring a flow clause turns this RED on the NaN."""
    pnl = _pnl([100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0])  # 7 days
    flows = [
        ("2026-01-03", 1_000.0),
        ("2026-01-05", 12_000.0),   # the former DOMINATING flow
        ("2026-01-07", 500.0),
    ]
    ret, meta = reconstruct_nav_and_twr(pnl, anchor_nav=20_000.0, external_flows=flows)

    assert int(ret.isna().sum()) == 0
    assert ret.to_numpy() == pytest.approx(
        [100.0 / d for d in (5800.0, 5900.0, 6000.0, 7100.0, 7200.0, 19300.0, 19400.0)],
        rel=1e-12,
    )
    assert "flow_dominated_guard" not in meta
    assert "twr_chain_broken" not in meta
    for guard in NAV_TWR_GUARD_KEYS:
        assert guard not in meta
    # All three flow days are at day level; an annotation, so the status stays complete.
    assert meta["flow_timing_day_level"] is True
    assert meta["flow_timing_day_level_days"] == 3
    assert "flow_timing_timed_days" not in meta
    assert meta["computation_status_hint"] == "complete"

    value, cum_flags = cumulative_twr_segmented(ret)
    assert cum_flags == {}
    assert value == pytest.approx(float(np.prod(1.0 + ret.to_numpy()) - 1.0))


# ---------------------------------------------------------------------------
# Phase 164.6.6.2 BTCNATIVE plan 01 — the unit-sized thresholds read the unit's floors
# ---------------------------------------------------------------------------

_BTC_FLOORS = classify_account_currency("BTC").floors


def test_reconcile_residual_tolerance_is_per_unit() -> None:
    """T-164.6.6.2-03. The DQ-02 absolute band was a hidden USD $1.00. A roll that drops a
    0.001 BTC flow leaves a residual of exactly 0.001 BTC:
      terminal 0.02, pnl [0.001, -0.0005, 0.0002] (sum 0.0007), flow +0.001 on day 2.
      true start        = 0.02 - 0.0007 - 0.001 = 0.0183
      mutant (flow dropped from the roll) start = 0.0183 + 0.001 = 0.0193
      residual = 0.02 - 0.0193 - 0.0007 - 0.001 = -0.001
    The BTC band is max(1e-6, 1e-6 * 0.02) = 1e-6, so 0.001 raises. The default (USD)
    band is 1.00, so the very same input would be waved through: the defect."""
    daily_pnl = _pnl([0.001, -0.0005, 0.0002])
    flows = _flows_to_daily_usd([("2026-01-02", 0.001)])
    terminal = 0.02
    true_start = _reconstructed_start(daily_pnl, terminal, flows)
    assert true_start == pytest.approx(0.0183, abs=1e-12)
    mutant_start = true_start + 0.001  # the roll dropped the flow

    with pytest.raises(NavReconstructionError):
        reconcile_flow_residual(
            terminal, mutant_start, daily_pnl, flows,
            abs_tol=_BTC_FLOORS.residual_abs_tol,
        )
    # The default band is the USD row: today's behaviour, pinned.
    assert reconcile_flow_residual(
        terminal, mutant_start, daily_pnl, flows
    ) == pytest.approx(-0.001, abs=1e-12)
    # A clean BTC roll is still accepted under the tight BTC band.
    assert reconcile_flow_residual(
        terminal, true_start, daily_pnl, flows, abs_tol=_BTC_FLOORS.residual_abs_tol
    ) == pytest.approx(0.0, abs=1e-12)


def test_reconcile_residual_tolerance_catches_the_smallest_mm2x_trade() -> None:
    """D-24 follow-up: MM-2x holds 0.00961461 BTC and its smallest trade is about 2e-5 BTC.
    The BTC absolute band 1e-6 is 1/20 of that trade and 1e-4 of the balance, so a roll
    that drops a 2e-5 BTC flow still raises, and a clean roll at that balance is accepted.
      terminal 0.00961461, pnl [2e-5, -2e-5, 5e-4] (sum 5e-4), flow +2e-5 on day 2.
      true start = 0.00961461 - 0.0005 - 0.00002 = 0.00909461
      mutant start (flow dropped from the roll) = 0.00909461 + 0.00002 = 0.00911461
      residual = 0.00961461 - 0.00911461 - 0.0005 - 0.00002 = -0.00002
    |-2e-5| > max(1e-6, 1e-6 * 0.00961461) = 1e-6, so it raises."""
    daily_pnl = _pnl([0.00002, -0.00002, 0.0005])
    flows = _flows_to_daily_usd([("2026-01-02", 0.00002)])
    terminal = 0.00961461
    true_start = _reconstructed_start(daily_pnl, terminal, flows)
    assert true_start == pytest.approx(0.00909461, abs=1e-15)
    with pytest.raises(NavReconstructionError):
        reconcile_flow_residual(
            terminal, true_start + 0.00002, daily_pnl, flows,
            abs_tol=_BTC_FLOORS.residual_abs_tol,
        )
    assert reconcile_flow_residual(
        terminal, true_start, daily_pnl, flows, abs_tol=_BTC_FLOORS.residual_abs_tol
    ) == pytest.approx(0.0, abs=1e-15)


def test_reconcile_wired_with_unit_tolerance(monkeypatch) -> None:
    """The tolerance is threaded THROUGH ``reconstruct_nav_and_twr``, not merely available:
    a roll that corrupts early NAV by 0.001 BTC is refused when the BTC floors are passed
    and accepted (under the USD $1.00 band) when they are not."""
    real_reconstruct = nav_twr_mod.reconstruct_nav

    def _corrupt_roll(daily_pnl, terminal_nav, flows_by_day):
        nav = real_reconstruct(daily_pnl, terminal_nav, flows_by_day)
        vals = nav.to_numpy(dtype=float).copy()
        vals[:-1] += 0.001
        return pd.Series(vals, index=nav.index, name="nav")

    monkeypatch.setattr(nav_twr_mod, "reconstruct_nav", _corrupt_roll)
    pnl = _pnl([0.001, -0.0005, 0.0002])
    with pytest.raises(NavReconstructionError):
        reconstruct_nav_and_twr(pnl, anchor_nav=0.02, floors=_BTC_FLOORS)
    # Unit-blind default: the 0.001 residual sits inside the USD $1.00 band, no raise.
    reconstruct_nav_and_twr(pnl, anchor_nav=0.02)


def test_upnl_materiality_reads_unit_dust_floor() -> None:
    """The uPnL wedge ratio is only evaluated on a non-dust anchor, and 'non-dust' is
    per unit. Anchor 0.02 BTC, open uPnL 0.004: |0.004| / 0.02 = 0.20 > the 0.05 ratio.
    Under BTC floors the anchor (0.02 > 1e-7) is material, so the flag fires; under the
    USD default 0.02 is below $1000, the ratio is not evaluated, no flag."""
    pnl = _pnl([0.001])
    _, btc_meta = reconstruct_nav_and_twr(
        pnl, anchor_nav=0.02, open_unrealized_usd=0.004, floors=_BTC_FLOORS
    )
    assert btc_meta.get("unrealized_pnl_in_anchor") is True
    _, usd_meta = reconstruct_nav_and_twr(
        pnl, anchor_nav=0.02, open_unrealized_usd=0.004
    )
    assert "unrealized_pnl_in_anchor" not in usd_meta


def test_floors_keyword_default_is_byte_identical() -> None:
    """Every venue that does not pass ``floors`` (Deribit, sFOX, ccxt, CSV, native) must
    equal the explicit USD row: the default-preserving keyword is the whole safety case."""
    pnl = _pnl([120.0, -80.0, 40.0, 15.0, -30.0])
    flows = [("2026-01-02", 500.0), ("2026-01-04", -200.0)]
    default_r, default_m = reconstruct_nav_and_twr(
        pnl, anchor_nav=10_000.0, external_flows=flows, open_unrealized_usd=300.0
    )
    explicit_r, explicit_m = reconstruct_nav_and_twr(
        pnl, anchor_nav=10_000.0, external_flows=flows, open_unrealized_usd=300.0,
        floors=USD_FLOORS,
    )
    pd.testing.assert_series_equal(default_r, explicit_r)
    assert default_m == explicit_m

    nav = reconstruct_nav(pnl, 10_000.0, _flows_to_daily_usd(flows))
    d_r, d_f = chain_linked_twr(nav, pnl, _flows_to_daily_usd(flows))
    e_r, e_f = chain_linked_twr(
        nav, pnl, _flows_to_daily_usd(flows), floors=USD_FLOORS
    )
    pd.testing.assert_series_equal(d_r, e_r)
    assert d_f == e_f


# ---------------------------------------------------------------------------
# D-25 (founder, 2026-10-08): a MEASURED day whose starting balance is below the unit's
# ``material_equity`` is kept exact AND flagged ``small_base_measured`` (informational: never
# a chain break, never a dropped day, never a status promotion). IN-03 (code review of plan
# 14): the dust boundary at exactly 1e-7 distinguishes ``<`` from ``<=``.
# ---------------------------------------------------------------------------

_BTC_MATERIAL = _BTC_FLOORS.material_equity  # 1e-4
_BTC_DUST = _BTC_FLOORS.dust_nav  # 1e-7


def _two_day_nav(first: float, second: float) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Two closing NAVs and a zero flow series; day 0's pnl is 0 so ``prev0`` for day 0
    is exactly ``first``, and day 1's prior NAV is exactly ``first`` too."""
    idx = _days(2)
    nav = pd.Series([first, second], index=idx, name="nav")
    pnl = pd.Series([0.0, second - first], index=idx, name="daily_pnl")
    return nav, pnl, _flows_to_daily_usd([])


def test_dust_boundary_is_strict_at_exactly_1e_7() -> None:
    """IN-03. ``prev_nav < dust_floor`` is strict: a prior NAV of exactly 1e-7 BTC is a
    usable denominator, and the next float below it is dust. A ``<=`` mutant turns the first
    assertion RED; a floor one ulp too low turns the second RED."""
    assert _guard_denominator(_BTC_DUST, _BTC_DUST) is None
    below = math.nextafter(_BTC_DUST, 0.0)
    assert _guard_denominator(below, _BTC_DUST) == "dust_nav_guard"


def test_chain_at_exactly_the_dust_floor_is_measured_and_flagged() -> None:
    """The chain-level twin of the boundary: both days start from exactly 1e-7, so both are
    measured (hand arithmetic: (1.2e-7 - 1e-7) / 1e-7 = 0.2 for day 1, 0.0 for day 0) and
    both are under the 1e-4 material equity, so both are flagged. One ulp below, and the
    days are dust-guarded and NOT counted as measured."""
    nav, pnl, flows = _two_day_nav(_BTC_DUST, 1.2e-7)
    returns, flags = chain_linked_twr(nav, pnl, flows, floors=_BTC_FLOORS)
    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.2, abs=1e-9)
    assert "dust_nav_guard" not in flags
    assert flags["small_base_measured"] is True
    assert flags["small_base_measured_days"] == 2
    assert flags["small_base_measured_min_nav"] == _BTC_DUST

    nav2, pnl2, flows2 = _two_day_nav(math.nextafter(_BTC_DUST, 0.0), 1.2e-7)
    returns2, flags2 = chain_linked_twr(nav2, pnl2, flows2, floors=_BTC_FLOORS)
    assert returns2.isna().all()
    assert flags2.get("dust_nav_guard") is True
    assert "small_base_measured" not in flags2  # a guarded day is not a measured day


def test_material_equity_boundary_is_strict_at_exactly_1e_4() -> None:
    """A prior NAV of exactly 1e-4 BTC (the BTC ``material_equity``) is NOT a small base;
    the next float below it is. Hand arithmetic for day 1: (1.2e-4 - 1e-4) / 1e-4 = 0.2 in
    both cases, so only the flag differs. A ``<=`` mutant flags the first case and turns
    this RED; a missing check leaves the second case unflagged and turns it RED."""
    nav, pnl, flows = _two_day_nav(_BTC_MATERIAL, 1.2e-4)
    returns, flags = chain_linked_twr(nav, pnl, flows, floors=_BTC_FLOORS)
    assert returns.iloc[1] == pytest.approx(0.2, abs=1e-9)
    assert flags == {}

    below = math.nextafter(_BTC_MATERIAL, 0.0)
    nav2, pnl2, flows2 = _two_day_nav(below, 1.2e-4)
    returns2, flags2 = chain_linked_twr(nav2, pnl2, flows2, floors=_BTC_FLOORS)
    assert returns2.iloc[1] == pytest.approx(0.2, abs=1e-9)
    assert flags2["small_base_measured"] is True
    assert flags2["small_base_measured_days"] == 2
    assert flags2["small_base_measured_min_nav"] == below


def test_small_base_days_keep_their_exact_returns_and_do_not_break_the_chain() -> None:
    """D-25: informational only. Terminal equity 7e-5 BTC, day P&L +1e-5, -2e-5, +3e-5, no flows.
    Hand arithmetic (NAV_{t-1} = NAV_t - pnl_t):
        NAV_2 = 7e-5     NAV_1 = 7e-5 - 3e-5 = 4e-5     NAV_0 = 4e-5 + 2e-5 = 6e-5
        day-0 base = 6e-5 - 1e-5 = 5e-5
    returns: 1e-5 / 5e-5 = 0.2,  -2e-5 / 6e-5 = -1/3,  3e-5 / 4e-5 = 0.75.
    Every base (5e-5, 6e-5, 4e-5) is under 1e-4, so all three days are flagged, none is
    dropped, the cumulative is the exact product (1.2 * 2/3 * 1.75 - 1 = 0.4), there is NO
    ``twr_chain_broken``, and the status hint stays ``complete`` (not a warning)."""
    pnl = _pnl([1e-5, -2e-5, 3e-5])
    returns, meta = reconstruct_nav_and_twr(pnl, anchor_nav=7e-5, floors=_BTC_FLOORS)
    assert returns.to_numpy() == pytest.approx([0.2, -1 / 3, 0.75], abs=1e-9)
    assert int(returns.notna().sum()) == 3
    assert meta["small_base_measured"] is True
    assert meta["small_base_measured_days"] == 3
    assert meta["small_base_measured_min_nav"] == pytest.approx(4e-5, abs=1e-15)
    assert "twr_chain_broken" not in meta
    for guard in NAV_TWR_GUARD_KEYS:
        assert guard not in meta
    assert meta["computation_status_hint"] == "complete"
    cumulative, chain_flags = cumulative_twr_segmented(returns)
    assert chain_flags == {}
    assert cumulative == pytest.approx(0.4, abs=1e-9)


def test_small_base_is_unreachable_for_the_usd_row() -> None:
    """USD exactness: ``dust_nav`` equals ``material_equity`` (both 100, 167.1.2 D-27), so every
    prior NAV under ``material_equity`` is dust-guarded before the small-base check runs and the
    annotation still cannot fire for USD. The shape (NAVs 50, 60, 40), in dollars, is three NaN
    days and NO small-base flag; a clean 5000 USD ledger carries none either. The USD flag set is
    exactly what it was before D-25. D-27 changed the ordering ``dust_nav > material_equity`` to
    an equality, and the guarantee holds at equality because the dust guard is the strict ``<``."""
    pnl = _pnl([10.0, -20.0, 30.0])
    returns, meta = reconstruct_nav_and_twr(pnl, anchor_nav=70.0)
    assert returns.isna().all()
    assert meta.get("dust_nav_guard") is True
    assert "small_base_measured" not in meta
    assert USD_FLOORS.dust_nav == USD_FLOORS.material_equity

    clean = _pnl([100.0, 50.0, -25.0])
    _r, clean_meta = reconstruct_nav_and_twr(clean, anchor_nav=5000.0)
    assert "small_base_measured" not in clean_meta
    assert clean_meta["computation_status_hint"] == "complete"


def test_d27_usd_dust_floor_is_100_a_100_to_999_base_is_real_capital() -> None:
    """167.1.2 D-27 (founder, "$100"): the USD dust floor is 100, equal to the material-equity
    line, so ONE threshold means "too small to measure". A $100-$999 base is real capital, not
    dust: a prior NAV in that band is a MEASURED day (finite return, no ``dust_nav_guard``). Under
    the old floor of 1000 this test is RED.

    Hand arithmetic, no flows (NAV_{t-1} = NAV_t - pnl_t), anchor 275, pnl -499, -250, +25:
        NAV_2 = 275   prior_2 = 275 - 25   = 250
        NAV_1 = 250   prior_1 = 250 + 250  = 500
        NAV_0 = 500   prior_0 = 500 + 499  = 999
    returns: -499/999, -250/500 = -0.5, 25/250 = 0.1.
    The guard is the strict ``<``: a prior NAV of exactly 100 is measured, 99 is dust-guarded."""
    returns, meta = reconstruct_nav_and_twr(_pnl([-499.0, -250.0, 25.0]), anchor_nav=275.0)
    assert returns.to_numpy() == pytest.approx([-499 / 999, -0.5, 0.1], abs=1e-9)
    assert "dust_nav_guard" not in meta
    assert meta["computation_status_hint"] == "complete"

    # Exactly 100 is measured (strict ``<`` is unchanged by D-27).
    at_floor, at_floor_meta = reconstruct_nav_and_twr(_pnl([10.0]), anchor_nav=110.0)
    assert at_floor.to_numpy() == pytest.approx([0.1], abs=1e-12)
    assert "dust_nav_guard" not in at_floor_meta

    # 99 is still dust: a break, never a substituted base.
    under, under_meta = reconstruct_nav_and_twr(_pnl([10.0]), anchor_nav=109.0)
    assert under.isna().all()
    assert under_meta.get("dust_nav_guard") is True


def test_small_base_is_an_annotation_not_a_guard_key() -> None:
    """D-25 design pin. The flag is informational, so it must NOT be a ``NAV_TWR_GUARD_KEYS``
    member: membership promotes every consumer to ``complete_with_warnings`` and (founder-lp
    strict mode) withholds the account. It is declared on ``NavTWRMeta`` so the meta type
    knows it, and ``_build_nav_meta`` promotes the status only on a REAL warning beside it."""
    for key in NAV_TWR_ANNOTATION_KEYS:
        assert key not in NAV_TWR_GUARD_KEYS
        assert key in nav_twr_mod.NavTWRMeta.__annotations__
    only = _build_nav_meta(
        {"small_base_measured": True, "small_base_measured_days": 2,
         "small_base_measured_min_nav": 1e-5}
    )
    assert only["computation_status_hint"] == "complete"
    assert only["small_base_measured"] is True
    assert only["small_base_measured_days"] == 2
    both = _build_nav_meta(
        {"small_base_measured": True, "small_base_measured_days": 2,
         "small_base_measured_min_nav": 1e-5, "dust_nav_guard": True}
    )
    assert both["computation_status_hint"] == "complete_with_warnings"
    assert both["dust_nav_guard"] is True and both["small_base_measured"] is True
    assert "small_base_measured" not in _build_nav_meta({})


# ---------------------------------------------------------------------------
# Phase 164.6.6.2.3 FLOWTIMING (D-02/D-03/D-04/D-09, D-06 per cohort): a day carrying a
# ``DayTiming`` is measured against the capital that was in the account when each position
# was opened, and the sub-periods are chain-linked.
# ---------------------------------------------------------------------------


def _exact_cohort_return(
    prev: float,
    flows: list[tuple[int, float]],
    pnl: list[tuple[int | None, float, int]],
) -> Fraction:
    """INDEPENDENT oracle for the timed-day return, in exact rational arithmetic.

    Shares NO code with ``services.nav_twr``: no import from it in this function's scope, a
    different way of choosing the cohort (a COUNT of flows at or before the open, not a
    bisect), a different way of finding a cohort's base (a sweep over EVERY event at or
    before the open, not a sum over earlier cohorts) and exact ``Fraction`` arithmetic
    instead of float. It states D-02/D-17 as prose: the capital when a position opened is the
    start-of-day NAV, plus every non-zero flow timestamped at or before the open (a flow with
    the same instant funds the trade first, D-09), plus the FULL day P&L of every position of
    an EARLIER capital level, realized yet or not (D-17 telescoping base; a position's own
    cash is not capital for itself, and a later level never feeds an earlier one).
    A position opened before the day is on the start-of-day base (D-04). The day's return is
    the product of each used base's ``1 + P/B``, minus one. A capital level nothing was
    opened on contributes no sub-period. ``pnl`` entries are
    ``(open_instant | None, cash, realized_instant)``."""
    live = sorted((at, Fraction(amount)) for at, amount in flows if amount != 0)

    def level_of(open_at: int | None) -> int:
        return 0 if open_at is None else sum(1 for at, _ in live if at <= open_at)

    pnl_of_level = [Fraction(0)] * (len(live) + 1)
    first_open_of_level: dict[int, int] = {}
    for open_at, cash, _realized in pnl:
        lvl = level_of(open_at)
        pnl_of_level[lvl] += Fraction(cash)
        if lvl > 0 and cash != 0 and open_at is not None:
            first_open_of_level[lvl] = min(first_open_of_level.get(lvl, open_at), open_at)
    growth = Fraction(1)
    for lvl, made in enumerate(pnl_of_level):
        if made == 0:
            continue
        if lvl == 0:
            base = Fraction(prev)
        else:
            t = first_open_of_level[lvl]
            base = (
                Fraction(prev)
                + sum((amount for at, amount in live if at <= t), Fraction(0))
                + sum(
                    (
                        Fraction(cash)
                        for open_at, cash, _realized in pnl
                        if level_of(open_at) < lvl
                    ),
                    Fraction(0),
                )
            )
        growth *= 1 + made / base
    return growth - 1


def _two_day_timed(
    prev: float,
    flows: list[tuple[int, float]],
    pnl: list[tuple[int | None, float, int]],
    floors=USD_FLOORS,
) -> tuple[pd.Series, dict]:
    """Day 0 is flat at ``prev`` (a flat day: return 0.0); day 1 is the timed day with a
    NAV that reproduces its own flows and P&L, so it passes the record's consistency check."""
    flow_sum = sum(a for _, a in flows)
    pnl_sum = sum(entry[1] for entry in pnl)
    idx = _days(2)
    nav = pd.Series([prev, prev + flow_sum + pnl_sum], index=idx, name="nav")
    daily = pd.Series([0.0, pnl_sum], index=idx, name="daily_pnl")
    day1 = idx[1]
    flows_by_day = pd.Series([0.0, flow_sum], index=idx, name="flows")
    timing = {day1: DayTiming(flows=tuple(flows), pnl=tuple(pnl))}
    return chain_linked_twr(nav, daily, flows_by_day, floors=floors, timing=timing)


def test_timed_deposit_before_open_is_measured_end_to_end() -> None:
    """The tracer. NAV_0 0.1 BTC, a 1.0 deposit at instant 1000, one trade opened at 2000
    with cash +0.011. Hand arithmetic: the trade traded on 0.1 + 1.0 = 1.1, so the day is
    0.011 / 1.1 = 0.01. The end-of-day formula measured (1.111 - 0.1 - 1.0) / 0.1 = 0.11,
    eleven times too large. The surrounding days keep today's value."""
    day1 = pd.Timestamp("2026-01-02")
    pnl = _pnl([0.01, 0.011, 0.005])
    returns, meta = reconstruct_nav_and_twr(
        pnl,
        anchor_nav=1.116,
        external_flows=[("2026-01-02", 1.0)],
        floors=_BTC_FLOORS,
        timing={day1: DayTiming(flows=((1000, 1.0),), pnl=((2000, 0.011, 3000),))},
    )
    assert returns.loc[day1] == pytest.approx(0.01, abs=1e-12)
    assert returns.loc[pd.Timestamp("2026-01-01")] == pytest.approx(0.01 / 0.09, abs=1e-12)
    assert returns.loc[pd.Timestamp("2026-01-03")] == pytest.approx(0.005 / 1.111, abs=1e-12)
    assert "dust_nav_guard" not in meta and "pnl_dominated_guard" not in meta


def test_timed_day_without_a_record_is_byte_identical_to_today() -> None:
    """SC-4: ``timing=None``, ``timing={}`` and a map holding only OTHER days all give the
    exact series and flags of a call that never heard of ``timing``."""
    pnl = _pnl([120.0, -80.0, 40.0, 15.0])
    flows = [("2026-01-03", 300.0)]
    base, base_meta = reconstruct_nav_and_twr(pnl, anchor_nav=10_000.0, external_flows=flows)
    for timing in (None, {}, {pd.Timestamp("2030-01-01"): DayTiming((), ())}):
        out, meta = reconstruct_nav_and_twr(
            pnl, anchor_nav=10_000.0, external_flows=flows, timing=timing
        )
        pd.testing.assert_series_equal(out, base, check_exact=True)
        assert meta == base_meta


def test_timed_flow_after_every_open_equals_the_end_of_day_formula() -> None:
    """D-02: a flow timestamped after every position opened leaves all P&L in cohort 0, so
    the timed day IS today's (cur - prev - F) / prev. prev 10000, P&L +150 + -30, then a
    withdrawal of -2500 at 9000: cohort 0 return is 120 / 10000 = 0.012."""
    returns, _ = _two_day_timed(
        10_000.0, [(9000, -2500.0)], [(1000, 150.0, 1500), (2000, -30.0, 2500)]
    )
    cur = 10_000.0 - 2500.0 + 120.0
    assert returns.iloc[1] == pytest.approx((cur - 10_000.0 - (-2500.0)) / 10_000.0, abs=1e-15)
    assert returns.iloc[1] == pytest.approx(0.012, abs=1e-15)


def test_timed_tie_flow_counts_before_the_open() -> None:
    """D-09: a flow and an open sharing instant 5000 - the deposit funds the trade, so the
    trade lands in the cohort AFTER the flow. 2000 + 1000 = 3000 base, P&L +60: 0.02. A
    ``bisect_left`` mutant puts the trade on 2000 and gives 0.03."""
    returns, _ = _two_day_timed(2000.0, [(5000, 1000.0)], [(5000, 60.0, 5500)])
    assert returns.iloc[1] == pytest.approx(60.0 / 3000.0, abs=1e-15)
    assert returns.iloc[1] != pytest.approx(60.0 / 2000.0, abs=1e-6)


def test_timed_overnight_open_lands_in_cohort_zero() -> None:
    """D-04: a P&L entry whose open instant is None (opened before the day) is on the
    start-of-day base even though a deposit came first in the day. prev 4000, deposit 4000
    at 100, overnight cash +200: 200 / 4000 = 0.05, not 200 / 8000."""
    returns, _ = _two_day_timed(4000.0, [(100, 4000.0)], [(None, 200.0, 50)])
    assert returns.iloc[1] == pytest.approx(0.05, abs=1e-15)


def test_timed_cohort_with_no_pnl_is_skipped_without_a_guard() -> None:
    """A cohort k >= 1 nothing opened on has no return and no guard, whatever its base. A
    withdrawal of -1500 at 5000 leaves a NEGATIVE base after it, but the only trade opened
    before it, so that base is never used: the day is 40 / 1000 and nothing is flagged."""
    returns, flags = _two_day_timed(1000.0, [(5000, -1500.0)], [(1000, 40.0, 1500)])
    assert returns.iloc[1] == pytest.approx(0.04, abs=1e-15)
    assert set(flags) <= set(NAV_TWR_ANNOTATION_KEYS)


def test_timed_withdrawal_between_two_opens_first_trade_still_open() -> None:
    """The second cohort's base is prev + the (negative) flow while the first trade is still
    open. prev 10000: a trade opened at 100 earns +500 (booked at 350, AFTER the second open),
    then 4000 is withdrawn at 200, then a trade opened at 300 earns +300. D-17 telescoping
    base: the second cohort's base is 10000 + 500 (the first cohort's FULL day P&L, realized
    or not) - 4000 = 6500, so the day is (1 + 0.05)(1 + 300/6500) - 1 = 0.0984615...
    D-16's realized-only base gave 6000 and 0.1025: the accepted D-17 cost, which bought
    continuity as the flow tends to 0."""
    returns, flags = _two_day_timed(
        10_000.0, [(200, -4000.0)], [(100, 500.0, 350), (300, 300.0, 400)]
    )
    assert returns.iloc[1] == pytest.approx(1.05 * (1.0 + 300.0 / 6500.0) - 1.0, abs=1e-15)
    assert set(flags) <= set(NAV_TWR_ANNOTATION_KEYS)


def test_timed_withdrawal_between_two_opens_first_trade_realized_before_second_open() -> None:
    """D-16/D-17 (supersede D-03's start-of-day-plus-flows base, which gave 1.05 x 1.05 - 1
    here). Same day, but the first trade's +500 was booked at 150, before the second trade
    opened at 300. The telescoping base never reads the booking instant, so this equals the
    still-open case above. The second trade opened on 10000 + 500 - 4000 = 6500, so it earns 300 / 6500 and the
    day is (1 + 0.05)(1 + 300/6500) - 1."""
    returns, flags = _two_day_timed(
        10_000.0, [(200, -4000.0)], [(100, 500.0, 150), (300, 300.0, 400)]
    )
    assert returns.iloc[1] == pytest.approx(1.05 * (1.0 + 300.0 / 6500.0) - 1.0, abs=1e-15)
    assert set(flags) <= set(NAV_TWR_ANNOTATION_KEYS)


def test_timed_earlier_cash_counts_in_the_base_whatever_instant_it_is_booked() -> None:
    """D-17: the telescoping base takes the earlier cohort's FULL day P&L, so the instant the
    cash is booked does not move the answer. prev 1000, +100 by cohort 0 (booked at 500, the
    very instant of the second open, or one tick later at 501), a deposit of 1000 at 400, the
    second trade opened at 500: base 1000 + 1000 + 100 = 2100 either way. D-16's
    realized-at-the-open tie gave 2100 for 500 and 2000 for 501."""
    expected = (1 + 100.0 / 1000.0) * (1 + 21.0 / 2100.0) - 1.0
    for booked in (500, 501):
        returns, _ = _two_day_timed(
            1000.0, [(400, 1000.0)], [(100, 100.0, booked), (500, 21.0, 600)]
        )
        assert returns.iloc[1] == pytest.approx(expected, abs=1e-15)


# D-16 invariants. They are stated from the founder's words and from first principles, not
# from the cohort formula: a flow of nothing changes nothing, and a flow of almost nothing
# changes the day by almost nothing. The reviewer's reproduction (round 1, WR-02): prev
# 10000, a trade opened at 900 earns +1000 (booked at 950), a flow F at 1000, a trade opened
# at 1100 earns +1000 (booked at 1200). Without any flow the account made 2000 on 10000.
_REPRO_PNL: list[tuple[int | None, float, int]] = [(900, 1000.0, 950), (1100, 1000.0, 1200)]


def _repro_return(flow: float | None) -> float:
    flows = [] if flow is None else [(1000, flow)]
    returns, flags = _two_day_timed(10_000.0, flows, list(_REPRO_PNL))
    assert set(flags) <= set(NAV_TWR_ANNOTATION_KEYS)
    return float(returns.iloc[1])


def test_timed_no_flow_day_is_the_plain_account_return() -> None:
    """The anchor of the invariants: no flow at all, 2000 earned on 10000 is exactly 20.0%."""
    assert _repro_return(None) == pytest.approx(0.2, abs=1e-15)


def test_timed_zero_amount_flow_is_a_no_op() -> None:
    """D-16 invariant 1. A flow record of exactly 0 (an MT5 balance deal with no amount) moves
    no capital, so it must leave the day exactly where the no-flow day is: 20.0%. On D-03's
    base it split the day and gave 21.0%."""
    assert _repro_return(0.0) == pytest.approx(_repro_return(None), abs=1e-15)
    assert _repro_return(0.0) == pytest.approx(0.2, abs=1e-15)
    assert _repro_return(-0.0) == pytest.approx(0.2, abs=1e-15)


def test_timed_zero_amount_flow_is_a_no_op_when_positions_overlap() -> None:
    """D-16 invariant 1 where it bites. Position A (open 900) is still open when B opens at
    1100 (A books at 1300), so nothing is realized before B's open: with a real flow B sits on
    a different base than A. A flow of exactly 0 must NOT make that split: the day is the plain
    2000 / 10000 = 20.0%, not 1.1 x 1.1 - 1 = 21.0%."""
    overlap = [(900, 1000.0, 1300), (1100, 1000.0, 1400)]
    plain, _ = _two_day_timed(10_000.0, [], overlap)
    zero, _ = _two_day_timed(10_000.0, [(1000, 0.0)], overlap)
    assert plain.iloc[1] == pytest.approx(0.2, abs=1e-15)
    assert zero.iloc[1] == pytest.approx(plain.iloc[1], abs=1e-15)


def test_timed_one_dollar_flow_is_about_the_no_flow_return() -> None:
    """D-16, the reviewer's reproduction. A $1 deposit between the two trades is 20.0% to
    within a hundredth of a basis point (exact: 1.1 x (1 + 1000/11001) - 1 = 0.19999091)."""
    assert _repro_return(1.0) == pytest.approx(0.2, abs=1e-5)
    assert _repro_return(1.0) == pytest.approx(1.1 * (1.0 + 1000.0 / 11_001.0) - 1.0, abs=1e-15)


@pytest.mark.parametrize("flow", [1000.0, 10.0, 1.0, 1e-3, 1e-6, -1.0, -1e-3, -1e-6])
def test_timed_return_is_continuous_as_the_flow_tends_to_zero(flow: float) -> None:
    """D-16 invariant 2. The day return moves by no more than 1e-5 per unit of flow (the
    true slope here is 9.1e-6: 1.1 x 1000 / 11000^2), so it tends to the no-flow 20.0% as F
    tends to 0, from either side. D-03's base jumped by 1% at every F."""
    got = _repro_return(flow)
    assert abs(got - 0.2) <= 1e-5 * abs(flow) + 1e-14


def test_timed_zero_flow_between_pnl_dominated_cohorts_does_not_split_the_guard() -> None:
    """A zero flow cannot change which base the D-06 guard judges: the whole 12.0 on 1.0 BTC
    is one cohort either way, so the pnl-dominated guard fires with or without it."""
    for flows in ([], [(1000, 0.0)]):
        returns, key_flags = _two_day_timed(
            1.0, flows, [(500, 6.0, 600), (2000, 6.0, 2500)], _BTC_FLOORS
        )
        assert np.isnan(returns.iloc[1])
        assert key_flags.get("pnl_dominated_guard") is True


def test_timed_overnight_close_after_a_flow_and_a_trade_is_continuous_in_the_flow() -> None:
    """R2-02, the review's hand case. prev 100000. An overnight position (open None) closes
    at 15:00 for +2000. A flow at 09:00. A trade opens at 10:00 and closes at 11:00 for +1000.
    With no flow the day is (2000 + 1000) / 100000 = 3.0000%. The literal D-16 base put the
    still-open overnight position's P&L outside the trade's base and read 3.0200% for a flow
    of a millionth of a dollar; the D-17 telescoping base reads 3.0000%."""
    hour = 3_600_000
    pnl: list[tuple[int | None, float, int]] = [
        (None, 2000.0, 15 * hour),
        (10 * hour, 1000.0, 11 * hour),
    ]
    plain, _ = _two_day_timed(100_000.0, [], list(pnl))
    tiny, _ = _two_day_timed(100_000.0, [(9 * hour, 1e-6)], list(pnl))
    assert plain.iloc[1] == pytest.approx(0.03, abs=1e-15)
    assert round(float(tiny.iloc[1]) * 100.0, 4) == 3.0
    assert tiny.iloc[1] == pytest.approx(plain.iloc[1], abs=1e-9)


def test_timed_return_tends_to_the_no_flow_return_for_any_shape_overlap_included() -> None:
    """D-17 required property, CONVENTION-FREE: no oracle and no base rule is restated here.
    Over seeded random timed days, including shapes where an earlier position is still open
    at a later open (an overnight position closing after a same-day open, D-04), the day
    return with a flow of eps must tend to the no-flow day, ``sum(P) / prev``, whatever the
    instants and the booking order. A literal "cash realized at the open" base fails this on
    overlap shapes by about ``P_earlier x P_later / prev^2``."""
    rng = random.Random(20261013)
    overlap_shapes = 0
    for _ in range(400):
        prev = rng.uniform(1.0, 10.0)
        pnl: list[tuple[int | None, float, int]] = []
        for _ in range(rng.randrange(1, 6)):
            open_at = None if rng.random() < 0.3 else rng.randrange(0, 21)
            # Booked anywhere from the open to well after later opens, so a position is
            # often still open when another one opens.
            realized = rng.randrange(0, 41) if open_at is None else open_at + rng.randrange(0, 31)
            pnl.append((open_at, rng.uniform(-0.05, 0.05), realized))
        total = sum(cash for _, cash, _ in pnl)
        # Overlap: a position opened (or carried) earlier is still unbooked at another open.
        opens = [o for o, _, _ in pnl if o is not None]
        if any(r > o2 for (o1, _, r) in pnl for o2 in opens if o1 is None or o1 < o2):
            overlap_shapes += 1
        eps = rng.choice([1e-9, -1e-9])
        flow_at = rng.randrange(0, 21)
        got, key = _timed_day_return(
            prev, DayTiming(flows=((flow_at, eps),), pnl=tuple(pnl)), _BTC_FLOORS, inception=False
        )
        assert key is None
        assert got == pytest.approx(total / prev, abs=1e-7)
    assert overlap_shapes > 100  # the sweep really holds still-open-at-a-later-open shapes


def test_timed_return_matches_the_fraction_oracle_on_random_shapes() -> None:
    """Seeded property test against ``_exact_cohort_return``: 400 random days with 0-4 flows
    and 0-5 trades over a small instant range (so ties between a flow and an open are
    common, and between a booking and an open), every cohort base positive and well above
    the BTC dust floor and no P&L large enough to trip the 10x guard. Float and exact results
    agree to 1e-12. D-17: a cohort's base includes the FULL day P&L of every earlier cohort."""
    rng = random.Random(20261011)
    cases = 0
    for _ in range(400):
        prev = rng.uniform(1.0, 10.0)
        base = prev
        flows: list[tuple[int, float]] = []
        for at in sorted(rng.randrange(0, 21) for _ in range(rng.randrange(0, 5))):
            amount = rng.uniform(-0.5 * base, 2.0 * base)
            flows.append((at, amount))
            base += amount
        pnl: list[tuple[int | None, float, int]] = []
        for _ in range(rng.randrange(0, 6)):
            open_at = None if rng.random() < 0.2 else rng.randrange(0, 21)
            # Booked at or after the open (ties common), anywhere in the day when overnight.
            realized = rng.randrange(0, 31) if open_at is None else open_at + rng.randrange(0, 11)
            pnl.append((open_at, rng.uniform(-0.05, 0.05), realized))
        timing = DayTiming(flows=tuple(flows), pnl=tuple(pnl))
        got, key = _timed_day_return(prev, timing, _BTC_FLOORS, inception=False)
        assert key is None
        assert got == pytest.approx(float(_exact_cohort_return(prev, flows, pnl)), abs=1e-12)
        cases += 1
    assert cases == 400


def test_timed_cohort_pnl_dominated_fires_on_the_cohorts_own_base() -> None:
    """D-06 per cohort. prev 1.0 BTC, a 100.0 deposit at 1000, a cohort-0 trade (open 500)
    earning +12.0 and a cohort-1 trade (open 2000) earning +1.0. Cohort 0 traded on 1.0 and
    12 >= 10 x 1.0, so the day is NaN with ``pnl_dominated_guard`` - although the whole
    day's P&L (13) is far below 10 x 101."""
    returns, flags = _two_day_timed(
        1.0, [(1000, 100.0)], [(500, 12.0, 600), (2000, 1.0, 2500)], _BTC_FLOORS
    )
    assert np.isnan(returns.iloc[1])
    assert flags.get("pnl_dominated_guard") is True
    assert returns.iloc[0] == 0.0


def test_timed_cohort_pnl_dominated_does_not_fire_on_the_base_d02_defines() -> None:
    """D-06 per cohort. prev 0.1 BTC, a 1.0 deposit at 1000, one trade opened at 2000
    earning +1.05. The trade traded on 1.1, so the day is 1.05 / 1.1 and nothing fires. The
    whole-day test against prev 0.1 (1.05 >= 10 x 0.1) would have dropped it."""
    returns, flags = _two_day_timed(0.1, [(1000, 1.0)], [(2000, 1.05, 2500)], _BTC_FLOORS)
    assert returns.iloc[1] == pytest.approx(1.05 / 1.1, abs=1e-12)
    assert "pnl_dominated_guard" not in flags


def test_timed_cohort_negative_base_is_guarded_not_clamped() -> None:
    """D-06 on a timed day. prev 1000.0, a withdrawal of -1500.0 at 1000 and a trade opened
    at 2000 earning +5.0: that trade's base is -500, a negative NAV. The day is NaN with
    ``negative_nav_guard`` - never clamped or substituted."""
    returns, flags = _two_day_timed(1000.0, [(1000, -1500.0)], [(2000, 5.0, 2500)])
    assert np.isnan(returns.iloc[1])
    assert flags.get("negative_nav_guard") is True


def test_timed_cohort_dust_base_is_guarded() -> None:
    """D-06 on a timed day. prev 1000.0, a withdrawal of -950.0 at 1000 leaves 50.0, strictly
    between 0 and the USD dust floor 100, and a trade opened after it earns +1.0: the day is
    NaN with ``dust_nav_guard``. 167.1.2 D-27 moved the floor from 1000 to 100; the old
    withdrawal of -900.0 left exactly 100.0, which the strict ``<`` now MEASURES."""
    returns, flags = _two_day_timed(1000.0, [(1000, -950.0)], [(2000, 1.0, 2500)])
    assert np.isnan(returns.iloc[1])
    assert flags.get("dust_nav_guard") is True


def test_timed_flow_only_day_keeps_a_zero_return() -> None:
    """A timed day with a flow and no trade: cohort 0 alone is measured, return 0.0."""
    returns, flags = _two_day_timed(5000.0, [(100, 2500.0)], [])
    assert returns.iloc[1] == 0.0
    assert set(flags) <= set(NAV_TWR_ANNOTATION_KEYS)


def test_timed_inception_cohort_zero_empty_measures_after_the_first_deposit() -> None:
    """D-12 at the helper. Cohort 0 holds no P&L and the base before the deposit is zero
    (or float residue of either sign): that empty cohort is not judged, and the trade
    opened after the deposit is P / (prev + F) = 0.011 / 1.0 with no flag."""
    for residue in (0.0, 1e-16, -1e-16):
        timing = DayTiming(flows=((1000, 1.0),), pnl=((2000, 0.011, 3000),))
        got, key = _timed_day_return(residue, timing, _BTC_FLOORS, inception=True)
        assert key is None
        assert got == pytest.approx(0.011, abs=1e-12)


def test_timed_inception_with_no_pnl_measures_nothing_and_flags_nothing() -> None:
    """D-12: a deposit-only first day has nothing to measure: NaN with no key."""
    timing = DayTiming(flows=((1000, 1.0),), pnl=())
    got, key = _timed_day_return(0.0, timing, _BTC_FLOORS, inception=True)
    assert math.isnan(got) and key is None


def test_timed_inception_pnl_before_the_first_deposit_keeps_the_guard() -> None:
    """A P&L entry on a zero base BEFORE the first deposit is not inception noise: cohort 0
    is judged and the negative (exactly 0) / dust (positive residue) guard fires as today."""
    timing = DayTiming(flows=((1000, 1.0),), pnl=((500, 0.001, 600),))
    got, key = _timed_day_return(0.0, timing, _BTC_FLOORS, inception=True)
    assert math.isnan(got) and key == "negative_nav_guard"
    got2, key2 = _timed_day_return(1e-16, timing, _BTC_FLOORS, inception=True)
    assert math.isnan(got2) and key2 == "dust_nav_guard"


def test_timed_small_base_is_counted_from_the_smallest_measured_cohort() -> None:
    """D-25 on a timed day. A cohort base under the 1e-4 material equity that was measured is
    counted as ``small_base_measured`` with that base as the minimum. D-16 re-pin: the first
    trade's +1e-5 is booked at 600, before the second trade opens at 2000, so the second
    cohort's base is 1e-4 - 5e-5 + 1e-5 = 6e-5 (it was 5e-5 on D-03's flows-only base)."""
    returns, flags = _two_day_timed(
        1e-4, [(1000, -5e-5)], [(500, 1e-5, 600), (2000, 1e-6, 2500)], _BTC_FLOORS
    )
    assert returns.iloc[1] == pytest.approx((1 + 1e-5 / 1e-4) * (1 + 1e-6 / 6e-5) - 1, abs=1e-12)
    assert flags["small_base_measured"] is True
    assert flags["small_base_measured_days"] == 1
    assert flags["small_base_measured_min_nav"] == pytest.approx(6e-5, abs=1e-18)


def test_timed_record_must_reproduce_the_days_nav_change() -> None:
    """The trust boundary: a record whose flows and P&L do not add up to the NAV series' own
    change for that day would measure a different day than the levels hold. Fail loud."""
    idx = _days(2)
    nav = pd.Series([5000.0, 5600.0], index=idx)
    daily = pd.Series([0.0, 600.0], index=idx)
    flows = pd.Series([0.0, 0.0], index=idx)
    short = {idx[1]: DayTiming(flows=(), pnl=((100, 100.0, 200),))}
    with pytest.raises(NavReconstructionError):
        chain_linked_twr(nav, daily, flows, timing=short)
    ok = {idx[1]: DayTiming(flows=(), pnl=((100, 600.0, 200),))}
    returns, _ = chain_linked_twr(nav, daily, flows, timing=ok)
    assert returns.iloc[1] == pytest.approx(0.12, abs=1e-15)


def test_timed_record_flows_must_be_ascending_integers() -> None:
    idx = _days(2)
    nav = pd.Series([5000.0, 5000.0], index=idx)
    daily = pd.Series([0.0, 0.0], index=idx)
    flows = pd.Series([0.0, 0.0], index=idx)
    for bad in (
        DayTiming(flows=((200, 1.0), (100, -1.0)), pnl=()),
        DayTiming(flows=((1.5, 0.0),), pnl=()),  # type: ignore[arg-type]
        DayTiming(flows=(), pnl=((100.5, 0.0, 200),)),  # type: ignore[arg-type]
        DayTiming(flows=(), pnl=((100, 0.0, 200.5),)),  # type: ignore[arg-type]
        DayTiming(flows=(), pnl=((None, 0.0, None),)),  # type: ignore[arg-type]
        DayTiming(flows=(), pnl=((300, 0.0, 200),)),  # cash booked before its position opened
    ):
        with pytest.raises(NavReconstructionError):
            chain_linked_twr(nav, daily, flows, timing={idx[1]: bad})


# ---------------------------------------------------------------------------
# 164.6.6.2.3 D-05: a flow, however large, never drops a day's return.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("flow_multiple", [1.0, 10.0, 1000.0, -0.9])
def test_large_flow_never_drops_a_day_or_sets_the_retired_flag(flow_multiple: float) -> None:
    """D-05. Day 1 earns +50 on a 5000 base while a flow of ``flow_multiple`` x the base
    moves in (or out, for -0.9): the day is 50 / 5000 = 0.01 whatever the flow, with no
    guard and no retired flag. Hand arithmetic, independent of the code: the return is the
    P&L over the opening NAV, the flow only moves the closing NAV."""
    flow = flow_multiple * 5000.0
    nav = pd.Series([5000.0, 5000.0 + 50.0 + flow], index=_days(2), name="nav")
    daily = pd.Series([0.0, 50.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([0.0, flow], index=_days(2), name="flows")
    returns, flags = chain_linked_twr(nav, daily, flows)
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-15)
    assert "flow_dominated_guard" not in flags
    assert not (set(flags) & set(NAV_TWR_GUARD_KEYS))


# ---------------------------------------------------------------------------
# 164.6.6.2.3 D-01/D-12: day 0 of a full-history account is its inception.
# ---------------------------------------------------------------------------


def _inception_chain(residue: float, *, full_history: bool, flow0: float = 5000.0):
    """Day 0 deposits ``flow0`` onto a pre-inception base of ``residue`` (zero within float
    noise), day 1 earns +50. ``prev0`` injects the day-0 base exactly."""
    nav = pd.Series([residue + flow0, residue + flow0 + 50.0], index=_days(2), name="nav")
    daily = pd.Series([0.0, 50.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([flow0, 0.0], index=_days(2), name="flows")
    return chain_linked_twr(
        nav, daily, flows, prev0=residue, full_history=full_history
    )


@pytest.mark.parametrize("residue", [0.0, 1e-16, -1e-16])
def test_inception_day_zero_residue_raises_no_flag_without_timing(residue: float) -> None:
    """D-01/D-12: with ``full_history`` day 0 (a positive deposit on a base that is zero
    within the unit's tolerance, whatever the residue's sign) has no return and NO flag.
    Day 1 is a normal measured day: 50 / 5000."""
    returns, flags = _inception_chain(residue, full_history=True)
    assert np.isnan(returns.iloc[0])
    assert not (set(flags) & set(NAV_TWR_GUARD_KEYS))
    assert "flow_timing_day_level" not in flags  # the inception day is not a day-level flow day
    assert returns.iloc[1] == pytest.approx(50.0 / (residue + 5000.0 + 0.0), abs=1e-12)


@pytest.mark.parametrize(
    ("residue", "label"),
    [(0.0, "negative_nav_guard"), (1e-16, "dust_nav_guard"), (-1e-16, "negative_nav_guard")],
)
def test_inception_rule_is_opt_in_default_keeps_todays_labels(residue: float, label: str) -> None:
    """D-01: ``full_history`` defaults to False and then day 0 keeps EXACTLY today's guard
    label for the same residue (retention-windowed venues have real capital on day 0)."""
    returns, flags = _inception_chain(residue, full_history=False)
    assert np.isnan(returns.iloc[0])
    assert flags[label] is True


def test_inception_real_negative_day_zero_base_keeps_its_guard() -> None:
    """T-164.6.6.2.3-03: -5.00 USD is not float noise (the tolerance is 1.00): the rule must
    not hide a real broken base even on a full-history account."""
    returns, flags = _inception_chain(-5.0, full_history=True)
    assert np.isnan(returns.iloc[0])
    assert flags["negative_nav_guard"] is True


def test_inception_needs_a_positive_day_zero_flow() -> None:
    """The predicate requires the day's own flow to be positive: a day 0 with no deposit and
    a zero base is not an inception, it is an empty account and keeps its guard."""
    nav = pd.Series([0.0, 50.0], index=_days(2), name="nav")
    daily = pd.Series([0.0, 50.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([0.0, 0.0], index=_days(2), name="flows")
    _, flags = chain_linked_twr(nav, daily, flows, prev0=0.0, full_history=True)
    assert flags["negative_nav_guard"] is True


def test_inception_is_day_zero_only_an_interior_near_zero_base_keeps_its_guard() -> None:
    """Pitfall 5: an interior base of 0.50 USD (a real emptied account) is dust-guarded with
    ``full_history`` on; relaxing day 0 must never relax the interior."""
    nav = pd.Series([5000.0, 0.5, 100.0], index=_days(3), name="nav")
    daily = pd.Series([0.0, -4999.5, 99.5], index=_days(3), name="daily_pnl")
    flows = pd.Series([0.0, 0.0, 0.0], index=_days(3), name="flows")
    returns, flags = chain_linked_twr(nav, daily, flows, full_history=True)
    assert np.isnan(returns.iloc[2])
    assert flags["dust_nav_guard"] is True


@pytest.mark.parametrize("residue", [1.06, -1.06, 4.5])
def test_inception_certified_widens_only_the_tolerance_the_gate_already_applied(
    residue: float,
) -> None:
    """WR-03. ``inception_certified`` hands the caller's own gate verdict to the day-0
    predicate. Without it a $1.06 residue is outside the $1 tolerance and keeps its guard
    (default byte-identical); with it, and ONLY with ``full_history`` and a positive day-0
    flow, day 0 is the inception day. Interior bases are untouched."""
    nav = pd.Series([residue + 5000.0, residue + 5050.0], index=_days(2), name="nav")
    daily = pd.Series([0.0, 50.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([5000.0, 0.0], index=_days(2), name="flows")
    label = "dust_nav_guard" if residue > 0 else "negative_nav_guard"

    _, plain = chain_linked_twr(nav, daily, flows, prev0=residue, full_history=True)
    assert plain[label] is True  # today's behaviour, unchanged

    returns, flags = chain_linked_twr(
        nav, daily, flows, prev0=residue, full_history=True, inception_certified=True
    )
    assert np.isnan(returns.iloc[0]) and not (set(flags) & set(NAV_TWR_GUARD_KEYS))
    assert returns.iloc[1] == pytest.approx(50.0 / (residue + 5000.0), abs=1e-12)

    # Not full history: the certificate alone changes nothing.
    _, no_history = chain_linked_twr(nav, daily, flows, prev0=residue, inception_certified=True)
    assert no_history[label] is True
    # No day-0 deposit: not an inception, whatever the certificate says.
    no_dep = pd.Series([0.0, 0.0], index=_days(2), name="flows")
    _, no_flow = chain_linked_twr(
        nav, daily, no_dep, prev0=residue, full_history=True, inception_certified=True
    )
    assert no_flow[label] is True
    # An interior near-zero base keeps its guard.
    mid = pd.Series([5000.0, 0.5, 100.0], index=_days(3), name="nav")
    mid_pnl = pd.Series([0.0, -4999.5, 99.5], index=_days(3), name="daily_pnl")
    mid_flows = pd.Series([0.0, 0.0, 0.0], index=_days(3), name="flows")
    mid_returns, mid_flags = chain_linked_twr(
        mid, mid_pnl, mid_flows, full_history=True, inception_certified=True
    )
    assert np.isnan(mid_returns.iloc[2]) and mid_flags["dust_nav_guard"] is True


def test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit() -> None:
    """D-12. A 1.0 BTC deposit at instant 1000 on day 0 and a trade opened at 2000 earning
    +0.011: the trade traded on the deposit, so day 0 is 0.011 / 1.0 with no flag. Without
    ``full_history`` the same record is judged on a base of (about) zero and keeps its
    guard - the rule is opt-in."""
    day0 = pd.Timestamp("2026-01-01")
    timing = {day0: DayTiming(flows=((1000, 1.0),), pnl=((2000, 0.011, 3000),))}
    kwargs = dict(
        anchor_nav=1.013,
        external_flows=[("2026-01-01", 1.0)],
        floors=_BTC_FLOORS,
        timing=timing,
    )
    returns, meta = reconstruct_nav_and_twr(_pnl([0.011, 0.002]), full_history=True, **kwargs)
    assert returns.loc[day0] == pytest.approx(0.011, abs=1e-9)
    assert returns.iloc[1] == pytest.approx(0.002 / 1.011, abs=1e-12)
    assert not (set(meta) & set(NAV_TWR_GUARD_KEYS))
    assert meta["flow_timing_timed_days"] == 1
    assert meta["computation_status_hint"] == "complete"

    off, off_meta = reconstruct_nav_and_twr(_pnl([0.011, 0.002]), **kwargs)
    assert np.isnan(off.loc[day0])
    assert "dust_nav_guard" in off_meta or "negative_nav_guard" in off_meta


def test_inception_through_reconstruct_without_timing_is_nan_and_complete() -> None:
    """D-12 end to end: no timestamps, so day 0 is the inception day: no return and no
    warning, the status stays ``complete`` and day 1 is measured."""
    returns, meta = reconstruct_nav_and_twr(
        _pnl([0.0, 50.0]),
        anchor_nav=5050.0,
        external_flows=[("2026-01-01", 5000.0)],
        full_history=True,
    )
    assert np.isnan(returns.iloc[0])
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)
    assert meta["computation_status_hint"] == "complete"
    assert not (set(meta) & set(NAV_TWR_GUARD_KEYS))


# ---------------------------------------------------------------------------
# 164.6.6.2.3 D-07: the day-level fallback is named as an annotation, never a warning.
# ---------------------------------------------------------------------------


def test_flow_timing_day_level_flow_day_is_an_annotation_not_a_warning() -> None:
    """D-07. The tracer's day measured WITHOUT a record keeps today's end-of-day arithmetic
    - (1.111 - 0.1 - 1.0) / 0.1 = 0.11, eleven times the timed 0.01 - and says so:
    ``flow_timing_day_level`` for one day, status still ``complete``."""
    returns, meta = reconstruct_nav_and_twr(
        _pnl([0.01, 0.011, 0.005]),
        anchor_nav=1.116,
        external_flows=[("2026-01-02", 1.0)],
        floors=_BTC_FLOORS,
    )
    assert returns.loc[pd.Timestamp("2026-01-02")] == pytest.approx(0.11, abs=1e-12)
    assert meta["flow_timing_day_level"] is True
    assert meta["flow_timing_day_level_days"] == 1
    assert "flow_timing_timed_days" not in meta
    assert meta["computation_status_hint"] == "complete"


def test_flow_timing_day_level_beside_a_real_warning_still_warns() -> None:
    """The annotation never masks a real warning: with a dust day beside it the status is
    ``complete_with_warnings`` because of the dust guard alone. 167.1.2 D-27: the USD floor is
    100, so the dust day sits on a prior NAV of 45 (it was 495 under the old 1000 floor) while
    the flow day (prior NAV 345) stays a measured day."""
    _, meta = reconstruct_nav_and_twr(
        _pnl([0.0, -4950.0, 300.0, 10.0]),
        anchor_nav=360.0,
        external_flows=[("2026-01-04", 5.0)],
    )
    assert meta["dust_nav_guard"] is True
    assert meta["flow_timing_day_level"] is True
    assert meta["computation_status_hint"] == "complete_with_warnings"


def test_flow_timing_day_level_is_not_set_for_flowless_or_timed_days() -> None:
    """A flow-less series and a series whose only flow day is timed carry no day-level
    annotation; the timed one counts its day in the in-process ``flow_timing_timed_days``."""
    _, flowless = reconstruct_nav_and_twr(_pnl([100.0, 50.0, -25.0]), anchor_nav=5000.0)
    assert "flow_timing_day_level" not in flowless
    assert "flow_timing_timed_days" not in flowless

    day1 = pd.Timestamp("2026-01-02")
    _, timed = reconstruct_nav_and_twr(
        _pnl([0.01, 0.011, 0.005]),
        anchor_nav=1.116,
        external_flows=[("2026-01-02", 1.0)],
        floors=_BTC_FLOORS,
        timing={day1: DayTiming(flows=((1000, 1.0),), pnl=((2000, 0.011, 3000),))},
    )
    assert "flow_timing_day_level" not in timed
    assert timed["flow_timing_timed_days"] == 1


# ---------------------------------------------------------------------------
# 164.6.6.2.3 D-15 (silent-failure hunt F1): a measured day-level flow day whose flow is at
# least the prior NAV is kept and COUNTED, because the end-of-day formula can read it as an
# extreme return. An annotation: no drop, no chain break, no status change.
# ---------------------------------------------------------------------------


def test_f1_large_day_level_flow_day_is_kept_and_counted() -> None:
    """The hunt's reproduction. Prior NAV 150, a 50,000 deposit, and 500 earned that day: the
    end-of-day formula reads (50,650 - 150 - 50,000) / 150 = +333%. The day is KEPT exactly
    as computed (no guard, no chain break, the status stays ``complete``) and the flags carry
    ``flow_timing_day_level_large`` so the factsheet can say the return can be extreme.
    The prior NAV sits above the 100 USD dust floor so the day is measured."""
    nav = pd.Series([150.0, 150.0 + 500.0 + 50_000.0], index=_days(2), name="nav")
    daily = pd.Series([0.0, 500.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([0.0, 50_000.0], index=_days(2), name="flows")
    returns, flags = chain_linked_twr(nav, daily, flows)
    assert returns.iloc[1] == pytest.approx(500.0 / 150.0, abs=1e-12)  # kept: +333%
    assert flags["flow_timing_day_level"] is True
    assert flags["flow_timing_day_level_large"] is True
    assert flags["flow_timing_day_level_large_days"] == 1
    assert not (set(flags) & set(NAV_TWR_GUARD_KEYS))
    meta = _build_nav_meta(flags)
    assert meta["computation_status_hint"] == "complete"
    assert meta["flow_timing_day_level_large"] is True


@pytest.mark.parametrize(
    ("flow", "large"),
    [
        (1000.0, True),    # |F| == prior NAV: the retired condition was ">=", so it counts
        (-1000.0, True),   # a withdrawal of the whole prior NAV counts by magnitude
        (5000.0, True),
        (999.99, False),   # just under the prior NAV
        (-999.99, False),
        (50.0, False),     # an ordinary flow
        (0.0, False),      # no flow at all
    ],
)
def test_f1_large_flow_boundary_is_the_retired_dominance_condition(
    flow: float, large: bool
) -> None:
    """The threshold is ``|F| >= 1.0 x prior NAV`` exactly, in both signs. Prior NAV 1000, the
    day earns +10 (so the closing NAV is 1010 + flow; a withdrawal of 1000 leaves 10, which is
    still a measured day because only the PRIOR NAV is judged by the guards)."""
    nav = pd.Series([1000.0, 1000.0 + 10.0 + flow], index=_days(2), name="nav")
    daily = pd.Series([0.0, 10.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([0.0, flow], index=_days(2), name="flows")
    returns, flags = chain_linked_twr(nav, daily, flows)
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)  # always measured
    assert ("flow_timing_day_level_large" in flags) is large
    if large:
        assert flags["flow_timing_day_level_large_days"] == 1


def test_f1_large_flow_is_counted_only_on_measured_day_level_days() -> None:
    """Not on a day a guard dropped (nothing inflated was published), not on an inception day,
    and not on a day measured on a ``DayTiming`` (each position there sits on its own
    capital, so a large deposit cannot inflate it)."""
    # A dust prior NAV (50 < 100): the day is dropped by the dust guard, so it is not counted.
    nav = pd.Series([50.0, 50.0 + 5.0 + 9000.0], index=_days(2), name="nav")
    daily = pd.Series([0.0, 5.0], index=_days(2), name="daily_pnl")
    flows = pd.Series([0.0, 9000.0], index=_days(2), name="flows")
    returns, flags = chain_linked_twr(nav, daily, flows)
    assert np.isnan(returns.iloc[1]) and flags["dust_nav_guard"] is True
    assert "flow_timing_day_level_large" not in flags

    # The inception day (full history, a deposit onto a zero base) is not a large-flow day.
    _, inception = _inception_chain(0.0, full_history=True, flow0=5000.0)
    assert "flow_timing_day_level_large" not in inception

    # A timed day carrying a deposit far above the prior NAV: measured on its cohorts.
    returns2, timed = _two_day_timed(1000.0, [(1000, 90_000.0)], [(2000, 910.0, 2500)])
    assert returns2.iloc[1] == pytest.approx(910.0 / 91_000.0, abs=1e-12)
    assert "flow_timing_day_level_large" not in timed


def test_f1_large_flow_annotation_is_registered_as_an_annotation_not_a_guard() -> None:
    """Design pin, same contract as ``small_base_measured``: informational, so NOT a
    ``NAV_TWR_GUARD_KEYS`` member (that would promote every consumer to
    ``complete_with_warnings``); declared on ``NavTWRMeta``; present-only; a real warning
    beside it still warns."""
    for key in ("flow_timing_day_level_large", "flow_timing_day_level_large_days"):
        assert key in NAV_TWR_ANNOTATION_KEYS
        assert key not in NAV_TWR_GUARD_KEYS
        assert key in nav_twr_mod.NavTWRMeta.__annotations__
    only = _build_nav_meta(
        {"flow_timing_day_level": True, "flow_timing_day_level_large": True,
         "flow_timing_day_level_large_days": 2}
    )
    assert only["computation_status_hint"] == "complete"
    assert only["flow_timing_day_level_large"] is True
    assert only["flow_timing_day_level_large_days"] == 2
    both = _build_nav_meta({"flow_timing_day_level_large": True, "dust_nav_guard": True})
    assert both["computation_status_hint"] == "complete_with_warnings"
    assert "flow_timing_day_level_large" not in _build_nav_meta({})


def test_flow_timing_annotations_are_registered_as_annotations_not_guards() -> None:
    """D-07 design pin: informational, so NOT a ``NAV_TWR_GUARD_KEYS`` member (that would
    promote every consumer to ``complete_with_warnings``); declared on ``NavTWRMeta``; and
    ``_build_nav_meta`` promotes on a REAL warning beside them only."""
    keys = ("flow_timing_day_level", "flow_timing_day_level_days", "flow_timing_timed_days")
    for key in keys:
        assert key in NAV_TWR_ANNOTATION_KEYS
        assert key not in NAV_TWR_GUARD_KEYS
        assert key in nav_twr_mod.NavTWRMeta.__annotations__
    only = _build_nav_meta(
        {"flow_timing_day_level": True, "flow_timing_day_level_days": 2,
         "flow_timing_timed_days": 3}
    )
    assert only["computation_status_hint"] == "complete"
    assert only["flow_timing_day_level"] is True
    assert only["flow_timing_day_level_days"] == 2
    assert only["flow_timing_timed_days"] == 3
    both = _build_nav_meta({"flow_timing_day_level": True, "dust_nav_guard": True})
    assert both["computation_status_hint"] == "complete_with_warnings"
    assert "flow_timing_day_level" not in _build_nav_meta({})


# ---------------------------------------------------------------------------
# 164.6.6.2.3 plan 07 (D-11): the ccxt full-history verdict IS the existing DQ-02 coverage
# terminus, read on the account's P&L history.
# ---------------------------------------------------------------------------

_INCEPTION_NOW = pd.Timestamp("2026-07-06")


@pytest.mark.parametrize(
    ("venue", "days_before_now", "expected"),
    [
        # Binance has no known deposit-history cap: full history whatever the age.
        ("binance", 5, True),
        ("binance", 1000, True),
        # OKX (90-day floor): inside, outside, and BOTH sides of the floor day itself.
        ("okx", 30, True),
        ("okx", 120, False),
        ("okx", 90, True),   # exactly at the floor: on or after it is covered
        ("okx", 91, False),  # one day before the floor: not covered
        # Bybit (365-day floor): the pure rule; the fetch window makes 400 unreachable in
        # production (job_worker states it), but the rule itself must still say False.
        ("bybit", 300, True),
        ("bybit", 400, False),
        ("bybit", 365, True),
        ("bybit", 366, False),
    ],
)
def test_ccxt_history_reaches_inception_follows_the_retention_floor(
    venue: str, days_before_now: int, expected: bool
) -> None:
    """D-11: "a capped venue whose first deposit is newer than the cap, through the existing
    flow_retention_floor". The helper answers ``flow_coverage_terminus_day(...) is None`` on
    every case: a second retention definition could drift from the DQ-02 one, and this
    equality is what fails when it does."""
    first_day = _INCEPTION_NOW - pd.Timedelta(days=days_before_now)
    got = ccxt_history_reaches_inception(venue, first_day, _INCEPTION_NOW)
    assert got is expected
    assert got == (
        flow_coverage_terminus_day(
            venue, first_return_day=first_day, now_utc=_INCEPTION_NOW
        )
        is None
    )


def test_ccxt_history_reaches_inception_unknown_venue_has_no_cap() -> None:
    """A venue absent from ``FLOW_TERMINUS_DAYS_BY_VENUE`` has no known cap, exactly as
    ``flow_retention_floor`` treats it, so the verdict is True (the core predicate still
    decides whether day 0 is an inception)."""
    assert ccxt_history_reaches_inception(
        "somevenue", _INCEPTION_NOW - pd.Timedelta(days=2000), _INCEPTION_NOW
    ) is True
