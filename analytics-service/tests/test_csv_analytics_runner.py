"""CSV → analytics pipeline Task 5. Tests for run_csv_strategy_analytics —
the runner the worker calls for source='csv' strategies."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import pandas as pd

from services.analytics_runner import run_csv_strategy_analytics


@pytest.fixture
def mock_supabase():
    """Mock Supabase client matching the get_supabase() shape used in
    analytics_runner.py."""
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table
    table.upsert.return_value = MagicMock(execute=MagicMock())
    table.select.return_value = MagicMock(
        eq=MagicMock(return_value=MagicMock(
            order=MagicMock(return_value=MagicMock(execute=MagicMock()))
        ))
    )
    sb.rpc.return_value = MagicMock(execute=MagicMock())
    return sb


@pytest.mark.asyncio
async def test_csv_analytics_happy_path(mock_supabase):
    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ] * 5  # 15 rows
    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase):
        # Make the SELECT return our rows
        mock_supabase.table().select().eq().order().execute.return_value = MagicMock(data=rows)
        with patch("services.analytics_runner.get_benchmark_returns",
                   new=AsyncMock(return_value=(pd.Series([0.001] * 15), False))):
            result = await run_csv_strategy_analytics("test-strategy-uuid")
    assert result["status"] == "complete"
    # Verify an upsert with computation_status='complete' happened
    upsert_calls = [c for c in mock_supabase.table.return_value.upsert.call_args_list]
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    assert len(completed) >= 1
    assert completed[0].args[0]["data_quality_flags"]["csv_source"] is True


@pytest.mark.asyncio
async def test_csv_analytics_insufficient_history(mock_supabase):
    rows = [{"date": "2024-01-01", "daily_return": 0.005}]  # 1 row
    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase):
        mock_supabase.table().select().eq().order().execute.return_value = MagicMock(data=rows)
        with pytest.raises(Exception):  # raises HTTPException
            await run_csv_strategy_analytics("test-strategy-uuid")
    # Verify a failed upsert with the right error message happened
    upsert_calls = [c for c in mock_supabase.table.return_value.upsert.call_args_list]
    failed = [c for c in upsert_calls if c.args[0].get("computation_status") == "failed"]
    assert len(failed) >= 1
    assert "Insufficient" in failed[0].args[0]["computation_error"]


@pytest.mark.asyncio
async def test_csv_analytics_benchmark_unavailable(mock_supabase):
    rows = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
    ] * 5
    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase):
        mock_supabase.table().select().eq().order().execute.return_value = MagicMock(data=rows)
        # benchmark fetch raises — runner must still complete with stale flag set
        with patch("services.analytics_runner.get_benchmark_returns",
                   new=AsyncMock(side_effect=Exception("benchmark down"))):
            result = await run_csv_strategy_analytics("test-strategy-uuid")
    assert result["status"] == "complete"
    upsert_calls = [c for c in mock_supabase.table.return_value.upsert.call_args_list]
    completed = [c for c in upsert_calls if c.args[0].get("computation_status") == "complete"]
    flags = completed[0].args[0]["data_quality_flags"]
    assert flags.get("benchmark_unavailable") is True
    assert flags.get("csv_source") is True
