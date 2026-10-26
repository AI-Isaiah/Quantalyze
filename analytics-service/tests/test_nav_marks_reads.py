"""Phase 167.2.1.1.1 NAVMTM plan 06, task 2 - what each venue's mark stores (D-07, Pitfall 3, Pitfall 6).

Two layers, both with every oracle taken from the fake venue payload and never from the code
under test:

* ``build_mark_read`` as a pure function: the per-venue figures, the D-07 native fields, the
  closed refusal ladder.
* the real derive over each venue's fake read, so the wiring (which variable feeds which
  figure, where the read time is stamped) is covered and not just the helper.

The identity this module pins (Pitfall 6)
-----------------------------------------
The derive rolls a venue's realized-basis series back from a terminal. D-04 books the first
marked day's step as ``nav_usd - (realized terminal)``, which is the stored open profit ONLY
when ``nav_usd - open_pnl_usd`` equals that terminal. It does by construction for OKX
(``totalEq - upl``), MT5 (``equity - (equity - balance)`` = the balance) and sFOX (the last
observed ``usd_value``, open profit 0). Bybit and Binance are plan 15's.

DERIBIT IS THE DOCUMENTED EXCEPTION. Its realized terminal is the native balance at the mark of
the LAST LEDGER DAY, less the terminal uPnL, while its stored mark is today's collapsed equity.
So the D-04 step on Deribit also contains the coin's mark move since that ledger day, which is
real marked-to-market profit and not an error. The Deribit test therefore asserts only that
``nav_usd`` is the collapsed equity the venue priced, and says why it does not assert the identity.
"""
from __future__ import annotations

from contextlib import ExitStack
from datetime import date, datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

import services.job_worker as jw
from services.deribit_ingest import DeribitNativeAccountState
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_mt5_derive_branch import (
    _BTC_SCALE,
    _CLOSE_DAY,
    _FROZEN_NOW,
    _FakeMt5Transport,
    _btc_closes_on,
    _canonical_deals,
    _reset_mt5_terminal_locks,  # noqa: F401  (autouse fixture: clears the terminal registry)
    _scaled_deals,
)
from tests.test_mt5_derive_branch import _build_ctx as _mt5_build_ctx
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    T_0010,
    _derive_okx,
    _key_inputs,
    _real_marks_writer,
    marks_not_applied,
    route_marks,
)

MARKS_DAY_OF_FROZEN = "2026-10-08"  # _FROZEN_NOW is 2026-10-09 10:00Z, so the closed day is the 8th
_MARK_AT = datetime(2026, 3, 2, 0, 10, 30, tzinfo=timezone.utc)  # labels 2026-03-01


def _nm() -> Any:
    import services.nav_marks as nav_marks

    return nav_marks


def _closes(*pairs: tuple[str, float]) -> pd.Series:
    return _btc_closes_on(*pairs)


def _build(**kw: Any) -> Any:
    base: dict[str, Any] = dict(
        venue="okx", marked_at=_MARK_AT, equity=1000.0, open_pnl=0.0,
        balance_error=False, upnl_unreadable=False,
    )
    base.update(kw)
    return _nm().build_mark_read(**base)


# --------------------------------------------------------------------------------------
# Pure: the per-venue figures and the D-07 native fields
# --------------------------------------------------------------------------------------


def test_okx_and_usd_family_reads_store_native_equal_to_usd() -> None:
    read = _build(venue="okx", equity=1050.0, open_pnl=50.0)
    assert read.mark_day == date(2026, 3, 1) and read.marked_at == _MARK_AT
    assert (read.nav_usd, read.open_pnl_usd) == (1050.0, 50.0)
    assert (read.nav_native, read.open_pnl_native, read.native_unit) == (1050.0, 50.0, "USD")
    assert read.price_day is None and read.native_detail is None


def test_deribit_stores_the_collapsed_usd_figures_and_the_per_currency_detail() -> None:
    nm = _nm()
    detail = nm.deribit_native_detail({"BTC": 0.02}, {"BTC": 0.001}, {"BTC": 0.0012})
    assert detail == {
        "equity": {"BTC": 0.02},
        "upnl": {"BTC": 0.001},
        "open_profit": {"BTC": 0.0012},
        "usd_basis": "venue_index_at_marked_at",
    }
    read = _build(venue="deribit", equity=2000.0, open_pnl=120.0, native_detail=detail)
    assert (read.nav_usd, read.open_pnl_usd) == (2000.0, 120.0)
    # One native number and one unit do not exist for a multi-currency account.
    assert (read.nav_native, read.open_pnl_native, read.native_unit) == (None, None, None)
    assert read.price_day is None
    assert read.native_detail == detail
    row = read.to_row("k", "a")
    assert row["native_detail"]["usd_basis"] == "venue_index_at_marked_at"
    assert row["native_unit"] is None and row["price_day"] is None


@pytest.mark.parametrize(
    ("kw", "token"),
    [
        ({"balance_error": True}, "balance_error"),
        ({"equity": None}, "balance_error"),
        ({"upnl_unreadable": True}, "upnl_unreadable"),
    ],
)
def test_deribit_unreadable_reads_are_refused_not_zeroed(kw: dict[str, Any], token: str) -> None:
    detail = _nm().deribit_native_detail({"BTC": 0.02}, {"BTC": 0.001}, {"BTC": 0.0012})
    args: dict[str, Any] = dict(venue="deribit", equity=2000.0, open_pnl=120.0, native_detail=detail)
    args.update(kw)
    assert _build(**args) == token


def test_mt5_usd_unit_nav_is_equity_and_open_is_equity_minus_balance() -> None:
    equity, balance = 1500.0, 1400.0
    read = _build(venue="mt5", equity=equity, open_pnl=equity - balance)
    assert (read.nav_usd, read.open_pnl_usd, read.native_unit) == (1500.0, 100.0, "USD")
    # Pitfall 6: nav - open is the balance the derive rolls its realized series from.
    assert read.nav_usd - read.open_pnl_usd == balance == 1400.0


def test_mt5_btc_unit_is_priced_at_the_mark_days_close_and_stores_that_day() -> None:
    # equity 0.5 BTC, balance 0.45 BTC, the stored close of the closed day 60000.
    read = _build(
        venue="mt5", equity=0.5, open_pnl=0.5 - 0.45, native_unit="BTC",
        btc_closes=_closes(("2026-03-01", 60000.0)),
    )
    assert read.nav_native == 0.5 and read.native_unit == "BTC"
    assert read.open_pnl_native == pytest.approx(0.05, abs=1e-12)
    assert read.nav_usd == 30000.0
    assert read.open_pnl_usd == pytest.approx(3000.0, abs=1e-9)
    assert read.price_day == date(2026, 3, 1) == read.mark_day


@pytest.mark.parametrize(
    "closes",
    [
        None,
        # An OLDER close exists; the mark day's does not. Pitfall 3: never the older one.
        _btc_closes_on(("2026-02-28", 59000.0), ("2026-02-27", 58000.0)),
        # TODAY's close is not the closed day's either.
        _btc_closes_on(("2026-03-02", 61000.0)),
    ],
    ids=["no-price-source", "only-an-older-close", "only-todays-close"],
)
def test_mt5_btc_without_the_mark_days_close_is_native_unpriced(closes: pd.Series | None) -> None:
    assert _build(
        venue="mt5", equity=0.5, open_pnl=0.05, native_unit="BTC", btc_closes=closes
    ) == "native_unpriced"


def test_a_native_unit_with_no_price_source_is_refused_by_name() -> None:
    assert _build(
        venue="mt5", equity=5000.0, open_pnl=10.0, native_unit="EUR",
        btc_closes=_closes(("2026-03-01", 60000.0)),
    ) == "native_unit"


def test_sfox_nav_is_the_observed_usd_value_with_no_open_profit() -> None:
    read = _build(venue="sfox", equity=800.0, open_pnl=0.0)
    assert (read.nav_usd, read.open_pnl_usd, read.native_unit) == (800.0, 0.0, "USD")
    assert read.nav_usd - read.open_pnl_usd == 800.0


@pytest.mark.parametrize(
    ("equity", "token"),
    [
        (float("nan"), "nonfinite"),
        (float("inf"), "nonfinite"),
        (0.0, "nonpositive"),
        (-5.0, "nonpositive"),
        (50.0, "dust"),
        (100.0, "dust"),  # AT the floor is dust (the epilogue's <=)
    ],
)
def test_untrustworthy_equity_is_refused_with_its_token(equity: float, token: str) -> None:
    assert _build(equity=equity, open_pnl=0.0) == token


def test_the_first_amount_above_the_dust_floor_is_a_mark() -> None:
    assert not isinstance(_build(equity=100.01, open_pnl=0.0), str)


def test_a_non_finite_open_profit_is_refused_not_stored() -> None:
    assert _build(equity=1000.0, open_pnl=float("nan")) == "nonfinite"


def test_a_callers_token_is_honoured_after_the_read_flags_and_must_be_in_the_closed_set() -> None:
    nm = _nm()
    assert _build(refusal="positions_unreadable") == "positions_unreadable"
    assert _build(refusal="wallet_basis_mismatch") == "wallet_basis_mismatch"
    # A read that already failed keeps ITS reason: the caller's token never masks it.
    assert _build(refusal="wallet_unpriced", balance_error=True) == "balance_error"
    with pytest.raises(ValueError):
        _build(refusal="made_up_reason")
    assert "made_up_reason" not in nm.MARK_REFUSAL_TOKENS


# --------------------------------------------------------------------------------------
# The real derive over each venue's fake read
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_okx_nav_minus_open_is_the_realized_terminal_the_derive_stores() -> None:
    """Pitfall 6 on OKX: totalEq 1050 and upl 50 are the fake payload; the derive rolls its series
    from 1000, and the stored mark's nav minus open is that same 1000."""
    db = FakeDb()
    with marks_not_applied():  # the REALIZED terminal: with the mark applied it is the mark
        _result, capture = await _derive_okx(db, now=T_0010, equity=1050.0, upl=50.0)
    payload = _key_inputs(capture)
    mark = payload["nav_mark"]
    assert payload["realized_terminal_usd"] == 1000.0
    assert mark["nav_usd"] - mark["open_pnl_usd"] == 1000.0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("equity", "token"), [(float("nan"), "nonfinite"), (0.0, "nonpositive"), (50.0, "dust")]
)
async def test_refused_okx_reads_write_no_row_and_the_derive_still_finishes(
    equity: float, token: str
) -> None:
    db = FakeDb()
    result, capture = await _derive_okx(db, now=T_0010, equity=equity, upl=0.0)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    payload = _key_inputs(capture)
    assert payload["nav_mark_refusal"] == token and "nav_mark" not in payload


# ---- MT5 -----------------------------------------------------------------------------


async def _derive_mt5(
    monkeypatch: pytest.MonkeyPatch, db: FakeDb, *, key_mode: bool, account: dict[str, Any],
    closes: pd.Series | None = None, deals: list[dict[str, Any]] | None = None,
) -> tuple[Any, dict[str, Any]]:
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account=account, deals=deals if deals is not None else _canonical_deals()
    )
    ctx, capture = _mt5_build_ctx(transport, asset_class="traditional")
    if key_mode:
        ctx.strategy_row = None
    route_marks(ctx, db)
    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode else "services.job_worker._exchange_preflight"
    )
    patches = [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.benchmark.read_btc_closes", new=AsyncMock(return_value=closes)),
        patch("services.job_worker._utc_now", new=lambda: _FROZEN_NOW),
    ]
    job = (
        {"id": "j-mt5-key", "kind": "derive_broker_dailies", "api_key_id": "key-mt5"}
        if key_mode else
        {"id": "j-mt5", "kind": "derive_broker_dailies", "strategy_id": "strat-mt5"}
    )
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(job)
    return result, capture


@pytest.mark.asyncio
async def test_mt5_usd_key_derive_marks_equity_with_open_profit_and_the_balance_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fake account says equity 110_600 and balance 110_500 (100 open). The mark is the
    equity, the open profit is 100, and nav - open is the 110_500 realized terminal the derive
    stores beside it."""
    db = FakeDb()
    with marks_not_applied():  # the REALIZED terminal: with the mark applied it is the mark
        result, capture = await _derive_mt5(
            monkeypatch, db, key_mode=True,
            account={"equity": 110_600.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert list(db.marks) == [("key-mt5", MARKS_DAY_OF_FROZEN)]
    row = db.marks[("key-mt5", MARKS_DAY_OF_FROZEN)]
    assert row["venue"] == "mt5" and row["allocator_id"] == "u1"
    assert (row["nav_usd"], row["open_pnl_usd"], row["native_unit"]) == (110_600.0, 100.0, "USD")
    assert (row["nav_native"], row["open_pnl_native"], row["price_day"]) == (110_600.0, 100.0, None)
    assert row["marked_at"] == _FROZEN_NOW.isoformat()
    payload = _key_inputs(capture)
    assert payload["realized_terminal_usd"] == 110_500.0
    assert payload["nav_mark"]["nav_usd"] - payload["nav_mark"]["open_pnl_usd"] == 110_500.0


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode", [True, False], ids=["key-mode", "strategy-mode"])
async def test_mt5_btc_account_is_priced_at_the_closed_days_close_in_both_modes(
    monkeypatch: pytest.MonkeyPatch, key_mode: bool
) -> None:
    db = FakeDb()
    with marks_not_applied():  # this fixture prices ONE close: it is about the mark, not the series
        result, _capture = await _derive_mt5(
            monkeypatch, db, key_mode=key_mode,
            account={"equity": 0.5, "balance": 0.45, "currency": "BTC", "login": 123456},
            closes=_closes((_CLOSE_DAY, 60000.0)), deals=_scaled_deals(_BTC_SCALE),
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert list(db.marks) == [("key-mt5", MARKS_DAY_OF_FROZEN)]
    row = db.marks[("key-mt5", MARKS_DAY_OF_FROZEN)]
    assert row["native_unit"] == "BTC" and row["nav_native"] == 0.5
    assert row["open_pnl_native"] == pytest.approx(0.05, abs=1e-12)
    assert row["nav_usd"] == 30_000.0
    assert row["open_pnl_usd"] == pytest.approx(3_000.0, abs=1e-9)
    assert row["price_day"] == _CLOSE_DAY == row["mark_day"]


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode", [True, False], ids=["key-mode", "strategy-mode"])
@pytest.mark.parametrize(
    "closes",
    [None, _btc_closes_on(("2026-10-07", 61950.0))],
    ids=["no-price-source", "only-an-older-close"],
)
async def test_mt5_btc_account_with_no_close_for_the_closed_day_writes_no_mark(
    monkeypatch: pytest.MonkeyPatch, key_mode: bool, closes: pd.Series | None
) -> None:
    """Pitfall 3 / T-167.2.1.1.1-20: the 7th's close is NOT the 8th's, so the mark is refused
    as ``native_unpriced``; a mark priced at a stale close is worse than none."""
    db = FakeDb()
    result, capture = await _derive_mt5(
        monkeypatch, db, key_mode=key_mode,
        account={"equity": 0.5, "balance": 0.45, "currency": "BTC", "login": 123456},
        closes=closes, deals=_scaled_deals(_BTC_SCALE),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    if key_mode:
        assert _key_inputs(capture)["nav_mark_refusal"] == "native_unpriced"


@pytest.mark.asyncio
async def test_mt5_key_with_a_native_unit_nobody_can_price_is_refused_native_unit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeDb()
    result, capture = await _derive_mt5(
        monkeypatch, db, key_mode=True,
        account={"equity": 5.0, "balance": 5.0, "currency": "EUR", "login": 123456},
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "native_unit"


# ---- sFOX ----------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode", [True, False], ids=["key-mode", "strategy-mode"])
async def test_sfox_derive_marks_the_last_observed_usd_value_with_no_open_profit(
    monkeypatch: pytest.MonkeyPatch, key_mode: bool
) -> None:
    from tests.test_sfox_reconstruct import _apply as _sfox_apply
    from tests.test_sfox_reconstruct import _bh_row, _sfox_branch_patches, _sfox_ctx

    monkeypatch.setenv("SFOX_ENABLED", "true")
    db = FakeDb()
    ctx, capture = _sfox_ctx()
    route_marks(ctx, db)
    nav_rows = [_bh_row(d, v) for d, v in (
        ("2026-01-01", "1000"), ("2026-01-02", "1010"), ("2026-01-03", "1020"), ("2026-01-04", "1030"),
    )]
    patches = _sfox_branch_patches(ctx, bh_return=nav_rows, txn_return=[], key_mode=key_mode)
    patches.append(patch("services.job_worker._utc_now", new=MagicMock(return_value=T_0010)))
    job = {"api_key_id": "key-sfox"} if key_mode else {"strategy_id": "s-sfox"}
    with _sfox_apply(patches), patch("services.basis_series.persist_basis_series", new=MagicMock()):
        result = await run_derive_broker_dailies_job(job)
    assert result.outcome == DispatchOutcome.DONE
    assert list(db.marks) == [("key-sfox", "2026-03-01")]
    row = db.marks[("key-sfox", "2026-03-01")]
    assert (row["nav_usd"], row["open_pnl_usd"]) == (1030.0, 0.0)
    assert (row["venue"], row["native_unit"], row["nav_native"]) == ("sfox", "USD", 1030.0)
    assert row["nav_usd"] - row["open_pnl_usd"] == 1030.0  # the series' own last point
    if key_mode:
        assert _key_inputs(capture)["anchor_usd"] == 1030.0


# ---- Deribit -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deribit_key_derive_marks_the_collapsed_equity_with_its_per_currency_detail() -> None:
    """Deribit is the documented exception to the realized-terminal identity (module docstring):
    its terminal is the native balance at the last LEDGER day's mark, so the D-04 step there also
    contains the coin's mark move since that day, which is real MTM profit. This test therefore
    asserts only that the stored nav is the collapsed equity the venue priced (2000.0), the open
    profit is NAV minus wallet (120.0, D-21: (equity 0.02 - balance 0.0188) BTC at the index
    100000), and the native detail is the per-currency summary."""
    from tests.test_mtm_single_key import (
        _base_patches,
        _cash_series,
        _ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )
    from tests.test_mtm_single_key import _apply as _drb_apply

    db = FakeDb()
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    route_marks(ctx, db)
    state = DeribitNativeAccountState(
        native_equity={"BTC": 0.02},
        native_upnl={"BTC": 0.001},
        collapsed_equity_usd=2000.0,
        collapsed_upnl_usd=120.0,
        balance_error=False,
        upnl_unreadable=False,
        native_options_value={},
        native_balance={"BTC": 0.0188},
        index_usd_snapshot={"BTC": 100000.0},
    )
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(return_value=(_stub_native_ledger(), _report(has_option_activity=False))),
        combine_mock=MagicMock(return_value=(_cash_series(), _ledger_meta())),
        state_spy=AsyncMock(return_value=state),
    ) + [patch("services.job_worker._utc_now", new=MagicMock(return_value=T_0010)), marks_not_applied()]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert list(db.marks) == [("key-drb", "2026-03-01")]
    row = db.marks[("key-drb", "2026-03-01")]
    assert (row["venue"], row["nav_usd"]) == ("deribit", 2000.0)
    assert row["open_pnl_usd"] == pytest.approx(120.0, rel=1e-9)
    assert (row["native_unit"], row["nav_native"], row["open_pnl_native"], row["price_day"]) == (
        None, None, None, None,
    )
    assert row["native_detail"] == {
        "equity": {"BTC": 0.02},
        "upnl": {"BTC": 0.001},
        "open_profit": {"BTC": pytest.approx(0.0012, rel=1e-9)},
        "usd_basis": "venue_index_at_marked_at",
    }
    assert _key_inputs(capture)["nav_mark"]["nav_usd"] == 2000.0


def test_every_uniform_read_venue_stamps_its_read_time_where_it_reads() -> None:
    """The four read sites that feed a mark each stamp ``_mark_read_at`` (D-03). A venue branch
    added without one would write no mark and say nothing, so the count is pinned here."""
    import inspect

    source = inspect.getsource(jw.run_derive_broker_dailies_job)
    assert source.count("_mark_read_at = _utc_now()") == 4
    assert source.count("await _write_nav_mark_for_this_derive()") == 1
