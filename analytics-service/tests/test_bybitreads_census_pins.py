"""Phase 231 BYBITREADS: pins for the census rows the phase decides and does not change.

Each test holds one boundary written down in ``231-CENSUS.md`` (rows C18, C19 and C27) so a later
change to it is deliberate, never an accident. The payloads are Bybit-documented shapes (the V5
closed-pnl list row and the V5 transaction-log row), not the parser's own field names.

These tests pin CURRENT behaviour and pass on today's code. Two of them characterise a defect that
the census routes to another owner rather than fixes here:

* C19 is a coin-denominated inverse funding amount summed at face value. When a currency
  conversion lands, the owner flips ``test_census_c19_*`` deliberately; it is not a regression.
* C27 is the first Bybit funding walk being longer than the ``sync_funding`` handler budget.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

DAY_MS = 24 * 60 * 60 * 1000


def _now_ms() -> int:
    return int(time.time() * 1000)


@pytest.mark.asyncio
async def test_census_c18_bybit_closed_pnl_is_read_for_category_linear_only() -> None:
    """C18: inverse realized P&L is never read by the derive. The probe measured no inverse
    closed P&L on the one live key (`inverse_closed_pnl_30d=0`), so the gap is recorded and routed,
    not fixed. This pin makes widening the read to `inverse` a deliberate act: that rows' unit is
    the coin, so it needs a rescale first (see the C17 comment on `_BYBIT_FILL_CATEGORIES`)."""
    from services.exchange import fetch_daily_pnl

    created_ms = _now_ms() - 9 * DAY_MS
    # The documented V5 /v5/position/closed-pnl list row, string-valued as the venue sends it.
    closed_row = {
        "symbol": "BTCUSDT",
        "orderType": "Market",
        "leverage": "10",
        "updatedTime": str(created_ms + 1000),
        "side": "Sell",
        "orderId": "closed-1",
        "closedPnl": "9.0",
        "avgEntryPrice": "100",
        "qty": "10",
        "cumEntryValue": "1000",
        "createdTime": str(created_ms),
        "orderPrice": "101",
        "closedSize": "10",
        "avgExitPrice": "101",
        "execType": "Trade",
        "fillCount": "1",
        "cumExitValue": "1010",
        "openFee": "0.5",
        "closeFee": "0.5",
    }
    requests: list[dict[str, Any]] = []

    async def _closed_pnl(params: dict[str, Any]) -> dict[str, Any]:
        requests.append(dict(params))
        rows = [closed_row] if len(requests) == 1 else []
        return {"result": {"list": rows, "nextPageCursor": ""}}

    exchange = MagicMock()
    exchange.id = "bybit"
    exchange.private_get_v5_position_closed_pnl = AsyncMock(side_effect=_closed_pnl)

    records = await fetch_daily_pnl(exchange, since_ms=_now_ms() - 10 * DAY_MS)

    assert len(records) == 1, "the documented row must be read, or the pin proves nothing"
    assert len(requests) >= 2, "a ten-day start spans at least two seven-day windows"
    categories = {request["category"] for request in requests}
    assert categories == {"linear"}, (
        f"the Bybit closed-pnl read asked for {sorted(categories)}; census row C18 decides it is "
        "linear only (USDT and USDC perps) until an inverse rescale exists"
    )
    assert "inverse" not in categories


@pytest.mark.asyncio
async def test_census_c19_an_inverse_funding_amount_is_summed_at_face_value() -> None:
    """C19 (routed defect, characterised): a Bybit inverse funding row of 0.001 in a COIN currency
    becomes a daily record of 0.001, with no currency conversion, and that record is labelled USDT.
    The probe measured zero inverse funding rows and zero open inverse positions on the one live
    key, so nothing is wrong in PROD today. The owner of the conversion flips this test when it
    lands; until then it makes the face-value sum visible rather than silent."""
    from services.broker_dailies import funding_rows_to_daily_pnl_records
    from services.funding_fetch import fetch_funding_bybit

    settled_ms = _now_ms() - DAY_MS
    # The documented V5 /v5/account/transaction-log SETTLEMENT row of an inverse contract.
    inverse_row = {
        "id": "settle-1",
        "symbol": "BTCUSD",
        "category": "inverse",
        "side": "Buy",
        "transactionTime": str(settled_ms),
        "type": "SETTLEMENT",
        "qty": "100",
        "size": "100",
        "currency": "BTC",
        "tradePrice": "60000",
        "funding": "0.001",
        "fee": "0",
        "cashFlow": "0",
        "change": "-0.001",
        "cashBalance": "1.5",
        "feeRate": "0",
        "bonusChange": "0",
    }

    async def _transaction_log(params: dict[str, str]) -> dict[str, Any]:
        rows = [inverse_row] if params["category"] == "inverse" else []
        return {"result": {"list": rows, "nextPageCursor": ""}}

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=_transaction_log)

    rows = await fetch_funding_bybit(exchange, "s", _now_ms() - 3 * DAY_MS)

    assert [r["currency"] for r in rows] == ["BTC"], "the row must reach the producer as a coin row"
    records = funding_rows_to_daily_pnl_records(rows)
    day = datetime.fromtimestamp(settled_ms / 1000, tz=timezone.utc).date().isoformat()
    assert [(r["timestamp"][:10], r["price"], r["side"]) for r in records] == [
        (day, 0.001, "buy")
    ], "a coin-denominated amount is summed at face value (C19); a conversion is the owner's flip"


@pytest.mark.asyncio
async def test_census_c27_a_first_bybit_funding_walk_is_at_least_106_requests_under_a_180_second_budget() -> None:
    """C27: with no stored funding row the cursor is None, and `fetch_funding_bybit` walks a
    365-day default in seven-day windows over two categories (linear and inverse): at least
    2 x 53 = 106 sequential requests before any page beyond the first, under the 180-second
    `sync_funding` handler budget. PROD shows 30 `failed_final` "Handler exceeded timeout" in 30
    days and the probe measured the first walk at 379 s over 1438 calls on the one live key. This
    pins the two numbers whose product is the defect; the fix is owned outside this phase."""
    from services.funding_fetch import fetch_funding_bybit
    from services.job_worker import TIMEOUT_PER_KIND

    requests: list[dict[str, str]] = []

    async def _empty_page(params: dict[str, str]) -> dict[str, Any]:
        requests.append(dict(params))
        return {"result": {"list": [], "nextPageCursor": ""}}

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=_empty_page)

    rows = await fetch_funding_bybit(exchange, "s", None)

    assert rows == []
    assert {r["category"] for r in requests} == {"linear", "inverse"}
    assert len(requests) >= 106, (
        f"a first Bybit funding walk sent {len(requests)} requests; census row C27 records at "
        "least 106 (two categories times 53 seven-day windows)"
    )
    assert TIMEOUT_PER_KIND["sync_funding"] == 180, (
        "the sync_funding handler budget moved; re-read census row C27 before accepting it"
    )
