"""OKXHISTORY (167.1.2.2.2.1) plan 04: two properties the storage design rests on.

These pin EXISTING behaviour; they change no production code.

1. T-CLOBBER-1 (D-12). Rebuilt rows are dated strictly before the live derive's span
   start, so the derive's reconcile delete (bounded ``gte span_start``) never reaches
   them, and a derive whose span starts INSIDE a rebuilt range overwrites those days
   (live wins). The tests run the derive's real upsert + reconcile-delete path against
   a STATEFUL fake of ``csv_daily_returns`` so "the rows survive" is observed on rows,
   not inferred from call arguments.

2. D-07 compute inclusion. Rebuilt rows count: the CSV analytics runner's loaded
   series has no interior break inside the rebuilt range, and ``headline_since``
   moves earlier (to the first rebuilt day, or away entirely when the gap is whole).

Neuter proof (plan 04 SUMMARY): in ``services/job_worker.py`` give the derive persist
block's ``_span_start`` a fixed early date. The reconcile delete then names and bounds
days before the live span, and ``-k CLOBBER`` goes RED.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_csv_analytics_runner import _make_broker_supabase_mock
from tests.test_derive_broker_dailies_dualmode import _build_ctx, _patches_with_combine

_REBUILT = 0.123  # a distinctive stored value: a clobber or a rewrite cannot hide
_STRATEGY = "strat-okx"


def _days(first: str, last: str) -> list[str]:
    return [d.date().isoformat() for d in pd.date_range(first, last, freq="D")]


class _StatefulCsvTable:
    """``csv_daily_returns`` for ONE strategy: upsert merges by date, delete applies the
    derive's filters (eq strategy_id, gte/lte date, in date) to the rows, and every call
    is recorded so a test can assert on what the derive named, not only on what is left."""

    def __init__(self, initial: dict[str, float]) -> None:
        self.rows = dict(initial)
        self.upserts: list[list[dict[str, Any]]] = []
        self.deletes: list[dict[str, Any]] = []

    def table(self) -> MagicMock:
        tbl = MagicMock()
        tbl.upsert.side_effect = self._upsert
        tbl.delete.side_effect = self._delete
        return tbl

    def _upsert(self, payload: list[dict[str, Any]], **_kw: object) -> MagicMock:
        self.upserts.append(list(payload))
        stub = MagicMock()

        def _execute() -> MagicMock:
            for row in payload:
                self.rows[row["date"]] = row["daily_return"]
            return MagicMock(data=1)

        stub.execute.side_effect = _execute
        return stub

    def _delete(self, **_kw: object) -> MagicMock:
        record: dict[str, Any] = {}
        self.deletes.append(record)
        chain = MagicMock()

        def _setter(key: str) -> Any:
            def _f(col: str, val: object) -> MagicMock:
                record[f"{key}:{col}"] = list(val) if key == "in" else val  # type: ignore[call-overload]
                return chain

            return _f

        chain.eq.side_effect = _setter("eq")
        chain.gte.side_effect = _setter("gte")
        chain.lte.side_effect = _setter("lte")
        chain.in_.side_effect = _setter("in")

        def _execute() -> MagicMock:
            lo, hi = record.get("gte:date"), record.get("lte:date")
            named = set(record.get("in:date", []))
            for d in list(self.rows):
                if lo is not None and d < lo:
                    continue
                if hi is not None and d > hi:
                    continue
                if named and d not in named:
                    continue
                if record.get("eq:strategy_id") not in (None, _STRATEGY):
                    continue
                del self.rows[d]
            return MagicMock(data=[])

        chain.execute.side_effect = _execute
        return chain


async def _run_derive(returns: pd.Series, initial: dict[str, float]) -> _StatefulCsvTable:
    ctx, _capture = _build_ctx(
        key_row={"id": "key-okx", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": _STRATEGY, "user_id": "user-1"},
    )
    store = _StatefulCsvTable(initial)
    original_table = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        return store.table() if name == "csv_daily_returns" else original_table(name)

    ctx.supabase.table.side_effect = _table

    combine = MagicMock(
        return_value=(
            returns,
            {"used_heuristic_capital": False, "series_completeness": "fill_derived_unproven"},
        )
    )
    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    job = {"id": "j-okx", "kind": "derive_broker_dailies", "strategy_id": _STRATEGY}
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    assert result.outcome == DispatchOutcome.DONE
    return store


def _live_series(first: str, last: str, *, refuse: str | None = None) -> pd.Series:
    days = _days(first, last)
    vals = [0.001 * (i + 1) for i in range(len(days))]
    series = pd.Series(vals, index=pd.DatetimeIndex(days).as_unit("us"), dtype="float64")
    if refuse is not None:
        series.loc[pd.Timestamp(refuse)] = np.nan
    return series


class TestDeriveNeverReachesOlderRows:
    """T-CLOBBER-1: the derive's write path cannot erase or rewrite a rebuilt day."""

    @pytest.mark.asyncio
    async def test_CLOBBER_1a_a_derive_starting_at_08_02_touches_nothing_earlier(self) -> None:
        """If the derive's delete reached rows older than its span, every rebuilt day
        would vanish the next time a key re-derives, and the public line would claim a
        reconstruction the series no longer holds. A refused live day (2026-08-05) forces
        a real reconcile delete so the bound is exercised, not skipped."""
        rebuilt = {d: _REBUILT for d in _days("2026-07-01", "2026-08-01")}
        stale = {**rebuilt, "2026-08-05": 0.9}  # a prior derive wrote 08-05; this one refuses it
        store = await _run_derive(_live_series("2026-08-02", "2026-08-10", refuse="2026-08-05"), stale)

        # The rows survive, untouched.
        for day in _days("2026-07-01", "2026-08-01"):
            assert store.rows.get(day) == _REBUILT, day
        # The refused live day was reconciled away: the delete really ran inside the span.
        assert "2026-08-05" not in store.rows
        assert store.deletes, "the reconcile delete must have run"

        # Nothing the derive named or bounded lies before its span start.
        span_start = "2026-08-02"
        for payload in store.upserts:
            assert all(row["date"] >= span_start for row in payload)
        for rec in store.deletes:
            assert rec["gte:date"] >= span_start, rec
            assert all(d >= span_start for d in rec["in:date"]), rec
        assert [d for rec in store.deletes for d in rec["in:date"]] == ["2026-08-05"]

    @pytest.mark.asyncio
    async def test_CLOBBER_1b_a_derive_starting_inside_the_range_overwrites_it_live_wins(self) -> None:
        """D-12 the other way: when the live span reaches back into a rebuilt range, the
        live-derived days win and the older rebuilt days are left alone. Without this the
        archive could outvote the live feed on a day both cover."""
        rebuilt = {d: _REBUILT for d in _days("2026-07-01", "2026-08-01")}
        live = _live_series("2026-07-20", "2026-08-05")
        store = await _run_derive(live, rebuilt)

        for ts, val in live.items():
            assert store.rows[ts.date().isoformat()] == pytest.approx(val), ts
        for day in _days("2026-07-01", "2026-07-19"):
            assert store.rows[day] == _REBUILT, day
        span_start = "2026-07-20"
        for payload in store.upserts:
            assert all(row["date"] >= span_start for row in payload)
        for rec in store.deletes:
            assert rec["gte:date"] >= span_start, rec


# ---------------------------------------------------------------------------
# D-07: the runner counts rebuilt rows
# ---------------------------------------------------------------------------

_CYCLE = [0.012, -0.007, 0.004, -0.002, 0.009, -0.011, 0.001]


def _rows(first: str, last: str) -> list[dict[str, Any]]:
    """Stored rows for a day range; the value depends on the date, so two blocks of the
    same series never share a value by accident."""
    out = []
    for day in _days(first, last):
        ordinal = pd.Timestamp(day).dayofyear
        out.append({"date": day, "daily_return": _CYCLE[ordinal % len(_CYCLE)]})
    return out


LEGACY = _rows("2026-02-23", "2026-03-22")        # carried-forward legacy days (rows exist)
LIVE = _rows("2026-04-13", "2026-05-24")          # live-derived days
GAP = _days("2026-03-23", "2026-04-12")           # the stored unrecovered gap


async def _load_and_headline(stored: list[dict[str, Any]]) -> tuple[pd.Series, str | None]:
    """Run the REAL runner + REAL ``compute_all_metrics`` over stored rows and return
    the series it loaded and the ``headline_since`` it persisted to the data-quality
    flags (read off the strategy_analytics upsert, not off the metrics object)."""
    from services.analytics_runner import run_csv_strategy_analytics
    from services.metrics import compute_all_metrics as real_compute

    captured: dict[str, pd.Series] = {}

    def _spy(returns: pd.Series, *a: Any, **k: Any) -> Any:
        captured["returns"] = returns
        return real_compute(returns, *a, **k)

    sb = _make_broker_supabase_mock(stored, api_key_id="key-okx")
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.basis_series.compute_all_metrics", side_effect=_spy):
        await run_csv_strategy_analytics("okx-strategy")

    since = None
    for call in sb.table("strategy_analytics").upsert.call_args_list:
        payload = call.args[0] if call.args else {}
        flags = payload.get("data_quality_flags") if isinstance(payload, dict) else None
        if isinstance(flags, dict) and "headline_since" in flags:
            since = flags["headline_since"]
    return captured["returns"], since


class TestRunnerCountsRebuiltRows:
    """D-07: rebuilt days COUNT. If the runner ignored them the public line would
    describe days that do not count toward the headline."""

    @pytest.mark.asyncio
    async def test_a_gap_left_empty_breaks_the_chain_at_the_gap(self) -> None:
        series, since = await _load_and_headline(LEGACY + LIVE)
        assert int(series.loc["2026-03-23":"2026-04-12"].isna().sum()) == 21
        assert since == "2026-04-13"

    @pytest.mark.asyncio
    async def test_partial_rebuild_closes_the_break_inside_the_range_and_moves_headline_since_earlier(self) -> None:
        """SC-4 shape: the later part of the gap is rebuilt, the earlier part was in a
        quarter that was not ingested and stays missing (and named)."""
        rebuilt = _rows("2026-04-01", "2026-04-12")
        series, since = await _load_and_headline(LEGACY + rebuilt + LIVE)

        # No interior break anywhere inside the rebuilt range.
        inside = series.loc["2026-04-01":"2026-04-12"]
        assert len(inside) == 12 and int(inside.isna().sum()) == 0
        # The uncovered part is still an honest hole, never a 0.0.
        remnant = series.loc["2026-03-23":"2026-03-31"]
        assert len(remnant) == 9 and int(remnant.isna().sum()) == 9
        # And the headline now starts at the first rebuilt day, earlier than with the gap empty.
        assert since == "2026-04-01"
        _, since_empty = await _load_and_headline(LEGACY + LIVE)
        assert since < since_empty

    @pytest.mark.asyncio
    async def test_a_whole_rebuilt_gap_leaves_no_break_at_all(self) -> None:
        series, since = await _load_and_headline(LEGACY + _rows("2026-03-23", "2026-04-12") + LIVE)
        assert int(series.isna().sum()) == 0
        assert len(series) == len(_days("2026-02-23", "2026-05-24"))
        assert since is None
