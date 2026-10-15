"""Tests for services/mt5_outage_alert.py - the MT5 outage tracker (Phase 164.6.8
plan 04; decisions D-04, D-05, D-06, D-13).

WHY these properties matter (Rule 9: a test that cannot fail when the business
logic changes is wrong):

* a shared-terminal outage that only logs at WARNING reaches nobody (the defect
  this phase removes), so the page must fire at the EXISTING threshold;
* a measured ``dark`` reading (a logged-out terminal) resets the old blind-run
  counter, so a terminal that says "no account" forever never escalated;
* a "recovered" notice sent for a busy skip or a ``code=0`` reading tells the
  founder the outage is over while the terminal is still unmeasured;
* a deliberately-disabled kill switch that pages is an alarm operators learn to
  ignore;
* the wedge evidence is erased by the recycle, so the page must carry the
  snapshot taken before it, and that text must not leak an account number, the
  broker server name or a machine path.

Each reader below was neutered, observed RED by name, and restored byte-identical.
See the plan 04 SUMMARY.
"""

from __future__ import annotations

import ast
import inspect
import logging
import sys
import textwrap
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from itertools import permutations
from typing import Any

import pytest

from services import (
    mt5_outage_alert,
    mt5_relogin,
    mt5_session_episodes,
    mt5_session_monitor,
    ops_alert,
    ops_alert_open,
)
from tests.child_deadman import run_child
from tests.test_mt5_relogin import (  # noqa: F401 - the two autouse fixtures are imported so they apply here
    _FAKE_LOGIN,
    _FAKE_SERVER,
    _WEDGED,
    _FakeCronRuns,
    _capture_outcomes,
    _fake_clock,
    _heal_n_times,
    _install_client,
    _reset_state,
    _set_full_env,
)

# The conftest autouse fixture replaces these on the module with an in-memory store;
# the lifecycle tests below put the REAL ones back over a fake `cron_runs`.
_REAL_OPEN_PAGE_FUNCTIONS = {
    name: getattr(ops_alert_open, name)
    for name in (
        "read_open_page",
        "record_open_page",
        "close_open_page",
        "mark_open_page_stale",
    )
}

_CADENCE_S = 600.0
_THRESHOLD = mt5_session_episodes.blind_run_escalation_threshold(_CADENCE_S)
assert _THRESHOLD == 6, "the tracer arithmetic below is ceil(3600 / 600)"

_SOURCE = mt5_relogin.HEAL_SOURCE_SESSION_MONITOR
_JOBS_SOURCE = "mt5_jobs_terminal"

_IPC_FAULT = (mt5_session_episodes.KIND_IPC_FAULT, -10005)
_DARK = (mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT, -6)
_BUSY = (mt5_session_episodes.KIND_BUSY_SKIP, None)
_BUDGET = (mt5_session_episodes.KIND_BUDGET_ABANDONED, None)
_ZERO_CODE = (mt5_session_episodes.KIND_IPC_FAULT, 0)
_DISABLED = (mt5_session_episodes.KIND_DISABLED, None)
_AUTHORIZED = (mt5_session_episodes.KIND_ALREADY_AUTHORIZED, None)
_HEALED = (mt5_session_episodes.KIND_HEALED, None)

_T0 = datetime(2026, 10, 13, 12, 0, 0, tzinfo=timezone.utc)


class _Clock:
    """A wall clock the test drives, substituted for ``mt5_outage_alert._utcnow``."""

    def __init__(self) -> None:
        self.now = _T0

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now = self.now + timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    fake = _Clock()
    monkeypatch.setattr(mt5_outage_alert, "_utcnow", fake)
    return fake


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Supabase writes go to an in-memory fake; the page recorder is the autouse
    ``mt5_outage_pages`` fixture in conftest."""
    fake = _FakeCronRuns()
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield fake
    mt5_session_episodes._reset_session_episode_state_for_tests()


async def _observe(
    reading: tuple[str, int | None],
    *,
    poll_interval_s: float | None = _CADENCE_S,
) -> None:
    kind, code = reading
    await mt5_session_episodes.record_mt5_session_reading(
        kind, code, source=_SOURCE, poll_interval_s=poll_interval_s
    )


# --------------------------------------------------------------------------- #
# Task 1 - the tracer: N consecutive ipc_fault readings page the founder once
# --------------------------------------------------------------------------- #


async def test_tracer_six_ipc_fault_readings_page_the_founder_once_at_the_sixth(
    sink: Any, clock: _Clock, mt5_outage_pages: list[Any]
) -> None:
    """The slice end to end: reading -> episode recorder -> tracker -> page.

    WHY: this is SC-1. Before this phase the sixth blind reading logged a WARNING
    and nothing outside the module read it; the page must fire exactly at the
    existing threshold, name the terminal source and the cause, and carry the time
    the run STARTED (the first non-authorized reading), not the time of the page.
    """
    first_reading_at = clock.now
    for index in range(_THRESHOLD):
        assert mt5_outage_pages == [], (
            f"a page was sent before the threshold, on reading {index}"
        )
        await _observe(_IPC_FAULT)
        clock.advance(seconds=_CADENCE_S)

    assert len(mt5_outage_pages) == 1, mt5_outage_pages
    page = mt5_outage_pages[0]
    assert page.source == _JOBS_SOURCE
    assert page.cause == "ipc_fault"
    assert page.event == "outage"
    assert page.since == first_reading_at
    assert f"consecutive_readings={_THRESHOLD}" in page.detail
    assert f"escalation_threshold={_THRESHOLD}" in page.detail


# --------------------------------------------------------------------------- #
# Task 2 - ERROR at the threshold, recovery, decided kinds, dark, the boot heal
# --------------------------------------------------------------------------- #

_EPISODE_LOGGER = "quantalyze.analytics.mt5_session_episodes"


def _episode_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == _EPISODE_LOGGER]


async def test_the_blind_run_line_is_ERROR_at_the_threshold_and_INFO_below_it(
    sink: Any, caplog: pytest.LogCaptureFixture
) -> None:
    """D-04. WARNING is BELOW the Sentry event level, which is the defect this
    phase removes: a blind run at WARNING reaches no human. The line must be an
    ERROR from the threshold onward, and quiet (INFO) before it."""
    with caplog.at_level(logging.INFO, logger=_EPISODE_LOGGER):
        for _ in range(_THRESHOLD - 1):
            await _observe(_BUSY)
        below = _episode_records(caplog)
        assert [r.levelno for r in below] == [logging.INFO] * (_THRESHOLD - 1)

        await _observe(_BUSY)
        at = _episode_records(caplog)[-1]
        assert at.levelno == logging.ERROR, (
            f"the threshold-th blind reading logged at {at.levelname}; below "
            "ERROR it never becomes a Sentry event"
        )
        assert "blind=True" in at.getMessage()


async def test_a_DECIDED_blind_kind_stays_INFO_forever_and_never_pages(
    sink: Any, caplog: pytest.LogCaptureFixture, mt5_outage_pages: list[Any]
) -> None:
    """D-05. The deliberate kill switch is an operator DECISION. An alarm that
    fires forever on a service turned off on purpose is an alarm operators learn
    to ignore (the WR-10 standard, now applied to the page as well as the level)."""
    with caplog.at_level(logging.INFO, logger=_EPISODE_LOGGER):
        for _ in range(_THRESHOLD * 4):
            await _observe(_DISABLED)

    assert mt5_outage_pages == []
    assert all(r.levelno == logging.INFO for r in _episode_records(caplog))


async def test_a_decided_reading_inside_a_real_outage_run_does_not_page_but_the_next_fault_does(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """D-05, per KIND. The decided kind is still COUNTED (so a later genuine
    fault is not reset by it) but is exempt from paging itself; a kill-switch
    reading that happens to be the threshold-th must not produce a page, and the
    very next genuine fault must."""
    for _ in range(_THRESHOLD - 1):
        await _observe(_IPC_FAULT)
    await _observe(_DISABLED)
    assert mt5_outage_pages == [], "the decided kind paged"

    await _observe(_IPC_FAULT)
    assert [p.cause for p in mt5_outage_pages] == ["ipc_fault"]


async def test_six_dark_readings_page_with_cause_dark_though_each_resets_the_old_counter(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """The measured outage the old counter CANNOT see. ``_clear_blind_run`` resets
    on every ``dark`` reading (the instrument is reporting, not blind), so a
    terminal that is logged out and says so every tick never escalated. The
    tracker counts it anyway, because the founder's question is "is the terminal
    usable", not "is the monitor blind"."""
    for _ in range(_THRESHOLD):
        await _observe(_DARK)
        assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 0, (
            "precondition: dark must reset the OLD counter, or this test proves "
            "nothing the old counter could not do"
        )

    assert [p.cause for p in mt5_outage_pages] == ["dark"]
    assert "code=-6" in mt5_outage_pages[0].detail


async def test_recovery_sends_exactly_one_notice_on_the_first_measured_authorized_reading(
    sink: Any, clock: _Clock, mt5_outage_pages: list[Any]
) -> None:
    """D-06. Five ipc_fault + one busy skip pages at reading six; the first
    ``already_authorized`` sends exactly one recovered notice naming what the run
    was; a second authorized sends nothing."""
    started = clock.now
    for _ in range(_THRESHOLD - 1):
        await _observe(_IPC_FAULT)
        clock.advance(seconds=_CADENCE_S)
    await _observe(_BUSY)
    assert [p.event for p in mt5_outage_pages] == ["outage"]
    assert mt5_outage_pages[0].cause == "busy_skip"

    clock.advance(seconds=_CADENCE_S)
    await _observe(_AUTHORIZED)
    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]
    recovered = mt5_outage_pages[1]
    assert recovered.source == _JOBS_SOURCE
    assert recovered.cause == "recovered_from_busy_skip"
    assert recovered.since == started
    assert "duration_min=60" in recovered.detail

    await _observe(_AUTHORIZED)
    assert len(mt5_outage_pages) == 2, "a second authorized reading re-notified"


async def test_a_healed_reading_also_recovers(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """``healed`` is the other MEASURED-authorized kind (the heal ran and the
    re-probe saw an account). Treating only ``already_authorized`` as recovery
    would leave the founder with an outage page and no all-clear after every
    successful heal."""
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    await _observe(_HEALED)
    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]


@pytest.mark.parametrize(
    "unmeasured,label",
    [
        pytest.param(_BUSY, "a busy skip", id="busy-skip"),
        pytest.param(_BUDGET, "a budget abandon", id="budget-abandoned"),
        pytest.param(_ZERO_CODE, "the code=0 sentinel", id="code-zero"),
    ],
)
async def test_a_not_measured_reading_never_counts_as_recovered(
    sink: Any,
    mt5_outage_pages: list[Any],
    unmeasured: tuple[str, int | None],
    label: str,
) -> None:
    """D-06. ``busy_skip`` and ``budget_abandoned`` measured nothing, and ``0`` is
    ``last_error()`` itself failing. Reading any of them as "the terminal is fine"
    is the boot heal's busy-skip rationale, which is unsound for a loop: a
    terminal held by a FAILING job is exactly where it is most wrong."""
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    for _ in range(3):
        await _observe(unmeasured)

    assert all(p.event == "outage" for p in mt5_outage_pages), (
        f"{label} produced a recovered notice: {[p.event for p in mt5_outage_pages]}"
    )
    assert mt5_outage_pages, "the outage page itself never fired"


async def test_a_not_measured_reading_extends_the_run_rather_than_restarting_it(
    sink: Any, clock: _Clock, mt5_outage_pages: list[Any]
) -> None:
    """D-06, the other half. If a busy skip reset the run, an outage interleaved
    with busy ticks would never accumulate a threshold's worth of readings."""
    started = clock.now
    for reading in [_IPC_FAULT, _BUSY, _IPC_FAULT, _BUSY, _IPC_FAULT, _BUSY]:
        await _observe(reading)
        clock.advance(seconds=_CADENCE_S)

    assert len(mt5_outage_pages) == 1
    assert mt5_outage_pages[0].since == started


async def test_an_authorized_reading_with_no_prior_page_sends_nothing_and_resets_the_run(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """A run that never paged ends silently, and the NEXT run starts from zero:
    five faults, a recovery, five faults is two short runs, not a ten-reading one."""
    for _ in range(_THRESHOLD - 1):
        await _observe(_IPC_FAULT)
    await _observe(_AUTHORIZED)
    for _ in range(_THRESHOLD - 1):
        await _observe(_IPC_FAULT)

    assert mt5_outage_pages == []


async def test_the_boot_heal_with_no_cadence_never_pages(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """The boot heal fires once per process, so no run can exceed one reading and
    no span can be derived from a cadence that does not exist (threshold None)."""
    for _ in range(20):
        await _observe(_IPC_FAULT, poll_interval_s=None)

    assert mt5_outage_pages == []

    # Anti-vacuity: the SAME readings with a cadence do page, so the silence above
    # is the missing cadence and not a tracker that never pages.
    mt5_session_episodes._reset_session_episode_state_for_tests()
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    assert len(mt5_outage_pages) == 1


async def test_a_page_that_raises_changes_nothing_the_episode_recorder_does(
    sink: Any,
    monkeypatch: pytest.MonkeyPatch,
    mt5_outage_pages: list[Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """T-164.6.8-18. The recorder runs under ``main.lifespan``'s ``_crash_handler``,
    which stops every worker loop on any background-task exception. An alert path
    that raises must leave the call returning None AND the episode write exactly
    as it would have been (a ``dark`` reading still opens its row)."""

    async def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("the channel is down")

    for _ in range(_THRESHOLD - 1):
        await _observe(_BUSY)
    inserts_before = len(sink.inserts)

    monkeypatch.setattr(
        mt5_outage_alert,
        "ops_alert",
        type("Boom", (), {"page": staticmethod(_boom),
                          "scrub_alert_detail": staticmethod(ops_alert.scrub_alert_detail)}),
    )
    with caplog.at_level(logging.WARNING):
        result = await mt5_session_episodes.record_mt5_session_reading(
            *_DARK, source=_SOURCE, poll_interval_s=_CADENCE_S
        )

    assert result is None
    assert len(sink.inserts) == inserts_before + 1, (
        "the dark reading's episode row was not written because the page raised"
    )
    assert any("outage tracker failed" in r.getMessage() for r in caplog.records)


# --------------------------------------------------------------------------- #
# The real channel, the cause charset, the source set
# --------------------------------------------------------------------------- #


@pytest.fixture
def real_channel(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Put the REAL ``ops_alert.page`` back, with Sentry and the email POST spied."""
    from unittest.mock import MagicMock

    spy = MagicMock()
    scopes: list[Any] = []

    def _new_scope() -> Any:
        scope = MagicMock()
        scope.tags = {}
        scope.set_tag.side_effect = lambda k, v: scope.tags.__setitem__(k, v)
        scopes.append(scope)
        cm = MagicMock()
        cm.__enter__.return_value = scope
        cm.__exit__.return_value = False
        return cm

    spy.new_scope.side_effect = _new_scope
    posts: list[dict[str, Any]] = []
    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "_schedule_founder_email", posts.append)
    monkeypatch.setattr(mt5_outage_alert, "ops_alert", ops_alert)
    ops_alert._reset_ops_alert_for_tests()
    yield type("Chan", (), {"spy": spy, "scopes": scopes, "posts": posts})
    ops_alert._reset_ops_alert_for_tests()


async def test_through_the_real_channel_a_sustained_outage_captures_once_and_recovers_once(
    sink: Any, real_channel: Any
) -> None:
    """The tracker calls ``page`` on EVERY qualifying reading and relies on the
    helper's hourly window (D-05). Proven end to end: three qualifying readings in
    one window are one capture and one email, tagged with the MT5 source (not
    ``unrecognised``), and the recovery is its own capture and email."""
    for _ in range(_THRESHOLD + 2):
        await _observe(_IPC_FAULT)

    assert real_channel.spy.capture_message.call_count == 1
    assert len(real_channel.posts) == 1
    tags = real_channel.scopes[0].tags
    assert tags["ops_alert_source"] == _JOBS_SOURCE
    assert tags["ops_alert_cause"] == "ipc_fault"
    assert tags["ops_alert_event"] == "outage"
    assert real_channel.posts[0]["source"] == _JOBS_SOURCE

    await _observe(_AUTHORIZED)
    assert real_channel.spy.capture_message.call_count == 2
    assert len(real_channel.posts) == 2
    tags = real_channel.scopes[1].tags
    assert tags["ops_alert_event"] == "recovered"
    assert tags["ops_alert_cause"] == "recovered_from_ipc_fault"
    assert tags["ops_alert_source"] == _JOBS_SOURCE


async def test_one_incident_pages_under_one_cause_however_the_reading_kind_changes(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """Review WR-02 (b). The reading kind changes inside ONE wedge (a fault, then a
    busy skip, then an abandoned heal, then a dark reading). The page's cause is the
    kind at the threshold crossing and is pinned for the run, so the founder sees one
    incident and one Sentry fingerprint, and the recovery names the same cause."""
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    await _observe(_BUSY)
    await _observe(_BUDGET)
    await _observe(_DARK)

    outages = [p for p in mt5_outage_pages if p.event == "outage"]
    assert len(outages) == 4
    assert {p.cause for p in outages} == {"ipc_fault"}

    await _observe(_AUTHORIZED)
    assert mt5_outage_pages[-1].event == "recovered"
    assert mt5_outage_pages[-1].cause == "recovered_from_ipc_fault"


async def test_through_the_real_channel_a_reopened_outage_inside_the_hour_pages_again(
    sink: Any, real_channel: Any
) -> None:
    """Review SFH-F1 / WR-02 (a), end to end through the REAL window. Outage,
    recovery, outage again inside the hour: the founder's last message must be the
    second OUTAGE, not the RECOVERED."""
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    await _observe(_AUTHORIZED)
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)

    events = [s.tags["ops_alert_event"] for s in real_channel.scopes]
    assert events == ["outage", "recovered", "outage"]
    assert real_channel.scopes[2].tags["ops_alert_cause"] == "ipc_fault"
    assert len(real_channel.posts) == 3


async def test_one_incident_with_a_changing_kind_captures_once_through_the_real_channel(
    sink: Any, real_channel: Any
) -> None:
    """Review WR-02 (b), end to end: four reading kinds in one run are ONE capture
    and ONE email, not three or four."""
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    await _observe(_BUSY)
    await _observe(_BUDGET)
    await _observe(_DARK)

    assert real_channel.spy.capture_message.call_count == 1
    assert len(real_channel.posts) == 1


# --------------------------------------------------------------------------- #
# Review WR-01 - an open page survives a restart, so its RECOVERED still goes out
# --------------------------------------------------------------------------- #

_VALIDATION_SOURCE = "mt5_validation_terminal"
_DEBT_SOURCE = mt5_outage_alert.SOURCE_RELAUNCH_DEBT
_BEFORE_RESTART = datetime(2026, 10, 14, 6, 0, 0, tzinfo=timezone.utc)


def _seed_open_page(
    store: Any, source: str, cause: str = "ipc_fault"
) -> None:
    """A page the PREVIOUS process sent and never recovered."""
    from services.ops_alert_open import OpenPage

    store.pages[source] = OpenPage(source=source, cause=cause, since=_BEFORE_RESTART)


async def test_a_page_that_goes_out_leaves_a_durable_open_record(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """The record must exist the moment the page is sent, not at recovery: a
    redeploy lands in between, and only what is on disk survives it."""
    for index in range(_THRESHOLD - 1):
        await _observe(_IPC_FAULT)
    assert ops_alert_open_store.pages == {}, "recorded before any page was sent"

    await _observe(_IPC_FAULT)

    assert [p.event for p in mt5_outage_pages] == ["outage"]
    assert set(ops_alert_open_store.pages) == {_JOBS_SOURCE}
    record = ops_alert_open_store.pages[_JOBS_SOURCE]
    assert record.cause == "ipc_fault"
    assert record.since == mt5_outage_pages[0].since


async def test_the_open_record_is_not_rewritten_on_every_reading_of_a_sustained_outage(
    sink: Any, ops_alert_open_store: Any
) -> None:
    for _ in range(_THRESHOLD + 5):
        await _observe(_IPC_FAULT)

    assert ops_alert_open_store.record_calls == 1


async def test_a_normal_recovery_closes_the_durable_record(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]
    assert ops_alert_open_store.pages == {}


async def test_a_failed_record_is_retried_on_the_next_qualifying_reading(
    sink: Any, ops_alert_open_store: Any
) -> None:
    """A sink hiccup at the moment of the page must not leave the incident
    unrecoverable for good: the next reading tries again, and once it has landed
    the tracker stops writing."""
    ops_alert_open_store.record_fails = True
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)
    assert ops_alert_open_store.pages == {}
    assert ops_alert_open_store.record_calls == 1

    ops_alert_open_store.record_fails = False
    await _observe(_IPC_FAULT)
    assert set(ops_alert_open_store.pages) == {_JOBS_SOURCE}
    assert ops_alert_open_store.record_calls == 2

    await _observe(_IPC_FAULT)
    assert ops_alert_open_store.record_calls == 2


async def test_a_restart_with_an_open_page_still_sends_the_recovered_notice(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """THE WR-01 SCENARIO. The outage was paged by the previous process; a redeploy
    ended it. This process has no run in memory. Its first MEASURED authorized
    reading must still tell the founder, naming the incident's real start."""
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE, "ipc_fault")

    await _observe(_AUTHORIZED)

    [page] = mt5_outage_pages
    assert page.source == _JOBS_SOURCE
    assert page.event == "recovered"
    assert page.cause == "recovered_from_ipc_fault"
    assert page.since == _BEFORE_RESTART
    assert "restart" in page.detail
    assert ops_alert_open_store.pages == {}


async def test_the_restart_recovery_is_sent_once_and_the_sink_is_read_once(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE)

    for _ in range(4):
        await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["recovered"]
    # Two sources are consulted on the jobs terminal's first healthy reading (the
    # terminal itself and the process-local relaunch debt), each exactly once.
    assert ops_alert_open_store.read_calls == 2


async def test_a_healthy_boot_with_nothing_open_reads_the_sink_once_and_pages_nothing(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    for _ in range(5):
        await _observe(_AUTHORIZED)

    assert mt5_outage_pages == []
    assert ops_alert_open_store.read_calls == 2  # the terminal and the debt, once each


async def test_only_a_measured_authorized_reading_recovers_a_page_from_before_a_restart(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """D-06 still holds across a restart: a busy skip, a dark reading and an IPC
    fault are not evidence of recovery, and must not read the record at all."""
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE)

    await _observe(_BUSY)
    await _observe(_DARK)
    await _observe(_IPC_FAULT)

    assert mt5_outage_pages == []
    assert _JOBS_SOURCE in ops_alert_open_store.pages
    assert ops_alert_open_store.read_calls == 0


async def test_a_run_that_had_not_yet_paged_still_recovers_the_previous_processs_page(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """After the restart the first readings are non-authorized (below the
    threshold, no page), then the terminal is measured healthy: the run pops
    unpaged, and the previous process's open page is the one that is owed."""
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE)
    await _observe(_IPC_FAULT)
    await _observe(_IPC_FAULT)

    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["recovered"]
    assert ops_alert_open_store.pages == {}


async def test_an_unreadable_sink_does_not_mark_the_restart_check_done(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """"Could not look" is not "nothing open": the check is retried on the next
    healthy reading, and the recovery goes out then."""
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE)
    ops_alert_open_store.read_fails = True

    await _observe(_AUTHORIZED)
    assert mt5_outage_pages == []

    ops_alert_open_store.read_fails = False
    await _observe(_AUTHORIZED)
    assert [p.event for p in mt5_outage_pages] == ["recovered"]


async def test_a_failed_close_still_sends_the_notice_and_never_raises(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """At-least-once: the notice is not held hostage to the close."""
    _seed_open_page(ops_alert_open_store, _JOBS_SOURCE)
    ops_alert_open_store.close_fails = True

    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["recovered"]
    assert _JOBS_SOURCE in ops_alert_open_store.pages


async def test_each_role_recovers_only_its_own_open_page(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    _seed_open_page(ops_alert_open_store, _VALIDATION_SOURCE, "dark")

    await _observe(_AUTHORIZED)  # the JOBS terminal is healthy
    assert mt5_outage_pages == []
    assert _VALIDATION_SOURCE in ops_alert_open_store.pages

    await mt5_outage_alert.note_outage_reading(
        mt5_outage_alert.ROLE_VALIDATION,
        mt5_session_episodes.STATE_AUTHORIZED,
        mt5_session_episodes.KIND_ALREADY_AUTHORIZED,
        None,
        poll_interval_s=_CADENCE_S,
    )
    [page] = mt5_outage_pages
    assert page.source == _VALIDATION_SOURCE
    assert page.cause == "recovered_from_dark"
    assert ops_alert_open_store.pages == {}


async def test_a_relaunch_debt_page_leaves_a_record_and_its_settle_closes_it(
    ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    await mt5_outage_alert.note_relaunch_debt_lease_busy(detail="d")
    assert set(ops_alert_open_store.pages) == {_DEBT_SOURCE}
    assert ops_alert_open_store.pages[_DEBT_SOURCE].cause == (
        mt5_outage_alert.CAUSE_DEBT_LEASE_BUSY
    )

    await mt5_outage_alert.note_relaunch_debt_settled()

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]
    assert ops_alert_open_store.pages == {}


async def test_the_relaunch_debt_dies_with_the_process_so_a_restart_settles_its_open_page(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """The debt set is process-local, so the new process owes nothing. If the
    previous process left a debt page open, the first healthy jobs reading ends it.
    """
    _seed_open_page(
        ops_alert_open_store, _DEBT_SOURCE, mt5_outage_alert.CAUSE_DEBT_LEASE_BUSY
    )

    await _observe(_AUTHORIZED)

    [page] = mt5_outage_pages
    assert page.source == _DEBT_SOURCE
    assert page.event == "recovered"
    assert ops_alert_open_store.pages == {}


async def test_a_debt_page_sent_by_this_process_is_not_settled_by_the_restart_check(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    """If THIS process has paged a debt, only the settle may end it."""
    await mt5_outage_alert.note_relaunch_debt_lease_busy(detail="d")

    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage"]
    assert _DEBT_SOURCE in ops_alert_open_store.pages


# --------------------------------------------------------------------------- #
# Review WR-R2-01 / SFH-N1 - a RECOVERED notice that reached no channel is not lost
#
# WHY: every recovery path is one-shot (the run is popped, the debt state cleared).
# A caller that closes its durable record on the strength of "page() returned" turns
# "the email route answered 502 and Sentry had no DSN" into a notice nobody re-sends.
# --------------------------------------------------------------------------- #


async def _fault_until_paged() -> None:
    for _ in range(_THRESHOLD):
        await _observe(_IPC_FAULT)


async def test_a_recovered_notice_that_reached_no_channel_keeps_the_record_and_is_sent_again(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    await _fault_until_paged()
    assert set(ops_alert_open_store.pages) == {_JOBS_SOURCE}
    mt5_outage_alert.ops_alert.page.delivers = False

    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]
    assert _JOBS_SOURCE in ops_alert_open_store.pages, "closed over an undelivered notice"
    assert ops_alert_open_store.close_calls == 0
    # Kept on purpose for the re-send: a new incident must replace it, not inherit it.
    assert ops_alert_open_store.stale == {_JOBS_SOURCE}

    mt5_outage_alert.ops_alert.page.delivers = True
    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered", "recovered"]
    assert ops_alert_open_store.stale == set()
    assert mt5_outage_pages[-1].cause == "recovered_from_ipc_fault"
    assert ops_alert_open_store.pages == {}
    await _observe(_AUTHORIZED)
    assert len(mt5_outage_pages) == 3, "a delivered notice is not repeated"


async def test_a_recovered_notice_with_no_sentry_event_and_an_email_502_is_sent_again(
    sink: Any,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The review's scenario through the REAL channel: Sentry returns no event id
    (no DSN), the founder-email route answers 502 for the recovered notice, then
    recovers. Expectations are typed by hand: three emails (outage, recovered that
    failed, recovered that landed), the record open after the second and gone
    after the third. This is the caller-level pin of the half of WR-R3-01 that D-16
    keeps: no Sentry event and no email means no credit."""
    from unittest.mock import MagicMock

    spy = MagicMock()
    spy.capture_message.return_value = None
    emails: list[str] = []
    answers = iter([True, False, True])

    async def _post(payload: dict[str, Any]) -> bool:
        emails.append(payload["event"])
        return next(answers)

    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "_post_founder_email", _post)
    monkeypatch.setattr(mt5_outage_alert, "ops_alert", ops_alert)
    ops_alert._reset_ops_alert_for_tests()
    try:
        await _fault_until_paged()
        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert _JOBS_SOURCE in ops_alert_open_store.pages
        assert ops_alert_open_store.close_calls == 0

        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()

        assert emails == ["outage", "recovered", "recovered"]
        assert ops_alert_open_store.pages == {}
    finally:
        ops_alert._reset_ops_alert_for_tests()


# --------------------------------------------------------------------------- #
# Review WR-R3-02 - the recovered notice says WHY it is being sent. An in-process
# re-send used to carry the restart sentence, so the founder went looking for a
# deploy or crash that never happened. Every expectation is typed by hand.
# --------------------------------------------------------------------------- #

_SINCE_T0 = "since=2026-10-13T12:00:00+00:00 duration_min=25"


async def test_a_recovered_notice_after_a_real_restart_says_the_service_restarted(
    sink: Any,
    clock: _Clock,
    ops_alert_open_store: Any,
    mt5_outage_pages: list[Any],
) -> None:
    ops_alert_open_store.pages[_JOBS_SOURCE] = ops_alert_open.OpenPage(
        source=_JOBS_SOURCE, cause="ipc_fault", since=_T0
    )
    clock.advance(minutes=25)

    await _observe(_AUTHORIZED)

    assert mt5_outage_pages[-1].detail == (
        "terminal=jobs recovered: the first MEASURED authorized reading "
        "(kind=already_authorized) after the analytics service restarted while a "
        f"page was open, {_SINCE_T0}"
    )


async def test_a_re_sent_recovered_notice_says_the_first_one_reached_no_channel(
    sink: Any,
    clock: _Clock,
    ops_alert_open_store: Any,
    mt5_outage_pages: list[Any],
) -> None:
    await _fault_until_paged()
    mt5_outage_alert.ops_alert.page.delivers = False
    await _observe(_AUTHORIZED)
    clock.advance(minutes=25)
    mt5_outage_alert.ops_alert.page.delivers = True

    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered", "recovered"]
    assert mt5_outage_pages[-1].detail == (
        "terminal=jobs recovered: the first MEASURED authorized reading "
        "(kind=already_authorized) after the recovered notice for this page reached "
        f"no channel, so this is a re-send, {_SINCE_T0}"
    )
    assert "restarted" not in mt5_outage_pages[-1].detail


async def test_a_retried_close_says_the_notice_was_sent_and_the_record_could_not_be_closed(
    sink: Any,
    clock: _Clock,
    ops_alert_open_store: Any,
    mt5_outage_pages: list[Any],
) -> None:
    await _fault_until_paged()
    ops_alert_open_store.close_fails = True
    await _observe(_AUTHORIZED)
    clock.advance(minutes=25)
    ops_alert_open_store.close_fails = False

    await _observe(_AUTHORIZED)

    assert mt5_outage_pages[-1].detail == (
        "terminal=jobs recovered: the first MEASURED authorized reading "
        "(kind=already_authorized) after the recovered notice for this page was sent "
        f"but its open-page record could not be closed, so this is a retried close, "
        f"{_SINCE_T0}"
    )
    assert "restarted" not in mt5_outage_pages[-1].detail


async def test_a_re_sent_relaunch_debt_notice_does_not_claim_a_restart(
    sink: Any,
    clock: _Clock,
    ops_alert_open_store: Any,
    mt5_outage_pages: list[Any],
) -> None:
    await mt5_outage_alert.note_relaunch_debt_lease_busy(detail="d")
    mt5_outage_alert.ops_alert.page.delivers = False
    await mt5_outage_alert.note_relaunch_debt_settled()
    clock.advance(minutes=25)
    mt5_outage_alert.ops_alert.page.delivers = True

    await _observe(_AUTHORIZED)

    assert mt5_outage_pages[-1].source == _DEBT_SOURCE
    assert mt5_outage_pages[-1].detail == (
        "terminal=jobs relaunch debt recovered: the first MEASURED authorized "
        "reading (kind=already_authorized) after the recovered notice for this page "
        f"reached no channel, so this is a re-send, {_SINCE_T0}"
    )


async def test_d16_a_recovered_notice_with_a_sentry_event_id_closes_the_record_while_email_fails(
    sink: Any,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-16, under D-15, through the REAL channel: the production state while the
    founder email is unconfigured. CONTEXT D-15: "Sentry is the only live paging
    channel for now." CONTEXT D-16: a RECOVERED notice counts as delivered once its
    Sentry capture succeeds. So the first healthy reading closes the open-page record,
    and the healthy readings after it send nothing, even though every email POST
    fails. Lineage: review WR-R3-01 had pinned the opposite direction (a re-send on
    every healthy reading, until a 2xx email) before the founder decided D-16 on
    2026-10-14. Expectations are typed by hand."""
    from unittest.mock import MagicMock

    spy = MagicMock()
    spy.capture_message.return_value = "synthetic-event-id"
    emails: list[str] = []

    async def _post(payload: dict[str, Any]) -> bool:
        emails.append(payload["event"])
        return False

    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "_post_founder_email", _post)
    monkeypatch.setattr(mt5_outage_alert, "ops_alert", ops_alert)
    ops_alert._reset_ops_alert_for_tests()
    try:
        await _fault_until_paged()
        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()
        await ops_alert._drain_ops_alert_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert ops_alert_open_store.pages == {}, "the credited recovery left its record open"
        assert ops_alert_open_store.close_calls == 1
        assert spy.capture_message.call_count == 2

        for _ in range(2):
            await _observe(_AUTHORIZED)
            await mt5_outage_alert._drain_recovery_tasks_for_tests()
            await ops_alert._drain_ops_alert_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert spy.capture_message.call_count == 2
        assert ops_alert_open_store.close_calls == 1
    finally:
        ops_alert._reset_ops_alert_for_tests()


def _unsettled_page(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Replace the tracker's ``page`` with one whose delivery outcome never settles
    until the test says so. Returns that outcome future."""
    import asyncio

    pending: asyncio.Future[bool] = asyncio.get_running_loop().create_future()

    async def _unsettled(*_a: Any, **_k: Any) -> Any:
        return pending

    monkeypatch.setattr(mt5_outage_alert.ops_alert, "page", _unsettled)
    return pending


async def test_a_healthy_reading_is_recorded_while_its_recovered_notice_is_still_unsettled(
    sink: Any, ops_alert_open_store: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review R3-SFH-01 / WR-R3-03. The healthy reading that ends an episode is the
    only measurement of the recovery. The tracker used to await the notice's delivery
    BEFORE `record_mt5_session_reading` wrote the episode row, so a slow founder
    email held the row back for the whole wait and a bound that cancelled it lost the
    measurement. The wait now happens off the reading path: the reading is recorded
    at once and the held task closes the record when the outcome arrives."""
    import asyncio

    await _fault_until_paged()
    pending = _unsettled_page(monkeypatch)

    await asyncio.wait_for(_observe(_AUTHORIZED), timeout=1.0)

    assert sink.states()[-1] == mt5_session_episodes.STATE_AUTHORIZED
    assert _JOBS_SOURCE in ops_alert_open_store.pages, "closed before delivery was known"

    pending.set_result(True)
    await mt5_outage_alert._drain_recovery_tasks_for_tests()

    assert ops_alert_open_store.pages == {}


async def test_a_recovery_task_cancelled_mid_wait_does_not_lose_the_notice(
    sink: Any,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The wait for a recovered notice's outcome runs in a held task, and that task
    is cancelled at shutdown. The boot reading marked the source 'checked'; a cancel
    that left it marked would lose the open page until the next restart, and one that
    left the row un-stale would let a new incident inherit it."""
    import asyncio

    await _observe(_AUTHORIZED)  # the boot reading: nothing open, source checked
    assert _JOBS_SOURCE in mt5_outage_alert._DURABLE_CHECKED
    await _fault_until_paged()
    _unsettled_page(monkeypatch)
    await _observe(_AUTHORIZED)
    [task] = list(mt5_outage_alert._RECOVERY_TASKS)

    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    assert _JOBS_SOURCE not in mt5_outage_alert._DURABLE_CHECKED
    assert _JOBS_SOURCE in ops_alert_open_store.pages
    assert ops_alert_open_store.stale == {_JOBS_SOURCE}


async def test_the_relaunch_debt_settle_is_not_held_behind_its_recovered_notice(
    sink: Any, ops_alert_open_store: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The debt heal path (`note_relaunch_debt_settled`) runs after the heal's own
    work inside the monitor tick's deadline; it must return without waiting for the
    notice's outcome."""
    import asyncio

    await mt5_outage_alert.note_relaunch_debt_lease_busy(detail="d")
    pending = _unsettled_page(monkeypatch)

    await asyncio.wait_for(mt5_outage_alert.note_relaunch_debt_settled(), timeout=1.0)

    assert _DEBT_SOURCE in ops_alert_open_store.pages
    pending.set_result(True)
    await mt5_outage_alert._drain_recovery_tasks_for_tests()
    assert ops_alert_open_store.pages == {}


async def test_a_relaunch_debt_recovered_notice_that_reached_no_channel_is_sent_again(
    sink: Any, ops_alert_open_store: Any, mt5_outage_pages: list[Any]
) -> None:
    await mt5_outage_alert.note_relaunch_debt_lease_busy(detail="d")
    mt5_outage_alert.ops_alert.page.delivers = False

    await mt5_outage_alert.note_relaunch_debt_settled()

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered"]
    assert _DEBT_SOURCE in ops_alert_open_store.pages
    assert ops_alert_open_store.close_calls == 0

    # The debt set is process-local and the settle already cleared this process's
    # page state, so the next healthy jobs reading is what re-sends the notice.
    mt5_outage_alert.ops_alert.page.delivers = True
    await _observe(_AUTHORIZED)

    assert [p.event for p in mt5_outage_pages] == ["outage", "recovered", "recovered"]
    assert mt5_outage_pages[-1].source == _DEBT_SOURCE
    assert ops_alert_open_store.pages == {}


# --------------------------------------------------------------------------- #
# Review WR-R2-02 - a close that fails is retried by the next healthy reading, and a
# row left open is never inherited by the next incident
# --------------------------------------------------------------------------- #


async def test_a_failed_close_is_retried_by_the_next_healthy_reading_without_a_second_email(
    sink: Any,
    ops_alert_open_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The boot reading found nothing open and marked the source 'checked'. The
    recovery's close then fails (a 5 s timeout, a lost compare-and-set). With the
    source still marked the `running` row would outlive the incident until the next
    deploy and send a spurious RECOVERED then. The source is unmarked on a failed
    close, so the next healthy reading closes the row; the window suppresses the
    duplicate email, so the founder gets exactly one recovered."""
    from unittest.mock import MagicMock

    spy = MagicMock()
    spy.capture_message.return_value = None
    emails: list[str] = []

    async def _post(payload: dict[str, Any]) -> bool:
        emails.append(payload["event"])
        return True

    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "_post_founder_email", _post)
    monkeypatch.setattr(mt5_outage_alert, "ops_alert", ops_alert)
    ops_alert._reset_ops_alert_for_tests()
    try:
        await _observe(_AUTHORIZED)  # boot: nothing open, source marked checked
        await _fault_until_paged()
        ops_alert_open_store.close_fails = True
        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()

        assert emails == ["outage", "recovered"]
        assert _JOBS_SOURCE in ops_alert_open_store.pages
        assert _JOBS_SOURCE not in mt5_outage_alert._DURABLE_CHECKED

        ops_alert_open_store.close_fails = False
        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()

        assert ops_alert_open_store.pages == {}
        assert emails == ["outage", "recovered"], "the duplicate is suppressed"
        reads = ops_alert_open_store.read_calls
        await _observe(_AUTHORIZED)
        await mt5_outage_alert._drain_recovery_tasks_for_tests()
        assert ops_alert_open_store.read_calls == reads, "closed: the sink is not read again"
    finally:
        ops_alert._reset_ops_alert_for_tests()


async def test_a_new_incident_does_not_inherit_the_cause_or_since_of_a_row_left_open(
    sink: Any,
    clock: _Clock,
    ops_alert_open_store: Any,
    mt5_outage_pages: list[Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Through the REAL record over a fake `cron_runs`. Incident one pages and its
    recovered notice reaches no channel, so its row stays open on purpose. Incident
    two begins before any healthy reading re-sends it. After a redeploy ends
    incident two, the recovered notice must name incident TWO's cause and start, not
    inherit incident one's across the healthy gap."""
    from tests.test_mt5_relogin import _FakeCronRuns as _CronRuns

    cron = _CronRuns()
    monkeypatch.setattr(ops_alert_open, "get_supabase", lambda: cron)
    for name, real in _REAL_OPEN_PAGE_FUNCTIONS.items():
        monkeypatch.setattr(ops_alert_open, name, real)
    ops_alert_open._STALE_SOURCES.clear()
    try:
        first_start = clock.now
        await _fault_until_paged()
        mt5_outage_alert.ops_alert.page.delivers = False
        await _observe(_AUTHORIZED)  # recovered, no channel: the row stays open

        mt5_outage_alert.ops_alert.page.delivers = True
        clock.advance(hours=3)
        second_start = clock.now
        for _ in range(_THRESHOLD):
            await _observe(_DARK)

        # A redeploy ends incident two: a fresh process, a healthy first reading.
        mt5_outage_alert._reset_outage_state_for_tests()
        await _observe(_AUTHORIZED)

        recovered = [p for p in mt5_outage_pages if p.event == "recovered"][-1]
        assert recovered.cause == "recovered_from_dark"
        assert recovered.since == second_start
        assert recovered.since != first_start
        assert [r["status"] for r in cron.rows] == ["ok", "ok"]
    finally:
        ops_alert_open._STALE_SOURCES.clear()


def _all_kind_constants() -> list[str]:
    return sorted(
        {
            value
            for name, value in vars(mt5_session_episodes).items()
            if name.startswith("KIND_") and isinstance(value, str)
        }
    )


@pytest.mark.parametrize("kind", _all_kind_constants())
def test_every_reading_kind_is_a_valid_alert_cause_and_so_is_its_recovery(
    kind: str,
) -> None:
    """``ops_alert`` collapses a cause outside its charset to ``unrecognised``, and
    that would merge unrelated outages into one Sentry issue and one hourly window.
    The cause is the reading's own kind, so every kind (and its ``recovered_from_``
    form, which is longer) must fit the charset."""
    import re

    cause = mt5_outage_alert._cause_for("not_measured", kind)
    tail = cause[: mt5_outage_alert._RECOVERED_CAUSE_TAIL_MAX]
    assert re.fullmatch(ops_alert.OPS_ALERT_CAUSE_RE, cause), cause
    assert re.fullmatch(
        ops_alert.OPS_ALERT_CAUSE_RE, mt5_outage_alert._RECOVERED_PREFIX + tail
    )


def test_both_roles_map_to_a_source_the_alert_route_accepts() -> None:
    """A source outside ``OPS_ALERT_SOURCES`` is paged as ``unrecognised`` and the
    TS route would 400 anything not in its mirror of the set."""
    assert set(mt5_outage_alert._SOURCE_BY_ROLE) == {
        mt5_outage_alert.ROLE_JOBS,
        mt5_outage_alert.ROLE_VALIDATION,
    }
    assert set(mt5_outage_alert._SOURCE_BY_ROLE.values()) <= ops_alert.OPS_ALERT_SOURCES


def test_the_tracker_decides_with_the_episode_modules_own_threshold_and_decided_set() -> None:
    """D-04/D-05: no second number and no second decided-kind list. The tracker
    must USE the episode module's objects, not copies that can drift."""
    assert (
        mt5_outage_alert.blind_run_escalation_threshold
        is mt5_session_episodes.blind_run_escalation_threshold
    )
    assert (
        mt5_outage_alert._DECIDED_BLIND_KINDS
        is mt5_session_episodes._DECIDED_BLIND_KINDS
    )


# --------------------------------------------------------------------------- #
# Import order and the never-raises shape
# --------------------------------------------------------------------------- #

_CYCLE_MODULES = (
    "services.mt5_outage_alert",
    "services.mt5_session_episodes",
    "services.mt5_relogin",
    "services.mt5_session_monitor",
)
_SERVICE_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent


def test_the_four_modules_import_in_every_order_in_a_fresh_interpreter() -> None:
    """The tracker imports the episodes at module level and the episodes import the
    tracker inside a function, to avoid a cycle. A module-level import added on
    either side later turns one import order into an ImportError, and the usual
    suite never notices because pytest has already imported everything in ONE
    order. A fresh interpreter per order (all 24) is the only thing that does."""
    # ⚠️ BOUNDED concurrency (two at a time), not all 24 at once: this file shares
    # an xdist worker pool with the monitor tests, whose 0.0 s test cadence is a
    # timing race, and a burst of 24 interpreters starved them into a flake
    # (measured while executing plan 04).
    def _import_in_order(order: tuple[str, ...]) -> tuple[tuple[str, ...], list[str]]:
        code = "import importlib\n" + "".join(
            f"importlib.import_module({name!r})\n" for name in order
        )
        # The verdict is the child's exit code, never how long it took;
        # `run_child` carries only the shared DEADMAN, which names this test if the
        # child hangs.
        done = run_child(
            f"the four MT5 modules import in the order {order} in a fresh interpreter",
            [sys.executable, "-c", code],
            cwd=_SERVICE_ROOT,
        )
        # ⛔ The RETURN CODE is the verdict, not the stderr text: a child killed
        # by the OOM killer (-9), a segfault or an `os._exit` exits non-zero with
        # EMPTY stderr, and a verdict read off stderr would call that a pass.
        if done.returncode == 0:
            return order, []
        stderr_lines = done.stderr.strip().splitlines()
        last = stderr_lines[-1] if stderr_lines else "<empty stderr>"
        return order, [f"rc={done.returncode}: {last}"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        failures = [
            (order, err)
            for order, err in pool.map(_import_in_order, permutations(_CYCLE_MODULES))
            if err
        ]
    assert failures == []


_TRACKER_ENTRY_POINTS = (
    mt5_outage_alert.note_outage_reading,
    mt5_outage_alert.note_wedge_evidence,
    mt5_outage_alert.note_recycle_file_versions,
)


@pytest.mark.parametrize("symbol", _TRACKER_ENTRY_POINTS, ids=lambda s: s.__name__)
def test_each_tracker_entry_point_satisfies_the_shared_never_raises_predicate(
    symbol: Any,
) -> None:
    """The tracker runs inside the never-raises heal and monitor path. Same ONE
    predicate the recorder is held to, never a copy."""
    from tests.test_mt5_relogin import _heal_guard_defects

    source = textwrap.dedent(inspect.getsource(symbol))
    assert _heal_guard_defects(source, required_names=()) == [], symbol.__name__


def test_the_hook_is_one_function_local_import_inside_the_recorders_single_try() -> None:
    """The episodes module must not import the tracker at module level (cycle) and
    the recorder's body must stay exactly one ``try`` (the never-raises gate)."""
    tree = ast.parse(inspect.getsource(mt5_session_episodes))
    module_level = [
        node
        for node in tree.body
        if isinstance(node, (ast.Import, ast.ImportFrom))
        and "mt5_outage_alert" in ast.dump(node)
    ]
    assert module_level == [], "a module-level import of the tracker is a cycle"

    source = inspect.getsource(mt5_session_episodes.record_mt5_session_reading)
    assert source.count("note_outage_reading(") == 1


# --------------------------------------------------------------------------- #
# Task 3 - the page carries the pre-recycle wedge evidence, scrubbed (D-13)
# --------------------------------------------------------------------------- #

_JOBS = mt5_outage_alert.ROLE_JOBS


def _stash(role: str = _JOBS) -> Any:
    return mt5_outage_alert._RUNS[role]


async def _reach_the_threshold(reading: tuple[str, int | None] = _IPC_FAULT) -> None:
    for _ in range(_THRESHOLD):
        await _observe(reading)


async def test_a_fragment_stashed_by_the_heal_reaches_the_page_sent_in_the_same_run(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """D-13. The recycle erases the wedge evidence, and the page is sent later,
    outside the lease, where the terminal must not be touched. So the page can
    only carry what was stashed BEFORE the recycle."""
    mt5_outage_alert.note_wedge_evidence(
        _JOBS, "build=6182 connected=False session_server_matches_env=True"
    )
    await _reach_the_threshold()

    assert len(mt5_outage_pages) == 1
    assert "build=6182 connected=False session_server_matches_env=True" in (
        mt5_outage_pages[0].detail
    )


async def test_without_a_stash_the_page_says_the_evidence_was_not_captured(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """A page that is silent about evidence reads as if none was wanted. The
    honest text names WHY it is absent (no recycle ran in this run)."""
    await _reach_the_threshold()

    assert "no recycle ran in this outage run" in mt5_outage_pages[0].detail


async def test_only_the_first_fragment_of_a_run_is_kept(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """The snapshot that matters is the one taken BEFORE the first recycle. A
    second recycle attempt in the same run would otherwise overwrite it with a
    post-recycle reading, which is exactly the evidence D-13 exists to keep."""
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=FIRST connected=False")
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=SECOND connected=True")
    await _reach_the_threshold()

    detail = mt5_outage_pages[0].detail
    assert "build=FIRST" in detail
    assert "build=SECOND" not in detail


async def test_run_initialisation_preserves_a_stash_made_before_the_run_opened(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """Ordering. The stash is written from the heal's worker thread BEFORE the
    reading reaches the event loop, so the stash arrives with no run open. A run
    that started by replacing its state would lose the evidence every time."""
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=EARLY connected=False")
    assert _stash().count == 0, "precondition: no run is open yet"

    await _observe(_IPC_FAULT)
    assert _stash().count == 1
    assert _stash().evidence == "build=EARLY connected=False"


async def test_a_measured_authorized_reading_clears_the_stash(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """A stash that survived recovery would put the NEXT, unrelated outage's page
    in front of a stale build and a stale server comparison."""
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=STALE connected=False")
    mt5_outage_alert.note_recycle_file_versions(_JOBS, "[[5, 0, 0, 1111]]")
    await _observe(_AUTHORIZED)
    assert _JOBS not in mt5_outage_alert._RUNS

    await _reach_the_threshold()
    detail = mt5_outage_pages[0].detail
    assert "STALE" not in detail and "1111" not in detail


async def test_file_versions_is_its_own_field_that_keeps_the_latest_value(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """The bridge-side file version is read by the recycle itself, AFTER the
    pre-recycle capture, so it cannot be subject to the first-fragment rule. A
    second recycle updates it; the first pre-recycle fragment stays unchanged."""
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=BEFORE connected=False")
    mt5_outage_alert.note_recycle_file_versions(_JOBS, "[[5, 0, 0, 6001]]")
    mt5_outage_alert.note_wedge_evidence(_JOBS, "build=BEFORE-2 connected=False")
    mt5_outage_alert.note_recycle_file_versions(_JOBS, "[[5, 0, 0, 6002]]")
    await _reach_the_threshold()

    detail = mt5_outage_pages[0].detail
    assert "build=BEFORE connected=False" in detail
    assert "BEFORE-2" not in detail
    assert "[[5, 0, 0, 6002]]" in detail
    assert "6001" not in detail


async def test_the_evidence_reaching_the_page_is_scrubbed_of_digits_server_and_paths(
    sink: Any, monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """T-164.6.8-17 / D-13. The page goes to email and Sentry. A 9-digit run is
    an account number, the configured broker server is private, and a Windows
    path names the machine. file_versions can carry a path too."""
    monkeypatch.setenv("MT5_SERVER", "Acme-Prime-Live")
    mt5_outage_alert.note_wedge_evidence(
        _JOBS,
        "build=6182 login=123456789 server=Acme-Prime-Live "
        "at C:\\Users\\trader\\AppData\\MetaQuotes\\terminal64.exe",
    )
    mt5_outage_alert.note_recycle_file_versions(
        _JOBS, "[[5, 0, 0, 6182]] D:/MT5/terminal64.exe"
    )
    await _reach_the_threshold()

    detail = mt5_outage_pages[0].detail
    for leaked in ("123456789", "Acme-Prime-Live", "trader", "AppData", "D:/MT5"):
        assert leaked not in detail, f"{leaked!r} reached the page: {detail}"
    assert "build=6182" in detail, "the scrub removed the useful evidence too"


async def test_the_ipc_fault_code_survives_the_digit_scrub_in_the_page(
    sink: Any, mt5_outage_pages: list[Any]
) -> None:
    """The IPC codes (-10003 .. -10005) are five digits, exactly what the account
    number scrub removes. Without the thousands-separator formatting the page
    would say ``code=-<digits>`` and the wedge calibration (which needs to know
    WHICH code) would lose its one discriminating field."""
    from services.ops_alert import scrub_alert_detail

    await _reach_the_threshold()

    assert "code=-10,005" in mt5_outage_pages[0].detail
    assert "code=-10,005" in scrub_alert_detail(mt5_outage_pages[0].detail)


@pytest.mark.parametrize(
    "stash_name",
    ["note_wedge_evidence", "note_recycle_file_versions"],
)
async def test_a_stash_call_that_raises_changes_nothing_about_the_escalation(
    sink: Any, monkeypatch: pytest.MonkeyPatch, stash_name: str
) -> None:
    """T-164.6.8-18. ``_escalate_ipc_fault`` runs inside the never-raises heal; the
    stash is a courtesy to the page and must not alter the recycle or its kind."""
    from collections import namedtuple

    terminal = namedtuple("TerminalInfo", "build connected")(6182, False)
    account = namedtuple("AccountInfo", "login server")(0, _FAKE_SERVER)
    scenario = {**_WEDGED, "terminal_info": terminal, "account_info": account}

    async def _one_heal() -> tuple[Any, list[str]]:
        # A fresh process-state per heal: the first heal leaves a relaunch debt
        # and a disarmed escalation gate, which would turn the second heal into a
        # different code path and make the comparison meaningless.
        from services import mt5_concurrency

        mt5_concurrency.reset_terminal_state_for_tests()
        mt5_relogin._reset_relogin_log_throttle_for_tests()
        mt5_session_episodes._reset_session_episode_state_for_tests()
        fake, _c = _install_client(monkeypatch, dict(scenario))
        outcomes = _capture_outcomes(monkeypatch)
        await _heal_n_times(1)
        return outcomes[0].escalation_kind, list(fake.call_order)

    _set_full_env(monkeypatch)
    baseline = await _one_heal()
    assert baseline[0] is not None, "precondition: the escalation ran"

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("the stash is broken")

    monkeypatch.setattr(mt5_relogin, stash_name, _boom)
    assert await _one_heal() == baseline


async def test_the_real_escalation_stashes_its_pre_recycle_evidence_and_the_page_carries_it(
    sink: Any, monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list[Any]
) -> None:
    """END TO END through ``_escalate_ipc_fault``: the heal captures the build and
    server comparison BEFORE the recycle, stashes it for the jobs role, and the
    recycle's own bridge-side file versions follow. A page sent after the run
    reaches its threshold carries both."""
    from collections import namedtuple

    terminal = namedtuple("TerminalInfo", "build connected")(6182, False)
    account = namedtuple("AccountInfo", "login server")(
        int(_FAKE_LOGIN), _FAKE_SERVER
    )
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch, {**_WEDGED, "terminal_info": terminal, "account_info": account}
    )
    _capture_outcomes(monkeypatch)
    await _heal_n_times(1)

    stashed = _stash()
    assert stashed.evidence is not None and "build=6182" in stashed.evidence
    assert "session_server_matches_env=" in stashed.evidence
    assert stashed.file_versions == "[[5, 0, 0, 6182]]"

    await _reach_the_threshold()
    detail = mt5_outage_pages[0].detail
    assert "build=6182" in detail
    assert _FAKE_SERVER not in detail
