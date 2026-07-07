"""Revert-proof correctness tests for services.nav_twr (Phase 73 pure core).

Phase 73 builds the honest replacement for the silent anchor-to-today base
substitution that lives in ``transforms.trades_to_daily_returns_with_status``
(``estimated_start <= 0 -> account_balance`` at L154-159 and the forbidden
``prev_equity.replace(0, initial_capital)`` at L175). The new core:

  * reconstructs a per-day NAV series BACKWARD from the real exchange anchor
    (``NAV_{t-1} = NAV_t - pnl_t - F_t``) — pinned to an independent numpy
    oracle and revert-proof (a sign/term mutation turns the oracle test RED);
  * chain-links a true time-weighted daily return with the flow in the
    NUMERATOR (end-of-day convention) — cross-checked against the already
    shipped ``portfolio_metrics.compute_twr`` scalar;
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
    NavReconstructionError,
    _flows_to_daily_usd,
    apply_flow_coverage_terminus,
    chain_linked_twr,
    cumulative_twr,
    flow_coverage_terminus_day,
    reconcile_flow_residual,
    reconstruct_nav,
    reconstruct_nav_and_twr,
)
from services.portfolio_metrics import compute_twr


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
    assert cumulative_twr(ret3) == pytest.approx(exp_cum, rel=1e-12)


def test_twr_agrees_with_compute_twr() -> None:
    """On a shared synthetic fixture the nav_twr per-day chain-linked cumulative
    agrees with the already-shipped forward scalar ``portfolio_metrics.compute_twr``
    (same end-of-day flow numerator convention) to fp tolerance."""
    # Equity (end-of-day) [1000, 1100, 1050, 1200] with a +100 deposit on
    # 2026-01-03. Day 0 has zero pnl/flow so nav_twr's day-0 return is 0 and both
    # methods start from the same base.
    daily_pnl = _pnl([0.0, 100.0, -150.0, 150.0])  # 2026-01-01..04
    returns, meta = reconstruct_nav_and_twr(
        daily_pnl,
        anchor_nav=1200.0,
        external_flows=[("2026-01-03", 100.0)],
    )
    nav_twr_cum = cumulative_twr(returns)

    equity = pd.Series(
        [1000.0, 1100.0, 1050.0, 1200.0], index=_days(4, "2026-01-01")
    )
    events = [
        {"event_date": "2026-01-03", "event_type": "deposit", "amount": 100.0}
    ]
    scalar = compute_twr(equity, events)

    assert scalar is not None
    assert nav_twr_cum == pytest.approx(scalar, rel=1e-12)
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
    assert np.isnan(cumulative_twr(ret_neg))


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
    assert cumulative_twr(segmented) == pytest.approx(
        (1.01 * 0.99 * 1.02) - 1.0, rel=1e-9
    )


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
    assert cumulative_twr(segmented) != pytest.approx(cumulative_twr(returns))
    assert cumulative_twr(segmented) == pytest.approx(
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
    # The six v1.8 warn flags are all present (regression pin on the closed set).
    assert set(NAV_TWR_GUARD_KEYS) == {
        "dust_nav_guard",
        "negative_nav_guard",
        "flow_dominated_guard",
        "flow_coverage_incomplete",
        "unrealized_pnl_in_anchor",
        "unrealized_pnl_unreadable",
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

    # cumulative_twr excludes ONLY the dominated day: it equals the product over
    # the six finite returns, not the seven-day product (a NaN is skipped, never
    # coerced to 0.0 which would silently zero-out that day's compounding).
    finite = ret.dropna()
    assert len(finite) == 6
    expected_cum = float(np.prod(1.0 + finite.to_numpy(dtype=float)) - 1.0)
    assert cumulative_twr(ret) == pytest.approx(expected_cum)
