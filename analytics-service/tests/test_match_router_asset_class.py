"""194 round 3 WR-03: the router hands the match engine each strategy's ``asset_class``.

The engine gates a candidate's "Lifts portfolio Sharpe" reason on the real bound of its own class
and of the book's (``candidate_asset_class`` / ``book_asset_classes``, round-2 WR-02). Its tests
pass those arguments directly, so nothing proved the ROUTER fills them in. If a select string lost
``asset_class`` (or the ``strategies(asset_class)`` embed), every record would read an unknown
class, which counts as crypto, and a traditional strategy with 60 to 89 days would silently lose
its lift reason again with every engine test green.

The fake below applies PostgREST's projection: a column or an embed that the select string does
not name is NOT returned. So these tests go RED when a select string drops the class, and also
when the loader stops copying it onto the candidate and book-leg dicts.
"""

from __future__ import annotations

from typing import Any

import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb, FakeQuery

ALLOCATOR = "alloc-1"


def _split_select(select: str) -> list[str]:
    """Split a PostgREST select list on top-level commas (an embed's own commas stay inside)."""
    parts: list[str] = []
    depth = 0
    cur = ""
    for ch in select:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


class _ProjectingQuery(FakeQuery):
    """A FakeQuery that returns only the columns and embeds its select string names."""

    def __init__(self, db: FakeDb, name: str) -> None:
        super().__init__(db, name)
        self._select: str | None = None

    def select(self, *args: Any, **kwargs: Any) -> "_ProjectingQuery":
        self._select = args[0] if args else None
        return self

    def execute(self) -> Any:
        response = super().execute()
        if self._select is None or self._select.strip() == "*":
            return response
        columns: set[str] = set()
        embeds: dict[str, set[str]] = {}
        for part in _split_select(self._select):
            if "(" in part:
                name, inner = part.split("(", 1)
                embeds[name.strip()] = {c.strip() for c in inner.rstrip(")").split(",")}
            else:
                columns.add(part)

        def project(row: dict[str, Any]) -> dict[str, Any]:
            out = {k: v for k, v in row.items() if k in columns}
            for name, cols in embeds.items():
                embedded = row.get(name)
                if isinstance(embedded, dict):
                    out[name] = {k: v for k, v in embedded.items() if k in cols}
            return out

        data = response.data
        response.data = project(data) if isinstance(data, dict) else [project(r) for r in data]
        return response


class _ProjectingDb(FakeDb):
    def table(self, name: str) -> FakeQuery:
        return _ProjectingQuery(self, name)


def test_candidate_universe_carries_each_strategys_asset_class(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def strategy(sid: str, asset_class: str) -> dict[str, Any]:
        return {
            "id": sid,
            "name": f"Strategy {sid}",
            "codename": None,
            "strategy_types": ["systematic"],
            "subtypes": [],
            "supported_exchanges": ["binance"],
            "status": "published",
            "aum": 0,
            "max_capacity": 0,
            "user_id": "manager-1",
            "start_date": "2024-01-01",
            "is_example": False,
            "asset_class": asset_class,
        }

    db = _ProjectingDb(
        {
            "strategies": [strategy("s-trad", "traditional"), strategy("s-crypto", "crypto")],
            "strategy_analytics": [],
        }
    )
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)

    universe = match_mod._load_candidate_universe()

    # Each class reaches its own candidate dict, the one the engine reads as
    # ``cand.get("asset_class")``. Neither row can pass by the other's value.
    assert universe["strategies_by_id"]["s-trad"]["asset_class"] == "traditional"
    assert universe["strategies_by_id"]["s-crypto"]["asset_class"] == "crypto"


def test_allocator_book_legs_carry_each_strategys_asset_class(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")
    db = _ProjectingDb(
        {
            "portfolios": [{"id": "pf-1", "user_id": ALLOCATOR}],
            "portfolio_strategies": [
                {
                    "strategy_id": "s-trad",
                    "portfolio_id": "pf-1",
                    "current_weight": 0.5,
                    "allocated_amount": 5000.0,
                    "strategies": {"asset_class": "traditional"},
                },
                {
                    "strategy_id": "s-crypto",
                    "portfolio_id": "pf-1",
                    "current_weight": 0.5,
                    "allocated_amount": 5000.0,
                    "strategies": {"asset_class": "crypto"},
                },
            ],
            "strategy_analytics": [],
            "api_keys": [],
            "allocator_holdings": [],
            "allocator_equity_derived": [],
            "match_decisions": [],
            "allocator_preferences": [],
        }
    )
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)

    ctx = match_mod._load_allocator_context(ALLOCATOR)

    # The same mapping the engine builds into ``book_asset_classes`` (match_engine.py).
    classes = {ps["strategy_id"]: ps.get("asset_class") for ps in ctx["portfolio_strategies"]}
    assert classes == {"s-trad": "traditional", "s-crypto": "crypto"}
