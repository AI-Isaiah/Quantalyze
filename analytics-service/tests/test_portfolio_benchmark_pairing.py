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
import datetime
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


def _run_with_btc(
    strat: pd.Series,
    btc: pd.Series,
    *,
    stale: bool = False,
    benchmark_calls: list[dict] | None = None,
) -> dict:
    """Drive the real router for a one-strategy portfolio against ``btc``.

    Returns the LAST ``portfolio_analytics`` update payload (the persisted row).
    Same driver as ``_c6_correlation``: a fresh ``Semaphore(3)`` scoped to the call,
    the router module pinned in ``sys.modules`` and restored on exit. When
    ``benchmark_calls`` is given, every ``get_benchmark_returns`` call's keywords are
    appended to it.
    """
    sb, pa = _c6_supabase(strat)

    async def _btc(symbol: str, **kwargs: object) -> tuple[pd.Series, bool]:
        if benchmark_calls is not None:
            benchmark_calls.append(kwargs)
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


def test_portfolio_benchmark_read_starts_at_the_first_portfolio_date() -> None:
    """Phase 170.2 (SC-5): the portfolio's BTC comparison reads the benchmark from the
    FIRST date of the portfolio series it pairs, not a fixed trailing window, so a
    portfolio older than the window is compared over its whole history. The oracle
    is the literal first date the fixture strategy was built on.

    Neuter (drop ``since=`` at the router) -> no ``since`` keyword and this reddens."""
    wd = pd.bdate_range("2023-02-06", periods=40)  # long before any trailing window
    rng = np.random.default_rng(5)
    strat = pd.Series(rng.normal(0.001, 0.01, len(wd)), index=wd)
    cal = pd.date_range(wd[0] - pd.Timedelta(days=7), wd[-1] + pd.Timedelta(days=3), freq="D")
    btc = pd.Series(rng.normal(0.0, 0.02, len(cal)), index=cal)
    calls: list[dict] = []
    _run_with_btc(strat, btc, benchmark_calls=calls)
    assert len(calls) == 1
    assert calls[0].get("since") == datetime.date(2023, 2, 6)


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


# ---------------------------------------------------------------------------
# Task 2 - the three quiet benchmark exits are named (D-04, D-05, R-02)
# ---------------------------------------------------------------------------

NOTE_STALE = "benchmark unavailable: stale"
NOTE_THIN = "benchmark unavailable: fewer than 30 shared days"
NOTE_ERROR = "benchmark unavailable: computation failed"

_CANARY = "canary-166-4-1-boom"
_COMPUTE_DATES = pd.bdate_range("2026-01-01", periods=60)  # `_curve_records` default calendar


@pytest.fixture
def _fresh_semaphore():
    """A fresh compute semaphore per test: the module-level one is bound to the
    event loop it was first awaited on. Copied from test_portfolio_compute_integration.
    """
    portfolio_mod._compute_semaphore = asyncio.Semaphore(3)
    yield


@pytest.fixture
def _router_pinned_in_sys_modules():
    """Pin `routers.portfolio` in sys.modules so `patch.object` hits the loaded
    module; save and restore the prior state. Copied from
    test_portfolio_compute_integration (a module's autouse fixtures do not travel
    with an import)."""
    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        yield
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior


def _two_strategy_fake(**kwargs):
    """Two strategies at weights 0.6 / 0.4 over 60 business days of real curves."""
    return _make_supabase_for_compute(
        portfolio_strategies=_ps_rows({"s1": 0.6, "s2": 0.4}),
        analytics_rows=[
            {"strategy_id": "s1", "returns_series": _curve_records(seed=21)},
            {"strategy_id": "s2", "returns_series": _curve_records(seed=22)},
        ],
        **kwargs,
    )


def _seven_day_btc(first, last, *, seed: int) -> pd.Series:
    cal = pd.date_range(first, last, freq="D")
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0005, 0.02, len(cal)), index=cal)


async def _compute(sb, *, benchmark, stale: bool) -> dict:
    async def _fake_benchmark(symbol, **_kwargs):
        return benchmark, stale

    with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
         patch.object(portfolio_mod, "get_benchmark_returns", side_effect=_fake_benchmark):
        return await portfolio_mod._compute_portfolio_analytics("portfolio-1")


@pytest.mark.usefixtures("_fresh_semaphore", "_router_pinned_in_sys_modules")
class TestNamedBenchmarkNotes:
    @pytest.mark.asyncio
    async def test_stale_series_writes_the_named_stale_note(self):
        sb, _ = _two_strategy_fake()
        valid = _seven_day_btc("2025-12-20", "2026-03-31", seed=5)
        result = await _compute(sb, benchmark=valid, stale=True)
        assert result["benchmark_comparison"] == {
            "symbol": "BTC",
            "correlation": None,
            "benchmark_twr": None,
            "portfolio_twr": result["total_return_twr"],
            "stale": True,
            "note": NOTE_STALE,
        }
        dq = result["data_quality"]
        assert dq["benchmark_unavailable"] is True
        assert dq["benchmark_note"] == NOTE_STALE
        # A stale benchmark is not a partial portfolio: it must not flip the flag.
        assert dq["partial_data"] is False

    @pytest.mark.asyncio
    async def test_missing_benchmark_writes_the_named_stale_note(self):
        sb, _ = _two_strategy_fake()
        # `get_benchmark_returns` returns (None, True) on total failure.
        result = await _compute(sb, benchmark=None, stale=True)
        assert result["benchmark_comparison"] == {
            "symbol": "BTC",
            "correlation": None,
            "benchmark_twr": None,
            "portfolio_twr": result["total_return_twr"],
            "stale": True,
            "note": NOTE_STALE,
        }
        dq = result["data_quality"]
        assert dq["benchmark_unavailable"] is True
        assert dq["benchmark_note"] == NOTE_STALE
        assert dq["partial_data"] is False

    @pytest.mark.asyncio
    async def test_fewer_than_30_paired_days_writes_the_named_thin_note(self):
        sb, _ = _two_strategy_fake()
        # BTC (seven days a week) covers only the last 20 of the portfolio's dates,
        # so at most 20 rows can pair.
        thin = _seven_day_btc(_COMPUTE_DATES[-20], _COMPUTE_DATES[-1], seed=6)
        result = await _compute(sb, benchmark=thin, stale=False)
        bc = result["benchmark_comparison"]
        assert bc is not None, "a thin overlap must write a flagged-empty comparison, not null"
        assert bc["note"] == NOTE_THIN
        assert bc["stale"] is False
        assert bc["correlation"] is None
        assert bc["benchmark_twr"] is None
        assert bc["portfolio_twr"] == result["total_return_twr"]
        assert result["data_quality"]["benchmark_unavailable"] is True
        assert result["data_quality"]["benchmark_note"] == NOTE_THIN

    @pytest.mark.asyncio
    async def test_benchmark_crash_keeps_own_numbers_and_writes_a_fixed_note(self):
        # Reference: the same fixture on the stale path (no benchmark arithmetic).
        sb_ref, _ = _two_strategy_fake()
        reference = await _compute(sb_ref, benchmark=None, stale=True)

        sb, _ = _two_strategy_fake()
        with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
             patch.object(
                 portfolio_mod, "get_benchmark_returns",
                 side_effect=RuntimeError(_CANARY),
             ):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        assert result["computation_status"] == "complete"
        assert result["total_return_twr"] == reference["total_return_twr"]
        bc = result["benchmark_comparison"]
        assert bc is not None and bc["note"] == NOTE_ERROR
        assert bc["stale"] is False
        assert bc["correlation"] is None and bc["benchmark_twr"] is None
        dq = result["data_quality"]
        assert dq["benchmark_unavailable"] is True
        assert dq["benchmark_note"] == NOTE_ERROR
        # HONEST-01 / D-162-4: the exception text is for operators only.
        assert _CANARY not in json.dumps(bc)
        assert _CANARY not in dq["benchmark_note"]
        assert _CANARY in dq["benchmark_error"]

    @pytest.mark.asyncio
    async def test_a_full_comparison_carries_no_note_and_benchmark_available(self):
        sb, _ = _two_strategy_fake()
        full = _seven_day_btc("2025-12-20", "2026-03-31", seed=8)
        result = await _compute(sb, benchmark=full, stale=False)
        bc = result["benchmark_comparison"]
        assert bc is not None
        assert "note" not in bc
        assert bc["stale"] is False
        assert isinstance(bc["correlation"], float)
        assert isinstance(bc["benchmark_twr"], float)
        dq = result["data_quality"]
        assert dq["benchmark_unavailable"] is False
        assert dq["benchmark_note"] is None


# ---------------------------------------------------------------------------
# Task 3 - a final update that matches no row raises (D-06)
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("_fresh_semaphore", "_router_pinned_in_sys_modules")
class TestLostFinalWrite:
    @pytest.mark.asyncio
    async def test_final_update_matching_no_row_raises_and_writes_no_alert(self):
        # The closing update returns data=[]: the analytics row was deleted under us.
        sb, tables = _two_strategy_fake(final_update_rows=[])
        alerts = MagicMock()
        with patch.object(portfolio_mod, "_generate_alerts", alerts):
            with pytest.raises(HTTPException) as caught:
                await _compute(sb, benchmark=None, stale=True)
        assert caught.value.status_code == 500
        assert caught.value.detail["code"] == "PORTFOLIO_ANALYTICS_FAILED"
        assert caught.value.detail["retryable"] is False
        # Analytics that did not persist must not generate an alert.
        alerts.assert_not_called()
        tables["portfolio_alerts"].insert.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_update_that_matched_its_row_still_completes(self):
        # The control: the default fake returns the one row, so the same fixture
        # completes. Without it the raise above could be a fixture artefact.
        sb, tables = _two_strategy_fake()
        alerts = MagicMock()
        with patch.object(portfolio_mod, "_generate_alerts", alerts):
            result = await _compute(sb, benchmark=None, stale=True)
        assert result["computation_status"] == "complete"
        alerts.assert_called_once()
