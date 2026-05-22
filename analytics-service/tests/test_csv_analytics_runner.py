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
    in analytics_runner.py. The .table().select().eq().order().execute()
    chain returns ``rows`` on data."""
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
            # Return our rows so we get past the < 2 gate.
            return MagicMock(data=rows)
        if name == "_mark_unrecoverable":
            # Simulate DB unreachable on the failure-marker write — this
            # is the exact path PR #273's warning protects.
            raise RuntimeError("DB unreachable during mark_unrecoverable")
        # All other db_execute calls (strategy-existence probe,
        # _mark_computing, future helpers) succeed with no-op data.
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
