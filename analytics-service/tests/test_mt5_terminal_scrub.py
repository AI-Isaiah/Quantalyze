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
    Mt5Client,
    mt5_relaunch_debt,
    mt5_scrub_owed,
    mt5_terminal_key,
)
from services.mt5_handover import SITE_VALIDATE_WIZARD
from tests.test_mt5_relogin import (
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_SERVER,
    _HOUSE_ACCOUNT,
    _HOUSE_TERMINAL,
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
