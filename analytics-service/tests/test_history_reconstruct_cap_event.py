"""Phase 167.1.2.1 RECONMARKER, plan 05 (D-09), retired by Phase 176 PR 2 review
fix round 1 (silent-failure 1 and 3).

D-09 raised a Sentry event from ``dispatch`` when a key ended a TERMINAL reconstruct
attempt still unmarked and at the attempt cap (``HISTORY_RECONSTRUCT_ATTEMPT_CAP``).
Since Phase 176 D-04 the ``reconstruct_allocator_history`` kind is the no-op stub
``run_retired_allocator_equity_job``: it can never stamp the marker, so a capped
key ends every such job "unmarked and capped", and the event ("could not be
rebuilt") would be a false alarm for work nobody wants. ``dispatch`` therefore no
longer runs the cap hook for the retired kind.

``_capture_history_reconstruct_capped`` itself is untouched (inert, D-04) and its
behaviour stays pinned by ``test_history_reconstruct_cap_orphan_sweep.py``. What
this file pins is the other half: a capped, unmarked key's retired job raises no
capped event through the real ``dispatch``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from services import job_worker as jw
from services.equity_reconstruction import HISTORY_RECONSTRUCT_ATTEMPT_CAP
from services.job_worker import DispatchOutcome
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    FakeSupabaseClient,
)

JOB_ID = "recon-job-1"
CAP = HISTORY_RECONSTRUCT_ATTEMPT_CAP


def test_the_cap_is_five() -> None:
    """D-09's number, hand-typed. The SQL and TypeScript twins are pinned equal
    to this by plan 07."""
    assert CAP == 5


def _capped_unmarked_key() -> FakeSupabaseClient:
    fake = FakeSupabaseClient()
    fake.store[("api_keys", (API_KEY_ID_1,))] = {
        "id": API_KEY_ID_1,
        "user_id": ALLOCATOR_ID,
        "history_reconstructed_at": None,
        "history_reconstruct_attempts": CAP,
    }
    return fake


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata, expected",
    [
        ({}, DispatchOutcome.DONE),
        ({"force_rebuild": True}, DispatchOutcome.FAILED),
    ],
    ids=["queued_row_done", "forced_row_failed_permanent"],
)
async def test_a_retired_reconstruct_job_for_a_capped_unmarked_key_raises_no_capped_event(
    monkeypatch: pytest.MonkeyPatch,
    metadata: dict[str, Any],
    expected: DispatchOutcome,
) -> None:
    """The real stub, a key at the cap with no marker, a terminal result either
    way: no ``capture_message``, no ``capture_exception``, no ``api_keys`` read."""
    fake = _capped_unmarked_key()
    reads: list[str] = []

    def _get_supabase() -> FakeSupabaseClient:
        reads.append("get_supabase")
        return fake

    monkeypatch.setattr(jw, "get_supabase", _get_supabase)
    job = {
        "id": JOB_ID,
        "kind": "reconstruct_allocator_history",
        "api_key_id": API_KEY_ID_1,
        "attempts": 1,
        "max_attempts": 3,
        "metadata": metadata,
    }

    with patch("services.job_worker.sentry_sdk") as sentry:
        result = await jw.dispatch(job)

    assert result.outcome == expected, result
    sentry.capture_message.assert_not_called()
    sentry.capture_exception.assert_not_called()
    assert reads == [], "dispatch read api_keys for a retired job kind"
