"""Phase 164.6.6.2.2 review WR-03: the per-router wiring of the curve METHOD (D-05).

``strategy_analytics.data_quality_flags.cumulative_method`` says how a stored
``returns_series`` curve is inverted (``simple`` by difference, ``geometric`` by
ratio). The router has to SELECT that column beside the curve and hand it to
``daily_returns_from_row``. Every other router fixture is geometric (or carries
empty flags), and an absent stamp reads geometric silently by design (D-05), so
a router that dropped the column, or stopped honouring it, read the same
numbers and stayed green.

These tests stand a SIMPLE-method curve behind each router's own select and
assert on what the router hands its consumer. Two things make them able to fail:

* the fake PostgREST client PROJECTS rows by the select string, as the real one
  does, so a select that omits ``data_quality_flags`` returns rows without it
  (a MagicMock chain answers the same rows whatever was selected);
* the curve's levels read by ratio give a different series than by difference,
  and the test pins the difference reading, so the geometric default is not
  accidentally right (``test_the_oracle_separates_the_two_methods``).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.wealth_returns import daily_returns_from_row
from tests._curve_fixtures import curve_from_returns

# Day 0's return builds the first stored level, so the curve is 1.0, 1.2, 1.1,
# 1.25 and reads back as the day 1..3 returns below (day 0 has no predecessor).
_DATES = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]
_RUN_RETURNS = [0.0, 0.20, -0.10, 0.15]
_SIMPLE_READ = [0.20, -0.10, 0.15]  # by difference: what the writer was given
# by ratio on the same levels: 1.2/1 - 1, 1.1/1.2 - 1, 1.25/1.1 - 1
_GEOMETRIC_READ = [0.20, 1.1 / 1.2 - 1.0, 1.25 / 1.1 - 1.0]
_SIMPLE_FLAGS: dict[str, Any] = {"cumulative_method": "simple"}


def _simple_curve() -> list[dict[str, Any]]:
    return curve_from_returns(_RUN_RETURNS, _DATES, method="simple")


def _simple_row(sid: str) -> dict[str, Any]:
    return {
        "strategy_id": sid,
        "returns_series": _simple_curve(),
        "daily_returns": None,
        "data_quality_flags": dict(_SIMPLE_FLAGS),
    }


def _assert_simple_reading(series: pd.Series, what: str) -> None:
    assert [d.strftime("%Y-%m-%d") for d in series.index] == _DATES[1:], what
    assert list(series.to_numpy()) == pytest.approx(_SIMPLE_READ, abs=1e-12), (
        f"{what}: a simple-method curve was not read by difference. Read by ratio "
        f"it would be {[round(v, 6) for v in _GEOMETRIC_READ]}: the router dropped "
        "data_quality_flags from its select or stopped passing the method (WR-03)"
    )


# ---------------------------------------------------------------------------
# A fake PostgREST client that honours the select column list
# ---------------------------------------------------------------------------


class _Query:
    """One table query. ``.select(cols)`` fixes the projection, ``.eq`` /
    ``.in_`` narrow on a column the row HAS (PostgREST may filter on a column it
    does not return), every other builder method returns the query, and
    ``.execute()`` returns only the selected columns of each row."""

    def __init__(self, table: str, data: Any, selected: list[tuple[str, str]]) -> None:
        self._table = table
        self._data = data
        self._selected = selected
        self._cols: list[str] | None = None
        self._single = False
        self._negate = False

    @property
    def not_(self) -> "_Query":
        self._negate = True
        return self

    def select(self, columns: str = "*", *_a: Any, **_k: Any) -> "_Query":
        self._selected.append((self._table, columns))
        self._cols = None if columns.strip() == "*" else [c.strip() for c in columns.split(",")]
        return self

    def _narrow(self, col: str, keep: Any) -> None:
        if isinstance(self._data, list):
            self._data = [
                r for r in self._data if col not in r or keep(r[col]) != self._negate
            ]
        self._negate = False

    def eq(self, col: str, value: Any) -> "_Query":
        self._narrow(col, lambda v: v == value)
        return self

    def in_(self, col: str, values: Any) -> "_Query":
        allowed = set(values)
        self._narrow(col, lambda v: v in allowed)
        return self

    def single(self) -> "_Query":
        self._single = True
        return self

    maybe_single = single

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._cols is None:
            return dict(row)
        return {c: row[c] for c in self._cols if c in row}

    def execute(self) -> Any:
        if isinstance(self._data, list):
            projected = [self._project(r) for r in self._data]
            if self._single:
                return MagicMock(data=projected[0]) if projected else None
            return MagicMock(data=projected)
        if self._data is None:
            return None if self._single else MagicMock(data=[])
        return MagicMock(data=self._project(self._data))

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        return lambda *_a, **_k: self


class _ProjectingSupabase:
    def __init__(self, tables: dict[str, Any]) -> None:
        self._tables = tables
        self.selected: list[tuple[str, str]] = []

    def table(self, name: str) -> _Query:
        data = self._tables.get(name, [])
        return _Query(name, [dict(r) for r in data] if isinstance(data, list) else data, self.selected)


def test_the_fake_projects_by_the_select_string() -> None:
    """The fake is only evidence if a trimmed select visibly loses the column."""
    sb = _ProjectingSupabase({"strategy_analytics": [_simple_row("a")]})
    full = sb.table("strategy_analytics").select(
        "strategy_id, returns_series, daily_returns, data_quality_flags"
    ).execute().data[0]
    trimmed = sb.table("strategy_analytics").select(
        "strategy_id, returns_series, daily_returns"
    ).execute().data[0]
    assert full["data_quality_flags"] == _SIMPLE_FLAGS
    assert "data_quality_flags" not in trimmed


def test_the_oracle_separates_the_two_methods() -> None:
    """The simple and geometric readings of this curve must differ, or a router
    that read by ratio would still match the expectation."""
    row = _simple_row("a")
    simple = daily_returns_from_row(row, name="a")
    geometric = daily_returns_from_row({**row, "data_quality_flags": None}, name="a")
    assert simple is not None and geometric is not None
    _assert_simple_reading(simple, "boundary")
    assert max(abs(simple.to_numpy() - geometric.to_numpy())) > 1e-2


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_simulator_reads_a_simple_curve_by_difference() -> None:
    from routers import simulator as simulator_router
    from services import simulator_scoring

    sb = _ProjectingSupabase(
        {
            "portfolios": {"id": "p-1"},
            "strategies": {"id": "c-1", "name": "Cand", "status": "published"},
            "portfolio_strategies": [{"strategy_id": "s-1", "current_weight": 1.0}],
            "strategy_analytics": [_simple_row("s-1"), _simple_row("c-1")],
        }
    )
    spy = MagicMock(wraps=simulator_scoring.simulate_add_candidate)
    simulator_router._simulator_user_attempts.clear()
    request = MagicMock()
    request.headers = {}
    req = simulator_router.SimulatorRequest(
        portfolio_id="p-1", candidate_strategy_id="c-1", user_id="u-wr03-sim"
    )
    with patch.object(simulator_router, "get_supabase", return_value=sb), \
         patch.object(simulator_router, "simulate_add_candidate", spy), \
         patch.object(simulator_router, "log_audit_event"):
        await simulator_router.portfolio_simulator.__wrapped__(request, req)

    spy.assert_called_once()
    kwargs = spy.call_args.kwargs
    _assert_simple_reading(kwargs["portfolio_returns"]["s-1"], "simulator portfolio leg")
    _assert_simple_reading(kwargs["candidate_returns"], "simulator candidate")


# ---------------------------------------------------------------------------
# Match: the allocator's book and the candidate universe
# ---------------------------------------------------------------------------


def test_match_allocator_book_reads_a_simple_curve_by_difference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from routers.match import _load_allocator_context

    sb = _ProjectingSupabase(
        {
            "portfolios": [{"id": "pf-1", "user_id": "alloc-1"}],
            "portfolio_strategies": [
                {
                    "strategy_id": "s-1",
                    "current_weight": 1.0,
                    "portfolio_id": "pf-1",
                    "allocated_amount": None,
                }
            ],
            "strategy_analytics": [_simple_row("s-1")],
        }
    )
    monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

    ctx = _load_allocator_context("alloc-1")

    assert "s-1" in ctx["portfolio_returns"], "the book's curve was not read at all"
    _assert_simple_reading(ctx["portfolio_returns"]["s-1"], "match allocator book")


def test_match_candidate_universe_reads_a_simple_curve_by_difference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from routers.match import _load_candidate_universe

    sb = _ProjectingSupabase(
        {
            "strategies": [
                {
                    "id": "c-1",
                    "name": "Cand",
                    "codename": None,
                    "strategy_types": ["systematic"],
                    "subtypes": [],
                    "supported_exchanges": ["binance"],
                    "status": "published",
                    "aum": 0,
                    "max_capacity": 0,
                    "user_id": "mgr-1",
                    "start_date": None,
                    "is_example": False,
                }
            ],
            "strategy_analytics": [
                {**_simple_row("c-1"), "sharpe": 1.0, "max_drawdown": -0.1}
            ],
        }
    )
    monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

    universe = _load_candidate_universe()

    assert "c-1" in universe["returns_by_id"], "the candidate's curve was not read at all"
    _assert_simple_reading(universe["returns_by_id"]["c-1"], "match candidate universe")


# ---------------------------------------------------------------------------
# Portfolio: optimizer (portfolio + candidate pool) and bridge
# ---------------------------------------------------------------------------


def _portfolio_tables() -> dict[str, Any]:
    return {
        "portfolios": {"id": "pf", "user_id": "u"},
        "portfolio_strategies": [{"strategy_id": "s-1", "current_weight": 1.0}],
        "strategy_analytics": [_simple_row("s-1"), _simple_row("cand-1")],
        "strategies": [{"id": "cand-1", "name": "Cand"}],
        "portfolio_analytics": [],
    }


@pytest.mark.asyncio
async def test_portfolio_optimizer_reads_simple_curves_by_difference() -> None:
    from routers import portfolio as portfolio_mod

    seen: dict[str, dict[str, pd.Series]] = {}

    def _spy(portfolio_returns: Any, candidate_returns: Any, weights: Any) -> list[Any]:
        seen["p"], seen["c"] = portfolio_returns, candidate_returns
        return []

    req = MagicMock(portfolio_id="pf", user_id="u", weights=None)
    with patch.object(portfolio_mod, "get_supabase", return_value=_ProjectingSupabase(_portfolio_tables())), \
         patch.object(portfolio_mod, "get_btc_closes", AsyncMock(return_value=None)), \
         patch.object(portfolio_mod, "find_improvement_candidates", side_effect=_spy), \
         patch.object(portfolio_mod, "log_audit_event"):
        await portfolio_mod.portfolio_optimizer.__wrapped__(MagicMock(), req)

    _assert_simple_reading(seen["p"]["s-1"], "optimizer portfolio leg")
    _assert_simple_reading(seen["c"]["cand-1"], "optimizer candidate pool")


@pytest.mark.asyncio
async def test_portfolio_bridge_reads_simple_curves_by_difference() -> None:
    import services.bridge_scoring as bridge_scoring_mod
    from routers import portfolio as portfolio_mod

    seen: dict[str, dict[str, pd.Series]] = {}

    def _spy(portfolio_returns: Any, candidate_returns: Any, weights: Any, incumbent: Any) -> list[Any]:
        seen["p"], seen["c"] = portfolio_returns, candidate_returns
        return []

    req = MagicMock(portfolio_id="pf", user_id="bridge-user-wr03", underperformer_strategy_id="s-1")
    with patch.object(portfolio_mod, "get_supabase", return_value=_ProjectingSupabase(_portfolio_tables())), \
         patch.object(portfolio_mod, "get_btc_closes", AsyncMock(return_value=None)), \
         patch.object(bridge_scoring_mod, "find_replacement_candidates", side_effect=_spy), \
         patch.object(portfolio_mod, "log_audit_event"):
        await portfolio_mod.portfolio_bridge.__wrapped__(MagicMock(), req)

    _assert_simple_reading(seen["p"]["s-1"], "bridge portfolio leg")
    _assert_simple_reading(seen["c"]["cand-1"], "bridge candidate pool")
