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


# --------------------------------------------------------------------------- #
# Task 2 — every wizard exit where a park must NOT run, the floor at its
# boundary, and the park's own failures.
# --------------------------------------------------------------------------- #


async def _wait_for_thread_event(event: threading.Event, timeout: float = 5.0) -> None:
    """Wait for a fake's thread-side Event without blocking the loop."""
    assert await asyncio.to_thread(event.wait, timeout), (
        "the released probe thread never got past its login"
    )


async def _assert_no_park_after_the_probe_finishes(
    transport: _RecordingMt5, blocker: threading.Event
) -> None:
    """Release the blocked probe, let its thread finish, and prove no park login
    arrives LATER: the park is decided once and never retried."""
    blocker.set()
    await _wait_for_thread_event(transport.client_login_returned)
    await asyncio.sleep(0.2)  # the zombie probe's remaining steps
    assert transport.house_logins() == [], (
        "a park login arrived after the blocked probe was released"
    )


async def test_no_park_while_the_probe_is_in_flight_after_a_stage_timeout(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """⛔ THE COMMON HUNG-TERMINAL EXIT. The stage ceiling fires (424) with the
    probe thread still blocked inside the client's login. A park login now would
    be a second caller on the pipe that thread still holds (W-1). None is sent,
    before or after the probe is released, and the skip alerts
    `probe_in_flight`."""
    router = exchange_router
    blocker = threading.Event()
    transport = _RecordingMt5(_scenario(), block_client_login=blocker)
    _install_real_mt5_client(router, transport)
    monkeypatch.setattr(router, "_MT5_VALIDATE_STAGE_TIMEOUT_S", 0.2)
    try:
        with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
            with pytest.raises(HTTPException) as ei:
                await _call(router, _make_req())
        assert ei.value.status_code == 424
        assert not blocker.is_set()
        assert transport.house_logins() == [], (
            "a park login was sent while the probe thread was still blocked "
            "(W-1 reproduced)"
        )
        _assert_one_alert(park_sentry, caplog, "probe_in_flight", _WIZARD)
        await _assert_no_park_after_the_probe_finishes(transport, blocker)
    finally:
        blocker.set()


async def test_no_park_while_the_probe_is_in_flight_after_the_deadline(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """The end-to-end deadline fires first (the stage ceiling stays real). Same
    rule: the probe thread is still on the wire, so no park, `probe_in_flight`."""
    router = exchange_router
    blocker = threading.Event()
    transport = _RecordingMt5(_scenario(), block_client_login=blocker)
    _install_real_mt5_client(router, transport)
    monkeypatch.setattr(router, "_MT5_VALIDATE_DEADLINE_S", 0.2)
    try:
        with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
            with pytest.raises(HTTPException) as ei:
                await _call(router, _make_req())
        assert ei.value.status_code == 424
        assert transport.house_logins() == [], (
            "a park login was sent while the probe thread was still blocked"
        )
        _assert_one_alert(park_sentry, caplog, "probe_in_flight", _WIZARD)
        await _assert_no_park_after_the_probe_finishes(transport, blocker)
    finally:
        blocker.set()


async def test_no_park_after_a_probe_session_abandoned(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """The lease fence fired on the probe's session after its login. The thread
    has returned (so the Event alone would allow a park); the disqualifier is
    what refuses it."""
    router = exchange_router
    transport = _RecordingMt5(_scenario())
    _install_real_mt5_client(router, transport)

    def _fenced_probe(client, *, login, investor_pw, server, log_prefix):
        client.login(login, investor_pw, server)
        raise Mt5SessionAbandoned("account_info")

    monkeypatch.setattr(router, "run_probe", _fenced_probe)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())
    assert ei.value.status_code == 424
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "probe_session_abandoned", _WIZARD)


async def test_no_park_after_a_probe_account_mismatch(
    exchange_router, park_sentry, caplog
):
    """Another actor switched the terminal mid-probe (the login bracket saw a
    different account). Parking would log over THEIR session: no park,
    `probe_account_mismatch`."""
    router = exchange_router
    other = _FakeNamedTuple(trade_allowed=False, balance=1.0, login=999999)
    transport = _RecordingMt5(_scenario(other))
    _install_real_mt5_client(router, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())
    assert ei.value.status_code == 424
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "probe_account_mismatch", _WIZARD)


class _ParkClock:
    """The router's `_park_clock`: the deadline stamp reads `start`, every later
    read reads `start + elapsed`. Drives the floor boundary exactly."""

    def __init__(self, elapsed: float) -> None:
        self._start = 1000.0
        self._elapsed = elapsed
        self.calls = 0

    def __call__(self) -> float:
        self.calls += 1
        return self._start if self.calls == 1 else self._start + self._elapsed


async def _run_with_elapsed(router, monkeypatch, elapsed: float) -> _RecordingMt5:
    clock = _ParkClock(elapsed)
    monkeypatch.setattr(router, "_park_clock", clock)
    transport = _RecordingMt5(_scenario())
    _install_real_mt5_client(router, transport)
    assert await _call(router, _make_req()) == {"valid": True, "read_only": True}
    assert clock.calls == 2, f"the park clock was read {clock.calls} times, not 2"
    return transport


async def test_no_park_when_the_deadline_budget_is_spent(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """A probe that used the whole end-to-end deadline leaves no budget for a
    park to finish in: `budget_exhausted`, no park login."""
    router = exchange_router
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        transport = await _run_with_elapsed(
            router, monkeypatch, router._MT5_VALIDATE_DEADLINE_S
        )
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "budget_exhausted", _WIZARD)


async def test_no_park_just_under_the_park_budget_floor(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """One millisecond under `_MT5_PARK_MIN_BUDGET_S` of unspent deadline: a park
    started now could have its ceiling fire with the park still on the wire
    after release. Skipped as `budget_exhausted`; no park login."""
    router = exchange_router
    elapsed = router._MT5_VALIDATE_DEADLINE_S - router._MT5_PARK_MIN_BUDGET_S + 0.001
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        transport = await _run_with_elapsed(router, monkeypatch, elapsed)
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "budget_exhausted", _WIZARD)


async def test_the_park_runs_with_exactly_the_park_budget_floor_left(
    exchange_router, monkeypatch, park_sentry
):
    """Exactly `_MT5_PARK_MIN_BUDGET_S` left parks (the floor is inclusive). An
    off-by-one floor fails here."""
    router = exchange_router
    elapsed = router._MT5_VALIDATE_DEADLINE_S - router._MT5_PARK_MIN_BUDGET_S
    transport = await _run_with_elapsed(router, monkeypatch, elapsed)
    assert len(transport.house_logins()) == 1
    park_sentry.capture_message.assert_not_called()


def test_the_park_floor_is_the_stage_bound_and_fits_inside_the_deadline(
    exchange_router,
):
    """The floor is DERIVED (an alias of the stage bound, whose inner rpyc bound
    fires first), and the deadline leaves room for it after a fast probe. The
    105 s client-budget sum is pinned, unchanged, in test_mt5_validate.py."""
    router = exchange_router
    assert router._MT5_PARK_MIN_BUDGET_S == router._MT5_VALIDATE_STAGE_TIMEOUT_S
    assert router._MT5_PARK_MIN_BUDGET_S < router._MT5_VALIDATE_DEADLINE_S


async def test_a_refused_park_login_changes_nothing_the_caller_sees(
    exchange_router, park_sentry, caplog
):
    """The terminal answers the house login with no (the real client raises
    `Mt5LoginRefusedError`): the verdict stands, `login_refused` alerts, and no
    credential reaches a log line or a capture."""
    router = exchange_router
    transport = _RecordingMt5(
        _scenario(last_error=(-6, "Authorization failed")), house_login_result=False
    )
    _install_real_mt5_client(router, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        result = await _call(router, _make_req())
    assert result == {"valid": True, "read_only": True}
    assert len(transport.house_logins()) == 1
    _assert_one_alert(park_sentry, caplog, "login_refused", _WIZARD)
    _assert_no_credential_leak(park_sentry, caplog)
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) != mt5_client.HOLDER_HOUSE


def _loud_records(caplog) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records
        if r.name.startswith(_ANALYTICS_LOGGER) and r.levelno > logging.WARNING
    ]


@pytest.mark.parametrize(
    "transport_kwargs",
    [
        # A transport raise mid-login, carrying the fabricated password: the real
        # client scrubs it into a plain `Mt5ClientError` (code 0, unrecognised
        # text), which the validate site answers as a transient at WARNING.
        {"house_login_raises": RuntimeError(f"remote boom password={_HOUSE_PASSWORD}")},
        # A falsy login carrying an IPC-infrastructure code that is NOT a sign-in
        # refusal (`is_mt5_login_refusal` False) and not an IPC transport fault.
        {"house_login_result": False, "scenario_extra": {"last_error": (-10001, "send failed")}},
    ],
    ids=["transport-raise", "falsy-not-a-refusal"],
)
async def test_a_park_login_failing_on_a_bridge_glitch_logs_nothing_above_warning(
    exchange_router, park_sentry, caplog, transport_kwargs
):
    """FOUNDER DECISION 2026-10-03 ("Warn on glitch, page else"). A park that
    fails for the same bridge-glitch reason a validation would answer at WARNING
    logs a WARNING naming `bridge_glitch` and pages nobody: paging an operator
    for a blip is the noise D-15 forbids. The verdict stands and no credential
    leaks."""
    router = exchange_router
    kwargs = dict(transport_kwargs)
    extra = kwargs.pop("scenario_extra", {})
    transport = _RecordingMt5(_scenario(**extra), **kwargs)
    _install_real_mt5_client(router, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        result = await _call(router, _make_req())
    assert result == {"valid": True, "read_only": True}
    assert len(transport.house_logins()) == 1, "the park was never attempted"
    assert _loud_records(caplog) == [], (
        f"a bridge-glitch park failure logged above WARNING: "
        f"{[r.getMessage() for r in _loud_records(caplog)]!r}"
    )
    assert any(
        r.levelno == logging.WARNING
        and "cause=bridge_glitch" in r.getMessage()
        and f"site={_WIZARD}" in r.getMessage()
        for r in caplog.records
    ), "the glitch skip must still be named at WARNING, never silent"
    park_sentry.capture_message.assert_not_called()
    _assert_no_credential_leak(park_sentry, caplog)


async def test_a_refused_park_login_still_logs_error(
    exchange_router, park_sentry, caplog
):
    """The founder's "page else": a sign-in the terminal answered and refused
    is NOT a glitch. ERROR plus a capture."""
    router = exchange_router
    transport = _RecordingMt5(
        _scenario(last_error=(-6, "Authorization failed")), house_login_result=False
    )
    _install_real_mt5_client(router, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        await _call(router, _make_req())
    assert _loud_records(caplog), "a refused park login must log above WARNING"
    _assert_one_alert(park_sentry, caplog, "login_refused", _WIZARD)


async def test_unset_house_credentials_still_log_error(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """The founder's "page else": unset credentials are a configuration fault,
    never a blip. ERROR plus a capture, on the same success path as the glitch
    test."""
    router = exchange_router
    monkeypatch.delenv("MT5_LOGIN")
    transport = _RecordingMt5(_scenario())
    _install_real_mt5_client(router, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        await _call(router, _make_req())
    assert transport.house_logins() == []
    assert _loud_records(caplog), "unset house credentials must log above WARNING"
    _assert_one_alert(park_sentry, caplog, "house_credentials_unset", _WIZARD)


async def test_a_park_whose_ceiling_fires_alerts_and_only_the_release_follows(
    exchange_router, monkeypatch, park_sentry, caplog
):
    """The park's own ceiling fires (both round-trips slow, the named residual).
    It alerts `ceiling`, the verdict stands, and the ONLY thing that then
    touches the client is the existing bounded release. When the abandoned park
    thread finally returns, the epoch guard refuses its `house` stamp: its lease
    is gone."""
    router = exchange_router
    blocker = threading.Event()
    transport = _RecordingMt5(_scenario(), block_house_login=blocker)
    _install_real_mt5_client(router, transport)
    monkeypatch.setattr(router, "_MT5_PARK_MIN_BUDGET_S", 0.2)
    try:
        with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
            result = await _call(router, _make_req())
        assert result == {"valid": True, "read_only": True}
        _assert_one_alert(park_sentry, caplog, "ceiling", _WIZARD)
        house_at = transport.events.index(transport.house_logins()[0])
        assert transport.events[house_at + 1:] == [("release",)], (
            f"after the park ceiling fired the client saw "
            f"{transport.events[house_at + 1:]!r}; only the release may follow"
        )
    finally:
        blocker.set()
    await _wait_for_thread_event(transport.house_login_returned)
    await asyncio.sleep(0.2)
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) != mt5_client.HOLDER_HOUSE


@pytest.mark.parametrize(
    "raised",
    [Mt5ClientError(-2, "Invalid params"), RuntimeError("unexpected")],
    ids=["Mt5ClientError", "any-other-exception"],
)
async def test_a_probe_that_raised_after_the_login_still_parks(
    exchange_router, monkeypatch, raised
):
    """The thread returned and no fence fired, so the user's session may be on
    the terminal: it is parked, whatever the probe raised, and the probe's own
    outcome still leaves the function."""
    router = exchange_router
    transport = _RecordingMt5(_scenario())
    _install_real_mt5_client(router, transport)

    def _raising_probe(client, *, login, investor_pw, server, log_prefix):
        client.login(login, investor_pw, server)
        raise raised

    monkeypatch.setattr(router, "run_probe", _raising_probe)
    with pytest.raises(Exception) as ei:
        await _call(router, _make_req())
    if isinstance(raised, Mt5ClientError):
        assert isinstance(ei.value, HTTPException) and ei.value.status_code == 424
    else:
        assert ei.value is raised
    assert len(transport.house_logins()) == 1
    assert transport.events[-1] == ("release",)


# --- park_on_house_account, directly: every failure arm returns False, loudly.


def _park_client(raises: BaseException | None) -> MagicMock:
    client = MagicMock(name="Mt5Client")
    client.terminal_key = _VAL_KEY
    client.login = MagicMock(side_effect=raises)
    return client


@pytest.mark.parametrize(
    ("raises", "cause"),
    [
        (Mt5LoginRefusedError(-6, "Authorization failed"), "login_refused"),
        (Mt5ClientError(-10004, "No IPC connection"), "client_error"),
        (Mt5SessionAbandoned("login"), "session_abandoned"),
        (ValueError(f"boom {_HOUSE_PASSWORD}"), "client_error"),
    ],
    ids=["refused", "client-error", "fenced", "unexpected"],
)
def test_park_on_house_account_never_raises_and_alerts_each_failure(
    park_sentry, caplog, raises, cause
):
    client = _park_client(raises)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        ok = mt5_probe.park_on_house_account(
            client, house=(_HOUSE_LOGIN, _HOUSE_PASSWORD, _HOUSE_SERVER), site=_WIZARD
        )
    assert ok is False
    client.login.assert_called_once_with(_HOUSE_LOGIN, _HOUSE_PASSWORD, _HOUSE_SERVER)
    _assert_one_alert(park_sentry, caplog, cause, _WIZARD)
    _assert_no_credential_leak(park_sentry, caplog)


def test_an_unknown_cause_is_never_interpolated(park_sentry, caplog):
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        mt5_probe.report_park_skipped("password=hunter2", site=_WIZARD)
    rendered = " ".join(r.getMessage() for r in caplog.records)
    assert "hunter2" not in rendered and "hunter2" not in repr(park_sentry.mock_calls)
    park_sentry.set_tag.assert_called_once_with(
        "mt5_validation_park_failed", "unrecognised_cause"
    )


class _FakeParkTime:
    def __init__(self) -> None:
        self.now = 5000.0

    def monotonic(self) -> float:
        return self.now


def test_the_park_alert_captures_once_per_cause_per_window_and_logs_every_time(
    monkeypatch, park_sentry, caplog
):
    fake = _FakeParkTime()
    monkeypatch.setattr(mt5_probe, "time", fake)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        mt5_probe.report_park_skipped("probe_in_flight", site=_WIZARD)
        fake.now += 3599.0
        mt5_probe.report_park_skipped("probe_in_flight", site=_WORKER)
        mt5_probe.report_park_skipped("budget_exhausted", site=_WIZARD)
        fake.now += 2.0
        mt5_probe.report_park_skipped("probe_in_flight", site=_WIZARD)
    assert len(_park_error_records(caplog)) == 4
    tags = [c.args[1] for c in park_sentry.set_tag.call_args_list]
    assert tags == ["probe_in_flight", "budget_exhausted", "probe_in_flight"]


def test_a_raising_sentry_never_escapes_the_park_alert(monkeypatch):
    spy = MagicMock()
    spy.capture_message.side_effect = RuntimeError("sentry down")
    monkeypatch.setattr(mt5_probe, "sentry_sdk", spy)
    mt5_probe.report_park_skipped("ceiling", site=_WIZARD)  # must not raise


# --------------------------------------------------------------------------- #
# Task 3 — the worker validate (`Mt5Adapter.validate`): the same gate, bounded
# by the worker's own probe ceiling.
# --------------------------------------------------------------------------- #


def _install_worker_transport(monkeypatch, transport: _RecordingMt5) -> None:
    """The REAL `Mt5Client` over the recording transport, built by the adapter's
    own factory seam, with the endpoint env set (private-shaped hosts only)."""
    from services.mt5_client import Mt5Client

    def _build(host: str, port: int) -> Mt5Client:
        return Mt5Client(host, port, _connect=lambda **_ignored: transport)

    monkeypatch.setattr("services.ingestion.mt5._build_client", _build)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_HOST", _VAL_HOST)
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_PORT", str(_VAL_PORT))


async def _worker_validate() -> Any:
    from services.ingestion.adapter import KeySubmissionRequest
    from services.ingestion.mt5 import Mt5Adapter

    return await Mt5Adapter().validate(
        KeySubmissionRequest(
            flow_type="onboard",
            source="mt5",
            context={
                "api_key": str(_CLIENT_LOGIN),
                "api_secret": "investor-pw",
                "passphrase": "Broker-Demo",
            },
        )
    )


async def test_the_worker_validate_parks_on_the_house_account_inside_the_lease(
    monkeypatch,
):
    """The worker's validate ends with the house triple as the terminal's last
    login, issued while its lease was held and before `close`, and returns the
    same `ValidationResult` it returns without the park."""
    transport = _RecordingMt5(_scenario(_MASTER_ACCOUNT))
    _install_worker_transport(monkeypatch, transport)

    result = await _worker_validate()

    assert result.valid is False and result.error_code == "MT5_MASTER_PASSWORD"
    logins = transport.logins()
    assert [e[1] for e in logins] == [_CLIENT_LOGIN, _HOUSE_LOGIN], (
        f"the terminal's logins were {[e[1] for e in logins]!r}: the master "
        "session must be followed by the house login (the park)"
    )
    last = logins[-1]
    assert (last[1], last[2], last[3]) == (_HOUSE_LOGIN, _HOUSE_PASSWORD, _HOUSE_SERVER)
    assert last[4] is True, "the park login ran without this lease held"
    assert last[5] is False, "the park login ran after the client was closed"
    assert transport.events[-1] == ("release",)
    assert mt5_client.mt5_terminal_holder(_VAL_KEY) == mt5_client.HOLDER_HOUSE

    mt5_concurrency.reset_terminal_state_for_tests()
    monkeypatch.delenv("MT5_LOGIN")
    unparked = _RecordingMt5(_scenario(_MASTER_ACCOUNT))
    _install_worker_transport(monkeypatch, unparked)
    assert await _worker_validate() == result
    assert unparked.house_logins() == []


async def test_the_worker_does_not_park_while_the_probe_is_in_flight(
    monkeypatch, park_sentry, caplog
):
    """`_MT5_PROBE_TIMEOUT_S` fires with the probe thread blocked in the client's
    login: no park login, before or after release, and `probe_in_flight`."""
    blocker = threading.Event()
    transport = _RecordingMt5(_scenario(), block_client_login=blocker)
    _install_worker_transport(monkeypatch, transport)
    monkeypatch.setattr("services.ingestion.mt5._MT5_PROBE_TIMEOUT_S", 0.2)
    try:
        with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
            with pytest.raises(asyncio.TimeoutError):
                await _worker_validate()
        assert not blocker.is_set()
        assert transport.house_logins() == [], (
            "a park login was sent while the probe thread was still blocked "
            "(W-1 reproduced)"
        )
        _assert_one_alert(park_sentry, caplog, "probe_in_flight", _WORKER)
        await _assert_no_park_after_the_probe_finishes(transport, blocker)
    finally:
        blocker.set()


async def test_the_worker_does_not_park_after_a_probe_session_abandoned(
    monkeypatch, park_sentry, caplog
):
    transport = _RecordingMt5(_scenario())
    _install_worker_transport(monkeypatch, transport)

    def _fenced_probe(client, *, login, investor_pw, server, log_prefix):
        client.login(login, investor_pw, server)
        raise Mt5SessionAbandoned("account_info")

    monkeypatch.setattr("services.ingestion.mt5.run_probe", _fenced_probe)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(Mt5SessionAbandoned):
            await _worker_validate()
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "probe_session_abandoned", _WORKER)


async def test_the_worker_does_not_park_after_a_probe_account_mismatch(
    monkeypatch, park_sentry, caplog
):
    from services.mt5_client import Mt5AccountMismatchError

    other = _FakeNamedTuple(trade_allowed=False, balance=1.0, login=999999)
    transport = _RecordingMt5(_scenario(other))
    _install_worker_transport(monkeypatch, transport)
    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(Mt5AccountMismatchError):
            await _worker_validate()
    assert transport.house_logins() == []
    _assert_one_alert(park_sentry, caplog, "probe_account_mismatch", _WORKER)
