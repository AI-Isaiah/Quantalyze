"""Tests for services/ops_alert_open.py - the durable "a page is open" record
(Phase 164.6.8 review WR-01).

WHY these properties matter (Rule 9: a test that cannot fail when the business
logic changes is wrong):

* a redeploy forgets in-process page state, so a RECOVERED notice owed for an open
  page is lost unless the open page is on disk: the row must exist while the page is
  open and must stop existing when it recovers;
* the marker is read ONCE per source per process on the first healthy reading, and
  "nothing is open" must be distinguishable from "could not look" (the first stops
  the caller looking, the second must not);
* a marker row sits in a table other writers share, so it must carry a closed key
  set and nothing that identifies an account, a host or a credential;
* the writers run inside the never-raises heal and monitor tick: a down sink must
  not raise out of them.

Each guard below was neutered in ``services/ops_alert_open.py``, observed RED by
name, and restored byte-identical.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Any

import pytest

from services import ops_alert_open
from tests.test_mt5_relogin import _FakeCronRuns

# The conftest autouse fixture replaces these on the module with an in-memory
# store for every OTHER test file; this file tests the real ones.
_READ = ops_alert_open.read_open_page
_RECORD = ops_alert_open.record_open_page
_CLOSE = ops_alert_open.close_open_page
_MARK_STALE = ops_alert_open.mark_open_page_stale

_SINCE = datetime(2026, 10, 14, 9, 30, 0, tzinfo=timezone.utc)
_JOBS = "mt5_jobs_terminal"
_VALIDATION = "mt5_validation_terminal"


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeCronRuns]:
    sink = _FakeCronRuns()
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: sink)
    ops_alert_open._STALE_SOURCES.clear()
    yield sink
    ops_alert_open._STALE_SOURCES.clear()


def _open_rows(sink: _FakeCronRuns) -> list[dict[str, Any]]:
    return [
        r
        for r in sink.rows
        if r["cron_name"] == "ops_alert_open" and r["status"] == "running"
    ]


async def test_a_recorded_page_is_one_running_row_with_a_closed_key_set(
    fake: _FakeCronRuns,
) -> None:
    assert await _RECORD(_JOBS, "ipc_fault", _SINCE) is True

    [row] = _open_rows(fake)
    assert row["cron_name"] == "ops_alert_open"
    assert row["status"] == "running"
    assert row["completed_at"] is None
    assert row["metadata"] == {
        "schema_version": 1,
        "source": _JOBS,
        "cause": "ipc_fault",
        "since": "2026-10-14T09:30:00+00:00",
    }


async def test_a_recorded_page_reads_back_as_the_same_source_cause_and_since(
    fake: _FakeCronRuns,
) -> None:
    await _RECORD(_JOBS, "ipc_fault", _SINCE)

    found = await _READ(_JOBS)

    assert found == ops_alert_open.OpenPage(
        source=_JOBS, cause="ipc_fault", since=_SINCE
    )


async def test_reading_a_source_with_no_open_page_is_none_not_an_error(
    fake: _FakeCronRuns,
) -> None:
    await _RECORD(_VALIDATION, "dark", _SINCE)

    assert await _READ(_JOBS) is None


async def test_recording_twice_keeps_the_first_row_and_its_earlier_since(
    fake: _FakeCronRuns,
) -> None:
    """A re-page of the same open incident (or a new process re-crossing the
    threshold) must not move the incident's start or stack up rows."""
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    assert await _RECORD(_JOBS, "dark", datetime(2026, 10, 14, 11, 0, tzinfo=timezone.utc))

    [row] = _open_rows(fake)
    assert row["metadata"]["cause"] == "ipc_fault"
    assert row["metadata"]["since"] == "2026-10-14T09:30:00+00:00"


async def test_each_source_has_its_own_open_row(fake: _FakeCronRuns) -> None:
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    await _RECORD(_VALIDATION, "dark", _SINCE)

    assert {r["metadata"]["source"] for r in _open_rows(fake)} == {_JOBS, _VALIDATION}


async def test_closing_a_source_closes_only_that_sources_rows(
    fake: _FakeCronRuns,
) -> None:
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    await _RECORD(_VALIDATION, "dark", _SINCE)

    assert await _CLOSE(_JOBS) is True

    assert [r["metadata"]["source"] for r in _open_rows(fake)] == [_VALIDATION]
    [closed] = [r for r in fake.rows if r["metadata"]["source"] == _JOBS]
    assert closed["status"] == "ok"
    assert closed["completed_at"] is not None
    assert await _READ(_JOBS) is None


async def test_a_closed_page_can_be_recorded_again_for_the_next_incident(
    fake: _FakeCronRuns,
) -> None:
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    await _CLOSE(_JOBS)
    await _RECORD(_JOBS, "dark", _SINCE)

    found = await _READ(_JOBS)
    assert found is not None and found.cause == "dark"
    assert len(fake.rows) == 2


async def test_a_source_outside_the_closed_set_is_never_written(
    fake: _FakeCronRuns,
) -> None:
    assert await _RECORD("some_future_source", "dark", _SINCE) is False
    assert fake.rows == []


async def test_a_cause_outside_the_charset_is_stored_as_unrecognised(
    fake: _FakeCronRuns,
) -> None:
    await _RECORD(_JOBS, "Has Spaces & Caps", _SINCE)

    [row] = _open_rows(fake)
    assert row["metadata"]["cause"] == "unrecognised"


async def test_a_row_with_a_malformed_since_or_cause_reads_back_safely(
    fake: _FakeCronRuns,
) -> None:
    fake.rows.append(
        {
            "id": "row-x",
            "cron_name": "ops_alert_open",
            "status": "running",
            "completed_at": None,
            "started_at": "2026-10-14T09:00:00+00:00",
            "metadata": {"source": _JOBS, "cause": 42, "since": "not a date"},
        }
    )

    found = await _READ(_JOBS)

    assert found == ops_alert_open.OpenPage(
        source=_JOBS, cause="unrecognised", since=None
    )


class _Boom:
    def table(self, _name: str) -> Any:
        raise RuntimeError("sink down")


async def test_a_down_sink_never_raises_out_of_record_or_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: _Boom())

    assert await _RECORD(_JOBS, "ipc_fault", _SINCE) is False
    assert await _CLOSE(_JOBS) is False


async def test_a_down_sink_raises_out_of_read_so_none_never_means_could_not_look(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: _Boom())

    with pytest.raises(RuntimeError):
        await _READ(_JOBS)


async def test_an_insert_that_returns_no_rows_reports_not_recorded(
    fake: _FakeCronRuns, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The caller retries on its next qualifying reading only if told it failed."""
    monkeypatch.setattr(ops_alert_open, "rows", lambda _resp: [])

    assert await _RECORD(_JOBS, "ipc_fault", _SINCE) is False


# --------------------------------------------------------------------------- #
# Review WR-R2-02 - the close is read, not assumed, and a stale row is not inherited
#
# WHY: `_close` used to ignore the UPDATE's result, so an UPDATE that matched nothing
# (a lost compare-and-set, a policy that hid the row) reported success, the caller
# marked the source done, and the `running` row outlived the incident. It then lent
# its cause and `since` to the next incident's record.
# --------------------------------------------------------------------------- #


class _MinimalReturning(_FakeCronRuns):
    """`returning='minimal'` on every UPDATE: `.data` is EMPTY and `.count` names how
    many rows matched, but only when the request asked for `count=exact`. A close
    that infers its outcome from `.data` reads every WON update as LOST."""

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            response = original()
            if query._op == "update":
                response.data = []
            return response

        query.execute = _execute  # type: ignore[method-assign]
        return query


class _UpdatesFail(_FakeCronRuns):
    """A sink whose UPDATE raises while ``fail_updates`` is set."""

    def __init__(self) -> None:
        super().__init__()
        self.fail_updates = False

    def table(self, name: str) -> Any:
        query = super().table(name)
        original = query.execute

        def _execute() -> Any:
            if query._op == "update" and self.fail_updates:
                raise RuntimeError("sink down")
            return original()

        query.execute = _execute  # type: ignore[method-assign]
        return query


async def test_a_close_whose_update_matched_nothing_reports_failure(
    fake: _FakeCronRuns, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The row was listed as open but another writer closed it first: the UPDATE's
    compare-and-set matches 0 rows. That is not a successful close."""
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    real_select = ops_alert_open._select_open_rows

    async def _stale_listing() -> list[dict[str, Any]]:
        listing = await real_select()
        for row in fake.rows:  # the other writer closes it after our read
            row["status"] = "ok"
        return listing

    monkeypatch.setattr(ops_alert_open, "_select_open_rows", _stale_listing)

    assert await _CLOSE(_JOBS) is False


async def test_a_won_close_is_counted_even_when_the_transport_returns_no_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`returning='minimal'`: `.data` is empty, so only `count=exact` tells a won
    close from a lost one."""
    sink = _MinimalReturning()
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: sink)
    await _RECORD(_JOBS, "ipc_fault", _SINCE)

    assert await _CLOSE(_JOBS) is True

    [row] = sink.rows
    assert row["status"] == "ok"


async def test_closing_a_source_with_nothing_open_is_a_success(
    fake: _FakeCronRuns,
) -> None:
    assert await _CLOSE(_JOBS) is True


async def test_a_new_incident_does_not_inherit_a_row_the_process_failed_to_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A recovery whose close failed leaves the old incident's row `running`. The
    next incident's record must replace it, not keep its cause and `since`."""
    sink = _UpdatesFail()
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: sink)
    ops_alert_open._STALE_SOURCES.clear()
    first = datetime(2026, 10, 14, 9, 30, tzinfo=timezone.utc)
    second = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)
    await _RECORD(_JOBS, "ipc_fault", first)

    sink.fail_updates = True
    assert await _CLOSE(_JOBS) is False
    sink.fail_updates = False

    assert await _RECORD(_JOBS, "dark", second) is True

    [open_row] = _open_rows(sink)
    assert open_row["metadata"]["cause"] == "dark"
    assert open_row["metadata"]["since"] == "2026-10-14T15:00:00+00:00"
    assert [r["status"] for r in sink.rows] == ["ok", "running"]
    found = await _READ(_JOBS)
    assert found == ops_alert_open.OpenPage(source=_JOBS, cause="dark", since=second)
    ops_alert_open._STALE_SOURCES.clear()


async def test_a_row_the_caller_marked_stale_is_replaced_by_the_next_incident(
    fake: _FakeCronRuns,
) -> None:
    """The no-channel recovery leaves the row open ON PURPOSE (to be re-sent); if a
    new incident begins first, the old notice is moot and the row is replaced."""
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    _MARK_STALE(_JOBS)
    later = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)

    assert await _RECORD(_JOBS, "dark", later) is True

    [open_row] = _open_rows(fake)
    assert open_row["metadata"]["cause"] == "dark"
    assert open_row["metadata"]["since"] == "2026-10-14T15:00:00+00:00"
    assert len(fake.rows) == 2


async def test_a_row_this_process_has_no_reason_to_think_stale_is_kept(
    fake: _FakeCronRuns,
) -> None:
    """The mirror image, and why replacing is scoped: after a redeploy in the middle
    of an outage the row left by the previous process IS this incident, with the
    earlier `since`. Replacing it would shorten the incident the founder reads."""
    await _RECORD(_JOBS, "ipc_fault", _SINCE)

    assert await _RECORD(_JOBS, "dark", datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc))

    [open_row] = _open_rows(fake)
    assert open_row["metadata"]["cause"] == "ipc_fault"
    assert open_row["metadata"]["since"] == "2026-10-14T09:30:00+00:00"


async def test_a_successful_close_clears_the_stale_mark(fake: _FakeCronRuns) -> None:
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    _MARK_STALE(_JOBS)
    assert await _CLOSE(_JOBS) is True
    await _RECORD(_JOBS, "dark", _SINCE)

    # No stale mark left: a second record keeps the row it finds.
    assert await _RECORD(_JOBS, "other", datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc))
    [open_row] = _open_rows(fake)
    assert open_row["metadata"]["cause"] == "dark"


async def test_a_replacement_that_cannot_close_the_old_row_reports_not_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Never two open rows for one source: if the stale row cannot be closed, the
    new incident is not recorded and the caller retries on its next reading."""
    sink = _UpdatesFail()
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: sink)
    ops_alert_open._STALE_SOURCES.clear()
    await _RECORD(_JOBS, "ipc_fault", _SINCE)
    _MARK_STALE(_JOBS)
    sink.fail_updates = True

    assert await _RECORD(_JOBS, "dark", _SINCE) is False

    assert len(_open_rows(sink)) == 1
    ops_alert_open._STALE_SOURCES.clear()
