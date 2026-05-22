"""Phase 19.1 / CSV → analytics pipeline Plan 02 Task 2.

Tests for run_csv_strategy_analytics — the runner the worker calls for
source='csv' strategies. Re-derived from PR #270 commit 06c38b80 plus
PR #273 hardening (01cbea60).

Coverage:
  - happy path: rows → complete + csv_source=True
  - insufficient history: 1 row → 400 + computation_status=failed
  - benchmark unavailable: stale fetch → complete + benchmark_unavailable
  - PR #273 (T-19.1-03): _mark_unrecoverable upsert fails →
    logger.warning fires BEFORE re-raise; outer 500 still propagates
  - sparse calendar: 60 weekday-only rows complete without raising
"""
from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi import HTTPException

from services.metrics import MetricsResult


def _make_supabase_mock(rows: list[dict]) -> MagicMock:
    """Build a Supabase client mock matching the get_supabase() shape used
    in analytics_runner.py.

    Supports two read patterns:
      1.  .select(...).eq(...).order(...).execute() — legacy direct
          callers (e.g. the strategy-existence probe via .single()).
      2.  .select(...).eq(...).order(...).range(start, end).execute() —
          the WR-02 paginated_select helper used by _load_series. The
          ``range`` page returns ``rows`` once; on the next iteration
          ``paginated_select`` sees len(chunk) < page_size (1000) and
          terminates, so the same mock works for tests that use ≤ 1000
          rows without faking page boundaries explicitly.
    """
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    # .upsert(...).execute() returns a non-erroring MagicMock by default.
    table.upsert.return_value = MagicMock(execute=MagicMock())

    # .select(...).eq(...).order(...).execute() returns the seeded rows.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    order_chain = MagicMock()
    order_chain.execute.return_value = MagicMock(data=rows)
    eq_chain.order.return_value = order_chain
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    # WR-02 (19.1-REVIEW): paginated_select calls .order(...).range(s, e)
    # .execute(). Wire the same rows on the range chain so the first
    # page returns everything; paginated_select then short-circuits on
    # the partial-page signal (len(chunk) < 1000).
    range_chain = MagicMock()
    range_chain.execute.return_value = MagicMock(data=rows)
    order_chain.range.return_value = range_chain

    # .rpc(...).execute() — used by the sibling_kinds batch upsert path.
    sb.rpc.return_value = MagicMock(execute=MagicMock())
    return sb


def _make_metrics_result() -> MetricsResult:
    """compute_all_metrics output stub — minimal shape that satisfies the
    runner's payload spread (no sibling_kinds → no batch RPC fired)."""
    return MetricsResult(
        metrics_json={
            "cumulative_return": 0.1,
            "cagr": 0.12,
            "volatility": 0.2,
            "sharpe": 1.5,
            "sortino": 2.0,
            "calmar": 1.0,
            "max_drawdown": -0.05,
            "max_drawdown_duration_days": 5,
            "six_month_return": 0.06,
            "sparkline_returns": [],
            "sparkline_drawdown": [],
            "metrics_json": {},
            "returns_series": [],
            "drawdown_series": [],
            "monthly_returns": {},
            "rolling_metrics": {},
            "return_quantiles": {},
        },
        sibling_kinds={},
    )


@pytest.mark.asyncio
async def test_csv_analytics_happy_path() -> None:
    """Test 1 — 15 rows of daily_returns + benchmark available →
    computation_status='complete', data_quality_flags.csv_source=True,
    trade_metrics/volume_metrics/exposure_metrics all None."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ] * 5  # 15 rows
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(pd.Series([0.001] * 15), False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result == {"status": "complete", "strategy_id": "test-strategy-uuid"}

    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    assert len(completed) >= 1, "Expected at least one upsert with status='complete'"
    payload = completed[0].args[0]
    assert payload["data_quality_flags"] == {"csv_source": True}
    assert payload["trade_metrics"] is None
    assert payload["volume_metrics"] is None
    assert payload["exposure_metrics"] is None
    assert payload["computation_error"] is None


@pytest.mark.asyncio
async def test_csv_analytics_insufficient_history() -> None:
    """Test 2 — 1 row → HTTPException(400) AND a final upsert sets
    computation_status='failed' with 'Insufficient CSV history' in the
    computation_error string."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [{"date": "2024-01-01", "daily_return": 0.005}]  # only 1 row
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    assert exc_info.value.status_code == 400
    assert "Insufficient CSV history" in exc_info.value.detail

    upsert_calls = sb.table.return_value.upsert.call_args_list
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1, "Expected at least one upsert with status='failed'"
    assert "Insufficient CSV history" in failed[0].args[0]["computation_error"]
    # WR-05 (19.1-REVIEW): csv_source provenance flag must survive the
    # insufficient-history failure path so the owner UI renders the
    # "CSV upload failed" pill, not the generic "missing data" copy.
    assert failed[0].args[0].get("data_quality_flags") == {"csv_source": True}


@pytest.mark.asyncio
async def test_csv_analytics_benchmark_unavailable() -> None:
    """Test 3 — benchmark fetch raises → runner still completes with
    data_quality_flags={csv_source=True, benchmark_unavailable=True,
    benchmark_note=...}."""
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(side_effect=Exception("benchmark down"))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result["status"] == "complete"
    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    flags = completed[0].args[0]["data_quality_flags"]
    assert flags.get("csv_source") is True
    assert flags.get("benchmark_unavailable") is True
    assert "benchmark_note" in flags


@pytest.mark.asyncio
async def test_mark_unrecoverable_logs_warning_before_reraise(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Test 4 — PR #273 / T-19.1-03 mitigation. When compute_all_metrics
    raises AND the failure-path _mark_unrecoverable upsert ALSO raises
    (simulating DB unreachable), the runner must log a logger.warning
    referencing strategy_id and the inner exception BEFORE re-raising
    the outer 500 HTTPException. Without this log evidence, a stuck
    'computing' row leaves operators blind.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    # WR-06 (19.1-REVIEW): route side-effects by the named callable
    # being dispatched, NOT by call-counter position. Counter-based
    # routing silently broke whenever the runner gained a new db_execute
    # call (e.g. the WR-01 strategy-existence probe) — the third call
    # would no longer be _mark_unrecoverable and the warning under test
    # would no longer fire. Naming the callable lets the test detect the
    # specific failing path regardless of how many db_execute calls
    # surround it.

    async def _side_effect_db_execute(fn):
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            # WR-02: _load_series now returns the rows list directly
            # (paginated_select contract), not a Supabase response wrapper.
            return rows
        if name == "_mark_unrecoverable":
            # Simulate DB unreachable on the failure-marker write — this
            # is the exact path PR #273's warning protects.
            raise RuntimeError("DB unreachable during mark_unrecoverable")
        # All other db_execute calls (strategy-existence probe,
        # _mark_computing, future helpers) succeed with a benign
        # response object whose .data is a truthy list.
        return MagicMock(data=[{"id": "test-strategy-uuid"}])

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.db_execute",
               side_effect=_side_effect_db_execute), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=RuntimeError("compute_all_metrics blew up")):
        caplog.set_level(logging.WARNING, logger="quantalyze.analytics.runner")
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    # Outer 500 must still re-raise.
    assert exc_info.value.status_code == 500
    assert "CSV analytics computation failed" in exc_info.value.detail

    # PR #273 regression assertion — the warning must fire before re-raise.
    warning_records = [
        r for r in caplog.records
        if r.levelno == logging.WARNING
        and "could not mark strategy" in r.getMessage()
    ]
    assert len(warning_records) == 1, (
        f"Expected exactly one 'could not mark strategy ... unrecoverable' "
        f"warning, got {len(warning_records)}. Records: "
        f"{[r.getMessage() for r in caplog.records]}"
    )
    msg = warning_records[0].getMessage()
    assert "test-strategy-uuid" in msg, (
        f"warning must reference strategy_id, got: {msg!r}"
    )
    assert "DB unreachable during mark_unrecoverable" in msg, (
        f"warning must reference the inner mark_unrecoverable exception, "
        f"got: {msg!r}"
    )


@pytest.mark.asyncio
async def test_csv_analytics_unrecoverable_stamps_csv_source_flag() -> None:
    """WR-05 (19.1-REVIEW). When the runner hits the catch-all
    exception path (compute_all_metrics raises) and successfully writes
    the _mark_unrecoverable row, the persisted row must carry
    data_quality_flags={'csv_source': True} so downstream consumers can
    still render the "CSV upload failed" provenance pill. Without the
    flag the owner UI falls back to generic "missing data" copy and
    the user loses the signal that this strategy came from a CSV
    upload (not an exchange-backed sync) in the first place.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.analytics_runner.compute_all_metrics",
               side_effect=RuntimeError("compute_all_metrics blew up")):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("test-strategy-uuid")

    assert exc_info.value.status_code == 500

    upsert_calls = sb.table.return_value.upsert.call_args_list
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1, (
        "Expected at least one failed upsert from _mark_unrecoverable"
    )
    # The LAST failed upsert is the _mark_unrecoverable write (there
    # is no insufficient-history write on this path).
    payload = failed[-1].args[0]
    assert payload.get("data_quality_flags") == {"csv_source": True}, (
        f"_mark_unrecoverable must stamp csv_source=True; got: "
        f"{payload.get('data_quality_flags')!r}"
    )
    assert payload["computation_error"] == "CSV analytics computation failed."


@pytest.mark.asyncio
async def test_csv_analytics_paginated_truncation_writes_specific_error() -> None:
    """WR-03 (19.1-REVIEW). When paginated_select raises
    PaginatedSelectTruncated during _load_series, the runner must:
      1. Persist a specific computation_error mentioning the row cap
         and the truncation hint (operator triage signal).
      2. Stamp data_quality_flags.csv_source=True so the provenance
         pill survives the failure (mirrors WR-05).
      3. Re-raise the typed exception so the worker dispatcher's
         classify_exception can tag it as permanent (no retry on a
         data-shape fault), rather than downgrading it to the catch-
         all "CSV analytics computation failed." 500 → indefinite retry.
    """
    from services.analytics_runner import (
        PaginatedSelectTruncated,
        run_csv_strategy_analytics,
    )

    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table
    table.upsert.return_value = MagicMock(execute=MagicMock())
    # Strategy probe must succeed so we reach _load_series.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    eq_chain.single.return_value.execute.return_value = MagicMock(
        data={"id": "trunc-strategy-uuid", "user_id": "u"}
    )
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    trunc = PaginatedSelectTruncated(
        page_count=1000, page_size=1000,
        hint="csv_daily_returns strategy_id=trunc-strategy-uuid",
    )

    async def _side_effect_db_execute(fn):
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            raise trunc
        # All other callables (strategy probe lambda, _mark_computing,
        # _mark_truncated) run for real against the supabase mock so
        # we can assert on the resulting upsert.
        return fn()

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.db_execute",
               side_effect=_side_effect_db_execute):
        with pytest.raises(PaginatedSelectTruncated):
            await run_csv_strategy_analytics("trunc-strategy-uuid")

    # _mark_truncated must have written a failed row with a specific
    # error mentioning the row cap + provenance flag.
    failed = [
        c for c in table.upsert.call_args_list
        if c.args[0].get("computation_status") == "failed"
    ]
    assert len(failed) == 1, (
        f"Expected exactly one failed upsert from _mark_truncated, "
        f"got {len(failed)}"
    )
    payload = failed[0].args[0]
    assert "1,000,000" in payload["computation_error"] or "1000000" in payload["computation_error"], (
        f"computation_error must cite the row cap; got: "
        f"{payload['computation_error']!r}"
    )
    assert payload["data_quality_flags"] == {"csv_source": True}, (
        f"WR-05 provenance flag must survive truncation; got: "
        f"{payload.get('data_quality_flags')!r}"
    )


@pytest.mark.asyncio
async def test_csv_analytics_missing_strategy_raises_404() -> None:
    """Test 6 — WR-01 (19.1-REVIEW). A strategy_id that does not exist in
    the `strategies` table must raise HTTPException(404) BEFORE the
    runner touches strategy_analytics. Without this probe, a deleted-
    between-enqueue-and-dispatch race would land a spurious
    strategy_analytics row and then fail with a misleading
    "Insufficient CSV history" 400.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    # Strategy probe path: .table("strategies").select(...).eq(...).single().execute()
    # returns data=None to simulate a missing strategy.
    select_chain = MagicMock()
    eq_chain = MagicMock()
    single_chain = MagicMock()
    single_chain.execute.return_value = MagicMock(data=None)
    eq_chain.single.return_value = single_chain
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain
    # Upsert chain — should never fire on the 404 path, but configure
    # it so an accidental call doesn't AttributeError and mask the bug.
    table.upsert.return_value = MagicMock(execute=MagicMock())

    with patch("services.analytics_runner.get_supabase", return_value=sb):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics("deleted-strategy-uuid")

    assert exc_info.value.status_code == 404
    assert "Strategy not found" in exc_info.value.detail
    # Spurious strategy_analytics upsert must NOT have been written —
    # the probe gates the entire pipeline.
    upsert_calls = table.upsert.call_args_list
    assert len(upsert_calls) == 0, (
        f"Missing strategy must not trigger any strategy_analytics upsert; "
        f"got {len(upsert_calls)} call(s)"
    )


@pytest.mark.asyncio
async def test_csv_analytics_sparse_calendar_completes() -> None:
    """Test 5 — 60 weekday-only rows skipping weekends complete without
    raising. compute_all_metrics is mocked because we are pinning the
    runner's gappy-series handling, not the underlying math."""
    from services.analytics_runner import run_csv_strategy_analytics

    # 60 weekdays (Mon-Fri), starting Mon 2024-01-01.
    dates = pd.bdate_range("2024-01-01", periods=60).strftime("%Y-%m-%d").tolist()
    rows = [
        {"date": d, "daily_return": (0.001 if i % 2 == 0 else -0.002)}
        for i, d in enumerate(dates)
    ]
    sb = _make_supabase_mock(rows)

    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(pd.Series([0.0005] * 60), False))), \
         patch("services.analytics_runner.compute_all_metrics",
               return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result["status"] == "complete"
    upsert_calls = sb.table.return_value.upsert.call_args_list
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    assert len(completed) >= 1, "Sparse-calendar series must complete cleanly"
