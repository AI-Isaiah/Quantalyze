"""Phase 135 / WR-01 regression — the MT5 pre-probe credential validation must
classify EVERY missing/blank credential combination IDENTICALLY on both call
sites (the FastAPI ``_validate_mt5_key`` router branch and the
``Mt5Adapter.validate`` worker branch).

Before the fix the two paths hand-implemented the guard set independently and
DIVERGED: the adapter lacked the router's blank-password guard, and the two used
different check ordering (router: server -> login -> password; adapter: login ->
server). A doubly-blank login+server request therefore classified as
``MT5_WRONG_SERVER`` through the router but ``AUTH_FAILED`` through the adapter —
the exact drift the single ``mt5_validation`` seam exists to prevent. Both now
call ``parse_mt5_credentials``, so the classification cannot drift.

These tests FAIL against the pre-fix divergent code (the doubly-blank case
returns two different details; the blank-password case burns a live client build
on the adapter path) and PASS once both sides defer to the one seam.

Phase 153.6 / PARITY-01 — THE SECOND DIVERGENCE, same shape, same file. The
OFFLINE seam above held, and the ONLINE probe drifted instead: each path carried
its own hand-written ``_read_terminal`` / ``_probe`` closure, and all THREE fixes
153.3 landed on the router's copy were missing from the adapter's —

  * **A1** the terminal short-circuit. Without it ``order_check`` still ran on an
    already-``"undetermined"`` verdict, and the refusal that the *"Disable
    automatic trading through the external Python API"* option produces was read
    through ``_WRONG_SERVER_TOKENS`` (which carry "terminal") as *the user's
    broker server is wrong* — an accusation against the user for a checkbox in
    OUR gateway.
  * **A2** the broad arm around netref materialization. Without it a raw
    transport raise escaped the refusal entirely, and with it the exception TEXT
    would have been logged — ``mt5linux`` f-string-interpolates the password into
    remotely-eval'd source, so only the CLASS is safe (T-134-01 / T-153.3-23).
  * **A3** the operator-fault refusal. On the adapter it was a bare
    ``RuntimeError``, which fell through ``job_worker.classify_exception`` to
    ``("unknown", str(exc))`` — so the worker RETRIED a fault no retry can clear,
    re-running the whole serialized probe against the ONE shared terminal each
    time, and rendered internal copy naming investor/master passwords.

Both paths now call ``services/mt5_probe.py``, so the three cannot drift. ⭐ The
cases below compare the two paths' DISPOSITIONS, never their implementations —
an assertion that both call the same function proves only that today's code was
written today. Each drives a fake client through BOTH the router (via the
``exchange_module`` fixture) and the adapter (via ``_adapter_req``).

⭐ **TWO GUARDS, TWO QUESTIONS. Do not ask either to do the other's job.**

| Guard | Question it answers | Can it catch a second COPY? |
|---|---|---|
| this file (behavioural) | *"do the two paths DISPOSE of the same input identically?"* | ❌ never — two copies that agree today pass every case here, and that is precisely the state 153.3 shipped |
| ``tests/test_mt5_probe_parity_roster.py`` (structural, 153.6-05) | *"does a hand-written second copy of the probe body EXIST at all?"* | ✅ that is its only job |

The roster cross-references this file the same way. Neither is redundant: a
single shared body that somebody BREAKS is invisible to the roster (one wrong
copy is still one copy) and is caught here.
"""
from __future__ import annotations

import asyncio
import sys

import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock

from services import mt5_concurrency
from services.closed_sets import MT5_WRONG_SERVER_DETAIL
from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion.adapter import KeySubmissionRequest
from services.ingestion.mt5 import Mt5Adapter

# 161-02 / WIZERR-01 — imported at MODULE level (the rest of this file imports
# mt5_probe inside test bodies) for one reason: `@pytest.mark.parametrize`
# evaluates at COLLECTION time, and parametrizing the fence over the whole
# emittable family is what makes a newly-added cause arm fence-checked
# automatically instead of only when somebody remembers to add a case.
from services.mt5_probe import MT5_GATEWAY_MISCONFIGURED_DETAILS
from tests.limiter_stub import evict_module, patch_shared_limiter


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """MT5CONC-02: clear the ONE process-wide per-terminal ``asyncio.Lock`` +
    epoch registry around every test here, exactly as ``tests/test_ingestion_mt5.py``
    and ``tests/test_mt5_concurrency.py`` do.

    Load-bearing for the two-path cases below: each runs its own ``asyncio.run``
    loop through BOTH callers, and a Lock left in the registry by the router half
    would be re-entered from a DIFFERENT loop by the adapter half."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


@pytest.fixture()
def exchange_module(monkeypatch):
    """Import ``routers.exchange`` with slowapi stubbed (no-op Limiter). The
    pre-probe guards under test run BEFORE the MT5_ENABLED gate / any client
    construction, so no gateway env or live transport is needed here."""

    class _NoopLimiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            def decorator(fn):
                return fn

            return decorator

    slowapi_stub = MagicMock()
    slowapi_stub.Limiter = _NoopLimiter
    slowapi_util_stub = MagicMock()
    slowapi_util_stub.get_remote_address = lambda *a, **k: "1.2.3.4"
    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)

    # PYAPI-03: the routers no longer CONSTRUCT a Limiter, they import the
    # singleton from services.rate_limit — so rebinding `slowapi.Limiter` above
    # no longer reaches them and the REAL slowapi wrapper would reject the
    # MagicMock request this suite passes. Stub the INSTANCE too; must run
    # before the router is re-imported below. See tests/limiter_stub.py.
    patch_shared_limiter(monkeypatch)

    evict_module("routers.exchange")
    from routers import exchange

    yield exchange
    evict_module("routers.exchange")


def _adapter_req(*, api_key, api_secret, passphrase):
    return KeySubmissionRequest(
        flow_type="onboard",
        source="mt5",
        context={
            "api_key": api_key,
            "api_secret": api_secret,
            "passphrase": passphrase,
        },
    )


def _router_detail(exchange_module, *, api_key, api_secret, passphrase):
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            exchange_module._validate_mt5_key(api_key, api_secret, passphrase)
        )
    assert ei.value.status_code == 400
    return ei.value.detail


def test_doubly_blank_login_and_server_classifies_identically(exchange_module):
    """A request blank in BOTH login and server must classify the SAME through
    the router and the adapter. (Pre-fix: router -> wrong_server, adapter ->
    auth_failed — divergent.)"""
    router_detail = _router_detail(
        exchange_module, api_key="", api_secret="some-pw", passphrase=""
    )

    result = asyncio.run(
        Mt5Adapter().validate(
            _adapter_req(api_key="", api_secret="some-pw", passphrase="")
        )
    )

    # The seam's canonical (router) ordering checks server first -> wrong_server.
    assert result.human_message == router_detail
    assert result.human_message == MT5_WRONG_SERVER_DETAIL
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.valid is False


def test_blank_password_rejected_offline_on_both_paths(
    exchange_module, monkeypatch
):
    """A blank investor password must fail CLOSED (AUTH_FAILED) offline on BOTH
    paths, WITHOUT constructing a client / burning a live probe. (Pre-fix: the
    adapter had no blank-password guard and reached the client build.)"""
    # Router: any Mt5Client construction here is a regression.
    exchange_module.Mt5Client = MagicMock(
        side_effect=AssertionError("router must not build a client for a blank password")
    )
    # Adapter: any _build_client call here is a regression.
    monkeypatch.setattr(
        "services.ingestion.mt5._build_client",
        MagicMock(side_effect=AssertionError("adapter must not build a client for a blank password")),
    )
    # Gateway env set so the ONLY thing that can stop an unguarded old adapter is
    # the (now-hoisted) offline password guard — not a missing-env short-circuit.
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    router_detail = _router_detail(
        exchange_module, api_key="123456", api_secret="   ", passphrase="Broker-Demo"
    )

    result = asyncio.run(
        Mt5Adapter().validate(
            _adapter_req(api_key="123456", api_secret="   ", passphrase="Broker-Demo")
        )
    )

    assert result.human_message == router_detail
    assert result.human_message == AUTH_FAILED_DETAIL
    assert result.error_code == "AUTH_FAILED"
    assert result.valid is False


# ---------------------------------------------------------------------------
# Phase 153.6 / PARITY-01 — the SHARED probe body (`services/mt5_probe.py`)
# ---------------------------------------------------------------------------
# The cases above pin the OFFLINE pre-probe seam. The block below pins the ONLINE
# probe seam that replaced the second hand-written copy: 153.3 landed three fixes
# on `routers/exchange.py` and none of them reached `services/ingestion/mt5.py`,
# because each path carried its own `_read_terminal` / `_probe` closure. There is
# now ONE body in `services/mt5_probe.py` and both paths call it, so the three
# fixes cannot land once again.
#
# These are UNIT cases over the shared body itself; the two-path cases that prove
# the CALLERS actually reach it live further below.


class _FakeProbeClient:
    """Duck-typed stand-in for ``Mt5Client``. Records every verb the probe calls,
    so "``order_check`` was never reached" is asserted as an observation rather
    than inferred from a return value."""

    def __init__(self, *, account_info, terminal_info=None, terminal_raises=None):
        self._account_info = account_info
        self._terminal_info = terminal_info
        self._terminal_raises = terminal_raises
        self.calls: list[str] = []

    def login(self, login, password, server) -> None:
        self.calls.append("login")

    def account_info(self) -> dict:
        self.calls.append("account_info")
        return dict(self._account_info)

    def terminal_info(self) -> dict:
        self.calls.append("terminal_info")
        if self._terminal_raises is not None:
            raise self._terminal_raises
        return dict(self._terminal_info or {})

    def order_check(self, request) -> dict:
        self.calls.append("order_check")
        return {"retcode": 10017}

    # Both teardown verbs, deliberately: the router releases and the adapter
    # closes, and a double offering only one would hide a leak on that path.
    def release(self) -> None:
        self.calls.append("release")

    def close(self) -> None:
        self.calls.append("close")


#: The investor-shaped account snapshot: authenticated, and the ACCOUNT-level
#: trade permission is off. On its own that proves nothing — under the terminal
#: option a MASTER password produces the identical negative (D-31 / EVIDENCE
#: §C12), which is why every case below turns on the TERMINAL signal.
_INVESTOR_ACCOUNT = {"login": 123456, "trade_allowed": False}

#: Terminal attached but refusing automated trading — MetaQuotes' default-ON
#: *"Disable automatic trading through the external Python API"*. This is the
#: OPERATOR FAULT: branch 5 of `classify_trade_capability` -> "undetermined".
_TERMINAL_TRADE_PERMISSION_OFF = {"connected": True, "trade_allowed": False}


def _drive_both_paths(exchange_module, monkeypatch, make_client):
    """Run ONE scenario through BOTH callers and return
    ``(router_outcome, router_client, adapter_outcome, adapter_client)``.

    Each outcome is the raised exception or the returned value — whichever the
    path produced — so a case can assert that the two DISPOSITIONS agree without
    either path's shape being privileged. A FRESH client per path: sharing one
    would let the router's calls satisfy an assertion about the adapter's.
    """
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    router_client = make_client()
    exchange_module.Mt5Client = MagicMock(return_value=router_client)
    try:
        router_outcome = asyncio.run(
            exchange_module._validate_mt5_key("123456", "investor-pw", "Broker-Demo")
        )
    except BaseException as exc:  # noqa: BLE001 — the raise IS the disposition
        router_outcome = exc

    adapter_client = make_client()
    monkeypatch.setattr(
        "services.ingestion.mt5._build_client", MagicMock(return_value=adapter_client)
    )
    try:
        adapter_outcome = asyncio.run(
            Mt5Adapter().validate(
                _adapter_req(
                    api_key="123456", api_secret="investor-pw", passphrase="Broker-Demo"
                )
            )
        )
    except BaseException as exc:  # noqa: BLE001
        adapter_outcome = exc

    return router_outcome, router_client, adapter_outcome, adapter_client


def test_read_terminal_reraises_an_abandoned_session_before_the_broad_arm():
    """⭐ D-09 / D-14 — B1 and A2 are ONE edit.

    `Mt5SessionAbandoned` is a plain `Exception` by design (D-42), so a broad
    `except Exception` swallows it. Absorbed here it becomes a `None` terminal
    read: an operator triaging in Railway reads a gateway MATERIALIZATION fault
    that never happened, and the probe continues on a "terminal unreadable"
    premise that is false. The fence type must reach its own arm first.
    """
    from services.mt5_client import Mt5SessionAbandoned
    from services.mt5_probe import read_terminal

    client = _FakeProbeClient(
        account_info={"login": 42},
        terminal_raises=Mt5SessionAbandoned("lease moved on"),
    )

    with pytest.raises(Mt5SessionAbandoned):
        read_terminal(client, log_prefix="unit")


def test_read_terminal_materialize_failure_logs_the_class_only(caplog):
    """A2 / T-134-01. An unconverted transport raise escapes `_guarded_read`'s
    scrubbing, and `mt5linux` f-string-interpolates the password into the source
    it evaluates remotely — so the exception MESSAGE is a credential-disclosure
    surface and only the CLASS is safe to log. The read must still fail CLOSED
    (None -> "undetermined" -> refusal)."""
    from services.mt5_probe import read_terminal

    secret = "s3cr3t-investor-pw"
    client = _FakeProbeClient(
        account_info={"login": 42},
        terminal_raises=OSError(f"rpyc eval failed: login(42, {secret}, Broker)"),
    )

    with caplog.at_level("WARNING"):
        assert read_terminal(client, log_prefix="unit") is None

    logged = caplog.text
    assert "error_class=OSError" in logged, logged
    assert secret not in logged, "the exception MESSAGE reached the log (T-134-01)"


def test_run_probe_short_circuits_order_check_on_an_undetermined_terminal():
    """⭐ A1 — the exact documented incident.

    Under MetaQuotes' default-ON *"Disable automatic trading through the external
    Python API"* the terminal refuses the probe, and that refusal's
    `Mt5ClientError` leaves by a different door: `classify_mt5_login_error`'s
    `_WRONG_SERVER_TOKENS` carry "terminal", so it came out as a 400 telling the
    user their BROKER SERVER is wrong — an accusation against the user for a
    checkbox in OUR gateway. Once the seam already answers "undetermined",
    `order_check` cannot improve the verdict and must not run.

    The POST login bracket still runs: the terminal read we classify on must
    belong to OUR account, exactly as a probe result would have had to.
    """
    from services.mt5_probe import run_probe

    client = _FakeProbeClient(
        account_info={"login": 42, "trade_allowed": False},
        terminal_info={"connected": True, "trade_allowed": False},
    )

    info, probe, terminal = run_probe(
        client, login=42, investor_pw="pw", server="Broker-Demo", log_prefix="unit"
    )

    assert "order_check" not in client.calls, client.calls
    assert probe == {}
    assert terminal == {"connected": True, "trade_allowed": False}
    assert info["login"] == 42
    # POST bracket: account_info is read a SECOND time and re-asserted.
    assert client.calls.count("account_info") == 2, client.calls


@pytest.mark.parametrize(
    "curated", MT5_GATEWAY_MISCONFIGURED_DETAILS, ids=lambda s: s[:32]
)
def test_every_builder_emittable_constant_is_curated_and_credential_free(curated):
    """A3's condition half, widened at 161-02 to EVERY constant the flag->cause
    builder can emit.

    The operator-fault copy is a curated constant rendered to a human, so it must
    name no credential and must carry no token from the live classification
    tables — a message containing "terminal" or "server" is one
    `classify_mt5_login_error` call away from being re-read as "the user's broker
    server is wrong", which is the very accusation A1 removed.

    ⭐ Parametrized over the FAMILY, not over a hand-listed pair: 161-02 turned one
    constant into three, and a fence that scans only the one it was written for
    would have gone on passing while two unchecked sentences shipped. The tokens
    are read from the LIVE tables, so a token added to `mt5_validation` reds here.
    """
    from services.mt5_validation import _AUTH_TOKENS, _WRONG_SERVER_TOKENS

    text = curated.lower()
    # ANTI-VACUITY, both directions. `"" in anything` is True in Python exactly as
    # `"x".includes("")` is in JS (161-01's Deviation 2), so a BLANKED constant
    # would satisfy every `not in` below while asserting nothing, and a BLANKED
    # token would match everything. Both are guarded before the sweep runs.
    assert len(text) > 40, "the curated constant is too short to be the real copy"
    assert _WRONG_SERVER_TOKENS and _AUTH_TOKENS, "empty token table proves nothing"
    for token in (*_WRONG_SERVER_TOKENS, *_AUTH_TOKENS):
        assert token, "a blank token is a substring of everything"
        assert token not in text, f"curated copy carries the classify token {token!r}"
    for word in ("password", "investor", "master", "secret"):
        assert word not in text, f"curated copy names the credential word {word!r}"


def test_the_curated_family_is_the_measured_three_and_they_are_distinct():
    """The family's SIZE is hand-typed, so a fourth cause arm cannot join the
    builder without a human deciding it belongs — and the three must be DISTINCT,
    or the arm-selection cases below would pass without selecting anything.
    """
    from services.mt5_probe import (
        MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL,
        MT5_GATEWAY_MISCONFIGURED_DETAIL,
        MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL,
        Mt5GatewayMisconfigured,
    )

    assert len(MT5_GATEWAY_MISCONFIGURED_DETAILS) == 3
    assert len(set(MT5_GATEWAY_MISCONFIGURED_DETAILS)) == 3, (
        "two arms carry the SAME sentence — selecting between them is unobservable"
    )
    assert set(MT5_GATEWAY_MISCONFIGURED_DETAILS) == {
        MT5_GATEWAY_MISCONFIGURED_DETAIL,
        MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL,
        MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL,
    }

    # The exception defaults to the GENERIC constant, so no call site can raise it
    # with raw remote text by omission. Unchanged by 161-02 and load-bearing:
    # `mt5linux` interpolates the password into remotely-eval'd source (T-134-01).
    assert str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL
    assert isinstance(Mt5GatewayMisconfigured(), Exception)


# --- 161-02 / WIZERR-01: the flag->cause builder ----------------------------
#
# ⭐ The expected sentences below are HAND-TYPED from 161-UI-SPEC § Copy Spec
# WIZERR-01, never imported from the module under test. An oracle that reads its
# expectation out of the thing it is testing asserts `copy(X) == copy(X)` and
# cannot fail (161-VALIDATION § Anti-Vacuity).
_EXPECTED_TRADE_PERMISSION_OFF = (
    "The MT5 gateway has 'Allow algorithmic trading' switched off, so read-only "
    "capability cannot be proven. The gateway switches it off again whenever it "
    "changes users, so turning it back on needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)
_EXPECTED_EXTERNAL_API_BLOCKED = (
    "The MT5 gateway blocks outside automated access (the 'Disable automatic "
    "trading through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)
_EXPECTED_GENERIC = (
    "MT5 gateway refuses automated trading (the 'Disable automatic trading "
    "through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)


@pytest.mark.parametrize(
    "terminal,expected,why",
    [
        (
            {"connected": True, "trade_allowed": False},
            _EXPECTED_TRADE_PERMISSION_OFF,
            "THE FOUNDER-MEASURED LIVE CASE (2026-08-13): trade_allowed false with "
            "the named option NOT in force. The pre-161-02 copy asserted that "
            "option WAS in force — a sentence measured to be false about the "
            "user's situation, on a founder-hit surface.",
        ),
        (
            {"connected": True, "trade_allowed": False, "tradeapi_disabled": False},
            _EXPECTED_TRADE_PERMISSION_OFF,
            "the flag is PRESENT and falsy — the option is not in force, so the "
            "cause is the algorithmic-trading setting, same as above",
        ),
        (
            {"connected": True, "trade_allowed": True, "tradeapi_disabled": True},
            _EXPECTED_EXTERNAL_API_BLOCKED,
            "the named option IS in force and is the only blockage reported",
        ),
        (
            {"connected": True, "trade_allowed": False, "tradeapi_disabled": True},
            _EXPECTED_EXTERNAL_API_BLOCKED,
            "PRECEDENCE: both flags indicate blockage and the NAMED option wins, "
            "deterministically — it subsumes the permission it already forces off",
        ),
        (
            {"connected": True, "trade_allowed": True},
            _EXPECTED_GENERIC,
            "⭐ THE A1 QUARANTINE: the flag is ABSENT and nothing else indicates a "
            "cause, so no cause may be asserted. A1 was founder-measured ONCE with "
            "zero production readers; an absent key must never select an arm.",
        ),
        (
            {},
            _EXPECTED_GENERIC,
            "an EMPTY terminal dict names no cause and must not raise KeyError — a "
            "raise here would fail the whole job permanently (T-161-05)",
        ),
        (
            None,
            _EXPECTED_GENERIC,
            "an UNREADABLE terminal (read_terminal fails CLOSED to None) names no "
            "cause and must not raise AttributeError",
        ),
        (
            {"connected": False, "trade_allowed": False},
            _EXPECTED_GENERIC,
            "DETACHED from the trade server: trade_allowed is false but the "
            "terminal-permission seam refuses to attribute it, so neither cause is "
            "provable and the honest generic ships",
        ),
        (
            "not-a-mapping",
            _EXPECTED_GENERIC,
            "a non-dict-ish terminal (untrusted remote shape) degrades, never raises",
        ),
    ],
)
def test_builder_selects_the_cause_arm_the_flags_actually_support(
    terminal, expected, why
):
    """⭐ 161-02 / WIZERR-01 — the ONE flag->cause seam both raise sites consume.

    WHY it is load-bearing (Rule 9). The single pre-161-02 constant asserted that
    the *'Disable automatic trading through the external Python API'* option was
    in force. On the live gateway the founder measured `tradeapi_disabled` FALSE
    while `trade_allowed` was FALSE: the real blocker was the Expert-Advisors
    "Allow algorithmic trading" setting, which the gateway re-sets off on every
    account change. So the sentence the operator read named the wrong checkbox and
    sent them to look at a setting that was already correct.

    The rows below pin the CAUSE each flag combination actually supports — and,
    just as load-bearing, pin that an unsupported combination asserts NO cause.
    """
    from services.mt5_probe import mt5_gateway_misconfigured_detail

    assert mt5_gateway_misconfigured_detail(terminal) == expected, why


def test_builder_never_names_a_flag_to_the_user():
    """The surface gets the CAUSE, never the sensor reading. `tradeapi_disabled`
    and `trade_allowed` are internal field names; leaking them tells the user
    nothing they can act on and couples our copy to a remote schema.
    """
    from services.mt5_probe import mt5_gateway_misconfigured_detail

    terminals = [
        {"connected": True, "trade_allowed": False},
        {"connected": True, "trade_allowed": False, "tradeapi_disabled": True},
        None,
    ]
    rendered = [mt5_gateway_misconfigured_detail(t) for t in terminals]
    assert len(set(rendered)) == 3, (
        "the sweep below must cover BOTH cause arms AND the generic fallback — if "
        "two of these collapse to one sentence it is scanning less than it claims"
    )
    for text in rendered:
        low = text.lower()
        for flag in ("tradeapi_disabled", "trade_allowed", "terminal_info"):
            assert flag not in low, f"user-facing copy names the flag {flag!r}"


def test_worker_sink_lets_a_curated_cause_through_but_never_raw_remote_text():
    """`classify_exception` reads the message through an ALLOW-LIST.

    Both halves matter and neither implies the other: returning the generic
    constant unconditionally (the pre-161-02 behaviour) is SAFE but discards the
    cause the raise site derived, while returning `str(exc)` would deliver the
    cause and also deliver anything else — and `mt5linux` f-string-interpolates
    the password into remotely-eval'd source (T-134-01 / T-153.3-23).
    """
    from services.job_worker import classify_exception
    from services.mt5_probe import Mt5GatewayMisconfigured

    for curated in MT5_GATEWAY_MISCONFIGURED_DETAILS:
        kind, message = classify_exception(Mt5GatewayMisconfigured(curated))
        assert kind == "permanent"
        assert message == curated, "a curated cause must reach the operator intact"

    kind, message = classify_exception(
        Mt5GatewayMisconfigured("raw remote text carrying s3cr3t-pw")
    )
    assert kind == "permanent"
    assert message == _EXPECTED_GENERIC
    assert "s3cr3t-pw" not in message


# ---------------------------------------------------------------------------
# The THREE parity cases — each driven through BOTH callers
# ---------------------------------------------------------------------------


def test_order_check_short_circuit_on_both_paths(exchange_module, monkeypatch):
    """⭐ A1 — ZERO ``order_check`` calls on EITHER path.

    The terminal is attached but refuses automated trading, so the ONE capability
    seam already answers "undetermined" from the terminal signal alone. Running
    ``order_check`` after that cannot improve the verdict and can DESTROY it: the
    refusal it produces is an ``Mt5ClientError`` that leaves by a different door,
    and ``_WRONG_SERVER_TOKENS`` carry "terminal", so it came back as a 400 telling
    the user their BROKER SERVER is wrong.

    ⚠️ THE CALL COUNT IS THE ORACLE, not the response. Both paths refused before
    this fix too — they just refused for a fabricated reason on the way. Asserting
    the probe was never ATTEMPTED is what distinguishes the two.

    Reds with the short-circuit deleted from ``mt5_probe.run_probe``: the adapter
    half is the one that was live for months, and this file's whole subject is a
    fix that landed once.
    """
    def make_client():
        return _FakeProbeClient(
            account_info=_INVESTOR_ACCOUNT,
            terminal_info=_TERMINAL_TRADE_PERMISSION_OFF,
        )

    router_outcome, router_client, adapter_outcome, adapter_client = _drive_both_paths(
        exchange_module, monkeypatch, make_client
    )

    assert "order_check" not in router_client.calls, router_client.calls
    assert "order_check" not in adapter_client.calls, adapter_client.calls
    # The PARITY assertion: the two paths agree that the probe is not attempted.
    assert (
        "order_check" in router_client.calls
    ) == ("order_check" in adapter_client.calls)

    # ...and neither path stamped a permissive verdict on the two account
    # negatives it could not attribute.
    assert isinstance(router_outcome, BaseException)
    assert isinstance(adapter_outcome, BaseException)
    # Never the accusation the missing short-circuit produced.
    assert MT5_WRONG_SERVER_DETAIL not in repr(router_outcome)
    assert MT5_WRONG_SERVER_DETAIL not in repr(adapter_outcome)


def test_terminal_materialize_failure_yields_no_signal_on_both_paths(
    exchange_module, monkeypatch, caplog
):
    """⭐ A2 — a materialization failure yields ``None`` from the terminal read on
    BOTH paths, and only the exception CLASS is logged.

    ``Mt5Client.terminal_info`` materializes the rpyc netref AFTER ``_guarded_read``
    has returned, so a connection dropped in that window raises a RAW transport
    exception that is NOT an ``Mt5ClientError``. Pre-fix the adapter's
    ``Mt5ClientError``-only catch let it escape the refusal entirely.

    ⛔ And the message must never be logged. ``mt5linux`` f-string-interpolates the
    password into the source it evaluates remotely, so the exception TEXT is a
    credential-disclosure surface (T-134-01 / T-153.3-23) — the double below
    embeds the live password in its message so a leak is observable rather than
    argued.
    """
    secret = "investor-pw"

    def make_client():
        return _FakeProbeClient(
            account_info=_INVESTOR_ACCOUNT,
            terminal_raises=OSError(
                f"rpyc: eval failed for login(123456, {secret}, Broker-Demo)"
            ),
        )

    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        (
            router_outcome,
            router_client,
            adapter_outcome,
            adapter_client,
        ) = _drive_both_paths(exchange_module, monkeypatch, make_client)

    # The read was ATTEMPTED on both paths and yielded no signal, so neither could
    # reach a read_only verdict.
    assert "terminal_info" in router_client.calls
    assert "terminal_info" in adapter_client.calls
    assert isinstance(router_outcome, BaseException)
    assert isinstance(adapter_outcome, BaseException)

    # ⭐ CLASS ONLY — asserted on the two-path log, so a leak on EITHER path reds.
    assert caplog.text.count("error_class=OSError") == 2, caplog.text
    assert secret not in caplog.text, (
        "the raw transport exception MESSAGE reached the log — mt5linux "
        "interpolates the password into remotely-eval'd source, so this is a "
        "credential disclosure (T-134-01)"
    )
    assert "Broker-Demo" not in caplog.text


def test_mt5_gateway_misconfigured_operator_fault_on_both_paths(
    exchange_module, monkeypatch
):
    """⭐ A3 — the operator fault is refused as OPERATOR, NOT-RETRYABLE, on both
    paths, and neither refusal names a credential.

    Same inputs as the short-circuit case: this is what an "undetermined" verdict
    CAUSED BY our own terminal must produce. The two transports differ by design —
    the router owns an HTTP contract and the adapter raises for the worker's
    classify sink — so the parity claim is about the MEANING, asserted three ways:
    not retryable, no credential vocabulary, and never a verdict against the user's
    key or their broker server.
    """
    from services.job_worker import classify_exception
    from services.mt5_probe import Mt5GatewayMisconfigured

    def make_client():
        return _FakeProbeClient(
            account_info=_INVESTOR_ACCOUNT,
            terminal_info=_TERMINAL_TRADE_PERMISSION_OFF,
        )

    router_outcome, _router_client, adapter_outcome, _adapter_client = (
        _drive_both_paths(exchange_module, monkeypatch, make_client)
    )

    # ROUTER: the 500 operator arm — deliberately NOT retryable (R-1).
    assert isinstance(router_outcome, HTTPException)
    assert router_outcome.status_code == 500
    assert router_outcome.detail["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert router_outcome.detail["retryable"] is False
    assert "needs an operator, not a retry" in router_outcome.detail["detail"]

    # ADAPTER: the dedicated type, which the worker's sink classifies PERMANENT —
    # so the fault can no longer serialize retries against the ONE shared terminal
    # ahead of every other user's validate.
    assert isinstance(adapter_outcome, Mt5GatewayMisconfigured)
    kind, message = classify_exception(adapter_outcome)
    assert kind == "permanent"
    # ⭐ RE-POINTED at 161-02, deliberately. This fixture IS the founder-measured
    # live case (connected, trade permission off, the named option NOT reported),
    # so the honest sentence is the algorithmic-trading one — the generic constant
    # this line used to expect is the very sentence WIZERR-01 measured false here.
    # Hand-typed above from 161-UI-SPEC, never imported from the module under test.
    assert message == _EXPECTED_TRADE_PERMISSION_OFF

    # ⭐ THE PARITY CLAIM, widened at 161-02: both paths name the SAME cause,
    # because both derive it from ONE builder over the SAME terminal dict. A
    # second copy of the flag->cause rule on either side would show up HERE.
    assert router_outcome.detail["detail"] == message

    # ⭐ And both say "an operator must act", neither says "retry",
    # and neither blames the user.
    assert router_outcome.detail["retryable"] is False and kind == "permanent"
    for rendered in (router_outcome.detail["detail"], message):
        low = rendered.lower()
        for word in ("password", "investor", "master", "secret"):
            assert word not in low, f"refusal copy names the credential word {word!r}"
        assert MT5_WRONG_SERVER_DETAIL not in rendered
        assert AUTH_FAILED_DETAIL not in rendered
