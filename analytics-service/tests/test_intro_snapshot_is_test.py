"""TODOS 194.1-PY-INTRO-PORTFOLIO-IS-TEST: the Python intro snapshot never freezes a what-if book.

A saved what-if scenario is an ``is_test=true`` portfolio. Its Sharpe, max drawdown and top/bottom
lists are made up, and ``contact_requests.portfolio_snapshot`` is sent to a manager as the
allocator's real book. ``run_compute_intro_snapshot_job`` must therefore pick the newest REAL
(``is_test=false``) portfolio, the same rule as the TS producer ``computePortfolioSnapshot``
(``src/lib/intro/snapshot.ts``, audit G8.E.1 / P338).

The fake below honours ``eq`` filters, ``order`` and ``limit``, so the newest-portfolio pick is
real: with the scenario book created after the real one, dropping the ``is_test`` filter from
``_load_portfolio`` freezes the scenario's KPIs and this test goes red.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from services.job_worker import run_compute_intro_snapshot_job


class _Query:
    def __init__(self, data: list[dict[str, Any]], store: "_Fake", table: str) -> None:
        self._rows = list(data)
        self._store = store
        self._table = table
        self._update: dict[str, Any] | None = None
        self._single = False

    def select(self, *_: Any, **__: Any) -> "_Query":
        return self

    def update(self, payload: dict[str, Any]) -> "_Query":
        self._update = payload
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self._rows = [r for r in self._rows if r.get(column) == value]
        return self

    def in_(self, column: str, values: list[Any]) -> "_Query":
        self._rows = [r for r in self._rows if r.get(column) in values]
        return self

    def gte(self, *_: Any) -> "_Query":
        return self

    def order(self, column: str, desc: bool = False, **__: Any) -> "_Query":
        self._rows.sort(key=lambda r: r.get(column) or "", reverse=desc)
        return self

    def limit(self, n: int) -> "_Query":
        self._rows = self._rows[:n]
        return self

    def maybe_single(self) -> "_Query":
        self._single = True
        return self

    def execute(self) -> Any:
        if self._update is not None:
            self._store.updates.append((self._table, self._update))
            return SimpleNamespace(data=[], count=None)
        if self._single:
            return SimpleNamespace(data=self._rows[0] if self._rows else None, count=None)
        return SimpleNamespace(data=self._rows, count=len(self._rows))


class _Fake:
    def __init__(self, data: dict[str, list[dict[str, Any]]]) -> None:
        self.data = data
        self.updates: list[tuple[str, dict[str, Any]]] = []

    def table(self, name: str) -> _Query:
        return _Query(self.data.get(name, []), self, name)


def _link(portfolio_id: str, sid: str, name: str) -> dict[str, Any]:
    return {
        "portfolio_id": portfolio_id,
        "strategy_id": sid,
        "current_weight": 1.0,
        "allocated_amount": 100,
        "strategies": {"id": sid, "name": name, "asset_class": "crypto"},
    }


async def test_a_what_if_book_is_never_snapshotted_for_a_manager() -> None:
    fake = _Fake(
        {
            "contact_requests": [
                {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
            ],
            # The scenario book is the NEWEST portfolio, so a pick by created_at alone takes it.
            "portfolios": [
                {"id": "pf-real", "user_id": "alloc-1", "is_test": False,
                 "created_at": "2026-01-01T00:00:00Z"},
                {"id": "pf-whatif", "user_id": "alloc-1", "is_test": True,
                 "created_at": "2026-06-01T00:00:00Z"},
            ],
            "portfolio_analytics": [
                {"portfolio_id": "pf-real", "portfolio_sharpe": 0.9,
                 "portfolio_max_drawdown": -0.21, "computed_at": "2026-06-02"},
                {"portfolio_id": "pf-whatif", "portfolio_sharpe": 4.2,
                 "portfolio_max_drawdown": -0.01, "computed_at": "2026-06-02"},
            ],
            "portfolio_strategies": [
                _link("pf-real", "s-real", "Real leg"),
                _link("pf-whatif", "s-dream", "Hypothetical leg"),
            ],
            "strategy_analytics": [
                {"strategy_id": "s-real", "sharpe": 0.9},
                {"strategy_id": "s-dream", "sharpe": 4.2},
            ],
            "portfolio_alerts": [],
        }
    )
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_compute_intro_snapshot_job(
            {
                "id": "job-1",
                "kind": "compute_intro_snapshot",
                "strategy_id": "strat-target",
                "metadata": {"contact_request_id": "cr-1"},
            }
        )
    assert result.outcome.name == "DONE"
    (_, payload), = [u for u in fake.updates if u[0] == "contact_requests"]
    snap = payload["portfolio_snapshot"]

    # The manager reads the allocator's REAL book, never the scenario's made-up KPIs.
    assert snap["sharpe"] == 0.9
    assert snap["max_drawdown"] == -0.21
    assert [r["strategy_name"] for r in snap["top_3_strategies"]] == ["Real leg"]

