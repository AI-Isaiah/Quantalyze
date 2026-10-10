"""164.6.6.2.1 R2-WR-01 (D-02, D-08, D-17): ``portfolio_aum`` honours the native-unpriced marker.

``_load_holding_portfolio_context`` collapses ``allocator_holdings`` to the latest row per
(venue, symbol, holding_type). A BTC-denominated MT5 account whose latest completed day has
no stored close polls to NO row, so its earlier row (priced at an older close) stays the
latest and was summed into the match scorer's AUM and weights while the dashboard said the
account was left out. The poll's service-written ``native_unpriced:<key>`` record dated
after that row removes it, through the same reader the daily refresh uses.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

from routers import match as match_mod

ALLOCATOR = "alloc-1"
MT5_KEY = "00000000-0000-0000-0000-0000000000a1"
OKX_KEY = "00000000-0000-0000-0000-0000000000a2"
BTC_USD = 26_100.0
OKX_USD = 1_000.0


class _Query:
    def __init__(self, db: "_Db", name: str) -> None:
        self._db = db
        self._name = name
        self._eq: list[tuple[str, Any]] = []
        self._in: list[tuple[str, list[Any]]] = []
        self._desc: tuple[str, bool] | None = None

    def select(self, *_a: Any, **_k: Any) -> "_Query":
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._eq.append((col, val))
        return self

    def in_(self, col: str, vals: Any) -> "_Query":
        self._in.append((col, list(vals)))
        return self

    def order(self, col: str, desc: bool = False) -> "_Query":
        self._desc = (col, desc)
        return self

    def execute(self) -> Any:
        if self._name == "allocator_equity_derived" and self._db.derived_error is not None:
            raise self._db.derived_error
        data = [
            dict(r)
            for r in self._db.tables.get(self._name, [])
            if all(r.get(c) == v for c, v in self._eq)
            and all(r.get(c) in vs for c, vs in self._in)
        ]
        if self._desc is not None:
            col, desc = self._desc
            data.sort(key=lambda r: r[col], reverse=desc)
        return type("R", (), {"data": data})()


class _Db:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables
        self.derived_error: Exception | None = None

    def table(self, name: str) -> _Query:
        return _Query(self, name)


def _holding(key: str, venue: str, symbol: str, asof: str, value: float) -> dict[str, Any]:
    return {
        "allocator_id": ALLOCATOR,
        "api_key_id": key,
        "venue": venue,
        "symbol": symbol,
        "holding_type": "spot",
        "value_usd": value,
        "asof": asof,
    }


def _marker(key: str, day: str) -> dict[str, Any]:
    return {
        "allocator_id": ALLOCATOR,
        "kind": f"native_unpriced:{key}",
        "payload": {"native_unpriced": True, "asof": day},
    }


def _book(marker_day: str | None) -> _Db:
    return _Db(
        {
            "allocator_holdings": [
                _holding(MT5_KEY, "mt5", "BTC", "2026-10-09", BTC_USD),
                _holding(OKX_KEY, "okx", "USDT", "2026-10-10", OKX_USD),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [_marker(MT5_KEY, marker_day)] if marker_day else [],
        }
    )


@pytest.fixture(autouse=True)
def _warm_series(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every holding clears the 30-day warm-up gate, so AUM is the plain sum."""
    series = pd.Series([0.001] * 40)
    monkeypatch.setattr(match_mod, "reconstruct_symbol_returns", lambda _s, _sym: series)


def _aum(monkeypatch: pytest.MonkeyPatch, db: _Db) -> dict[str, Any]:
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    return match_mod._load_holding_portfolio_context(ALLOCATOR)


def test_a_marker_dated_after_the_priced_row_removes_the_account_from_aum_and_weights(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _aum(monkeypatch, _book("2026-10-10"))

    assert ctx["portfolio_aum"] == pytest.approx(OKX_USD), (
        "the unpriced account was summed at its older close-priced row"
    )
    assert list(ctx["portfolio_weights"]) == ["holding:okx:USDT:spot"]
    assert ctx["portfolio_weights"]["holding:okx:USDT:spot"] == pytest.approx(1.0)


@pytest.mark.parametrize(
    "marker_day",
    [
        pytest.param(None, id="no-marker"),
        pytest.param("2026-10-09", id="marker-on-the-rows-own-day"),
        pytest.param("2026-10-05", id="marker-older-than-the-row"),
    ],
)
def test_a_marker_that_does_not_postdate_the_row_hides_nothing(
    monkeypatch: pytest.MonkeyPatch, marker_day: str | None
) -> None:
    ctx = _aum(monkeypatch, _book(marker_day))

    assert ctx["portfolio_aum"] == pytest.approx(OKX_USD + BTC_USD)


def test_a_failed_marker_read_keeps_the_rows_and_logs_at_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The request-time scorer must not blank on a marker-table outage: it keeps the rows
    as they were before the marker existed, and the error log is what reaches Sentry."""
    db = _book("2026-10-10")
    db.derived_error = RuntimeError("marker table unavailable")

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        ctx = _aum(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(OKX_USD + BTC_USD)
    assert any(
        rec.levelname == "ERROR" and "native-unpriced" in rec.getMessage()
        for rec in caplog.records
    )
