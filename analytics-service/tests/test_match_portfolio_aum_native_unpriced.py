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

import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb

ALLOCATOR = "alloc-1"
MT5_KEY = "00000000-0000-0000-0000-0000000000a1"
OKX_KEY = "00000000-0000-0000-0000-0000000000a2"
BTC_USD = 26_100.0
OKX_USD = 1_000.0


def _holding(key: str, venue: str, symbol: str, asof: str, value: float) -> dict[str, Any]:
    return {
        "allocator_id": ALLOCATOR,
        "api_key_id": key,
        "venue": venue,
        "symbol": symbol,
        "holding_type": "spot",
        "value_usd": value,
        "mark_price": 100.0,
        "side": "flat",
        "unrealized_pnl_usd": None,
        "asof": asof,
        "updated_at": f"{asof}T04:00:00+00:00",
    }


def _marker(key: str, day: str) -> dict[str, Any]:
    return {
        "allocator_id": ALLOCATOR,
        "kind": f"native_unpriced:{key}",
        "payload": {"native_unpriced": True, "asof": day},
    }


def _book(marker_day: str | None) -> FakeDb:
    return FakeDb(
        {
            "api_keys": [
                {"id": MT5_KEY, "user_id": ALLOCATOR, "exchange": "mt5"},
                {"id": OKX_KEY, "user_id": ALLOCATOR, "exchange": "okx"},
            ],
            "allocator_holdings": [
                _holding(MT5_KEY, "mt5", "BTC", "2026-10-09", BTC_USD),
                _holding(OKX_KEY, "okx", "USDT", "2026-10-10", OKX_USD),
            ],
            "allocator_equity_snapshots": [],
            "allocator_equity_derived": [_marker(MT5_KEY, marker_day)] if marker_day else [],
        }
    )


def _aum(monkeypatch: pytest.MonkeyPatch, db: FakeDb) -> dict[str, Any]:
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
    db.errors["allocator_equity_derived"] = RuntimeError("marker table unavailable")

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        ctx = _aum(monkeypatch, db)

    assert ctx["portfolio_aum"] == pytest.approx(OKX_USD + BTC_USD)
    assert any(
        rec.levelname == "ERROR" and "native-unpriced" in rec.getMessage()
        for rec in caplog.records
    )
