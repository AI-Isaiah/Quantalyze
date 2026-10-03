"""Phase 164.6.6 D-07 part 2 — the master-password PARK, as the founder amended it.

``H3-MASTER-PASSWORD-MODE: park-after-login`` (164.6.6-CONTEXT.md). Rejecting a
master (trading) password BEFORE any login is not reachable with the MT5 API:
every trade-capability signal belongs to a logged-in session (plan 02's
finding). So containment comes after the login. Every validation whose probe
reached its login attempt, whose probe THREAD has returned and whose lease fence
did not fire ends, inside the same lease and before the client is released,
with the validation terminal logged back into the house account. A user's
trading session therefore never outlives the probe that needed it.

Regression gates, and WHY each matters (Rule 9):
  - the park happens, inside the lease, before release: otherwise a master
    password's session sits on the validation terminal until the next login.
  - the holder is restamped ``house``: the handover registry must name who the
    terminal is really on.
  - the verdict and the user-facing result never change: the park is
    containment, never a second verdict.
  - NO park while the probe thread may still be on the wire (the W-1 class,
    164.6.6.1-CONTEXT.md): two callers on one MT5 pipe is exactly the eviction
    and wedge class this phase exists to remove. The gate is DEFAULT-DENY and
    measures "in flight" with an Event the probe thread sets itself.
  - NO park with less budget than it needs (``_MT5_PARK_MIN_BUDGET_S``): a park
    its own ceiling then abandons leaves a second caller on the pipe AFTER
    release.
  - every skip and every park failure is LOUD (ERROR + one Sentry capture per
    cause per window) and carries no credential.

⛔ The park PREMISE (the house account logged in on BOTH terminals at once) is
NOT MEASURED; the founder accepted it with that caveat (CONTEXT D-07 part 2). No
test here depends on it: the fakes model one terminal only.

⛔ Every gateway host set here is PRIVATE-SHAPED (`.internal`): plan 05 makes the
endpoint readers answer None for a non-private host. The fabricated values below
are fabricated; none is a real account, server or credential.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from services import mt5_client, mt5_concurrency, mt5_probe
from services.closed_sets import MT5_MASTER_PASSWORD_DETAIL
from services.mt5_client import (
    Mt5ClientError,
    Mt5LoginRefusedError,
    Mt5SessionAbandoned,
)

# Harness imported BY NAME (never edited: plan 05 edits those files in the same
# wave). The two autouse fixtures and `exchange_router` register here because
# their names are bound in this module. Both harness files define autouse
# fixtures with the SAME names, so they are imported from ONE module only.
from tests.test_mt5_validate import (  # noqa: F401 — fixtures register by name
    _VAL_HOST,
    _VAL_PORT,
    _call,
    _install_real_mt5_client,
    _make_req,
    _reset_mt5_terminal_locks,
    _reset_mt5_validation_alert_state,
    exchange_router,
)
from tests.test_ingestion_mt5 import (
    _FakeMt5,
    _FakeNamedTuple,
    _HEALTHY_TERMINAL,
    _INVESTOR_ORDER_CHECK,
)

# The validation terminal's key, as `Mt5Client.terminal_key` spells it for the
# fixtures' private-shaped host.
_VAL_KEY = mt5_client.mt5_terminal_key(_VAL_HOST, _VAL_PORT)

# The probe's (client's) login, parsed from `_make_req`'s api_key.
_CLIENT_LOGIN = 123456

# The HOUSE triple, fabricated. A login distinct from the client's so the two
# logins are told apart by number.
_HOUSE_LOGIN = 700001
_HOUSE_PASSWORD = "house-pw-FABRICATED-7x"
_HOUSE_SERVER = "House-Fabricated-Demo"

_MASTER_ACCOUNT = _FakeNamedTuple(
    trade_allowed=True, balance=1000.0, login=_CLIENT_LOGIN
)
_INVESTOR_ACCOUNT = _FakeNamedTuple(
    trade_allowed=False, balance=1000.0, login=_CLIENT_LOGIN
)


@pytest.fixture(autouse=True)
def _house_credentials(monkeypatch):
    """Valid house credentials by default. ⚠️ Load-bearing for every no-park test:
    without them a gate neutered to `login_attempted` alone would still send no
    park login (it would stop at `house_credentials_unset`), and the neutered run
    would read GREEN where it must read RED."""
    from services import mt5_relogin

    monkeypatch.setenv("MT5_LOGIN", str(_HOUSE_LOGIN))
    monkeypatch.setenv("MT5_PASSWORD", _HOUSE_PASSWORD)
    monkeypatch.setenv("MT5_SERVER", _HOUSE_SERVER)
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    yield
    mt5_relogin._reset_relogin_log_throttle_for_tests()


@pytest.fixture(autouse=True)
def _reset_park_alerts():
    """The park alert's per-cause capture window is module state; one test's
    capture must never suppress another's."""
    mt5_probe._reset_park_alerts_for_tests()
    yield
    mt5_probe._reset_park_alerts_for_tests()


@pytest.fixture()
def park_sentry(monkeypatch) -> MagicMock:
    """Spy on the PARK module's Sentry handle (never `mt5_relogin`'s)."""
    spy = MagicMock()
    monkeypatch.setattr(mt5_probe, "sentry_sdk", spy)
    return spy


_ANALYTICS_LOGGER = "quantalyze.analytics"


def _park_error_records(caplog) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records
        if r.name == _ANALYTICS_LOGGER
        and r.levelno == logging.ERROR
        and "mt5 validation park" in r.getMessage()
    ]


def _assert_one_alert(park_sentry: MagicMock, caplog, cause: str, site: str) -> None:
    """Exactly one capture tagged with `cause`, and an ERROR line naming the cause
    and the site."""
    assert park_sentry.capture_message.call_count == 1, (
        f"expected exactly one park capture for {cause!r}, got "
        f"{park_sentry.capture_message.call_args_list!r}"
    )
    park_sentry.set_tag.assert_called_once_with("mt5_validation_park_failed", cause)
    errors = _park_error_records(caplog)
    assert errors, f"no ERROR line for the park cause {cause!r}"
    assert any(
        f"cause={cause}" in r.getMessage() and f"site={site}" in r.getMessage()
        for r in errors
    ), [r.getMessage() for r in errors]


def _assert_no_credential_leak(park_sentry: MagicMock, caplog) -> None:
    rendered = " ".join(r.getMessage() for r in caplog.records)
    rendered += " " + repr(park_sentry.mock_calls)
    for secret in (str(_HOUSE_LOGIN), _HOUSE_PASSWORD, _HOUSE_SERVER, "investor-pw",
                   "Broker-Demo", _VAL_HOST):
        assert secret not in rendered, f"{secret!r} leaked into a log line or capture"


_WIZARD = "validate_wizard"
_WORKER = "validate_worker"


class _RecordingConn:
    """The rpyc connection `Mt5Client.release` closes. Records the release into
    the transport's ordered event list."""

    def __init__(self, events: list[tuple[Any, ...]]) -> None:
        self._events = events

    def close(self) -> None:
        self._events.append(("release",))


class _RecordingMt5(_FakeMt5):
    """The MT5 transport double, recording every `login` in order with whether
    THIS lease was held at that moment and whether the client had already been
    released.

    ``block_client_login`` blocks ONLY the probe's (client's) login, on a bounded
    Event; the park's login is just recorded, so a neutered gate's park lands
    while the probe is still blocked (W-1 reproduced) instead of queueing behind
    it. ``block_house_login`` blocks only the park's login (the ceiling case).
    """

    def __init__(
        self,
        scenario: dict[str, Any],
        *,
        block_client_login: threading.Event | None = None,
        block_house_login: threading.Event | None = None,
        house_login_result: Any = True,
        house_login_raises: BaseException | None = None,
    ) -> None:
        super().__init__(scenario)
        self.events: list[tuple[Any, ...]] = []
        self._MetaTrader5__conn = _RecordingConn(self.events)
        self._block_client = block_client_login
        self._block_house = block_house_login
        self._house_result = house_login_result
        self._house_raises = house_login_raises
        self.client_login_returned = threading.Event()
        self.house_login_returned = threading.Event()

    @staticmethod
    def _lease_held() -> bool:
        lock = mt5_concurrency._MT5_TERMINAL_LOCKS.get(_VAL_KEY)
        occupancy = mt5_client._MT5_LEASE_OCCUPANCY.get()
        return (
            lock is not None
            and lock.locked()
            and occupancy == (_VAL_KEY, mt5_client._mt5_epoch_for(_VAL_KEY))
        )

    def login(self, login, **kwargs):
        released = any(e == ("release",) for e in self.events)
        self.events.append(
            ("login", login, kwargs.get("password"), kwargs.get("server"),
             self._lease_held(), released)
        )
        if login == _HOUSE_LOGIN:
            try:
                if self._block_house is not None:
                    self._block_house.wait(timeout=10)
                if self._house_raises is not None:
                    raise self._house_raises
                return self._house_result
            finally:
                self.house_login_returned.set()
        try:
            if self._block_client is not None:
                self._block_client.wait(timeout=10)
            return super().login(login, **kwargs)
        finally:
            self.client_login_returned.set()

    def logins(self) -> list[tuple[Any, ...]]:
        return [e for e in self.events if e[0] == "login"]

    def house_logins(self) -> list[tuple[Any, ...]]:
        return [e for e in self.logins() if e[1] == _HOUSE_LOGIN]


def _scenario(account: Any = _INVESTOR_ACCOUNT, **extra: Any) -> dict[str, Any]:
    scenario: dict[str, Any] = {
        "account": account,
        "terminal": _HEALTHY_TERMINAL,
        "order_check": _INVESTOR_ORDER_CHECK,
    }
    scenario.update(extra)
    return scenario


# --------------------------------------------------------------------------- #
# Task 1 — the tracer: one wizard validation ends parked on the house account.
# --------------------------------------------------------------------------- #


async def test_a_master_password_session_is_parked_on_the_house_account_inside_the_lease(
    exchange_router,
):
    """THE TRACER. A master password reaches `login()` (unavoidable, plan 02),
    the probe classifies it trade-capable and the wizard rejects it. Before the
    park, the terminal's LAST login was that master session, and it stayed on the
    validation terminal after the response. Now the last login is the house
    triple, issued while this lease was held and before the client was released.
    """
    router = exchange_router
    transport = _RecordingMt5(_scenario(_MASTER_ACCOUNT))
    _install_real_mt5_client(router, transport)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_MASTER_PASSWORD_DETAIL

    logins = transport.logins()
    assert [e[1] for e in logins] == [_CLIENT_LOGIN, _HOUSE_LOGIN], (
        f"the terminal's logins were {[e[1] for e in logins]!r}: the master "
        "session must be followed by the house login (the park)"
    )
    last = logins[-1]
    assert (last[1], last[2], last[3]) == (_HOUSE_LOGIN, _HOUSE_PASSWORD, _HOUSE_SERVER)
    assert last[4] is True, "the park login ran without this lease held"
    assert last[5] is False, "the park login ran after the client was released"
    assert transport.events[-1] == ("release",), (
        "the client must still be released, and only after the park"
    )


async def test_after_a_successful_park_the_holder_reads_house(exchange_router):
    """The probe's login stamped the lease's `validation` holder; the park
    restamps `house` through the one door. A holder still reading `validation`
    would tell the next lease's handover row the terminal was on a validation
    when it was on the house account."""
    router = exchange_router
    transport = _RecordingMt5(_scenario())
    _install_real_mt5_client(router, transport)

    assert await _call(router, _make_req()) == {"valid": True, "read_only": True}

    assert len(transport.house_logins()) == 1
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) == mt5_client.HOLDER_HOUSE


def _outcome(exc_or_result: Any) -> tuple[Any, ...]:
    if isinstance(exc_or_result, HTTPException):
        return (
            type(exc_or_result).__name__,
            exc_or_result.status_code,
            repr(exc_or_result.detail),
            getattr(exc_or_result, "code", None),
            getattr(exc_or_result, "recoverable", None),
        )
    return ("result", repr(exc_or_result))


async def _run_wizard(router, scenario: dict[str, Any]) -> tuple[tuple[Any, ...], _RecordingMt5]:
    transport = _RecordingMt5(scenario)
    _install_real_mt5_client(router, transport)
    try:
        result: Any = await _call(router, _make_req())
    except HTTPException as exc:
        result = exc
    return _outcome(result), transport


@pytest.mark.parametrize(
    ("verdict", "scenario"),
    [
        ("trade_capable", _scenario(_MASTER_ACCOUNT)),
        # terminal_info() answers None -> unreadable -> undetermined -> transient.
        ("undetermined", _scenario(terminal=None)),
        ("read_only", _scenario()),
    ],
    ids=["trade_capable", "undetermined", "read_only"],
)
async def test_the_park_never_changes_what_the_caller_sees(
    exchange_router, monkeypatch, verdict, scenario
):
    """Containment, never a second verdict: the status and body are identical
    with the park (house credentials set) and without it (unset)."""
    router = exchange_router
    with_park, parked = await _run_wizard(router, scenario)
    assert len(parked.house_logins()) == 1, f"{verdict}: the park did not run"

    mt5_concurrency.reset_terminal_state_for_tests()
    monkeypatch.delenv("MT5_LOGIN")
    without_park, unparked = await _run_wizard(router, scenario)
    assert unparked.house_logins() == [], f"{verdict}: parked without credentials"

    assert with_park == without_park, (
        f"{verdict}: the park changed the result: {with_park!r} != {without_park!r}"
    )


async def test_unset_house_credentials_skip_the_park_loudly(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """Unset house credentials: no park login, one ERROR naming the cause and the
    site, one capture, and the result unchanged. Never silent: a skipped park
    leaves the user's session on the terminal."""
    router = exchange_router
    for name in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
        monkeypatch.delenv(name)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        outcome, transport = await _run_wizard(router, _scenario())

    assert outcome == _outcome({"valid": True, "read_only": True})
    assert [e[1] for e in transport.logins()] == [_CLIENT_LOGIN]
    _assert_one_alert(park_sentry, caplog, "house_credentials_unset", _WIZARD)
    _assert_no_credential_leak(park_sentry, caplog)


async def test_a_validation_that_never_reached_a_login_neither_parks_nor_alerts(
    exchange_router, park_sentry, caplog
):
    """Nothing reached a terminal, so there is nothing to contain and nothing to
    page about: a connect failure and an unparseable credential both stay quiet
    on the park channel."""
    router = exchange_router
    router.Mt5Client = MagicMock(side_effect=ConnectionRefusedError("refused"))
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(HTTPException) as connect_failed:
            await _call(router, _make_req())
        with pytest.raises(HTTPException) as unparseable:
            await _call(router, _make_req(api_key="not-a-number"))

    assert connect_failed.value.status_code == 503
    assert unparseable.value.status_code == 400
    park_sentry.capture_message.assert_not_called()
    assert _park_error_records(caplog) == []
