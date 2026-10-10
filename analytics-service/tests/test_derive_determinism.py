"""Derive determinism (DERIBITWEDGE 167.1.2.2.1, SC-6 / D-03).

Two derives over the SAME ledger rows must produce identical returns, whatever the live
account state does inside the session. Before this phase the cash wedge read the live
``options_session_upl`` (subtracted although ``options_value`` already holds it) and never
read ``session_rpl``, so an options mark drift or a realised-PnL accrual between two derives
moved the rolled terminal and with it the returns (a measured disagreement on PROD siblings
of one account). The wedge is now ``equity - balance`` and a stored snapshot replays the
derive without a second exchange read.

The ledger is built through the REAL ``build_deribit_native_ledger`` and combined through the
REAL ``combine_native_ledger``; only the I/O primitives are stubbed. The oracle is the
invariant itself (byte equality of two series), never a number copied from the code. The
cause is recorded in the debug note named ``derivecron-compose-refusal``.
"""

from __future__ import annotations

import dataclasses
import json
import struct
from typing import Any

import pandas as pd
import pytest

from services import deribit_ingest as di
from services.allocator_equity_derive import account_summary_payload, read_account_summary
from services.broker_dailies import combine_native_ledger
from tests.test_deribit_ingest import (
    _NativeAnchorStub,
    _btc_deposit,
    _btc_option_trade,
    _jul_ms,
    _patch_jul_index,
    _patch_pipeline,
)


def _rows_paginate():
    """The same ledger rows every time: deposit 10, an option premium -1.0 and perp
    settlements +2000 / -2000 / +0.01, so the cash balance is 9.01. The 4000 of gross
    throughput lets section 5's dust allowance absorb a leak of the size the old wedge
    carried, as it does on a real account; the old code therefore did not refuse, it
    silently moved the returns."""

    def _settle(day: int, change: float) -> dict[str, Any]:
        return {"type": "settlement", "instrument_name": "BTC-PERPETUAL",
                "currency": "BTC", "change": change, "index_price": 60000.0,
                "timestamp": _jul_ms(day, 8)}

    async def _paginate(
        _ex: Any, scope_label: str, currency: str, *_a: Any, **_k: Any
    ) -> list[Any]:
        if currency != "BTC":
            return []
        return [
            _btc_deposit(9, change=10.0),
            _btc_option_trade(10, change=-1.0, commission=0.0),
            _settle(11, 2000.0),
            _settle(12, -2000.0),
            _settle(13, 0.01),
        ]

    return _paginate


# Cash balance of the rows above: 10 deposit - 1 premium + 0.01 perp.
_CASH = 9.01

# Live state "a": futures session uPnL 0.1, an open option book marked 1.20 of which 0.15 is
# the session move. equity = balance + futures + options_value (the documented identity).
_A: dict[str, Any] = {
    "currency": "BTC",
    "futures_session_upl": 0.1,
    "session_upl": 0.1,
    "options_session_upl": 0.15,
    "options_value": 1.20,
    "balance": _CASH,
    "equity": _CASH + 0.1 + 1.20,
}

# The four things that can move inside a session, each with equity moving as the identity says.
_PERTURBATIONS: dict[str, tuple[dict[str, Any], float]] = {
    # A: the open option book's mark drifts (session move 0.15 -> 0.20, mark 1.20 -> 1.25).
    "A": ({**_A, "options_session_upl": 0.20, "options_value": 1.25,
           "equity": _CASH + 0.1 + 1.25}, 60000.0),
    # B: the futures session uPnL drifts (control: the old wedge moved with equity here).
    "B": ({**_A, "futures_session_upl": 0.15, "session_upl": 0.15,
           "equity": _CASH + 0.15 + 1.20}, 60000.0),
    # C: realised PnL accrues in the session, balance unchanged until the 08:00 settlement.
    "C": ({**_A, "session_rpl": 0.03, "futures_session_rpl": 0.03,
           "equity": _CASH + 0.1 + 1.20 + 0.03}, 60000.0),
    # D: the live index moves (feeds the collapsed anchor only; control).
    "D": (dict(_A), 61000.0),
}


async def _derive_returns(
    monkeypatch: Any,
    summary: dict[str, Any],
    *,
    index: float = 60000.0,
    account_state: Any = None,
    stub: _NativeAnchorStub | None = None,
) -> pd.Series:
    _patch_pipeline(
        monkeypatch, scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]}, paginate=_rows_paginate(),
    )
    _patch_jul_index(monkeypatch)
    ex = stub or _NativeAnchorStub(summaries=[summary], index_price={"BTC": index})
    ledger, report = await di.build_deribit_native_ledger(ex, account_state=account_state)
    returns, _meta = combine_native_ledger(ledger, report.indexable_currencies)
    return returns


def _assert_byte_equal(left: pd.Series, right: pd.Series) -> None:
    pd.testing.assert_series_equal(left, right, check_exact=True)
    assert left.to_numpy().tobytes() == right.to_numpy().tobytes()
    # The bytes, spelled out: each value's IEEE-754 pattern, not a tolerance.
    assert [struct.pack("<d", float(v)) for v in left] == [
        struct.pack("<d", float(v)) for v in right
    ]


@pytest.mark.parametrize("name", ["A", "B", "C", "D"])
async def test_live_state_drift_does_not_move_returns(monkeypatch: Any, name: str) -> None:
    """D-03: whichever of the four live quantities drifts between two derives, the returns
    are byte-equal. A (options mark) and C (session_rpl) failed on the old wedge, B and D
    were already stable and stay so."""
    drifted, index = _PERTURBATIONS[name]
    ret_a = await _derive_returns(monkeypatch, _A)
    assert len(ret_a) >= 3  # the series is not trivially empty, so equality means something
    ret_x = await _derive_returns(monkeypatch, drifted, index=index)
    _assert_byte_equal(ret_a, ret_x)


async def test_identical_stub_twice_is_byte_equal(monkeypatch: Any) -> None:
    """Control: the harness itself is deterministic, so a failure above is the wedge's, not
    the test's."""
    first = await _derive_returns(monkeypatch, _A)
    second = await _derive_returns(monkeypatch, _A)
    _assert_byte_equal(first, second)


async def test_stored_snapshot_replay_is_byte_equal(monkeypatch: Any) -> None:
    """D-03: a derive replayed from the STORED ``account_summary`` reproduces the original
    byte for byte even when the exchange's live state has since drifted, and the replay makes
    no summaries read at all."""
    _patch_pipeline(
        monkeypatch, scopes=[di.Scope("main", None, True)],
        currencies={"main": ["BTC"]}, paginate=_rows_paginate(),
    )
    _patch_jul_index(monkeypatch)
    # State "a" with a realised-PnL accrual, so the ``balance`` anchor and the component
    # fallback give different wedges: a rebuild that dropped ``balance`` could not match.
    accrued = {**_A, "session_rpl": 0.03, "futures_session_rpl": 0.03,
               "equity": _CASH + 0.1 + 1.20 + 0.03}
    live = _NativeAnchorStub(summaries=[accrued], index_price={"BTC": 60000.0})
    state = await di.fetch_deribit_native_account_state(live)
    ledger, report = await di.build_deribit_native_ledger(live, account_state=state)
    original, _ = combine_native_ledger(ledger, report.indexable_currencies)

    # What the worker stores, as the database would hand it back (a JSON round trip).
    payload = json.loads(json.dumps(account_summary_payload(state)))
    stored = read_account_summary(payload)
    assert stored is not None
    rebuilt = di.DeribitNativeAccountState.from_stored(stored)

    drifted, _ = _PERTURBATIONS["A"]
    after = _NativeAnchorStub(summaries=[drifted], index_price={"BTC": 61000.0})
    ledger2, report2 = await di.build_deribit_native_ledger(after, account_state=rebuilt)
    replayed, _ = combine_native_ledger(ledger2, report2.indexable_currencies)

    _assert_byte_equal(original, replayed)
    assert after.summaries_calls == 0  # the stored read stood in for the exchange's


_LIVE_SUMMARIES: dict[str, list[dict[str, Any]]] = {
    # An options-holding BTC account beside a USDC balance and a currency the snapshot
    # keeps only partly (no balance, a string margin model, a boolean).
    "valuable": [
        {**_A, "margin_model": "segregated_sm", "cross_collateral_enabled": False,
         "session_rpl": 0.02, "futures_session_rpl": 0.02, "options_session_rpl": 0.0,
         "total_pl": 1.5, "margin_balance": 10.0},
        {"currency": "USDC", "equity": 1234.5, "balance": 1200.0, "session_upl": 34.5},
        {"currency": "ETH", "equity": 2.0, "session_upl": 0.1},  # no balance: absent, not 0
    ],
    # ETH is held but its index does not resolve: the collapse is refused, the native maps stay.
    "unvaluable_collapse": [
        {"currency": "ETH", "equity": 2.0, "balance": 1.9, "session_upl": 0.1},
    ],
}


@pytest.mark.parametrize("case", sorted(_LIVE_SUMMARIES))
async def test_from_stored_round_trips_every_native_map(case: str) -> None:
    """The rebuilt state equals the live-read state in every field: each native map and the
    collapsed anchor, wedge and flags (``balance`` stays absent for a currency that had none)."""
    index = {"BTC": 60000.0, "ETH": 3000.0} if case == "valuable" else {}
    live = _NativeAnchorStub(summaries=_LIVE_SUMMARIES[case], index_price=index or None)
    state = await di.fetch_deribit_native_account_state(live)
    if case == "unvaluable_collapse":
        assert state.balance_error and state.collapsed_equity_usd is None  # the path under test
    else:
        assert not state.balance_error
    payload = json.loads(json.dumps(account_summary_payload(state)))
    stored = read_account_summary(payload)
    assert stored is not None
    rebuilt = di.DeribitNativeAccountState.from_stored(stored)
    for fld in dataclasses.fields(di.DeribitNativeAccountState):
        assert getattr(rebuilt, fld.name) == getattr(state, fld.name), fld.name
    if case == "valuable":
        assert "ETH" not in rebuilt.native_balance
        assert rebuilt.native_balance["BTC"] == _CASH


def test_from_stored_fails_loud_on_a_corrupt_row() -> None:
    """A stored row missing a key raises ``KeyError`` instead of being read as a guess."""
    with pytest.raises(KeyError):
        di.DeribitNativeAccountState.from_stored({"summaries": [], "index_usd": {}})
