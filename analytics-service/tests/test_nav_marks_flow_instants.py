"""The instant each raw flow row carries (Phase 167.2.1.1.1 NAVMTM, decision D-23).

``apply_marks`` places a flow made on a mark's read day by comparing the flow's own instant with
the mark's ``marked_at``. The venue producers aggregate flows by UTC day, so each one also
reports one ``FlowInstant`` per raw row. What can go wrong, and what each test pins:

* an instant list that does not add up to the day aggregate it came from would move more or
  less than the flow itself (the compose roll then misses the mark by the difference);
* a producer whose return value changes when it is asked for instants would change every
  existing derive.

Every value is synthetic.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from services.external_flows import FlowInstant

_UTC = dt.timezone.utc


def _ms(y: int, m: int, d: int, h: int = 0, minute: int = 0) -> int:
    return int(dt.datetime(y, m, d, h, minute, tzinfo=_UTC).timestamp() * 1000)


def _deribit_rows() -> list[dict[str, object]]:
    return [
        {"type": "deposit", "currency": "BTC", "change": 0.3, "timestamp": _ms(2026, 3, 3, 0, 5)},
        {"type": "deposit", "currency": "BTC", "change": 0.2, "timestamp": _ms(2026, 3, 3, 9, 0)},
        {"type": "withdrawal", "currency": "USDC", "change": -40.0, "timestamp": _ms(2026, 3, 4, 0, 1)},
        {"type": "deposit", "currency": "USDC", "change": 100.0, "timestamp": _ms(2026, 3, 3, 0, 2)},
        {"type": "trade", "currency": "BTC", "change": 0.01, "timestamp": _ms(2026, 3, 3, 1, 0)},
        {"type": "deposit", "currency": "USDC", "change": 0.0, "timestamp": _ms(2026, 3, 3, 2, 0)},
    ]


def test_deribit_flow_instants_are_one_per_flow_row_with_its_own_timestamp() -> None:
    from services.deribit_txn import deribit_flow_instants

    got = deribit_flow_instants(_deribit_rows())

    assert got == [
        FlowInstant(_ms(2026, 3, 3, 0, 5), "2026-03-03", 0.3, "BTC"),
        FlowInstant(_ms(2026, 3, 3, 9, 0), "2026-03-03", 0.2, "BTC"),
        FlowInstant(_ms(2026, 3, 4, 0, 1), "2026-03-04", -40.0, "USDC"),
        FlowInstant(_ms(2026, 3, 3, 0, 2), "2026-03-03", 100.0, "USDC"),
    ], "a trade row and a zero-change flow row are not flows"


def test_a_days_deribit_instants_add_up_to_the_days_composed_flow() -> None:
    """The composed flow of a day is ``flowqty x same-day mark`` summed over currencies, and the
    instants are valued the same way, so what ``apply_marks`` moves out of a day never exceeds or
    falls short of what that day's flow holds. The oracle is the ledger's own composed series."""
    from services.broker_dailies import native_ledger_composed_flows
    from services.deribit_txn import deribit_dated_external_flows_usd, deribit_flow_instants
    from services.native_nav import NativeLedger, native_flow_instants

    days = pd.date_range("2026-03-01", "2026-03-05", freq="D")
    rows = _deribit_rows()
    marks = pd.Series([50_000.0, 51_000.0, 52_000.0, 53_000.0, 54_000.0], index=days)
    ledger = NativeLedger(
        native_pnl={
            "BTC": pd.Series([0.001] * 5, index=days),
            "USDC": pd.Series([1.0] * 5, index=days),
        },
        terminal_native_equity={"BTC": 1.0, "USDC": 500.0},
        marks={"BTC": marks},
        native_flows=deribit_dated_external_flows_usd(
            rows, supplemental_index={("2026-03-03", "BTC"): 52_000.0}
        ),
        terminal_upnl_native={},
        full_history=False,
        flow_instants=tuple(deribit_flow_instants(rows)),
    )
    indexable = frozenset({"BTC"})

    composed = native_ledger_composed_flows(ledger, indexable)
    valued = native_flow_instants(ledger, indexable_currencies=indexable)

    by_day: dict[str, float] = {}
    for fi in valued:
        by_day[fi.day] = by_day.get(fi.day, 0.0) + fi.amount
    assert by_day["2026-03-03"] == pytest.approx(0.5 * 52_000.0 + 100.0)
    assert by_day["2026-03-04"] == pytest.approx(-40.0)
    for ts, amount in composed.items():
        assert by_day.get(ts.date().isoformat(), 0.0) == pytest.approx(float(amount), abs=1e-9)
    assert {fi.currency for fi in valued} == {"USD"}


def test_at_instant_index_prices_only_a_moved_indexed_instant() -> None:
    """Phase 177 DERIBITFLOWS D-02, D-04. ``at_instant_index`` is keyed ``(CCY, at_ms)`` and sets
    ``amount_prior_day`` on an INDEXED instant only; ``amount`` stays qty x the own-day ledger
    mark (what leaves the read day). Hand arithmetic, own-day mark 52_000.0, candle open 51_000.0:
      0.5 BTC with a key     -> amount 0.5 x 52_000.0 = 26_000.0, amount_prior_day 0.5 x 51_000.0 = 25_500.0
      0.2 BTC with no key    -> amount 0.2 x 52_000.0 = 10_400.0, amount_prior_day None
      100.0 USDC with a key  -> amount 100.0, amount_prior_day None (a USD-family flow is never repriced)"""
    from services.native_nav import NativeLedger, native_flow_instants

    days = pd.date_range("2026-03-01", "2026-03-05", freq="D")
    keyed = _ms(2026, 3, 3, 0, 5)
    unkeyed = _ms(2026, 3, 3, 9, 0)
    usdc = _ms(2026, 3, 3, 0, 2)
    ledger = NativeLedger(
        native_pnl={"BTC": pd.Series([0.001] * 5, index=days)},
        terminal_native_equity={"BTC": 1.0},
        marks={"BTC": pd.Series([50_000.0, 51_000.0, 52_000.0, 53_000.0, 54_000.0], index=days)},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
        flow_instants=(
            FlowInstant(keyed, "2026-03-03", 0.5, "BTC"),
            FlowInstant(unkeyed, "2026-03-03", 0.2, "BTC"),
            FlowInstant(usdc, "2026-03-03", 100.0, "USDC"),
        ),
    )
    indexable = frozenset({"BTC"})

    got = native_flow_instants(
        ledger,
        indexable_currencies=indexable,
        at_instant_index={("BTC", keyed): 51_000.0, ("USDC", usdc): 99_999.0},
    )

    assert [(fi.at_ms, fi.currency) for fi in got] == [
        (keyed, "USD"), (unkeyed, "USD"), (usdc, "USD"),
    ]
    assert got[0].amount == pytest.approx(26_000.0)
    assert got[0].amount_prior_day == pytest.approx(25_500.0)
    assert got[1].amount == pytest.approx(10_400.0)
    assert got[1].amount_prior_day is None
    assert got[2].amount == pytest.approx(100.0)
    assert got[2].amount_prior_day is None
    assert native_flow_instants(ledger, indexable_currencies=indexable) == native_flow_instants(
        ledger, indexable_currencies=indexable, at_instant_index=None
    )


def test_ccxt_instants_add_up_to_the_day_and_change_nothing_else() -> None:
    """One instant per surviving row, valued as the row enters its day (a withdrawal's fee
    included), and the returned flows are identical with or without the out-list."""
    from services.ccxt_flows import ccxt_rows_to_dated_flows

    rows = [
        {"type": "deposit", "currency": "USDT", "amount": 100.0, "timestamp": _ms(2026, 3, 3, 0, 5)},
        {"type": "deposit", "currency": "USDT", "amount": 50.0, "timestamp": _ms(2026, 3, 3, 8, 0)},
        {"type": "withdrawal", "currency": "USDT", "amount": 30.0, "timestamp": _ms(2026, 3, 4, 0, 1),
         "fee": {"currency": "USDT", "cost": 1.0}},
    ]
    plain = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
    instants: list[FlowInstant] = []
    with_out = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={}, instants=instants)

    assert with_out == plain
    assert [(fi.at_ms, fi.day) for fi in instants] == [
        (_ms(2026, 3, 3, 0, 5), "2026-03-03"),
        (_ms(2026, 3, 3, 8, 0), "2026-03-03"),
        (_ms(2026, 3, 4, 0, 1), "2026-03-04"),
    ]
    for flow in plain:
        assert sum(fi.amount for fi in instants if fi.day == flow.utc_day_iso) == pytest.approx(
            flow.usd_signed
        )


def test_sfox_instants_add_up_to_the_day_and_change_nothing_else() -> None:
    from services.sfox_read import sfox_flows_by_day

    rows = [
        {"action": "deposit", "currency": "USD", "amount": "50", "timestamp": _ms(2026, 3, 4, 0, 5)},
        {"action": "withdraw", "currency": "USD", "amount": "20", "timestamp": _ms(2026, 3, 4, 7, 0)},
        {"action": "buy", "currency": "USD", "amount": "10", "timestamp": _ms(2026, 3, 4, 8, 0)},
    ]
    plain_series, plain_evidence = sfox_flows_by_day(rows)
    instants: list[FlowInstant] = []
    series, evidence = sfox_flows_by_day(rows, instants)

    pd.testing.assert_series_equal(series, plain_series)
    assert evidence == plain_evidence
    assert instants == [
        FlowInstant(_ms(2026, 3, 4, 0, 5), "2026-03-04", 50.0),
        FlowInstant(_ms(2026, 3, 4, 7, 0), "2026-03-04", -20.0),
    ]
    assert float(series.loc[pd.Timestamp("2026-03-04")]) == pytest.approx(
        sum(fi.amount for fi in instants)
    )
