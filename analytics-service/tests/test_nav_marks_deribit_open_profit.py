"""Phase 167.2.1.1.1 NAVMTM plan 20 - a Deribit mark stores NAV minus wallet as its open profit (D-21, D-18, D-04).

What these pin, and why each can fail
-------------------------------------
D-21 (founder 2026-10-26): Deribit's stored ``open_pnl_usd`` is the NAV minus the wallet,
``sum over currencies of (equity - balance) x that currency's index at the read``, the per-currency
term being ``_cash_basis_wedge`` (the rule the cash-settlement terminal already uses). It used to be
the combined session uPnL (``collapsed_upnl_usd``). The two differ whenever the account holds an
open option (the option's mark value is in ``equity`` and is not session uPnL) or has accrued
session RPL, and the stored open profit is what the D-04 step books on the first marked day.

D-18 for Deribit, checked against the venue's own documentation
(https://docs.deribit.com/api-reference/account-management/private-get_account_summary): ``equity``
is "balance + futures (session UPL + RPL) + options mark value", so the NAV the mark stores
(``equity`` collapsed at the index) already holds the open option value, and under D-21 so does the
stored open profit.

Every expected number is a literal typed beside its arithmetic from the fake venue payload. The
oracle is never ``cash_basis_open_profit_usd`` or the derive. The read below:

    BTC  balance 1.0  equity 1.6  = 1.0 + futures (UPL 0.1 + RPL 0.0) + options value 0.5
         index 60000   (options session UPL 0.02 sits INSIDE the 0.5)
    ETH  balance 10.0 equity 10.0  index 3000

    nav_usd      = 1.6 x 60000 + 10 x 3000        = 126000
    wallet (USD) = 1.0 x 60000 + 10 x 3000        =  90000
    open_pnl_usd = nav - wallet = 0.6 x 60000 + 0 =  36000
    session uPnL = (0.1 + 0.02) x 60000           =   7200   <- what the mark used to store
"""
from __future__ import annotations

import dataclasses
import math
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.broker_dailies import (
    native_ledger_composed_flows as _real_composed_flows,
    native_ledger_day_pnl as _real_day_pnl,
    native_ledger_realized_terminal as _real_realized_terminal,
)
from services.deribit_ingest import DeribitNativeAccountState, _state_from_summaries
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.native_nav import NativeLedger
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    StrategyDb,
    at_0010,
    route_csv,
    series,
)
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    T_0010,
    _key_inputs,
    _real_marks_writer,
    marks_not_applied,
    route_marks,
)

_READ_AT = "2026-03-02T00:10:00+00:00"
_INDEX: dict[str, float] = {"BTC": 60000.0, "ETH": 3000.0}


def _summaries(*, options_value: float = 0.5) -> list[dict[str, Any]]:
    """The fake ``get_account_summaries`` payload. ``equity`` follows the documented identity, so
    a run with ``options_value`` 0.0 is the same account with its option book closed."""
    btc_equity = 1.0 + 0.1 + 0.0 + options_value
    return [
        {
            "currency": "BTC", "balance": 1.0, "equity": btc_equity,
            "futures_session_upl": 0.1, "futures_session_rpl": 0.0,
            "options_session_upl": 0.02 if options_value else 0.0,
            "options_value": options_value,
        },
        {"currency": "ETH", "balance": 10.0, "equity": 10.0},
    ]


def _state(summaries: list[dict[str, Any]] | None = None) -> DeribitNativeAccountState:
    """The state the REAL pure builder makes of the payload, so the collapsed figures and the
    stored index snapshot come from the production arithmetic and not from the test."""
    return _state_from_summaries(
        _summaries() if summaries is None else summaries, _INDEX, read_at_iso=_READ_AT
    )


async def _key_mode_mark(state: DeribitNativeAccountState) -> tuple[Any, dict[str, Any], FakeDb]:
    """The real KEY-mode derive over ``state``; returns the result, the capture and the marks
    mirror. The derive writes its own mark for the closed day (plan 06)."""
    from tests.test_mtm_single_key import (
        _apply as _drb_apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )

    db = FakeDb()
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    route_marks(ctx, db)
    patches = _base_patches(
        ctx,
        key_mode=True,
        ledger_mock=AsyncMock(
            return_value=(_stub_native_ledger(), _report(has_option_activity=False))
        ),
        combine_mock=MagicMock(
            return_value=(
                pd.Series(
                    [0.01, -0.02, 0.03],
                    index=pd.DatetimeIndex(["2026-02-27", "2026-02-28", "2026-03-01"]),
                    dtype="float64",
                ),
                _ledger_meta(),
            )
        ),
        state_spy=AsyncMock(return_value=state),
    ) + [patch("services.job_worker._utc_now", new=MagicMock(return_value=T_0010)), marks_not_applied()]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb", "kind": "derive_broker_dailies", "api_key_id": "key-drb"}
        )
    return result, capture, db


def _stored(db: FakeDb) -> dict[str, Any]:
    assert list(db.marks) == [("key-drb", "2026-03-01")]
    return db.marks[("key-drb", "2026-03-01")]


# ---- D-21 ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deribit_open_profit_is_nav_minus_wallet() -> None:
    """D-21. NAV 126000, wallet 90000, so the stored open profit is 36000. The session uPnL the
    mark used to store is 7200 (module docstring), which is what this fails on if the mark goes
    back to it."""
    result, _capture, db = await _key_mode_mark(_state())
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    row = _stored(db)
    nav, wallet = 1.6 * 60000.0 + 10.0 * 3000.0, 1.0 * 60000.0 + 10.0 * 3000.0
    assert (nav, wallet) == pytest.approx((126000.0, 90000.0))
    assert row["nav_usd"] == pytest.approx(126000.0, rel=1e-12)
    assert row["open_pnl_usd"] == pytest.approx(36000.0, rel=1e-12)
    assert row["open_pnl_usd"] != pytest.approx(7200.0)
    assert row["nav_usd"] - row["open_pnl_usd"] == pytest.approx(wallet, rel=1e-12)


@pytest.mark.asyncio
async def test_deribit_nav_includes_option_value() -> None:
    """D-18 pin for Deribit. The venue's identity (docs URL in the module docstring) is
    ``equity = balance + futures (session UPL + RPL) + options mark value``, so the NAV is
    ``sum of equity x index`` and holds the 0.5 BTC of option value: 30000 of the 126000. The same
    account with its option book closed (equity 1.1) stores 96000, and the difference is exactly
    the option value at the index."""
    _result, _capture, db_open = await _key_mode_mark(_state())
    _result2, _capture2, db_flat = await _key_mode_mark(_state(_summaries(options_value=0.0)))
    with_options, without = _stored(db_open)["nav_usd"], _stored(db_flat)["nav_usd"]
    assert with_options == pytest.approx((1.0 + 0.1 + 0.5) * 60000.0 + 10.0 * 3000.0, rel=1e-12)
    assert without == pytest.approx((1.0 + 0.1) * 60000.0 + 10.0 * 3000.0, rel=1e-12)
    assert with_options - without == pytest.approx(0.5 * 60000.0, rel=1e-12)
    # Under D-21 the option value is inside the stored open profit too: 36000 against 6000.
    assert _stored(db_open)["open_pnl_usd"] == pytest.approx(36000.0, rel=1e-12)
    assert _stored(db_flat)["open_pnl_usd"] == pytest.approx(0.1 * 60000.0, rel=1e-12)


@pytest.mark.asyncio
async def test_native_detail_open_profit_reconciles() -> None:
    """I4. ``native_detail["upnl"]`` keeps its meaning (the per-currency session uPnL: 0.1 + 0.02
    on BTC) and ``open_profit`` is the per-currency NAV-minus-wallet in native units, so
    ``sum(open_profit x index)`` is the stored ``open_pnl_usd``."""
    _result, _capture, db = await _key_mode_mark(_state())
    row = _stored(db)
    detail = row["native_detail"]
    assert detail["upnl"] == {"BTC": pytest.approx(0.12), "ETH": 0.0}
    assert detail["equity"] == {"BTC": pytest.approx(1.6), "ETH": 10.0}
    assert detail["open_profit"] == {"BTC": pytest.approx(0.6), "ETH": pytest.approx(0.0)}
    reconciled = sum(detail["open_profit"][c] * _INDEX[c] for c in ("BTC", "ETH"))
    assert reconciled == pytest.approx(row["open_pnl_usd"], rel=1e-12)
    assert reconciled == pytest.approx(36000.0, rel=1e-12)


# ---- D-04 ------------------------------------------------------------------------------


def _real_ledger_ending_0305() -> NativeLedger:
    """A REAL ledger whose rolled balance on its last day (2026-03-05) is the wallet of the
    read above: terminal equity less the cash-basis wedge, 1.0 BTC and 10.0 ETH, marked at the
    same index (no price move since the last ledger day), with no flow. Nothing about it is
    stubbed, so the realized terminal below is the production roll."""
    days = pd.DatetimeIndex(["2026-03-04", "2026-03-05"])
    state = _state()
    return NativeLedger(
        native_pnl={
            "BTC": pd.Series([0.0, 0.0], index=days, dtype="float64"),
            "ETH": pd.Series([0.0, 0.0], index=days, dtype="float64"),
        },
        terminal_native_equity=state.native_equity,
        marks={
            "BTC": pd.Series([60000.0, 60000.0], index=days, dtype="float64"),
            "ETH": pd.Series([3000.0, 3000.0], index=days, dtype="float64"),
        },
        native_flows=[],
        terminal_upnl_native={c: di._cash_basis_wedge(state, c) for c in ("BTC", "ETH")},
        full_history=False,
    )


@pytest.mark.asyncio
async def test_d04_step_books_the_stored_open_profit() -> None:
    """D-21's condition. A strategy-mode Deribit derive whose ledger ends 03-05, the day before
    the first mark (03-06), with no flow and an unchanged index: the first marked day's return
    times its base (the realized terminal, 90000, the wallet at the last ledger day's mark) is
    the stored open profit, 36000. The step is the open profit and nothing else.

    The terminal is the PRODUCTION ``native_ledger_realized_terminal`` over a real ledger, so a
    stored open profit on any other basis than NAV minus wallet fails this."""
    from tests.test_mtm_single_key import (
        _apply as _drb_apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _report,
    )

    db = StrategyDb()
    ctx, _capture = _ctx(strategy_row={"id": "strat-1", "user_id": "user-1", "asset_class": "crypto"})
    ctx.key_row = {"id": "key-drb", "user_id": "user-1", "exchange": "deribit"}
    route_csv(route_marks(ctx, db), db)
    report = dataclasses.replace(
        _report(has_option_activity=False), indexable_currencies=frozenset({"BTC", "ETH"})
    )
    patches = _base_patches(
        ctx, key_mode=False,
        ledger_mock=AsyncMock(return_value=(_real_ledger_ending_0305(), report)),
        combine_mock=MagicMock(return_value=(series(REALIZED_THROUGH_0305), _ledger_meta())),
        state_spy=AsyncMock(return_value=_state()),
    ) + [
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-07"))),
        # The three ledger readers are the production ones over the real ledger.
        patch("services.broker_dailies.native_ledger_realized_terminal", new=_real_realized_terminal),
        patch("services.broker_dailies.native_ledger_day_pnl", new=_real_day_pnl),
        patch("services.broker_dailies.native_ledger_composed_flows", new=_real_composed_flows),
    ]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb", "kind": "derive_broker_dailies", "strategy_id": "strat-1"}
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert list(db.marks) == [("key-drb", "2026-03-06")]
    stored_open = db.marks[("key-drb", "2026-03-06")]["open_pnl_usd"]
    assert stored_open == pytest.approx(36000.0, rel=1e-12)
    base = 1.0 * 60000.0 + 10.0 * 3000.0  # the wallet at the last ledger day's mark
    first_return = db.rows()["2026-03-06"]
    assert first_return == pytest.approx((126000.0 - base) / base, rel=1e-9)
    assert first_return * base == pytest.approx(stored_open, rel=1e-9)


# ---- the helper itself -----------------------------------------------------------------


def test_usd_family_wedge_is_priced_at_one_and_needs_no_index() -> None:
    """A USDC wedge is already dollars: it is counted at 1.0 with an empty index map."""
    state = _state_from_summaries(
        [{"currency": "USDC", "balance": 1000.0, "equity": 1012.5}], {}, read_at_iso=_READ_AT
    )
    assert state.index_usd_snapshot == {}
    assert di.cash_basis_open_profit_usd(state) == pytest.approx(12.5)
    assert di.cash_basis_open_profit_native(state) == {"USDC": pytest.approx(12.5)}


def test_component_form_applies_when_the_balance_was_not_read() -> None:
    """With no ``balance`` the wedge is ``_cash_basis_wedge``'s component form:
    ``native_upnl - options_session_upl + options_value`` = 0.12 - 0.02 + 0.5 = 0.6 BTC."""
    summaries = _summaries()
    del summaries[0]["balance"]
    state = _state(summaries)
    assert di.cash_basis_open_profit_native(state)["BTC"] == pytest.approx(0.6)
    assert di.cash_basis_open_profit_usd(state) == pytest.approx(0.6 * 60000.0)


def test_a_non_finite_index_is_not_a_price() -> None:
    state = dataclasses.replace(_state(), index_usd_snapshot={"BTC": math.nan, "ETH": 3000.0})
    assert di.cash_basis_open_profit_usd(state) is None


# ---- Task 2: never priced on a guess ---------------------------------------------------


def _unindexed(state: DeribitNativeAccountState, ccy: str) -> DeribitNativeAccountState:
    """The same state with ``ccy`` missing from the index snapshot the read priced at."""
    return dataclasses.replace(
        state,
        index_usd_snapshot={c: p for c, p in state.index_usd_snapshot.items() if c != ccy},
    )


@pytest.mark.asyncio
async def test_unpriced_wedge_currency_refuses() -> None:
    """ETH carries a wedge of 0.2 (equity 10.0, balance 9.8) and no ETH index is in the read:
    the open profit cannot be priced, so no mark is written, the refusal is named in key_inputs
    and the derive still completes. Nothing is priced at zero or at another currency's index."""
    summaries = _summaries()
    summaries[1]["balance"] = 9.8
    state = _unindexed(_state(summaries), "ETH")
    assert di.cash_basis_open_profit_usd(state) is None
    result, capture, db = await _key_mode_mark(state)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    assert _key_inputs(capture)["nav_mark_refusal"] == "upnl_unreadable"


@pytest.mark.asyncio
async def test_zero_wedge_currency_without_an_index_does_not_refuse() -> None:
    """ETH is flat (equity equals balance) and has no index in the read: its wedge is exactly
    zero, so there is nothing to price and the mark is written on the BTC wedge alone."""
    state = _unindexed(_state(), "ETH")
    assert di.cash_basis_open_profit_usd(state) == pytest.approx(36000.0)
    result, _capture, db = await _key_mode_mark(state)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert _stored(db)["open_pnl_usd"] == pytest.approx(36000.0, rel=1e-12)
