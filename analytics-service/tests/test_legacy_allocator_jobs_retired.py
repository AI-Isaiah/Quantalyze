"""Phase 176 LEGACYRETIRE, plan 08 (D-04): both legacy allocator job kinds finish
as a no-op.

D-04 (CONTEXT): the legacy allocator equity curve is retired, so
``reconstruct_allocator_history`` and ``refresh_allocator_equity_daily`` stop
doing any work. ``dispatch`` routes both kinds to ONE stub,
``run_retired_allocator_equity_job``, which reads nothing, writes nothing and
returns DONE.

WHY the kinds stay registered. ``compute_jobs.kind`` references the
``compute_job_kinds`` registry, so a row of either kind can already be queued
(or enqueued by a straggler caller) at deploy time. The registry rows, the
``TIMEOUT_PER_KIND`` entries stay as inert machinery
until the final sweep.

WHY a stub and not an absent handler. An absent handler is the ``Unknown job
kind`` branch, which is a PERMANENT failure: every already-queued row would end
``failed_final`` and raise alert noise for work nobody wants. A DONE stub lets
that row finish quietly.

These tests drive the real ``dispatch``. ``get_supabase`` is patched to raise,
so any database access by the stub fails the test.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

import services.equity_reconstruction as er
import services.job_worker as jw
from services.job_worker import DispatchOutcome

ALLOCATOR_ID = "alloc-test"


def _no_database(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Patch ``get_supabase`` to a mock that fails the test if it is ever called."""
    guard = MagicMock(side_effect=AssertionError("a retired job kind touched the database"))
    monkeypatch.setattr(jw, "get_supabase", guard)
    return guard


@pytest.mark.asyncio
async def test_reconstruct_job_finishes_done_without_touching_the_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _no_database(monkeypatch)
    job = {"id": "job-retired-recon", "kind": "reconstruct_allocator_history", "allocator_id": ALLOCATOR_ID}

    result = await jw.dispatch(job)

    assert result.outcome == DispatchOutcome.DONE, result
    assert not result.error_message
    guard.assert_not_called()


@pytest.mark.asyncio
async def test_refresh_job_finishes_done_without_touching_the_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _no_database(monkeypatch)
    job = {"id": "job-retired-refresh", "kind": "refresh_allocator_equity_daily", "allocator_id": ALLOCATOR_ID}

    result = await jw.dispatch(job)

    assert result.outcome == DispatchOutcome.DONE, result
    assert not result.error_message
    guard.assert_not_called()


@pytest.mark.asyncio
async def test_the_stub_logs_only_the_kind_and_the_job_id(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    guard = _no_database(monkeypatch)
    job = {"id": "job-retired-log", "kind": "reconstruct_allocator_history", "allocator_id": ALLOCATOR_ID}

    # logger= pins the module logger's own level: an earlier test in a full run
    # can leave it above INFO, and the root-only form would then see no record.
    with caplog.at_level(logging.INFO, logger=jw.logger.name):
        result = await jw.run_retired_allocator_equity_job(job)

    assert result.outcome == DispatchOutcome.DONE, result
    guard.assert_not_called()
    records = [r for r in caplog.records if r.name == jw.logger.name]
    assert len(records) == 1, [r.getMessage() for r in records]
    record = records[0]
    assert record.levelno == logging.INFO
    message = record.getMessage()
    assert "reconstruct_allocator_history" in message
    assert "job-retired-log" in message
    assert ALLOCATOR_ID not in message, "the stub's log line carries the allocator id"


# ---------------------------------------------------------------------------
# Phase 176 PR 2 review fix round 1 (silent-failure 2): a forced rebuild is an
# operator's correction, so a retired stub must not report it DONE.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_force_rebuild_job_fails_permanent_and_warns_instead_of_reporting_done(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """``metadata.force_rebuild`` can only come from a manual or operator enqueue
    (the old forced-rebuild runbook). Ending it DONE with an info log made a
    correction look applied when nothing ran. It ends FAILED permanent, with a
    WARNING and a message that names the retirement. A plain queued row (no flag,
    or a falsy one) still ends DONE quietly."""
    guard = _no_database(monkeypatch)
    forced = {
        "id": "job-forced",
        "kind": "reconstruct_allocator_history",
        "allocator_id": ALLOCATOR_ID,
        "metadata": {"force_rebuild": True},
    }
    plain = {
        "id": "job-plain",
        "kind": "reconstruct_allocator_history",
        "allocator_id": ALLOCATOR_ID,
        "metadata": {"force_rebuild": False},
    }

    with caplog.at_level(logging.INFO, logger=jw.logger.name):
        forced_result = await jw.dispatch(forced)
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        plain_result = await jw.dispatch(plain)

    assert forced_result.outcome == DispatchOutcome.FAILED, forced_result
    assert forced_result.error_kind == "permanent"
    assert "retired" in (forced_result.error_message or "")
    assert any("job-forced" in r.getMessage() for r in warnings), [
        r.getMessage() for r in caplog.records
    ]
    assert plain_result.outcome == DispatchOutcome.DONE, plain_result
    guard.assert_not_called()


# ---------------------------------------------------------------------------
# Phase 176 plan 11 (D-02, D-04): the legacy writers are gone, the cap and
# marker helpers stay inert.
# ---------------------------------------------------------------------------

_RETIRED_WRITERS = (
    "persist_equity_snapshots",
    "_purge_allocator_equity_snapshots",
    "_allocator_has_equity_snapshots",
    "replace_equity_snapshots",
    "replace_equity_snapshots_window",
    "run_reconstruct_allocator_history_job",
    "run_refresh_allocator_equity_daily_job",
    "_owed_reconstructs_for_zero_snapshot_book",
)

_SURVIVORS_OTHER_MODULES_READ = (
    "EquityCurveBuilder",
    "read_marked_equity_usd",
    "read_okx_option_exposure",
)

_D04_INERT_HELPERS = (
    "_reconstruct_outcome_completes_the_key",
    "_mark_api_key_history_reconstructed",
    "_account_marker_key_ids",
    "_ACCOUNT_ZERO_CONTRIBUTION_VENUES",
    "_key_venue",
    "_api_key_already_reconstructed",
    "_RECONSTRUCT_IN_FLIGHT_STATUSES",
    "HISTORY_RECONSTRUCT_ATTEMPT_CAP",
    "_NON_RETRYABLE_SYNC_STATUSES",
    "_fanout_would_still_retry",
)


def test_the_legacy_writers_are_gone() -> None:
    """D-02: no Python code may write the legacy table or call either replace RPC.

    The two replace RPCs are dropped by the migration that follows, so a
    surviving caller would fail every run after it. The bodies of both retired
    job kinds and the bootstrap gate's Python twin go with the writers.
    """
    for name in _RETIRED_WRITERS:
        assert not hasattr(er, name), (
            f"{name} is back in services.equity_reconstruction: Phase 176 D-02 deleted the "
            "legacy allocator equity writers, both job bodies and the bootstrap twin"
        )
    for name in _SURVIVORS_OTHER_MODULES_READ:
        assert hasattr(er, name), (
            f"{name} was deleted from services.equity_reconstruction, but other production "
            "modules import it"
        )


def test_the_d04_inert_helpers_stay() -> None:
    """D-04: the cap and marker helpers outlive the reconstruct job, inert.

    They are deliberately left byte-identical and unused by the writers, and
    they are booked in TODOS.md under 176-RECONSTRUCT-CAP-MARKER-INERT. A later
    phase removes them as a set; deleting one here would break the cap and
    marker twins that still read them.
    """
    for name in _D04_INERT_HELPERS:
        assert hasattr(er, name), (
            f"{name} is missing from services.equity_reconstruction: D-04 keeps the cap and "
            "marker helpers inert (TODOS 176-RECONSTRUCT-CAP-MARKER-INERT)"
        )
