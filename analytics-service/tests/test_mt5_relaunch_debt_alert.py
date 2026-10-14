"""Phase 164.6.8 plan 07 (OUTAGEALERT, D-14) -- a relaunch debt behind a busy lease
waits the CEILING, logs the ERROR, and PAGES a human.

WHY THIS FILE EXISTS. `heal_mt5_terminal_session` pays the relaunch debt only
AFTER it wins the terminal lease. Against a scrubbed, unverified jobs terminal the
jobs hold the lease for 25-30 s per credential-less `initialize()`, so the heal's
2 s bounded acquire can expire on EVERY tick. 164.6.6.1 (`377353b2c`, #950) made
that tick log an ERROR (pinned by `test_T15_a_BUSY_tick_with_a_relaunch_debt_owed_
logs_ERROR_and_never_session_is_fine`, which this plan does not touch). Two things
were still open, and they are this file's subject:

* `MT5-RELAUNCH-DEBT-LEASE-WAIT-01` -- the acquire waited the same 2 s with a debt
  owed as without one. While a debt is owed the heal waits up to
  `_MT5_RELOGIN_LEASE_WAIT_CEILING_S`, one rpyc round trip, the documented bound of
  "waiting for a terminal somebody else is driving". With NO debt the wait is the
  unchanged `_relogin_lease_wait_s()`: raising the default for every tick is the
  thing the TODOS gate names as NOT a close (D-29).
* SC-2 -- an ERROR log alone reaches a human only through a Sentry rule nobody has
  verified. The busy-with-debt arm now also pages through `ops_alert` (source
  `mt5_relaunch_debt`), and the first heal that pays the debt after a page sends
  one recovered notice (D-06).

The autouse `mt5_outage_pages` fixture (conftest) records every page the tracker
module sends, so no test here reaches Sentry or the founder-email route.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from services import (
    mt5_client,
    mt5_outage_alert,
    mt5_relogin,
    mt5_session_episodes,
    mt5_session_monitor,
    ops_alert,
)
from services.mt5_concurrency import Mt5TerminalBusyError
from tests.test_mt5_relogin import (  # noqa: F401 - _reset_state is an autouse fixture
    _HOUSE_ACCOUNT,
    _HOUSE_TERMINAL,
    _LOGGER_NAME,
    _FAKE_HOST,
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_PORT,
    _WEDGED,
    _capture_outcomes,
    _heal_terminal_key,
    _install_client,
    _owe_relaunch_debt,
    _records,
    _reset_state,
    _set_full_env,
)

_CEILING_S = mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
_T0 = datetime(2026, 10, 14, 9, 0, 0, tzinfo=timezone.utc)


class _Clock:
    """The tracker's wall clock, driven by the test. NOT an iterator: the busy
    reading's own tracker call reads `_utcnow` too, so a fixed-length iterator
    runs dry mid-test and the swallowed `StopIteration` hides the page."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now = self.now + timedelta(**kwargs)


_DEBT_SOURCE = "mt5_relaunch_debt"


def _busy_lease(monkeypatch: pytest.MonkeyPatch) -> list[float | None]:
    """A lease that is always taken by somebody else. Returns the `wait_s` it was
    asked to wait, one entry per acquire."""
    waits: list[float | None] = []

    @asynccontextmanager
    async def _busy(terminal_key: str, *, wait_s=None, holder=None, site=None):
        waits.append(wait_s)
        raise Mt5TerminalBusyError(
            "the MT5 terminal was still in use when the acquisition bound expired"
        )
        yield  # pragma: no cover - keeps this a generator

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", _busy)
    return waits


async def test_TRACER_a_busy_tick_with_a_debt_owed_waits_the_ceiling_logs_ERROR_and_pages(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    mt5_outage_pages: list,
) -> None:
    """The whole slice, end to end: debt owed + lease always busy.

    The env override is set BELOW the ceiling on purpose: if the debt arm merely
    honoured `MT5_RELOGIN_LEASE_WAIT_S` this would read 0.5, not the ceiling.
    """
    monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", "0.5")
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    waits = _busy_lease(monkeypatch)
    _owe_relaunch_debt()

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert waits == [_CEILING_S], (
        f"the lease was requested with wait_s={waits!r}; while a relaunch debt is "
        f"owed the heal must wait the ceiling ({_CEILING_S}) so the jobs that hold "
        "the terminal can release it (MT5-RELAUNCH-DEBT-LEASE-WAIT-01)"
    )
    errors = [
        r
        for r in _records(caplog)
        if r.levelno == logging.ERROR and "relaunch debt OUTSTANDING" in r.getMessage()
    ]
    assert len(errors) == 1, [r.getMessage() for r in _records(caplog)]
    pages = [p for p in mt5_outage_pages if p.source == _DEBT_SOURCE]
    assert len(pages) == 1, mt5_outage_pages
    assert pages[0].event == "outage"
    assert pages[0].cause == "lease_busy_with_relaunch_debt"
    assert pages[0].since is not None


# --------------------------------------------------------------------------- #
# The two wait arms. Each is its own test: a single parametrized "debt or not"
# test would read green if both arms were swapped, because both would still pass
# through the same `wait_s ==` assertion with their expectations exchanged.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "env_value,expected",
    [
        pytest.param(None, mt5_relogin._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S, id="default"),
        pytest.param("5", 5.0, id="env-override-honoured"),
        # `_env_float` REJECTS an out-of-window value (back to the default); it does
        # not clamp. Both ends are pinned so a change to that posture shows here.
        pytest.param(
            "0.0001",
            mt5_relogin._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
            id="env-override-below-its-floor-falls-back",
        ),
        pytest.param(
            "100000",
            mt5_relogin._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
            id="env-override-above-its-ceiling-falls-back",
        ),
    ],
)
async def test_with_NO_debt_the_lease_wait_is_the_unchanged_relogin_lease_wait(
    monkeypatch: pytest.MonkeyPatch,
    mt5_outage_pages: list,
    env_value: str | None,
    expected: float,
) -> None:
    """D-29 / the TODOS "Not a close": raising the wait for EVERY tick would delay
    the jobs the same lease serves on a healthy terminal. No debt, no change --
    including the operator's own override, honoured inside its floor and ceiling.
    """
    if env_value is None:
        monkeypatch.delenv("MT5_RELOGIN_LEASE_WAIT_S", raising=False)
    else:
        monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", env_value)
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    waits = _busy_lease(monkeypatch)
    assert not mt5_client.mt5_relaunch_debt(_heal_terminal_key())

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert waits == [expected], waits
    assert waits == [mt5_relogin._relogin_lease_wait_s()]
    assert mt5_outage_pages == [], "a busy tick with NO debt paged"


@pytest.mark.parametrize("env_value", [None, "0.2", "5", "100000"])  # in and out of window
async def test_with_a_debt_owed_the_lease_wait_is_the_ceiling_whatever_the_env_says(
    monkeypatch: pytest.MonkeyPatch,
    env_value: str | None,
) -> None:
    if env_value is None:
        monkeypatch.delenv("MT5_RELOGIN_LEASE_WAIT_S", raising=False)
    else:
        monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", env_value)
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    waits = _busy_lease(monkeypatch)
    _owe_relaunch_debt()

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert waits == [_CEILING_S], waits


async def test_the_starting_line_names_the_chosen_wait_and_carries_no_host_or_port(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The reason is logged in the existing "starting" line (a separate INFO line
    would break the outcome-record census the T15 test relies on)."""
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _busy_lease(monkeypatch)
    _owe_relaunch_debt()

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await mt5_relogin.heal_mt5_terminal_session()

    (starting,) = [
        r.getMessage() for r in _records(caplog) if "starting" in r.getMessage()
    ]
    assert "relaunch debt owed, so the ceiling" in starting, starting
    assert f"{_CEILING_S:.1f}s" in starting, starting
    assert _FAKE_HOST not in starting and _FAKE_PORT not in starting, starting


# --------------------------------------------------------------------------- #
# The page: what it carries, how often, and what it never carries.
# --------------------------------------------------------------------------- #


async def test_every_busy_tick_calls_page_and_keeps_the_FIRST_tick_as_since(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    """D-05: the helper's hourly window bounds the captures, so the tracker calls
    `page` on every tick. `since` names the INCIDENT (its first tick), not the
    latest one, and the detail counts the ticks."""
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _busy_lease(monkeypatch)
    _owe_relaunch_debt()
    clock = _Clock(_T0)
    monkeypatch.setattr(mt5_outage_alert, "_utcnow", clock)

    for _ in range(3):
        assert await mt5_relogin.heal_mt5_terminal_session() is None
        clock.advance(minutes=10)

    assert len(mt5_outage_pages) == 3, mt5_outage_pages
    assert {p.since for p in mt5_outage_pages} == {_T0}
    assert [f"busy_ticks={n}" in p.detail for n, p in enumerate(mt5_outage_pages, 1)] == [
        True,
        True,
        True,
    ]


async def test_the_page_names_the_incident_and_never_carries_a_host_a_port_or_a_credential(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _busy_lease(monkeypatch)
    _owe_relaunch_debt()

    await mt5_relogin.heal_mt5_terminal_session()

    (page,) = mt5_outage_pages
    text = f"{page.source} {page.cause} {page.event} {page.detail}"
    assert "terminal=jobs" in page.detail and "relaunch debt OUTSTANDING" in page.detail
    for forbidden in (
        _FAKE_HOST,
        _FAKE_PORT,
        _FAKE_LOGIN,
        _FAKE_PASSWORD,
    ):
        assert forbidden not in text, (forbidden, text)


def test_the_debt_source_and_both_causes_are_admitted_by_the_alert_helper() -> None:
    """A source or cause the helper does not recognise is paged as `unrecognised`
    (or its cause is rewritten), which would silently detach this page from its
    own Sentry fingerprint."""
    import re

    assert mt5_outage_alert.SOURCE_RELAUNCH_DEBT == _DEBT_SOURCE
    assert _DEBT_SOURCE in ops_alert.OPS_ALERT_SOURCES
    pattern = re.compile(ops_alert.OPS_ALERT_CAUSE_RE)
    for cause in (
        mt5_outage_alert.CAUSE_DEBT_LEASE_BUSY,
        mt5_outage_alert._RECOVERED_PREFIX + mt5_outage_alert.CAUSE_DEBT_LEASE_BUSY,
    ):
        assert pattern.fullmatch(cause), cause


# --------------------------------------------------------------------------- #
# Recovery (D-06): paid after a page -> exactly one recovered notice.
# --------------------------------------------------------------------------- #

_DEBT_PAID_BY_THE_HEAL = {
    **_WEDGED,
    "terminal_info": _HOUSE_TERMINAL,
    "account_info": _HOUSE_ACCOUNT,
}


async def test_a_debt_paid_after_a_page_sends_exactly_one_recovered_notice(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    """Tick 1: lease busy, debt owed -> outage page. Tick 2: the heal wins the
    lease, the house-verified relaunch pays the debt -> ONE recovered page. Tick 3
    (nothing owed) sends nothing more."""
    real_lease = mt5_relogin.mt5_terminal_lease
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, _DEBT_PAID_BY_THE_HEAL)
    _capture_outcomes(monkeypatch)
    key = _owe_relaunch_debt()
    _busy_lease(monkeypatch)

    await mt5_relogin.heal_mt5_terminal_session()
    assert [(p.event, p.cause) for p in mt5_outage_pages] == [
        ("outage", "lease_busy_with_relaunch_debt")
    ]
    assert mt5_client.mt5_relaunch_debt(key) is True

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", real_lease)
    await mt5_relogin.heal_mt5_terminal_session()

    assert mt5_client.mt5_relaunch_debt(key) is False
    assert [(p.event, p.cause) for p in mt5_outage_pages] == [
        ("outage", "lease_busy_with_relaunch_debt"),
        ("recovered", "recovered_from_lease_busy_with_relaunch_debt"),
    ], mt5_outage_pages
    recovered = mt5_outage_pages[1]
    assert recovered.source == _DEBT_SOURCE
    assert recovered.since == mt5_outage_pages[0].since
    assert "1 tick(s)" in recovered.detail, recovered.detail

    await mt5_relogin.heal_mt5_terminal_session()
    assert len(mt5_outage_pages) == 2, "a settled debt notified again"


async def test_a_debt_paid_with_NO_prior_page_sends_no_recovered_notice(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    """A recovery without an outage is noise: the founder was never told."""
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, _DEBT_PAID_BY_THE_HEAL)
    _capture_outcomes(monkeypatch)
    key = _owe_relaunch_debt()

    await mt5_relogin.heal_mt5_terminal_session()

    assert mt5_client.mt5_relaunch_debt(key) is False
    assert mt5_outage_pages == []


async def test_a_debt_still_owed_after_a_won_lease_sends_no_recovered_notice(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    """The heal won the lease but the credentialed relaunch did not verify, so the
    debt is still owed: "recovered" would be a false all-clear."""
    real_lease = mt5_relogin.mt5_terminal_lease
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {"initialize": False, "initialize_credentialed": False},
    )
    _capture_outcomes(monkeypatch)
    key = _owe_relaunch_debt()
    _busy_lease(monkeypatch)
    await mt5_relogin.heal_mt5_terminal_session()
    assert len(mt5_outage_pages) == 1

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", real_lease)
    await mt5_relogin.heal_mt5_terminal_session()

    assert mt5_client.mt5_relaunch_debt(key) is True
    assert [p.event for p in mt5_outage_pages] == ["outage"], mt5_outage_pages


async def test_a_second_incident_after_a_recovery_starts_with_its_own_since(
    monkeypatch: pytest.MonkeyPatch, mt5_outage_pages: list
) -> None:
    real_lease = mt5_relogin.mt5_terminal_lease
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, _DEBT_PAID_BY_THE_HEAL)
    _capture_outcomes(monkeypatch)
    clock = _Clock(_T0)
    monkeypatch.setattr(mt5_outage_alert, "_utcnow", clock)

    _owe_relaunch_debt()
    _busy_lease(monkeypatch)
    await mt5_relogin.heal_mt5_terminal_session()  # first incident at T0
    clock.advance(hours=1)
    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", real_lease)
    await mt5_relogin.heal_mt5_terminal_session()  # recovered
    clock.advance(hours=1)
    _owe_relaunch_debt()
    _busy_lease(monkeypatch)
    await mt5_relogin.heal_mt5_terminal_session()  # second incident at T0 + 2h

    outage_sinces = [p.since for p in mt5_outage_pages if p.event == "outage"]
    assert outage_sinces == [_T0, _T0 + timedelta(hours=2)], mt5_outage_pages


# --------------------------------------------------------------------------- #
# Never raises (T-164.6.8-32): an alert that fails must not change the heal.
# --------------------------------------------------------------------------- #


def _raising(name: str):
    async def _boom(**_k: object) -> None:
        raise RuntimeError(f"{name} blew up")

    return _boom


@pytest.mark.parametrize(
    "target",
    [
        pytest.param("note_relaunch_debt_lease_busy", id="the-busy-notifier-raises"),
    ],
)
async def test_a_busy_notifier_that_raises_leaves_the_heal_returning_None_and_the_reading_recorded(
    monkeypatch: pytest.MonkeyPatch, target: str
) -> None:
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _busy_lease(monkeypatch)
    _owe_relaunch_debt()
    monkeypatch.setattr(mt5_relogin, target, _raising(target))
    recorded: list[str] = []

    async def _record(kind: str, _code: object, **_k: object) -> None:
        recorded.append(kind)

    monkeypatch.setattr(mt5_relogin, "record_mt5_session_reading", _record)

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert recorded == [mt5_session_episodes.KIND_BUSY_SKIP], recorded


async def test_a_page_that_raises_inside_the_tracker_leaves_the_busy_reading_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same property one layer down: `ops_alert.page` itself raising."""
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _busy_lease(monkeypatch)
    _owe_relaunch_debt()

    async def _boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("page blew up")

    monkeypatch.setattr(
        mt5_outage_alert,
        "ops_alert",
        type("_Stub", (), {"page": staticmethod(_boom)})(),
    )
    recorded: list[str] = []

    async def _record(kind: str, _code: object, **_k: object) -> None:
        recorded.append(kind)

    monkeypatch.setattr(mt5_relogin, "record_mt5_session_reading", _record)

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert recorded == [mt5_session_episodes.KIND_BUSY_SKIP], recorded


async def test_a_settled_notifier_that_raises_leaves_the_heal_returning_None(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, _DEBT_PAID_BY_THE_HEAL)
    outcomes = _capture_outcomes(monkeypatch)
    key = _owe_relaunch_debt()
    monkeypatch.setattr(
        mt5_relogin, "note_relaunch_debt_settled", _raising("note_relaunch_debt_settled")
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert len(outcomes) == 1, "the heal's own outcome was lost to the alert"
    assert mt5_client.mt5_relaunch_debt(key) is False
    assert any(
        "the relaunch-debt alert failed" in r.getMessage() for r in _records(caplog)
    )


# --------------------------------------------------------------------------- #
# T-164.6.8-31: the monitor's interval floor still covers the longer wait.
# --------------------------------------------------------------------------- #


def test_the_monitor_poll_interval_floor_still_covers_the_lease_ceiling_plus_the_budget_ceiling() -> None:
    """The structural bound `interval >= lease wait + budget` that makes a monitor
    tick unable to overrun its own interval. The debt arm waits the CEILING, so the
    floor must be at least ceiling + budget ceiling, derived from the two constants
    and not restated as a number. A later change to either constant that left the
    floor behind would make the longer wait overrun the cadence silently."""
    floor = mt5_session_monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    assert floor >= (
        mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
        + mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
    ), floor
    # And the wait the debt arm actually asks for IS that ceiling, never above it.
    assert mt5_relogin._relogin_lease_wait_s() <= mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
