"""Phase 180 plan 04: the rebuild's Bybit flow read over the Unified transaction log (D-01).

The book (``tests/_trade_pages.py::UnifiedLogBook``) answers the way the venue does, so a read that
mis-pages, mis-windows or drops a row reads fewer flows than the book holds and a test sees it.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import ccxt.async_support as ccxt
import pytest

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


# ---------------------------------------------------------------------------
# Phase 186 plan 03: the pairing rule shared by the SC-1 probe and a pair-aware flow source.
#
# Why (Rule 9): D-02's replace-or-union choice for the Bybit flow source rests on how many
# on-chain rows are the same money as a Unified TRANSFER row. A rule that pairs too loosely
# (any amount, any date, one Unified row reused) overstates the overlap and would justify
# REPLACE where UNION is right, double-counting nothing but also dropping real flows; a rule
# that pairs too tightly understates it and would justify UNION and double-count a deposit.
# ---------------------------------------------------------------------------

_T0 = 1_700_000_000_000


def _chain(row_id: str, kind: str, stamp: int, amount: float = 1000.0, currency: str = "USDT") -> dict[str, Any]:
    """An on-chain row in the shape ``fetch_ccxt_transfers`` returns (only the keys the rule reads)."""
    return {"id": row_id, "type": "deposit" if kind == "d" else "withdrawal",
            "currency": currency, "amount": amount, "timestamp": stamp}


def _uni(row_id: str, kind: str, stamp: int, amount: float = 1000.0, currency: str = "USDT") -> dict[str, Any]:
    """A Unified row in the shape ``fetch_bybit_unified_flows`` returns."""
    return {"id": row_id, "type": "deposit" if kind == "d" else "withdrawal",
            "currency": currency, "amount": amount, "timestamp": stamp, "fee": None}


def test_an_onchain_deposit_pairs_with_a_unified_deposit_two_days_later() -> None:
    result = buf.pair_onchain_with_unified(
        [_chain("c1", "d", _T0)], [], [_uni("u1", "d", _T0 + 2 * DAY_MS)], []
    )
    assert result.paired_deposits == 1
    assert result.unpaired_onchain_deposits == 0
    assert result.paired_withdrawals == 0
    assert result.matched_deposit_ids == frozenset({"c1"})


@pytest.mark.parametrize(
    ("unified", "why"),
    [
        (_uni("u1", "d", _T0 + 31 * DAY_MS), "31 days is past the window"),
        (_uni("u1", "d", _T0 + 2 * DAY_MS, currency="BTC"), "a different currency is other money"),
        (_uni("u1", "d", _T0 + 2 * DAY_MS, amount=1000.01), "an amount off by more than the tolerance"),
        (_uni("u1", "d", _T0 - DAY_MS), "a deposit reaches Unified AFTER it lands on chain"),
    ],
    ids=["too-late", "currency", "amount", "wrong-order"],
)
def test_a_deposit_pair_needs_window_currency_amount_and_order(unified: dict[str, Any], why: str) -> None:
    result = buf.pair_onchain_with_unified([_chain("c1", "d", _T0)], [], [unified], [])
    assert result.paired_deposits == 0, why
    assert result.unpaired_onchain_deposits == 1, why
    assert result.matched_deposit_ids == frozenset()


def test_the_window_edge_is_inclusive_and_currency_case_is_ignored() -> None:
    result = buf.pair_onchain_with_unified(
        [_chain("c1", "d", _T0, currency="usdt")],
        [],
        [_uni("u1", "d", _T0 + buf.PAIRING_WINDOW_MS, currency="USDT")],
        [],
    )
    assert result.paired_deposits == 1


def test_a_withdrawal_pairs_the_other_way_round() -> None:
    # Money leaves Unified first, then leaves the venue on chain.
    paired = buf.pair_onchain_with_unified(
        [], [_chain("c1", "w", _T0 + 3 * DAY_MS)], [], [_uni("u1", "w", _T0)]
    )
    assert paired.paired_withdrawals == 1
    assert paired.unpaired_onchain_withdrawals == 0
    assert paired.matched_withdrawal_ids == frozenset({"c1"})
    # The on-chain withdrawal BEFORE the Unified transfer-out is not the same money.
    before = buf.pair_onchain_with_unified(
        [], [_chain("c1", "w", _T0)], [], [_uni("u1", "w", _T0 + 3 * DAY_MS)]
    )
    assert before.paired_withdrawals == 0
    assert before.unpaired_onchain_withdrawals == 1
    # And 31 days after is past the window.
    late = buf.pair_onchain_with_unified(
        [], [_chain("c1", "w", _T0 + 31 * DAY_MS)], [], [_uni("u1", "w", _T0)]
    )
    assert late.paired_withdrawals == 0


def test_one_unified_row_pairs_at_most_one_onchain_row() -> None:
    result = buf.pair_onchain_with_unified(
        [_chain("c1", "d", _T0), _chain("c2", "d", _T0 + DAY_MS)],
        [],
        [_uni("u1", "d", _T0 + 2 * DAY_MS)],
        [],
    )
    assert result.paired_deposits == 1
    assert result.unpaired_onchain_deposits == 1
    # The earlier on-chain row (visited first) takes the only Unified row.
    assert result.matched_deposit_ids == frozenset({"c1"})


def test_the_earliest_eligible_unified_row_is_used() -> None:
    # u1 at +1d and u2 at +5d. If c1 took u2 (the latest) then c2 (+3d) would have nothing left
    # in its window; taking the earliest leaves u2 for c2, so both pair.
    result = buf.pair_onchain_with_unified(
        [_chain("c1", "d", _T0), _chain("c2", "d", _T0 + 3 * DAY_MS)],
        [],
        [_uni("u1", "d", _T0 + DAY_MS), _uni("u2", "d", _T0 + 5 * DAY_MS)],
        [],
    )
    assert result.paired_deposits == 2
    assert result.matched_deposit_ids == frozenset({"c1", "c2"})


def test_an_onchain_row_that_cannot_be_read_is_unpaired_and_never_raises() -> None:
    bad_stamp = {"id": "c1", "type": "deposit", "currency": "USDT", "amount": 1000.0, "timestamp": None}
    bad_amount = {"id": "c2", "type": "deposit", "currency": "USDT", "amount": None, "timestamp": _T0}
    result = buf.pair_onchain_with_unified(
        [bad_stamp, bad_amount], [], [_uni("u1", "d", _T0 + DAY_MS)], []
    )
    assert result.paired_deposits == 0
    assert result.unpaired_onchain_deposits == 2


def test_the_amount_is_compared_as_an_absolute_value() -> None:
    # A venue may sign an on-chain withdrawal; the Unified reader already returns |change|.
    result = buf.pair_onchain_with_unified(
        [], [_chain("c1", "w", _T0 + DAY_MS, amount=-1000.0)], [], [_uni("u1", "w", _T0)]
    )
    assert result.paired_withdrawals == 1


def test_a_withdrawal_pairs_on_amount_plus_a_same_currency_fee() -> None:
    # The repo's own flow model (ccxt_flows._fee_usd) says a withdrawal debits amount + fee, so the
    # Unified transfer-out is 1001 for an on-chain withdrawal of 1000 with a fee of 1. Paired on
    # the bare amount it was unpaired, and a pair-aware union then counted it twice.
    chain = _chain("c1", "w", _T0 + DAY_MS)
    chain["fee"] = {"cost": 1.0, "currency": "usdt"}
    result = buf.pair_onchain_with_unified([], [chain], [], [_uni("u1", "w", _T0, amount=1001.0)])
    assert result.paired_withdrawals == 1
    assert result.unpaired_onchain_withdrawals == 0
    assert result.matched_withdrawal_ids == frozenset({"c1"})


def test_a_fee_in_another_currency_or_on_a_deposit_does_not_change_the_amount() -> None:
    other = _chain("c1", "w", _T0 + DAY_MS)
    other["fee"] = {"cost": 1.0, "currency": "BTC"}
    result = buf.pair_onchain_with_unified([], [other], [], [_uni("u1", "w", _T0, amount=1001.0)])
    assert result.paired_withdrawals == 0
    deposit = _chain("c2", "d", _T0)
    deposit["fee"] = {"cost": 1.0, "currency": "USDT"}
    result = buf.pair_onchain_with_unified([deposit], [], [_uni("u2", "d", _T0 + DAY_MS, amount=1001.0)], [])
    assert result.paired_deposits == 0


def test_a_deposit_id_and_a_withdrawal_id_that_collide_stay_in_their_own_sets() -> None:
    # One mixed set let a deposit id equal to an unpaired withdrawal's id hide that withdrawal.
    result = buf.pair_onchain_with_unified(
        [_chain("same", "d", _T0)],
        [_chain("same", "w", _T0 + 40 * DAY_MS)],
        [_uni("u1", "d", _T0 + DAY_MS)],
        [_uni("u2", "w", _T0)],
    )
    assert result.matched_deposit_ids == frozenset({"same"})
    assert result.matched_withdrawal_ids == frozenset()


def test_unreadable_rows_and_near_misses_are_counted_so_zero_pairs_can_be_explained() -> None:
    bad_unified = {"id": "u0", "type": "deposit", "currency": "USDT", "amount": None, "timestamp": _T0}
    bad_chain = {"id": "c0", "type": "deposit", "currency": "USDT", "amount": 5.0, "timestamp": None}
    result = buf.pair_onchain_with_unified(
        [_chain("c1", "d", _T0), _chain("c2", "d", _T0, currency="BTC"), bad_chain],
        [],
        [_uni("u1", "d", _T0 + DAY_MS, amount=999.0), bad_unified],
        [],
    )
    assert result.paired_deposits == 0
    # c1: same currency, in window, unused Unified row of a different amount. c2: other currency.
    assert result.near_miss_rows == 1
    assert result.unreadable_rows == 2


def test_a_fee_match_does_not_take_the_unified_row_another_withdrawal_needs_as_an_exact_match() -> None:
    # A: 100 + fee 1 (accepts 100 or 101). B: 101 + fee 1 (accepts 101 or 102). Unified rows 101
    # then 100. Taking the earliest row that matches EITHER amount, A takes the 101 row through its
    # fee and B is left with nothing, so the money of B is counted on chain AND as a Unified flow.
    # One-to-one, A -> the 100 row and B -> the 101 row pairs both.
    a = _chain("a", "w", _T0 + 10 * 3_600_000, amount=100.0)
    b = _chain("b", "w", _T0 + 11 * 3_600_000, amount=101.0)
    a["fee"] = b["fee"] = {"cost": 1.0, "currency": "USDT"}
    result = buf.pair_onchain_with_unified(
        [],
        [a, b],
        [],
        [_uni("u1", "w", _T0 + 1 * 3_600_000, amount=101.0), _uni("u2", "w", _T0 + 2 * 3_600_000, amount=100.0)],
    )
    assert result.paired_withdrawals == 2
    assert result.unpaired_onchain_withdrawals == 0
    assert result.matched_withdrawal_ids == frozenset({"a", "b"})
    assert result.near_miss_rows == 0


def test_an_exact_match_does_not_take_the_unified_row_another_withdrawal_can_only_fee_match() -> None:
    # The mirror of the test above (WR-06). A: 100 + fee 1 (accepts 100 or 101). B: 101 + fee 1
    # (accepts 101 or 102). Unified rows 101 then 102. Exact-first gives B the 101 row and leaves A
    # with nothing, though A -> 101 (fee) and B -> 102 (fee) pairs both. Both must pair, so A's money
    # is not counted on chain AND again as a Unified flow.
    a = _chain("a", "w", _T0 + 10 * 3_600_000, amount=100.0)
    b = _chain("b", "w", _T0 + 11 * 3_600_000, amount=101.0)
    a["fee"] = b["fee"] = {"cost": 1.0, "currency": "USDT"}
    result = buf.pair_onchain_with_unified(
        [],
        [a, b],
        [],
        [_uni("u1", "w", _T0 + 1 * 3_600_000, amount=101.0), _uni("u2", "w", _T0 + 2 * 3_600_000, amount=102.0)],
    )
    assert result.paired_withdrawals == 2
    assert result.unpaired_onchain_withdrawals == 0
    assert result.matched_withdrawal_ids == frozenset({"a", "b"})
    assert result.near_miss_rows == 0

