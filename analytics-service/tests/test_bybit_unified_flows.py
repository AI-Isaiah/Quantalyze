"""Phase 180 plan 04: the rebuild's Bybit flow read over the Unified transaction log (D-01).

The book (``tests/_trade_pages.py::UnifiedLogBook``) answers the way the venue does, so a read that
mis-pages, mis-windows or drops a row reads fewer flows than the book holds and a test sees it.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import ccxt.async_support as ccxt
import pytest

import scripts.allocator_history_probe as hp
import scripts.bybit_funding_record as bfr
from services import bybit_unified_flows as buf
from tests._trade_pages import DAY_MS, install_unified_log, unified_flow

_SINCE = 1_700_000_000_000


def _exchange() -> Any:
    exchange = AsyncMock()
    exchange.id = "bybit"
    return exchange


async def test_one_transfer_in_row_becomes_a_deposit_the_replay_can_read() -> None:
    """A Unified TRANSFER_IN row is the deposit the replay reads: six keys, never `kind`, never `info`."""
    exchange = _exchange()
    stamp = _SINCE + 3 * DAY_MS
    install_unified_log(
        exchange,
        [unified_flow("fake-flow-in-1", "TRANSFER_IN", stamp, currency="USDT", change="250.5")],
    )
    deposits, withdrawals = await buf.fetch_bybit_unified_flows(
        exchange, _SINCE, _SINCE + 20 * DAY_MS
    )
    assert deposits == [
        {
            "id": "fake-flow-in-1",
            "type": "deposit",
            "currency": "USDT",
            "amount": 250.5,
            "timestamp": stamp,
            "fee": None,
        }
    ]
    assert withdrawals == []
    assert "kind" not in deposits[0]
    assert "info" not in deposits[0]


async def test_the_unified_read_asks_both_types_over_tiled_seven_day_windows() -> None:
    """Both flow types, each tiled start to now in windows of at most 7 days, +1 ms between them."""
    exchange = _exchange()
    book = install_unified_log(exchange)
    now = _SINCE + 20 * DAY_MS
    await buf.fetch_bybit_unified_flows(exchange, _SINCE, now)

    # The oracle is derived here from `since` and `now`, by hand: 7 days, then +1 ms.
    expected: list[tuple[int, int]] = []
    start = _SINCE
    while start < now:
        end = min(start + 7 * DAY_MS, now)
        expected.append((start, end))
        start = end + 1
    assert len(expected) == 3
    assert expected[-1][1] == now

    assert {call["type"] for call in book.calls} == {"TRANSFER_IN", "TRANSFER_OUT"}
    for log_type in ("TRANSFER_IN", "TRANSFER_OUT"):
        mine = [call for call in book.calls if call["type"] == log_type]
        for call in mine:
            assert call["accountType"] == "UNIFIED"
            assert call["limit"] == "50"
            assert isinstance(call["startTime"], str) and isinstance(call["endTime"], str)
            assert int(call["endTime"]) - int(call["startTime"]) <= 7 * DAY_MS
        assert [(int(c["startTime"]), int(c["endTime"])) for c in mine] == expected


def _hundred_twenty_in_one_window() -> list[dict[str, Any]]:
    return [
        unified_flow(f"fake-flow-in-{i:03d}", "TRANSFER_IN", _SINCE + DAY_MS + i * 1000)
        for i in range(120)
    ]


async def test_every_page_of_a_window_is_read() -> None:
    """120 rows in one window, 50 a page: all 120 come back, over exactly 3 requests (50, 50, 20)."""
    exchange = _exchange()
    book = install_unified_log(exchange, _hundred_twenty_in_one_window())
    deposits, withdrawals = await buf.fetch_bybit_unified_flows(
        exchange, _SINCE, _SINCE + 6 * DAY_MS
    )
    assert len(deposits) == 120
    assert len({d["id"] for d in deposits}) == 120
    assert withdrawals == []
    in_calls = [c for c in book.calls if c["type"] == "TRANSFER_IN"]
    assert len(in_calls) == 3
    assert [c.get("cursor") for c in in_calls] == [None, "c50", "c100"]


async def test_a_repeated_cursor_raises_and_stops_at_once() -> None:
    """A venue that hands back the cursor it was sent must not be walked to the ceiling."""
    exchange = _exchange()
    book = install_unified_log(exchange, _hundred_twenty_in_one_window(), repeat_cursor=True)
    with pytest.raises(buf.BybitUnifiedFlowReadError, match="did not advance"):
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 6 * DAY_MS)
    assert len([c for c in book.calls if c["type"] == "TRANSFER_IN"]) <= 2


async def test_an_empty_page_ends_the_window_even_when_its_cursor_repeats() -> None:
    """A window holding exactly 50 rows: one full page with cursor c50, then an empty page that still
    carries c50. That is the end of the window, not a stall, and all 50 rows come back."""
    exchange = _exchange()
    flows = [
        unified_flow(f"fake-flow-in-{i:02d}", "TRANSFER_IN", _SINCE + DAY_MS + i * 1000)
        for i in range(50)
    ]
    full_page = [
        {
            "id": f["id"],
            "type": "TRANSFER_IN",
            "transactionTime": str(f["timestamp"]),
            "currency": "USDT",
            "change": "100",
            "cashFlow": "100",
            "funding": "",
        }
        for f in flows
    ]
    seen: list[dict[str, Any]] = []

    async def _log(params: dict[str, Any]) -> dict[str, Any]:
        seen.append(dict(params))
        if params["type"] != "TRANSFER_IN":
            return {"retCode": 0, "result": {"list": [], "nextPageCursor": ""}}
        if not params.get("cursor"):
            return {"retCode": 0, "result": {"list": full_page, "nextPageCursor": "c50"}}
        return {"retCode": 0, "result": {"list": [], "nextPageCursor": "c50"}}

    exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=_log)
    deposits, withdrawals = await buf.fetch_bybit_unified_flows(
        exchange, _SINCE, _SINCE + 6 * DAY_MS
    )
    assert len(deposits) == 50
    assert withdrawals == []
    assert len([p for p in seen if p["type"] == "TRANSFER_IN"]) == 2


async def test_a_window_past_the_page_cap_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """A window too large for the ceiling raises, it never hands back a 100-row list."""
    monkeypatch.setattr(buf, "UNIFIED_FLOW_PAGE_CAP", 2)
    exchange = _exchange()
    install_unified_log(exchange, _hundred_twenty_in_one_window())
    with pytest.raises(buf.BybitUnifiedFlowReadError, match="UNIFIED_FLOW_PAGE_CAP"):
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 6 * DAY_MS)


def _raw_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": "fake-row-1",
        "type": "TRANSFER_IN",
        "currency": "usdt",
        "transactionTime": "1700000123456",
        "change": "5",
        "cashFlow": "5",
        "funding": "",
    }
    row.update(overrides)
    return {k: v for k, v in row.items() if v is not _ABSENT}


_ABSENT = object()


@pytest.mark.parametrize(
    ("overrides", "log_type", "want"),
    [
        # accepted: expected values written by hand
        ({"change": "", "cashFlow": "12"}, "TRANSFER_IN", ("deposit", 12.0)),
        ({"change": _ABSENT, "cashFlow": "12"}, "TRANSFER_IN", ("deposit", 12.0)),
        ({"change": "-30", "type": "TRANSFER_OUT"}, "TRANSFER_OUT", ("withdrawal", 30.0)),
        ({"change": "30", "type": "TRANSFER_OUT"}, "TRANSFER_OUT", ("withdrawal", 30.0)),
        ({"change": "5", "funding": ""}, "TRANSFER_IN", ("deposit", 5.0)),
        ({"change": "-7"}, "TRANSFER_IN", ("deposit", 7.0)),
        ({"change": "5", "funding": "999"}, "TRANSFER_IN", ("deposit", 5.0)),
        # refused: each is the whole read refused, never a dropped row
        ({"id": _ABSENT}, "TRANSFER_IN", None),
        ({"id": ""}, "TRANSFER_IN", None),
        ({"id": True}, "TRANSFER_IN", None),
        ({"id": 1.5}, "TRANSFER_IN", None),
        ({"transactionTime": _ABSENT}, "TRANSFER_IN", None),
        ({"transactionTime": ""}, "TRANSFER_IN", None),
        ({"transactionTime": "17x"}, "TRANSFER_IN", None),
        ({"transactionTime": True}, "TRANSFER_IN", None),
        ({"currency": _ABSENT}, "TRANSFER_IN", None),
        ({"currency": ""}, "TRANSFER_IN", None),
        ({"change": "", "cashFlow": ""}, "TRANSFER_IN", None),
        ({"change": _ABSENT, "cashFlow": _ABSENT}, "TRANSFER_IN", None),
        ({"change": "nan"}, "TRANSFER_IN", None),
        ({"change": "inf"}, "TRANSFER_IN", None),
        ({"change": "-inf"}, "TRANSFER_IN", None),
        ({"change": "fake-venue-text"}, "TRANSFER_IN", None),
    ],
)
def test_a_row_is_normalised_or_refused(
    overrides: dict[str, Any], log_type: str, want: tuple[str, float] | None
) -> None:
    row = _raw_row(**overrides)
    if want is None:
        with pytest.raises(buf.BybitUnifiedFlowReadError) as excinfo:
            buf.normalise_unified_flow_row(row, log_type)
        assert "fake-venue-text" not in str(excinfo.value)
        return
    got = buf.normalise_unified_flow_row(row, log_type)
    assert got == {
        "id": "fake-row-1",
        "type": want[0],
        "currency": "USDT",
        "amount": want[1],
        "timestamp": 1700000123456,
        "fee": None,
    }


def test_a_non_object_row_is_refused() -> None:
    with pytest.raises(buf.BybitUnifiedFlowReadError):
        buf.normalise_unified_flow_row("fake-row", "TRANSFER_IN")  # type: ignore[arg-type]


def test_an_integer_id_and_an_integer_stamp_are_read() -> None:
    got = buf.normalise_unified_flow_row(
        _raw_row(id=77, transactionTime=1700000123456), "TRANSFER_IN"
    )
    assert got["id"] == "77"
    assert got["timestamp"] == 1700000123456


async def test_a_row_of_another_type_is_refused() -> None:
    """A venue that ignores the `type` filter must not turn other log rows into flows."""
    exchange = _exchange()
    install_unified_log(
        exchange,
        [
            unified_flow("fake-flow-in-1", "TRANSFER_IN", _SINCE + DAY_MS),
            unified_flow("fake-flow-out-1", "TRANSFER_OUT", _SINCE + DAY_MS),
        ],
        wrong_type=True,
    )
    with pytest.raises(buf.BybitUnifiedFlowReadError, match="another type"):
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 6 * DAY_MS)


async def test_a_row_read_twice_is_counted_once() -> None:
    """A venue that serves the same row in two windows: one deposit, not two."""
    exchange = _exchange()
    served = [dict(_raw_row(id="fake-twice", transactionTime=str(_SINCE + 1000)))]

    async def _log(params: dict[str, Any]) -> dict[str, Any]:
        rows = served if params["type"] == "TRANSFER_IN" else []
        return {"retCode": 0, "result": {"list": rows, "nextPageCursor": ""}}

    log = AsyncMock(side_effect=_log)
    exchange.private_get_v5_account_transaction_log = log
    deposits, withdrawals = await buf.fetch_bybit_unified_flows(
        exchange, _SINCE, _SINCE + 10 * DAY_MS
    )
    assert log.await_count == 4  # two windows, two types: the row really came twice
    assert [d["id"] for d in deposits] == ["fake-twice"]
    assert withdrawals == []


@pytest.mark.parametrize(
    "answer",
    [
        [],
        "fake-venue-text",
        {"retCode": 0},
        {"retCode": 0, "result": []},
        {"retCode": 0, "result": {"list": {}}},
        {"retCode": 0, "result": {"list": None}},
        {"retCode": 0, "result": {"list": [], "nextPageCursor": 5}},
        {"retCode": 0, "result": {"list": ["fake-venue-text"], "nextPageCursor": ""}},
    ],
)
async def test_a_malformed_answer_is_refused(answer: Any) -> None:
    exchange = _exchange()
    exchange.private_get_v5_account_transaction_log = AsyncMock(return_value=answer)
    with pytest.raises(buf.BybitUnifiedFlowReadError) as excinfo:
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 3 * DAY_MS)
    assert "fake-venue-text" not in str(excinfo.value)


@pytest.mark.parametrize(
    "err",
    [
        ccxt.PermissionDenied("fake-venue-text"),
        ccxt.AuthenticationError("fake-venue-text"),
        ccxt.BadRequest("fake-venue-text"),
        ccxt.RateLimitExceeded("fake-venue-text"),
        ccxt.NetworkError("fake-venue-text"),
        ccxt.RequestTimeout("fake-venue-text"),
    ],
    ids=lambda e: type(e).__name__,
)
async def test_venue_errors_pass_through_unchanged(err: Exception) -> None:
    """The forced refusal for a permanent class is the caller's call; this read only propagates."""
    exchange = _exchange()
    exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=err)
    with pytest.raises(type(err)) as excinfo:
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 3 * DAY_MS)
    assert excinfo.value is err


async def test_the_probe_recorder_sees_the_unified_read_as_deposits_and_withdrawals() -> None:
    """The probe wraps the rebuild's client; the rows this read pulls are recorded as the gate's kinds."""
    exchange = _exchange()
    exchange.fetch_my_trades = AsyncMock(return_value=[])
    install_unified_log(
        exchange,
        [
            unified_flow("fake-flow-in-1", "TRANSFER_IN", _SINCE + DAY_MS),
            unified_flow("fake-flow-out-1", "TRANSFER_OUT", _SINCE + 2 * DAY_MS),
        ],
    )
    recorder = hp._TradeRecorder(exchange)  # BEFORE the read, as the probe does
    deposits, withdrawals = await buf.fetch_bybit_unified_flows(
        exchange, _SINCE, _SINCE + 6 * DAY_MS
    )
    assert [d["id"] for d in deposits] == ["fake-flow-in-1"]
    assert [w["id"] for w in withdrawals] == ["fake-flow-out-1"]
    assert sorted((kind, str(rid)) for kind, rid, _ in recorder.unified) == [
        ("deposits", "fake-flow-in-1"),
        ("withdrawals", "fake-flow-out-1"),
    ]
    assert recorder.unified_state() == "read"


def test_the_flow_types_are_the_probes_and_disjoint_from_the_census() -> None:
    """The probe holds its own literals (it imports nothing from the rebuild): they must not drift."""
    assert buf.UNIFIED_FLOW_TYPES == ("TRANSFER_IN", "TRANSFER_OUT")
    assert set(buf.UNIFIED_FLOW_TYPES) == set(hp._UNIFIED_FLOW_KINDS)
    assert hp._UNIFIED_FLOW_KINDS["TRANSFER_IN"] == "deposits"
    assert hp._UNIFIED_FLOW_KINDS["TRANSFER_OUT"] == "withdrawals"
    assert set(buf.UNIFIED_FLOW_TYPES).isdisjoint(bfr.CENSUS_LOG_TYPES)


async def test_a_failed_page_logs_the_exception_class_never_the_venue_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Round 1 M-3: a ccxt error carries the venue's own text (retMsg, uids, amounts),
    and a scrub passes free text through. The log names the class and nothing else."""
    exchange = _exchange()
    exchange.private_get_v5_account_transaction_log = AsyncMock(
        side_effect=ccxt.BadRequest("fake-venue-text")
    )
    with caplog.at_level("WARNING"), pytest.raises(ccxt.BadRequest):
        await buf.fetch_bybit_unified_flows(exchange, _SINCE, _SINCE + 3 * DAY_MS)
    assert "exc_class=BadRequest" in caplog.text
    assert "fake-venue-text" not in caplog.text
