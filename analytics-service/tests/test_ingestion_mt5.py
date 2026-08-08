"""Phase 135 (MT5SRC-01, 135-01) — Mt5Adapter unit + registration pins.

The mt5 ingestion adapter mirrors ``SfoxAdapter``/``DeribitAdapter`` (the
broker-dailies analogs): its ``compute_metrics`` FAILS LOUD so MT5 returns can
only ever flow through the deal-ledger daily-NAV reconstruction (Phase 136,
``combine_mt5_deal_ledger``) → the broker-dailies ONE backbone, never a
fill-based ``process_key`` metrics snapshot (the BYB-02 silently-empty/wrong-
track-record corruption class). ``fetch_raw`` is likewise fail-loud (no
synchronous consumer — the raise is the tripwire against invented mapping).

MT5 adds a behavioral probe sFOX lacks: the investor-vs-master rejection. These
tests drive ``Mt5Adapter.validate`` against the Phase-134 ``Mt5Client``'s injected
``_connect`` transport double (the same offline contract fixture pattern —
no ``mt5linux`` install, no network, no live terminal).

Regression gates — WHY each case matters (Rule 9):
  - compute_metrics fail-loud: a fill-based mt5 snapshot is the BYB-02 corruption
    class; the message names the Phase-136 deal-ledger path so a future refactor
    that "helpfully" delegates to EquityCurveBuilder reddens.
  - validate master-reject (T-135-01, EoP): a trade-capable (master) login must
    be REJECTED so it is NEVER encrypted/persisted as read-only.
  - validate auth honesty (T-135-03, fail-closed): only a clear auth signal
    blames the credentials (→ AUTH_FAILED, byte-identical to the ccxt arm so the
    TS classifier maps KEY_AUTH_FAILED with zero edits). A wrong-server signal is
    distinguishable; an unrecognized transient PROPAGATES (never auth-failed, never
    valid).
  - close() on EVERY path: the terminal session must never leak — asserted on
    success, master-reject, auth-fail, and propagating-transient paths.
  - registration lockstep: get_adapter("mt5") resolves + caches; the Source
    Literal and SUPPORTED_SOURCES admit mt5 TOGETHER with the factory.
"""
from __future__ import annotations

import asyncio
import typing

import pytest

from services.closed_sets import (
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
    mt5_enabled_server,
)
from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion import IngestionAdapter
from services.ingestion.adapter import KeySubmissionRequest, MetricsSnapshot
from services.ingestion.mt5 import Mt5Adapter
from services.mt5_client import Mt5Client, Mt5ClientError
from services.mt5_validation import classify_mt5_login_error


# --------------------------------------------------------------------------- #
# Offline Mt5Client transport double (the Phase-134 contract fixture pattern)
# --------------------------------------------------------------------------- #


class _FakeNamedTuple:
    """Emulates a netref namedtuple: exposes _asdict() only (like an RPyC proxy).
    The client must materialize via ``._asdict()`` — the double only offers that
    seam, never a plain dict."""

    def __init__(self, **fields) -> None:
        self._fields_dict = dict(fields)

    def _asdict(self) -> dict:
        return dict(self._fields_dict)


class _FakeMt5:
    """In-memory RPyC/MT5-shaped double driven by a scenario dict.

    Scenario keys (all optional): login (default True), account, terminal,
    order_check, last_error (default (0, "unknown")), login_raises (login RAISES
    this), terminal_info_raises (terminal_info RAISES this).
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self.shutdown_calls = 0

    def initialize(self):
        # Real login() attaches the terminal IPC via initialize() before login().
        exc = self._scenario.get("initialize_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("initialize", True)

    def login(self, login, **kwargs):
        exc = self._scenario.get("login_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("login", True)

    def account_info(self):
        return self._scenario.get("account")

    def terminal_info(self):
        # D-31: the terminal's OWN state — the signal every read_only verdict is
        # now gated on. A scenario that omits "terminal" returns None, which the
        # client treats as an ERROR (never as data), so an unset key exercises
        # the unreadable-terminal refusal rather than silently passing.
        exc = self._scenario.get("terminal_info_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("terminal")

    def order_check(self, **request):  # client passes KEYWORDS (mt5linux eval form)
        return self._scenario.get("order_check")

    def last_error(self):
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):
        self.shutdown_calls += 1


def _install_client(monkeypatch, scenario: dict) -> _FakeMt5:
    """Patch the adapter's _build_client to return a real Mt5Client wrapping the
    in-memory double, and set the gateway env. Returns the fake so tests can
    assert shutdown (close) was called."""
    fake = _FakeMt5(scenario)

    def _connect(*, host, port, timeout):
        return fake

    def _fake_build(host: str, port: int) -> Mt5Client:
        return Mt5Client(host, port, _connect=_connect)

    monkeypatch.setattr("services.ingestion.mt5._build_client", _fake_build)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")
    return fake


def _req(api_key="123456", api_secret="investor-pw", passphrase="Broker-Demo"):
    # Credential-slot reuse: login → api_key, investor password → api_secret,
    # broker server → passphrase.
    return KeySubmissionRequest(
        flow_type="onboard",
        source="mt5",
        context={
            "api_key": api_key,
            "api_secret": api_secret,
            "passphrase": passphrase,
        },
    )


_METRICS_SENTINEL = MetricsSnapshot(
    sharpe=None,
    twr=None,
    ytd=None,
    max_drawdown=None,
    total_pnl=None,
    trade_count=0,
    win_rate=None,
)

# login=123456 matches the parsed login from _req's api_key="123456" so the RED-TEAM
# login bracket (account_info().login == expected, pre+post) passes on the happy path.
_INVESTOR_ACCOUNT = _FakeNamedTuple(trade_allowed=False, balance=1000.0, login=123456)
# An investor order_check is rejected with the DOCUMENTED investor code
# TRADE_RETCODE_TRADE_DISABLED (10017) — [DOC] enum_trade_return_codes.
#
# D-31 HISTORY: this fixture used to be retcode=10027 with NO terminal read at
# all, and that pair WAS the fail-open scenario — under MetaQuotes' default-ON
# "Disable automatic trading through the external Python API" a MASTER password
# produces exactly those two negatives, and the old two-signal rule returned
# ValidationResult(valid=True, read_only=True) for it.
_INVESTOR_ORDER_CHECK = _FakeNamedTuple(retcode=10017, comment="Trade disabled")
# The terminal ITSELF permits trading and is attached to a trade server, so an
# account-level refusal is attributable to the ACCOUNT. Required for any
# read_only verdict (D-31).
_HEALTHY_TERMINAL = _FakeNamedTuple(connected=True, trade_allowed=True, build=4410)


# --------------------------------------------------------------------------- #
# Fail-loud RETURNS axis
# --------------------------------------------------------------------------- #


def test_compute_metrics_fails_loud_naming_the_deal_ledger_path() -> None:
    adapter = Mt5Adapter()
    with pytest.raises(NotImplementedError) as exc:
        adapter.compute_metrics([])
    msg = str(exc.value)
    # Names the Phase-136 deal-ledger ONE-path so a future EquityCurveBuilder
    # delegation (the corruption path) can't slip in silently.
    assert "combine_mt5_deal_ledger" in msg
    assert "BYB-02" in msg


def test_fetch_raw_fails_loud() -> None:
    adapter = Mt5Adapter()
    with pytest.raises(NotImplementedError) as exc:
        asyncio.run(adapter.fetch_raw({"api_key": "123"}))
    assert "Phase 136" in str(exc.value)


# --------------------------------------------------------------------------- #
# validate — investor accepted, master rejected, fail-closed honesty, close()
# --------------------------------------------------------------------------- #


def test_validate_investor_valid_readonly_and_close(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is True
    assert result.read_only is True  # STRUCTURAL (no trade surface), not probed
    assert result.error_code is None
    assert fake.shutdown_calls == 1  # close() on the success path


def test_validate_terminal_trade_disabled_never_returns_readonly(monkeypatch) -> None:
    """⭐ D-31 SECURITY REGRESSION at the ADAPTER seam — the CLASS half of the fix.

    `is_trade_capable` had TWO call sites. Fixing only the router would leave
    `Mt5Adapter.validate` fail-OPEN, which is the instance-not-class defect this
    milestone has been bitten by repeatedly — so THIS test is the one that proves
    the fix is a class fix. It is red against a router-only remedy.

    Same inputs as the router regression: the terminal is connected but its own
    trade permission is off (MetaQuotes' default-ON "Disable automatic trading
    through the external Python API"), under which a MASTER password produces the
    identical two negatives. The adapter must NOT return
    ValidationResult(valid=True, read_only=True); it refuses with the same
    server-misconfiguration disposition it already uses for an unconfigured
    gateway, because no retry can clear a setting in our own terminal.
    """
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _FakeNamedTuple(connected=True, trade_allowed=False),
        },
    )

    with pytest.raises(RuntimeError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    # Names the operator remedy, never the user's credentials.
    msg = str(exc.value)
    assert "server misconfiguration" in msg
    assert "investor-pw" not in msg
    assert "Broker-Demo" not in msg
    assert fake.shutdown_calls == 1  # close() still runs on the refusal path


def test_validate_unreadable_terminal_propagates_transient_never_readonly(
    monkeypatch,
) -> None:
    """An unreadable terminal yields no capability signal, so the two account
    negatives prove nothing — refuse. The adapter takes its TRANSIENT disposition
    (propagate) rather than the permanent operator arm, because a detached/
    unreadable bridge clears on retry. Never valid, never read_only."""
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            # No "terminal" key -> terminal_info() returns None -> the client
            # treats it as an ERROR and raises, which the validate path catches
            # and turns into "no signal".
        },
    )

    with pytest.raises(Mt5ClientError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    # The message must NOT carry a wrong_server/auth token, or a caller running
    # classify_mt5_login_error over it would blame the user's broker server for
    # our gateway's condition.
    assert classify_mt5_login_error(exc.value) == "transient"
    assert fake.shutdown_calls == 1


def test_validate_disconnected_terminal_is_transient_never_readonly(
    monkeypatch,
) -> None:
    """A terminal detached from the trade server is a documented SIBLING cause of
    the account-level refusal ([DOC] MQL5 "Trade permission"), so investor mode is
    not attributable — refuse, transiently, never read_only."""
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _FakeNamedTuple(connected=False, trade_allowed=True),
        },
    )

    with pytest.raises(Mt5ClientError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    assert classify_mt5_login_error(exc.value) == "transient"
    assert fake.shutdown_calls == 1


def test_validate_master_via_trade_allowed_rejected(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {
            "account": _FakeNamedTuple(trade_allowed=True, login=123456),
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_MASTER_PASSWORD"
    # Byte-identity pin — the cross-language contract string.
    assert result.human_message == MT5_MASTER_PASSWORD_DETAIL
    assert fake.shutdown_calls == 1  # close() on the master-reject path


def test_validate_master_via_order_check_retcode_rejected(monkeypatch) -> None:
    # trade_allowed False but the order_check probe would be ACCEPTED (retcode
    # TRADE_RETCODE_DONE) — either positive signal rejects (Pitfall 4).
    fake = _install_client(
        monkeypatch,
        {
            "account": _FakeNamedTuple(trade_allowed=False, login=123456),
            "order_check": _FakeNamedTuple(retcode=10009, comment="Done"),
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_MASTER_PASSWORD"
    assert result.human_message == MT5_MASTER_PASSWORD_DETAIL


def test_validate_bad_creds_maps_to_auth_failed(monkeypatch) -> None:
    # login returns falsy -> Mt5Client._raise_last reads last_error -> Mt5ClientError
    # whose text is classified 'auth' (contains "invalid"/"account"/"password").
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (134, "invalid account or password")},
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "AUTH_FAILED"
    # Byte-identity with services/exchange.py AUTH_FAILED_DETAIL (zero TS edits).
    assert result.human_message == AUTH_FAILED_DETAIL
    assert fake.shutdown_calls == 1  # close() on the auth-fail path


def test_validate_wrong_server_maps_to_wrong_server(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (0, "trade server not found")},
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.human_message == MT5_WRONG_SERVER_DETAIL
    assert fake.shutdown_calls == 1


def test_validate_transient_propagates_untouched_and_closes(monkeypatch) -> None:
    # An unrecognized login error must NEVER read as auth-failed OR valid — it
    # PROPAGATES so the caller classifies it honestly (F4). close() still runs.
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (0, "timeout waiting for response")},
    )

    with pytest.raises(Mt5ClientError):
        asyncio.run(Mt5Adapter().validate(_req()))
    assert fake.shutdown_calls == 1  # session never leaks on the propagating path


def test_validate_non_numeric_login_fails_closed_without_client(monkeypatch) -> None:
    # A non-numeric MT5 login cannot authenticate — fail CLOSED with AUTH_FAILED
    # and NEVER construct a client (guard the spy).
    def _boom(host, port):
        raise AssertionError("_build_client must not be called for a bad login")

    monkeypatch.setattr("services.ingestion.mt5._build_client", _boom)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "h")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    result = asyncio.run(Mt5Adapter().validate(_req(api_key="not-a-login")))

    assert result.valid is False
    assert result.error_code == "AUTH_FAILED"
    assert result.human_message == AUTH_FAILED_DETAIL


def test_validate_blank_server_is_wrong_server(monkeypatch) -> None:
    def _boom(host, port):
        raise AssertionError("_build_client must not be called for a blank server")

    monkeypatch.setattr("services.ingestion.mt5._build_client", _boom)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "h")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    result = asyncio.run(Mt5Adapter().validate(_req(passphrase="   ")))

    assert result.valid is False
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.human_message == MT5_WRONG_SERVER_DETAIL


def test_validate_missing_gateway_env_raises_server_misconfig(monkeypatch) -> None:
    # Missing MT5_GATEWAY_HOST/PORT is a SERVER misconfig, propagated — never
    # valid, never blames the user's creds.
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)
    monkeypatch.delenv("MT5_GATEWAY_PORT", raising=False)
    with pytest.raises(RuntimeError, match="MT5 gateway not configured"):
        asyncio.run(Mt5Adapter().validate(_req()))


def test_validate_probe_hang_bounded_by_wait_for_ceiling(monkeypatch) -> None:
    """WR-02 (WEDGE-01 defense-in-depth): a probe that blocks PAST the outer
    ceiling must raise (TimeoutError) rather than let the sequential worker await
    a hung thread unbounded — matching the router's wait_for guard. close() still
    runs so the terminal session never leaks.

    Against the pre-fix unbounded ``await asyncio.to_thread(_probe)`` there is NO
    ``_MT5_PROBE_TIMEOUT_S`` ceiling: the probe runs to completion (no
    TimeoutError, disposition wrong) — the exact WEDGE-01 divergence this closes.
    """
    import time

    class _BlockingClient:
        def __init__(self) -> None:
            self.shutdown_calls = 0

        def login(self, *a, **k):
            # Block LONGER than the (monkeypatched-tiny) ceiling so wait_for fires
            # first. This stands in for a hang outside a bounded rpyc round-trip.
            time.sleep(1.0)

        def account_info(self):
            return {"trade_allowed": False}

        def order_check(self, request):
            return {"retcode": 10027}

        def close(self):
            self.shutdown_calls += 1

    client = _BlockingClient()
    monkeypatch.setattr(
        "services.ingestion.mt5._build_client", lambda host, port: client
    )
    # Shrink the last-resort ceiling so the test does not wait the real ~35s.
    monkeypatch.setattr("services.ingestion.mt5._MT5_PROBE_TIMEOUT_S", 0.1)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(Mt5Adapter().validate(_req()))
    assert client.shutdown_calls == 1  # close() ran even though the probe was cut off


# --------------------------------------------------------------------------- #
# Execution-detail axis — delegation, not re-implementation
# --------------------------------------------------------------------------- #


def test_compute_fingerprint_delegates_and_returns() -> None:
    fp = Mt5Adapter().compute_fingerprint([], _METRICS_SENTINEL)
    assert fp.version == 1


def test_reconstruct_positions_delegates_and_returns() -> None:
    positions = asyncio.run(Mt5Adapter().reconstruct_positions([]))
    assert positions == []


def test_mt5_adapter_satisfies_protocol() -> None:
    assert isinstance(Mt5Adapter(), IngestionAdapter)


# --------------------------------------------------------------------------- #
# Registration lockstep (Phase 135 MT5SRC-01)
# --------------------------------------------------------------------------- #


def test_get_adapter_mt5_resolves_and_caches() -> None:
    from services.ingestion import ADAPTERS, get_adapter

    ADAPTERS.pop("mt5", None)
    adapter = get_adapter("mt5")
    assert isinstance(adapter, Mt5Adapter)
    # Cached: a second call returns the SAME instance.
    assert get_adapter("mt5") is adapter


def test_unknown_source_still_rejected() -> None:
    from services.ingestion import get_adapter

    with pytest.raises(ValueError, match="Unsupported source"):
        get_adapter("kraken")


def test_source_literal_admits_mt5() -> None:
    from services.ingestion import SUPPORTED_SOURCES
    from services.ingestion.adapter import Source

    assert "mt5" in typing.get_args(Source)
    assert "mt5" in SUPPORTED_SOURCES


# --------------------------------------------------------------------------- #
# Go-dark server gate — mt5_enabled_server truth table (fail-closed)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, False),  # unset
        ("", False),
        ("1", False),
        ("on", False),
        ("false", False),
        ("true", True),
        ("True", True),
        ("TRUE ", True),  # .strip().lower() normalization
    ],
)
def test_mt5_enabled_server_truth_table(monkeypatch, value, expected) -> None:
    if value is None:
        monkeypatch.delenv("MT5_ENABLED", raising=False)
    else:
        monkeypatch.setenv("MT5_ENABLED", value)
    assert mt5_enabled_server() is expected
