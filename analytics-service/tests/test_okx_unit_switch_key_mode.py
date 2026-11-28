"""Phase 256 OKXUNITSWITCH plan 09 (SC-2, SC-3, SC-5, SC-7): the KEY-mode derive of an OKX account that
moved from USDT into BTC ends DONE, states its whole-history USD inputs, and the allocator compose
builds its book in USD.

Every derive test drives the REAL ``run_derive_broker_dailies_job`` with ``key_mode=True`` through
``tests/fixtures/okx_unit_switch_derive_harness.py`` (real bills read, real switch rule, real series
builder, real key-mode epilogue). Dates are computed from today (the derive reads the wall clock);
every amount is a round synthetic literal (T-256-02).

On the BASE ``job_worker.py`` the same harness ends FAILED with ``daily_pnl_non_usd_okx`` (the RED
arm, pasted in the SUMMARY). Every test that needs the derive asserts DONE first, so on the base each
of them fails by assertion; ``test_the_reader_is_unchanged_for_a_usd_key_and_a_native_unit_key`` is a
control that passes on the base by design (it pins that the reader change leaves those keys alone).

Oracles are independent of the code under test: expected USD figures are the native figures of the
pure builder (``build_switched_series``) priced by hand at each day's stored close, or the account
equity the harness feeds in (the realized terminal is the live equity when no position is open).

PROOF-01 (recorded in the SUMMARY; backups restored with ``cp``, ``cmp`` silent):

- A (pricing) price the coin days' USD day P&L at the close of S instead of each day's own close:
  ``test_usd_day_pnl_for_coin_days_is_priced_at_each_days_own_close``.
- B (no unit flag) write ``native_unit`` into the key payload AND the strategy prestamp flags: the
  key-mode tracer, and the portfolio and simulator reader tests in ``test_okx_unit_switch_readers.py``
  (those two read the strategy row's flags).
- C (unpriced days) drop the unpriced days from the payload: the payload test and the compose test.
"""
from __future__ import annotations

from datetime import datetime, time as dtime, timezone
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_compose import (
    compose_allocator_equity,
    read_native_key_inputs,
)
from services.allocator_equity_derive import read_realized_terminal
from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome
from services.unit_switch import SplitPnl, UnitSwitch, split_daily_pnl_at_switch
from services.unit_switch_series import SwitchedSeries, build_switched_series
from tests.fixtures.okx_unit_switch_derive_harness import (
    EQUITY_USD,
    Calendar,
    SwitchedDeriveCapture,
    founder_closes,
    run_switched_derive,
)

COIN_BILL_NATIVE = {"s": -0.0012, "d8": -0.0009}  # BTC, the two founder-shaped coin-fee days


def _key_payload(run: SwitchedDeriveCapture) -> dict[str, Any]:
    (row,) = [
        payload
        for name, payload, _conflict in run.upserts
        if name == "allocator_equity_derived" and str(payload["kind"]).startswith("key_inputs:")
    ]
    assert row["kind"] == "key_inputs:key-sw"
    return dict(row["payload"])


def _rows(run: SwitchedDeriveCapture) -> dict[str, float]:
    return {r["date"]: r["daily_return"] for r in run.csv_rows}


def _closes_by_day(closes: pd.Series) -> dict[str, float]:
    return {ts.date().isoformat(): float(v) for ts, v in closes.items()}


def _built(
    cal: Calendar,
    *,
    closes: pd.Series | None = None,
    flows: list[ExternalFlow] | None = None,
    funding: list[dict[str, Any]] | None = None,
) -> tuple[UnitSwitch, SplitPnl, SwitchedSeries, pd.Series]:
    """The pure builder's answer for the default founder-shaped account (USDT P&L on days -18 and
    -16, BTC fees on S = day -14 and day -8, the default live anchor)."""
    switch = UnitSwitch("BTC", cal.day(14), cal.day(13))
    stored = founder_closes(cal) if closes is None else closes
    split = split_daily_pnl_at_switch(
        {cal.day(18): 9.0, cal.day(16): 3.5},
        {cal.day(14): COIN_BILL_NATIVE["s"], cal.day(8): COIN_BILL_NATIVE["d8"]},
        switch,
        _closes_by_day(stored),
    )
    assert isinstance(split, SplitPnl)
    built = build_switched_series(
        switch=switch,
        split=split,
        funding_rows=funding or [],
        external_flows=flows or [],
        anchor_usd=EQUITY_USD,
        anchor_price=float(stored.iloc[-1]),
        open_unrealized_usd=0.0,
        closes=stored,
        latest_close_day=cal.day(1),
        usd_full_history=True,
    )
    assert isinstance(built, SwitchedSeries)
    return switch, split, built, stored


class TestTracerFounderShapedKeyDerive:
    async def test_tracer_key_derive_ends_done_with_usd_key_inputs_and_unit_segments(self) -> None:
        cal = Calendar.now()
        run = await run_switched_derive(key_mode=True, cal=cal)

        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        payload = _key_payload(run)
        s_day, first_coin_day = cal.day(14), cal.day(13)

        # T-256-27: the series is all USD, so nothing may price it a second time.
        assert "native_unit" not in payload, sorted(payload)
        assert "daily_pnl_non_usd_okx" not in payload and "writer_basis_withheld" not in payload
        assert payload["anchor_usd"] == pytest.approx(EQUITY_USD)
        assert payload["anchor_null_reason"] is None

        # SC-2 (key mode): the additive two-unit record in the plan-02 shape.
        segments = payload["unit_segments"]
        assert segments["version"] == 1
        usd_seg, coin_seg = segments["segments"]
        assert usd_seg["unit"] == "USD" and usd_seg["to_day"] == s_day
        assert coin_seg["unit"] == "BTC"
        assert coin_seg["base_day"] == s_day and coin_seg["from_day"] == first_coin_day
        assert all(p["date"] > s_day for p in coin_seg["returns"])
        rows = _rows(run)
        assert any(day > s_day for day in rows), "the coin segment must reach the headline"
        for point in usd_seg["returns"]:
            assert rows[point["date"]] == pytest.approx(point["value"], abs=1e-12)

    async def test_the_key_returns_equal_the_strategy_headline_and_the_builders(self) -> None:
        """The key row's series IS the strategy-mode headline for the same inputs, and both are the
        pure builder's headline: the key derive adds nothing and drops nothing."""
        cal = Calendar.now()
        key_run = await run_switched_derive(key_mode=True, cal=cal)
        strategy_run = await run_switched_derive(key_mode=False, cal=cal)
        assert key_run.result is not None and key_run.result.outcome == DispatchOutcome.DONE
        assert strategy_run.result is not None and strategy_run.result.outcome == DispatchOutcome.DONE

        expected = {
            ts.date().isoformat(): float(v)
            for ts, v in _built(cal)[2].headline.items()
            if v == v
        }
        for stored in (_rows(key_run), _rows(strategy_run)):
            assert set(stored) == set(expected)
            for day, value in expected.items():
                assert stored[day] == pytest.approx(value, abs=1e-12), day

    async def test_the_realized_terminal_is_the_coin_level_priced_at_the_last_days_own_close(
        self,
    ) -> None:
        """With no open position the realized terminal is the live equity; it is also the coin
        level on the last priced day times that day's close (two independent routes to the same
        dollars). It sits on the last priced day, which is the latest completed day."""
        cal = Calendar.now()
        run = await run_switched_derive(key_mode=True, cal=cal)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        payload = _key_payload(run)
        _switch, _split, built, closes = _built(cal)
        last_day = cal.day(1)

        terminal = read_realized_terminal(payload)
        assert terminal is not None
        assert terminal[0] == last_day == payload["priced_through"]
        by_day = _closes_by_day(closes)
        assert terminal[1] == pytest.approx(float(built.coin_nav_levels.iloc[-1]) * by_day[last_day])
        assert terminal[1] == pytest.approx(EQUITY_USD)
        assert payload["unpriced_days"] == [] and payload["segment_terminals"] == []
        # ccxt keys never store a writer basis: the compose rolls the stored returns.
        assert "composed_flows" not in payload and "composed_day_pnl" not in payload

    async def test_flows_on_coin_days_are_the_native_flow_times_that_days_own_close(self) -> None:
        cal = Calendar.now()
        deposit_day = cal.day(5)
        deposit = {
            "id": "dep-1",
            "type": "deposit",
            "currency": "USDT",
            "amount": 5000.0,
            "timestamp": datetime.combine(
                cal.today.fromordinal(cal.today.toordinal() - 5), dtime(12, 0), tzinfo=timezone.utc
            ).isoformat(),
            "internal": None,
            "info": {},
        }
        run = await run_switched_derive(key_mode=True, cal=cal, deposits=[deposit])
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        payload = _key_payload(run)

        _switch, _split, built, closes = _built(
            cal, flows=[ExternalFlow(deposit_day, 5000.0)]
        )
        native = built.coin_flow_by_day[deposit_day]
        assert native * _closes_by_day(closes)[deposit_day] == pytest.approx(5000.0)
        assert payload["flows"] == [{"utc_day_iso": deposit_day, "usd_signed": pytest.approx(5000.0)}]

    async def test_a_done_key_derive_clears_its_read_incomplete_marker_and_enqueues_the_compose(
        self,
    ) -> None:
        """Plan 06 hand-off: the strategy row's kept-figures marker clears when its job ends done;
        the KEY marker is cleared by ``_clear_read_incomplete`` on the epilogue, which a switched key
        now reaches."""
        run = await run_switched_derive(key_mode=True)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        assert any(
            d["table"] == "allocator_equity_derived"
            and d["filters"].get("eq:kind") == "read_incomplete:key-sw"
            for d in run.deletes
        ), run.deletes
        assert any(
            name == "enqueue_compute_job" and args.get("p_kind") == "derive_allocator_equity"
            for name, args in run.rpc_calls
        ), run.rpc_calls


class TestKeyModeWithStoredMarks:
    """The founder account's PROD shape: stored USD marks dated INSIDE the coin segment. The marks
    block re-bases the whole USD headline, takes the key's terminal from the last mark, and the
    payload fields this plan adds (day P&L, unpriced days, segment terminals, unit_segments) have to
    survive it, in the compose as well."""

    async def test_marks_on_coin_days_are_applied_once_and_the_key_still_composes(self) -> None:
        from datetime import datetime

        from services.nav_marks import StoredMark
        from services.nav_marks_apply import AppliedMark, apply_marks
        from services.nav_twr import DUST_NAV_FLOOR

        cal = Calendar.now()
        marks = [
            StoredMark(
                mark_day=cal.day(back),
                marked_at=f"{cal.day(back - 1)}T12:00:00+00:00",
                venue="okx",
                nav_usd=nav,
                open_pnl_usd=0.0,
                nav_native=None,
                native_unit=None,
            )
            for back, nav in ((6, 200_000.0), (5, 201_000.0), (4, 199_000.0))
        ]
        run = await run_switched_derive(key_mode=True, cal=cal, marks=marks)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        payload = _key_payload(run)

        # The marks are applied once to the same headline the strategy derive gets.
        expected = apply_marks(
            _built(cal)[2].headline,
            {},
            [
                AppliedMark(m.mark_day, m.nav_usd, m.open_pnl_usd, datetime.fromisoformat(m.marked_at))
                for m in marks
            ],
            dust_floor=DUST_NAV_FLOOR,
        ).returns
        stored = _rows(run)
        want = {ts.date().isoformat(): float(v) for ts, v in expected.items() if v == v}
        assert set(stored) == set(want)
        for day, value in want.items():
            assert stored[day] == pytest.approx(value, abs=1e-12), day
        assert payload["marks_since"] == cal.day(6)

        # The terminal moved to the last mark, on the last stored row, and nothing is left unnamed.
        terminal = read_realized_terminal(payload)
        assert terminal == (cal.day(4), pytest.approx(199_000.0))
        assert max(stored) == terminal[0] == payload["priced_through"]
        assert "native_unit" not in payload and payload["unit_segments"]["version"] == 1

        composed = compose_allocator_equity(
            {"K": pd.Series(stored)},
            {"K": [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in payload["flows"]]},
            {"K": payload["anchor_usd"]},
            realized_terminal_by_key={"K": terminal},
            dropped_day_pnl_by_key={"K": {r["utc_day_iso"]: r["pnl_usd"] for r in payload["dropped_day_pnl"]}},
        )
        assert "key_inputs_mismatch" not in composed["degrade_reasons"], composed["degrade_reasons"]
        curve = {row["date"]: row["equity_usd"] for row in composed["curve"]}
        assert curve[cal.day(4)] == pytest.approx(199_000.0)


class TestUsdDayPnlOfTheWholeKey:
    async def test_usd_day_pnl_for_coin_days_is_priced_at_each_days_own_close(self) -> None:
        """T-256-26. The USD day P&L on a coin day is the native coin P&L times THAT day's close,
        the USD segment keeps its own USD P&L plus funding. Expected values are hand-priced from the
        literals (a BTC fee of 0.0009 on day -8, 3.0 USD of funding on day -10 and 2.0 on day -17),
        never read back from the code under test."""
        cal = Calendar.now()
        funding = [
            {"timestamp": f"{cal.day(10)}T08:00:00+00:00", "amount": 3.0},
            {"timestamp": f"{cal.day(17)}T08:00:00+00:00", "amount": 2.0},
        ]
        # The helper prices what a switched KEY derive states, so that derive has to end DONE first.
        # On origin/main it refuses the account, and this fails by that assertion, not by an ImportError.
        run = await run_switched_derive(key_mode=True, cal=cal, funding=funding)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        from services.job_worker import _switched_key_usd

        switch, split, built, closes = _built(cal, funding=funding)
        by_day = _closes_by_day(closes)
        assert len(set(by_day.values())) > 10, "the closes must differ day to day for this to bite"

        key = _switched_key_usd(
            switch=switch,
            switched=built,
            split=split,
            funding_rows=funding,
            external_flows=[],
            closes=closes,
        )
        pnl = {ts.date().isoformat(): float(v) for ts, v in key.day_pnl.items()}

        # Coin days: native P&L x the day's own close. Day -8 carries the BTC fee, day -10 the
        # funding (3.0 USD, expressed in the coin and priced back at the same close).
        assert pnl[cal.day(8)] == pytest.approx(COIN_BILL_NATIVE["d8"] * by_day[cal.day(8)])
        assert pnl[cal.day(10)] == pytest.approx(3.0)
        # Every other coin day carries no P&L: a quiet day is 0.0, never a neighbour's figure.
        for back in (13, 12, 11, 9, 7, 6, 5, 4, 3, 2, 1):
            assert pnl[cal.day(back)] == pytest.approx(0.0, abs=1e-12), back
        # USD days: the stable P&L plus the funding on that day (S's BTC fee is valued at S's close).
        assert pnl[cal.day(18)] == pytest.approx(9.0)
        assert pnl[cal.day(16)] == pytest.approx(3.5)
        assert pnl[cal.day(17)] == pytest.approx(2.0)
        assert pnl[cal.day(14)] == pytest.approx(COIN_BILL_NATIVE["s"] * by_day[cal.day(14)])

    async def test_a_close_missing_on_a_coin_day_leaves_its_pnl_out_and_names_the_day(self) -> None:
        cal = Calendar.now()
        closes = founder_closes(cal)
        closes = closes[closes.index != pd.Timestamp(cal.day(8))]
        run = await run_switched_derive(key_mode=True, cal=cal, closes=closes)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        from services.job_worker import _switched_key_usd

        switch, split, built, closes = _built(cal, closes=closes)
        key = _switched_key_usd(
            switch=switch,
            switched=built,
            split=split,
            funding_rows=[],
            external_flows=[],
            closes=closes,
        )
        # The fee day has no close, so its USD P&L is absent (never priced at a neighbour's close)
        # and it, and the day after it, are named.
        assert pd.Timestamp(cal.day(8)) not in key.day_pnl.index
        assert key.unpriced_days == [cal.day(8), cal.day(7)]
        assert set(built.unpriced_days) <= set(key.unpriced_days)


class TestAMissingCloseWithholdsTheDayByName:
    async def _run_with_missing_close(self) -> tuple[Calendar, SwitchedDeriveCapture, SwitchedSeries, pd.Series]:
        cal = Calendar.now()
        closes = founder_closes(cal)
        closes = closes[closes.index != pd.Timestamp(cal.day(5))]
        run = await run_switched_derive(key_mode=True, cal=cal, closes=closes)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        _switch, _split, built, stored = _built(cal, closes=closes)
        return cal, run, built, stored

    async def test_the_payload_names_the_unpriced_days_and_the_level_before_the_hole(self) -> None:
        cal, run, built, closes = await self._run_with_missing_close()
        payload = _key_payload(run)
        hole = [cal.day(5), cal.day(4)]
        assert payload["unpriced_days"] == hole
        assert set(built.unpriced_days) == set(hole)
        # Neither unpriced day is a stored return: withheld by name, never r = 0 and never priced at
        # a neighbour's close.
        stored = _rows(run)
        assert cal.day(5) not in stored and cal.day(4) not in stored
        assert cal.day(6) in stored and cal.day(3) in stored
        # The USD level on the last priced day before the hole: the coin level carried to that day
        # times that day's own close.
        end = cal.day(6)
        level = float(built.coin_nav_levels[built.coin_nav_levels.index <= pd.Timestamp(end)].iloc[-1])
        assert payload["segment_terminals"] == [
            {"utc_day_iso": end, "level_usd": pytest.approx(level * _closes_by_day(closes)[end])}
        ]

    async def test_the_compose_withholds_the_unpriced_days_by_name_and_books_the_rest_in_usd(
        self,
    ) -> None:
        cal, run, built, closes = await self._run_with_missing_close()
        payload = _key_payload(run)
        native = read_native_key_inputs(payload)
        assert native is not None, "a key carrying unpriced_days must be read by the compose"

        series = pd.Series(_rows(run))
        terminal = read_realized_terminal(payload)
        assert terminal is not None
        composed = compose_allocator_equity(
            {"K": series},
            {"K": []},
            {"K": payload["anchor_usd"]},
            realized_terminal_by_key={"K": terminal},
            unpriced_days_by_key={"K": native.unpriced_days},
            segment_terminals_by_key={"K": dict(native.segment_terminals)},
        )

        # Named, never silent: the key is listed with the days it was left out of.
        assert composed["unpriced_native_keys"] == [
            {"api_key_id": "K", "day": None, "hole_days": [cal.day(5), cal.day(4)]}
        ]
        curve = {row["date"]: row["equity_usd"] for row in composed["curve"]}
        assert cal.day(5) not in curve and cal.day(4) not in curve
        # On priced days the book level is the USD level: the terminal day holds the live equity, and
        # the day before a return is the level divided by (1 + that day's stored return).
        last_day = cal.day(1)
        assert curve[last_day] == pytest.approx(EQUITY_USD)
        rows = _rows(run)
        assert curve[cal.day(2)] == pytest.approx(curve[last_day] / (1.0 + rows[last_day]))
        # The level before the hole is the stored segment terminal, not a mis-rolled history.
        assert curve[cal.day(6)] == pytest.approx(payload["segment_terminals"][0]["level_usd"])
        # And what the reader hands the compose is the payload's own list.
        assert native.unpriced_days == (cal.day(5), cal.day(4))

    async def test_the_reader_is_unchanged_for_a_usd_key_and_a_native_unit_key(self) -> None:
        assert read_native_key_inputs({"anchor_usd": 1.0, "flows": []}) is None
        native = read_native_key_inputs(
            {"native_unit": "BTC", "priced_through": "2026-06-10", "unpriced_days": []}
        )
        assert native is not None and native.priced_through == "2026-06-10"
        with pytest.raises(TypeError):
            read_native_key_inputs({"native_unit": 5})
