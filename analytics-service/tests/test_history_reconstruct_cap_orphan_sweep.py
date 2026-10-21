"""Phase 167.1.2.1 RECONMARKER, silent-failure review F1: the D-09 capped-key
Sentry event must also fire for a reconstruct job that is TERMINALIZED OUTSIDE
``dispatch``.

``dispatch`` raises the event for every terminal attempt that returns through it.
The one terminal route that does not is the pg_cron sweep
``retention_compute_jobs_orphaned_running`` (hourly): a job whose worker died
holding the claim past the 4-hour window is flipped to ``failed_final`` with
``error_kind = 'orphaned'`` entirely in SQL, and no Python code runs for it. When
that job was a key's fifth attempt the key sits capped (attempts 5, marker NULL),
the fan-out never enqueues it again, and the only trace was a daily ``cron_runs``
row that nothing reads. The watchdog loop therefore sweeps recently orphan-
terminalized reconstruct jobs and runs the same capped check on each, once per
job.

Every test drives ``report_orphaned_capped_reconstructs`` against the in-memory
store the reconstruct tests use and asserts on the ``sentry_sdk`` calls. The
event is the same one ``dispatch`` raises (a static message; tags
``compute_job_id`` and ``history_reconstruct_outcome`` only).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from services import job_worker as jw
from services.equity_reconstruction import HISTORY_RECONSTRUCT_ATTEMPT_CAP
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    FakeSupabaseClient,
)

CAP = HISTORY_RECONSTRUCT_ATTEMPT_CAP
MARKED = "2026-09-01T00:00:00+00:00"


def _iso(hours_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()


def _fake() -> FakeSupabaseClient:
    fake = FakeSupabaseClient()
    jw._orphan_cap_reported.clear()
    return fake


def _key(fake: FakeSupabaseClient, key_id: str, *, marker: str | None, attempts: int) -> None:
    fake.store[("api_keys", (key_id,))] = {
        "id": key_id,
        "user_id": ALLOCATOR_ID,
        "history_reconstructed_at": marker,
        "history_reconstruct_attempts": attempts,
    }


def _job(
    fake: FakeSupabaseClient,
    job_id: str,
    key_id: str,
    *,
    status: str = "failed_final",
    error_kind: str | None = "orphaned",
    kind: str = "reconstruct_allocator_history",
    terminalized_hours_ago: float = 0.5,
) -> None:
    fake.store[("compute_jobs", (job_id,))] = {
        "id": job_id,
        "kind": kind,
        "api_key_id": key_id,
        "status": status,
        "error_kind": error_kind,
        "next_attempt_at": _iso(terminalized_hours_ago),
    }


async def _sweep(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient) -> Any:
    monkeypatch.setattr(jw, "get_supabase", lambda: fake)
    with patch("services.job_worker.sentry_sdk") as sentry:
        await jw.report_orphaned_capped_reconstructs()
    return sentry


def _tags(sentry: Any) -> dict[str, Any]:
    scope = sentry.new_scope.return_value.__enter__.return_value
    return {c.args[0]: c.args[1] for c in scope.set_tag.call_args_list}


@pytest.mark.asyncio
async def test_an_orphan_terminalized_fifth_attempt_raises_the_capped_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The review's scenario. The key's fifth reconstruct job was reaped by the
    orphan sweep (failed_final, orphaned). The key is capped and unmarked, so the
    same event ``dispatch`` raises fires, carrying the job id and nothing else.
    RED before the sweep exists: nothing ever raised for this job."""
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)

    sentry = await _sweep(monkeypatch, fake)

    assert sentry.capture_message.call_count == 1, sentry.mock_calls
    args, kwargs = sentry.capture_message.call_args
    assert args[0] == jw._HISTORY_RECONSTRUCT_CAPPED_MESSAGE
    assert kwargs.get("level") == "error"
    assert _tags(sentry) == {
        "compute_job_id": "orphan-1",
        "history_reconstruct_outcome": "capped",
    }
    for secret in (API_KEY_ID_1, ALLOCATOR_ID):
        assert secret not in args[0]
        assert all(secret not in str(v) for v in _tags(sentry).values())
    sentry.capture_exception.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    ["marked", "under_cap"],
)
async def test_an_orphan_terminalized_job_of_a_key_that_is_not_capped_and_owed_raises_nothing(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """Matched controls, each differing from the scenario above in one
    attribute: the key is marked, or it is one attempt under the cap (the fan-out
    will retry it). No event."""
    fake = _fake()
    if case == "marked":
        _key(fake, API_KEY_ID_1, marker=MARKED, attempts=CAP)
    else:
        _key(fake, API_KEY_ID_1, marker=None, attempts=CAP - 1)
    _job(fake, "orphan-1", API_KEY_ID_1)

    sentry = await _sweep(monkeypatch, fake)

    sentry.capture_message.assert_not_called()
    sentry.capture_exception.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "refresh_allocator_equity_daily"},
        {"status": "running"},
        {"status": "failed_final", "error_kind": "permanent"},
        {"terminalized_hours_ago": 5.0},
    ],
    ids=["other_kind", "not_terminal", "dispatch_classified_failure", "outside_lookback"],
)
async def test_only_a_recent_orphan_terminalized_reconstruct_is_swept(
    monkeypatch: pytest.MonkeyPatch, changes: dict[str, Any]
) -> None:
    """The sweep selects reconstruct jobs that are failed_final AND orphaned AND
    recent. A job that failed through ``dispatch`` already raised its own event
    there (and would double it here), a job of another kind is not this key's
    history, and an old orphan is outside the lookback. The key is capped and
    unmarked in every case, so only the selection can keep the event quiet."""
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "j-ctl", API_KEY_ID_1, **changes)

    sentry = await _sweep(monkeypatch, fake)

    sentry.capture_message.assert_not_called()


@pytest.mark.asyncio
async def test_a_job_is_reported_once_across_ticks_and_a_new_one_still_fires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The watchdog loop ticks every minute while the orphan stays inside the
    lookback. One job raises one event for the life of the process; a second
    capped key's orphan in a later tick still fires."""
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _key(fake, API_KEY_ID_2, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)

    first = await _sweep(monkeypatch, fake)
    again = await _sweep(monkeypatch, fake)
    _job(fake, "orphan-2", API_KEY_ID_2)
    later = await _sweep(monkeypatch, fake)

    assert first.capture_message.call_count == 1
    assert again.capture_message.call_count == 0, "the same orphan raised a second event"
    assert later.capture_message.call_count == 1
    assert _tags(later)["compute_job_id"] == "orphan-2"


class _FlakyKeyReads:
    """Wraps the in-memory client so the first ``failures`` reads of ``api_keys``
    raise, as a transient PostgREST/network failure would, while every other table
    (the sweep's own ``compute_jobs`` read) behaves normally."""

    def __init__(self, inner: FakeSupabaseClient, failures: int) -> None:
        self._inner = inner
        self.failures = failures

    def table(self, name: str) -> Any:
        if name == "api_keys" and self.failures > 0:
            self.failures -= 1
            raise RuntimeError("fixture: api_keys read failed")
        return self._inner.table(name)


@pytest.mark.asyncio
async def test_a_key_read_failure_on_one_tick_does_not_lose_the_capped_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Round-2 SFH R2-2. The cap check swallows its own key-read failure (it
    captures a bare exception and returns), so the sweep used to read that as
    'evaluated' and never looked at the job again: the fifth attempt's capped
    event was lost for the life of the process. A failed read is 'unknown', not a
    verdict, so the id stays unremembered and the next tick raises the event
    exactly once, and a third tick stays quiet."""
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)
    flaky = _FlakyKeyReads(fake, failures=1)
    monkeypatch.setattr(jw, "get_supabase", lambda: flaky)

    with patch("services.job_worker.sentry_sdk") as first:
        await jw.report_orphaned_capped_reconstructs()
    with patch("services.job_worker.sentry_sdk") as second:
        await jw.report_orphaned_capped_reconstructs()
    with patch("services.job_worker.sentry_sdk") as third:
        await jw.report_orphaned_capped_reconstructs()

    assert first.capture_exception.call_count == 1, first.mock_calls
    first.capture_message.assert_not_called()
    assert second.capture_message.call_count == 1, second.mock_calls
    assert _tags(second)["compute_job_id"] == "orphan-1"
    third.capture_message.assert_not_called()
    third.capture_exception.assert_not_called()


@pytest.mark.asyncio
async def test_a_raise_from_the_cap_check_leaves_the_orphan_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Round-2 SFH R2-2, outer-``except`` half. If the check itself raises, the
    sweep logs and moves on, but the id must not stay remembered: the next tick
    runs the check again and raises the event once."""
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)
    monkeypatch.setattr(jw, "get_supabase", lambda: fake)
    real = jw._capture_history_reconstruct_capped
    calls = 0

    async def _raises_once(job: dict[str, Any]) -> Any:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("fixture: cap check blew up")
        return await real(job)

    monkeypatch.setattr(jw, "_capture_history_reconstruct_capped", _raises_once)

    with patch("services.job_worker.sentry_sdk") as first:
        await jw.report_orphaned_capped_reconstructs()
    assert "orphan-1" not in jw._orphan_cap_reported
    with patch("services.job_worker.sentry_sdk") as second:
        await jw.report_orphaned_capped_reconstructs()
    with patch("services.job_worker.sentry_sdk") as third:
        await jw.report_orphaned_capped_reconstructs()

    first.capture_message.assert_not_called()
    assert second.capture_message.call_count == 1, second.mock_calls
    third.capture_message.assert_not_called()
    assert calls == 2


@pytest.mark.asyncio
async def test_a_failed_job_read_is_captured_and_never_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sweep runs inside the watchdog loop and must never take it down, and a
    failed read must not read as 'nothing to report': it is captured under the
    capped tags, the convention of ``_capture_history_reconstruct_capped``."""
    fake = _fake()

    class _Boom(Exception):
        pass

    def _raising() -> Any:
        raise _Boom("fixture: compute_jobs read failed")

    monkeypatch.setattr(jw, "get_supabase", _raising)
    with patch("services.job_worker.sentry_sdk") as sentry:
        await jw.report_orphaned_capped_reconstructs()

    assert sentry.capture_exception.call_count == 1
    assert isinstance(sentry.capture_exception.call_args.args[0], _Boom)
    sentry.capture_message.assert_not_called()
    assert _tags(sentry)["history_reconstruct_outcome"] == "capped"
    assert fake.store == {}


@pytest.mark.asyncio
async def test_the_watchdog_loop_runs_the_sweep_every_tick(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The sweep is only worth having if something calls it. ``watchdog_loop``
    runs it after each reclaim tick, and a failing sweep cannot stop the loop."""
    import asyncio

    import main_worker

    calls = 0
    shutdown = asyncio.Event()
    original_shutdown = main_worker.SHUTDOWN
    main_worker.SHUTDOWN = shutdown

    async def _tick() -> None:
        return None

    async def _sweep_fn() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("fixture: sweep blew up")
        shutdown.set()

    monkeypatch.setattr(main_worker, "watchdog_tick", _tick)
    monkeypatch.setattr(main_worker, "report_orphaned_capped_reconstructs", _sweep_fn)
    try:
        task = asyncio.create_task(main_worker.watchdog_loop(interval=0.01))
        done, pending = await asyncio.wait({task}, timeout=3.0)
        for p in pending:
            p.cancel()
    finally:
        main_worker.SHUTDOWN = original_shutdown

    assert task in done, "watchdog_loop hung"
    assert calls >= 2, f"the sweep ran {calls} time(s); a failing sweep stopped the loop"
    assert task.exception() is None


class _FlakyJobReads:
    """Like ``_FlakyKeyReads`` for the sweep's own ``compute_jobs`` read: the first
    ``failures`` reads raise an httpx ReadTimeout, as a slow PostgREST response does."""

    def __init__(self, inner: FakeSupabaseClient, failures: int) -> None:
        self._inner = inner
        self.failures = failures
        self.job_reads = 0

    def table(self, name: str) -> Any:
        if name == "compute_jobs":
            self.job_reads += 1
            if self.failures > 0:
                self.failures -= 1
                raise httpx.ReadTimeout("The read operation timed out")
        return self._inner.table(name)


def _zero_read_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.db.DB_READ_BACKOFF_BASE_S", 0.0)
    monkeypatch.setattr("services.db.DB_READ_JITTER_MAX_S", 0.0)


@pytest.mark.asyncio
async def test_orphan_sweep_read_timeout_is_retried_not_captured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """QUANTALYZE-2E (Phase 166.5.1, D-02a). A single slow compute_jobs read used to reach
    ``capture_exception`` and end the tick, so one transient timeout was an alert AND a
    skipped sweep. It must cost one retry: the capped event for the orphan still fires
    once, and nothing is captured as an exception."""
    _zero_read_backoff(monkeypatch)
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)
    flaky = _FlakyJobReads(fake, failures=1)
    monkeypatch.setattr(jw, "get_supabase", lambda: flaky)

    with patch("services.job_worker.sentry_sdk") as sentry:
        await jw.report_orphaned_capped_reconstructs()

    sentry.capture_exception.assert_not_called()
    assert sentry.capture_message.call_count == 1, sentry.mock_calls
    assert _tags(sentry)["compute_job_id"] == "orphan-1"
    assert flaky.job_reads == 2, "the compute_jobs read was retried exactly once"


@pytest.mark.asyncio
async def test_orphan_sweep_read_timeout_on_every_attempt_is_captured_once_and_remembers_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Exhaustion keeps today's disposition: an exhausted read stays loud (one
    ``capture_exception``, one log line), the function returns, and no job id is
    remembered, so the next tick evaluates the job again."""
    from services.db import DB_READ_MAX_RETRIES

    _zero_read_backoff(monkeypatch)
    fake = _fake()
    _key(fake, API_KEY_ID_1, marker=None, attempts=CAP)
    _job(fake, "orphan-1", API_KEY_ID_1)
    flaky = _FlakyJobReads(fake, failures=10)
    monkeypatch.setattr(jw, "get_supabase", lambda: flaky)

    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        with patch("services.job_worker.sentry_sdk") as sentry:
            await jw.report_orphaned_capped_reconstructs()

    assert sentry.capture_exception.call_count == 1, sentry.mock_calls
    assert isinstance(sentry.capture_exception.call_args.args[0], httpx.ReadTimeout)
    sentry.capture_message.assert_not_called()
    assert flaky.job_reads == DB_READ_MAX_RETRIES
    assert jw._orphan_cap_reported == set()
    assert any("orphan sweep: job read failed" in r.getMessage() for r in caplog.records)
