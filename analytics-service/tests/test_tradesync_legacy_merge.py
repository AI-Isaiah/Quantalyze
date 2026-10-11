"""Phase 167.1.2.2.2 plan 07 (TRADESYNC, D-02 + D-08) -- the legacy-merge pins.

D-08 carries a strategy's legacy per-day returns (25 to 73 points ending May) into
``csv_daily_returns`` as strategy-axis rows BEFORE the first tick, so the tick's
own re-derive (which only reaches back as far as the venue still serves, about
three months on OKX) EXTENDS the published history instead of replacing it. That
leaves a recorded hole between the carried-forward rows and the re-derived window.
D-02 says a day neither trades nor bills can supply stays MISSING: never zero,
never interpolated. These pins prove the code path that consumes those rows, before
any PROD write (plan 16 does the write):

  * ``TestReDeriveNeverShortensStoredSeries`` -- the strategy-mode derive's
    reconcile delete is bounded to the span the derive itself reconstructed, so a
    stored row dated before the span start survives and the series never shortens.
  * ``TestNamedGapIsNeverZeroFilled`` -- across the hole, ``run_csv_strategy_analytics``
    persists no row, no ``returns_series`` / ``drawdown_series`` point, no grid entry
    and no 0.0 return for any gap day (and the derive's combiner does not invent
    0.0 days before the realized stream's first day).
  * ``TestMergedSeriesHeadlineBasis`` -- the merged series' headline is measured and
    pinned: it compounds only the suffix after the gap. The expected figure is
    computed here from typed per-day returns, never by calling the code under test.

Every date and return below is a typed literal. Legacy days carry 0.001 and derived
days 0.002, so a 0.0 anywhere is unambiguous and a suffix-only headline is
distinguishable from a bridged one.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_realized_and_funding
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_csv_analytics_runner import _make_broker_supabase_mock
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _daily_pnl_record,
    _patches_with_combine,
)

# ---------------------------------------------------------------------------
# Typed literals shared by the classes
# ---------------------------------------------------------------------------
LEGACY_FIRST = date(2026, 4, 1)
LEGACY_LAST = date(2026, 5, 6)
GAP_FIRST = date(2026, 5, 7)
GAP_LAST = date(2026, 7, 8)
DERIVED_FIRST = date(2026, 7, 9)
DERIVED_LAST = date(2026, 10, 8)

LEGACY_RETURN = 0.001
DERIVED_RETURN = 0.002


def _days(first: date, last: date) -> list[date]:
    """Every calendar day in [first, last], inclusive."""
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def _iso(days: list[date]) -> list[str]:
    return [d.isoformat() for d in days]


LEGACY_DAYS = _days(LEGACY_FIRST, LEGACY_LAST)
GAP_DAYS = _days(GAP_FIRST, GAP_LAST)
DERIVED_DAYS = _days(DERIVED_FIRST, DERIVED_LAST)

# Typed expectations, counted by hand against the calendar (not by the code under
# test): April 1-30 = 30, May 1-6 = 6; May 7-31 = 25, June = 30, July 1-8 = 8;
# July 9-31 = 23, August = 31, September = 30, October 1-8 = 8.
assert len(LEGACY_DAYS) == 36
assert len(GAP_DAYS) == 63
assert len(DERIVED_DAYS) == 92


# ---------------------------------------------------------------------------
# Task 1 -- D-08: a re-derive never shortens a stored series
# ---------------------------------------------------------------------------

def _dense_series(days: list[date], value: float, *, refused: set[date] | None = None) -> pd.Series:
    """A dense daily-return Series; ``refused`` days are NaN (a guarded day the
    derive SKIPS at the write, 74-04)."""
    refused = refused or set()
    return pd.Series(
        [np.nan if d in refused else value for d in days],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in days]),
        dtype="float64",
    )


def _csv_deletes(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in capture["deletes"] if d["table"] == "csv_daily_returns"]


def _apply_writes_to_store(stored: set[str], capture: dict[str, Any], strategy_id: str) -> set[str]:
    """Replay the captured writes against a stored-date set, the way PostgREST would.

    Upserts add their dates; each delete removes exactly the dates its filters name
    (``in`` list AND the ``gte``/``lte`` bound AND the strategy scope). The mock
    client does not hold state, so this is the stateful half of the proof: the
    surviving set is what a later reader would find.
    """
    after = set(stored)
    for name, payload, on_conflict in capture["upserts"]:
        if name != "csv_daily_returns":
            continue
        assert on_conflict == "strategy_id,date"
        after |= {row["date"] for row in payload}
    for rec in _csv_deletes(capture):
        f = rec["filters"]
        if f.get("eq:strategy_id") != strategy_id:
            continue  # a foreign-axis delete cannot touch this strategy's rows
        named = set(f["in:date"])
        lo, hi = f["gte:date"], f["lte:date"]
        after -= {d for d in named if lo <= d <= hi}
    return after


async def _run_strategy_derive(
    *, returns: pd.Series, strategy_id: str
) -> tuple[Any, dict[str, Any]]:
    ctx, capture = _build_ctx(
        key_row={"id": "key-lm", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": strategy_id, "user_id": "user-1"},
    )
    job = {"id": "j-lm", "kind": "derive_broker_dailies", "strategy_id": strategy_id}
    combine = MagicMock(
        return_value=(
            returns,
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )
    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    return result, capture


class TestReDeriveNeverShortensStoredSeries:
    """D-08. The legacy rows (2026-04-01..2026-05-06) are carried into
    ``csv_daily_returns`` before the first tick. The tick's strategy-mode derive
    spans only what the venue still serves (2026-07-09..2026-10-08). Its
    authoritative reconcile must stay inside THAT span, so a legacy row dated before
    it is neither named by a delete nor lost.

    Neuter (proved RED in the plan SUMMARY): widen the span-delete lower bound in
    ``run_derive_broker_dailies_job`` to the earliest stored date, and the delete
    names the legacy days.
    """

    @staticmethod
    def _derived_with_one_refused_day() -> tuple[pd.Series, date]:
        # One refused interior day makes the reconcile delete fire at all: with a
        # fully populated payload there is nothing to delete and the bound is
        # untested. 2026-08-15 sits well inside the derived span.
        refused = date(2026, 8, 15)
        return _dense_series(DERIVED_DAYS, DERIVED_RETURN, refused={refused}), refused

    @pytest.mark.asyncio
    async def test_reconcile_delete_never_names_a_day_before_the_span_start(self) -> None:
        returns, refused = self._derived_with_one_refused_day()
        result, capture = await _run_strategy_derive(returns=returns, strategy_id="strat-lm")
        assert result.outcome == DispatchOutcome.DONE

        deletes = _csv_deletes(capture)
        assert deletes, (
            "the refused interior day must produce a reconcile delete, otherwise "
            "this pin cannot observe the span bound"
        )
        span_start = DERIVED_FIRST.isoformat()
        legacy = set(_iso(LEGACY_DAYS))
        for rec in deletes:
            f = rec["filters"]
            # No lt/lte bound below the span and no gte bound below it either.
            assert f["gte:date"] >= span_start, (
                f"the delete's lower bound {f['gte:date']!r} reaches below the "
                f"derived span start {span_start!r}: a carried-forward legacy row "
                "could be erased"
            )
            assert f["lte:date"] == DERIVED_LAST.isoformat()
            named = set(f["in:date"])
            assert not (named & legacy), (
                f"the delete names legacy days {sorted(named & legacy)[:3]!r}"
            )
            assert min(named) >= span_start
            assert f["eq:strategy_id"] == "strat-lm"
        # The refused day is the only day the payload lacks, so it is the only day
        # the reconcile may name.
        assert [d for rec in deletes for d in rec["filters"]["in:date"]] == [
            refused.isoformat()
        ]

    @pytest.mark.asyncio
    async def test_upsert_precedes_delete_and_every_legacy_date_survives(self) -> None:
        returns, _ = self._derived_with_one_refused_day()
        result, capture = await _run_strategy_derive(returns=returns, strategy_id="strat-lm")
        assert result.outcome == DispatchOutcome.DONE

        ops = [o for o in capture["ops"] if o[1] == "csv_daily_returns"]
        assert ops[0] == ("upsert", "csv_daily_returns")
        assert ops[-1] == ("delete", "csv_daily_returns"), (
            f"the upsert must precede the reconcile delete; got {ops!r}"
        )
        assert ops.index(("upsert", "csv_daily_returns")) < ops.index(
            ("delete", "csv_daily_returns")
        )

        stored_before = set(_iso(LEGACY_DAYS))
        stored_after = _apply_writes_to_store(stored_before, capture, "strat-lm")
        assert set(_iso(LEGACY_DAYS)) <= stored_after, (
            "every carried-forward legacy date must survive the re-derive; lost "
            f"{sorted(set(_iso(LEGACY_DAYS)) - stored_after)[:3]!r}"
        )
        # 36 legacy days + 91 derived days (92 minus the one refused day).
        assert len(stored_after) == 36 + 91
        assert len(stored_after) >= len(stored_before), "the stored series was shortened"
        # The named hole stays a hole: the derive neither fills nor touches it.
        assert not (stored_after & set(_iso(GAP_DAYS)))

    @pytest.mark.asyncio
    async def test_a_legacy_date_inside_the_derived_span_is_overwritten_and_counted(self) -> None:
        """An overlap is never silent. Legacy rows carried up to 2026-07-10 overlap
        the derived span on exactly two dates (2026-07-09, 2026-07-10): the upsert
        overwrites them (trade-derived wins, D-04), the test names them, and no
        other legacy date is touched."""
        overlap = {date(2026, 7, 9), date(2026, 7, 10)}
        legacy_with_overlap = _days(date(2026, 6, 20), date(2026, 7, 10))
        assert len(legacy_with_overlap) == 21
        returns, _ = self._derived_with_one_refused_day()
        result, capture = await _run_strategy_derive(returns=returns, strategy_id="strat-lm")
        assert result.outcome == DispatchOutcome.DONE

        upserted = {
            row["date"]
            for name, payload, _ in capture["upserts"]
            if name == "csv_daily_returns"
            for row in payload
        }
        overwritten = set(_iso(legacy_with_overlap)) & upserted
        assert overwritten == set(_iso(sorted(overlap))), (
            f"the overlap must be exactly the two named dates; got {sorted(overwritten)!r}"
        )
        stored_after = _apply_writes_to_store(
            set(_iso(legacy_with_overlap)), capture, "strat-lm"
        )
        # The 19 pre-span legacy dates (2026-06-20..2026-07-08) survive untouched.
        assert set(_iso(_days(date(2026, 6, 20), date(2026, 7, 8)))) <= stored_after


# ---------------------------------------------------------------------------
# Task 2 -- D-02: the named gap is never zero-filled
# ---------------------------------------------------------------------------

def _merged_rows() -> list[dict[str, Any]]:
    """csv_daily_returns for a broker-sourced strategy: carried-forward legacy rows,
    nothing across the gap, then the re-derived window."""
    return [
        {"date": d.isoformat(), "daily_return": LEGACY_RETURN} for d in LEGACY_DAYS
    ] + [
        {"date": d.isoformat(), "daily_return": DERIVED_RETURN} for d in DERIVED_DAYS
    ]


async def _run_runner_on_merged_rows() -> tuple[dict[str, Any], dict[str, Any], list[Any]]:
    """Run the REAL ``run_csv_strategy_analytics`` (no compute stub) over the merged
    rows. Returns ``(complete_payload, rpc_kinds, all_rpc_calls)``: the
    strategy_analytics row the success path wrote, every ``p_kinds`` map handed to
    ``upsert_strategy_analytics_series_batch`` merged by kind, and the raw calls."""
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(_merged_rows(), api_key_id="key-lm")
    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns",
        new=AsyncMock(return_value=(None, True)),
    ):
        result = await run_csv_strategy_analytics("merged-strategy-uuid")
    assert result == {"status": "complete", "strategy_id": "merged-strategy-uuid"}

    upserts = sb.table("strategy_analytics").upsert.call_args_list
    complete = [
        c.args[0]
        for c in upserts
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert len(complete) == 1, f"expected one complete upsert, got {len(complete)}"

    kinds: dict[str, Any] = {}
    calls = [c for c in sb.rpc.call_args_list if c.args and c.args[0] == "upsert_strategy_analytics_series_batch"]
    for c in calls:
        kinds.update(c.args[1]["p_kinds"])
    return complete[0], kinds, calls


def _dates_of(points: list[dict[str, Any]], key: str = "date") -> list[str]:
    return [p[key] for p in points]


class TestNamedGapIsNeverZeroFilled:
    """D-02 (UI-checker must-carry). The F1 factsheet line says the gap is "left out
    of the record, not counted as zero". That is only true if no persisted
    series carries a point dated inside it.

    Neuter (proved RED in the plan SUMMARY): change the broker dense reindex in
    ``run_csv_strategy_analytics`` to ``reindex(dense_index, fill_value=0.0)`` and a
    gap date appears with a 0.0 return.
    """

    @pytest.mark.asyncio
    async def test_runner_persists_no_row_or_point_or_zero_inside_the_gap(self) -> None:
        payload, kinds, _ = await _run_runner_on_merged_rows()
        gap = set(_iso(GAP_DAYS))

        # (1) the persisted per-basis series row (cash_settlement): sparse rows.
        cash = kinds["cash_settlement"]
        row_dates = set(_dates_of(cash["rows"]))
        assert not (row_dates & gap), (
            f"persisted series rows dated inside the gap: {sorted(row_dates & gap)[:3]!r}"
        )
        assert not any(
            r["return"] == 0.0 for r in cash["rows"]
        ), "a 0.0 return row was persisted"
        # The legacy and the derived days are all there, nothing invented.
        assert row_dates == set(_iso(LEGACY_DAYS)) | set(_iso(DERIVED_DAYS))

        # (2) the persisted coverage mask names the gap exactly, as one span.
        assert cash["gap_spans"] == [
            {"start": GAP_FIRST.isoformat(), "end": GAP_LAST.isoformat()}
        ], f"gap_spans must name the recorded gap exactly; got {cash['gap_spans']!r}"
        assert cash["conventions"]["densify"] == "broker_nan"

        # (3) the daily-returns grid sibling kind.
        grid = kinds["daily_returns_grid"]
        grid_dates = set(_dates_of(grid))
        assert not (grid_dates & gap), (
            f"daily-grid entries dated inside the gap: {sorted(grid_dates & gap)[:3]!r}"
        )
        assert not any(p["value"] == 0.0 for p in grid), "a 0.0 grid entry was persisted"

        # (4) every OTHER persisted kind (rolling windows, log-returns curve ...):
        # none may carry a point dated inside the gap either.
        for kind, points in kinds.items():
            if kind == "cash_settlement":
                continue
            inside = set(_dates_of(points)) & gap
            assert not inside, (
                f"sibling kind {kind!r} carries points dated inside the gap: "
                f"{sorted(inside)[:3]!r}"
            )

    @pytest.mark.asyncio
    async def test_cumulative_chart_curve_carries_no_point_inside_the_gap(self) -> None:
        payload, _, _ = await _run_runner_on_merged_rows()
        gap = set(_iso(GAP_DAYS))
        for field in ("returns_series", "drawdown_series"):
            inside = set(_dates_of(payload[field])) & gap
            assert not inside, (
                f"{field} carries points dated inside the gap: {sorted(inside)[:3]!r}"
            )
        # Undated sparkline of the cumulative curve: every typed return is positive,
        # so the curve is strictly increasing; a flat bridged stretch is an equal pair.
        sparkline = payload["sparkline_returns"]
        assert all(b > a for a, b in zip(sparkline, sparkline[1:]))

    @pytest.mark.asyncio
    async def test_runner_load_reindexes_the_hole_to_nan_never_zero(self) -> None:
        """Pin the load boundary directly: the series handed to the shared derive has
        NaN, not 0.0, on every gap day."""
        from services.analytics_runner import run_csv_strategy_analytics

        captured: dict[str, pd.Series] = {}
        from services.basis_series import derive_basis_series as real_derive

        def _spy(returns: pd.Series, *a: Any, **k: Any) -> Any:
            captured["returns"] = returns.copy()
            return real_derive(returns, *a, **k)

        sb = _make_broker_supabase_mock(_merged_rows(), api_key_id="key-lm")
        with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
            "services.analytics_runner.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ), patch("services.basis_series.derive_basis_series", side_effect=_spy):
            await run_csv_strategy_analytics("merged-strategy-uuid")

        series = captured["returns"]
        for d in GAP_DAYS:
            ts = pd.Timestamp(d)
            assert ts in series.index, f"{d} missing from the dense index"
            assert bool(np.isnan(series.loc[ts])), (
                f"{d} must be NaN at the load boundary, got {series.loc[ts]!r}"
            )
        assert int(series.isna().sum()) == 63
        assert not (series == 0.0).any()

    def test_combiner_emits_no_zero_or_funding_only_day_before_the_realized_reach(self) -> None:
        """Derive side. Realized bills start 2026-07-09; a funding stream that
        reaches further back (from 2026-05-01) must not let the combiner emit
        0.0 or funding-only days before the realized stream's first day."""
        realized = [
            _daily_pnl_record(d.isoformat(), 20.0) for d in _days(DERIVED_FIRST, date(2026, 7, 20))
        ]
        # Funding on 2026-05-01 and every 10th day after, up to the realized reach.
        funding_days = [date(2026, 5, 1) + timedelta(days=10 * i) for i in range(7)]
        assert funding_days[-1] == date(2026, 6, 30)
        funding = [
            {
                "timestamp": datetime(d.year, d.month, d.day, 8, 0, tzinfo=timezone.utc),
                "amount": -1.5,
            }
            for d in funding_days
        ]

        # The caller states the realized fetch's real reach (HI-01: the combiner no
        # longer guesses it from the first realized record). Funding from 05-01 is
        # BEYOND a realized fetch that starts 07-09.
        returns, meta = combine_realized_and_funding(
            realized, funding, 10_000.0, realized_reach_start=DERIVED_FIRST.isoformat()
        )

        assert meta["series_completeness"] == "fill_derived_unproven"
        first = returns.index.min().date()
        assert first >= DERIVED_FIRST, (
            f"the series starts {first}, before the realized stream's first day "
            f"{DERIVED_FIRST}: days before the realized reach must be ABSENT, never "
            "0.0 or funding-only"
        )
        before = returns[returns.index < pd.Timestamp(DERIVED_FIRST)]
        assert before.empty

    def test_funding_inside_the_realized_reach_and_funding_only_accounts_are_untouched(self) -> None:
        """The trim is bounded: funding dated ON or AFTER the realized stream's first
        day still counts, and an account with NO realized records (a funding-only
        perp) has no realized reach to compare against, so its funding days stay."""

        def _funding(day: date, amount: float) -> dict[str, Any]:
            return {
                "timestamp": datetime(day.year, day.month, day.day, 8, 0, tzinfo=timezone.utc),
                "amount": amount,
            }

        realized = [
            _daily_pnl_record(d.isoformat(), 20.0) for d in _days(DERIVED_FIRST, date(2026, 7, 14))
        ]
        without, _ = combine_realized_and_funding(realized, [], 10_000.0)
        with_inside, _ = combine_realized_and_funding(
            realized, [_funding(date(2026, 7, 12), -5.0)], 10_000.0
        )
        day = pd.Timestamp(date(2026, 7, 12))
        assert with_inside.loc[day] != without.loc[day], (
            "funding dated inside the realized reach must still move that day's return"
        )
        assert with_inside.index.min().date() == DERIVED_FIRST

        funding_only, _ = combine_realized_and_funding(
            [],
            [_funding(date(2026, 5, 1), 2.0), _funding(date(2026, 5, 3), 2.0)],
            10_000.0,
        )
        assert funding_only.index.min().date() == date(2026, 5, 1)
        assert funding_only.index.max().date() == date(2026, 5, 3)


class TestFundingBeforeTheFirstCloseIsRealPnl:
    """HI-01 (PR-B round 1). A perp account that OPENS a long and closes nothing for
    a stretch pays real funding on every one of those days. The realized fetch and
    the funding fetch run over the same window, so funding dated before the first
    realized record is a held position, not a day beyond the realized reach: it must
    stay in the series. Only funding the realized fetch could NOT have reached is
    dropped, and only when the caller says where that reach begins.

    Hand-typed figures (not computed by the code under test). A 6-day account,
    equity anchor 10_000.00, no external flows, no open unrealized P&L:

      day 1-4 (2026-08-01..04): funding only, -10.00 each (a long held, no close)
      day 5   (2026-08-05):     first close, +100.00 realized
      day 6   (2026-08-06):     +50.00 realized

    total P&L = 4 * -10 + 100 + 50 = +110, so the NAV before day 1 is
    10_000 - 110 = 9_890 and each day's return is pnl / NAV_before_that_day:

      day 1: NAV 9_890 -> 9_880   r = -10 / 9_890
      day 2: NAV 9_880 -> 9_870   r = -10 / 9_880
      day 3: NAV 9_870 -> 9_860   r = -10 / 9_870
      day 4: NAV 9_860 -> 9_850   r = -10 / 9_860
      day 5: NAV 9_850 -> 9_950   r =  100 / 9_850
      day 6: NAV 9_950 -> 10_000  r =   50 / 9_950

    Independent invariant: with no flows the chained NAV ratios telescope, so the
    cumulative return is 10_000 / 9_890 - 1 = 110 / 9_890 = +1.11223%.

    Today's (buggy) code drops days 1-4 and starts the series on day 5: total P&L
    150, NAV before day 5 = 9_850, cumulative = 10_000 / 9_850 - 1 = +1.52284%,
    overstated by 0.41 percentage points with 4 real funding days erased.
    """

    FIRST = date(2026, 8, 1)
    FIRST_CLOSE = date(2026, 8, 5)
    ANCHOR = 10_000.0
    EXPECTED = [
        -10.0 / 9_890.0,
        -10.0 / 9_880.0,
        -10.0 / 9_870.0,
        -10.0 / 9_860.0,
        100.0 / 9_850.0,
        50.0 / 9_950.0,
    ]

    def _inputs(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        realized = [
            _daily_pnl_record("2026-08-05", 100.0),
            _daily_pnl_record("2026-08-06", 50.0),
        ]
        funding = [
            {
                "timestamp": datetime(2026, 8, d, 8, 0, tzinfo=timezone.utc),
                "amount": -10.0,
            }
            for d in range(1, 5)
        ]
        return realized, funding

    def test_funding_days_before_the_first_close_stay_in_the_series(self) -> None:
        realized, funding = self._inputs()

        returns, _ = combine_realized_and_funding(realized, funding, self.ANCHOR)

        assert [d.date() for d in returns.index] == _days(self.FIRST, date(2026, 8, 6)), (
            "the series must open on the first funding day (a long held 4 days before "
            "its first close), not on the first realized record"
        )
        assert list(returns.to_numpy()) == pytest.approx(self.EXPECTED, rel=1e-12)
        cumulative = float(np.prod(1.0 + returns.to_numpy()) - 1.0)
        assert cumulative == pytest.approx(110.0 / 9_890.0, rel=1e-12)

    def test_a_reach_that_covers_the_funding_changes_nothing(self) -> None:
        realized, funding = self._inputs()

        returns, _ = combine_realized_and_funding(
            realized, funding, self.ANCHOR, realized_reach_start="2026-08-01"
        )

        assert list(returns.to_numpy()) == pytest.approx(self.EXPECTED, rel=1e-12)

    def test_only_funding_before_a_stated_reach_is_dropped(self) -> None:
        """When the realized fetch genuinely starts 2026-08-03, funding on 08-01 and
        08-02 is beyond it (dropped); funding on 08-03 and 08-04 is inside it and
        stays, the reach day itself included. Total P&L = 2 * -10 + 150 = 130, NAV
        before 08-03 = 9_870: r(08-03) = -10/9_870, r(08-04) = -10/9_860 (NAV 9_860),
        r(08-05) = 100/9_850, r(08-06) = 50/9_950."""
        realized, funding = self._inputs()

        returns, _ = combine_realized_and_funding(
            realized, funding, self.ANCHOR, realized_reach_start="2026-08-03"
        )

        assert [d.date() for d in returns.index] == _days(date(2026, 8, 3), date(2026, 8, 6))
        assert list(returns.to_numpy()) == pytest.approx(
            [-10.0 / 9_870.0, -10.0 / 9_860.0, 100.0 / 9_850.0, 50.0 / 9_950.0], rel=1e-12
        )

    def test_a_malformed_reach_fails_loud(self) -> None:
        realized, funding = self._inputs()
        with pytest.raises(ValueError):
            combine_realized_and_funding(
                realized, funding, self.ANCHOR, realized_reach_start="2026-8-3 junk"
            )


class TestMergedSeriesHeadlineBasis:
    """The merged series' headline, MEASURED (plan 16 shows it to the founder before
    any PROD write). Under DQ-03 the headline compounds only the maximal contiguous
    suffix after the gap. The expected figure is computed here from the typed
    per-day return, independently of the code under test.
    """

    @pytest.mark.asyncio
    async def test_headline_compounds_only_the_post_gap_suffix(self) -> None:
        payload, _, _ = await _run_runner_on_merged_rows()

        suffix_only = (1.0 + DERIVED_RETURN) ** len(DERIVED_DAYS) - 1.0
        bridged = (
            (1.0 + LEGACY_RETURN) ** len(LEGACY_DAYS)
            * (1.0 + DERIVED_RETURN) ** len(DERIVED_DAYS)
            - 1.0
        )
        assert suffix_only != pytest.approx(bridged, rel=1e-3)
        headline = payload["cumulative_return"]
        assert headline == pytest.approx(suffix_only, rel=1e-9), (
            f"the headline must compound only the {len(DERIVED_DAYS)} post-gap days "
            f"({suffix_only}), not the bridged {bridged}; got {headline}"
        )
        assert not math.isclose(headline, bridged, rel_tol=1e-3)

    @pytest.mark.asyncio
    async def test_measured_status_and_flags_for_the_merged_series(self) -> None:
        """Pin whatever the code does, so a change in it is a deliberate one.

        The runner rebuilds ``data_quality_flags`` wholesale and carries the
        chain-break guard flags ONLY from the flags the derive pre-stamped. The
        compute's own ``twr_chain_broken`` is discarded (``cumulative_twr_segmented``
        returns ``(value, flags)`` and ``compute_all_metrics`` keeps only the
        value). The legacy rows were carried in by a PROD write, not by a derive, so
        nothing pre-stamps the flag: the merged series therefore ships a
        suffix-only headline WITHOUT ``twr_chain_broken``. This test records that
        measured fact; the SUMMARY carries it to the founder.
        """
        payload, kinds, _ = await _run_runner_on_merged_rows()

        flags = payload["data_quality_flags"]
        assert payload["computation_status"] == "complete"
        assert payload["computation_warned"] is False
        assert flags["csv_source"] is True
        assert "twr_chain_broken" not in flags  # measured; see docstring
        # The coverage mask on the persisted series IS the record of the gap.
        assert kinds["cash_settlement"]["gap_spans"] == [
            {"start": GAP_FIRST.isoformat(), "end": GAP_LAST.isoformat()}
        ]
        # Which persisted fields carry the legacy points (the founder's question):
        legacy = set(_iso(LEGACY_DAYS))
        carried = {
            "cash_settlement.rows": legacy <= set(_dates_of(kinds["cash_settlement"]["rows"])),
            "daily_returns_grid": legacy <= set(_dates_of(kinds["daily_returns_grid"])),
            "returns_series": legacy <= set(_dates_of(payload["returns_series"])),
            "drawdown_series": legacy <= set(_dates_of(payload["drawdown_series"])),
        }
        assert all(carried.values()), f"legacy points missing from {carried!r}"

        # MEASURED, and the founder-facing half of "extends the published history":
        # the headline is suffix-only (see the test above) while the cumulative CHART
        # curve still carries the legacy level across the gap. Its last point is the
        # BRIDGED product, so on this row the chart end value (1.2458...) and the
        # headline (0.2018...) describe different bases. Typed independently.
        bridged_level = (1.0 + LEGACY_RETURN) ** len(LEGACY_DAYS) * (
            1.0 + DERIVED_RETURN
        ) ** len(DERIVED_DAYS)
        assert payload["returns_series"][-1]["value"] == pytest.approx(bridged_level)
        assert payload["returns_series"][-1]["value"] - 1.0 != pytest.approx(
            payload["cumulative_return"]
        )
