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

from services import mt5_probe
from services.closed_sets import MT5_SERVER_UNKNOWN_DETAIL
from services.mt5_probe import (
    Mt5KnownServersUnconfigured,
    Mt5ServerUnknownError,
    assert_mt5_server_known,
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


def test_server_unknown_detail_collides_with_no_cascade_needle():
    """`wizardErrors.ts::classifyKeyValidationError` is substring-based. These are
    every needle in that cascade (the comment in `closed_sets.py` plus the
    `master password`, `broker server` and `etimedout` branches that comment omits).
    A hit would mis-classify this refusal; `broker server` in particular would turn
    it into KEY_MT5_WRONG_SERVER."""
    lower = MT5_SERVER_UNKNOWN_DETAIL.lower()
    needles = (
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
    hits = [n for n in needles if n in lower]
    assert hits == [], f"MT5_SERVER_UNKNOWN_DETAIL collides with cascade needle(s) {hits}"
    assert not ("ip" in lower and "allow" in lower), "collides with the ip+allow branch"

