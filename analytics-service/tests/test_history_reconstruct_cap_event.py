"""Phase 167.1.2.1 RECONMARKER, plan 05 (D-09): the Sentry event a key raises when
it ends a TERMINAL reconstruct attempt still unmarked and at the attempt cap.

WHY an event and not a log line. The daily fan-out stops retrying a key after 5
attempts (``HISTORY_RECONSTRUCT_ATTEMPT_CAP``). Giving up must never be silent,
and SQL cannot raise a Sentry event, so ``dispatch`` does it after the handler
resolves. ``sentry_init.py`` keeps the SDK's default LoggingIntegration, whose
event level is ERROR: a WARNING is only a breadcrumb that reaches no one, so the
signal is an explicit ``capture_message`` at level ``error``.

Every test drives the real ``dispatch`` with the reconstruct handler patched to
return or raise, against the in-memory fake the reconstruct tests use, and
asserts on the ``sentry_sdk`` calls. Hygiene (T-167.1.2-22/32): a static message,
tags ``compute_job_id`` and ``history_reconstruct_outcome`` only, never a key id,
allocator id or USD figure.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from services import job_worker as jw
from services.equity_reconstruction import HISTORY_RECONSTRUCT_ATTEMPT_CAP
from services.job_worker import DispatchOutcome, DispatchResult
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    FakeSupabaseClient,
)

JOB_ID = "recon-job-1"
MARKED = "2026-09-01T00:00:00+00:00"


def _fake_with_key(*, marker: str | None, attempts: int) -> FakeSupabaseClient:
    fake = FakeSupabaseClient()
    fake.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1,
        "user_id": ALLOCATOR_ID,
        "history_reconstructed_at": marker,
        "history_reconstruct_attempts": attempts,
    }
    return fake


def _job(*, attempts: int = 1, max_attempts: int = 3) -> dict[str, Any]:
    return {
        "id": JOB_ID,
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
        "attempts": attempts,
        "max_attempts": max_attempts,
    }


async def _dispatch(
    monkeypatch: pytest.MonkeyPatch,
    fake: FakeSupabaseClient,
    job: dict[str, Any],
    *,
    returns: DispatchResult | None = None,
    raises: Exception | None = None,
) -> tuple[DispatchResult, Any]:
    """Drive ``dispatch`` with the reconstruct handler patched. Returns the
    result and the patched ``sentry_sdk`` module mock."""
    handler = AsyncMock(return_value=returns, side_effect=raises)
    monkeypatch.setattr(
        "services.equity_reconstruction.run_reconstruct_allocator_history_job", handler
    )
    monkeypatch.setattr(jw, "get_supabase", lambda: fake)
    with patch("services.job_worker.sentry_sdk") as sentry:
        result = await jw.dispatch(job)
    return result, sentry


def _tags(sentry: Any) -> dict[str, Any]:
    scope = sentry.new_scope.return_value.__enter__.return_value
    return {c.args[0]: c.args[1] for c in scope.set_tag.call_args_list}


def _assert_one_capped_event(sentry: Any) -> None:
    assert sentry.capture_message.call_count == 1, sentry.mock_calls
    args, kwargs = sentry.capture_message.call_args
    message = args[0]
    assert kwargs.get("level") == "error"
    for secret in (API_KEY_ID_1, ALLOCATOR_ID):
        assert secret not in message, "the event message carries an id"
    tags = _tags(sentry)
    assert tags == {
        "compute_job_id": JOB_ID,
        "history_reconstruct_outcome": "capped",
    }, tags
    assert all(
        API_KEY_ID_1 not in str(v) and ALLOCATOR_ID not in str(v) for v in tags.values()
    )
    sentry.capture_exception.assert_not_called()


def _failed(kind: str) -> DispatchResult:
    return DispatchResult(
        outcome=DispatchOutcome.FAILED, error_message="fixture", error_kind=kind
    )


DONE = DispatchResult(outcome=DispatchOutcome.DONE)
CAP = HISTORY_RECONSTRUCT_ATTEMPT_CAP


def test_the_cap_is_five() -> None:
    """D-09's number, hand-typed. The SQL and TypeScript twins are pinned equal
    to this by plan 07."""
    assert CAP == 5


@pytest.mark.asyncio
async def test_permanent_failure_of_a_capped_unmarked_key_raises_one_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 13: a permanent FAILED is final whatever the job's own attempts."""
    fake = _fake_with_key(marker=None, attempts=5)

    result, sentry = await _dispatch(monkeypatch, fake, _job(), returns=_failed("permanent"))

    assert result.outcome == DispatchOutcome.FAILED
    _assert_one_capped_event(sentry)


@pytest.mark.asyncio
async def test_transient_failure_on_the_jobs_last_attempt_raises_one_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 14: a transient FAILED on the job's last attempt becomes failed_final."""
    fake = _fake_with_key(marker=None, attempts=5)

    result, sentry = await _dispatch(
        monkeypatch, fake, _job(attempts=3, max_attempts=3), returns=_failed("transient")
    )

    assert result.outcome == DispatchOutcome.FAILED
    _assert_one_capped_event(sentry)


@pytest.mark.asyncio
async def test_transient_failure_with_job_attempts_left_raises_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 15: the job will retry, so this is not a terminal attempt."""
    fake = _fake_with_key(marker=None, attempts=5)

    _result, sentry = await _dispatch(
        monkeypatch, fake, _job(attempts=1, max_attempts=3), returns=_failed("transient")
    )

    sentry.capture_message.assert_not_called()
    sentry.capture_exception.assert_not_called()


@pytest.mark.asyncio
async def test_fifth_attempt_that_ends_as_a_done_noop_raises_one_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 16 (W5): D-15 leaves the marker NULL on a sole-key no-op, so a fifth
    attempt that ends DONE is still capped and owed. Without the DONE branch this
    key would stay unmarked, uncapped-looking and silent for ever."""
    fake = _fake_with_key(marker=None, attempts=5)

    result, sentry = await _dispatch(monkeypatch, fake, _job(), returns=DONE)

    assert result.outcome == DispatchOutcome.DONE
    _assert_one_capped_event(sentry)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "marker, attempts, outcome",
    [
        (None, 4, DONE),
        (MARKED, 5, DONE),
        (MARKED, 5, _failed("permanent")),
        (None, 5, DispatchResult(outcome=DispatchOutcome.DEFERRED)),
    ],
    ids=["attempts_4_done", "marked_done", "marked_final_failure", "deferred"],
)
async def test_under_cap_marked_or_deferred_raises_nothing(
    monkeypatch: pytest.MonkeyPatch,
    marker: str | None,
    attempts: int,
    outcome: DispatchResult,
) -> None:
    """Test 16b: one attempt short of the cap, a marked key, and a DEFERRED
    outcome each raise nothing."""
    fake = _fake_with_key(marker=marker, attempts=attempts)

    _result, sentry = await _dispatch(monkeypatch, fake, _job(), returns=outcome)

    sentry.capture_message.assert_not_called()
    sentry.capture_exception.assert_not_called()


@pytest.mark.asyncio
async def test_a_handler_that_raises_on_its_final_attempt_raises_one_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 17: the preflight-exception path. ``dispatch`` classifies a RAISE into
    FAILED, and the hook runs after that, so a key whose last attempt blew up in
    preflight is still reported."""
    fake = _fake_with_key(marker=None, attempts=5)

    result, sentry = await _dispatch(
        monkeypatch, fake, _job(attempts=3, max_attempts=3),
        raises=RuntimeError("fixture: preflight blew up"),
    )

    assert result.outcome == DispatchOutcome.FAILED
    _assert_one_capped_event(sentry)


@pytest.mark.asyncio
async def test_a_failed_key_read_is_captured_and_does_not_change_the_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 18: the check's own read raising is captured (``capture_exception``)
    under the same tags, and ``dispatch`` still returns the handler's result."""
    def _boom() -> Any:
        raise RuntimeError("fixture: api_keys read failed")

    monkeypatch.setattr(jw, "get_supabase", _boom)
    handler = AsyncMock(return_value=DONE)
    monkeypatch.setattr(
        "services.equity_reconstruction.run_reconstruct_allocator_history_job", handler
    )
    with patch("services.job_worker.sentry_sdk") as sentry:
        result = await jw.dispatch(_job())

    assert result is not None and result.outcome == DispatchOutcome.DONE
    assert sentry.capture_exception.call_count == 1, sentry.mock_calls
    sentry.capture_message.assert_not_called()
    assert _tags(sentry) == {
        "compute_job_id": JOB_ID,
        "history_reconstruct_outcome": "capped",
    }
