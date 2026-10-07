"""Phase 164.6.6.1 plan 05 — the VALIDATION terminal's post-verdict scrub
(`services/mt5_terminal_scrub.py`, founder D-08).

WHAT IS UNDER TEST. After a validation's verdict, a supervised background task
takes the validation terminal's lease for ``house``, deletes its saved-account
database and every per-account deal cache, relaunches it with the HOUSE
credentials, and verifies that by the house-equality snapshot. A "scrub owed"
mark is set when the scrub is scheduled and cleared ONLY by a clean, verified
scrub, so a missed scrub is visible to the next validation.

WHY EACH GATE MATTERS:
  * W-1: a scrub that crossed while an abandoned validation probe thread was
    still logging a client in would delete ``accounts.dat`` and the probe could
    write it straight back, leaving the client's login on the terminal while the
    mark says it is gone. So nothing may cross while any registered probe event
    is unset, including one registered by an EARLIER request.
  * Every non-scrubbed exit keeps the mark, alerts and writes a row: a scrub
    that silently did not happen is the defect this phase removes.
  * The task never raises: it is not in ``main.lifespan``'s task list, but a
    raise would still be an unobserved task exception, and the same predicate
    pins all the never-raises symbols.
  * Secret hygiene: the repo is PUBLIC; no row, log or alert may carry the
    login, password, server, host, port or terminal key.

DOUBLES, not mocks. The REAL `Mt5Client` runs against `tests.test_mt5_relogin`'s
in-memory MT5 double through the `_connect` seam, so the real scrub verb, the
real fence and the real credentialed relaunch are exercised and only the wire is
faked. The doubles are imported BY SYMBOL and never copied
(`tests/test_mt5_handover.py`'s precedent); that module's autouse fixtures are
NOT imported, so this module installs its own.

⛔ Every credential and endpoint below is obviously synthetic.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from services import (
    mt5_client,
    mt5_concurrency,
    mt5_handover,
    mt5_relogin,
    mt5_terminal_scrub,
)
from services.mt5_client import (
    HOLDER_HOUSE,
    HOLDER_VALIDATION,
    Mt5Client,
    mt5_relaunch_debt,
    mt5_scrub_owed,
    mt5_terminal_key,
)
from services.mt5_handover import SITE_VALIDATE_WIZARD, SITE_VALIDATE_WORKER
from tests.test_mt5_relogin import (
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_SERVER,
    _HOUSE_ACCOUNT,
    _HOUSE_TERMINAL,
    _OTHER_LOGIN_ACCOUNT,
    _FakeClock,
    _FakeCronRuns,
    _FakeMt5,
    _set_full_env,
)

#: The validation gateway, obviously synthetic and distinct from the job
#: gateway `_set_full_env` sets.
_VAL_HOST = "validation-gateway.test"
_VAL_PORT = 18813
_VAL_KEY = mt5_terminal_key(_VAL_HOST, _VAL_PORT)

_LOGGER_NAME = "quantalyze.analytics.mt5_terminal_scrub"

#: Every value that may never reach a row, a log record or an alert.
_FORBIDDEN_LITERALS = (
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_SERVER,
    _VAL_HOST,
    str(_VAL_PORT),
    _VAL_KEY,
)


@pytest.fixture(autouse=True)
def _reset_state():
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_terminal_scrub._reset_terminal_scrub_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_terminal_scrub._reset_terminal_scrub_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()


@pytest.fixture(autouse=True)
def _fake_clock(monkeypatch: pytest.MonkeyPatch):
    """The relaunch's clock and sleep, so a relaunch that does not authorize
    polls on the fake clock instead of sleeping 10 s per poll."""
    clock = _FakeClock()
    monkeypatch.setattr(mt5_relogin, "_clock", clock.monotonic)
    monkeypatch.setattr(mt5_relogin, "_sleep", clock.sleep)
    _FakeMt5.clock = clock
    yield clock
    _FakeMt5.clock = None


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_HOST", _VAL_HOST)
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_PORT", str(_VAL_PORT))


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> _FakeCronRuns:
    """One in-memory `cron_runs` for the scrub rows AND the lease's handover
    rows, so a row written by either path is scanned."""
    fake = _FakeCronRuns()
    monkeypatch.setattr(mt5_terminal_scrub, "get_supabase", lambda: fake)
    monkeypatch.setattr(mt5_handover, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def captures(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every Sentry capture the scrub module makes."""
    seen: list[str] = []
    monkeypatch.setattr(
        mt5_terminal_scrub.sentry_sdk,
        "capture_message",
        lambda message, level=None: seen.append(message),
    )
    monkeypatch.setattr(
        mt5_terminal_scrub.sentry_sdk, "set_tag", lambda *_a, **_k: None
    )
    return seen


def _install_scrub_client(monkeypatch: pytest.MonkeyPatch, scenario: dict):
    """Point `mt5_terminal_scrub.Mt5Client` at the REAL client wired to the
    in-memory double (`tests.test_mt5_relogin._install_client`'s shape).
    Returns ``(fake, constructions)``; ``constructions`` records
    ``(host, port, thread_ident)``."""
    fake = _FakeMt5(scenario)
    constructions: list[tuple[str, int, int]] = []

    def _connect(*, host, port, timeout):
        return fake

    def _factory(host: str, port: int, **kwargs: Any) -> Mt5Client:
        constructions.append((host, port, threading.get_ident()))
        return Mt5Client(host, port, _connect=_connect, **kwargs)

    monkeypatch.setattr(mt5_terminal_scrub, "Mt5Client", _factory)
    return fake, constructions


#: A terminal that comes back on the house account, connected.
_VERIFIED = {"terminal_info": _HOUSE_TERMINAL, "account_info": _HOUSE_ACCOUNT}


def _expected_exit_wait_ms() -> int:
    """The scrub verb's own derivation, on the WORKER chain this module uses."""
    return min(
        mt5_client._TERMINAL_EXIT_WAIT_MS,
        int(mt5_client.MT5_REQUEST_TIMEOUT_S * 1000)
        // mt5_client._TERMINAL_EXIT_WAIT_DIVISOR,
    )


def _scrub_rows(sink: _FakeCronRuns) -> list[dict]:
    return [
        r
        for r in sink.rows
        if r.get("cron_name") == mt5_terminal_scrub.MT5_TERMINAL_SCRUB_CRON_NAME
    ]


def _the_one_scrub_row(sink: _FakeCronRuns) -> dict:
    found = _scrub_rows(sink)
    assert len(found) == 1, f"expected exactly one scrub row, got {found}"
    return found[0]["metadata"]


async def _drain_scrub_tasks() -> None:
    tasks = list(mt5_terminal_scrub._SCRUB_TASKS)
    assert tasks, "no scrub task was scheduled"
    await asyncio.gather(*tasks)


def _scrub_crossed(fake: _FakeMt5) -> bool:
    conn = fake._MetaTrader5__conn
    return (
        mt5_client._REMOTE_TERMINAL_SCRUB_SRC in conn.executed
        or bool(conn.scrub_calls)
    )


def _set_event() -> threading.Event:
    done = threading.Event()
    done.set()
    return done


# --------------------------------------------------------------------------- #
# Task 1 — the tracer.
# --------------------------------------------------------------------------- #


async def test_TERMINAL_SCRUB_TRACER_a_scheduled_scrub_deletes_relaunches_as_house_and_records_one_row(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    """⭐ THE TRACER: schedule -> own lease -> scrub with `delete_trades=1` ->
    CREDENTIALED house relaunch -> verified -> mark and debt cleared -> one
    closed row. A bare `initialize()` after the scrub would hang on the
    account-less terminal (S-10), so none may run."""
    fake, constructions = _install_scrub_client(monkeypatch, dict(_VERIFIED))

    mt5_terminal_scrub.schedule_validation_terminal_scrub(
        _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=_set_event()
    )
    assert mt5_scrub_owed(_VAL_KEY), "scheduling must mark the terminal scrub-owed"

    await _drain_scrub_tasks()

    conn = fake._MetaTrader5__conn
    assert conn.scrub_calls == [(_expected_exit_wait_ms(), 1)]
    after_scrub = fake.call_order[fake.call_order.index("scrub") + 1 :]
    assert "initialize_credentialed" in after_scrub
    assert "initialize" not in fake.call_order, fake.call_order
    assert len(constructions) == 1
    assert constructions[0][2] != threading.get_ident(), (
        "the client must be built INSIDE the thread, where the bound covers its "
        "connect"
    )

    assert not mt5_scrub_owed(_VAL_KEY)
    assert not mt5_relaunch_debt(_VAL_KEY)

    meta = _the_one_scrub_row(sink)
    assert meta["kind"] == "scrubbed"
    assert meta["terminal_role"] == "validation"
    assert meta["site"] == SITE_VALIDATE_WIZARD
    assert meta["relaunch_status"] == "verified"
    assert meta["records_account_number"] is False
    assert captures == []
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) == HOLDER_HOUSE


# --------------------------------------------------------------------------- #
# Task 2 — W-1, every kind, the queue order, never-raises, hygiene.
# --------------------------------------------------------------------------- #


def _alert_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        r
        for r in caplog.records
        if r.name == _LOGGER_NAME
        and r.levelno == logging.ERROR
        and "cause=" in r.getMessage()
    ]


def _assert_one_alert(
    caplog: pytest.LogCaptureFixture, captures: list[str], cause: str
) -> None:
    """Exactly one ERROR alert line naming ``cause``, and exactly one capture."""
    alerts = _alert_records(caplog)
    assert [f"cause={cause}" in r.getMessage() for r in alerts] == [True], [
        r.getMessage() for r in alerts
    ]
    assert len(captures) == 1 and f"cause={cause}" in captures[0], captures


async def _schedule_and_drain(probe_thread_done: threading.Event | None) -> None:
    mt5_terminal_scrub.schedule_validation_terminal_scrub(
        _VAL_HOST,
        _VAL_PORT,
        site=SITE_VALIDATE_WIZARD,
        probe_thread_done=probe_thread_done,
    )
    await _drain_scrub_tasks()


async def test_TERMINAL_SCRUB_W1_no_scrub_crosses_while_the_probe_thread_is_in_flight(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """⭐ W-1. The validate site abandoned its probe thread at the stage timeout
    and the thread is still mid-call. The gate is that thread's OWN event: while
    it is unset at the bound, nothing crosses, the mark stays, the alert fires
    and a row records the skip."""
    fake, constructions = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    monkeypatch.setattr(mt5_terminal_scrub, "_SCRUB_PROBE_WAIT_S", 0.2)
    blocker = threading.Event()
    try:
        with caplog.at_level(logging.INFO):
            await _schedule_and_drain(blocker)
        assert not blocker.is_set()
        assert not _scrub_crossed(fake), (
            "a scrub source crossed while the probe thread was in flight"
        )
        assert constructions == []
        assert mt5_scrub_owed(_VAL_KEY)
        assert _the_one_scrub_row(sink)["kind"] == "skipped_probe_in_flight"
        _assert_one_alert(caplog, captures, "probe_in_flight")
    finally:
        blocker.set()


async def test_TERMINAL_SCRUB_W1_an_EARLIER_requests_unfinished_probe_blocks_a_LATER_scrub(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    """The zombie from a previous request: its event, registered by its own
    schedule, still blocks a later scrub on the same terminal whose own probe
    already finished. Once the zombie returns, the next scrub goes through."""
    fake, _ = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    monkeypatch.setattr(mt5_terminal_scrub, "_SCRUB_PROBE_WAIT_S", 0.2)
    zombie = threading.Event()
    try:
        await _schedule_and_drain(zombie)
        await _schedule_and_drain(_set_event())
        assert not _scrub_crossed(fake)
        assert [r["metadata"]["kind"] for r in _scrub_rows(sink)] == [
            "skipped_probe_in_flight",
            "skipped_probe_in_flight",
        ]
        assert mt5_scrub_owed(_VAL_KEY)
    finally:
        zombie.set()

    await _schedule_and_drain(None)
    assert _scrub_crossed(fake)
    assert _scrub_rows(sink)[-1]["metadata"]["kind"] == "scrubbed"
    assert not mt5_scrub_owed(_VAL_KEY)


@pytest.mark.parametrize("unset", ["MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"])
async def test_TERMINAL_SCRUB_no_house_credentials_ends_nothing_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
    unset: str,
) -> None:
    """Without the house triple a scrub would leave an ACCOUNT-LESS terminal
    nothing can bring back (S-10), so nothing is ended or deleted."""
    fake, constructions = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    monkeypatch.delenv(unset)
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert not _scrub_crossed(fake)
    assert constructions == []
    assert not mt5_relaunch_debt(_VAL_KEY)
    assert mt5_scrub_owed(_VAL_KEY)
    assert _the_one_scrub_row(sink)["kind"] == "skipped_no_house_credentials"
    _assert_one_alert(caplog, captures, "house_credentials_unset")


async def test_TERMINAL_SCRUB_a_REFUSED_delete_keeps_the_mark_and_still_relaunches(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """(1,1,0): the terminal was ended but did not exit, so the literal refused
    the delete (`refused=3`). The client's saved login may still be there, so
    the mark stays. A process WAS ended, so the credentialed relaunch runs."""
    fake, _ = _install_scrub_client(
        monkeypatch, {**_VERIFIED, "recycle_counts": (1, 1, 0)}
    )
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert "initialize_credentialed" in fake.call_order
    assert mt5_scrub_owed(_VAL_KEY)
    meta = _the_one_scrub_row(sink)
    assert (meta["kind"], meta["refused"]) == ("refused", 3)
    _assert_one_alert(caplog, captures, "refused")


async def test_TERMINAL_SCRUB_an_UNVERIFIED_relaunch_keeps_the_mark_and_the_debt(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The delete landed but the snapshot answers ANOTHER login: the house
    session is not proven, so neither the mark nor the relaunch debt clears."""
    _install_scrub_client(
        monkeypatch,
        {"terminal_info": _HOUSE_TERMINAL, "account_info": _OTHER_LOGIN_ACCOUNT},
    )
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert mt5_scrub_owed(_VAL_KEY)
    assert mt5_relaunch_debt(_VAL_KEY)
    meta = _the_one_scrub_row(sink)
    assert meta["kind"] == "relaunch_unverified"
    assert (meta["refused"], meta["accounts_deleted"]) == (0, 1)
    assert meta["relaunch_status"] != "verified"
    _assert_one_alert(caplog, captures, "relaunch_unverified")


async def test_TERMINAL_SCRUB_a_RAISING_verb_is_failed_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake, _ = _install_scrub_client(
        monkeypatch, {**_VERIFIED, "recycle_raises": RuntimeError("bridge dropped")}
    )
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert fake._MetaTrader5__conn.scrub_calls, "the verb was never reached"
    assert mt5_scrub_owed(_VAL_KEY)
    assert _the_one_scrub_row(sink)["kind"] == "failed"
    _assert_one_alert(caplog, captures, "failed")


async def test_TERMINAL_SCRUB_a_delete_that_reported_ERRORS_is_failed_never_scrubbed(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """`refused == 0` with a verified relaunch, but deleting `accounts.dat`
    raised on the far side. The file is not proven gone, so the kind is never
    `scrubbed` (the invariant: scrubbed if and only if the mark cleared), and
    the worker's inline path does not probe on it."""
    _install_scrub_client(monkeypatch, dict(_VERIFIED))
    real = mt5_terminal_scrub.scrub_and_relaunch_as_house

    def _with_delete_errors(client: Mt5Client, **kwargs: Any) -> Any:
        result = real(client, **kwargs)
        return result._replace(
            verdict={**result.verdict, "accounts_errors": ["PermissionError"]}
        )

    monkeypatch.setattr(
        mt5_terminal_scrub, "scrub_and_relaunch_as_house", _with_delete_errors
    )
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert mt5_scrub_owed(_VAL_KEY)
    meta = _the_one_scrub_row(sink)
    assert (meta["kind"], meta["accounts_errors"]) == ("failed", 1)
    _assert_one_alert(caplog, captures, "failed")


@pytest.mark.parametrize(
    "overrides,row_counts",
    [
        pytest.param(
            {"trades_errors": ["PermissionError"]},
            {"trades_errors": 1, "profile_errors": 0, "profile_accounts_found": 0},
            id="a-deal-cache-delete-ERRORED",
        ),
        pytest.param(
            {"trades_errors": "not-a-list"},
            {"trades_errors": None, "profile_errors": 0, "profile_accounts_found": 0},
            id="trades_errors-UNPARSEABLE",
        ),
        pytest.param(
            {"profile_accounts_found": 1},
            {"trades_errors": 0, "profile_errors": 0, "profile_accounts_found": 1},
            id="the-PROFILE-tripwire-fired",
        ),
        pytest.param(
            {"profile_accounts_found": "not-an-int", "profile_errors": ["OSError"]},
            {"trades_errors": 0, "profile_errors": 1, "profile_accounts_found": None},
            id="the-profile-tripwire-UNREADABLE",
        ),
    ],
)
async def test_TERMINAL_SCRUB_a_cache_delete_error_or_the_profile_tripwire_is_failed_never_scrubbed(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
    overrides: dict,
    row_counts: dict,
) -> None:
    """⛔ 164.6.6.1 review round 1, SFH-01 / WR-01. The validation scrub runs with
    ``delete_trades=1``, so its promise covers the client's DEAL HISTORY too
    (success criterion 1). A verdict with ``refused == 0``, an empty
    ``accounts_errors`` and a verified house relaunch, but a deal-cache delete
    that ERRORED, did not prove the client's account-named cache is gone. Nor
    did one whose profile tripwire (an ``accounts.dat`` under the per-user
    profile directory, which the literal counts and never deletes) fired or
    could not be read. Each is ``failed``: the mark stays, so the next
    validation owes the scrub, one ERROR alert fires, and the row carries the
    counts so the audit trail can show why. Before this fix every one of them
    read ``scrubbed``, cleared the mark and logged INFO."""
    _install_scrub_client(
        monkeypatch, {**_VERIFIED, "scrub_verdict_overrides": overrides}
    )
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert mt5_scrub_owed(_VAL_KEY), "a scrub that left client data cleared the mark"
    meta = _the_one_scrub_row(sink)
    assert meta["kind"] == "failed"
    assert (meta["refused"], meta["accounts_errors"]) == (0, 0)
    assert meta["relaunch_status"] == "verified"
    assert {key: meta[key] for key in row_counts} == row_counts
    _assert_one_alert(caplog, captures, "failed")
    _assert_nothing_disclosed(sink, caplog, captures)


async def test_TERMINAL_SCRUB_a_scrub_past_its_budget_is_ABANDONED_and_returns(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The scrub crossing itself wedges past the budget: the task ends
    normally with `abandoned`, the mark stays, and the alert fires."""
    import time as _time

    finished = threading.Event()

    def _wedge() -> None:
        _time.sleep(0.6)
        finished.set()

    _install_scrub_client(monkeypatch, {**_VERIFIED, "after_recycle_crossed": _wedge})
    monkeypatch.setattr(mt5_terminal_scrub, "_VALIDATION_SCRUB_BUDGET_S", 0.2)
    with caplog.at_level(logging.INFO):
        await _schedule_and_drain(_set_event())
    assert mt5_scrub_owed(_VAL_KEY)
    assert _the_one_scrub_row(sink)["kind"] == "abandoned"
    _assert_one_alert(caplog, captures, "abandoned")
    # Let the abandoned thread finish before teardown resets the registries.
    assert await asyncio.to_thread(finished.wait, 5.0)
    await asyncio.sleep(0.05)


async def test_TERMINAL_SCRUB_two_schedules_on_one_terminal_create_ONE_task(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    fake, _ = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    for _ in range(2):
        mt5_terminal_scrub.schedule_validation_terminal_scrub(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=_set_event()
        )
    assert len(mt5_terminal_scrub._SCRUB_TASKS) == 1
    await _drain_scrub_tasks()
    assert len(fake._MetaTrader5__conn.scrub_calls) == 1
    assert len(_scrub_rows(sink)) == 1
    assert mt5_terminal_scrub._PENDING_SCRUB_KEYS == set()


async def test_TERMINAL_SCRUB_the_scheduled_scrub_takes_the_lock_BEFORE_a_later_lease(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    """D-08's queue order: a scrub scheduled while the validation still holds
    the terminal queues on the lock at once, so a lease requested AFTER the
    schedule (the next validation) gets the terminal only after the scrub."""
    fake, _ = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    conn = fake._MetaTrader5__conn
    seen_by_competitor: list[int] = []

    async def _competitor() -> None:
        async with mt5_concurrency.mt5_terminal_lease(
            _VAL_KEY, holder=HOLDER_VALIDATION, site=SITE_VALIDATE_WIZARD
        ):
            seen_by_competitor.append(len(conn.scrub_calls))

    async with mt5_concurrency.mt5_terminal_lease(
        _VAL_KEY, holder=HOLDER_VALIDATION, site=SITE_VALIDATE_WIZARD
    ):
        mt5_terminal_scrub.schedule_validation_terminal_scrub(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=_set_event()
        )
        await asyncio.sleep(0)
        competitor = asyncio.create_task(_competitor())
        await asyncio.sleep(0)
    await competitor
    await _drain_scrub_tasks()
    assert seen_by_competitor == [1], (
        "the later lease got the terminal before the scheduled scrub"
    )


async def test_TERMINAL_SCRUB_a_validation_in_the_gap_after_the_lock_release_still_gets_its_scrub(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    """The lease releases the lock and THEN awaits its handover row (up to 5 s
    on a slow sink). A validation can take the terminal in that gap and
    schedule its own scrub. If the finished task's key still read as pending
    then, that schedule would be deduped onto a task that will never scrub
    again: the mark set, the client's login on the terminal, and no scrub
    coming. Stand-in: the handover write itself schedules, once."""
    fake, _ = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    real_handover = mt5_concurrency.record_mt5_terminal_handover
    scheduled_in_gap: list[bool] = []

    async def _handover_then_a_validation(**kwargs: Any) -> None:
        await real_handover(**kwargs)
        if not scheduled_in_gap:
            scheduled_in_gap.append(True)
            mt5_terminal_scrub.schedule_validation_terminal_scrub(
                _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=None
            )

    monkeypatch.setattr(
        mt5_concurrency, "record_mt5_terminal_handover", _handover_then_a_validation
    )
    mt5_terminal_scrub.schedule_validation_terminal_scrub(
        _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=None
    )
    for _ in range(3):
        tasks = list(mt5_terminal_scrub._SCRUB_TASKS)
        if not tasks:
            break
        await asyncio.gather(*tasks)
    assert scheduled_in_gap == [True], "the stand-in validation never ran"
    assert len(fake._MetaTrader5__conn.scrub_calls) == 2, (
        "the schedule made in the gap was deduped onto a finished task"
    )
    assert [r["metadata"]["kind"] for r in _scrub_rows(sink)] == ["scrubbed", "scrubbed"]
    assert not mt5_scrub_owed(_VAL_KEY)


def _raising_lease(*_a: Any, **_k: Any) -> Any:
    @asynccontextmanager
    async def _lease() -> AsyncIterator[None]:
        raise RuntimeError("the lease broke")
        yield  # pragma: no cover

    return _lease()


async def _raising_coro(*_a: Any, **_k: Any) -> Any:
    raise RuntimeError("injected")


@pytest.mark.parametrize(
    "target, replacement",
    [
        ("_scrub_under_lease", _raising_coro),
        ("record_mt5_terminal_scrub", _raising_coro),
        ("mt5_terminal_lease", _raising_lease),
    ],
)
async def test_TERMINAL_SCRUB_the_task_NEVER_raises(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
    target: str,
    replacement: Any,
) -> None:
    """A task exception reaching a `_crash_handler`-style done callback is the
    outage class `main.lifespan` guards against. Each internal step is made to
    raise in turn: the coroutine returns `None`, the callback sees no
    exception, and the failure is LOGGED, never silent."""
    _install_scrub_client(monkeypatch, dict(_VERIFIED))
    monkeypatch.setattr(mt5_terminal_scrub, target, replacement)

    with caplog.at_level(logging.INFO):
        returned = await mt5_terminal_scrub.scrub_validation_terminal(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD
        )
        assert returned is None
        seen: list[BaseException | None] = []
        mt5_terminal_scrub.schedule_validation_terminal_scrub(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=None
        )
        (task,) = mt5_terminal_scrub._SCRUB_TASKS
        task.add_done_callback(lambda t: seen.append(t.exception()))
        await asyncio.wait({task})
        await asyncio.sleep(0)
    assert seen == [None]
    assert mt5_terminal_scrub._PENDING_SCRUB_KEYS == set()
    assert any(
        r.levelno == logging.ERROR and r.name == _LOGGER_NAME for r in caplog.records
    ), "a failure was swallowed with no ERROR line"


def _assert_nothing_disclosed(
    sink: _FakeCronRuns, caplog: pytest.LogCaptureFixture, captures: list[str]
) -> None:
    """FIELD BY FIELD over every row (scrub and handover), then every log
    record from every logger, then every capture. The generated timestamps are
    excluded from the PORT check only, because a 5-digit port can occur in
    their microseconds by chance."""
    assert sink.rows, "the hygiene scan needs rows to scan"
    for row in sink.rows:
        for column, value in row.items():
            rendered = value if isinstance(value, str) else json.dumps(value, default=str)
            for literal in _FORBIDDEN_LITERALS:
                if literal == str(_VAL_PORT) and column in ("started_at", "completed_at"):
                    continue
                assert literal not in rendered, (column, literal, rendered)
    assert caplog.records, "the hygiene scan needs log records to scan"
    for record in caplog.records:
        message = record.getMessage()
        for literal in _FORBIDDEN_LITERALS:
            assert literal not in message, (record.name, literal, message)
    for text in captures:
        for literal in _FORBIDDEN_LITERALS:
            assert literal not in text, (literal, text)


_HYGIENE_SCENARIOS = {
    "scrubbed": dict(_VERIFIED),
    "refused": {**_VERIFIED, "recycle_counts": (1, 1, 0)},
    "relaunch_not_answering": {**_VERIFIED, "relaunch_credentialed": False},
    "failed": {**_VERIFIED, "recycle_raises": RuntimeError("bridge dropped")},
}


@pytest.mark.parametrize("scenario_id", sorted(_HYGIENE_SCENARIOS))
async def test_TERMINAL_SCRUB_no_secret_reaches_a_row_a_log_or_an_alert(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
    scenario_id: str,
) -> None:
    _install_scrub_client(monkeypatch, dict(_HYGIENE_SCENARIOS[scenario_id]))
    with caplog.at_level(logging.DEBUG):
        await _schedule_and_drain(_set_event())
        mt5_terminal_scrub.report_scrub_owed_refusal(
            site=SITE_VALIDATE_WIZARD, key=_VAL_KEY
        )
    _assert_nothing_disclosed(sink, caplog, captures)


@pytest.mark.parametrize(
    "scenario_id, expected",
    [
        ("scrubbed", True),
        ("refused", False),
        ("relaunch_not_answering", False),
        ("failed", False),
        ("no_credentials", False),
    ],
)
async def test_TERMINAL_SCRUB_the_inline_path_is_True_ONLY_on_scrubbed(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    scenario_id: str,
    expected: bool,
) -> None:
    """The worker probes right after this returns, so True must mean the
    terminal was scrubbed and is on the house account, and nothing else."""
    if scenario_id == "no_credentials":
        _install_scrub_client(monkeypatch, dict(_VERIFIED))
        monkeypatch.delenv("MT5_PASSWORD")
    else:
        _install_scrub_client(monkeypatch, dict(_HYGIENE_SCENARIOS[scenario_id]))
    mt5_client.note_mt5_scrub_owed(_VAL_KEY)
    async with mt5_concurrency.mt5_terminal_lease(
        _VAL_KEY, holder=HOLDER_VALIDATION, site=SITE_VALIDATE_WORKER
    ):
        got = await mt5_terminal_scrub.run_owed_validation_scrub_in_lease(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WORKER
        )
    assert got is expected
    assert mt5_scrub_owed(_VAL_KEY) is (not expected)
    assert len(_scrub_rows(sink)) == 1


async def test_TERMINAL_SCRUB_the_inline_path_NEVER_raises(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    monkeypatch.setattr(mt5_terminal_scrub, "_scrub_under_lease", _raising_coro)
    got = await mt5_terminal_scrub.run_owed_validation_scrub_in_lease(
        _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WORKER
    )
    assert got is False


async def test_TERMINAL_SCRUB_an_owed_refusal_is_a_WARNING_while_queued_and_pages_when_missed(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """D-29 partly reversed (CONTEXT): a validation refused while the previous
    one's scrub is queued is ordinary and must not page. With nothing queued
    the scrub was genuinely missed: ERROR, and one capture per window."""
    _install_scrub_client(monkeypatch, dict(_VERIFIED))

    def _refusal_lines() -> list[int]:
        return [
            r.levelno
            for r in caplog.records
            if r.name == _LOGGER_NAME and "owed_validation_refused" in r.getMessage()
        ]

    with caplog.at_level(logging.INFO):
        async with mt5_concurrency.mt5_terminal_lease(
            _VAL_KEY, holder=HOLDER_VALIDATION, site=SITE_VALIDATE_WIZARD
        ):
            mt5_terminal_scrub.schedule_validation_terminal_scrub(
                _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WIZARD, probe_thread_done=None
            )
            mt5_terminal_scrub.report_scrub_owed_refusal(
                site=SITE_VALIDATE_WIZARD, key=_VAL_KEY
            )
            assert _refusal_lines() == [logging.WARNING]
            assert captures == []
        await _drain_scrub_tasks()

        caplog.clear()
        for _ in range(2):
            mt5_terminal_scrub.report_scrub_owed_refusal(
                site=SITE_VALIDATE_WIZARD, key=_VAL_KEY
            )
    assert _refusal_lines() == [logging.ERROR, logging.ERROR]
    assert len(captures) == 1 and "owed_validation_refused" in captures[0]


async def test_TERMINAL_SCRUB_a_verified_inline_scrub_under_a_VALIDATION_lease_leaves_the_holder_HOUSE(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns, captures: list[str]
) -> None:
    """PATTERNS (d2): the credentialed relaunch stamps the HELD lease's holder,
    which on the worker's inline path is `validation`. The explicit re-stamp is
    what makes the record say the terminal is back on `house`."""
    _install_scrub_client(monkeypatch, dict(_VERIFIED))
    async with mt5_concurrency.mt5_terminal_lease(
        _VAL_KEY, holder=HOLDER_VALIDATION, site=SITE_VALIDATE_WORKER
    ):
        assert await mt5_terminal_scrub.run_owed_validation_scrub_in_lease(
            _VAL_HOST, _VAL_PORT, site=SITE_VALIDATE_WORKER
        )
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) == HOLDER_HOUSE


async def test_TERMINAL_SCRUB_an_unknown_alert_cause_is_never_interpolated(
    captures: list[str], caplog: pytest.LogCaptureFixture
) -> None:
    hostile = f"{_FAKE_LOGIN} {_FAKE_SERVER}"
    with caplog.at_level(logging.INFO):
        mt5_terminal_scrub._alert_scrub_failed(hostile, site="free text")
    alerts = _alert_records(caplog)
    assert len(alerts) == 1
    assert "cause=unrecognised_cause" in alerts[0].getMessage()
    assert "site=unattributed" in alerts[0].getMessage()
    assert hostile not in captures[0] and "free text" not in captures[0]


async def test_TERMINAL_SCRUB_the_alert_tag_does_not_leak_onto_a_later_event() -> None:
    """Review WR-03, scrub site: the tag belongs to the ONE capture it describes.
    The worker has no per-request scope, so an unscoped `set_tag` stays on the
    long-lived isolation scope and labels every later event the process sends.

    REAL sentry_sdk, not the `captures` fixture (which replaces `set_tag` and
    `capture_message` outright and so cannot tell a scoped tag from an unscoped
    one). A client whose `before_send` records and drops each event stands in for
    the transport."""
    import sentry_sdk

    events: list[dict] = []

    def _record(event, _hint):
        events.append(event)
        return None  # never send anything

    previous = sentry_sdk.get_global_scope().client
    sentry_sdk.get_global_scope().set_client(
        sentry_sdk.Client(dsn="http://k@localhost/1", before_send=_record)
    )
    try:
        with sentry_sdk.isolation_scope():
            mt5_terminal_scrub._alert_scrub_failed(
                "unrecognised_cause", site=SITE_VALIDATE_WIZARD
            )
            sentry_sdk.capture_message("an unrelated later failure")
    finally:
        sentry_sdk.get_global_scope().set_client(previous)

    # The sdk's logging integration also turns the ERROR log line into an event, so
    # pick the two events by message instead of by position.
    [alert] = [
        e
        for e in events
        if e.get("message", "").startswith("mt5 validation terminal scrub failed")
    ]
    [later] = [e for e in events if e.get("message") == "an unrelated later failure"]
    assert alert["tags"].get("mt5_validation_scrub_failed") == "unrecognised_cause", (
        "the alert itself must still carry its tag"
    )
    assert "mt5_validation_scrub_failed" not in (later.get("tags") or {}), (
        "the tag leaked onto an unrelated later event: it was set on the "
        "long-lived scope instead of the capture's own (review WR-03)"
    )


# --------------------------------------------------------------------------- #
# Task 3 — the closed row contract.
# --------------------------------------------------------------------------- #

#: ⛔ The scrub row's metadata keys, as LITERALS (comparing the module's set
#: with itself would pass whatever it held). A NEW set: the episode and handover
#: key sets are never widened for this row.
_SCRUB_ROW_METADATA_KEYS = frozenset(
    {
        "schema_version",
        "kind",
        "terminal_role",
        "site",
        "refused",
        "accounts_deleted",
        "accounts_missing",
        "accounts_errors",
        "trades_deleted",
        "trades_errors",
        "profile_accounts_found",
        "profile_errors",
        "relaunch_status",
        "records_account_number",
    }
)


@pytest.mark.parametrize("scenario_id", ["scrubbed", "skipped"])
async def test_TERMINAL_SCRUB_the_row_metadata_key_set_is_closed(
    monkeypatch: pytest.MonkeyPatch,
    sink: _FakeCronRuns,
    captures: list[str],
    scenario_id: str,
) -> None:
    """One closed POINT EVENT per attempt, whatever the kind: inserted closed
    (`status='ok'`, `started_at == completed_at`), never a `running` row, and
    carrying exactly the closed key set with counts, kinds and literals only."""
    _install_scrub_client(monkeypatch, dict(_VERIFIED))
    if scenario_id == "skipped":
        monkeypatch.delenv("MT5_LOGIN")
    await _schedule_and_drain(_set_event())

    [row] = _scrub_rows(sink)
    assert row["status"] == "ok"
    assert row["started_at"] and row["completed_at"] == row["started_at"]
    assert row["error"] is None
    assert sink.open_rows() == []
    meta = row["metadata"]
    assert set(meta) == _SCRUB_ROW_METADATA_KEYS
    assert mt5_terminal_scrub._SCRUB_ROW_METADATA_KEYS == _SCRUB_ROW_METADATA_KEYS
    assert meta["schema_version"] == mt5_terminal_scrub.SCHEMA_VERSION == 1
    assert meta["terminal_role"] == "validation"
    assert meta["records_account_number"] is False
    assert meta["kind"] in mt5_terminal_scrub._SCRUB_KINDS
    for key in ("refused", "accounts_deleted", "accounts_missing", "accounts_errors",
                "trades_deleted", "trades_errors", "profile_accounts_found",
                "profile_errors"):
        assert meta[key] is None or type(meta[key]) is int, (key, meta[key])
    if scenario_id == "scrubbed":
        assert (meta["accounts_deleted"], meta["trades_deleted"]) == (1, 2)
        assert (meta["trades_errors"], meta["profile_errors"]) == (0, 0)
    else:
        assert meta["refused"] is None and meta["relaunch_status"] is None


# --------------------------------------------------------------------------- #
# Plan 06 Task 3 — the validation terminal is marked owed AT BOOT.
#
# WHY (Rule 9): the scrub-owed and relaunch-debt marks are in-process, so a
# restart forgets them, and D-09's boot heal reads only the JOB gateway. Without
# a boot mark, an account a validation left on the validation terminal survives
# every deploy unnoticed. The hook only MARKS: a scrub scheduled at boot could
# kill the terminal under the OLD process's in-flight validation during a
# Railway deploy overlap, because the lease does not cross processes.
# --------------------------------------------------------------------------- #


def test_TERMINAL_SCRUB_BOOT_marks_the_validation_terminal_owed_and_starts_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Synchronous, with no running loop: the validation terminal ends marked
    owed, no task was created and no client was built."""
    _, constructions = _install_scrub_client(monkeypatch, dict(_VERIFIED))
    assert not mt5_scrub_owed(_VAL_KEY)

    assert mt5_terminal_scrub.mark_validation_terminal_owed_at_boot() is None

    assert mt5_scrub_owed(_VAL_KEY), "the boot hook did not mark the terminal"
    assert mt5_terminal_scrub._SCRUB_TASKS == set()
    assert mt5_terminal_scrub._PENDING_SCRUB_KEYS == set()
    assert constructions == []
    assert not mt5_scrub_owed(mt5_terminal_key("job-gateway.test", 1)), (
        "harness: a read never mints an entry"
    )


@pytest.mark.parametrize(
    ("host", "port"),
    [(None, str(_VAL_PORT)), (_VAL_HOST, None), (_VAL_HOST, "not-a-port")],
    ids=["host-unset", "port-unset", "port-malformed"],
)
def test_TERMINAL_SCRUB_BOOT_an_unset_or_malformed_endpoint_marks_nothing(
    monkeypatch: pytest.MonkeyPatch, host: str | None, port: str | None
) -> None:
    """No validation gateway configured: nothing to mark, nothing raised (the
    validate sites already refuse loudly on an unconfigured gateway)."""
    for name, value in (
        ("MT5_VALIDATION_GATEWAY_HOST", host),
        ("MT5_VALIDATION_GATEWAY_PORT", port),
    ):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    assert mt5_terminal_scrub.mark_validation_terminal_owed_at_boot() is None

    assert mt5_client._MT5_TERMINAL_SCRUB_OWED == set()
    assert mt5_terminal_scrub._SCRUB_TASKS == set()


def test_TERMINAL_SCRUB_BOOT_a_raising_endpoint_reader_never_escapes(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """It runs synchronously inside `main.lifespan` before the worker loops
    start, outside any `try`: a raise here would abort uvicorn startup and take
    `/health` and every loop down for an MT5 instrument. So it never raises, and
    it names the failure by class only."""

    def _boom() -> None:
        raise RuntimeError(f"reader broke {_VAL_HOST}")

    monkeypatch.setattr(
        mt5_terminal_scrub, "read_env_validation_gateway_endpoint", _boom
    )
    with caplog.at_level(logging.DEBUG, logger=_LOGGER_NAME):
        assert mt5_terminal_scrub.mark_validation_terminal_owed_at_boot() is None
    assert mt5_client._MT5_TERMINAL_SCRUB_OWED == set()
    rendered = " ".join(r.getMessage() for r in caplog.records)
    assert "RuntimeError" in rendered
    for literal in _FORBIDDEN_LITERALS:
        assert literal not in rendered, literal


_BOOT_MARK_SYMBOL = "mark_validation_terminal_owed_at_boot"


def _boot_mark_calls(lifespan: Any) -> list[Any]:
    import ast

    return [
        node
        for node in ast.walk(lifespan)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == _BOOT_MARK_SYMBOL
    ]


def test_TERMINAL_SCRUB_BOOT_lifespan_calls_the_boot_mark_once_synchronously_never_as_a_task(
) -> None:
    """`main.lifespan` calls the boot mark exactly ONCE, as a plain statement
    (not awaited, not handed to `create_task`), before the task list is built.
    In the task list it would inherit `_crash_handler`, and it is not a loop."""
    import ast

    from tests.test_mt5_relogin import _lifespan_node, _main_source

    lifespan = _lifespan_node(_main_source())
    calls = _boot_mark_calls(lifespan)
    assert len(calls) == 1, (
        f"main.lifespan calls {_BOOT_MARK_SYMBOL} {len(calls)} times, expected 1: "
        "without it a restart forgets an account a validation left on the "
        "validation terminal"
    )
    statements = [
        node for node in ast.walk(lifespan)
        if isinstance(node, ast.Expr) and node.value is calls[0]
    ]
    assert statements, "the boot mark must be a plain synchronous statement"
    for node in ast.walk(lifespan):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create_task"
        ):
            assert all(
                not (isinstance(a, ast.Call) and a in calls) for a in node.args
            ), "the boot mark was handed to create_task"
    task_lists = [
        node for node in ast.walk(lifespan)
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "tasks" for t in node.targets)
    ]
    assert task_lists, "harness: main.lifespan no longer builds `tasks`"
    assert calls[0].lineno < task_lists[0].lineno, (
        "the boot mark must run before the worker tasks are created"
    )
