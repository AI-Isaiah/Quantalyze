"""OKXHISTORY (167.1.2.2.2.1) plan 04: the rebuilt days come from the LIVE core.

``services.okx_archive_rebuild`` prepends archive days to the live inputs and calls
``combine_realized_and_funding`` (the same core the derive uses). These tests run the
REAL core, never a mock of it, with hand-written literal inputs and independently
computed expectations (Rule 9: an oracle that calls the module under test proves
nothing).

Neuter proofs recorded in the plan 04 SUMMARY:
  * ``-k gap``  : the covered-days filter (rebuild_union and rows_for_strategy)
  * ``-k live`` : the ``existing_days`` exclusion in rows_for_strategy (D-12)
"""
from __future__ import annotations

import inspect
import math
from decimal import Decimal
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

import services.okx_archive_rebuild as rebuild_mod
from services.broker_dailies import combine_realized_and_funding
from services.external_flows import ExternalFlow
from services.nav_twr import DUST_NAV_FLOOR
from services.okx_archive_rebuild import (
    RebuildRefused,
    RebuildResult,
    days_to_ranges,
    rebuild_union,
    rows_for_strategy,
    subtract_ranges,
)

# --------------------------------------------------------------------------------
# Synthetic inputs (literals; nothing here comes from a real account)
# --------------------------------------------------------------------------------

EQUITY = 10_000.0


def _day_range(first: str, last: str) -> list[str]:
    return [d.date().isoformat() for d in pd.date_range(first, last, freq="D")]


def _record(day: str, pnl: float) -> dict:
    """One ``fetch_daily_pnl``-shaped OKX record."""
    return {
        "exchange": "okx",
        "symbol": "PORTFOLIO",
        "side": "buy" if pnl >= 0 else "sell",
        "price": abs(pnl),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


# Live: 2026-08-02..2026-08-20, a P&L every day (deterministic, varying sign).
LIVE_DAYS = _day_range("2026-08-02", "2026-08-20")
LIVE_PNL = [40.0, -25.0, 60.0, 15.0, -80.0, 33.0, 12.0, -7.0, 90.0, -45.0,
            21.0, 18.0, -12.0, 70.0, -30.0, 5.0, 44.0, -19.0, 27.0]
LIVE_REALIZED = [_record(d, p) for d, p in zip(LIVE_DAYS, LIVE_PNL, strict=True)]
LIVE_FUNDING: list[dict] = []
LIVE_FLOWS: list[ExternalFlow] = []

# Archive: the whole of July plus 2026-08-01, all covered. A bill on most days, a
# quiet day on 07-05 (covered, no bill), a deposit on 07-15 and funding on two days.
Q_DAYS = _day_range("2026-07-01", "2026-08-01")
ARCHIVE_REALIZED = {
    d: Decimal(str(p))
    for d, p in zip(
        [x for x in Q_DAYS if x != "2026-07-05"],
        [35.5, -12.25, 48.0, 9.75, -60.0, 22.5, 14.0, -33.0, 71.25, 5.0, -18.5, 26.0,
         41.0, -9.0, 53.5, 12.0, -27.75, 8.0, 31.0, -15.0, 64.0, 2.5, -40.0, 19.0,
         57.0, -6.5, 23.0, 16.0, -11.0, 38.0, 44.5],
        strict=True,
    )
}
ARCHIVE_FUNDING = {"2026-07-10": Decimal("3.50"), "2026-07-22": Decimal("-1.25")}
ARCHIVE_FLOWS = {"2026-07-15": Decimal("500")}


def _run(**overrides):
    kwargs = dict(
        live_realized=LIVE_REALIZED,
        live_funding=LIVE_FUNDING,
        live_flows=LIVE_FLOWS,
        equity=EQUITY,
        balance_error=False,
        open_unrealized_usd=0.0,
        full_history=False,
        archive_realized_by_day=ARCHIVE_REALIZED,
        archive_funding_by_day=ARCHIVE_FUNDING,
        archive_flows_by_day=ARCHIVE_FLOWS,
        covered_days=set(Q_DAYS),
        from_day="2026-07-01",
        # The live P&L owns its days from the first record (08-02 here, a FULL day), and the
        # live deposit window opens the same day, so the archive transfer on 07-15 is used.
        live_pnl_from_day="2026-08-02",
        live_flows_from_day="2026-08-02",
    )
    kwargs.update(overrides)
    return rebuild_union(**kwargs)


def _live_only() -> pd.Series:
    """The live-only core call, made by the TEST with the derive's keyword shape."""
    returns, _ = combine_realized_and_funding(
        list(LIVE_REALIZED), list(LIVE_FUNDING),
        account_balance=EQUITY, balance_error=False,
        external_flows=list(LIVE_FLOWS), open_unrealized_usd=0.0, full_history=False,
    )
    return returns


class TestIdentity:
    """T-IDENT-1 / D-12: prepending archive days cannot move a live day."""

    def test_live_days_are_identical_and_archive_days_are_finite(self) -> None:
        result = _run()
        live_only = _live_only()
        assert result.live_first_day == "2026-08-02"
        assert result.archive_days_prepended == len(Q_DAYS) == 32

        union = result.returns
        # Every live day after the first: identical to the live-only call (atol 1e-9).
        for ts in live_only.index[1:]:
            assert union.loc[ts] == pytest.approx(live_only.loc[ts], abs=1e-9, rel=0), ts
        # The union genuinely extends before the live span, with finite returns.
        archive_part = union[union.index < pd.Timestamp("2026-08-02")]
        assert list(archive_part.index.strftime("%Y-%m-%d")) == Q_DAYS
        assert np.isfinite(archive_part.to_numpy()).all()
        assert result.first_live_day_differs is False

    def test_union_returns_match_hand_computed_literals(self) -> None:
        """Independent oracle: a 3-day hand roll, no call into the module's own math.

        Anchor 10000 at the end of 08-03. Backward: NAV(08-02)=10000-(-50)=10050,
        NAV(08-01)=10050-100=9950, NAV(07-31)=9950-200=9750. Returns:
        08-01 = 200/9750, 08-02 = 100/9950, 08-03 = -50/10050."""
        result = _run(
            live_realized=[_record("2026-08-02", 100.0), _record("2026-08-03", -50.0)],
            archive_realized_by_day={"2026-08-01": Decimal("200")},
            archive_funding_by_day={},
            archive_flows_by_day={},
            covered_days={"2026-08-01"},
            from_day="2026-08-01",
        )
        got = {d.date().isoformat(): v for d, v in result.returns.items()}
        assert got["2026-08-01"] == pytest.approx(200.0 / 9750.0, abs=1e-12, rel=0)
        assert got["2026-08-02"] == pytest.approx(100.0 / 9950.0, abs=1e-12, rel=0)
        assert got["2026-08-03"] == pytest.approx(-50.0 / 10050.0, abs=1e-12, rel=0)
        assert result.live_first_day == "2026-08-02"

    def test_a_flow_on_an_archive_day_is_not_counted_as_return(self) -> None:
        """The 07-15 deposit sits in the numerator (flow-neutral), never as P&L: the
        return that day is the day's P&L over the prior NAV, not (P&L + 500)/NAV."""
        result = _run()
        got = {d.date().isoformat(): v for d, v in result.returns.items()}
        pnl_0715 = float(ARCHIVE_REALIZED["2026-07-15"])
        # Wide band: a 500 mis-count on a ~10k base would be +0.05, orders larger.
        assert abs(got["2026-07-15"]) < 0.02
        assert abs(got["2026-07-15"] - pnl_0715 / 10_000.0) < 0.01

    def test_union_that_moves_a_live_day_is_an_identity_violation(self) -> None:
        """The second (union) core call shifted by 1e-6 on a live day after the
        first must raise, with the class and nothing else on the message."""
        real = rebuild_mod.combine_realized_and_funding
        calls = {"n": 0}

        def _shifted(*args, **kwargs):
            returns, meta = real(*args, **kwargs)
            calls["n"] += 1
            if calls["n"] == 2:
                returns = returns.copy()
                returns.loc[pd.Timestamp("2026-08-05")] += 1e-6
            return returns, meta

        with patch.object(rebuild_mod, "combine_realized_and_funding", _shifted):
            with pytest.raises(RebuildRefused) as exc:
                _run()
        assert exc.value.stop_class == "identity_violation"
        assert str(exc.value) == "identity_violation"

    def test_a_shift_on_the_first_live_day_is_recorded_not_failed(self) -> None:
        real = rebuild_mod.combine_realized_and_funding
        calls = {"n": 0}

        def _shifted(*args, **kwargs):
            returns, meta = real(*args, **kwargs)
            calls["n"] += 1
            if calls["n"] == 2:
                returns = returns.copy()
                returns.loc[pd.Timestamp("2026-08-02")] += 1e-6
            return returns, meta

        with patch.object(rebuild_mod, "combine_realized_and_funding", _shifted):
            result = _run()
        assert result.first_live_day_differs is True

    @pytest.mark.parametrize(
        "overrides",
        [
            {"balance_error": True},
            {"equity": None},
            {"equity": DUST_NAV_FLOOR},
            {"equity": 0.0},
            {"equity": float("nan")},
        ],
        ids=["balance_error", "equity_none", "dust_equity", "zero_equity", "nan_equity"],
    )
    def test_an_unusable_anchor_is_refused_before_any_core_call(self, overrides) -> None:
        core = MagicMock(side_effect=AssertionError("the core must not be reached"))
        with patch.object(rebuild_mod, "combine_realized_and_funding", core):
            with pytest.raises(RebuildRefused) as exc:
                _run(**overrides)
        assert exc.value.stop_class == "live_anchor_unusable"
        core.assert_not_called()

    def test_equity_just_above_dust_is_not_refused(self) -> None:
        result = _run(equity=DUST_NAV_FLOOR + 0.01)
        assert isinstance(result, RebuildResult)

    def test_the_stop_class_is_closed(self) -> None:
        with pytest.raises(ValueError):
            RebuildRefused("something_else")

    def test_flow_coverage_terminus_is_never_applied(self) -> None:
        """RESEARCH Section 2: archive transfer bills cover flows before the 90-day
        deposit retention, so the live path's coverage terminus must not NaN them."""
        source = inspect.getsource(rebuild_mod)
        code_only = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        assert "apply_flow_coverage_terminus(" not in code_only
        result = _run()
        archive_part = result.returns[result.returns.index < pd.Timestamp("2026-08-02")]
        assert archive_part.notna().all()

    def test_a_bill_on_an_uncovered_day_fails_loud(self) -> None:
        with pytest.raises(ValueError):
            _run(covered_days=set(Q_DAYS) - {"2026-07-20"})

    def test_a_non_finite_amount_fails_loud(self) -> None:
        bad = dict(ARCHIVE_REALIZED)
        bad["2026-07-02"] = Decimal("NaN")
        with pytest.raises(ValueError):
            _run(archive_realized_by_day=bad)

    def test_no_live_days_is_refused(self) -> None:
        with pytest.raises(RebuildRefused) as exc:
            _run(live_realized=[])
        assert exc.value.stop_class == "live_anchor_unusable"


class TestPartialLiveBoundaryDay:
    """CR-01. The live realized fetch reaches back about three months from an arbitrary
    instant, so its FIRST day is partial. The backward roll
    ``nav[t-1] = nav[t] - pnl[t] - flows[t]`` run through a partial day gives every earlier NAV
    (and so every rebuilt return) the error of the P&L that day is missing, and the archive
    holds the whole day. The archive owns every day before the first FULL live day, the
    boundary day included."""

    def test_the_boundary_day_uses_the_archive_full_value_in_the_roll(self) -> None:
        """Independent hand roll. Live: 08-02 is the reach boundary day and carries only a
        PARTIAL +40; 08-03 is the first full day, -50. Archive (whole days): 08-01 +200,
        08-02 +100. Anchor 10000 at the end of 08-03.
          nav_end(08-02) = 10000 - (-50)  = 10050
          nav_end(08-01) = 10050 - 100    =  9950   (the ARCHIVE's 100, not the partial 40)
          nav_end(07-31) =  9950 - 200    =  9750
        Returns: 08-01 = 200/9750, 08-02 = 100/9950, 08-03 = -50/10050.
        Rolling through the partial +40 instead gives nav_end(08-01) = 10010 and
        08-01 = 200/9810, which is what the old code produced."""
        result = _run(
            live_realized=[_record("2026-08-02", 40.0), _record("2026-08-03", -50.0)],
            archive_realized_by_day={"2026-08-01": Decimal("200"), "2026-08-02": Decimal("100")},
            archive_funding_by_day={},
            archive_flows_by_day={},
            covered_days={"2026-08-01", "2026-08-02"},
            from_day="2026-08-01",
            live_pnl_from_day="2026-08-03",
            live_flows_from_day="2026-08-03",
        )
        got = {d.date().isoformat(): v for d, v in result.returns.items()}
        assert got["2026-08-01"] == pytest.approx(200.0 / 9750.0, abs=1e-12, rel=0)
        assert got["2026-08-02"] == pytest.approx(100.0 / 9950.0, abs=1e-12, rel=0)
        assert got["2026-08-03"] == pytest.approx(-50.0 / 10050.0, abs=1e-12, rel=0)
        assert result.archive_days_prepended == 2
        # The derive-equivalent first day is still the first live RECORD: a stored live row can
        # exist from there, and rows_for_strategy must never write on or after it (D-12).
        assert result.live_first_day == "2026-08-02"

    def test_a_partial_boundary_record_with_a_funding_row_is_dropped_too(self) -> None:
        result = _run(
            live_realized=[_record("2026-08-03", -50.0)],
            live_funding=[{"timestamp": pd.Timestamp("2026-08-02T08:00:00+00:00").to_pydatetime(),
                           "amount": 7.0}],
            archive_realized_by_day={"2026-08-01": Decimal("200"), "2026-08-02": Decimal("100")},
            archive_funding_by_day={"2026-08-02": Decimal("3")},
            archive_flows_by_day={},
            covered_days={"2026-08-01", "2026-08-02"},
            from_day="2026-08-01",
            live_pnl_from_day="2026-08-03",
            live_flows_from_day="2026-08-03",
        )
        # The live funding (7) is a partial-day record and is NOT used; the archive's (3) is.
        # nav_end(08-02) = 10000 + 50 = 10050; nav_end(08-01) = 10050 - (100 + 3) = 9947.
        got = {d.date().isoformat(): v for d, v in result.returns.items()}
        assert got["2026-08-02"] == pytest.approx(103.0 / 9947.0, abs=1e-12, rel=0)

    def test_every_live_day_from_the_first_full_day_is_still_identical(self) -> None:
        """D-12 is unchanged for every day the live P&L owns."""
        result = _run(live_pnl_from_day="2026-08-03", live_flows_from_day="2026-08-03")
        live_only = _live_only()
        for ts in live_only.index:
            if ts >= pd.Timestamp("2026-08-03"):
                assert result.returns.loc[ts] == pytest.approx(live_only.loc[ts], abs=1e-9, rel=0), ts

    def test_a_live_series_that_is_only_the_partial_day_has_no_whole_day_to_roll_from(self) -> None:
        with pytest.raises(RebuildRefused) as exc:
            _run(
                live_realized=[_record("2026-08-02", 40.0)],
                live_pnl_from_day="2026-08-03",
                live_flows_from_day="2026-08-03",
            )
        assert exc.value.stop_class == "live_anchor_unusable"

    def test_the_seam_arguments_are_required(self) -> None:
        """A caller that forgets them must fail loudly rather than fall back to the first
        record: that fallback is the defect."""
        params = inspect.signature(rebuild_union).parameters
        for name in ("live_pnl_from_day", "live_flows_from_day"):
            assert params[name].default is inspect.Parameter.empty, name


class TestFlowSeam:
    """F4. The archive's transfer bills (trading account) and the live deposits/withdrawals
    (funding account) are two models of capital. A day described by both must count once."""

    BASE = dict(
        live_realized=[_record("2026-08-02", 100.0), _record("2026-08-03", -50.0)],
        archive_realized_by_day={
            "2026-07-30": Decimal("10"), "2026-07-31": Decimal("20"), "2026-08-01": Decimal("30"),
        },
        archive_funding_by_day={},
        covered_days={"2026-07-30", "2026-07-31", "2026-08-01"},
        from_day="2026-07-30",
        live_pnl_from_day="2026-08-02",
    )
    #: By hand, one +300 deposit on 07-31, anchor 10000 at the end of 08-03:
    #:   nav_end(08-02) = 10000 + 50 = 10050;  nav_end(08-01) = 10050 - 100 = 9950
    #:   nav_end(07-31) = 9950 - 30 = 9920;    nav_end(07-30) = 9920 - 20 - 300 = 9600
    #:   nav_end(07-29) = 9600 - 10 = 9590
    #: Returns: 07-30 = 10/9590, 07-31 = 20/9600 (the deposit is not performance),
    #: 08-01 = 30/9920.  Counting the movement twice would put nav_end(07-30) at 9300.
    ONCE = {"2026-07-30": 10 / 9590, "2026-07-31": 20 / 9600, "2026-08-01": 30 / 9920}

    def _returns(self, **overrides) -> dict[str, float]:
        kwargs = dict(self.BASE)
        kwargs.update(overrides)
        result = _run(**kwargs)
        return {d.date().isoformat(): v for d, v in result.returns.items()}

    def _check(self, got: dict[str, float]) -> None:
        for day, want in self.ONCE.items():
            assert got[day] == pytest.approx(want, abs=1e-12, rel=0), day

    def test_a_movement_in_both_sources_on_the_same_live_day_counts_once(self) -> None:
        """The live window opens 07-31 and holds the deposit; the archive's transfer bill for
        the same movement is on the same day. Only the live one is used."""
        live_deposit = ExternalFlow("2026-07-31", 300.0, currency="USD", quantity=None)
        got = self._returns(
            archive_flows_by_day={"2026-07-31": Decimal("300")},
            live_flows=[live_deposit],
            live_flows_from_day="2026-07-31",
        )
        self._check(got)

    def test_the_archive_alone_before_the_window_counts_once(self) -> None:
        got = self._returns(
            archive_flows_by_day={"2026-07-31": Decimal("300")},
            live_flows=[],
            live_flows_from_day="2026-08-02",
        )
        self._check(got)

    def test_the_live_window_alone_counts_once(self) -> None:
        got = self._returns(
            archive_flows_by_day={},
            live_flows=[ExternalFlow("2026-07-31", 300.0, currency="USD", quantity=None)],
            live_flows_from_day="2026-07-31",
        )
        self._check(got)

    def test_an_archive_transfer_inside_the_live_window_is_not_used(self) -> None:
        """From the first day of the live window the live deposits and withdrawals are the
        capital record; an archive bill there (a movement the live endpoints do not list, such
        as an internal transfer) is reported by the job and never silently added."""
        got = self._returns(
            archive_flows_by_day={"2026-07-31": Decimal("300")},
            live_flows=[],
            live_flows_from_day="2026-07-30",
        )
        # No flow at all: the NAV chain is 9920 -> 9900 -> 9890 with no 300 step.
        assert got["2026-07-30"] == pytest.approx(10 / 9890, abs=1e-12, rel=0)
        assert got["2026-07-31"] == pytest.approx(20 / 9900, abs=1e-12, rel=0)

    def test_a_venue_with_no_retention_cap_never_uses_archive_flows(self) -> None:
        got = self._returns(
            archive_flows_by_day={"2026-07-31": Decimal("300")},
            live_flows=[],
            live_flows_from_day=None,
        )
        assert got["2026-07-30"] == pytest.approx(10 / 9890, abs=1e-12, rel=0)


class TestRowsForStrategy:
    """The slice: covered ∩ gap, finite, before the first live day."""

    def test_one_row_per_covered_gap_day_and_none_on_or_after_the_first_live_day(self) -> None:
        result = _run()
        gaps = [{"from": "2026-07-10", "to": "2026-08-01"}]
        rows, narrowed = rows_for_strategy(result, gaps, set(), set(Q_DAYS))
        want_days = _day_range("2026-07-10", "2026-08-01")
        assert [r["date"] for r in rows] == want_days
        assert len(rows) == 23
        assert all(math.isfinite(r["daily_return"]) for r in rows)
        assert all(r["date"] < "2026-08-02" for r in rows)
        assert narrowed == []
        # Values are the union's own, keyed by day.
        union = {d.date().isoformat(): v for d, v in result.returns.items()}
        assert all(r["daily_return"] == union[r["date"]] for r in rows)

    def test_a_guard_nan_day_is_left_out_and_stays_in_the_gap(self) -> None:
        result = _run()
        nan_returns = result.returns.copy()
        nan_returns.loc[pd.Timestamp("2026-07-20")] = np.nan
        patched = RebuildResult(
            returns=nan_returns,
            live_first_day=result.live_first_day,
            first_live_day_differs=False,
            archive_days_prepended=result.archive_days_prepended,
        )
        gaps = [{"from": "2026-07-10", "to": "2026-08-01"}]
        rows, narrowed = rows_for_strategy(patched, gaps, set(), set(Q_DAYS))
        assert "2026-07-20" not in {r["date"] for r in rows}
        assert narrowed == [{"from": "2026-07-20", "to": "2026-07-20"}]


class TestRangeArithmetic:
    """T-GAP-2: ``subtract_ranges`` / ``days_to_ranges``, inclusive ends."""

    GAP = [{"from": "2026-07-01", "to": "2026-07-05"}]

    def test_full_cover_removes_the_gap(self) -> None:
        assert subtract_ranges(self.GAP, set(_day_range("2026-07-01", "2026-07-05"))) == []

    def test_head_covered_narrows_to_the_tail(self) -> None:
        got = subtract_ranges(self.GAP, {"2026-07-01", "2026-07-02", "2026-07-03"})
        assert got == [{"from": "2026-07-04", "to": "2026-07-05"}]

    def test_tail_covered_narrows_to_the_head(self) -> None:
        got = subtract_ranges(self.GAP, {"2026-07-04", "2026-07-05"})
        assert got == [{"from": "2026-07-01", "to": "2026-07-03"}]

    def test_middle_day_covered_splits_in_two(self) -> None:
        got = subtract_ranges(self.GAP, {"2026-07-03"})
        assert got == [
            {"from": "2026-07-01", "to": "2026-07-02"},
            {"from": "2026-07-04", "to": "2026-07-05"},
        ]

    def test_one_day_gap(self) -> None:
        one = [{"from": "2026-07-09", "to": "2026-07-09"}]
        assert subtract_ranges(one, {"2026-07-09"}) == []
        assert subtract_ranges(one, {"2026-07-08", "2026-07-10"}) == one

    def test_ends_are_inclusive(self) -> None:
        got = subtract_ranges(self.GAP, {"2026-06-30", "2026-07-06"})
        assert got == self.GAP

    def test_adjacent_gaps_stay_two_and_the_output_is_sorted(self) -> None:
        gaps = [
            {"from": "2026-07-06", "to": "2026-07-08"},
            {"from": "2026-07-01", "to": "2026-07-05"},
        ]
        assert subtract_ranges(gaps, set()) == [
            {"from": "2026-07-01", "to": "2026-07-05"},
            {"from": "2026-07-06", "to": "2026-07-08"},
        ]

    def test_a_backwards_gap_fails_loud(self) -> None:
        with pytest.raises(ValueError):
            subtract_ranges([{"from": "2026-07-05", "to": "2026-07-01"}], set())

    def test_days_to_ranges_collapses_consecutive_days_and_sorts(self) -> None:
        got = days_to_ranges(
            ["2026-07-09", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-02"]
        )
        assert got == [
            {"from": "2026-07-01", "to": "2026-07-03"},
            {"from": "2026-07-09", "to": "2026-07-09"},
        ]
        assert days_to_ranges([]) == []

    def test_a_month_boundary_is_consecutive(self) -> None:
        assert days_to_ranges(["2026-07-31", "2026-08-01"]) == [
            {"from": "2026-07-31", "to": "2026-08-01"}
        ]


class TestUncoveredGap:
    """T-GAP-1 / SC-4: a quarter that was not ingested is never zero-filled."""

    Q3 = _day_range("2026-07-01", "2026-09-30")
    GAP = [{"from": "2026-05-24", "to": "2026-08-01"}]

    def _q3_only(self):
        return _run(
            archive_realized_by_day=ARCHIVE_REALIZED,
            archive_funding_by_day=ARCHIVE_FUNDING,
            archive_flows_by_day=ARCHIVE_FLOWS,
            covered_days=set(self.Q3),
            from_day="2026-05-24",
        )

    def test_gap_q3_only_rows_exist_only_in_q3_and_the_q2_part_stays_named(self) -> None:
        result = self._q3_only()
        # No May or June day ever enters the union: no record, so no 0.0.
        assert result.returns.index.min() == pd.Timestamp("2026-07-01")
        assert result.archive_days_prepended == 32
        rows, narrowed = rows_for_strategy(result, self.GAP, set(), set(self.Q3))
        assert [r["date"] for r in rows] == _day_range("2026-07-01", "2026-08-01")
        assert not any(r["date"] < "2026-07-01" for r in rows)
        assert narrowed == [{"from": "2026-05-24", "to": "2026-06-30"}]

    def test_gap_covered_quiet_day_is_a_real_zero_but_the_same_day_uncovered_has_no_row(self) -> None:
        # 07-05 has no archive bill and a covered quarter: a real, explicit zero.
        with_q = self._q3_only()
        rows, _ = rows_for_strategy(with_q, self.GAP, set(), set(self.Q3))
        quiet = next(r for r in rows if r["date"] == "2026-07-05")
        assert quiet["daily_return"] == 0.0

        # The same day OUTSIDE the covered set: the surrounding days are covered, so the
        # core's gap fill writes a 0.0 into the union at 07-05, and the slice must still
        # refuse to turn that fill into a row. It stays a one-day named gap.
        covered_without = set(self.Q3) - {"2026-07-05"}
        bills = {d: v for d, v in ARCHIVE_REALIZED.items() if d in covered_without}
        without = _run(
            archive_realized_by_day=bills,
            archive_funding_by_day=ARCHIVE_FUNDING,
            archive_flows_by_day=ARCHIVE_FLOWS,
            covered_days=covered_without,
            from_day="2026-05-24",
        )
        assert pd.Timestamp("2026-07-05") in without.returns.index  # the core's fill
        rows2, narrowed2 = rows_for_strategy(without, self.GAP, set(), covered_without)
        assert "2026-07-05" not in {r["date"] for r in rows2}
        assert {"from": "2026-07-05", "to": "2026-07-05"} in narrowed2

    def test_gap_days_before_from_day_never_enter_the_union_index(self) -> None:
        result = _run(covered_days=set(Q_DAYS), from_day="2026-07-10")
        assert result.returns.index.min() == pd.Timestamp("2026-07-10")
        assert result.archive_days_prepended == len(_day_range("2026-07-10", "2026-08-01"))
        # The identity still holds with the shorter prepend.
        live_only = _live_only()
        for ts in live_only.index[1:]:
            assert result.returns.loc[ts] == pytest.approx(live_only.loc[ts], abs=1e-9, rel=0)

    def test_gap_archive_days_outside_the_interval_are_ignored(self) -> None:
        """A Q3 file also holds days at and after the first live day (the reconciliation
        overlap). They are not rebuilt days: live wins (D-12), so they must neither
        raise as 'uncovered' nor enter the union as archive records."""
        extra = dict(ARCHIVE_REALIZED)
        extra["2026-08-05"] = Decimal("999")
        result = _run(archive_realized_by_day=extra, covered_days=set(self.Q3))
        live_only = _live_only()
        assert result.returns.loc[pd.Timestamp("2026-08-05")] == pytest.approx(
            live_only.loc[pd.Timestamp("2026-08-05")], abs=1e-9, rel=0
        )


class TestLiveDaysAreNeverRows:
    """T-LIVE-1 / D-12 (Python side): a day that already has a row is not rewritten."""

    def test_live_existing_day_is_not_a_row_and_leaves_the_expected_gaps(self) -> None:
        result = _run()
        gaps = [{"from": "2026-07-10", "to": "2026-08-01"}]
        rows, narrowed = rows_for_strategy(result, gaps, {"2026-07-20"}, set(Q_DAYS))
        dates = {r["date"] for r in rows}
        assert "2026-07-20" not in dates
        assert len(rows) == 22
        # The day already has a row, so it is no longer an unrecovered gap day either.
        assert narrowed == []

    def test_live_existing_day_splits_the_remaining_gap_when_a_refusal_remains(self) -> None:
        result = _run()
        nan_returns = result.returns.copy()
        nan_returns.loc[pd.Timestamp("2026-07-25")] = np.nan
        patched = RebuildResult(
            returns=nan_returns,
            live_first_day=result.live_first_day,
            first_live_day_differs=False,
            archive_days_prepended=result.archive_days_prepended,
        )
        gaps = [{"from": "2026-07-10", "to": "2026-08-01"}]
        _, narrowed = rows_for_strategy(patched, gaps, {"2026-07-20"}, set(Q_DAYS))
        assert narrowed == [{"from": "2026-07-25", "to": "2026-07-25"}]

    def test_live_days_and_legacy_days_are_never_rows(self) -> None:
        result = _run()
        # A gap that (wrongly) reaches into the live span and a legacy day before the
        # earliest target gap: neither may ever become a row.
        gaps = [{"from": "2026-07-28", "to": "2026-08-06"}]
        rows, _ = rows_for_strategy(result, gaps, set(), set(Q_DAYS) | set(LIVE_DAYS))
        assert [r["date"] for r in rows] == ["2026-07-28", "2026-07-29", "2026-07-30",
                                            "2026-07-31", "2026-08-01"]
        legacy_rows, _ = rows_for_strategy(
            result, [{"from": "2026-07-10", "to": "2026-08-01"}], set(), set(Q_DAYS)
        )
        assert not any(r["date"] < "2026-07-10" for r in legacy_rows)


def test_the_identity_tolerance_is_a_constant_not_a_parameter() -> None:
    """Widening the tolerance is how a real divergence would be waved through."""
    params = inspect.signature(rebuild_union).parameters
    assert not any("atol" in p or "tol" in p or "tolerance" in p for p in params)
    assert rebuild_mod.IDENTITY_ATOL == 1e-9
