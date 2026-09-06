"""TODOS ``[PROV-WRITER-23514]`` — a provenance bug must cost the PROVENANCE,
never the failure record.

Migration ``20260906120000_computation_error_provenance.sql`` puts TWO CHECK
constraints on ``strategy_analytics``:

  * ``..._computation_error_source_check`` — the source column's domain is the
    single value ``'writer'`` (the T-164.2-11 tampering mitigation);
  * ``..._computation_error_markers_together_check`` —
    ``(source IS NULL) = (job_id IS NULL)``.

Both are correct and both are deliberate. But the statement they can reject is
the one that RECORDS A FAILURE. A writer bug — an unexpected source string, a
half-stamped pair — would make that upsert raise 23514 and the failure would not
be recorded AT ALL: no sentence, no status, nothing for the user or the
operator. The three-reviewer gate on plan 06 booked exactly this (silent-failure-
hunter F4), and it belongs to the writer, not to the migration.

Two mechanisms answer it, and this file proves both:

  1. **Structural** — :func:`services.strategy_analytics_provenance.provenance_source`
     derives the source FROM the job id, so a half-stamp is not expressible at a
     call site and the reachable 23514 arm is closed at the root. Pinned by
     :func:`test_provenance_source_is_all_or_nothing` here and by the AST shape
     rule in ``tests/test_computation_error_provenance_census.py``.
  2. **Runtime** — :func:`services.strategy_analytics_provenance.upsert_or_drop_provenance`
     catches a 23514 against a marker-bearing payload, drops both markers and
     re-issues ONCE. The degrade is to today's payload byte for byte: NULL
     markers, the bridge writes its per-kind generic. That is a loss of the
     curated sentence and nothing else.

The end-to-end tests drive the REAL ``run_csv_strategy_analytics`` into its
catch-all exit, which is where a lost write costs the most (the row is left
'computing' forever and the owner-side UI spins). Harness shape is lifted from
``tests/test_pgrst204_recovery_fallback.py`` — same runner, same S-8 routing by
dispatched callable ``__name__`` rather than by call-counter position.

⚠️ PAYLOADS ARE SNAPSHOTTED AT THE UPSERT CALL, not read back off
``call_args_list``. The fallback POPS the marker keys out of the very dict the
first call was made with, so the recorded first call would otherwise alias the
mutated dict and the test would read "no markers were ever sent" — vacuously
green, and green for the exact reason it is supposed to be red.

⚠️ Which test is the RED: :func:`test_marker_23514_still_records_the_failure`
is the one that fails without the runtime fallback (the APIError propagates out
of ``_mark_unrecoverable``, the caller's PR #273 warning swallows it, and no
terminal row lands). The narrowness and negative-control tests are green both
before and after by construction — they pin what the fallback must not disturb.
"""
from __future__ import annotations

import logging
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from services.strategy_analytics_provenance import (
    PROVENANCE_JOB_ID_KEY,
    PROVENANCE_SOURCE_KEY,
    PROVENANCE_SOURCE_WRITER,
    provenance_source,
    upsert_or_drop_provenance,
)

_STRATEGY_ID = "prov-23514-strategy-uuid"
_JOB_ID = "11111111-2222-3333-4444-555555555555"
_SENTENCE = "CSV analytics computation failed."

# Ten rows: enough to clear the runner's insufficient-history arm (< 2 rows) so
# the run reaches compute_all_metrics and therefore the catch-all except block.
_ROWS: list[dict[str, Any]] = [
    {"date": f"2024-01-{day:02d}", "daily_return": 0.001 * day} for day in range(1, 11)
]


def _check_violation() -> APIError:
    """The shape PostgREST forwards for a CHECK constraint refusal.

    ``code`` is PostgreSQL's own SQLSTATE — PostgREST passes it through
    untouched, which is why the helper matches on ``23514`` and not on one of
    the ``PGRST*`` codes.
    """
    return APIError(
        {
            "code": "23514",
            "message": (
                'new row for relation "strategy_analytics" violates check '
                'constraint "strategy_analytics_computation_error_markers_'
                'together_check"'
            ),
        }
    )


def _unrelated_check_violation() -> APIError:
    """A 23514 from a DIFFERENT CHECK on the SAME table (164.2-REVIEW WR-03).

    ``strategy_analytics`` carries other CHECK constraints and will gain more.
    One of them firing on a payload that happens to carry markers is not a
    provenance bug: stripping the markers neither fixes it (the re-issue raises
    the same violation) nor describes it (the helper's ERROR line names the
    marker pair, and that line is the ONLY operator signal this degrade emits).
    """
    return APIError(
        {
            "code": "23514",
            "message": (
                'new row for relation "strategy_analytics" violates check '
                'constraint "strategy_analytics_computation_status_check"'
            ),
        }
    )


def _marker_schema_cache_miss() -> APIError:
    """PostgREST while its cache predates migration ``20260906120000``.

    164.2-REVIEW WR-02, the deploy window T-164.2-17 names: the worker deploys
    before the DDL reaches PROD, PostgREST answers this and WRITES NOTHING, and
    the payload it drops is the one recording a failure. PostgREST names exactly
    ONE unknown column per response, which is what makes the column test in
    ``_refuses_a_marker`` a sound discriminator rather than a guess.
    """
    return APIError(
        {
            "code": "PGRST204",
            "message": (
                "Could not find the 'computation_error_source' column of "
                "'strategy_analytics' in the schema cache"
            ),
        }
    )


def _stamp_schema_cache_miss() -> APIError:
    """The SAME code naming a DIFFERENT column — ``computing_started_at``.

    This one belongs to ``analytics_runner._mark_unrecoverable``'s own D-02/R2
    arm and must reach it untouched. It is the reason the WR-02 arm keys on the
    column name and not on the code.
    """
    return APIError(
        {
            "code": "PGRST204",
            "message": (
                "Could not find the 'computing_started_at' column of "
                "'strategy_analytics' in the schema cache"
            ),
        }
    )


def _serialization_failure() -> APIError:
    """A DIFFERENT APIError — the fallback must not swallow this one."""
    return APIError({"code": "40001", "message": "preempted by watchdog reclaim"})


class _Harness(NamedTuple):
    sb: MagicMock
    table: MagicMock
    inside_target: list[bool]
    observed: list[BaseException]
    sent: list[dict[str, Any]]
    target: str
    series: list[dict[str, Any]]


def _build_harness(
    upsert_error: Exception | None,
    *,
    target: str = "_mark_unrecoverable",
    series: list[dict[str, Any]] | None = None,
) -> _Harness:
    """A supabase mock that refuses MARKER-BEARING payloads the way the CHECK does.

    ``upsert_error`` is raised only for writes issued from inside ``target``
    whose payload names a provenance marker. A payload without the markers
    succeeds — which is precisely why the fallback cannot pass by re-sending an
    identical payload.

    ``target`` and ``series`` exist for 164.2-REVIEW WR-02: the deploy-window
    degrade must be proven at a writer OTHER than P10, because P10 is the ONE
    site that already had a hand-written ``PGRST204`` arm and a test driving
    only P10 could not tell the helper's arm from that one. Passing
    ``target="_mark_failed"`` with a one-row series drives the runner's
    insufficient-history exit instead, which has no hand-written arm of any
    kind — it is one of the nine sites the review found uncovered.
    """
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    select_chain = MagicMock()
    eq_chain = MagicMock()
    eq_chain.single.return_value.execute.return_value = MagicMock(
        data={"id": _STRATEGY_ID, "user_id": "u", "api_key_id": None}
    )
    eq_chain.maybe_single.return_value.execute.return_value = MagicMock(
        data={"data_quality_flags": {"negative_nav_guard": True}}
    )
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    inside_target: list[bool] = []
    sent: list[dict[str, Any]] = []

    def _upsert(payload: dict[str, Any], **_kwargs: Any) -> MagicMock:
        # SNAPSHOT. The fallback mutates this dict in place; see the module
        # docstring for why reading it back later would be vacuous.
        sent.append(dict(payload))
        chain = MagicMock()
        carries_marker = (
            PROVENANCE_SOURCE_KEY in payload or PROVENANCE_JOB_ID_KEY in payload
        )
        if upsert_error is not None and inside_target and carries_marker:
            chain.execute.side_effect = upsert_error
        else:
            chain.execute.return_value = MagicMock(data=[payload])
        return chain

    table.upsert.side_effect = _upsert
    return _Harness(
        sb, table, inside_target, [], sent, target, _ROWS if series is None else series
    )


def _db_execute_router(harness: _Harness) -> Any:
    """PATTERNS S-8: route by dispatched callable name, run the real callable."""

    async def _side_effect(fn: Any) -> Any:
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            return harness.series
        if name == harness.target:
            harness.inside_target.append(True)
            try:
                return fn()
            except BaseException as exc:  # noqa: BLE001 — recorded, then re-raised
                harness.observed.append(exc)
                raise
            finally:
                harness.inside_target.pop()
        return fn()

    return _side_effect


async def _run(harness: _Harness, *, job_id: str | None) -> HTTPException:
    """Drive the CSV runner into its catch-all failure arm; return the 500."""
    from services.analytics_runner import run_csv_strategy_analytics

    with patch("services.analytics_runner.get_supabase", return_value=harness.sb), \
         patch("services.analytics_runner.db_execute",
               side_effect=_db_execute_router(harness)), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.basis_series.persist_basis_series", new=MagicMock()), \
         patch("services.basis_series.compute_all_metrics",
               side_effect=RuntimeError("compute_all_metrics blew up")):
        with pytest.raises(HTTPException) as exc_info:
            await run_csv_strategy_analytics(_STRATEGY_ID, job_id=job_id)
    return exc_info.value


def _terminal_writes(harness: _Harness) -> list[dict[str, Any]]:
    return [p for p in harness.sent if p.get("computation_status") == "failed"]


# ---------------------------------------------------------------------------
# 1. Structural — the pair is decided by ONE expression
# ---------------------------------------------------------------------------


def test_provenance_source_is_all_or_nothing() -> None:
    """A job id yields ``'writer'``; no job id yields ``None``, never a lone source.

    This is the whole reason the source is a call and not a typed literal. The
    pairing CHECK sits on the failure-recording path, and
    ``run_csv_strategy_analytics``'s ``job_id`` DEFAULTS to None for its three
    non-job callers — so ``"computation_error_source": "writer"`` typed beside
    ``"computation_error_job_id": job_id`` would emit ``('writer', NULL)`` on
    every one of those calls and lose the failure record to a 23514.
    """
    assert provenance_source(_JOB_ID) == PROVENANCE_SOURCE_WRITER
    assert provenance_source(None) is None


def test_source_constant_matches_the_only_value_the_check_admits() -> None:
    """``strategy_analytics_computation_error_source_check`` admits exactly one
    value, and the bridge's CASE arms compare against that same string literal
    (migration ``20260906120000``). Drift here is a 23514 on the failure path,
    or — worse — a marker the bridge never honours.
    """
    assert PROVENANCE_SOURCE_WRITER == "writer"
    assert PROVENANCE_SOURCE_KEY == "computation_error_source"
    assert PROVENANCE_JOB_ID_KEY == "computation_error_job_id"


# ---------------------------------------------------------------------------
# 2. Runtime — the helper in isolation
# ---------------------------------------------------------------------------


def test_helper_drops_markers_and_reissues_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        "computation_error": _SENTENCE,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    seen: list[dict[str, Any]] = []

    def _write() -> None:
        seen.append(dict(payload))
        if PROVENANCE_SOURCE_KEY in payload:
            raise _check_violation()

    caplog.set_level(logging.ERROR, logger="services.strategy_analytics_provenance")
    upsert_or_drop_provenance(payload, _write, where="unit")

    assert len(seen) == 2, f"expected one refusal then one re-issue, got {seen!r}"
    assert seen[0][PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER
    assert PROVENANCE_SOURCE_KEY not in seen[1]
    assert PROVENANCE_JOB_ID_KEY not in seen[1]
    assert seen[1]["computation_error"] == _SENTENCE, (
        "the failure record is the thing being saved — dropping the sentence "
        "alongside the markers would defeat the entire point"
    )
    assert [r for r in caplog.records if r.levelno == logging.ERROR], (
        "the degrade must be LOUD: its user-visible effect is indistinguishable "
        "from the pre-164.2 world, so the log line is the only bug report"
    )


def test_helper_reraises_a_23514_on_a_payload_with_no_markers() -> None:
    """A different CHECK on this table is NOT ours to swallow, and re-issuing an
    identical payload would be a no-op dressed as a recovery."""
    payload: dict[str, Any] = {"strategy_id": _STRATEGY_ID, "computation_error": _SENTENCE}
    calls: list[int] = []

    def _write() -> None:
        calls.append(1)
        raise _check_violation()

    with pytest.raises(APIError):
        upsert_or_drop_provenance(payload, _write, where="unit")
    assert len(calls) == 1


def test_helper_reraises_a_23514_naming_a_different_constraint(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """NEGATIVE CONTROL for 164.2-REVIEW WR-03. The SQLSTATE alone must not be
    read as "the database refused MY markers".

    The payload here DOES carry markers, so the marker-free guard above cannot
    stand in for this: only the constraint-name test can keep the helper's
    hands off a status CHECK. Three things are asserted, and each one is a
    separate way the old SQLSTATE-only arm was wrong: the error propagates, the
    payload keeps its provenance, and — the one the review cared about — NO
    ERROR line is logged blaming the marker pair for someone else's constraint.
    """
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        "computation_error": _SENTENCE,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    boom = _unrelated_check_violation()
    calls: list[int] = []

    def _write() -> None:
        calls.append(1)
        raise boom

    caplog.set_level(logging.ERROR, logger="services.strategy_analytics_provenance")
    with pytest.raises(APIError) as exc_info:
        upsert_or_drop_provenance(payload, _write, where="unit")

    assert exc_info.value is boom
    assert len(calls) == 1, (
        "a foreign CHECK must not buy a second round trip on the failure path; "
        f"got {len(calls)} attempt(s)"
    )
    assert payload[PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER
    assert payload[PROVENANCE_JOB_ID_KEY] == _JOB_ID
    assert not [r for r in caplog.records if r.levelno == logging.ERROR], (
        "the helper logged a provenance bug report for a constraint it does not "
        "own — that line is the only place a REAL marker refusal becomes "
        "visible, so a false one sends the next operator after the wrong "
        "constraint (164.2-REVIEW WR-03)"
    )


def test_helper_drops_markers_on_a_pgrst204_naming_a_marker_column(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """164.2-REVIEW WR-02. The deploy-window degrade, in the helper that already
    sits at every stamped site.

    Without it a schema-cache miss on the two new columns loses the whole
    failure record — PostgREST writes NOTHING — and the row is stranded at
    'computing' until the 16-hour reaper while the wizard poller spins.
    """
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        "computation_status": "failed",
        "computation_error": _SENTENCE,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    seen: list[dict[str, Any]] = []

    def _write() -> None:
        seen.append(dict(payload))
        if PROVENANCE_SOURCE_KEY in payload:
            raise _marker_schema_cache_miss()

    caplog.set_level(logging.ERROR, logger="services.strategy_analytics_provenance")
    upsert_or_drop_provenance(payload, _write, where="unit")

    assert len(seen) == 2, f"expected one miss then one re-issue, got {seen!r}"
    assert PROVENANCE_SOURCE_KEY not in seen[1]
    assert PROVENANCE_JOB_ID_KEY not in seen[1]
    assert seen[1]["computation_error"] == _SENTENCE, (
        "the failure record is the thing being saved; the deploy window must "
        "cost the provenance and nothing else"
    )
    assert seen[1]["computation_status"] == "failed"
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert errors, "the degrade is invisible to users, so the log is the signal"
    assert "PGRST204" in errors[0].getMessage(), (
        "the log must name the code it actually saw. A 23514 is a writer bug to "
        "chase and a PGRST204 is a deploy window that closes itself — reporting "
        "one as the other is the WR-03 misdiagnosis in a new place"
    )


def test_helper_reraises_a_pgrst204_naming_a_different_column() -> None:
    """NARROWNESS for WR-02, and the guard on P10's own arm.

    ``analytics_runner._mark_unrecoverable`` owns the ``computing_started_at``
    schema-cache miss (D-02/R2) and re-issues the five-key payload PostgREST
    knew before that column existed. If this helper swallowed every PGRST204 it
    would strip the markers, re-issue a payload that STILL names the unknown
    column, and hand that handler a second identical miss — one wasted write on
    the failure path and a log line blaming the wrong columns.
    """
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        "computing_started_at": None,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    boom = _stamp_schema_cache_miss()
    calls: list[int] = []

    def _write() -> None:
        calls.append(1)
        raise boom

    with pytest.raises(APIError) as exc_info:
        upsert_or_drop_provenance(payload, _write, where="unit")

    assert exc_info.value is boom
    assert len(calls) == 1
    assert payload[PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER, (
        "a miss on someone else's column must leave the provenance alone"
    )


def test_helper_reraises_a_non_23514_api_error() -> None:
    """Load-bearing at the runner's catch-all exit: its enclosing handler owns
    ``PGRST204`` (the deploy-window schema-cache miss) and must keep seeing it."""
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    boom = _serialization_failure()

    def _write() -> None:
        raise boom

    with pytest.raises(APIError) as exc_info:
        upsert_or_drop_provenance(payload, _write, where="unit")
    assert exc_info.value is boom
    assert payload[PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER, (
        "a non-23514 must leave the payload untouched; stripping provenance for "
        "an unrelated failure would silently degrade every retry after it"
    )


def test_helper_lets_a_failing_reissue_propagate() -> None:
    """No infinite retry, and no swallowed second failure. One extra attempt."""
    payload: dict[str, Any] = {
        "strategy_id": _STRATEGY_ID,
        PROVENANCE_SOURCE_KEY: PROVENANCE_SOURCE_WRITER,
        PROVENANCE_JOB_ID_KEY: _JOB_ID,
    }
    calls: list[int] = []

    def _write() -> None:
        calls.append(1)
        raise _check_violation()

    with pytest.raises(APIError):
        upsert_or_drop_provenance(payload, _write, where="unit")
    assert len(calls) == 2, f"expected exactly two attempts, got {len(calls)}"


# ---------------------------------------------------------------------------
# 3. End-to-end through the real runner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pgrst204_marker_miss_records_the_failure_at_a_non_p10_writer() -> None:
    """164.2-REVIEW WR-02, END TO END, at one of the NINE sites that had no
    deploy-window arm of their own.

    The review's finding was not "PGRST204 is unhandled" — P10 handled it — but
    that P10 was the ONLY one of ten stamped writers that did, while the phase
    dispositioned T-164.2-17 as mitigated. So this test deliberately drives
    ``_mark_failed`` (the insufficient-history exit, reached with a one-row
    series), NOT ``_mark_unrecoverable``: it has no hand-written PGRST204 arm,
    so the only thing that can land the failure record here is the helper.

    Without the helper's arm the APIError leaves ``_mark_failed``, propagates
    out of ``run_csv_strategy_analytics`` as itself rather than as the runner's
    400, and NOTHING lands — the row keeps whatever ``_mark_computing`` left.
    """
    harness = _build_harness(
        _marker_schema_cache_miss(), target="_mark_failed", series=_ROWS[:1]
    )

    exc = await _run(harness, job_id=_JOB_ID)
    assert exc.status_code == 400, (
        "the runner's own insufficient-history exit must still be the outcome; a "
        "500 here means the miss escaped and this test is measuring the wrong arm"
    )

    writes = _terminal_writes(harness)
    assert len(writes) == 2, (
        "expected the refused stamped write followed by the marker-free "
        f"re-issue; got {len(writes)}: {writes!r}"
    )
    refused, fallback = writes
    assert refused[PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER, (
        "the first attempt must be the STAMPED payload — if it already omits "
        "the markers the injection never fired and this test is vacuous"
    )
    assert refused[PROVENANCE_JOB_ID_KEY] == _JOB_ID
    assert PROVENANCE_SOURCE_KEY not in fallback
    assert PROVENANCE_JOB_ID_KEY not in fallback
    assert (
        fallback["computation_error"]
        == "Insufficient CSV history. At least 2 data points required."
    ), (
        "the curated sentence is what the deploy window may cost; the FAILURE "
        "RECORD is not"
    )
    assert fallback["computation_status"] == "failed"
    assert fallback["computing_started_at"] is None, (
        "JOB-01 still applies on the degraded path"
    )
    assert harness.observed == [], (
        "the helper absorbed the miss, so nothing should have escaped _mark_failed"
    )


@pytest.mark.asyncio
async def test_marker_23514_still_records_the_failure() -> None:
    """THE RED. Without the fallback the APIError leaves ``_mark_unrecoverable``,
    the caller's PR #273 warning swallows it, NOTHING lands, and the row is
    stranded in 'computing' — a permanent spinner caused by a provenance bug.
    """
    harness = _build_harness(_check_violation())

    exc = await _run(harness, job_id=_JOB_ID)
    assert exc.status_code == 500

    writes = _terminal_writes(harness)
    assert len(writes) == 2, (
        "expected the refused write followed by the marker-free re-issue; got "
        f"{len(writes)} terminal write(s): {writes!r}"
    )
    refused, fallback = writes
    assert refused[PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER, (
        "the first attempt must be the STAMPED payload — if it already omits "
        "the markers the injection never fired and this test is vacuous"
    )
    assert refused[PROVENANCE_JOB_ID_KEY] == _JOB_ID
    assert PROVENANCE_SOURCE_KEY not in fallback
    assert PROVENANCE_JOB_ID_KEY not in fallback
    assert fallback["computation_status"] == "failed"
    assert fallback["computation_error"] == _SENTENCE
    assert fallback["computing_started_at"] is None, (
        "JOB-01 still applies on the degraded path: a stale stamp on a terminal "
        "row can re-trigger the reaper"
    )
    assert fallback["data_quality_flags"] == {
        "negative_nav_guard": True,
        "csv_source": True,
    }, "the READ-MODIFY-WRITE flags must survive the degrade"
    assert harness.observed == [], (
        "the fallback absorbed the refusal, so nothing should have escaped "
        "_mark_unrecoverable"
    )


@pytest.mark.asyncio
async def test_non_23514_is_not_answered_by_dropping_provenance(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Narrowness. A 40001 must not be masked behind a silently degraded payload."""
    boom = _serialization_failure()
    harness = _build_harness(boom)

    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.runner")
    exc = await _run(harness, job_id=_JOB_ID)
    assert exc.status_code == 500

    assert harness.observed == [boom]
    writes = _terminal_writes(harness)
    assert len(writes) == 1, (
        "a non-23514 must NOT trigger the marker-stripping re-issue; got "
        f"{writes!r}"
    )
    assert writes[0][PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER
    assert [
        r for r in caplog.records if "could not mark strategy" in r.getMessage()
    ], "the caller's PR #273 warning is the only operator signal left"


@pytest.mark.asyncio
async def test_stamped_terminal_write_on_the_normal_path() -> None:
    """Negative control, and the criterion-2 assertion itself: on the ordinary
    path the terminal failure carries BOTH markers, in ONE write, naming the job
    the sentence describes. The fallback is unreachable here.
    """
    harness = _build_harness(None)

    exc = await _run(harness, job_id=_JOB_ID)
    assert exc.status_code == 500

    writes = _terminal_writes(harness)
    assert len(writes) == 1, f"expected exactly one terminal write, got {writes!r}"
    assert writes[0][PROVENANCE_SOURCE_KEY] == PROVENANCE_SOURCE_WRITER
    assert writes[0][PROVENANCE_JOB_ID_KEY] == _JOB_ID
    assert writes[0]["computation_error"] == _SENTENCE, (
        "the marker and the sentence must be in the SAME statement — a marker "
        "written separately is dropped by the BEFORE UPDATE trigger "
        "strategy_analytics_drop_stale_error_provenance"
    )


@pytest.mark.asyncio
async def test_no_job_id_writes_both_markers_null() -> None:
    """The three non-job callers. NULL markers are BRIDGE-OR-LEGACY provenance —
    the pre-164.2 behaviour, and the correct answer for a failure no job owns.
    A lone ``'writer'`` here would be a 23514 and a lost failure record.
    """
    harness = _build_harness(None)

    exc = await _run(harness, job_id=None)
    assert exc.status_code == 500

    writes = _terminal_writes(harness)
    assert len(writes) == 1
    assert writes[0][PROVENANCE_SOURCE_KEY] is None
    assert writes[0][PROVENANCE_JOB_ID_KEY] is None
