"""Phase 161.1 / plan 04 — a maintenance COMPOSITE refresh may not un-publish.

Why this file exists
--------------------
Plan 02 shipped the D-15 guard on ``_stamp_strategy_analytics_failed``, the
single-key derive path's terminal stamp. Plan 04 adds a SECOND recurring path —
``enqueue_ledger_composite_refresh`` enqueues ``stitch_composite`` — and that
handler has a terminal stamp of its OWN: the ``_stamp_failed`` closure inside
``run_stitch_composite_job``.

⛔ THE D-15 GUARD DOES NOT COVER IT. Measured at HEAD before this file was
written: that closure already does read-modify-write PRESERVATION on
``data_quality_flags`` (M-2, so a re-derive failure does not strip a live
coverage mask) and it never writes ``metrics_json_by_basis`` — but it DOES write
``computation_status='failed'`` and ``computation_warned=False``. Migration
20260825120000's own census records that every live ledger row is
``complete_with_warnings``, and ``src/lib/strategyGate.ts`` returns
``ANALYTICS_FAILED`` for a ``failed`` row. So that status flip is precisely the
un-publish D-15 exists to prevent, on a path plan 04 is about to make RECURRING.

The venue whose only live strategy IS a composite is the venue this whole arm was
built for. Without this guard, activating the composite schedule means one
terminal stitch failure — a ledger-completeness or valuation error arising from
new data, which is the realistic recurring failure mode — un-publishes that
account.

Why the status flip is right for the wizard and wrong here
----------------------------------------------------------
The closure's own docstring gives its reason: "Terminal 'failed' stamp so the
wizard poller reaches a gate instead of an infinite 'computing' spinner". That
reason is REAL and is not being overridden. A user-initiated stitch still flips
the status, loudly, exactly as before. A BACKGROUND maintenance refresh has no
wizard poller watching it — nobody is waiting on a gate — so the flip buys
nothing and costs a published factsheet. Keying the exemption on the fan-out's
job marker is therefore consistent with the existing design intent rather than a
change to it, and it is the same mechanism, spelled the same way, as D-15.

Fail-safe direction, NON-NEGOTIABLE
-----------------------------------
Anything unrecognised falls through to the LOUD destructive stamp: no metadata, a
non-dict metadata, a DIFFERENT source (including the single-key arm's marker), no
prior row, or a prior row that is not terminal-success. Never fail toward
suppression — a wrongly-suppressed failure hangs the wizard poller forever.

The failure is re-routed, not hidden. It still lands in ``compute_jobs`` (which
is what the composite arm's ATTEMPT cooldown reads), in ``computation_error``, in
the worker log, and in ``ledger_refresh_staleness`` — whose freshness key a failed
stitch cannot advance, so a persistently failing composite keeps reading STALE
rather than healthy.

Falsifiability
--------------
Tests 1-2 are the suppression arm and tests 3-6 are the loudness arm; each half
would pass trivially if the other half's branch were deleted, so both halves are
required and each was observed RED against the pre-guard code. The mandated
neutering — replace the marker comparison with ``if False`` so the destructive
stamp always fires — must redden tests 1 and 2 and leave 3-6 green.

Phase 164.6.7 adds a second neuter, for the live re-read (D-05). The job dict the
handler receives is the CLAIM-TIME snapshot, and a marker retracted after the
claim is visible only on the live ``compute_jobs`` row. Replace the awaited
``_refresh_marker_still_on_row(...)`` at the composite site with ``True`` and
``TestPostClaimRetractionTakesTheLoudPath``'s retracted, raising and no-row tests
go RED while its still-marked control and ``TestGuardSuppressesTheUnpublish`` stay
GREEN. ``_run`` seeds the live row EQUAL to the snapshot by default, so tests 1-8
mean exactly what they meant before: the live row still carries whatever the
snapshot carried.

Driver: a composite with ZERO members. It is the earliest permanent failure in
``run_stitch_composite_job`` and it routes straight through the closure under
test with no exchange I/O at all.
"""
from __future__ import annotations

from typing import Any

import pytest

from services.job_worker import DispatchOutcome, run_stitch_composite_job
from tests.test_stitch_composite_job import (
    _STRATEGY_ID,
    _apply,
    _deribit_patches,
    _LIVE_JOB_ABSENT,
    _FakeSupabase,
)

# The composite arm's contract, spelled here exactly as migration
# 20260825140000 spells it in `jsonb_build_object('source', …)`. Hand-typed on
# purpose: this test is one END of a cross-language contract with no compiler
# between the two, so importing it from anywhere would defeat the point. Gate 10h
# pins that it differs from the single-key arm's marker; the guard's own gate
# pins that this spelling matches the SQL one.
_COMPOSITE_MARKER = "ledger-refresh-composite"

# ⚠️ The SINGLE-KEY arm's marker. Present here as a NEGATIVE fixture (test 4):
# the two guards must not cross-fire on each other's jobs.
_SINGLE_KEY_MARKER = "ledger-refresh"

# The two columns the composite stamp writes that carry PUBLISH meaning. Neither
# may appear in a non-destructive payload. (`metrics_json_by_basis` is NOT in this
# list on purpose — measured at HEAD, the composite stamp never writes it, so
# listing it would be an assertion that passes for a reason unrelated to the
# guard.)
_PUBLISH_STATE_KEYS = ("computation_status", "computation_warned")


def _analytics_upserts(fake: _FakeSupabase) -> list[dict[str, Any]]:
    """Every payload upserted into ``strategy_analytics``, in write order."""
    return [
        payload
        for table, payload, _conflict in fake.upserts
        if table == "strategy_analytics" and isinstance(payload, dict)
    ]


# The id the claim returned. Not uuid-shaped on purpose: it never leaves the fake.
_JOB_ID = "job-composite-refresh-1"


class _FromSnapshot:
    """Sentinel: the live ``compute_jobs`` row carries the snapshot's metadata."""


_FROM_SNAPSHOT = _FromSnapshot()


async def _run(
    *,
    metadata: object,
    existing_status: str | None,
    existing_flags: dict[str, Any] | None = None,
    job_id: str = _JOB_ID,
    live_metadata: object = _FROM_SNAPSHOT,
) -> _FakeSupabase:
    """Drive the zero-member permanent failure through ``_stamp_failed``.

    ``metadata`` is the claim-time snapshot on the job dict. ``live_metadata`` is
    what the live ``compute_jobs`` row holds when the closure re-reads it; by
    default it equals the snapshot (a dict) or is absent (anything else)."""
    if isinstance(live_metadata, _FromSnapshot):
        live_metadata = metadata if isinstance(metadata, dict) else _LIVE_JOB_ABSENT
    fake = _FakeSupabase(
        members=[],
        existing_flags=existing_flags or {},
        existing_status=existing_status,
        live_job_metadata=live_metadata,
        live_job_id=job_id,
    )
    job: dict[str, Any] = {"id": job_id, "strategy_id": _STRATEGY_ID}
    if metadata is not _UNSET:
        job["metadata"] = metadata
    with _apply(_deribit_patches(fake, combine_returns=[], has_option_activity=False)):
        result = await run_stitch_composite_job(job)
    # The job OUTCOME is unchanged by the guard in every case. The guard narrows
    # what is WRITTEN to strategy_analytics; it never converts a permanent failure
    # into a success, which would be the failure mode that hides a broken venue.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    return fake


class _Unset:
    """Sentinel: the job dict carries no ``metadata`` key at all."""


_UNSET = _Unset()


class TestGuardSuppressesTheUnpublish:
    """A MARKED refresh landing on a terminal-SUCCESS row must not downgrade it."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["complete", "complete_with_warnings"])
    async def test_1_marked_refresh_on_a_live_row_writes_no_publish_state(
        self, status: str
    ) -> None:
        """⛔ BOTH success values, not just the common one. The PROD census reads
        `complete` 0 / `complete_with_warnings` 5, so a guard tested only against
        `complete` would be green while protecting none of the live accounts —
        which is the exact shape D-04 records."""
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER}, existing_status=status
        )
        payloads = _analytics_upserts(fake)
        assert payloads, (
            "the composite stamp wrote NOTHING to strategy_analytics. The guard "
            "re-routes the failure, it does not silence it: computation_error and "
            "the cleared reaper anchor must still land, or the wizard poller has "
            "no gate and the reaper has a stale anchor."
        )
        for payload in payloads:
            leaked = sorted(key for key in _PUBLISH_STATE_KEYS if key in payload)
            assert not leaked, (
                f"a MARKED composite refresh failure wrote {leaked} onto a row "
                f"whose computation_status was already {status!r}. That is the "
                "un-publish: src/lib/strategyGate.ts returns ANALYTICS_FAILED for "
                "a `failed` row, so a background maintenance job just took a "
                "funded account's factsheet down. Payload was: "
                f"{sorted(payload)}"
            )

    @pytest.mark.asyncio
    async def test_2_the_rerouted_failure_still_lands(self) -> None:
        """Suppressing the DOWNGRADE is not suppressing the FAILURE."""
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status="complete_with_warnings",
        )
        payloads = _analytics_upserts(fake)
        assert any("computation_error" in payload for payload in payloads), (
            "the non-destructive branch did not write computation_error. The "
            "failure must remain visible on the row; only the publish state is "
            "spared."
        )
        assert any(
            "computing_started_at" in payload and payload["computing_started_at"] is None
            for payload in payloads
        ), (
            "the non-destructive branch did not clear computing_started_at. That "
            "column is the stuck-row reaper's anchor (JOB-01) and carries no "
            "publish meaning — leaving it set would let a stale stamp re-trigger "
            "the reaper."
        )

    @pytest.mark.asyncio
    async def test_3_the_live_coverage_mask_is_still_preserved(self) -> None:
        """M-2's read-modify-write must survive the new branch.

        The closure already merged rather than overwrote ``data_quality_flags``,
        for a measured reason: writing them WHOLESALE drops the live coverage-mask
        keys, ``deriveSegmentMarkers`` then returns empty, and real gap days render
        with no missing-segment annotation. A guard that fixed the status flip and
        regressed that merge would trade one silent data-integrity bug for
        another."""
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status="complete_with_warnings",
            existing_flags={"per_key": {"k": 1}, "gap_day_count": 3},
        )
        payloads = [p for p in _analytics_upserts(fake) if "data_quality_flags" in p]
        assert payloads, "the non-destructive branch wrote no data_quality_flags at all"
        flags = payloads[-1]["data_quality_flags"]
        assert flags.get("per_key") == {"k": 1}, (
            "the live coverage mask key `per_key` was dropped by the "
            "non-destructive branch — M-2's read-modify-write regressed"
        )
        assert flags.get("gap_day_count") == 3, (
            "the live coverage mask key `gap_day_count` was dropped"
        )
        assert flags.get("composite") is True and flags.get("csv_source") is True, (
            "the two composite markers must still be merged OVER the existing flags"
        )


class TestGuardIsNotABlanketSuppression:
    """⛔ The fail-safe direction. Every one of these must take the LOUD path.

    Without this class the guard could be `if True:` and the suppression tests
    above would all still pass."""

    @pytest.mark.asyncio
    async def test_4_an_unmarked_job_still_stamps_failed(self) -> None:
        """A user-initiated stitch has no marker. The wizard poller IS watching
        it, and the closure's original reason for the flip applies in full."""
        fake = await _run(metadata=_UNSET, existing_status="complete_with_warnings")
        assert any(
            payload.get("computation_status") == "failed"
            for payload in _analytics_upserts(fake)
        ), (
            "an UNMARKED composite failure did not stamp failed. The guard must "
            "be keyed on the fan-out's marker, not applied to every failure: a "
            "wizard poller with no terminal gate spins forever."
        )

    @pytest.mark.asyncio
    async def test_5_a_non_dict_metadata_still_stamps_failed(self) -> None:
        """Fail-safe on a malformed payload, not a crash and not a suppression."""
        fake = await _run(metadata="not-a-dict", existing_status="complete")
        assert any(
            payload.get("computation_status") == "failed"
            for payload in _analytics_upserts(fake)
        ), "a non-dict metadata must take the LOUD path"

    @pytest.mark.asyncio
    async def test_6_the_single_key_arms_marker_does_not_cross_fire(self) -> None:
        """⛔ The two arms' markers are deliberately DIFFERENT strings, and this
        is the test that makes that matter rather than being decoration.

        A `stitch_composite` job can only be produced by the composite arm, so a
        job carrying the single-key marker did not come from the composite
        fan-out. Treating it as one would extend the exemption to a path nobody
        reasoned about."""
        fake = await _run(
            metadata={"source": _SINGLE_KEY_MARKER},
            existing_status="complete_with_warnings",
        )
        assert any(
            payload.get("computation_status") == "failed"
            for payload in _analytics_upserts(fake)
        ), (
            "a job carrying the SINGLE-KEY arm's marker was treated as a composite "
            "refresh. The guards must not cross-fire: each is scoped to the arm "
            "that writes its own token."
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["computing", "pending", "failed"])
    async def test_7_a_non_success_prior_status_still_stamps_failed(
        self, status: str
    ) -> None:
        """There is no publish state to protect on a row that was not
        terminal-success, so there is nothing the exemption would buy — and the
        wizard may well be watching a first compute."""
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER}, existing_status=status
        )
        assert any(
            payload.get("computation_status") == "failed"
            for payload in _analytics_upserts(fake)
        ), (
            f"a marked refresh on a row at status {status!r} did not stamp failed. "
            "The exemption is conditional on the row ALREADY being "
            "terminal-success; anything else takes the loud path."
        )

    @pytest.mark.asyncio
    async def test_8_a_first_compute_with_no_prior_row_still_stamps_failed(
        self,
    ) -> None:
        """The initial-compute case. Nothing to preserve, and the wizard is
        certainly watching."""
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER}, existing_status=None
        )
        assert any(
            payload.get("computation_status") == "failed"
            for payload in _analytics_upserts(fake)
        ), (
            "a marked refresh with NO prior analytics row did not stamp failed — "
            "this is a first compute and it must reach a terminal gate"
        )


class TestPostClaimRetractionTakesTheLoudPath:
    """Phase 164.6.7 / D-05: the composite run decides from the LIVE job row.

    The enqueue dedup can hand a user's resync THIS job after it was claimed,
    and the resync records that by retracting the marker on the row. The job
    dict in the handler is the claim-time copy and never sees that write, so a
    closure that trusts it keeps suppressing a failure somebody is now watching,
    while the SQL bridge reads the same row as unprotected. Each test here keeps
    the marker on the SNAPSHOT and varies only the live row: a test that removed
    the marker before the run would be green against the bug."""

    @pytest.mark.asyncio
    async def test_marker_retracted_after_claim_takes_the_loud_path(self) -> None:
        fake = await _run(
            metadata={"source": _COMPOSITE_MARKER},
            existing_status="complete_with_warnings",
            live_metadata={
                "refresh_marker_retracted": _COMPOSITE_MARKER,
                "correlation_id": "c",
            },
        )
        payloads = _analytics_upserts(fake)
        assert payloads, "the composite stamp wrote nothing to strategy_analytics"
        last = payloads[-1]
        assert last.get("computation_status") == "failed", (
            "a marker RETRACTED from the live job row after the claim was still "
            "honoured from the claim-time snapshot: the stamp wrote an error-only "
            f"payload {sorted(last)} while the SQL bridge reads the same job as "
            "unprotected. A user-initiated resync served by this job gets no "
            "terminal gate."
        )
        assert last.get("computation_warned") is False, (
            "the loud stamp must clear computation_warned, or a later bridge call "
            "can restore complete_with_warnings over a failed run"
        )
