"""Phase 167.2.1.1.1 NAVMTM plan 19 - option value in the OKX and Binance marks (D-18, D-19, D-20, D-22).

What these pin, and why each can fail
-------------------------------------
D-18: a venue's stored NAV either includes the account's open option value by a documented
definition, or the account holds none, or the mark is refused by name. Option value is never left
out silently, because the NAV is the base the whole marked series is chained from.

OKX (D-19, "Refuse until measured"): the OKX docs define ``totalEq`` without saying whether option
market value is inside it, so an OKX account with an open option is refused
(``option_value_unverified``) until the post-deploy measurement shows what ``totalEq`` carries, and
an option read that cannot be read is refused (``option_value_unreadable``). The read is made once
per key per UTC day, inside the venue ``try`` BEFORE the exchange is closed (B1: a read on a closed
exchange raises and would refuse every OKX key every day), and never when the day's mark is already
stored (W1: the stored row is the authority).

Binance (D-20, D-22): the European Options account is separate from the account the L4 read sees.
After the L4 read succeeded: all-zero options balances and no open position keep the L4 tuple; any
non-zero balance or open position is ``option_value_unverified``; a read refused with the pinned
no-access code counts as zero option value; anything else is ``option_value_unreadable``.

The OKX cases drive the whole derive on plan 06's harness with the option read as a controllable
fake whose every call raises once the exchange is closed. The Binance cases call
``read_marked_equity_usd`` on plan 15's counting fake venue and one case drives the derive.
Every expected number is a literal typed beside the fake payload it comes from.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import ExitStack
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pytest

import services.equity_reconstruction as er
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_nav_marks_l4_read import _binance, _derive as _derive_ccxt
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    T_0010,
    _ctx,
    _key_inputs,
    _real_marks_writer,
    _returns,
    marks_not_applied,
)

_READER_LOGGER = er.logger.name

KEY = "key-1"
CLOSED_DAY = "2026-03-01"  # T_0010 is 2026-03-02T00:10:30Z


# --------------------------------------------------------------------------------------
# OKX: the derive harness, with the option read as a fake that fails on a closed exchange
# --------------------------------------------------------------------------------------


class OkxOptionRead:
    """``exchange.privateGetAccountPositions``, counted. Once ``exchange.closed`` is set (by the
    patched ``aclose_exchange``) every call raises, as a real ccxt exchange would."""

    def __init__(self, exchange: Any, response: Any = None, *, raises: Exception | None = None,
                 delay_s: float = 0.0) -> None:
        self.exchange = exchange
        self.response: Any = {"data": []} if response is None else response
        self.raises = raises
        self.delay_s = delay_s
        self.calls: list[Any] = []

    async def __call__(self, params: Any = None) -> Any:
        self.calls.append(params)
        if self.exchange.closed:
            raise ccxt.NetworkError("exchange is closed")
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.raises is not None:
            raise self.raises
        return self.response


async def _derive_okx(
    db: FakeDb, *, response: Any = None, raises: Exception | None = None, delay_s: float = 0.0,
    now: datetime = T_0010, key_mode: bool = True, equity: float = 1050.0, upl: float = 50.0,
    extra_patches: list[Any] | None = None,
) -> tuple[Any, dict[str, Any], OkxOptionRead]:
    ctx, capture = _ctx(
        db, key_id=KEY, user_id="alloc-1", venue="okx",
        strategy_id=None if key_mode else "strat-1",
    )
    ctx.exchange.closed = False
    option_read = OkxOptionRead(ctx.exchange, response, raises=raises, delay_s=delay_s)
    ctx.exchange.privateGetAccountPositions = option_read

    def _close(exchange: Any) -> None:
        exchange.closed = True

    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode else "services.job_worker._exchange_preflight"
    )
    meta = {"used_heuristic_capital": False, "series_completeness": "fill_derived_unproven"}
    patches = [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock(side_effect=_close)),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, upl, False)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch(
            "services.broker_dailies.combine_realized_and_funding",
            new=MagicMock(return_value=(_returns(2), dict(meta))),
        ),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
        marks_not_applied(),
        *(extra_patches or []),
    ]
    job: dict[str, Any] = {"id": "j", "kind": "derive_broker_dailies"}
    job.update({"api_key_id": KEY} if key_mode else {"strategy_id": "strat-1"})
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(job)
    return result, capture, option_read


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: OKX
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode", [True, False], ids=["key-mode", "strategy-mode"])
async def test_okx_open_option_refuses_the_mark(key_mode: bool) -> None:
    """D-19: one open option position (``pos`` "2") and ``totalEq`` is not shown to carry its
    value, so no mark is stored. The derive still completes."""
    db = FakeDb()
    position = {"instId": "BTC-USD-261225-90000-C", "instType": "OPTION", "pos": "2"}
    result, capture, option_read = await _derive_okx(
        db, response={"code": "0", "data": [position]}, key_mode=key_mode,
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert option_read.calls == [{"instType": "OPTION"}]
    if key_mode:
        assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unverified"


@pytest.mark.asyncio
async def test_okx_without_options_marks_as_today() -> None:
    """No open option: the mark is plan 06's (nav = totalEq 1050.0, open = upl 50.0)."""
    db = FakeDb()
    result, capture, option_read = await _derive_okx(db, response={"code": "0", "data": []})
    assert result.outcome == DispatchOutcome.DONE
    row = db.marks[(KEY, CLOSED_DAY)]
    assert row["nav_usd"] == 1050.0 and row["open_pnl_usd"] == 50.0
    assert "nav_mark_refusal" not in _key_inputs(capture)
    assert len(option_read.calls) == 1


@pytest.mark.asyncio
async def test_okx_a_closed_position_row_is_not_an_open_option() -> None:
    """A ``pos`` of "0" is a flat row, not an open option (an exact zero, not a prefix match)."""
    db = FakeDb()
    result, _capture, _read = await _derive_okx(
        db, response={"data": [{"instId": "BTC-USD-261225-90000-C", "pos": "0"}]},
    )
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks[(KEY, CLOSED_DAY)]["nav_usd"] == 1050.0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        {"code": "0"},                                  # no data key
        {"data": {"pos": "2"}},                         # data is not a list
        {"data": None},
        ["not", "a", "dict"],                           # the whole body is not a dict
        "a string",                                     # the whole body is text
        {"data": ["not a dict"]},                       # an entry that is not a dict
        {"data": [{"instId": "X"}]},                    # an entry with no pos
        {"data": [{"instId": "X", "pos": "abc"}]},      # an entry whose pos is not a number
        {"data": [{"instId": "X", "pos": "nan"}]},      # an entry whose pos is not finite
    ],
    ids=["no-data", "data-dict", "data-none", "body-list", "body-text", "entry-str",
         "entry-no-pos", "entry-pos-text", "entry-pos-nan"],
)
async def test_okx_option_read_failure_refuses(response: Any) -> None:
    """A garbled reply is never "no options": the mark is refused ``option_value_unreadable``."""
    db = FakeDb()
    result, capture, _read = await _derive_okx(db, response=response)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unreadable"


@pytest.mark.asyncio
async def test_okx_option_read_raising_refuses() -> None:
    db = FakeDb()
    result, capture, _read = await _derive_okx(db, raises=ccxt.NetworkError("boom"))
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unreadable"


@pytest.mark.asyncio
async def test_okx_option_read_timing_out_refuses_and_the_derive_completes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A hung option read is bounded by the derive's per-crawl bound and is
    ``option_value_unreadable``, never a transient failure of the whole derive."""
    import services.job_worker as job_worker

    monkeypatch.setattr(job_worker, "_BROKER_CRAWL_TIMEOUT_S", 0.05)
    db = FakeDb()
    result, capture, _read = await _derive_okx(db, delay_s=5.0)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unreadable"


@pytest.mark.asyncio
async def test_okx_option_read_runs_before_the_close() -> None:
    """B1: the harness's ``aclose_exchange`` closes the fake and the fake raises when called after.
    With one open option the token is ``option_value_unverified``: the read was made on an OPEN
    exchange. A read after the close would raise and read as ``option_value_unreadable``, refusing
    every OKX key every day."""
    db = FakeDb()
    result, capture, option_read = await _derive_okx(db, response={"data": [{"pos": "2"}]})
    assert result.outcome == DispatchOutcome.DONE
    assert len(option_read.calls) == 1
    assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unverified"
    assert _key_inputs(capture)["nav_mark_refusal"] != "option_value_unreadable"


@pytest.mark.asyncio
async def test_okx_stored_mark_skips_the_option_read() -> None:
    """W1: a mark already stored for (the key, the closed day) is the authority. A later derive
    that sees an open option makes no option read and does not discard the stored row."""
    db = FakeDb()
    first, first_capture, first_read = await _derive_okx(db, response={"data": []})
    assert first.outcome == DispatchOutcome.DONE
    assert len(first_read.calls) == 1
    stored = dict(db.marks[(KEY, CLOSED_DAY)])
    assert stored["nav_usd"] == 1050.0

    later = datetime(2026, 3, 2, 0, 50, 0, tzinfo=T_0010.tzinfo)
    second, second_capture, second_read = await _derive_okx(
        db, response={"data": [{"pos": "2"}]}, now=later, equity=1060.0, upl=60.0,
    )
    assert second.outcome == DispatchOutcome.DONE
    assert second_read.calls == [], "a stored mark means no option read at all"
    assert db.marks[(KEY, CLOSED_DAY)] == stored, "the stored row stays"
    inputs = _key_inputs(second_capture)
    assert inputs["nav_mark"]["nav_usd"] == 1050.0
    assert "nav_mark_refusal" not in inputs


# --------------------------------------------------------------------------------------
# Task 2 - Binance: the European Options account beside the L4 read (D-20, D-22)
# --------------------------------------------------------------------------------------

L4_TUPLE = (1025.0, 25.0, 1000.0)  # wallet USDT 1000.0 + one position of +25.0 open profit
NO_ACCESS = ccxt.AuthenticationError(
    'binance {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action"}'
)
OPTIONS_ZERO = {
    "asset": [
        {"asset": "USDT", "marginBalance": "0", "equity": "0", "available": "0"},
        {"asset": "BTC", "marginBalance": "0.00000000", "equity": "0.00000000"},
    ],
    "greek": [],
}


def _binance_options(
    margin: Any = None, position: Any = None, *,
    margin_raises: Exception | None = None, position_raises: Exception | None = None,
    **kw: Any,
) -> Any:
    """A Binance fake whose two options reads are counting ``AsyncMock``s."""
    venue = _binance(**kw)
    venue.eapiPrivateGetMarginAccount = AsyncMock(
        return_value=OPTIONS_ZERO if margin is None else margin, side_effect=margin_raises,
    )
    venue.eapiPrivateGetPosition = AsyncMock(
        return_value=[] if position is None else position, side_effect=position_raises,
    )
    return venue


async def _read(venue: Any) -> Any:
    from services.equity_reconstruction import read_marked_equity_usd

    return await read_marked_equity_usd(venue, "binance")


@pytest.mark.asyncio
async def test_binance_without_options_keeps_the_l4_tuple() -> None:
    """Every options asset at zero ``marginBalance`` and ``equity`` and no open position (a flat
    row with a zero quantity and mark value is not one): the L4 tuple, unchanged."""
    flat = [{"symbol": "BTC-261225-90000-C", "quantity": "0.0000", "markValue": "0.0000"}]
    venue = _binance_options(position=flat)
    assert await _read(venue) == L4_TUPLE
    venue.eapiPrivateGetMarginAccount.assert_awaited_once()
    venue.eapiPrivateGetPosition.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "margin,position",
    [
        # marginBalance 12.5 is option collateral: the account holds an options balance.
        ({"asset": [{"asset": "USDT", "marginBalance": "12.5", "equity": "0"}]}, None),
        # equity -3.0 with a zero marginBalance: still not zero.
        ({"asset": [{"asset": "USDT", "marginBalance": "0", "equity": "-3.0"}]}, None),
        # all balances zero but one open position of 0.1 contracts, markValue 5.0.
        (None, [{"symbol": "BTC-261225-90000-C", "quantity": "0.1", "markValue": "5.0"}]),
        # a quantity of zero but a non-zero markValue is still a holding.
        (None, [{"symbol": "BTC-261225-90000-C", "quantity": "0", "markValue": "5.0"}]),
    ],
    ids=["margin-balance", "equity-only", "position", "mark-value-only"],
)
async def test_binance_options_balance_or_position_refuses(margin: Any, position: Any) -> None:
    venue = _binance_options(margin=margin, position=position)
    assert await _read(venue) == "option_value_unverified"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs",
    [
        {"margin_raises": ccxt.ExchangeError('binance {"code":-1000,"msg":"unknown"}')},
        {"position_raises": ccxt.ExchangeError('binance {"code":-1000,"msg":"unknown"}')},
        {"margin_raises": ccxt.NetworkError("connection reset")},
        {"position_raises": ccxt.RequestTimeout("timed out")},
        {"margin": "not a dict"},
        {"margin": {"greek": []}},
        {"margin": {"asset": {"not": "a list"}}},
        {"margin": {"asset": ["not a dict"]}},
        {"margin": {"asset": [{"asset": "USDT", "equity": "0"}]}},
        {"margin": {"asset": [{"asset": "USDT", "marginBalance": "abc", "equity": "0"}]}},
        {"margin": {"asset": [{"asset": "USDT", "marginBalance": "nan", "equity": "0"}]}},
        {"position": {"not": "a list"}},
        {"position": ["not a dict"]},
        {"position": [{"symbol": "BTC-261225-90000-C"}]},
    ],
    ids=[
        "margin--1000", "position--1000", "margin-network", "position-timeout", "margin-text",
        "margin-no-asset", "margin-asset-dict", "margin-entry-text", "margin-no-balance",
        "margin-balance-text", "margin-balance-nan", "position-dict", "position-entry-text",
        "position-entry-empty",
    ],
)
async def test_binance_options_read_failure_refuses(kwargs: dict[str, Any]) -> None:
    """Any error but the pinned no-access code, and any garbled shape, is NOT "no options"."""
    venue = _binance_options(**kwargs)
    assert await _read(venue) == "option_value_unreadable"


@pytest.mark.asyncio
async def test_binance_a_known_holder_beats_an_unreadable_sibling() -> None:
    """A holding seen on one read and a garbled reply on the other: the holding is the answer."""
    venue = _binance_options(
        margin={"asset": [{"asset": "USDT", "marginBalance": "12.5", "equity": "0"}]},
        position_raises=ccxt.NetworkError("connection reset"),
    )
    assert await _read(venue) == "option_value_unverified"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs",
    [
        {"margin_raises": NO_ACCESS, "position_raises": NO_ACCESS},
        {"margin_raises": NO_ACCESS},
        {"position_raises": NO_ACCESS},
    ],
    ids=["both", "margin-only", "position-only"],
)
async def test_binance_no_options_access_counts_as_zero(
    kwargs: dict[str, Any], caplog: pytest.LogCaptureFixture,
) -> None:
    """D-20: after a successful L4 read, a read refused with code -2015 is zero option value, the
    L4 tuple is returned, and the log names the parsed code (never the venue text)."""
    venue = _binance_options(**kwargs)
    with caplog.at_level(logging.INFO, logger=_READER_LOGGER):
        assert await _read(venue) == L4_TUPLE
    lines = [r.getMessage() for r in caplog.records if "binance options read:" in r.getMessage()]
    assert lines, "the no-access code must be visible in the log after deploy"
    assert all("outcome=no_access parsed_code=-2015" in line for line in lines)
    assert not any("Invalid API-key" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_binance_the_exception_class_is_never_the_no_access_test(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """-2014 maps to the SAME ccxt class as -2015 (a bad key), so it must NOT count as zero."""
    bad_key = ccxt.AuthenticationError('binance {"code":-2014,"msg":"API-key format invalid."}')
    venue = _binance_options(margin_raises=bad_key)
    with caplog.at_level(logging.INFO, logger=_READER_LOGGER):
        assert await _read(venue) == "option_value_unreadable"
    lines = [r.getMessage() for r in caplog.records if "binance options read:" in r.getMessage()]
    assert any("outcome=unreadable parsed_code=-2014" in line for line in lines)
    # No code at all in the text: the same class again, and still not zero.
    assert (
        await _read(_binance_options(margin_raises=ccxt.AuthenticationError("denied")))
        == "option_value_unreadable"
    )


def test_ccxt_maps_minus_2015_to_authentication_error() -> None:
    """I2: this pins what ccxt itself states, not what Binance returns for a key without options
    access. ``-2015`` and ``-2014`` are the SAME class, so the class cannot tell options no-access
    from a bad key: the reader goes by the parsed numeric code, and the post-deploy measurement
    (plan 11) is the real pin of the code a key without options permission receives."""
    import ccxt.async_support as ccxt_async

    exact = ccxt_async.binance().exceptions["exact"]
    assert exact["-2015"] is ccxt.AuthenticationError
    assert exact["-2014"] is ccxt.AuthenticationError

    from services.equity_reconstruction import _BINANCE_OPTIONS_NO_ACCESS_CODES

    assert _BINANCE_OPTIONS_NO_ACCESS_CODES == frozenset({"-2015"})


@pytest.mark.asyncio
async def test_binance_l4_refusal_wins() -> None:
    """An L4 refusal is returned as it stands and no options read is made."""
    venue = _binance_options(positions_raises=True)
    assert await _read(venue) == "positions_unreadable"
    venue.eapiPrivateGetMarginAccount.assert_not_awaited()
    venue.eapiPrivateGetPosition.assert_not_awaited()


@pytest.mark.asyncio
async def test_binance_derive_refuses_a_holder_and_skips_the_read_when_a_mark_is_stored() -> None:
    """Through the derive: an options holding stores no mark and says why; once the day's mark is
    stored (here by a holder-free derive) a later derive makes no options read at all (W3)."""
    db = FakeDb()
    holder = _binance_options(
        margin={"asset": [{"asset": "USDT", "marginBalance": "12.5", "equity": "0"}]},
    )
    result, capture, _combine = await _derive_ccxt(db, holder, venue="binance")
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "option_value_unverified"

    clean = _binance_options()
    first, _first_capture, _c1 = await _derive_ccxt(db, clean, venue="binance")
    assert first.outcome == DispatchOutcome.DONE
    assert db.marks[(KEY, CLOSED_DAY)]["nav_usd"] == 1025.0
    clean.eapiPrivateGetMarginAccount.assert_awaited_once()
    clean.eapiPrivateGetPosition.assert_awaited_once()

    again = _binance_options()
    second, _second_capture, _c2 = await _derive_ccxt(db, again, venue="binance")
    assert second.outcome == DispatchOutcome.DONE
    again.eapiPrivateGetMarginAccount.assert_not_awaited()
    again.eapiPrivateGetPosition.assert_not_awaited()
    assert db.marks[(KEY, CLOSED_DAY)]["nav_usd"] == 1025.0
