"""Phase 19.1 / CSV → analytics pipeline Plan 02 Task 3.

Tests for the new compute_analytics_from_csv worker kind. Re-derived
from PR #270 commit a244a9b6 under the GSD workflow.

Coverage:
  - TIMEOUT_PER_KIND has the new kind set to 10 minutes (600 seconds)
  - main_worker.WATCHDOG_PER_KIND_OVERRIDES has the new kind at 15
    minutes (strictly > the 10-min handler timeout)
  - run_compute_analytics_from_csv_job handler is exported and callable
  - handler delegates to run_csv_strategy_analytics with the strategy_id
  - missing strategy_id → DispatchResult(FAILED, error_kind='permanent')
  - existing watchdog-headroom invariant still holds after the wiring
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from services.job_worker import (
    DispatchOutcome,
    TIMEOUT_PER_KIND,
    run_compute_analytics_from_csv_job,
)


# ---------------------------------------------------------------------------
# Test 1 — TIMEOUT_PER_KIND has the new kind at 10 minutes.
# ---------------------------------------------------------------------------

def test_timeout_per_kind_includes_csv_kind_at_10_minutes() -> None:
    assert "compute_analytics_from_csv" in TIMEOUT_PER_KIND, (
        "compute_analytics_from_csv must be registered in TIMEOUT_PER_KIND "
        "so dispatch picks the per-kind timeout instead of the 5-minute fallback"
    )
    assert TIMEOUT_PER_KIND["compute_analytics_from_csv"] == 10 * 60, (
        f"compute_analytics_from_csv timeout must be 10 minutes (600s), "
        f"got {TIMEOUT_PER_KIND['compute_analytics_from_csv']}s"
    )


# ---------------------------------------------------------------------------
# Test 2 — WATCHDOG_PER_KIND_OVERRIDES has the new kind at 15 minutes.
# ---------------------------------------------------------------------------

def test_watchdog_per_kind_overrides_includes_csv_kind_at_15_minutes() -> None:
    from main_worker import WATCHDOG_PER_KIND_OVERRIDES

    assert "compute_analytics_from_csv" in WATCHDOG_PER_KIND_OVERRIDES, (
        "compute_analytics_from_csv must have an explicit watchdog override; "
        "the 10-minute handler timeout would equal the 10-minute default and "
        "the watchdog would reclaim still-running jobs"
    )
    assert WATCHDOG_PER_KIND_OVERRIDES["compute_analytics_from_csv"] == "15 minutes", (
        f"watchdog override must be '15 minutes', "
        f"got {WATCHDOG_PER_KIND_OVERRIDES['compute_analytics_from_csv']!r}"
    )


# ---------------------------------------------------------------------------
# Test 3 — handler is exported and callable.
# ---------------------------------------------------------------------------

def test_handler_is_callable() -> None:
    assert callable(run_compute_analytics_from_csv_job), (
        "run_compute_analytics_from_csv_job must be a callable exported from "
        "services.job_worker so the dispatch branch can bind to it"
    )


# ---------------------------------------------------------------------------
# Test 4 — handler delegates to run_csv_strategy_analytics with strategy_id.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_handler_delegates_to_runner_when_strategy_id_present() -> None:
    job = {"kind": "compute_analytics_from_csv", "strategy_id": "abc-123"}
    with patch(
        "services.analytics_runner.run_csv_strategy_analytics",
        new=AsyncMock(return_value={"status": "complete", "strategy_id": "abc-123"}),
    ) as mock_runner:
        result = await run_compute_analytics_from_csv_job(job)
    assert result.outcome == DispatchOutcome.DONE
    mock_runner.assert_called_once_with("abc-123")


# ---------------------------------------------------------------------------
# Test 5 — missing strategy_id → permanent FAILED.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_handler_returns_permanent_failure_when_strategy_id_missing() -> None:
    job = {"kind": "compute_analytics_from_csv"}
    result = await run_compute_analytics_from_csv_job(job)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "strategy_id" in result.error_message


# ---------------------------------------------------------------------------
# Test 6 — existing watchdog-headroom invariant still passes after the
# new entries land. The plan calls out this invariant specifically as
# the reason WATCHDOG_PER_KIND_OVERRIDES needed to be touched too:
# without the 15-min override the 10-min default would equal the 10-min
# handler timeout and the watchdog would reclaim still-running jobs.
# ---------------------------------------------------------------------------

def test_existing_watchdog_headroom_invariant_holds() -> None:
    """Mirror of tests/test_main_worker.py::TestWatchdogInvariant::
    test_every_kind_has_watchdog_headroom — re-asserted here so the
    new kind cannot silently regress the invariant if a future
    refactor lifts the override but forgets to lower the timeout."""
    from main_worker import WATCHDOG_PER_KIND_OVERRIDES

    DEFAULT_WATCHDOG_MINUTES = 10  # mirrors main_worker.watchdog_tick default

    def _parse_minutes(s: str) -> int:
        # All overrides in the project are "<N> minutes" form.
        parts = s.strip().split()
        return int(parts[0])

    for kind, handler_seconds in TIMEOUT_PER_KIND.items():
        handler_minutes = handler_seconds / 60
        override = WATCHDOG_PER_KIND_OVERRIDES.get(kind)
        watchdog_minutes = (
            _parse_minutes(override) if override else DEFAULT_WATCHDOG_MINUTES
        )
        assert watchdog_minutes > handler_minutes, (
            f"Kind {kind!r}: handler timeout {handler_minutes:.1f}m exceeds "
            f"watchdog threshold {watchdog_minutes}m. Add an entry to "
            f"WATCHDOG_PER_KIND_OVERRIDES greater than {handler_minutes:.1f} "
            "minutes — otherwise the watchdog reclaims still-running jobs."
        )
