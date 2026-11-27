"""Phase 256 OKXUNITSWITCH plan 06 (SC-1, SC-2, SC-3, SC-5, SC-7): the strategy-mode derive of an OKX
account that moved from USDT into BTC ends DONE with the whole-history USD headline, the
``unit_switch`` marker and the two-unit record.

Every test drives the REAL ``run_derive_broker_dailies_job`` through
``tests/fixtures/okx_unit_switch_derive_harness.py`` (real bills read, real switch rule, real
series builder, real marks block, real prestamp). Dates are computed from today (the derive reads
the wall clock, and a fixed 2026 date would age out of the venue's bills reach); every amount is a
round synthetic literal (T-256-02).

Pre-fix, on the BASE ``job_worker.py`` the same harness ends FAILED with ``daily_pnl_non_usd_okx``
(the RED arm; the run is pasted in the SUMMARY).

PROOF-01 (recorded in the SUMMARY; backups restored with ``cp``, ``cmp`` silent):

- A (switched branch) the combine site falls through to ``combine_realized_and_funding``:
  the tracer and the headline-equality arm go RED by assertion.
- B (runner carry) drop the ``unit_switch`` carry in ``analytics_runner.py``:
  ``tests/test_csv_analytics_runner.py::TestUnitSwitchCarry``.
- C (explicit null) write ``unit_segments`` only when switched:
  ``test_an_unswitched_strategy_writes_unit_segments_null_explicitly``.
"""
from __future__ import annotations

import hashlib
import json

import time
from typing import Any
from datetime import datetime, time as dtime, timezone

import pandas as pd
import pytest

from services.broker_dailies import combine_realized_and_funding
from services.job_worker import DispatchOutcome, _unit_segment_points
from services.nav_marks import StoredMark
from services.nav_marks_apply import AppliedMark, apply_marks
from services.nav_twr import DUST_NAV_FLOOR
from services.unit_switch import SplitPnl, UnitSwitch, split_daily_pnl_at_switch
from services.unit_switch_series import SwitchedSeries, build_switched_series
from tests.fixtures.okx_unit_switch_derive_harness import (
    EQUITY_USD,
    Calendar,
    FakeOkx,
    SwitchedDeriveCapture,
    bill,
    founder_balance_details,
    founder_bills,
    founder_closes,
    founder_holdings_rows,
    run_switched_derive,
)

REFUSAL_FLAG = "daily_pnl_non_usd_okx"


def _iso(series: pd.Series) -> dict[str, float]:
    return {ts.date().isoformat(): float(v) for ts, v in series.items()}


def _expected_headline(cal: Calendar, *, funding_rows: list[dict[str, object]] | None = None) -> SwitchedSeries:
    """The pure builder's answer for the default founder-shaped account: USDT P&L on days -18 and
    -16, BTC fees on S (day -14) and day -8, the default closes and the default live anchor. The
    expected values come from the builder, never from the derive."""
    switch = UnitSwitch("BTC", cal.day(14), cal.day(13))
    closes = founder_closes(cal)
    by_day = {ts.date().isoformat(): float(v) for ts, v in closes.items()}
    split = split_daily_pnl_at_switch(
        {cal.day(18): 9.0, cal.day(16): 3.5},
        {cal.day(14): -0.0012, cal.day(8): -0.0009},
        switch,
        by_day,
    )
    assert isinstance(split, SplitPnl)
    built = build_switched_series(
        switch=switch,
        split=split,
        funding_rows=funding_rows or [],
        external_flows=[],
        anchor_usd=EQUITY_USD,
        anchor_price=float(closes.iloc[-1]),
        open_unrealized_usd=0.0,
        closes=closes,
        latest_close_day=cal.day(1),
        usd_full_history=True,
    )
    assert isinstance(built, SwitchedSeries)
    return built


def _stored_rows(run: SwitchedDeriveCapture) -> dict[str, float]:
    return {r["date"]: r["daily_return"] for r in run.csv_rows}


def _assert_rows_equal(stored: dict[str, float], expected_series: pd.Series) -> None:
    expected = {d: v for d, v in _iso(expected_series).items() if v == v}
    assert set(stored) == set(expected)
    for day, value in expected.items():
        assert stored[day] == pytest.approx(value, abs=1e-12), day


class TestTracerFounderShapedStrategyDerive:
    async def test_tracer_ends_done_with_the_whole_history_usd_headline_and_the_two_unit_record(
        self,
    ) -> None:
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal)

        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result

        s_day, first_coin_day = cal.day(14), cal.day(13)
        flags = run.prestamp["data_quality_flags"]
        assert "unit_switch" in flags, f"the prestamp carries no unit_switch marker: {sorted(flags)}"
        assert flags["unit_switch"] == {
            "coin": "BTC",
            "last_usd_day": s_day,
            "first_coin_return_day": first_coin_day,
        }
        assert "native_unit" not in flags
        assert REFUSAL_FLAG not in flags

        segments = run.prestamp["unit_segments"]
        assert segments["version"] == 1
        usd_seg, coin_seg = segments["segments"]
        assert usd_seg["unit"] == "USD" and usd_seg["to_day"] == s_day
        assert coin_seg["unit"] == "BTC"
        assert coin_seg["base_day"] == s_day and coin_seg["from_day"] == first_coin_day
        # The headline is USD through S and the converted coin segment after it: the csv rows
        # cover both, and the USD segment's points are the same figures the rows carry.
        rows = _stored_rows(run)
        assert any(day > s_day for day in rows), "the coin segment must reach the headline"
        for point in usd_seg["returns"]:
            assert rows[point["date"]] == pytest.approx(point["value"], abs=1e-12)
        # The coin segment is NATIVE: it starts the day after S and is not the headline's figures.
        assert [p["date"] for p in coin_seg["returns"]][0] == first_coin_day
        assert all(p["date"] > s_day for p in coin_seg["returns"])
        # The resolver was handed to the real read, awaited once, and the holdings were read paged.
        assert run.resolver_awaits == 1 and run.closes_reads == 1

    async def test_the_csv_rows_equal_the_builders_headline_for_the_same_inputs(self) -> None:
        """The derive adds nothing and drops nothing: the stored headline IS the series the pure
        builder returns for these bills, the holdings-derived switch, the closes and the live
        anchor. RED when the derive falls through to the USD-only combine."""
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        _assert_rows_equal(_stored_rows(run), _expected_headline(cal).headline)

    async def test_no_stored_holdings_refuses_by_name_even_with_a_live_btc_majority(self) -> None:
        """SF-01: with no holdings history nothing says when the coin became the majority, so an old
        coin bill must not set S. The live balance only confirms the coin is held now."""
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal, holdings_rows=[])
        _assert_refused(run, "holdings_unavailable", kind="permanent")

    async def test_without_a_live_btc_majority_and_no_holdings_the_switch_refuses_by_name(
        self,
    ) -> None:
        run = await run_switched_derive(
            holdings_rows=[],
            balance_details=[{"ccy": "BTC", "eqUsd": "100"}, {"ccy": "USDT", "eqUsd": "199900"}],
        )
        _assert_refused(run, "coin_bills_without_majority", kind="permanent")


def _assert_refused(run: SwitchedDeriveCapture, detail: str, *, kind: str) -> None:
    result = run.result
    assert result is not None and result.outcome == DispatchOutcome.FAILED, result
    assert result.error_message == (
        f"derive_broker_dailies: realized read incomplete ({REFUSAL_FLAG}; unit switch: {detail})"
    )
    assert result.error_kind == kind
    # Nothing past the read ran: no series, no prestamp, no flag and no unit_segments. The only
    # strategy_analytics write is the existing refusal stamp (failed, or error-only over figures).
    assert run.csv_rows == []
    for stamp in run.rows_for("strategy_analytics"):
        assert "unit_segments" not in stamp
        assert "unit_switch" not in (stamp.get("data_quality_flags") or {})
        assert stamp.get("computation_status") in (None, "failed")


def _mixed_holdings_rows(cal: Calendar) -> list[dict[str, Any]]:
    """USDT only to the end of day -15, 75 % BTC from the end of day -14 (the first buy, the fee bills
    of the founder-shaped bills; the measured shape) to the end of day -9, 99.7 % BTC from the end of
    day -8 on. Rows are stamped one day later (``asof``). The 75 % days are not the switch (the
    ruling needs 95 % and staying)."""
    rows: list[dict[str, Any]] = []

    def put(back: int, btc: float, usdt: float) -> None:
        asof = cal.day(back - 1)
        if btc:
            rows.append({"symbol": "BTC", "value_usd": str(btc), "asof": asof, "holding_type": "spot"})
        rows.append({"symbol": "USDT", "value_usd": str(usdt), "asof": asof, "holding_type": "spot"})

    for back in range(20, 14, -1):
        put(back, 0.0, 100_000.0)
    for back in range(14, 8, -1):
        put(back, 75_000.0, 25_000.0)
    for back in range(8, 0, -1):
        put(back, 99_700.0, 300.0)
    return rows


class TestAMixedAccountIsNotBookedAsCoinFromItsFirstBuy:
    """CR-01, founder ruling 2026-11-27 "Move switch to coin majority". The founder-shaped bills put
    the first BTC fee bills on day -14, but the account is only 75 % BTC until the end of day -9."""

    async def test_s_is_the_persistent_majority_day_and_the_mixed_days_are_usd_days(self) -> None:
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal, holdings_rows=_mixed_holdings_rows(cal))
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        s_day = cal.day(8)
        assert run.prestamp["data_quality_flags"]["unit_switch"] == {
            "coin": "BTC",
            "last_usd_day": s_day,
            "first_coin_return_day": cal.day(7),
        }
        usd_seg, coin_seg = run.prestamp["unit_segments"]["segments"]
        usd_days = {p["date"] for p in usd_seg["returns"]}
        coin_days = {p["date"] for p in coin_seg["returns"]}
        for back in range(13, 8, -1):  # the mixed days, strictly between the first buy and S
            assert cal.day(back) not in coin_days, "a mixed day was booked as coin"
            # R2-02: with no mark covering it the day is withheld by name, never published from
            # bills that omit the held coin's price move.
            assert cal.day(back) not in usd_days
            # R3-06: they have stored closes, so they are NOT "no close" days. They ride their own
            # list, which the masthead words by its own cause.
            assert cal.day(back) in run.prestamp["unit_segments"]["withheld_days"]
            assert cal.day(back) not in run.prestamp["unit_segments"]["unpriced_days"]
        assert min(coin_days) == cal.day(7)
        # The runner's chain boundary is still the oldest day the headline lacks, of either list.
        assert run.prestamp["data_quality_flags"]["marks_covered_from"] == cal.day(13)

    async def test_a_mixed_day_with_no_pnl_is_withheld_not_read_as_zero(self) -> None:
        """Day -12 has no bill and BTC closes rise 0.4 % a day, while 75 % of the account is BTC. A
        0 % return would be a figure the account never had (R2-02), so with no mark the day is
        absent from the stored rows."""
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal, holdings_rows=_mixed_holdings_rows(cal))
        rows = _stored_rows(run)
        assert cal.day(12) not in rows

    async def test_marks_before_the_coin_give_the_early_days_their_true_return(self) -> None:
        """R2-02, at the derive. The true USD level at the end of day -15 (before any coin) is
        100,000 and the stable P&L is 9 on day -18 and 3.5 on day -16, so by the NAV identity
        L(d - 1) = L(d) - P_d: r(-16) = 3.5 / (100000 - 3.5) and r(-18) = 9 / (100000 - 3.5 - 9),
        restated here from those literals.
        Rolled back from the live equity at S over the booked P&L alone (the pre-fix anchor) the
        same days read about half those figures."""
        cal = Calendar.now()
        marks = [
            StoredMark(
                mark_day=cal.day(back),
                marked_at=f"{cal.day(back - 1)}T12:00:00+00:00",
                venue="okx",
                nav_usd=100_000.0 + 10.0 * (15 - back),
                open_pnl_usd=0.0,
                nav_native=None,
                native_unit=None,
            )
            for back in range(15, 7, -1)
        ]
        run = await run_switched_derive(
            cal=cal, holdings_rows=_mixed_holdings_rows(cal), marks=marks
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        rows = _stored_rows(run)
        assert rows[cal.day(16)] == pytest.approx(3.5 / (100_000.0 - 3.5), rel=1e-9)
        assert rows[cal.day(18)] == pytest.approx(9.0 / (100_000.0 - 3.5 - 9.0), rel=1e-9)
        # The marks cover the mixed days, so none of them is named as withheld.
        assert run.prestamp["unit_segments"]["unpriced_days"] == []
        assert run.prestamp["unit_segments"]["withheld_days"] == []


class TestADayWithNoCloseIsWithheldByNameAndTheAccountIsKept:
    """WR-02 and SF-03 at the derive. The default account's S is day -14; day -10 gets no stored BTC
    close and carries a stable (USDT) bill."""

    @staticmethod
    def _closes_without_day_10(cal: Calendar) -> pd.Series:
        return founder_closes(cal).drop(pd.Timestamp(cal.day(10)))

    async def test_a_stable_amount_on_an_unpriced_day_no_longer_refuses_the_account(self) -> None:
        cal = Calendar.now()
        bills = [*founder_bills(cal), bill(9, cal, 10, "USDT", "5", "-1")]
        run = await run_switched_derive(
            cal=cal, bills=bills, closes=self._closes_without_day_10(cal)
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        rows = _stored_rows(run)
        assert cal.day(10) not in rows, "the unpriced day was given a figure"
        assert run.prestamp["unit_segments"]["unpriced_days"] == [cal.day(10)]

    async def test_the_next_priced_day_carries_the_hole_and_the_chain_is_stamped_unbroken(self) -> None:
        """The day after the hole holds the compounded native returns of both days times
        close(d) / close(d - 2), restated from the stored sidecar's native returns and the closes."""
        cal = Calendar.now()
        closes = self._closes_without_day_10(cal)
        run = await run_switched_derive(cal=cal, closes=closes)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        rows = _stored_rows(run)
        native = {p["date"]: p["value"] for p in run.prestamp["unit_segments"]["segments"][1]["returns"]}
        by_day = {ts.date().isoformat(): float(v) for ts, v in closes.items()}
        expected = (
            (1.0 + native[cal.day(10)]) * (1.0 + native[cal.day(9)]) * by_day[cal.day(9)] / by_day[cal.day(11)]
            - 1.0
        )
        assert cal.day(10) not in rows
        assert rows[cal.day(9)] == pytest.approx(expected, abs=1e-12)
        # The runner's dense reindex stops at the first covered day instead of NaN-ing the hole.
        assert run.prestamp["data_quality_flags"]["marks_covered_from"] == cal.day(10)
        assert run.prestamp["unit_segments"]["unpriced_days"] == [cal.day(10)]

    async def test_marks_that_cover_the_day_take_it_out_of_the_disclosure(self) -> None:
        """The disclosure names only days the final headline lacks. Pre-fix it named day -10 although
        the marked series carries a figure for it (``unpriced_days`` was taken before the marks)."""
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
            for back, nav in ((12, 200_000.0), (11, 201_000.0), (10, 199_000.0), (9, 200_500.0), (8, 201_500.0))
        ]
        run = await run_switched_derive(
            cal=cal, closes=self._closes_without_day_10(cal), marks=marks
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        assert cal.day(10) in _stored_rows(run), "the marks give day -10 a figure"
        assert run.prestamp["unit_segments"]["unpriced_days"] == []


def _aged_bills(cal: Calendar) -> list[dict[str, str]]:
    """The founder-shaped bills plus two USDT days inside a 5-day bills window (days -3 and -2)."""
    return [
        *founder_bills(cal),
        bill(20, cal, 3, "USDT", "5", "-1"),
        bill(21, cal, 2, "USDT", "4", "-0.5"),
    ]


class TestASwitchPersistsAfterItsCoinBillsAgeOutOfTheBillsWindow:
    """CR-02. The derive reads the bills of a fixed window (``OKX_BILLS_REACH_DAYS``); the switch it
    stored on an earlier night must not depend on the coin bills still being inside it. The window
    is cut to 5 days here, so every coin bill of the founder-shaped account (days -14 and -8) is
    outside it."""

    async def test_the_marker_and_both_segments_survive_and_no_old_row_is_rewritten(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import services.exchange as ex

        cal = Calendar.now()
        first = await run_switched_derive(cal=cal)
        assert first.result is not None and first.result.outcome == DispatchOutcome.DONE
        stored = first.prestamp["unit_segments"]

        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        run = await run_switched_derive(
            cal=cal, bills=_aged_bills(cal), stored_analytics_row={"unit_segments": stored}
        )

        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        # Pre-fix: the census was empty, so the derive read plain USD and cleared marker and sidecar.
        assert run.prestamp["data_quality_flags"]["unit_switch"] == {
            "coin": "BTC",
            "last_usd_day": cal.day(14),
            "first_coin_return_day": cal.day(13),
        }
        usd_seg, coin_seg = run.prestamp["unit_segments"]["segments"]
        # The chart's USD segment still covers the whole stored history, not only the window.
        assert usd_seg["returns"] == stored["segments"][0]["returns"]
        window_start = cal.day(5)
        old_coin = [p for p in stored["segments"][1]["returns"] if p["date"] < window_start]
        assert old_coin, "the fixture needs coin days older than the window"
        assert coin_seg["returns"][: len(old_coin)] == old_coin
        assert all(p["date"] >= window_start for p in coin_seg["returns"][len(old_coin) :])
        # Nothing older than the window is rebuilt (zero-return rows would overwrite the stored ones).
        assert min(_stored_rows(run)) >= window_start

    async def test_a_first_derive_seeds_the_usd_segment_from_the_stored_rows_and_names_the_coin_gap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """R2-03 and SF2-03. No record is stored yet, the bills window (5 days) starts long after S
        (day -14), and the only coin bill in it is on day -3 (so the census finds the coin). The
        USD segment must still start at the oldest stored row (the KPIs cover those days), and the
        coin days from S+1 to the window (days -13 to -6) that no point covers are named, because
        the segment is declared from S+1."""
        import services.exchange as ex

        cal = Calendar.now()
        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        stored_rows = [
            {"date": cal.day(back), "daily_return": 0.001 * (31 - back)} for back in range(30, 13, -1)
        ]
        bills = [bill(30, cal, 3, "BTC", "0", "-0.0006"), bill(31, cal, 2, "USDT", "4", "-0.5")]
        run = await run_switched_derive(cal=cal, bills=bills, stored_csv_rows=stored_rows)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        record = run.prestamp["unit_segments"]
        usd_seg, coin_seg = record["segments"]
        assert usd_seg["returns"] == [
            {"date": r["date"], "value": r["daily_return"]} for r in stored_rows
        ]
        assert usd_seg["from_day"] == cal.day(30)
        assert coin_seg["from_day"] == cal.day(13)
        first_point = coin_seg["returns"][0]["date"]
        assert first_point > cal.day(13)
        gap = [cal.day(back) for back in range(13, 0, -1) if cal.day(back) < first_point]
        assert gap and gap[0] == cal.day(13)
        assert [d for d in record["withheld_days"] if d < first_point] == gap
        # R3-06: the gap days have no point, but they are not "no close" days.
        assert not set(gap) & set(record["unpriced_days"])

    async def test_the_chain_boundary_is_the_earliest_named_day_not_this_derives_first_hole(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """R2-04. Day -10 has no close and was named by an earlier derive; it is now older than the
        5-day bills window. This derive adds a fresh hole on day -2 (a stable bill, no close). The
        runner's dense reindex must stop at the OLDEST named day: stamped at the fresh hole, day -10
        would sit before the boundary and become an interior NaN that segments the headline."""
        import services.exchange as ex

        cal = Calendar.now()
        no_day_10 = founder_closes(cal).drop(pd.Timestamp(cal.day(10)))
        first = await run_switched_derive(cal=cal, closes=no_day_10)
        stored = first.prestamp["unit_segments"]
        assert stored["unpriced_days"] == [cal.day(10)]

        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        run = await run_switched_derive(
            cal=cal,
            bills=_aged_bills(cal),
            closes=no_day_10.drop(pd.Timestamp(cal.day(2))),
            stored_analytics_row={"unit_segments": stored},
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        assert run.prestamp["unit_segments"]["unpriced_days"] == [cal.day(10), cal.day(2)]
        assert run.prestamp["data_quality_flags"]["marks_covered_from"] == cal.day(10)

    async def test_withheld_days_older_than_the_bills_window_are_carried_from_the_record(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """R3-06. The withheld mixed days sit before S, and a later derive's bills window no longer
        reaches them. The record carries them, as it carries the older unpriced days, so the
        disclosure does not forget days the stored headline still lacks."""
        import services.exchange as ex

        cal = Calendar.now()
        rows = _mixed_holdings_rows(cal)
        first = await run_switched_derive(cal=cal, holdings_rows=rows)
        stored = first.prestamp["unit_segments"]
        withheld = stored["withheld_days"]
        assert withheld and withheld[0] == cal.day(13)

        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        run = await run_switched_derive(
            cal=cal,
            bills=_aged_bills(cal),
            holdings_rows=rows,
            stored_analytics_row={"unit_segments": stored},
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        assert run.prestamp["unit_segments"]["withheld_days"] == withheld
        assert run.prestamp["data_quality_flags"]["marks_covered_from"] == cal.day(13)

    async def test_the_stored_switch_still_refuses_when_the_holdings_show_a_switch_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import services.exchange as ex

        cal = Calendar.now()
        first = await run_switched_derive(cal=cal)
        stored = first.prestamp["unit_segments"]
        rows = [
            r
            for r in founder_holdings_rows(cal)
            if not (r["symbol"] == "BTC" and r["asof"] >= cal.day(7))
        ]
        rows += [
            {"symbol": "USDT", "value_usd": "100000", "asof": cal.day(b), "holding_type": "spot"}
            for b in range(5, 0, -1)
        ]
        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        published = {
            "computation_status": "complete",
            "metrics_json": {"a": 1},
            "metrics_json_by_basis": None,
            "unit_segments": stored,
        }
        run = await run_switched_derive(
            cal=cal, bills=_aged_bills(cal), holdings_rows=rows, stored_analytics_row=published
        )
        _assert_refused(run, "switch_back", kind="permanent")

    async def test_key_mode_reads_its_stored_key_inputs_the_same_way(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import services.exchange as ex

        cal = Calendar.now()
        first = await run_switched_derive(key_mode=True, cal=cal)
        (stored_row,) = [
            payload
            for name, payload, _c in first.upserts
            if name == "allocator_equity_derived" and str(payload["kind"]).startswith("key_inputs:")
        ]
        stored_inputs = stored_row["payload"]
        monkeypatch.setattr(ex, "OKX_BILLS_REACH_DAYS", 5)
        run = await run_switched_derive(
            key_mode=True, cal=cal, bills=_aged_bills(cal), stored_key_inputs=stored_inputs
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        (row,) = [
            payload
            for name, payload, _c in run.upserts
            if name == "allocator_equity_derived" and str(payload["kind"]).startswith("key_inputs:")
        ]
        segments = row["payload"]["unit_segments"]["segments"]
        assert segments[0]["to_day"] == cal.day(14)
        assert segments[0]["returns"] == stored_inputs["unit_segments"]["segments"][0]["returns"]
        assert min(_stored_rows(run)) >= cal.day(5)


class TestAStoredRecordBelongsToTheKeyItWasDerivedFrom:
    """R2-05 and SF2-01. The record is read by strategy, but a strategy can be re-pointed to another
    key, and a record that exists but cannot be read must not be overwritten as if it were absent."""

    async def test_a_record_of_another_key_is_ignored_and_the_account_is_derived_from_scratch(
        self,
    ) -> None:
        """The strategy was re-pointed to a USDT account. Pre-fix the old key's S was confirmed
        against the new key's holdings, which refused ``switch_back`` on every night with no way
        out. The record names its key (``api_key_id``), so a record of another key is no evidence:
        the derive reads plain USD, refuses nothing and writes no switch."""
        cal = Calendar.now()
        first = await run_switched_derive(cal=cal)
        stored = first.prestamp["unit_segments"]
        stored["key_binding"] = hashlib.sha256(b"key-other").hexdigest()
        usdt_only = [
            {"symbol": "USDT", "value_usd": "100000", "asof": cal.day(back), "holding_type": "spot"}
            for back in range(20, 0, -1)
        ]
        run = await run_switched_derive(
            cal=cal,
            bills=[bill(1, cal, 18, "USDT", "10", "-1"), bill(2, cal, 16, "USDT", "4", "-0.5")],
            holdings_rows=usdt_only,
            balance_details=[{"ccy": "USDT", "eq": "200000", "eqUsd": "200000"}],
            stored_analytics_row={"unit_segments": stored},
        )
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        assert "unit_switch" not in run.prestamp["data_quality_flags"]
        assert run.prestamp["unit_segments"] is None

    async def test_a_malformed_record_refuses_permanent_by_name_and_nothing_is_overwritten(
        self,
    ) -> None:
        """SF3-02: a record that does not read does not read the next night either, so the refusal
        is permanent. A transient kind would retry a read that can never succeed."""
        cal = Calendar.now()
        run = await run_switched_derive(
            cal=cal, stored_analytics_row={"unit_segments": {"version": 7, "segments": "x"}}
        )
        _assert_refused(run, "stored_segments_malformed", kind="permanent")

    @pytest.mark.parametrize("key_mode", [False, True])
    async def test_the_stored_record_never_carries_the_raw_key_id(self, key_mode: bool) -> None:
        """R3-01: ``strategy_analytics`` is anon-readable for a published strategy, and a key id is
        the handle that targets an exchange key (Phase 170.6.1.1 ANONKEYID). The record binds to its
        key by a one-way digest, never by the id, so no visitor can read the handle off the column."""
        run = await run_switched_derive(key_mode=key_mode)
        if key_mode:
            (row,) = [
                payload
                for name, payload, _c in run.upserts
                if name == "allocator_equity_derived"
                and str(payload["kind"]).startswith("key_inputs:")
            ]
            stored = row["payload"]["unit_segments"]
        else:
            stored = run.prestamp["unit_segments"]
        assert "key-sw" not in json.dumps(stored)
        assert "api_key_id" not in stored
        assert stored["key_binding"] == hashlib.sha256(b"key-sw").hexdigest()


class TestRefusalsKeepTodaysNamedFailure:
    async def test_a_switch_back_refuses_permanently_and_keeps_the_figures(self) -> None:
        cal = Calendar.now()
        rows = [
            r
            for r in founder_holdings_rows(cal)
            # From asof day -7 on (seven end-of-days) the account holds USDT only again: the coin was left.
            if not (r["symbol"] == "BTC" and r["asof"] >= cal.day(7))
        ]
        rows += [
            {"symbol": "USDT", "value_usd": "100000", "asof": cal.day(b), "holding_type": "spot"}
            for b in range(5, 0, -1)
        ]
        published = {
            "computation_status": "complete",
            "metrics_json": {"a": 1},
            "metrics_json_by_basis": None,
        }
        run = await run_switched_derive(cal=cal, holdings_rows=rows, stored_analytics_row=published)
        _assert_refused(run, "switch_back", kind="permanent")
        # The existing read_refusal_kept_figures path runs over a row that holds published figures:
        # the job is marked so the figures stay, and nothing is deleted.
        assert run.rpc_calls == [("mark_compute_job_kept_figures", {"p_job_id": "j-sw"})]
        assert [d for d in run.deletes if d["table"] == "csv_daily_returns"] == []

    async def test_holdings_rows_that_mostly_do_not_parse_refuse_by_name_not_shrink_the_history(
        self,
    ) -> None:
        """SF-05: a skipped holdings row (bad value) used to drop silently, so the shares were
        computed from whatever parsed. When most of the spot rows are unusable the history is not
        trusted: the derive refuses by the closed token ``holdings_unavailable``."""
        cal = Calendar.now()
        rows = founder_holdings_rows(cal)
        for index, row in enumerate(rows):
            if row["symbol"] == "BTC" or index < 6:
                row["value_usd"] = "not-a-number"
        run = await run_switched_derive(cal=cal, holdings_rows=rows)
        _assert_refused(run, "holdings_unavailable", kind="permanent")

    async def test_a_holdings_read_error_refuses_transient(self) -> None:
        run = await run_switched_derive(holdings_rows=RuntimeError("db down"))
        _assert_refused(run, "holdings_read_failed", kind="transient")

    async def test_a_stored_marks_read_error_refuses_transient_by_name(self) -> None:
        """SF3-03: the marks read failed (a DB error or the page cap). It used to escape unnamed to
        the generic classifier; it now refuses under its own closed token, like the holdings read."""
        run = await run_switched_derive(marks=RuntimeError("db down at db.internal:5432"))
        _assert_refused(run, "marks_read_failed", kind="transient")
        assert "db.internal" not in (run.result.error_message or "")  # type: ignore[union-attr]

    async def test_a_stored_returns_read_error_refuses_transient_by_name(self) -> None:
        run = await run_switched_derive(stored_csv_rows=RuntimeError("db down"))
        _assert_refused(run, "stored_returns_read_failed", kind="transient")

    async def test_an_unparseable_stored_return_refuses_transient_by_name(self) -> None:
        run = await run_switched_derive(
            stored_csv_rows=[{"date": "2026-01-01", "daily_return": "not-a-number"}]
        )
        _assert_refused(run, "stored_returns_read_failed", kind="transient")

    async def test_no_close_for_the_latest_completed_day_refuses_transient(self) -> None:
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal, closes=founder_closes(cal).iloc[:-1])
        _assert_refused(run, "switch_anchor_unpriced", kind="transient")

    async def test_no_close_for_the_switch_day_refuses_permanent(self) -> None:
        cal = Calendar.now()
        closes = founder_closes(cal).drop(pd.Timestamp(cal.day(14)))
        run = await run_switched_derive(cal=cal, closes=closes)
        _assert_refused(run, "switch_day_unpriced", kind="permanent")

    async def test_an_unreadable_closes_store_refuses_transient(self) -> None:
        run = await run_switched_derive(closes=RuntimeError("benchmark store down"))
        _assert_refused(run, "closes_read_failed", kind="transient")

    async def test_no_stored_close_at_all_refuses_transient_never_a_guess(self) -> None:
        run = await run_switched_derive(closes=None)
        _assert_refused(run, "switch_anchor_unpriced", kind="transient")

    async def test_an_unusable_live_equity_refuses_transient(self) -> None:
        run = await run_switched_derive(total_eq="0")
        _assert_refused(run, "switch_anchor_unpriced", kind="transient")

    async def test_the_message_carries_a_closed_token_and_never_the_error_text(self) -> None:
        run = await run_switched_derive(holdings_rows=RuntimeError("secret host db.internal:5432"))
        assert run.result is not None
        message = run.result.error_message or ""
        assert "db.internal" not in message and "RuntimeError" not in message

    async def test_key_mode_hands_the_read_the_resolver_since_plan_09(self) -> None:
        """Plan 06 pinned key mode as refusing exactly as before "until plan 09". Plan 09 opens it:
        the same account now ends DONE, the resolver is passed (the one keyword, one call site) and
        awaited once, and the holdings are read. The key-mode series itself is pinned in
        ``tests/test_okx_unit_switch_key_mode.py``."""
        from services.exchange import DAILY_PNL_READ_DEADLINE_S

        run = await run_switched_derive(key_mode=True)
        result = run.result
        assert result is not None and result.outcome == DispatchOutcome.DONE, result
        (kwargs,) = run.fetch_kwargs
        assert callable(kwargs.pop("unit_switch"))
        assert kwargs == {"since_ms": None, "read_deadline_s": DAILY_PNL_READ_DEADLINE_S}
        assert run.resolver_awaits == 1 and run.holdings_reads >= 1


class TestAnUnswitchedStrategyIsUntouched:
    async def test_an_unswitched_strategy_writes_unit_segments_null_explicitly(self) -> None:
        """T-256-19: a re-derive that finds no switch must erase a sidecar an earlier derive wrote,
        so the prestamp carries an explicit null, never an absent key."""
        cal = Calendar.now()
        bills = [b for b in founder_bills(cal) if b["ccy"] == "USDT"]
        run = await run_switched_derive(cal=cal, bills=bills)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        stamp = run.prestamp
        assert "unit_segments" in stamp and stamp["unit_segments"] is None
        assert "unit_switch" not in stamp["data_quality_flags"]
        # The resolver is passed (strategy-mode OKX) but never awaited, and no holdings are read.
        assert run.resolver_awaits == 0 and run.holdings_reads == 0 and run.closes_reads == 0

    async def test_its_rows_are_the_plain_usd_combine(self) -> None:
        """No switch, no change: the rows equal ``combine_realized_and_funding`` on the same read."""
        import services.exchange as ex

        cal = Calendar.now()
        bills = [b for b in founder_bills(cal) if b["ccy"] == "USDT"]
        records = await ex.fetch_daily_pnl(FakeOkx(bills, founder_balance_details()), None)
        expected, _meta = combine_realized_and_funding(
            records,
            [],
            account_balance=EQUITY_USD,
            balance_error=False,
            external_flows=[],
            open_unrealized_usd=0.0,
            full_history=True,
        )
        run = await run_switched_derive(cal=cal, bills=bills)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        _assert_rows_equal(_stored_rows(run), expected)


class TestASwitchedDoneDerive:
    async def test_it_writes_no_refusal_marker_so_the_kept_figures_state_ends_with_the_job(self) -> None:
        """RESEARCH Pitfall 7: ``read_refusal_kept_figures`` lives on a FAILED job's own metadata,
        so the 3 strategies clear it by the next job ending done. A done derive therefore marks no
        job and stamps no failure; it only writes the series and the prestamp."""
        run = await run_switched_derive()
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE
        assert [c for c in run.rpc_calls if c[0] == "mark_compute_job_kept_figures"] == []
        assert run.updates == []
        stamps = [p for p in run.rows_for("strategy_analytics")]
        assert all("computation_error" not in p for p in stamps)

    async def test_stored_usd_marks_on_coin_days_are_applied_once_to_the_headline(self) -> None:
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
        run = await run_switched_derive(cal=cal, marks=marks)
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        applied = apply_marks(
            _expected_headline(cal).headline,
            {},
            [
                AppliedMark(m.mark_day, m.nav_usd, m.open_pnl_usd, datetime.fromisoformat(m.marked_at))
                for m in marks
            ],
            dust_floor=DUST_NAV_FLOOR,
        )
        _assert_rows_equal(_stored_rows(run), applied.returns)
        # The marks really changed the headline (the arm is not vacuous).
        assert _stored_rows(run) != {
            d: v for d, v in _iso(_expected_headline(cal).headline).items() if v == v
        }
        assert run.prestamp["data_quality_flags"]["marks_since"] == cal.day(6)


class TestTheCoinAnchorIsPricedAtTheLivePrice:
    """WR-01 at the derive: the coin anchor uses the price of the SAME balance response."""

    @staticmethod
    def _details(price: float) -> list[dict[str, str]]:
        # Two coins held and nothing else: the equity is the held amount times the live price.
        return [{"ccy": "BTC", "eq": "2", "eqUsd": str(2 * price)}]

    async def test_stored_rows_before_the_switch_do_not_move_with_the_price_the_derive_ran_at(
        self,
    ) -> None:
        cal = Calendar.now()
        low = await run_switched_derive(
            cal=cal, balance_details=self._details(100_000.0), total_eq=str(200_000.0)
        )
        high = await run_switched_derive(
            cal=cal, balance_details=self._details(102_000.0), total_eq=str(204_000.0)
        )
        for run in (low, high):
            assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        a, b = _stored_rows(low), _stored_rows(high)
        assert set(a) == set(b)
        s_day = cal.day(14)
        for day in (d for d in a if d <= s_day):
            assert a[day] == pytest.approx(b[day], abs=1e-12), day

    async def test_a_response_with_no_readable_price_for_the_coin_refuses_transient(self) -> None:
        run = await run_switched_derive(
            balance_details=[{"ccy": "BTC", "eqUsd": "199400"}, {"ccy": "USDT", "eqUsd": "600"}]
        )
        _assert_refused(run, "switch_anchor_unpriced", kind="transient")


class TestRowsDatedAfterTheLatestCompletedDay:
    """Plan 04 hand-off 1: today has no stored close. A P&L or funding row dated today is left to
    the next derive (a nightly derive would otherwise refuse on most days: an OKX funding row lands
    at 00:00Z); a deposit or withdrawal dated today, which is inside the live equity, is taken out of the
    anchor and left to the next derive (SF-02), while an account that switched today refuses
    transient."""

    @staticmethod
    def _today_bill(bill_id: int, cal: Calendar) -> dict[str, str]:
        row = bill(bill_id, cal, 0, "USDT", "5", "-1")
        # Two minutes ago: always today and never in the future, whatever the time of day.
        row["ts"] = str(int(time.time() * 1000) - 120_000)
        return row

    async def test_todays_stable_pnl_is_left_out_and_the_derive_still_ends_done(self) -> None:
        cal = Calendar.now()
        run = await run_switched_derive(cal=cal, bills=[*founder_bills(cal), self._today_bill(9, cal)])
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        _assert_rows_equal(_stored_rows(run), _expected_headline(cal).headline)
        assert max(_stored_rows(run)) <= cal.day(1)

    async def test_todays_funding_is_left_out_and_the_derive_still_ends_done(self) -> None:
        cal = Calendar.now()
        today_funding = {
            "timestamp": datetime.combine(cal.today, dtime(0, 5), tzinfo=timezone.utc),
            "amount": 2.0,
        }
        run = await run_switched_derive(cal=cal, funding=[today_funding])
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        _assert_rows_equal(_stored_rows(run), _expected_headline(cal).headline)

    async def test_a_deposit_dated_today_is_left_to_the_next_derive_and_taken_out_of_the_anchor(
        self,
    ) -> None:
        """SF-02. Pre-fix the derive refused transient by ``flow_after_latest_close`` and, after the
        retries, ended final, freezing the figures for a day. The deposit is inside the live equity,
        so the series ends at the latest completed day on the equity of that day: the rows equal the
        builder's answer for an anchor net of the deposit, and the deposit books no day."""
        cal = Calendar.now()
        deposit = {
            "id": "dep-today",
            "type": "deposit",
            "currency": "USDT",
            "amount": 5000.0,
            "timestamp": datetime.combine(cal.today, dtime(0, 5), tzinfo=timezone.utc).isoformat(),
            "internal": None,
            "info": {},
        }
        run = await run_switched_derive(cal=cal, deposits=[deposit])
        assert run.result is not None and run.result.outcome == DispatchOutcome.DONE, run.result
        switch = UnitSwitch("BTC", cal.day(14), cal.day(13))
        closes = founder_closes(cal)
        split = split_daily_pnl_at_switch(
            {cal.day(18): 9.0, cal.day(16): 3.5},
            {cal.day(14): -0.0012, cal.day(8): -0.0009},
            switch,
            {ts.date().isoformat(): float(v) for ts, v in closes.items()},
        )
        assert isinstance(split, SplitPnl)
        expected = build_switched_series(
            switch=switch,
            split=split,
            funding_rows=[],
            external_flows=[],
            anchor_usd=EQUITY_USD - 5000.0,
            anchor_price=float(closes.iloc[-1]),
            open_unrealized_usd=0.0,
            closes=closes,
            latest_close_day=cal.day(1),
            usd_full_history=True,
        )
        assert isinstance(expected, SwitchedSeries)
        _assert_rows_equal(_stored_rows(run), expected.headline)
        assert max(_stored_rows(run)) <= cal.day(1)

    async def test_an_account_whose_holdings_are_still_stable_refuses_by_name_not_as_a_coin_day(
        self,
    ) -> None:
        cal = Calendar.now()
        today_coin_bill = bill(9, cal, 0, "BTC", "0", "-0.0006")
        today_coin_bill["ts"] = str(int(time.time() * 1000) - 120_000)
        usd_only = [b for b in founder_bills(cal) if b["ccy"] == "USDT"]
        stable_only = [
            {"symbol": "USDT", "value_usd": "100000", "asof": cal.day(b), "holding_type": "spot"}
            for b in range(20, -1, -1)
        ]
        run = await run_switched_derive(
            cal=cal, bills=[*usd_only, today_coin_bill], holdings_rows=stable_only
        )
        # CR-01: S comes only from observed holdings, which end yesterday, so an account that
        # bought its first coin today has no persistent majority yet and can never be S = today.
        _assert_refused(run, "coin_bills_without_majority", kind="permanent")


class TestUnitSegmentPoints:
    def test_a_day_with_no_return_is_left_out_never_written_as_nan_or_zero(self) -> None:
        series = pd.Series(
            [0.01, float("nan"), float("inf"), -0.02],
            index=pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]),
        )
        assert _unit_segment_points(series) == [
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-04", "value": -0.02},
        ]
        assert _unit_segment_points(series, through="2026-01-01") == [
            {"date": "2026-01-01", "value": 0.01}
        ]
