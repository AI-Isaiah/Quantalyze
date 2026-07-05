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

from services.nav_twr import (
    DUST_NAV_FLOOR,
    NavReconstructionError,
    _flows_to_daily_usd,
    chain_linked_twr,
    cumulative_twr,
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


def test_reconstruct_nav_rejects_orphan_flow_day() -> None:
    """A flow dated on a day absent from the pnl window fails loud rather than
    being silently lost (never lose realized cash)."""
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

    # Prove the divergence: transforms.py fabricates a number (substitutes the
    # balance as the base) for the SAME input; the new core refuses.
    from services.transforms import trades_to_daily_returns_with_status

    trades = [
        {
            "timestamp": "2026-01-01T00:00:00+00:00",
            "order_type": "daily_pnl",
            "side": "buy",
            "price": 2000.0,
        }
    ]
    old_returns, _ = trades_to_daily_returns_with_status(
        trades, account_balance=1500.0
    )
    # substituted base = 1500 -> fabricated r_0 = 2000/1500 = +133%
    assert old_returns.iloc[0] == pytest.approx(2000.0 / 1500.0)
    assert np.isnan(ret_neg.iloc[0])  # honest core -> flagged, not fabricated


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
