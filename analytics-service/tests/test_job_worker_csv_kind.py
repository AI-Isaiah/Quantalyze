"""CSV → analytics pipeline Task 6. Tests for the new
compute_analytics_from_csv worker kind."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from services.job_worker import (
    run_compute_analytics_from_csv_job,
    TIMEOUT_PER_KIND,
    DispatchResult,
    DispatchOutcome,
)


@pytest.mark.asyncio
async def test_handler_delegates_to_runner_when_strategy_id_present():
    job = {"kind": "compute_analytics_from_csv", "strategy_id": "abc-123"}
    with patch("services.analytics_runner.run_csv_strategy_analytics",
               new=AsyncMock(return_value={"status": "complete"})) as mock_runner:
        result = await run_compute_analytics_from_csv_job(job)
    assert result.outcome == DispatchOutcome.DONE
    mock_runner.assert_called_once_with("abc-123")


@pytest.mark.asyncio
async def test_handler_returns_permanent_failure_when_strategy_id_missing():
    job = {"kind": "compute_analytics_from_csv"}
    result = await run_compute_analytics_from_csv_job(job)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "strategy_id" in result.error_message


def test_timeout_per_kind_includes_csv_kind():
    assert "compute_analytics_from_csv" in TIMEOUT_PER_KIND
    timeout = TIMEOUT_PER_KIND["compute_analytics_from_csv"]
    # Must be between 1 minute and 30 minutes (pure-math job, no exchange I/O)
    assert 60 <= timeout <= 1800
