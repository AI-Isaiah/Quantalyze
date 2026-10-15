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
