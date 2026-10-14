"""Parity: the SQL reader's backfill constants cannot drift from the worker's own.

Phase 164.6.8 (OUTAGEALERT) plan 02, decisions D-10 and D-11.

WHY this test exists (Rule 9: the WHY, not the WHAT)
----------------------------------------------------
``public.ops_staleness_check()`` (migration ``*_ops_staleness_check.sql``) pages
when backfill-kind jobs stall. It cannot import Python, so it carries its own
copies of four facts about the dedicated backfill worker:

* the KIND LIST (``c_backfill_kinds``) — ``main_worker.BACKFILL_KINDS``;
* the CEILING (``c_backfill_ceiling``) — the largest watchdog stall threshold over
  those kinds: ``WATCHDOG_PER_KIND_OVERRIDES`` where a kind has an entry, else the
  global default ``watchdog_tick`` passes as ``p_stale_threshold``;
* the WATCHDOG TICK (``c_watchdog_interval``) — the ``interval`` default of
  ``main_worker.watchdog_loop``, which both call sites start with no override;
* the CRON-SYNC CEILING (``c_cron_sync_ceiling``) — 2 days. D-11 sets it, and it is
  the same 2 days as D-05 of Phase 167.1.2.2.2 (the TODOS gate value).

Each way the two sides can move alone is a silent failure, not a loud one:

* a backfill kind added to the worker but not to the reader leaves THAT KIND'S
  stall unpaged — the queue stalls and every signal stays green;
* a kind added to the reader but not to the worker pages on a queue another
  worker owns;
* a reader ceiling BELOW the watchdog's largest threshold pages on a healthy long
  crawl (the watchdog would not have reclaimed it yet), and the page is muted
  within a week, which is the same as having no alarm;
* a reader ceiling ABOVE it leaves a wedged queue unpaged for longer than the
  worker's own recovery window.

The SQL side is read from the migration TEXT (comments stripped first, so a
header quoting an old value cannot satisfy or break a match), found by SUFFIX so
a re-picked migration stamp survives. The worker side is read by import and
introspection, never from a number copied into this file.

Pure-stdlib apart from importing ``main_worker``; no DB, no network.
"""

from __future__ import annotations

import inspect
import pathlib
import re
from datetime import timedelta

import pytest

import main_worker

# analytics-service/tests/ -> repo root is parents[2].
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_MIGRATIONS = _REPO_ROOT / "supabase" / "migrations"
_MAIN_PY = _REPO_ROOT / "analytics-service" / "main.py"

_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_UNIT_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
}
_INTERVAL_RE = re.compile(r"^\s*(\d+)\s+(second|minute|hour|day)s?\s*$", re.IGNORECASE)


def _interval(text: str) -> timedelta:
    """Parse the ``'N unit'`` spelling both sides use (``'30 minutes'``).

    Anything else raises: a reader constant spelled in a form this parser does
    not know is a constant this test would silently stop comparing.
    """
    m = _INTERVAL_RE.match(text)
    if m is None:
        raise AssertionError(
            f"cannot parse {text!r} as 'N second|minute|hour|day[s]'; widen "
            "_interval() deliberately rather than comparing nothing"
        )
    return timedelta(seconds=int(m.group(1)) * _UNIT_SECONDS[m.group(2).lower()])


def _migration_text() -> str:
    matches = sorted(_MIGRATIONS.glob("*_ops_staleness_check.sql"))
    assert len(matches) == 1, (
        f"expected exactly one *_ops_staleness_check.sql under {_MIGRATIONS}, "
        f"found {[m.name for m in matches]}: a rename that loses the file must "
        "not pass vacuously"
    )
    return _LINE_COMMENT_RE.sub("", matches[0].read_text(encoding="utf-8"))


def _sql_interval(constant: str) -> timedelta:
    m = re.search(
        rf"{constant}\s+CONSTANT\s+INTERVAL\s*:=\s*'([^']+)'",
        _migration_text(),
    )
    assert m is not None, (
        f"{constant} is not declared as `CONSTANT INTERVAL := '...'` in the "
        "migration; this test would otherwise compare nothing"
    )
    return _interval(m.group(1))


def _sql_backfill_kinds() -> list[str]:
    m = re.search(
        r"c_backfill_kinds\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([^\]]*)\]",
        _migration_text(),
    )
    assert m is not None, (
        "c_backfill_kinds is not declared as `CONSTANT TEXT[] := ARRAY[...]` in "
        "the migration"
    )
    kinds = re.findall(r"'([^']+)'", m.group(1))
    assert kinds, "c_backfill_kinds parsed to an empty list"
    return kinds


def _worker_global_threshold() -> timedelta:
    """The global default ``watchdog_tick`` passes as ``p_stale_threshold``."""
    src = inspect.getsource(main_worker.watchdog_tick)
    m = re.search(r'"p_stale_threshold"\s*:\s*"([^"]+)"', src)
    assert m is not None, (
        "watchdog_tick no longer passes a literal p_stale_threshold; the global "
        "default the reader's ceiling derives from cannot be read"
    )
    return _interval(m.group(1))


def test_backfill_kind_list_equals_the_workers() -> None:
    """A kind the worker backfills but the reader does not watch stalls unpaged."""
    sql_kinds = _sql_backfill_kinds()
    assert len(sql_kinds) == len(set(sql_kinds)), f"duplicate kind in {sql_kinds}"
    assert set(sql_kinds) == set(main_worker.BACKFILL_KINDS), (
        f"SQL c_backfill_kinds {sorted(sql_kinds)} != "
        f"main_worker.BACKFILL_KINDS {sorted(main_worker.BACKFILL_KINDS)}: a kind "
        "added on one side only leaves its stall silent (worker-only) or pages "
        "on another worker's queue (reader-only)"
    )


def test_backfill_ceiling_is_the_largest_watchdog_threshold_over_the_kinds() -> None:
    """A ceiling below the watchdog's pages on a healthy long crawl."""
    global_default = _worker_global_threshold()
    overrides = main_worker.WATCHDOG_PER_KIND_OVERRIDES
    per_kind = {
        kind: _interval(overrides[kind]) if kind in overrides else global_default
        for kind in main_worker.BACKFILL_KINDS
    }
    expected = max(per_kind.values())
    assert _sql_interval("c_backfill_ceiling") == expected, (
        f"SQL c_backfill_ceiling {_sql_interval('c_backfill_ceiling')} != the "
        f"largest watchdog threshold over BACKFILL_KINDS {expected} "
        f"(per kind: {per_kind}): below it, the reader pages on a job the "
        "watchdog has not yet reclaimed; above it, a wedged queue waits longer "
        "than the worker's own recovery window"
    )


def test_watchdog_call_passes_the_per_kind_overrides_dict() -> None:
    """The ceiling derivation reads the dict the watchdog actually sends."""
    src = inspect.getsource(main_worker.watchdog_tick)
    assert re.search(
        r'"p_per_kind_overrides"\s*:\s*WATCHDOG_PER_KIND_OVERRIDES', src
    ), (
        "watchdog_tick no longer passes WATCHDOG_PER_KIND_OVERRIDES as "
        "p_per_kind_overrides; the per-kind thresholds this test derives the "
        "reader's ceiling from are no longer the ones the watchdog applies"
    )


def test_watchdog_interval_is_the_loops_default_and_no_caller_overrides_it() -> None:
    """The reader allows one watchdog tick of slack on a running job."""
    default = inspect.signature(main_worker.watchdog_loop).parameters["interval"].default
    assert isinstance(default, (int, float)), (
        f"watchdog_loop's interval default is {default!r}, not a number"
    )
    assert _sql_interval("c_watchdog_interval") == timedelta(seconds=float(default)), (
        f"SQL c_watchdog_interval {_sql_interval('c_watchdog_interval')} != "
        f"main_worker.watchdog_loop's interval default {default}s: a job past "
        "its threshold is reclaimed on the NEXT tick, so the slack is exactly "
        "one tick"
    )
    # Neither caller that starts the loop may override the default, or the
    # default is no longer the cadence the watchdog runs at.
    worker_main_src = inspect.getsource(main_worker.main)
    assert re.search(r"\bwatchdog_loop\(\s*\)", worker_main_src), (
        "main_worker.main starts watchdog_loop with an argument; the interval "
        "default is no longer the real cadence"
    )
    main_py = _MAIN_PY.read_text(encoding="utf-8")
    assert re.search(r"create_task\(\s*watchdog_loop\(\s*\)", main_py), (
        "analytics-service/main.py starts watchdog_loop with an argument (or no "
        "longer starts it that way); the interval default is no longer the real "
        "cadence in production, where this loop runs inside the FastAPI process"
    )


def test_cron_sync_ceiling_is_two_days() -> None:
    """D-11 / 167.1.2.2.2 D-05: the cron_sync heartbeat ceiling is 2 days.

    ⚠️ This is the one constant with no Python twin to compare against: it is a
    DECISION (the TODOS gate value), not a derivation. The pin exists so the
    reader's ceiling cannot be edited without this assertion, and the decision
    that justifies it, being edited alongside.
    """
    assert _sql_interval("c_cron_sync_ceiling") == timedelta(days=2)


@pytest.mark.parametrize(
    "needle",
    ["ops_staleness_check", "prober-cadence-alert"],
)
def test_the_reader_names_the_function_and_the_existing_alert_route(needle: str) -> None:
    """The migration still posts to the route plan 01 wires to Sentry and email."""
    assert needle in _migration_text()
