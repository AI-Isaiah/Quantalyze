"""Phase 164.6.6.3 plan 04 (D-09, D-10, D-14) - the shared MT5 known-server pre-check.

``services.mt5_probe.assert_mt5_server_known`` is the ONE decision whether a broker
server is on the curated list. Plans 05 (router) and 06 (worker adapter) both call it,
so the check cannot land on one validate path only (PARITY-01). This file pins the
seam itself; it emits no wire code and is wired into no validate site yet.

What each gate defends:

* the house server is never refused (D-14) - the list is `MT5_KNOWN_SERVERS` PLUS the
  house `MT5_SERVER`, so an operator who forgets to list the house server does not
  lock the house account out of its own wizard.
* a miss pages at most once per sanitised server per hour (D-10, T-164.6.6.3-16): a
  typo flood must not become a Sentry flood, but the ERROR line is on EVERY miss.
* the logged server is sanitised (T-164.6.6.3-12): it is user input on a log line.
* an EMPTY effective list is OUR misconfiguration (T-164.6.6.3-17): a distinct refusal,
  so it never tells every user "your server is unknown".
"""
from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from fastapi import HTTPException

from services import mt5_probe
from services.closed_sets import MT5_SERVER_UNKNOWN_DETAIL
from services.error_contract import VenueTransientHTTPException
from services.exchange import SIGN_IN_FAILED_DETAIL
from services.mt5_client import Mt5LoginRefusedError
from services.mt5_probe import (
    Mt5KnownServersUnconfigured,
    Mt5ServerUnknownError,
    assert_mt5_server_known,
)

# Harness imported BY NAME from the router suite (the park suite does the same). The
# two autouse fixtures register here because their names are bound in this module.
from tests.test_mt5_validate import (  # noqa: F401 - fixtures register by name
    _make_client,
    _make_req,
    _install_mt5_client,
    _reset_mt5_terminal_locks,
    _reset_mt5_validation_alert_state,
    exchange_router,
)

_ANALYTICS_LOGGER = "quantalyze.analytics"
_SITE = "validate_wizard"


@pytest.fixture(autouse=True)
def _reset_server_unknown_alerts():
    """The alert window is module state; one test's capture must never suppress
    another's."""
    mt5_probe._reset_server_unknown_alerts_for_tests()
    yield
    mt5_probe._reset_server_unknown_alerts_for_tests()


@pytest.fixture()
def sentry_spy(monkeypatch) -> MagicMock:
    """Spy on the PROBE module's Sentry handle."""
    spy = MagicMock()
    monkeypatch.setattr(mt5_probe, "sentry_sdk", spy)
    return spy


def _set_env(monkeypatch, *, known: str | None, house: str | None) -> None:
    for name, value in (("MT5_KNOWN_SERVERS", known), ("MT5_SERVER", house)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


def _error_records(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.levelno == logging.ERROR]


def test_an_unlisted_server_raises_and_alerts_once_per_window(
    monkeypatch, sentry_spy, caplog
):
    _set_env(monkeypatch, known="Listed-Live", house="House-Live")

    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(Mt5ServerUnknownError):
            assert_mt5_server_known("Unlisted-Live", site=_SITE)
        with pytest.raises(Mt5ServerUnknownError):
            assert_mt5_server_known("Unlisted-Live", site=_SITE)

    errors = _error_records(caplog)
    assert len(errors) == 2, "the ERROR line is on EVERY miss; only the capture is deduped"
    text = errors[0].getMessage()
    assert "Unlisted-Live" in text and _SITE in text
    assert "MT5_KNOWN_SERVERS" in text, "the line must tell the founder where to add it (D-08)"
    assert sentry_spy.capture_message.call_count == 1, (
        "two misses in one window must give ONE capture, got "
        f"{sentry_spy.capture_message.call_args_list!r}"
    )


def test_the_window_reopens_after_it_elapses(monkeypatch, sentry_spy):
    _set_env(monkeypatch, known="Listed-Live", house=None)
    now = [1000.0]
    monkeypatch.setattr(mt5_probe.time, "monotonic", lambda: now[0])

    with pytest.raises(Mt5ServerUnknownError):
        assert_mt5_server_known("Unlisted-Live", site=_SITE)
    now[0] += mt5_probe._SERVER_UNKNOWN_ALERT_WINDOW_S + 1.0
    with pytest.raises(Mt5ServerUnknownError):
        assert_mt5_server_known("Unlisted-Live", site=_SITE)

    assert sentry_spy.capture_message.call_count == 2


def test_distinct_unlisted_servers_each_capture_once(monkeypatch, sentry_spy):
    _set_env(monkeypatch, known="Listed-Live", house=None)

    for server in ("Typo-One", "Typo-Two", "Typo-One"):
        with pytest.raises(Mt5ServerUnknownError):
            assert_mt5_server_known(server, site=_SITE)

    assert sentry_spy.capture_message.call_count == 2


def test_the_dedupe_table_is_bounded_against_a_flood_of_distinct_servers(
    monkeypatch, sentry_spy
):
    _set_env(monkeypatch, known="Listed-Live", house=None)
    cap = mt5_probe._SERVER_UNKNOWN_ALERT_MAX_KEYS

    for i in range(cap + 50):
        with pytest.raises(Mt5ServerUnknownError):
            assert_mt5_server_known(f"Junk-{i}", site=_SITE)

    assert len(mt5_probe._server_unknown_last_alert_at) <= cap
    assert sentry_spy.capture_message.call_count <= cap


def test_the_server_unknown_tag_does_not_leak_onto_a_later_event(monkeypatch):
    """Review WR-03: the tag belongs to the ONE capture it describes. The worker
    path (`SITE_VALIDATE_WORKER`) has no per-request scope, so an unscoped
    `set_tag` stays on the long-lived isolation scope and labels every later event
    the process sends, which mislabels unrelated failures in alert triage.

    REAL sentry_sdk, not the MagicMock spy: a spy cannot tell a scoped tag from an
    unscoped one. A client whose `before_send` records and drops each event stands
    in for the transport."""
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
            mt5_probe._capture_server_unknown_once(
                "unlisted:Some-Server", "mt5 server unknown", "mt5_server_unknown", "unlisted"
            )
            sentry_sdk.capture_message("an unrelated later failure")
    finally:
        sentry_sdk.get_global_scope().set_client(previous)

    assert len(events) == 2, f"expected the alert and the later event, got {events!r}"
    alert, later = events
    assert alert["tags"].get("mt5_server_unknown") == "unlisted", (
        "the alert itself must still carry its tag"
    )
    assert "mt5_server_unknown" not in (later.get("tags") or {}), (
        "the tag leaked onto an unrelated later event: it was set on the "
        "long-lived scope instead of the capture's own (review WR-03)"
    )


def test_the_house_server_is_never_refused(monkeypatch, sentry_spy):
    _set_env(monkeypatch, known=None, house="House-Live")

    assert_mt5_server_known("  house-LIVE ", site=_SITE)

    sentry_spy.capture_message.assert_not_called()


def test_a_listed_server_passes_after_trim_and_case_fold(monkeypatch):
    _set_env(monkeypatch, known=" , Broker Ltd Live 2 ,Other-Demo,", house=None)

    assert_mt5_server_known("  broker LTD live 2", site=_SITE)
    assert_mt5_server_known("OTHER-demo", site=_SITE)
    # Spaces INSIDE a name are kept: collapsing them would admit a different server.
    with pytest.raises(Mt5ServerUnknownError):
        assert_mt5_server_known("BrokerLtdLive2", site=_SITE)


def test_the_logged_server_is_sanitised(monkeypatch, sentry_spy, caplog):
    _set_env(monkeypatch, known="Listed-Live", house=None)
    hostile = "Evil\nINJECTED line\x07\x1b[31m" + "x" * 100

    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(Mt5ServerUnknownError):
            assert_mt5_server_known(hostile, site=_SITE)

    text = _error_records(caplog)[0].getMessage()
    assert "\n" not in text and "\x07" not in text and "\x1b" not in text
    assert "x" * 64 not in text, "the server is capped at 64 characters"
    assert "x" * 40 in text, "the printable head of the server is still named"
    sanitised = mt5_probe.sanitise_mt5_server_for_log(hostile)
    assert len(sanitised) <= 64 and sanitised.isprintable()
    sent = sentry_spy.capture_message.call_args.args[0]
    assert "\n" not in sent and "\x07" not in sent


def test_an_empty_known_server_list_raises_unconfigured(
    monkeypatch, sentry_spy, caplog
):
    _set_env(monkeypatch, known=None, house=None)

    with caplog.at_level(logging.DEBUG, logger=_ANALYTICS_LOGGER):
        with pytest.raises(Mt5KnownServersUnconfigured):
            assert_mt5_server_known("Whatever-Live", site=_SITE)
        with pytest.raises(Mt5KnownServersUnconfigured):
            assert_mt5_server_known("Whatever-Live", site=_SITE)

    errors = _error_records(caplog)
    assert len(errors) == 2
    text = errors[0].getMessage()
    assert "MT5_KNOWN_SERVERS" in text and "MT5_SERVER" in text
    assert "Whatever-Live" not in text, "names only: the user's server is not on this line"
    assert sentry_spy.capture_message.call_count == 1, "deduped under its own cause"


def test_blank_entries_alone_are_an_empty_list(monkeypatch):
    _set_env(monkeypatch, known=" , ,, ", house="   ")

    assert mt5_probe.read_env_known_mt5_servers() == frozenset()
    with pytest.raises(Mt5KnownServersUnconfigured):
        assert_mt5_server_known("Anything", site=_SITE)


def test_the_two_refusals_are_plain_exceptions():
    """Never `Mt5ClientError` (the classify arm would reroute them) and never
    `Mt5ValidationError` (its `kind` Literal is a pinned three-way contract)."""
    from services.mt5_client import Mt5ClientError
    from services.mt5_validation import Mt5ValidationError

    for exc in (Mt5ServerUnknownError, Mt5KnownServersUnconfigured):
        assert issubclass(exc, Exception)
        assert not issubclass(exc, Mt5ClientError)
        assert not issubclass(exc, Mt5ValidationError)
    assert not issubclass(Mt5ServerUnknownError, Mt5KnownServersUnconfigured)
    assert not issubclass(Mt5KnownServersUnconfigured, Mt5ServerUnknownError)


# Every substring needle of `wizardErrors.ts::classifyKeyValidationError`'s cascade (the
# comment in `closed_sets.py` plus the `master password`, `broker server` and `etimedout`
# branches that comment omits). ONE module-level tuple, so the two detail sweeps below
# (Phase 164.6.6.3 plan 05 and Phase 164.6.6.3.2 plan 02) read the same list and cannot
# drift apart. Hoisted byte-identical from the local tuple the first sweep used to carry.
_CASCADE_NEEDLES = (
    "signature",
    "invalid secret",
    "authentication failed",
    "invalid_credentials",
    "rate",
    "429",
    "timeout",
    "etimedout",
    "could not verify",
    "permission scope",
    "probe",
    "trading",
    "withdraw",
    "master password",
    "broker server",
)


def test_server_unknown_detail_collides_with_no_cascade_needle():
    """`wizardErrors.ts::classifyKeyValidationError` is substring-based. These are
    every needle in that cascade (the comment in `closed_sets.py` plus the
    `master password`, `broker server` and `etimedout` branches that comment omits).
    A hit would mis-classify this refusal; `broker server` in particular would turn
    it into KEY_MT5_WRONG_SERVER."""
    lower = MT5_SERVER_UNKNOWN_DETAIL.lower()
    hits = [n for n in _CASCADE_NEEDLES if n in lower]
    assert hits == [], f"MT5_SERVER_UNKNOWN_DETAIL collides with cascade needle(s) {hits}"
    assert not ("ip" in lower and "allow" in lower), "collides with the ip+allow branch"


def test_terminal_busy_detail_collides_with_no_cascade_needle():
    """Phase 164.6.6.3.2 D-02. The busy refusal's detail is forwarded VERBATIM by the
    dashboard key forms (`src/app/api/keys/validate-and-encrypt/route.ts`), where a 4xx
    `detail` is classified by the SAME substring cascade. A hit would turn a briefly busy
    terminal into some other card ("timeout" would put it back on KEY_NETWORK_TIMEOUT,
    the very cause this code exists to stop reporting), so the wire code must be the only
    way it is recognised."""
    from services.closed_sets import MT5_TERMINAL_BUSY_DETAIL

    lower = MT5_TERMINAL_BUSY_DETAIL.lower()
    hits = [n for n in _CASCADE_NEEDLES if n in lower]
    assert hits == [], f"MT5_TERMINAL_BUSY_DETAIL collides with cascade needle(s) {hits}"
    assert not ("ip" in lower and "allow" in lower), "collides with the ip+allow branch"


# ---------------------------------------------------------------------------
# Phase 164.6.6.3 plan 05 (D-09, D-10, D-11, D-14) - the router disposition.
#
# The seam above decides; these gates pin what the ROUTER does with the decision.
# Each drives `_validate_mt5_key_probe` directly so the trace the terminal event
# is built from is visible.
# ---------------------------------------------------------------------------


async def _probe(router, *, passphrase: str):
    req = _make_req(passphrase=passphrase)
    trace = router._Mt5ValidateTrace()
    try:
        return await router._validate_mt5_key_probe(
            req.api_key, req.api_secret, req.passphrase, trace
        ), trace
    except HTTPException as exc:
        return exc, trace


class _LeaseTouched(AssertionError):
    pass


async def test_an_unlisted_server_is_refused_at_the_router_before_login(
    exchange_router, monkeypatch
):
    """SC4 / D-09 / D-10: the unlisted server never reaches a client, a lease or
    `login()`. Today it reaches the terminal and hangs 45.6 s before an unrelated
    cause is named."""
    router = exchange_router
    _set_env(monkeypatch, known="Listed-Live", house="House-Live")
    factory = MagicMock(side_effect=AssertionError("a client was built"))
    router.Mt5Client = factory

    def _no_lease(*_a, **_k):
        raise _LeaseTouched("the terminal lease was taken")

    monkeypatch.setattr(router, "mt5_terminal_lease", _no_lease)

    exc, trace = await _probe(router, passphrase="Unlisted-Live")

    assert isinstance(exc, VenueTransientHTTPException)
    assert exc.status_code == 424
    assert exc.code == "MT5_SERVER_UNKNOWN"
    assert exc.detail == MT5_SERVER_UNKNOWN_DETAIL
    assert exc.recoverable is True
    assert trace.outcome == "server_unknown"
    factory.assert_not_called()


async def test_a_listed_servers_login_stage_10005_still_reads_sign_in_failed(
    exchange_router, monkeypatch
):
    """D-11: a LISTED server that refuses at the login stage is still a sign-in
    failure with no Retry. The new code must not swallow it."""
    router = exchange_router
    _set_env(monkeypatch, known="Broker-Demo", house="House-Live")
    client = _make_client(login_raises=Mt5LoginRefusedError(-10005, "IPC timeout"))
    _install_mt5_client(router, client)

    exc, trace = await _probe(router, passphrase="Broker-Demo")

    assert isinstance(exc, VenueTransientHTTPException)
    assert exc.status_code == 424
    assert exc.code == "SIGN_IN_FAILED"
    assert exc.detail == SIGN_IN_FAILED_DETAIL
    assert exc.recoverable is False
    client.login.assert_called_once()


async def test_an_empty_known_server_list_answers_validation_unconfigured_at_the_router(
    exchange_router, monkeypatch
):
    """D-14 fails CLOSED, and an empty effective list is OUR configuration gap:
    an operator-facing 500 body, never "your server is unknown".

    CORRECTED 2026-10-07 (Phase 164.6.6.3.2 D-01): this arm used to reuse the
    existing MT5_GATEWAY_UNCONFIGURED code; it answers MT5_VALIDATION_UNCONFIGURED
    now so the wizard can name the cause. Only the D-31 arm keeps the old code."""
    router = exchange_router
    _set_env(monkeypatch, known=None, house=None)
    factory = MagicMock(side_effect=AssertionError("a client was built"))
    router.Mt5Client = factory

    exc, trace = await _probe(router, passphrase="Anything-Live")

    assert isinstance(exc, HTTPException)
    assert exc.status_code == 500
    detail = exc.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "MT5_VALIDATION_UNCONFIGURED"
    assert trace.outcome == "gateway_unconfigured"
    factory.assert_not_called()


# ---------------------------------------------------------------------------
# Phase 164.6.6.3 plan 06 (D-09, PARITY-01) - the worker adapter's disposition.
#
# The router gates above pin one path. The adapter (`Mt5Adapter.validate`, the
# `long_fetch` onboard/resync path) is the SIBLING validate path and must dispose of
# the same input the same way, at the same position: after the endpoint check,
# before the lease and the client.
# ---------------------------------------------------------------------------


def _adapter_request(*, passphrase: str):
    from services.ingestion.adapter import KeySubmissionRequest

    return KeySubmissionRequest(
        flow_type="onboard",
        source="mt5",
        context={
            "api_key": "123456",
            "api_secret": "investor-pw",
            "passphrase": passphrase,
        },
    )


def _adapter_env(monkeypatch, *, known: str | None, house: str | None) -> None:
    _set_env(monkeypatch, known=known, house=house)
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_HOST", "mt5-validate-gw.internal")
    monkeypatch.setenv("MT5_VALIDATION_GATEWAY_PORT", "18813")


async def test_the_adapter_refuses_an_unlisted_server_before_building_a_client(
    monkeypatch,
):
    """D-09: the adapter names an unlisted server before any client or lease, with
    the router's code and detail. `permanent=False` because a corrected spelling, or
    the founder adding the server, clears it, and `long_fetch` treats a stated
    verdict as authoritative (so a True here would park a fixable key for good)."""
    from services.ingestion.mt5 import Mt5Adapter

    _adapter_env(monkeypatch, known="Listed-Live", house="House-Live")
    factory = MagicMock(side_effect=AssertionError("the adapter built a client"))
    monkeypatch.setattr("services.ingestion.mt5._build_client", factory)

    def _no_lease(*_a, **_k):
        raise _LeaseTouched("the terminal lease was taken")

    monkeypatch.setattr("services.ingestion.mt5.mt5_terminal_lease", _no_lease)

    result = await Mt5Adapter().validate(_adapter_request(passphrase="Unlisted-Live"))

    assert result.valid is False
    assert result.error_code == "MT5_SERVER_UNKNOWN"
    assert result.human_message == MT5_SERVER_UNKNOWN_DETAIL
    assert result.permanent is False
    factory.assert_not_called()


async def test_the_adapter_treats_an_empty_list_as_configuration(monkeypatch):
    """D-14: an empty effective list is OUR gap, never "your server is unknown".
    The adapter's endpoint arm already raises a configuration `RuntimeError`; this
    is a second raise site of the same kind, naming the two variables only."""
    from services.ingestion.mt5 import Mt5Adapter

    _adapter_env(monkeypatch, known=None, house=None)
    factory = MagicMock(side_effect=AssertionError("the adapter built a client"))
    monkeypatch.setattr("services.ingestion.mt5._build_client", factory)

    with pytest.raises(RuntimeError) as ei:
        await Mt5Adapter().validate(_adapter_request(passphrase="Anything-Live"))

    message = str(ei.value)
    assert "MT5_KNOWN_SERVERS" in message and "MT5_SERVER" in message
    assert "Anything-Live" not in message, "the user's server must never reach it"
    assert not isinstance(ei.value, Mt5ServerUnknownError)
    factory.assert_not_called()
