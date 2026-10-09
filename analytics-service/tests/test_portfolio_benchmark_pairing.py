"""Phase 166.4.1 (D-02, D-04, D-05, D-06): the portfolio's BTC comparison.

Before this phase ``_compute_portfolio_analytics`` paired the portfolio with BTC by
an inner join of the two date indexes. A weekday-only portfolio therefore lost
BTC's weekend moves (the BTC TWR read 0.0 against a benchmark that moved every
weekend) and its correlation compared a one-day portfolio return with a one-day
BTC return that did not cover the same holding interval. 166.4 BENCHALIGN built
the ONE interval pair for every strategy-level metric
(``services.metrics._benchmark_pair``); D-02 makes the portfolio use it too.

D-04 / D-05 / R-02: a stale benchmark, a thin overlap and a benchmark crash each
used to leave ``benchmark_comparison`` null with no named reason. They now write a
flagged-empty comparison whose ``note`` is a FIXED sentence (never ``str(exc)``:
HONEST-01 / D-162-4), mirrored into ``data_quality``.

D-06: the final ``portfolio_analytics`` update that matches no row raises.

Every oracle below is a price ratio or a literal. None calls the helper under
test, so a test cannot agree with the code by construction.
"""

from __future__ import annotations

import ast
import asyncio
import json
import pathlib
import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException

from routers import portfolio as portfolio_mod
from tests._curve_fixtures import curve_from_returns  # noqa: F401  (fixture vocabulary)
from tests.test_correlation_residue_sites import _c6_supabase
from tests.test_portfolio_compute_integration import (
    _curve_records,
    _make_supabase_for_compute,
    _ps_rows,
)

_ROUTER_PATH = pathlib.Path(portfolio_mod.__file__)


def _run_with_btc(strat: pd.Series, btc: pd.Series, *, stale: bool = False) -> dict:
    """Drive the real router for a one-strategy portfolio against ``btc``.

    Returns the LAST ``portfolio_analytics`` update payload (the persisted row).
    Same driver as ``_c6_correlation``: a fresh ``Semaphore(3)`` scoped to the call,
    the router module pinned in ``sys.modules`` and restored on exit.
    """
    sb, pa = _c6_supabase(strat)

    async def _btc(symbol: str) -> tuple[pd.Series, bool]:
        return btc, stale

    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(portfolio_mod, "_compute_semaphore", asyncio.Semaphore(3))
            with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
                 patch.object(portfolio_mod, "get_benchmark_returns", side_effect=_btc):
                asyncio.run(portfolio_mod._compute_portfolio_analytics("portfolio-1"))
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior
    return pa.update.call_args_list[-1][0][0]


# ---------------------------------------------------------------------------
# Task 1 - the tracer: the public pair, wired through the router (D-02, SC-6)
# ---------------------------------------------------------------------------


def test_delegate_returns_the_same_pair_as_benchmark_pair() -> None:
    # Imported inside the body so the other tests in this file collect and fail on
    # their own assertions while the public name does not exist yet.
    from services.metrics import _benchmark_pair, interval_matched_benchmark_pair

    wd = pd.bdate_range("2026-01-05", periods=20)
    rng = np.random.default_rng(3)
    r = pd.Series(rng.normal(0.001, 0.01, len(wd)), index=wd)
    cal = pd.date_range(wd[0] - pd.Timedelta(days=7), wd[-1] + pd.Timedelta(days=2), freq="D")
    b = pd.Series(rng.normal(0.0, 0.02, len(cal)), index=cal)

    got_r, got_b = interval_matched_benchmark_pair(r, b)
    want_r, want_b = _benchmark_pair(r, b)
    pd.testing.assert_series_equal(got_r, want_r)
    pd.testing.assert_series_equal(got_b, want_b)

    # The delegate is NOT the daily inner join: on a weekday series against a
    # seven-day benchmark the paired benchmark values differ from the benchmark's
    # own values on those dates (a Monday covers Sat + Sun + Mon). This is what
    # lets the equality above fail if the delegate were swapped for the old join.
    inner = b.reindex(r.index)
    assert not np.allclose(got_b.to_numpy()[1:], inner.to_numpy()[1:])

    # A duplicated date on either leg is refused through the delegate too.
    dup = pd.concat([r, r.iloc[:1]])
    with pytest.raises(ValueError):
        interval_matched_benchmark_pair(dup, b)


def test_btc_twr_includes_weekend_moves_for_a_weekday_only_portfolio() -> None:
    wd = pd.bdate_range("2026-01-05", periods=32)  # starts a Monday
    rng = np.random.default_rng(7)
    strat = pd.Series(rng.normal(0.001, 0.01, len(wd)), index=wd)
    cal = pd.date_range(wd[0] - pd.Timedelta(days=14), wd[-1] + pd.Timedelta(days=3), freq="D")
    btc = pd.Series(np.where(cal.dayofweek >= 5, 0.02, 0.0), index=cal)  # +2% every Sat and Sun
    bc = _run_with_btc(strat, btc)["benchmark_comparison"]
    # Six Mondays after t_0, each holding interval spans one full weekend:
    # 6 weekends x 2 days of +2%, weekdays flat. 1.02 ** 12 - 1 = 0.2682417945625455.
    # The old inner join sees only the weekday BTC dates (all 0.0) and returns 0.0.
    assert bc["benchmark_twr"] == pytest.approx(1.02 ** 12 - 1, abs=1e-12)


def test_portfolio_correlation_is_the_interval_correlation() -> None:
    wd = pd.bdate_range("2026-01-05", periods=40)
    rng = np.random.default_rng(11)
    cal = pd.date_range(wd[0] - pd.Timedelta(days=14), wd[-1] + pd.Timedelta(days=3), freq="D")
    btc = pd.Series(rng.normal(0.0, 0.03, len(cal)), index=cal)
    price = (1 + btc).cumprod()  # the oracle is the benchmark's own closes
    # Interval move: index 0 is the return dated t_0, k > 0 is the price ratio over
    # (t_{k-1}, t_k].
    interval = [float(btc[wd[0]])] + [
        float(price[wd[k]] / price[wd[k - 1]] - 1) for k in range(1, len(wd))
    ]
    strat = pd.Series([0.5 * v for v in interval], index=wd)  # tracks BTC over each HOLDING interval
    bc = _run_with_btc(strat, btc)["benchmark_comparison"]
    # On the old inner join this is 0.9383...: the daily BTC return is not the move
    # the book actually held through.
    assert bc["correlation"] == pytest.approx(1.0, abs=1e-9)


def _router_ast() -> ast.Module:
    return ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))


def test_router_reads_the_public_pair_and_no_inner_join() -> None:
    tree = _router_ast()

    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "services.metrics":
            imported.update(alias.name for alias in node.names)
    assert "interval_matched_benchmark_pair" in imported
    assert "_benchmark_pair" not in imported
    assert "_interval_matched_benchmark" not in imported

    compute = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "_compute_portfolio_analytics"
    )
    called = {
        c.func.id for c in ast.walk(compute)
        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
    }
    assert "interval_matched_benchmark_pair" in called

    # No `<x>.reindex(benchmark_rets.index)` anywhere in the module: that is the
    # inner join that dropped the weekend moves.
    for c in ast.walk(tree):
        if (
            isinstance(c, ast.Call)
            and isinstance(c.func, ast.Attribute)
            and c.func.attr == "reindex"
            and c.args
            and isinstance(c.args[0], ast.Attribute)
            and c.args[0].attr == "index"
            and isinstance(c.args[0].value, ast.Name)
            and c.args[0].value.id == "benchmark_rets"
        ):
            pytest.fail("routers/portfolio.py still inner-joins on benchmark_rets.index")
