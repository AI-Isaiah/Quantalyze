"""D-02 / R2 — a schema-cache miss must not cost the terminal 'failed' stamp.

``analytics_runner._mark_unrecoverable`` is the catch-all exit writer for the CSV
analytics path: every other failure arm in that runner reaches it. Its payload
carries ``computing_started_at``, a column added by migration ``20260802120000``.
During the deploy window between "the code that writes the column is live" and
"PostgREST has reloaded its schema cache", PostgREST answers any payload naming
that column with code ``PGRST204`` and writes NOTHING.

The consequence is not a lost error message — it is a PERMANENT SPINNER. The job
already failed; the one write that would have moved the row out of ``computing``
is the write that gets rejected. The row stays ``computing`` with a stale stamp,
the owner-side UI spins, and the reaper cannot rescue it inside its threshold.

So the recovery write must survive its own recovery. On ``PGRST204`` the runner
re-issues the SAME terminal payload minus the unknown key; the row lands
``failed`` and the strategy degrades normally instead of hanging.

Three tests, and the second and third are the ones that keep the first honest:

  1. the fallback works — the terminal ``failed`` lands, without the unknown key;
  2. the arm is NARROW — a non-PGRST204 ``APIError`` is re-raised unchanged, so a
     serialization failure or a permission denial still surfaces;
  3. negative control — with no error injected exactly ONE terminal write happens
     and it still clears the stamp to ``None``. The fallback must be unreachable
     on the normal path.

⚠️ Tests 2 and 3 are green BOTH before and after the fallback ships, by
construction: they pin what the fallback must not disturb. Test 1 is the RED.

Harness notes:
  * side effects are routed by the dispatched callable's ``__name__``, never by
    call-counter position (PATTERNS S-8) — the runner gains ``db_execute`` calls
    over time and counter routing silently re-targets;
  * ``db_execute`` is NOT patched away for ``_mark_unrecoverable``: the real
    callable runs against the supabase mock, because the behaviour under test is
    that it issues a SECOND upsert;
  * the injected error is scoped to writes issued from inside
    ``_mark_unrecoverable`` that name the unknown column — which is what
    PostgREST itself does. R2 is deliberately bounded to the catch-all writer, so
    ``_mark_computing``'s own exposure to the same deploy window is out of scope
    here (that is the "never started" case, not the "cannot stamp failed" case).
"""
from __future__ import annotations

import logging
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

try:
    from postgrest.exceptions import APIError
except ImportError:  # pragma: no cover — only when postgrest isn't on path
    class APIError(Exception):  # type: ignore[no-redef]
        def __init__(self, error: dict[str, Any]) -> None:
            super().__init__(error.get("message", ""))
            self.code = error.get("code")
            self.message = error.get("message")
            self.details = error.get("details")
            self.hint = error.get("hint")


_STRATEGY_ID = "pgrst204-strategy-uuid"
_STAMP_KEY = "computing_started_at"
_WARNED_KEY = "computation_warned"

# Ten rows: enough to clear the runner's insufficient-history arm (< 2 rows) so
# the run reaches compute_all_metrics and therefore the catch-all except block.
_ROWS: list[dict[str, Any]] = [
    {"date": f"2024-01-{day:02d}", "daily_return": 0.001 * day} for day in range(1, 11)
]


def _schema_cache_miss() -> APIError:
    """The exact error PostgREST returns while its cache predates the column."""
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
    """A DIFFERENT APIError — the arm under test must not swallow this one."""
    return APIError({"code": "40001", "message": "preempted by watchdog reclaim"})


class _Harness(NamedTuple):
    sb: MagicMock
    table: MagicMock
    inside_unrecoverable: list[bool]
    observed: list[BaseException]


def _build_harness(upsert_error: Exception | None) -> _Harness:
    """A supabase mock whose upsert fails the way PostgREST fails.

    ``upsert_error`` is raised only for writes issued from inside
    ``_mark_unrecoverable`` whose payload names the unknown column. A payload
    that omits the column succeeds — which is precisely why the fallback cannot
    pass this test by re-sending an identical payload.
    """
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table

    select_chain = MagicMock()
    eq_chain = MagicMock()
    # WR-01 strategy-existence probe: .select(...).eq(...).single().execute()
    eq_chain.single.return_value.execute.return_value = MagicMock(
        data={"id": _STRATEGY_ID, "user_id": "u", "api_key_id": None}
    )
    # _mark_unrecoverable's prior-flags read: .maybe_single().execute(). A
    # non-empty prior flag proves the fallback carries the READ-MODIFY-WRITE
    # result forward rather than re-deriving an empty dict.
    eq_chain.maybe_single.return_value.execute.return_value = MagicMock(
        data={"data_quality_flags": {"negative_nav_guard": True}}
    )
    select_chain.eq.return_value = eq_chain
    table.select.return_value = select_chain

    inside_unrecoverable: list[bool] = []

    def _upsert(payload: dict[str, Any], **_kwargs: Any) -> MagicMock:
        chain = MagicMock()
        if upsert_error is not None and inside_unrecoverable and _STAMP_KEY in payload:
            chain.execute.side_effect = upsert_error
        else:
            chain.execute.return_value = MagicMock(data=[payload])
        return chain

    table.upsert.side_effect = _upsert
    return _Harness(sb, table, inside_unrecoverable, [])


def _db_execute_router(harness: _Harness) -> Any:
    """PATTERNS S-8: route by dispatched callable name, run the real callable."""

    async def _side_effect(fn: Any) -> Any:
        name = getattr(fn, "__name__", "")
        if name == "_load_series":
            return _ROWS
        if name == "_mark_unrecoverable":
            harness.inside_unrecoverable.append(True)
            try:
                return fn()
            except BaseException as exc:  # noqa: BLE001 — recorded, then re-raised
                harness.observed.append(exc)
                raise
            finally:
                harness.inside_unrecoverable.pop()
        return fn()

    return _side_effect


async def _run(harness: _Harness) -> HTTPException:
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
            await run_csv_strategy_analytics(_STRATEGY_ID)
    return exc_info.value


def _terminal_writes(harness: _Harness) -> list[dict[str, Any]]:
    return [
        call.args[0]
        for call in harness.table.upsert.call_args_list
        if call.args[0].get("computation_status") == "failed"
    ]


@pytest.mark.asyncio
async def test_pgrst204_fallback_lands_the_terminal_failed() -> None:
    """R2. A schema-cache miss on the stamp column costs the stamp, not the row.

    Pre-fix this is RED in the way that matters: the first (and only) terminal
    write is rejected, nothing lands, and the strategy is left 'computing'
    forever with the operator's only signal a swallowed warning.
    """
    harness = _build_harness(_schema_cache_miss())

    exc = await _run(harness)
    assert exc.status_code == 500

    writes = _terminal_writes(harness)
    assert len(writes) == 2, (
        "expected the rejected write followed by the fallback re-issue; got "
        f"{len(writes)} terminal write(s): {writes!r}. One write means no "
        "fallback fired and the row is stranded in 'computing'."
    )

    rejected, fallback = writes
    assert _STAMP_KEY in rejected, (
        "the first attempt must be the ORIGINAL payload — if it already omits "
        "the stamp key the injection never fired and this test is vacuous"
    )
    assert _STAMP_KEY not in fallback, (
        f"the fallback payload still names {_STAMP_KEY!r}, the very column "
        "PostgREST just said it does not know; it would be rejected identically"
    )
    assert fallback["computation_status"] == "failed"
    assert fallback[_WARNED_KEY] is False, (
        "SI-02: the terminal stamp must clear the runner-owned warned marker on "
        "the fallback path too, or the bridge can resurrect complete_with_warnings"
    )
    assert fallback["strategy_id"] == _STRATEGY_ID
    assert fallback["computation_error"] == "CSV analytics computation failed."
    assert fallback["data_quality_flags"] == {
        "negative_nav_guard": True,
        "csv_source": True,
    }, (
        "the fallback must carry the READ-MODIFY-WRITE flags forward; a wholesale "
        "{csv_source: True} rewrite is the laundering class mig 20260707120000 killed"
    )

    on_conflict = harness.table.upsert.call_args_list[-1].kwargs.get("on_conflict")
    assert on_conflict == "strategy_id", (
        "the fallback must keep the same conflict target, else it INSERTs a "
        f"duplicate instead of updating the row; got {on_conflict!r}"
    )


@pytest.mark.asyncio
async def test_non_pgrst204_api_errors_still_propagate(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The arm is narrow. Swallowing every APIError would hide real failures.

    A 40001 serialization failure on the terminal write is a genuine problem: the
    caller's warning-then-continue is the correct response, and it only happens
    if the exception leaves _mark_unrecoverable unchanged.
    """
    boom = _serialization_failure()
    harness = _build_harness(boom)

    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.runner")
    exc = await _run(harness)
    assert exc.status_code == 500

    assert harness.observed == [boom], (
        "the non-PGRST204 APIError must leave _mark_unrecoverable unchanged; "
        f"observed {harness.observed!r}"
    )
    assert len(_terminal_writes(harness)) == 1, (
        "a non-PGRST204 error must NOT trigger the stamp-stripping re-issue — "
        "that would mask a real write failure behind a silently degraded payload"
    )
    assert [
        r for r in caplog.records
        if "could not mark strategy" in r.getMessage()
    ], (
        "the caller's PR #273 warning must still fire — it is the only operator "
        "signal that the terminal write did not land"
    )


@pytest.mark.asyncio
async def test_normal_path_writes_one_terminal_row_clearing_the_stamp() -> None:
    """Negative control. With no error injected the fallback is unreachable."""
    harness = _build_harness(None)

    exc = await _run(harness)
    assert exc.status_code == 500

    writes = _terminal_writes(harness)
    assert len(writes) == 1, (
        f"expected exactly one terminal write on the normal path, got {len(writes)}"
    )
    assert writes[0][_STAMP_KEY] is None, (
        "JOB-01: the ordinary exit write must still CLEAR the stamp to None — a "
        "stale stamp on a terminal row can re-trigger the reaper"
    )
    assert harness.observed == [], (
        "nothing should have raised inside _mark_unrecoverable on this path"
    )
