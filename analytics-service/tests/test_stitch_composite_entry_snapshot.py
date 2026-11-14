"""Phase 211 / D5 (TODOS ``161.1-D5``) — the composite ``_stamp_failed`` judges
D-15 protection from the ``computation_status`` captured at handler ENTRY.

``run_stitch_composite_job._stamp_failed`` used to read ``computation_status``
LIVE at stamp time, in the same select as M-2's flags merge. The SQL bridge
(``sync_strategy_analytics_status``) writes that column, so a sibling job's
bridge call mid-crawl could rewrite a ``complete`` row to ``computing`` and
disarm the guard (the F2 shape). The single-key derive closed the same hole in
Phase 161.1 by reading the status once before the crawl; the composite now does
the same, for a MARKED job only. The ``data_quality_flags`` read stays live.

Every test here drives the zero-member permanent failure through ``dispatch``
via ``_run``, the harness of ``test_ledger_refresh_composite_nondestructive``.
A marked job's FIRST ``strategy_analytics`` select is the entry read and its
SECOND is the stamp-time flags read, so ``existing_status_by_read`` models a
bridge call landing between them.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from services.job_worker import classify_exception
from tests.test_ledger_refresh_composite_nondestructive import (
    _COMPOSITE_MARKER,
    _JOB_ID,
    _PUBLISH_STATE_KEYS,
    _UNSET,
    _analytics_upserts,
    _run,
)


class TestCompositeStampJudgesTheEntryStatus:
    """The marked job's failure is judged against the entry status, in BOTH
    directions, whatever the live column reads by the time the stamp lands.

    Neuter N1 (recorded in the plan 02 SUMMARY): set ``existing_status`` from
    the live row's ``computation_status`` again and widen the stamp-time select
    back to both columns, keeping the entry read so the read count still
    matches. The protected case then writes the LOUD payload and the loud case
    writes the error-only payload, so both go RED on the payload shape."""

    @pytest.mark.asyncio
    async def test_f2_protected_direction_entry_complete_with_warnings(self) -> None:
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status=None,
            # Entry read answers terminal-success; a sibling bridge call then
            # moves the live column to ``computing`` before the stamp reads.
            existing_status_by_read=["complete_with_warnings", "computing"],
        )
        assert fake.analytics_reads == 2, (
            "a marked job reads strategy_analytics once at entry (the status "
            "snapshot) and once at stamp time (the live flags for M-2's merge); "
            f"saw {fake.analytics_reads}"
        )
        payloads = _analytics_upserts(fake)
        assert len(payloads) == 1, payloads
        (payload,) = payloads
        assert "computation_error" in payload, payload
        leaked = sorted(key for key in _PUBLISH_STATE_KEYS if key in payload)
        assert not leaked, (
            "the entry status was complete_with_warnings, so the failure must "
            "stay protected even though the live column moved after entry; the "
            f"stamp wrote publish state {leaked!r}: {payload!r}"
        )

    @pytest.mark.asyncio
    async def test_f2_loud_direction_entry_computing(self) -> None:
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status=None,
            # The fail-safe direction: a non-terminal entry status takes the
            # LOUD path even though the live row reads terminal-success now.
            existing_status_by_read=["computing", "complete_with_warnings"],
        )
        assert fake.analytics_reads == 2, fake.analytics_reads
        payloads = _analytics_upserts(fake)
        assert len(payloads) == 1, payloads
        (payload,) = payloads
        assert payload.get("computation_status") == "failed", (
            "the entry status was not terminal-success, so the stamp must be "
            f"the loud one regardless of the live column: {payload!r}"
        )
        assert payload.get("computation_warned") is False, payload


class TestCompositeEntryReadFailure:
    """A failed entry read is not an answer. It fails the job TRANSIENT before
    any crawl or write, is reported once, and a programming error propagates as
    itself so it is filed ``unknown``.

    Neuter N2 (recorded in the plan 02 SUMMARY): make the entry block's
    non-programming-error branch swallow the exception (log, capture, leave the
    snapshot None). The transient case then goes RED: the job is filed
    ``permanent`` and a loud stamp is written. Delete the programming-error
    re-raise and every parametrised case comes back ``transient``."""

    @pytest.mark.asyncio
    async def test_a_failed_entry_read_fails_transient_and_writes_nothing(
        self,
    ) -> None:
        log = MagicMock()
        sentry = MagicMock()
        results: list[Any] = []
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status="complete_with_warnings",
            analytics_read_raises=[RuntimeError("simulated entry read failure")],
            expect_error_kind="transient",
            log=log,
            sentry=sentry,
            results=results,
        )
        assert fake.analytics_reads == 1, (
            "the entry read failed, so the job must stop there; the stamp-time "
            f"read ran too ({fake.analytics_reads} reads)"
        )
        assert not _analytics_upserts(fake), (
            "a failed entry read still reached a strategy_analytics write; "
            "nothing is known about the row's status yet"
        )
        assert log.error.call_count == 1, log.error.call_args_list
        assert sentry.capture_exception.call_count == 1
        assert any(
            c.args and "pre-refresh status read" in str(c.args[0])
            for c in log.error.call_args_list
        ), f"the failed entry read did not go out at ERROR: {log.error.call_args_list!r}"
        (result,) = results
        assert "RuntimeError: simulated entry read failure" in (
            result.error_message or ""
        ), f"last_error does not name the failed read: {result.error_message!r}"
        sentry.new_scope.return_value.__enter__.return_value.set_tag.assert_any_call(
            "compute_job_id", _JOB_ID
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bug",
        [
            pytest.param(
                AttributeError("'SyncQueryRequestBuilder' object has no attribute 'x'"),
                id="attribute-error",
            ),
            pytest.param(
                TypeError("execute() got an unexpected keyword argument 'y'"),
                id="type-error",
            ),
            pytest.param(KeyError("computation_status"), id="key-error"),
            pytest.param(NameError("name '_undefined' is not defined"), id="name-error"),
        ],
    )
    async def test_a_programming_error_is_not_relabelled_transient(
        self, bug: BaseException
    ) -> None:
        log = MagicMock()
        sentry = MagicMock()
        results: list[Any] = []
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status="complete_with_warnings",
            analytics_read_raises=[bug],
            expect_error_kind="unknown",
            log=log,
            sentry=sentry,
            results=results,
        )
        assert fake.analytics_reads == 1, fake.analytics_reads
        assert not _analytics_upserts(fake)
        (result,) = results
        assert result.error_message == classify_exception(bug)[1], (
            "the programming error did not reach dispatch as itself: "
            f"{result.error_message!r}"
        )
        assert any(
            c.args
            and "programming error" in str(c.args[0])
            and any(type(bug).__name__ in str(a) for a in c.args)
            for c in log.error.call_args_list
        ), f"the programming error was not reported at ERROR: {log.error.call_args_list!r}"
        assert log.error.call_count == 1, log.error.call_args_list
        assert sentry.capture_exception.call_count == 1
        sentry.new_scope.return_value.__enter__.return_value.set_tag.assert_any_call(
            "compute_job_id", _JOB_ID
        )


class TestUnmarkedCompositeTakesNoEntryRead:
    """The entry read is gated on the composite marker, because only a marked
    job can be granted protection from it. An unmarked job (a user's stitch)
    pays no extra read and keeps today's LOUD path.

    Neuter N3 (recorded in the plan 02 SUMMARY): drop the marker check so every
    composite job takes the entry read. This case then goes RED on the read
    count (2, not 1)."""

    @pytest.mark.asyncio
    async def test_an_unmarked_job_reads_once_and_stamps_loud(self) -> None:
        fake = await _run(metadata=_UNSET, existing_status="complete_with_warnings")
        assert fake.analytics_reads == 1, (
            "an unmarked composite job issued an entry read; only the "
            f"stamp-time flags read is allowed ({fake.analytics_reads} reads)"
        )
        payloads = _analytics_upserts(fake)
        assert len(payloads) == 1, payloads
        assert payloads[0].get("computation_status") == "failed", payloads
