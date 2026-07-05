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
    reconstruct_nav,
)


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
