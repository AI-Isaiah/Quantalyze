"""Integration tests for _compute_portfolio_analytics + endpoint wiring.

Covers the critical findings that were previously uncovered:
  C-0206 — _compute_portfolio_analytics happy-path pipeline
  C-0208 — TOCTOU concurrency guard (semaphore + in-flight DB check)
  H-0574 — 80/20 weight renormalization when high-weight strategy missing

The supabase client is heavily mocked because the analytics service
runs against a real Postgres in prod; in this local test env we only
verify the routing/decision logic — the client is injected per-test via
`patch("routers.portfolio.get_supabase", ...)`.

H-0806: this module used to run an `_install_stubs()` at import time that
mutated `sys.modules`. Its `if name not in sys.modules` guard only protected the
wholesale MagicMock replacement — the attribute writes that followed were
unconditional, so it clobbered the real shared fastapi/supabase/slowapi modules
process-globally for every later-collected test. The deps are installed in CI
and the venv, so `routers.portfolio` is imported for real (the source-level
regression tests below read the module file text, not the runtime objects, so
they are unaffected).
"""

from __future__ import annotations

import asyncio
import pathlib
import sys
from unittest.mock import DEFAULT, AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi import HTTPException

from routers import portfolio as portfolio_mod
from tests._curve_fixtures import curve_from_returns
from tests._schema_columns import assert_select_columns, table_columns

# Read the raw source of routers/portfolio.py once for AST/source-level
# regression checks. _function_source() (below) walks the AST of this text, so
# the source-level tests are independent of whether the runtime endpoint object
# is the real coroutine or a decorated wrapper.
_PORTFOLIO_SRC = (
    pathlib.Path(portfolio_mod.__file__).read_text(encoding="utf-8")
)


def _function_source(name: str) -> str:
    """Return the source of a top-level function from routers/portfolio.py.

    Walks the module AST so wrapped (decorated) callables are reachable
    by name even when MagicMock decorators have replaced the runtime
    object.
    """
    import ast
    tree = ast.parse(_PORTFOLIO_SRC)
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return ast.get_source_segment(_PORTFOLIO_SRC, node) or ""
    raise LookupError(f"function {name} not found in routers/portfolio.py")


# Synthetic strategy CURVES: 60 trading days, two strategies with correlated but
# distinct profiles. ``strategy_analytics.returns_series`` is the cumulative wealth
# curve the analytics worker writes, NOT daily returns (Phase 164.6.6.2.2, CR-01),
# so every fixture here has the stored shape. Reading it back yields the daily
# returns of days 1..n-1 (day 0 has no stored predecessor).
def _curve_records(n: int = 60, base: float = 0.001, vol: float = 0.01,
                   seed: int = 0) -> list[dict]:
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(seed)
    rets = rng.normal(base, vol, n)
    dates = pd.bdate_range("2026-01-01", periods=n)
    return curve_from_returns(
        [float(r) for r in rets], [d.strftime("%Y-%m-%d") for d in dates]
    )


def _make_supabase_for_compute(
    *,
    portfolio_strategies: list[dict],
    analytics_rows: list[dict],
    insert_returns_id: str = "analytics-1",
    benchmark_returns=None,
    prev_optimizer: list[dict] | None = None,
    final_update_rows: list[dict] | None = None,
):
    """Build a supabase MagicMock that responds to _compute_portfolio_analytics's
    sequence of calls.

    ``final_update_rows`` is what the closing ``portfolio_analytics`` update returns.
    Default: ONE row, as PostgREST returns for an update that matched the row.
    Phase 166.4.1 D-06 made an update that matches nothing (``[]``) raise, so a
    fake that defaulted to ``[]`` would model a deleted row in every test.
    """
    sb = MagicMock()

    # Track separate table-name handlers so each call returns the right shape.
    table_mocks: dict[str, MagicMock] = {}

    pa = MagicMock()
    # INSERT computing row
    pa.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": insert_returns_id}]
    )
    # SELECT previous optimizer_suggestions
    pa.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=prev_optimizer or []
    )
    pa.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=final_update_rows if final_update_rows is not None else [{"id": insert_returns_id}]
    )
    table_mocks["portfolio_analytics"] = pa

    # Column-strict: a select naming a column the real table lacks RAISES here,
    # as PostgREST would refuse it (Phase 164.6.6.2.2 D-04). A fake that answers
    # any select string is what hid `equity_curve` / `total_aum` on
    # strategy_analytics.
    # `side_effect` returns DEFAULT so the mock still hands back its own
    # `select.return_value` chain: other test files reach into that chain (e.g.
    # `tables["portfolio_strategies"].select.return_value.eq.return_value.execute
    # .side_effect = ...`), and that must keep working.
    ps = MagicMock()
    ps.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies
    )

    def _ps_select(select_str: str, *_a, **_kw):
        assert_select_columns("portfolio_strategies", select_str)
        return DEFAULT

    ps.select.side_effect = _ps_select
    table_mocks["portfolio_strategies"] = ps

    sa = MagicMock()
    sa.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=analytics_rows
    )

    def _sa_select(select_str: str, *_a, **_kw):
        assert_select_columns("strategy_analytics", select_str)
        return DEFAULT

    sa.select.side_effect = _sa_select
    table_mocks["strategy_analytics"] = sa

    pal = MagicMock()
    pal.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    pal.insert.return_value.execute.return_value = MagicMock(data=[{"id": "alert-1"}])
    table_mocks["portfolio_alerts"] = pal

    pf = MagicMock()
    pf.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data={"created_at": "2026-01-01T00:00:00+00:00"}
    )
    table_mocks["portfolios"] = pf

    ws = MagicMock()
    ws.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
        data=[]
    )
    table_mocks["weight_snapshots"] = ws

    strat = MagicMock()
    strat.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
    table_mocks["strategies"] = strat

    sb.table.side_effect = lambda name: table_mocks.setdefault(name, MagicMock())
    return sb, table_mocks


@pytest.fixture(autouse=True)
def _reset_semaphore():
    """Each test gets a fresh semaphore so prior tests' acquires don't
    block this one's compute slot."""
    # The semaphore lives at module scope; reset its internal counter.
    portfolio_mod._compute_semaphore = asyncio.Semaphore(3)
    yield


@pytest.fixture(autouse=True)
def _pin_portfolio_module_in_sys_modules():
    """Other tests in the suite have been observed to unload
    `routers.portfolio` from sys.modules. When that happens, our
    `patch("routers.portfolio.get_supabase", ...)` re-imports the
    module — and on CI (Python 3.12 + real supabase installed),
    re-import causes a downstream call to services.db.get_supabase()
    which raises RuntimeError when SUPABASE_URL is unset. Pinning
    the module here forces patch() to use the already-loaded module
    so the mock takes effect. Mirrors the pattern in test_cron_router.py.

    Save and restore the prior sys.modules state so later test files
    that intentionally unload `routers.portfolio` (e.g. test_cron_router's
    error-isolation tests) continue to see the unloaded state they expect.
    """
    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        yield
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior


# ---------------------------------------------------------------------------
# C-0206 — Happy path
# ---------------------------------------------------------------------------

class TestComputePortfolioAnalyticsHappyPath:
    @pytest.mark.asyncio
    async def test_two_strategies_full_pipeline(self):
        ret1 = _curve_records(seed=1)
        ret2 = _curve_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.6, "allocated_amount": 100.0,
             "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.4, "allocated_amount": 50.0,
             "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1},
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        # Patch get_supabase + benchmark fetch
        async def _fake_benchmark(symbol, **_kwargs):
            return None, True  # stale → no benchmark_comparison
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        # Pipeline produced an analytics_id and key fields
        assert result["analytics_id"] == "analytics-1"
        assert "data_quality" in result
        # Full strategy coverage → no partial_data flag
        assert result["data_quality"]["partial_data"] is False
        assert result["data_quality"]["expected_strategy_count"] == 2
        assert result["data_quality"]["computed_strategy_count"] == 2
        # UPDATE called to mark complete + populate the row
        update_call = tables["portfolio_analytics"].update.call_args[0][0]
        assert update_call["computation_status"] == "complete"
        assert update_call["computation_error"] is None
        # D-07: the allocations 100 + 50 are summed from portfolio_strategies
        assert update_call["total_aum"] == 150.0


async def _run_compute(sb, *, benchmark=None, stale: bool = True, portfolio_id: str = "portfolio-1"):
    """Drive the real router function against ``sb``.

    ``benchmark`` is the BTC daily-returns Series the stubbed benchmark fetch
    returns (None with ``stale=True`` means no benchmark comparison). The module is
    resolved at call time and patched with ``patch.object`` (some tests evict and
    re-import routers.portfolio, so a dotted-string patch can hit a stale copy).
    """
    async def _fake_benchmark(symbol, **_kwargs):
        return benchmark, stale

    with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
         patch.object(portfolio_mod, "get_benchmark_returns", side_effect=_fake_benchmark):
        return await portfolio_mod._compute_portfolio_analytics(portfolio_id)


_TRACER_DATES = ["2026-01-05", "2026-01-06", "2026-01-07"]


class TestCurveShapedBlend:
    """Tracer (Phase 164.6.6.2.2 Plan 04): a two-strategy portfolio whose
    ``returns_series`` rows are stored-shape CURVES runs end to end against the
    column-strict fake: select -> boundary -> blend -> persisted returns."""

    @pytest.mark.asyncio
    async def test_curve_rows_blend_to_the_hand_computed_daily_returns(self):
        # A: daily returns [d1 0.02, d2 0.01]; B: [d1 -0.01, d2 0.03] (day 0 has no
        # stored predecessor). Weights 0.5/0.5:
        #   d1 = 0.5 * 0.02 + 0.5 * -0.01 = 0.005
        #   d2 = 0.5 * 0.01 + 0.5 *  0.03 = 0.020
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5, "strategies": {"id": "s1", "name": "A"}},
            {"strategy_id": "s2", "current_weight": 0.5, "strategies": {"id": "s2", "name": "B"}},
        ]
        sa_rows = [
            {"strategy_id": "s1",
             "returns_series": curve_from_returns([0.0, 0.02, 0.01], _TRACER_DATES)},
            {"strategy_id": "s2",
             "returns_series": curve_from_returns([0.0, -0.01, 0.03], _TRACER_DATES)},
        ]
        sb, tables = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa_rows)

        await _run_compute(sb)

        update = tables["portfolio_analytics"].update.call_args[0][0]
        assert update["computation_status"] == "complete"
        # The persisted equity curve is (1 + blended daily returns).cumprod():
        # 1.005, then 1.005 * 1.02 = 1.0251. Read back, those are 0.005 and 0.02.
        values = [pt["value"] for pt in update["portfolio_equity_curve"]]
        assert len(values) == 2
        assert values[0] == pytest.approx(1.005, abs=1e-12)
        assert values[1] == pytest.approx(1.0251, abs=1e-12)
        assert values[1] / values[0] - 1.0 == pytest.approx(0.02, abs=1e-12)


class TestBlendRiskIsAnnualizedOnTheBlendClock:
    """WR-01 (Phase 164.6.6.2.2). The portfolio headline Sharpe and vol are risk, so
    they annualize by frequency: crypto 365, traditional 252, and a blend is 365 if
    ANY blended strategy is crypto. They used to ride the default 252, which understates
    a crypto book by sqrt(252/365) = 0.831. The expectations are an independent numpy
    oracle over the blend the test builds, not the production helper."""

    _DATES = [d.strftime("%Y-%m-%d") for d in pd.date_range("2026-01-01", periods=61, freq="D")]

    @staticmethod
    def _daily(seed: int, mu: float) -> list[float]:
        import numpy as np

        return [float(r) for r in np.random.default_rng(seed).normal(mu, 0.01, 61)]

    def _rows(self, classes: tuple[str, str]):
        r1, r2 = self._daily(11, 0.0012), self._daily(12, 0.0007)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5,
             "strategies": {"id": "s1", "name": "A", "asset_class": classes[0]}},
            {"strategy_id": "s2", "current_weight": 0.5,
             "strategies": {"id": "s2", "name": "B", "asset_class": classes[1]}},
        ]
        sa = [
            {"strategy_id": "s1", "returns_series": curve_from_returns(r1, self._DATES)},
            {"strategy_id": "s2", "returns_series": curve_from_returns(r2, self._DATES)},
        ]
        # Reading a curve back yields returns[1:] (day 0 has no stored predecessor).
        import numpy as np

        blend = 0.5 * np.array(r1[1:]) + 0.5 * np.array(r2[1:])
        return ps, sa, blend

    @staticmethod
    def _oracle(blend, clock: int) -> tuple[float, float]:
        import math

        import numpy as np

        vol = float(np.std(blend, ddof=1)) * math.sqrt(clock)
        return vol, float(np.mean(blend)) * clock / vol

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "classes, clock",
        [
            pytest.param(("crypto", "crypto"), 365, id="crypto-blend-sqrt365"),
            pytest.param(("traditional", "traditional"), 252, id="traditional-blend-sqrt252"),
            pytest.param(("traditional", "crypto"), 365, id="mixed-blend-sqrt365"),
        ],
    )
    async def test_headline_vol_and_sharpe_use_the_blend_clock(self, classes, clock):
        ps, sa, blend = self._rows(classes)
        sb, tables = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa)

        await _run_compute(sb)

        update = tables["portfolio_analytics"].update.call_args[0][0]
        vol, sharpe = self._oracle(blend, clock)
        assert update["portfolio_volatility"] == pytest.approx(vol, rel=1e-9)
        assert update["portfolio_sharpe"] == pytest.approx(sharpe, rel=1e-9)
        if clock == 365:
            # NOT the old sqrt(252) answer.
            old_vol, old_sharpe = self._oracle(blend, 252)
            assert update["portfolio_volatility"] != pytest.approx(old_vol, rel=1e-3)
            assert update["portfolio_sharpe"] != pytest.approx(old_sharpe, rel=1e-3)

    @pytest.mark.asyncio
    async def test_a_crypto_strategy_that_is_not_blended_does_not_set_the_clock(self):
        """The clock follows the strategies actually BLENDED: a crypto member with no
        analytics row is dropped from the blend (and flagged in data_quality), so the
        remaining traditional book stays on 252."""
        ps, sa, _ = self._rows(("traditional", "crypto"))
        sa = [row for row in sa if row["strategy_id"] == "s1"]
        r1 = self._daily(11, 0.0012)
        sb, tables = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa)

        await _run_compute(sb)

        update = tables["portfolio_analytics"].update.call_args[0][0]
        assert "s2" in update["data_quality"]["missing_analytics_sids"]
        import numpy as np

        vol, sharpe = self._oracle(np.array(r1[1:]), 252)
        assert update["portfolio_volatility"] == pytest.approx(vol, rel=1e-9)
        assert update["portfolio_sharpe"] == pytest.approx(sharpe, rel=1e-9)

    @pytest.mark.asyncio
    async def test_the_membership_select_names_asset_class_on_the_embedded_strategy(self):
        """The clock is read off `strategies.asset_class`; without it in the select
        every row reads None and every blend silently falls back to 252."""
        ps, sa, _ = self._rows(("crypto", "crypto"))
        sb, tables = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa)

        await _run_compute(sb)

        selected = tables["portfolio_strategies"].select.call_args[0][0]
        assert "strategies(" in selected and "asset_class" in selected, selected
        assert "asset_class" in table_columns("strategies")


def _levels(levels: list[float], dates: list[str]) -> list[dict]:
    """A stored-shape curve written out by LEVEL (the hand-written twin of
    ``curve_from_returns``) so a test can state the curve it means literally."""
    return [{"date": d, "value": v} for d, v in zip(dates, levels)]


def _ps_rows(weights: dict[str, float], amounts: dict[str, float | None] | None = None) -> list[dict]:
    rows = []
    for sid, w in weights.items():
        row = {"strategy_id": sid, "current_weight": w,
               "strategies": {"id": sid, "name": sid.upper()}}
        if amounts is not None:
            row["allocated_amount"] = amounts.get(sid)
        rows.append(row)
    return rows


class TestTwrWindows:
    """Phase 164.6.6.2.2 D-04. Every TWR the service compares or shows side by side
    covers days 1..n (first day INCLUDED): per-strategy TWRs vs the portfolio TWR
    (attribution), and the portfolio TWR vs the benchmark TWR (a delta on screen).
    Literals are hand-computed, never read back from the code under test."""

    @pytest.mark.asyncio
    async def test_a_strategys_twr_is_the_product_of_its_daily_returns(self):
        # Curve 1.0, 1.1, 1.21 -> daily returns 1.1/1.0 - 1 = 0.10 and
        # 1.21/1.1 - 1 = 0.10 -> TWR = 1.10 * 1.10 - 1 = 0.21 (= 1.21 / 1.0 - 1).
        # One strategy at weight 1.0, so its attribution contribution IS its TWR.
        sb, _ = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows({"s1": 1.0}),
            analytics_rows=[{
                "strategy_id": "s1",
                "returns_series": _levels([1.0, 1.1, 1.21], _TRACER_DATES),
            }],
        )
        result = await _run_compute(sb)
        (attr,) = result["attribution_breakdown"]
        assert attr["contribution"] == pytest.approx(0.21, abs=1e-12)

    @pytest.mark.asyncio
    async def test_portfolio_twr_covers_the_same_days_as_the_strategy_twrs(self):
        # Curves on d0..d2: A 1.0, 1.1, 1.1 (daily 0.10, 0.00); B 1.0, 1.0, 1.02
        # (daily 0.00, 0.02). Weights 0.5 / 0.5.
        #   strategy TWRs: A = 1.10 * 1.00 - 1 = 0.10;  B = 1.00 * 1.02 - 1 = 0.02
        #   blend: d1 = 0.5 * 0.10 + 0.5 * 0.00 = 0.05; d2 = 0.5 * 0.00 + 0.5 * 0.02 = 0.01
        #   portfolio TWR over days 1..n = 1.05 * 1.01 - 1 = 0.0605
        # The old `(1 + p).cumprod()` endpoint ratio is 1.0605 / 1.05 - 1 = 0.01:
        # it dropped the first blended day while the strategy TWRs kept theirs.
        sb, _ = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows({"s1": 0.5, "s2": 0.5}),
            analytics_rows=[
                {"strategy_id": "s1", "returns_series": _levels([1.0, 1.1, 1.1], _TRACER_DATES)},
                {"strategy_id": "s2", "returns_series": _levels([1.0, 1.0, 1.02], _TRACER_DATES)},
            ],
        )
        result = await _run_compute(sb)
        assert result["total_return_twr"] == pytest.approx(0.0605, abs=1e-12)
        contributions = {a["strategy_id"]: a["contribution"] for a in result["attribution_breakdown"]}
        # contribution = weight * strategy TWR: 0.5 * 0.10 and 0.5 * 0.02
        assert contributions["s1"] == pytest.approx(0.05, abs=1e-12)
        assert contributions["s2"] == pytest.approx(0.01, abs=1e-12)

    @pytest.mark.asyncio
    async def test_allocation_effect_is_measured_against_the_days_1_to_n_portfolio_twr(self):
        # Same curves, weights 0.6 / 0.4: blend d1 = 0.6 * 0.10 = 0.06, d2 = 0.4 * 0.02 = 0.008;
        # portfolio TWR = 1.06 * 1.008 - 1 = 0.06848. Equal weight is 0.5, so
        #   A: (0.6 - 0.5) * (0.10 - 0.06848) =  0.1 * 0.03152  =  0.003152
        #   B: (0.4 - 0.5) * (0.02 - 0.06848) = -0.1 * -0.04848 =  0.004848
        sb, _ = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows({"s1": 0.6, "s2": 0.4}),
            analytics_rows=[
                {"strategy_id": "s1", "returns_series": _levels([1.0, 1.1, 1.1], _TRACER_DATES)},
                {"strategy_id": "s2", "returns_series": _levels([1.0, 1.0, 1.02], _TRACER_DATES)},
            ],
        )
        result = await _run_compute(sb)
        assert result["total_return_twr"] == pytest.approx(0.06848, abs=1e-12)
        effects = {a["strategy_id"]: a["allocation_effect"] for a in result["attribution_breakdown"]}
        assert effects["s1"] == pytest.approx(0.003152, abs=1e-12)
        assert effects["s2"] == pytest.approx(0.004848, abs=1e-12)

    @pytest.mark.asyncio
    async def test_benchmark_twr_includes_its_first_day_like_the_portfolio_twr(self):
        # One strategy whose daily returns are [0.05, 0.0 x 29] on d1..d30 (a curve
        # of 31 points, so 30 readable days: enough for the `len(aligned) >= 30`
        # gate). The BTC benchmark on the SAME 30 dates is [0.10, 0.0 x 29].
        #   portfolio TWR = 1.05 - 1 = 0.05;  benchmark TWR = 1.10 - 1 = 0.10
        # The old `(1 + b).cumprod()` endpoint ratio is 1.10 / 1.10 - 1 = 0.0.
        dates = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-01-05", periods=31)]
        curve = curve_from_returns([0.0, 0.05] + [0.0] * 29, dates)
        bench = pd.Series(
            [0.10] + [0.0] * 29, index=pd.DatetimeIndex(dates[1:]), dtype=float
        )
        sb, _ = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows({"s1": 1.0}),
            analytics_rows=[{"strategy_id": "s1", "returns_series": curve}],
        )
        result = await _run_compute(sb, benchmark=bench, stale=False)
        bc = result["benchmark_comparison"]
        assert bc is not None
        assert bc["benchmark_twr"] == pytest.approx(0.10, abs=1e-12)
        assert bc["portfolio_twr"] == pytest.approx(0.05, abs=1e-12)


class TestTotalAumFromAllocations:
    """Phase 164.6.6.2.2 D-07. ``total_aum`` is the sum of
    ``portfolio_strategies.allocated_amount`` over EVERY strategy in the portfolio,
    None unless every allocation is non-null; a 0 counts as present."""

    @staticmethod
    async def _total_aum(amounts: dict[str, float | None], with_analytics: set[str]) -> float | None:
        weights = {sid: 1.0 / len(amounts) for sid in amounts}
        sa_rows = [
            {"strategy_id": sid, "returns_series": _curve_records(seed=i + 1)}
            for i, sid in enumerate(amounts) if sid in with_analytics
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows(weights, amounts), analytics_rows=sa_rows
        )
        await _run_compute(sb)
        return tables["portfolio_analytics"].update.call_args[0][0]["total_aum"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("amounts", "with_analytics", "expected"),
        [
            pytest.param({"a": 100.0, "b": 50.0}, {"a", "b"}, 150.0, id="sum"),
            pytest.param({"a": 100.0, "b": 0.0}, {"a", "b"}, 100.0, id="a-zero-counts-as-present"),
            pytest.param({"a": 100.0, "b": None}, {"a", "b"}, None, id="a-null-makes-the-total-null"),
            pytest.param({"a": 0.0, "b": 0.0}, {"a", "b"}, 0.0, id="all-zero-is-zero-not-none"),
            pytest.param({"a": 100.0, "b": 50.0}, {"a"}, 150.0, id="allocation-without-an-analytics-row-counts"),
        ],
    )
    async def test_total_aum(self, amounts, with_analytics, expected):
        assert await self._total_aum(amounts, with_analytics) == expected

    @pytest.mark.asyncio
    async def test_an_allocation_whose_strategy_has_no_usable_returns_still_counts(self):
        # b has an analytics row but nothing readable (returns_series None, no
        # daily_returns): it drops out of the BLEND (missing_returns_sids) yet its
        # 50 is still part of what the allocator put in the portfolio.
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=_ps_rows({"a": 0.5, "b": 0.5}, {"a": 100.0, "b": 50.0}),
            analytics_rows=[
                {"strategy_id": "a", "returns_series": _curve_records(seed=1)},
                {"strategy_id": "b", "returns_series": None},
            ],
        )
        result = await _run_compute(sb)
        assert result["data_quality"]["missing_returns_sids"] == ["b"]
        assert tables["portfolio_analytics"].update.call_args[0][0]["total_aum"] == 150.0


class TestSchemaStrictFake:
    """The fake rejects a select naming a column the real table lacks, so
    re-adding ``equity_curve`` / ``total_aum`` to the strategy_analytics select
    turns the compute tests RED instead of passing on canned rows."""

    def test_schema_reader_knows_the_real_columns_and_not_the_phantoms(self):
        cols = table_columns("strategy_analytics")
        assert {"strategy_id", "returns_series", "daily_returns", "data_quality_flags"} <= cols
        assert "equity_curve" not in cols
        assert "total_aum" not in cols
        assert "allocated_amount" in table_columns("portfolio_strategies")
        # `alias` is added by a multi-line ALTER TABLE ... ADD COLUMN migration.
        assert "alias" in table_columns("portfolio_strategies")

    def test_schema_reader_refuses_an_unknown_table_instead_of_returning_empty(self):
        with pytest.raises(LookupError):
            table_columns("no_such_table_anywhere")

    def test_strict_select_names_the_unknown_column_and_skips_embeds(self):
        assert_select_columns(
            "portfolio_strategies",
            "strategy_id, current_weight, allocated_amount, strategies(id, name)",
        )
        with pytest.raises(AssertionError, match="equity_curve"):
            assert_select_columns(
                "strategy_analytics", "strategy_id, returns_series, equity_curve, total_aum"
            )

    def test_the_compute_select_is_strict_against_the_fake(self):
        sb, _ = _make_supabase_for_compute(portfolio_strategies=[], analytics_rows=[])
        sb.table("strategy_analytics").select("strategy_id, returns_series")
        with pytest.raises(AssertionError, match="total_aum"):
            sb.table("strategy_analytics").select("strategy_id, total_aum")


# ---------------------------------------------------------------------------
# H-0574 — Missing-strategy renormalization regression
# ---------------------------------------------------------------------------

class TestRenormalizationRegression:
    @pytest.mark.asyncio
    async def test_80_20_with_missing_high_weight_strategy(self):
        """Portfolio has 80% weight on s1 (no analytics) + 20% on s2 (with
        analytics). The surviving s2 weight must be renormalized to 100%
        and data_quality must flag the partial_data status with the dropped
        sid recorded.

        Project memory: this is the v0.17.1 KPI-17 silent-zero pattern.
        Previously the renormalization was applied silently with no signal;
        the dashboard would render numbers that were really s2-only.
        """
        ret2 = _curve_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.8, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.2, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        # Only s2 has strategy_analytics row.
        sa_rows = [
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        async def _fake_benchmark(symbol, **_kwargs):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        dq = result["data_quality"]
        # Partial-data flag set
        assert dq["partial_data"] is True
        # s1 captured in missing_analytics_sids
        assert "s1" in dq["missing_analytics_sids"]
        # Only s2 computed
        assert dq["computed_strategy_count"] == 1
        # Dropped weight total was 0.8 (s1's weight) — within sanitize tolerance
        assert dq["dropped_weight_total"] == pytest.approx(0.8, abs=0.01)
        # total_aum: neither portfolio_strategies row carries an allocated_amount
        # (null on both, s1 included although it has no analytics row) → None
        update_call = tables["portfolio_analytics"].update.call_args[0][0]
        assert update_call["total_aum"] is None


# ---------------------------------------------------------------------------
# H-0577 / H-0578 — Missing equity curve and missing returns telemetry
# ---------------------------------------------------------------------------

class TestPartialDataTelemetry:
    @pytest.mark.asyncio
    async def test_no_strategy_with_returns_is_missing_an_equity(self):
        """D-04: the equity behind each strategy's TWR is DERIVED from its returns,
        so a strategy that has a curve is never "missing an equity" any more.
        ``missing_equity_sids`` keeps its key (the persisted shape is unchanged,
        and the hedge wiring that reads it stays) but this producer leaves it
        empty, and a fully-populated portfolio is not flagged partial."""
        ret1 = _curve_records(seed=1)
        ret2 = _curve_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.5, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1},
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        result = await _run_compute(sb)

        dq = result["data_quality"]
        assert "missing_equity_sids" in dq
        assert dq["missing_equity_sids"] == []
        assert dq["partial_data"] is False


# ---------------------------------------------------------------------------
# M-0707 — correlation_history_sufficient data-quality flag
# ---------------------------------------------------------------------------

class TestCorrelationHistorySufficientFlag:
    """M-0707: compute_correlation_matrix returns an all-None matrix (shaped
    like a real result) when the dropna overlap is <10 rows — on the dashboard
    that is indistinguishable from RLS-stripped data or a compute failure.
    data_quality must carry a correlation_history_sufficient flag (mirroring
    cov_history_sufficient) so the UI can render an explicit
    insufficient-overlap state. Pre-fix the key is absent (KeyError), so both
    cases below fail without the router change."""

    @pytest.mark.asyncio
    async def test_full_overlap_flag_true(self):
        ret1 = _curve_records(seed=1)        # 60 business days
        ret2 = _curve_records(seed=2)        # 60 business days, full overlap
        ps = [
            {"strategy_id": "s1", "current_weight": 0.6, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.4, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1},
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, _ = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa_rows)

        async def _fake_benchmark(symbol, **_kwargs):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        assert result["data_quality"]["correlation_history_sufficient"] is True

    @pytest.mark.asyncio
    async def test_short_overlap_flag_false(self):
        ret1 = _curve_records(n=60, seed=1)
        ret2 = _curve_records(n=5, seed=2)   # only 5 days -> overlap 5 < 10
        ps = [
            {"strategy_id": "s1", "current_weight": 0.6, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.4, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1},
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, _ = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa_rows)

        async def _fake_benchmark(symbol, **_kwargs):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        assert result["data_quality"]["correlation_history_sufficient"] is False


# ---------------------------------------------------------------------------
# C-0208 — TOCTOU concurrency guard
# ---------------------------------------------------------------------------

class TestTOCTOUConcurrencyGuard:
    """Verifies the ordering: semaphore acquired BEFORE the in-flight
    DB check. Two overlapping requests against the same portfolio_id
    must not both pass the check; the second must see the first's
    INSERT and return 409.

    The slowapi @limiter.limit() decorator replaces the endpoint
    coroutine with a MagicMock in this stubbed test env, so we exercise
    the endpoint's logic by reading the function body via inspect +
    asserting the source explicitly carries the contract — and we
    test the inner _compute call path independently. AST-level
    coverage is intentional defense-in-depth against a refactor that
    accidentally moves the in-flight check OUTSIDE the semaphore (the
    exact regression the comment at portfolio.py:945 warns about).
    """

    def test_in_flight_check_is_inside_semaphore_block(self):
        """Audit C-0208: refactor-resistant AST check that the
        in-flight SELECT happens inside `async with _compute_semaphore`.
        """
        import ast
        src = _function_source("portfolio_analytics")
        tree = ast.parse(src.lstrip())
        # Walk to find AsyncWith blocks and confirm at least one contains
        # the in_flight variable + the COMPUTING status reference.
        # (We accept either the literal "computing" or the
        # ComputationStatus.COMPUTING enum name.)
        found_pattern = False
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncWith):
                body_src = ast.unparse(node)
                has_in_flight = "in_flight" in body_src
                has_computing_ref = (
                    "computing" in body_src
                    or "ComputationStatus.COMPUTING" in body_src
                )
                if has_in_flight and has_computing_ref:
                    found_pattern = True
                    break
        assert found_pattern, (
            "Regression: in-flight check ('computing' SELECT) is no longer "
            "inside the async-with-_compute_semaphore block. This re-introduces "
            "the TOCTOU window where two concurrent requests both pass the "
            "check before either INSERT runs."
        )

    def test_409_path_present_in_source(self):
        """Audit C-0208: handler must raise HTTPException(409) when
        in_flight.data is non-empty."""
        src = _function_source("portfolio_analytics")
        assert "status_code=409" in src
        assert "already in progress" in src


# ---------------------------------------------------------------------------
# H-0583 — portfolio_optimizer NULL user_id still audits under sentinel
# ---------------------------------------------------------------------------

class TestOptimizerAuditNullOwner:
    """M-0623 / H-0583: refactor-resistant AST check that the optimizer
    audit emission happens unconditionally (under a sentinel actor)
    when portfolio.user_id is NULL.

    The slowapi-mocked endpoint coroutine isn't directly invokable in
    this test env (same constraint as TestTOCTOUConcurrencyGuard); the
    source-level checks here pair with the integration tests that run
    against a real env in CI.
    """

    def test_audit_emission_unconditional_in_optimizer_source(self):
        """The pre-audit code did `if portfolio_owner_id: log_audit_event(...)`
        which silently dropped the audit emission when user_id was NULL.
        After the fix, the call must happen unconditionally under a sentinel.
        """
        src = _function_source("portfolio_optimizer")
        assert "audit_user_id" in src
        assert "owner_resolved" in src
        assert "00000000-0000-0000-0000-000000000000" in src

    def test_weights_phantom_keys_dropped_in_optimizer_source(self):
        """C-0215: phantom key handling must be present."""
        src = _function_source("portfolio_optimizer")
        assert "phantom" in src.lower()

    def test_published_strategy_pool_is_limited_in_optimizer_source(self):
        """H-0590: published-strategy fetch must carry a .limit(...) clause."""
        src = _function_source("portfolio_optimizer")
        assert "_OPTIMIZER_PUBLISHED_LIMIT" in src
        assert ".limit(_OPTIMIZER_PUBLISHED_LIMIT)" in src


# ---------------------------------------------------------------------------
# C-0207 / H-1071 / H-0587 — verify_strategy + bridge contract checks
# ---------------------------------------------------------------------------

class TestVerifyStrategyContract:
    """Source-level contract guards for the verify_strategy + bridge
    endpoints. These complement the dynamic integration tests that
    run against a real environment in CI.
    """

    def test_per_email_rate_limit_check_is_invoked(self):
        """H-0593: per-email composite rate limit must be enforced
        BEFORE create_exchange so rotated-IP attackers can't burn the
        IP budget."""
        src = _function_source("verify_strategy")
        # The check must appear in the function and be invoked.
        assert "_check_verify_strategy_email_rate" in src
        # And we want the rate-limit check before create_exchange.
        idx_check = src.index("_check_verify_strategy_email_rate")
        idx_exchange = src.index("create_exchange")
        assert idx_check < idx_exchange, (
            "Per-email rate limit check must run BEFORE create_exchange "
            "to avoid wasted exchange handshakes on rate-limited requests."
        )

    def test_credential_logging_uses_redactor(self):
        """M-0628: CCXT exc strings must pass through _redact_credentials."""
        src = _function_source("verify_strategy")
        assert "_redact_credentials" in src
        # The exception logging must NOT do `%s, exc` with raw exc anywhere
        # near a logger call without redaction. Spot-check the key
        # validation path.
        assert "exc_info" in src or "logger.exception" in src

    def test_exchange_close_failure_is_logged(self):
        """M-0612: finally block must log close failures, not silently pass."""
        src = _function_source("verify_strategy")
        # Inside the finally, we want a logger.warning + type(exc) capture.
        assert "exchange.close() failed" in src

    def test_matching_status_is_in_response(self):
        """H-0582: response must carry matching_status to distinguish
        matched / no_match / matching_unavailable."""
        src = _function_source("verify_strategy")
        assert "matching_status" in src

    def test_match_threshold_is_named_constant(self):
        """H-0570 / M-0627: threshold must be the named module constant,
        not a bare 0.95 literal."""
        src = _function_source("verify_strategy")
        assert "_MATCH_CORRELATION_THRESHOLD" in src

    def test_match_candidate_pool_is_ordered_and_limited(self):
        """H-0587: catalog crossing the limit without ORDER BY returns a
        non-deterministic slice; ORDER BY created_at DESC makes it
        deterministic."""
        src = _function_source("verify_strategy")
        # The match block uses .order(...) and ._MATCH_CANDIDATE_LIMIT.
        assert "_MATCH_CANDIDATE_LIMIT" in src
        assert ".order(\"created_at\", desc=True)" in src


class TestPortfolioBridgeContract:
    def test_bridge_ownership_check_present(self):
        """H-1071: bridge must check .eq('user_id', req.user_id) on the
        portfolio lookup. A regression that drops this turns the service
        into a service-role bypass tool."""
        src = _function_source("portfolio_bridge")
        # The ownership join.
        assert ".eq(\"user_id\", req.user_id)" in src

    def test_bridge_underperformer_membership_check_present(self):
        """H-1071: bridge must reject requests where the underperformer
        is not in the portfolio."""
        src = _function_source("portfolio_bridge")
        assert "underperformer_strategy_id not in strategy_ids" in src

    def test_bridge_published_pool_limited(self):
        """H-1072: bridge candidate pool must be capped."""
        src = _function_source("portfolio_bridge")
        assert "_OPTIMIZER_PUBLISHED_LIMIT" in src
        assert ".limit(_OPTIMIZER_PUBLISHED_LIMIT)" in src


class TestAnalyticsResponseInline:
    def test_portfolio_analytics_returns_full_payload(self):
        """C-0216: previously the handler discarded the update_payload
        spread; after fix the response includes the metrics inline so
        callers don't need a separate polling round-trip."""
        src = _function_source("portfolio_analytics")
        # The spread must be present.
        assert "**result" in src


class TestResponseEnvelopeContract:
    """H-0586 / H-0591: source-level contract guards for the shared
    response envelopes added in models/schemas.py.

    Each endpoint must:
      1. Declare response_model on its @router.post decorator.
      2. Include "ok": True in its return dict.

    Without these, the OpenAPI schema is empty and a regression that
    drops analytics_id / verification_id / etc. from the response
    passes silently.
    """

    def test_portfolio_analytics_has_response_model(self):
        src = _function_source("portfolio_analytics")
        assert '"ok": True' in src

    def test_portfolio_optimizer_has_response_model(self):
        src = _function_source("portfolio_optimizer")
        assert '"ok": True' in src

    def test_portfolio_bridge_has_response_model(self):
        src = _function_source("portfolio_bridge")
        # Both branches (empty-candidates fast-path + main path).
        assert src.count('"ok": True') >= 2

    def test_verify_strategy_has_response_model(self):
        src = _function_source("verify_strategy")
        assert '"ok": True' in src

    def test_response_models_are_declared(self):
        """The response_model= annotation must be on the @router.post
        decorator for each endpoint."""
        # The decorator + response_model live at module scope; scan the raw source.
        assert "response_model=PortfolioAnalyticsResponse" in _PORTFOLIO_SRC
        assert "response_model=PortfolioOptimizerResponse" in _PORTFOLIO_SRC
        assert "response_model=PortfolioBridgeResponse" in _PORTFOLIO_SRC
        assert "response_model=VerifyStrategyResponse" in _PORTFOLIO_SRC


# ---------------------------------------------------------------------------
# SFH-3 — Alert-generation failure does not demote COMPLETE analytics row
# ---------------------------------------------------------------------------


class TestAlertFailureKeepsAnalyticsComplete:
    """Review SFH-3: _generate_alerts is called AFTER the analytics row is
    UPDATEd to 'complete'. If alert generation raises (e.g., transient
    Supabase failure on the dedup probe), the outer except in
    _compute_portfolio_analytics used to run _fail(), demoting a fully-
    computed COMPLETE row to FAILED.

    After the fix, _generate_alerts is wrapped in its own try/except so
    a downstream alert failure cannot corrupt the analytics row state.
    """

    @pytest.mark.asyncio
    async def test_alert_exception_does_not_mark_row_failed(self, monkeypatch):
        ret1 = _curve_records(seed=1)
        ret2 = _curve_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.5, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1},
            {"strategy_id": "s2", "returns_series": ret2},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        async def _fake_benchmark(symbol, **_kwargs):
            return None, True

        # Inject a poisoned _generate_alerts that raises.
        def _explode(*_a, **_kw):
            raise RuntimeError("simulated dedup probe failure")

        monkeypatch.setattr("routers.portfolio._generate_alerts", _explode)
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        # Compute returned successfully — exception was contained.
        assert result["analytics_id"] == "analytics-1"
        # The only update made to portfolio_analytics was to COMPLETE; no
        # subsequent _fail() should have run.
        update_calls = tables["portfolio_analytics"].update.call_args_list
        # First (and only) update is the COMPLETE write.
        assert len(update_calls) == 1, (
            "Expected exactly one UPDATE on portfolio_analytics (the COMPLETE "
            "transition). A second UPDATE would mean the row was demoted "
            "back to FAILED by the outer except."
        )
        first_update_payload = update_calls[0][0][0]
        assert first_update_payload["computation_status"] == "complete"


class TestAuditSkipAnnotations:
    """M-0613 / M-0622 / H-0588 — every @audit-skip marker in portfolio.py
    must be followed within 8 lines by a supabase mutation call.

    The audit pass flagged these markers as 'dead' because no scanner
    consumed them. This test makes them non-dead by enforcing the
    co-location contract: a marker without an immediate mutation
    nearby is a refactor mistake (the mutation was removed but the
    comment wasn't) and gets caught here.
    """

    def test_audit_skip_marker_is_co_located_with_mutation(self):
        lines = _PORTFOLIO_SRC.splitlines()
        skip_lines = [
            (i, line) for i, line in enumerate(lines)
            if "@audit-skip" in line
        ]
        # Spot-check at least one marker exists (regression: if all markers
        # are stripped the comment-discipline this test enforces vanishes).
        assert len(skip_lines) >= 1, (
            "Expected at least one @audit-skip marker in portfolio.py; "
            "removing them all is acceptable only when paired with a "
            "code-level audit-coverage scanner."
        )

        for idx, raw in skip_lines:
            # Look forward up to 20 lines for a supabase mutation. The
            # marker is typically followed by a few lines of rationale
            # comment before the call.
            window = "\n".join(lines[idx: idx + 20])
            assert (
                "supabase.table(" in window
                or "log_audit_event" in window
            ), (
                f"@audit-skip marker at portfolio.py line {idx + 1} is not "
                "co-located with a supabase mutation or log_audit_event call. "
                "Either remove the stale marker or restore the mutation it "
                "documents."
            )


# ---------------------------------------------------------------------------
# PI-07 — losing-racer 23505 on the computing-row INSERT maps to the EXISTING
# 409 (public route) / in_flight (cron) semantics — never a 500 / failed.
#
# Co-requisite of migration plan 98-01, which adds the partial UNIQUE index
# `portfolio_analytics_one_computing_per_portfolio`. Once that index exists the
# losing racer's `computing` INSERT raises a PostgREST error carrying
# code == "23505"; this code must absorb it into the pre-existing in-flight
# semantics rather than surfacing an unhandled 500.
# ---------------------------------------------------------------------------


class _StubApiError(Exception):
    """Mirror the supabase-py / PostgREST APIError shape the router detects:
    a plain exception exposing a `.code` attribute plus a message. Research
    Pitfall 4: supabase-py raises an APIError with `.code`, NOT a psycopg
    error — so we do NOT import psycopg here to build it."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


_PI07_409_DETAIL = "Analytics computation already in progress for this portfolio"


class TestPi07LosingRacer23505:
    """PI-07: the `computing`-row INSERT inside _compute_portfolio_analytics
    is the single choke point both the public route and cron route through.
    A 23505 there means another racer already holds the sole `computing`
    slot — surface it as the EXISTING in-flight 409, byte-identical detail."""

    def _supabase_where_insert_raises(self, exc: Exception):
        # portfolio_strategies / analytics_rows are irrelevant: the exception
        # fires at the very first call (the computing-row INSERT), so compute
        # never proceeds past it.
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=[],
            analytics_rows=[],
        )
        tables["portfolio_analytics"].insert.return_value.execute.side_effect = exc
        return sb

    @pytest.mark.asyncio
    async def test_23505_code_attr_maps_to_409(self):
        """Test A: exception with `.code == "23505"` (postgrest APIError
        shape) at the INSERT -> HTTPException 409 with the byte-identical
        in-flight detail string. Without the fix the raw APIError propagates
        (RED)."""
        exc = _StubApiError(
            'duplicate key value violates unique constraint '
            '"portfolio_analytics_one_computing_per_portfolio"',
            code="23505",
        )
        sb = self._supabase_where_insert_raises(exc)
        with patch("routers.portfolio.get_supabase", return_value=sb):
            with pytest.raises(HTTPException) as ei:
                await portfolio_mod._compute_portfolio_analytics("portfolio-1")
        assert ei.value.status_code == 409
        assert ei.value.detail == _PI07_409_DETAIL

    @pytest.mark.asyncio
    async def test_23505_message_fallback_maps_to_409(self):
        """Test B: `.code is None` but the message carries "duplicate key" —
        the message-only fallback in the repo's detection pattern must also
        map to 409 (some driver paths surface the SQLSTATE only in the text).
        RED without the fix."""
        exc = _StubApiError(
            'duplicate key value violates unique constraint '
            '"portfolio_analytics_one_computing_per_portfolio"',
            code=None,
        )
        sb = self._supabase_where_insert_raises(exc)
        with patch("routers.portfolio.get_supabase", return_value=sb):
            with pytest.raises(HTTPException) as ei:
                await portfolio_mod._compute_portfolio_analytics("portfolio-1")
        assert ei.value.status_code == 409
        assert ei.value.detail == _PI07_409_DETAIL

    @pytest.mark.asyncio
    async def test_non_23505_insert_error_propagates_unchanged(self):
        """Test C (narrow-swallow contract): a NON-23505 insert failure
        (e.g. RLS 42501) must propagate unchanged — NOT converted to 409,
        NOT swallowed. This test passes on the pre-fix baseline (no handling
        at all) AND after the fix (bare re-raise), pinning that the fix does
        not broaden the swallow (Rule 12 fail-loud)."""
        exc = _StubApiError(
            "new row violates row-level security policy for table "
            '"portfolio_analytics"',
            code="42501",
        )
        sb = self._supabase_where_insert_raises(exc)
        with patch("routers.portfolio.get_supabase", return_value=sb):
            with pytest.raises(_StubApiError) as ei:
                await portfolio_mod._compute_portfolio_analytics("portfolio-1")
        # Same object, unconverted — never an HTTPException.
        assert ei.value.code == "42501"
        assert not isinstance(ei.value, HTTPException)


class TestPi07CronLosingRacerInFlightBucket:
    """PI-07 cron side: when _compute_portfolio_analytics raises the 409
    (losing racer), _guarded_recompute must classify it into the EXISTING
    `in_flight` outcome bucket — never `failed`. Exercised end-to-end through
    cron_sync(), mirroring TestRecomputeHttp400IsSkipped in test_cron_router.

    Uses the lazy-import pattern the cron tests use (routers.portfolio is
    unloaded/reloaded by sibling tests; pin it before patching)."""

    @pytest.mark.asyncio
    async def test_cron_409_lands_in_in_flight_not_failed(self):
        import routers.portfolio as _portfolio_mod
        sys.modules["routers.portfolio"] = _portfolio_mod

        from routers import cron as cron_mod
        from tests.test_cron_router import (
            _make_mock_supabase_for_cron_sync,
            _stub_validation,
        )

        mock_supabase = _make_mock_supabase_for_cron_sync(
            keys_data=[
                {
                    "id": "key-1",
                    "exchange": "binance",
                    "last_sync_at": None,
                    "strategies": [{"id": "strat-A", "status": "published"}],
                }
            ],
            ps_data=[{"portfolio_id": "p1"}, {"portfolio_id": "p2"}],
            # pa_data defaults to [] => in-flight pre-SELECT returns empty, so
            # compute IS invoked and raises the 409 we route on (not the
            # pre-SELECT in_flight short-circuit).
        )

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        async def _compute(pid: str):
            if pid == "p1":
                raise cron_mod.HTTPException(
                    status_code=409, detail=_PI07_409_DETAIL
                )
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 _portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute),
             ):
            response = await cron_mod.cron_sync()

        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 2
        # p1 -> 409 -> in_flight bucket; p2 -> ok
        assert pr["in_flight"] == 1
        assert pr["ok"] == 1
        assert pr["failed"] == 0
        assert pr["skipped"] == 0
        assert pr["failures"] == []


# ---------------------------------------------------------------------------
# Phase 166.1 round-1 WR-03 / SFH MEDIUM-1 — the book-level average
# correlation states how many pairs it covers
# ---------------------------------------------------------------------------

class TestAvgPairwiseCorrelationPairCount:
    """C1 masks a leg that does not disperse, and the average skips its pairs,
    so the KPI labelled as the whole book is computed over a subset. The
    router must record pairs used and pairs total in data_quality beside it."""

    @staticmethod
    async def _compute(returns: list[list[dict]]) -> dict:
        ids = [f"s{i + 1}" for i in range(len(returns))]
        ps = [
            {"strategy_id": sid, "current_weight": 1.0 / len(ids),
             "strategies": {"id": sid, "name": sid.upper()}}
            for sid in ids
        ]
        sa_rows = [
            {"strategy_id": sid, "returns_series": r,
             "total_aum": 100.0}
            for sid, r in zip(ids, returns)
        ]
        sb, _ = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa_rows)

        async def _fake_benchmark(symbol, **_kwargs):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            return await portfolio_mod._compute_portfolio_analytics("portfolio-1")

    @pytest.mark.asyncio
    async def test_a_flat_leg_is_counted_out_of_the_average(self):
        flat = _curve_records(base=0.0, vol=0.0, seed=3)
        result = await self._compute([_curve_records(seed=1), _curve_records(seed=2), flat])
        dq = result["data_quality"]
        assert dq["avg_pairwise_correlation_pairs_used"] == 1
        assert dq["avg_pairwise_correlation_pairs_total"] == 3
        assert result["avg_pairwise_correlation"] is not None

    @pytest.mark.asyncio
    async def test_a_dispersing_book_uses_every_pair(self):
        result = await self._compute([_curve_records(seed=1), _curve_records(seed=2)])
        dq = result["data_quality"]
        assert dq["avg_pairwise_correlation_pairs_used"] == 1
        assert dq["avg_pairwise_correlation_pairs_total"] == 1
