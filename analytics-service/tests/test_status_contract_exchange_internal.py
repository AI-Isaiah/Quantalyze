"""PYAPI-05 — the status-attributability contract at S-01..S-12.

The contract itself lives at ``analytics-service/docs/STATUS_CONTRACT.md``; its
executable half is ``services/error_contract.py``. This suite pins the twelve
sites plan 140.1-03 owns: ``routers/exchange.py`` S-01..S-07 and
``routers/internal.py`` S-08..S-12.

Why each case matters (Rule 9 — these encode ECONOMICS, not the implementation's
own formula):

  - A **permanent** misconfiguration (unset MT5 gateway env, malformed egress
    proxy URL, missing KEK) answering ``503`` is the self-sustaining-outage
    shape: the breaker trips, expires, re-probes, trips again, forever, and no
    retry can ever clear it because only an operator can (A-08/A-25/C-17). The
    contract's R-1 says such a fault is ``500`` with ``retryable:false``. These
    tests fail if anyone re-marks one of them transient.
  - A fault in the **caller's exchange** answering ``5xx`` makes C-12 true: one
    dashboard render with five keys during a Binance maintenance window is five
    5xx responses, hence a platform-wide breaker trip that denies Deribit users,
    the optimizer, admin match and CSV finalize. The contract answers ``424`` —
    a 4xx, therefore breaker-inert by construction, and decidable from the
    status line alone (TRAP-2: the body may be absent).
  - A **NULL column on the caller's own row** (S-10) answering ``502`` is not a
    service fault under any reading; it is the clearest mis-attribution in the
    file, and it answers ``422``.
  - The S-06 generic arm must not blame the user's credentials for OUR
    unclassified bug (C-16) — an accusation the user cannot act on.

ORACLE DISCIPLINE (programme non-negotiable #3): every expected status int and
every expected code string below is a **literal typed into this file**. Nothing
is imported from ``services.error_contract`` — an oracle that reads its
expectation back out of the thing under test cannot fail. Ten simultaneous
semantic mutations to the Phase-140 seam core once produced a byte-identical
``8859 passed`` for exactly that reason.
"""
from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

import ccxt
import pytest
from fastapi import HTTPException
from tests.limiter_stub import evict_module, patch_shared_limiter


pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# routers/exchange.py — S-01..S-07
# --------------------------------------------------------------------------- #


@pytest.fixture()
def exchange_router(monkeypatch):
    """``routers.exchange`` with slowapi stubbed (no-op Limiter) so the handlers
    can be awaited directly, and the sFOX/MT5 go-live gates + gateway env pinned
    ON so the tests reach the arm under test rather than a feature gate.

    Cloned from ``tests/test_mt5_validate.py``'s fixture (Rule 11 — match the
    file's existing idiom rather than inventing a second one).
    """

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

    monkeypatch.setenv("SFOX_ENABLED", "true")
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    evict_module("routers.exchange")
    from routers import exchange as exchange_router

    yield exchange_router

    evict_module("routers.exchange")


def _validate_req(router, **overrides):
    from models.schemas import ValidateKeyRequest

    fields = {
        "exchange": "mt5",
        "api_key": "123456",
        "api_secret": "investor-pw",
        "passphrase": "Broker-Demo",
    }
    fields.update(overrides)
    return ValidateKeyRequest(**fields)


async def _call_validate(router, req):
    return await router.validate_key(MagicMock(name="request"), req)


def _envelope(exc: HTTPException) -> dict:
    """The R-2 envelope always lives at ``body.detail`` (STATUS_CONTRACT.md §2)."""
    assert isinstance(exc.detail, dict), (
        f"every deliberate 5xx/424 body must carry the R-2 envelope, got "
        f"{type(exc.detail).__name__}"
    )
    return exc.detail


def _assert_r2_keys(exc: HTTPException) -> None:
    """R-2: code, dependency and retryable are present on EVERY deliberate body."""
    body = _envelope(exc)
    for key in ("code", "dependency", "retryable", "detail"):
        assert key in body, f"R-2 envelope is missing {key!r}: {body!r}"
    assert isinstance(body["detail"], str), "body.detail.detail must be a scalar string"


# --- S-01 -------------------------------------------------------------------


async def test_s01_sfox_client_construction_failure_is_permanent_500(exchange_router):
    """S-01 (exchange.py:108) — a malformed ``WORKER_EGRESS_PROXY_URL`` makes the
    sFOX client constructor raise. That is a SERVER misconfiguration that stays
    broken until an operator edits an env var: no retry can clear it, so a 503
    here flaps the breaker forever. Contract: 500 + retryable:false."""
    router = exchange_router
    router.make_sfox_client = MagicMock(side_effect=ValueError("proxy url malformed"))

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router, exchange="sfox", api_key="tok"))

    assert ei.value.status_code == 500
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "EGRESS_PROXY_MISCONFIGURED"
    assert body["dependency"] == "egress-proxy"
    assert body["retryable"] is False
    # R-1: a permanent fault never advertises a wait.
    assert not (ei.value.headers or {}).get("Retry-After")


# --- S-02 -------------------------------------------------------------------


@pytest.mark.parametrize("missing", ["MT5_GATEWAY_HOST", "MT5_GATEWAY_PORT"])
async def test_s02_mt5_gateway_env_unset_is_permanent_500(
    exchange_router, monkeypatch, missing
):
    """S-02 (exchange.py:215) — an unset MT5_GATEWAY_HOST/PORT is a deployment
    misconfiguration, not a blip. Answering 503 is half of A-01: the breaker
    trips platform-wide on a fault only an operator can clear."""
    router = exchange_router
    monkeypatch.delenv(missing, raising=False)

    factory = MagicMock(side_effect=AssertionError("no client when unconfigured"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router))

    assert ei.value.status_code == 500
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert body["dependency"] == "mt5-gateway"
    assert body["retryable"] is False
    assert not (ei.value.headers or {}).get("Retry-After")
    factory.assert_not_called()


# --- S-03 -------------------------------------------------------------------


async def test_s03_mt5_gateway_port_not_an_int_is_permanent_500(
    exchange_router, monkeypatch
):
    """S-03 (exchange.py:220) — a non-numeric MT5_GATEWAY_PORT is the same
    permanent misconfiguration class as S-02 and must classify identically."""
    router = exchange_router
    monkeypatch.setenv("MT5_GATEWAY_PORT", "eighteen-eight-one-two")

    factory = MagicMock(side_effect=AssertionError("no client when unconfigured"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router))

    assert ei.value.status_code == 500
    body = _envelope(ei.value)
    assert body["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert body["dependency"] == "mt5-gateway"
    assert body["retryable"] is False
    factory.assert_not_called()


# --- S-04 -------------------------------------------------------------------


async def test_s04_mt5_gateway_connect_timeout_is_transient_503(
    exchange_router, monkeypatch
):
    """S-04 (exchange.py:235) — a gateway connect TIMEOUT is genuinely transient
    (the bridge restarts on every deploy), so it stays 503. What it gains is the
    two things 140.2 needs to stop it being a global outage: a named dependency
    to key the breaker on instead of ``breaker:railway`` (A-01), and an honest
    Retry-After so 140.3 can name the real wait (B-11)."""
    router = exchange_router
    router.Mt5Client = MagicMock(return_value=MagicMock())

    async def _timeout_on_first_wait(aw, timeout=None):
        # Close the underlying coroutine so it never runs (no thread, no
        # "coroutine was never awaited" warning), then simulate the ceiling.
        if hasattr(aw, "close"):
            aw.close()
        raise asyncio.TimeoutError

    monkeypatch.setattr(router.asyncio, "wait_for", _timeout_on_first_wait)

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router))

    assert ei.value.status_code == 503
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "MT5_GATEWAY_UNREACHABLE"
    assert body["dependency"] == "mt5-gateway"
    assert body["retryable"] is True
    # Literal, NOT imported from RETRY_AFTER_SECONDS — this pins the wire value.
    assert (ei.value.headers or {}).get("Retry-After") == "30"


# --- S-05 -------------------------------------------------------------------


async def test_s05_mt5_gateway_connect_failure_is_transient_503(exchange_router):
    """S-05 (exchange.py:238) — a gateway connect FAILURE is the same transient
    class as the timeout and must not classify differently just because the
    exception type differs."""
    router = exchange_router
    router.Mt5Client = MagicMock(side_effect=OSError("connection refused"))

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router))

    assert ei.value.status_code == 503
    body = _envelope(ei.value)
    assert body["code"] == "MT5_GATEWAY_UNREACHABLE"
    assert body["dependency"] == "mt5-gateway"
    assert body["retryable"] is True
    assert (ei.value.headers or {}).get("Retry-After") == "30"


# --- S-06 (SPLIT) -----------------------------------------------------------


async def test_s06_ccxt_escape_is_exchange_attributable_424(exchange_router):
    """S-06a (exchange.py:404) — ``services/exchange.py`` already classifies every
    known ccxt error, so a ccxt exception ESCAPING to this bare except is by
    definition unclassified — but it is still attributable to the VENUE. The
    contract answers 424: breaker-inert (4xx), recoverable, and carrying the
    venue name so 140.3 can say "Binance is not responding" rather than blaming
    the user's key. A 5xx here is C-12 verbatim."""
    router = exchange_router
    router.create_exchange = MagicMock(return_value=MagicMock(name="ccxt-exchange"))
    router.validate_key_permissions = AsyncMock(
        side_effect=ccxt.ExchangeNotAvailable("binance GET /api/v3/account 503")
    )
    router.aclose_exchange = AsyncMock()

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router, exchange="binance"))

    assert ei.value.status_code == 424
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "EXCHANGE_PROBE_FAILED"
    assert body["dependency"] == "binance"
    assert body["retryable"] is True
    router.aclose_exchange.assert_awaited_once()


async def test_s06_non_ccxt_escape_is_permanent_500_and_never_blames_credentials(
    exchange_router,
):
    """S-06b (exchange.py:404) — a NON-ccxt escape is our own unclassified bug.
    C-16: the shipped copy said "Please check your credentials", telling the user
    to fix something that is not broken and cannot be fixed by them. The contract
    answers 500 (permanent, non-counting) with copy that does not accuse the
    caller's credentials."""
    router = exchange_router
    router.create_exchange = MagicMock(return_value=MagicMock(name="ccxt-exchange"))
    router.validate_key_permissions = AsyncMock(
        side_effect=RuntimeError("a bug in our own probe code")
    )
    router.aclose_exchange = AsyncMock()

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router, exchange="binance"))

    assert ei.value.status_code == 500
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "INTERNAL"
    assert body["retryable"] is False
    assert "credential" not in body["detail"].lower()
    router.aclose_exchange.assert_awaited_once()


async def test_s06_raw_exception_text_never_reaches_the_response_body(exchange_router):
    """S-06 canary — neither arm may interpolate the raw exception into a
    user-reachable body (TRAP-1's class on a response body, C-13)."""
    router = exchange_router
    router.create_exchange = MagicMock(return_value=MagicMock(name="ccxt-exchange"))
    router.validate_key_permissions = AsyncMock(
        side_effect=RuntimeError("CANARY_ERR_5f21 internal state")
    )
    router.aclose_exchange = AsyncMock()

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router, exchange="binance"))

    assert "CANARY_ERR_5f21" not in repr(ei.value.detail)


# --- S-07 -------------------------------------------------------------------


async def test_s07_encrypt_key_missing_kek_is_permanent_500(exchange_router):
    """S-07 (exchange.py:424) — C-17 verbatim. A missing/rotated KEK is permanent
    until an operator acts, and /api/encrypt-key is the busiest seam endpoint, so
    a permanent 503 here is the self-sustaining-outage shape at its worst."""
    router = exchange_router
    router.get_kek = MagicMock(side_effect=RuntimeError("KEK not configured"))

    req = router.EncryptKeyRequest(
        exchange="binance", api_key="k", api_secret="s", passphrase=None
    )

    with pytest.raises(HTTPException) as ei:
        await router.encrypt_key(MagicMock(name="request"), req)

    assert ei.value.status_code == 500
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == "KEK_UNAVAILABLE"
    assert body["dependency"] == "kek"
    assert body["retryable"] is False
    assert not (ei.value.headers or {}).get("Retry-After")


# --------------------------------------------------------------------------- #
# routers/internal.py — S-08..S-12
#
# Driven through a TestClient (the idiom this router's existing suite uses,
# tests/test_sfox_internal_probe.py) so the assertions are against the WIRE
# response — status line, body and headers — rather than the exception object.
# The wire is what 140.2's discriminator consumes.
# --------------------------------------------------------------------------- #


@pytest.fixture
def internal_client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from routers.internal import router, _reset_kek_alert, _reset_rate_limit

    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    _reset_rate_limit()
    _reset_kek_alert()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _supabase_with_key(exchange: str | None = "binance") -> MagicMock:
    """An api_keys row plus a no-op key_permission_audit insert."""
    fake = MagicMock()

    def _table(name: str):
        tbl = MagicMock()
        if name == "api_keys":
            chain = tbl.select.return_value.eq.return_value.maybe_single.return_value
            chain.execute.return_value = MagicMock(
                data={"id": "key-1", "exchange": exchange, "is_active": True}
            )
        else:
            tbl.insert.return_value.execute.return_value = MagicMock(data=[{"id": 1}])
        return tbl

    fake.table.side_effect = _table
    return fake


def _probe_internal(
    internal_client,
    *,
    key_id: str = "key-1",
    exchange: str | None = "binance",
    get_kek=None,
    decrypt=None,
    create_exchange=None,
    detect_permissions=None,
):
    from unittest.mock import patch

    stack = [
        patch("routers.internal.get_supabase", return_value=_supabase_with_key(exchange)),
        patch("routers.internal.get_kek", get_kek or MagicMock(return_value=b"kek")),
        patch(
            "routers.internal.decrypt_credentials",
            decrypt or MagicMock(return_value=("k", "s", None)),
        ),
        patch(
            "routers.internal.create_exchange",
            create_exchange or MagicMock(return_value=MagicMock(name="ccxt")),
        ),
        patch(
            "routers.internal.detect_permissions",
            detect_permissions
            or AsyncMock(return_value={"read": True, "trade": False, "withdraw": False}),
        ),
        patch("routers.internal.aclose_exchange", AsyncMock()),
    ]
    for ctx in stack:
        ctx.__enter__()
    try:
        return internal_client.post(
            f"/internal/keys/{key_id}/permissions",
            headers={"x-internal-token": "test-token"},
        )
    finally:
        for ctx in reversed(stack):
            ctx.__exit__(None, None, None)


def _wire_envelope(resp) -> dict:
    """STATUS_CONTRACT.md §2 — the R-2 envelope always lives at body.detail."""
    body = resp.json()
    assert isinstance(body.get("detail"), dict), (
        f"every deliberate error body must carry the R-2 envelope at .detail, got {body!r}"
    )
    env = body["detail"]
    for key in ("code", "dependency", "retryable", "detail"):
        assert key in env, f"R-2 envelope is missing {key!r}: {env!r}"
    assert isinstance(env["detail"], str), "body.detail.detail must be a scalar string"
    return env


# --- S-08 -------------------------------------------------------------------


async def test_s08_permissions_missing_kek_is_permanent_500(internal_client):
    """S-08 (internal.py:208) — the same missing/rotated KEK as S-07, on the
    OTHER endpoint the findings doc never listed. Permanent until an operator
    acts, therefore 500 retryable:false, therefore breaker-inert."""
    r = _probe_internal(
        internal_client, get_kek=MagicMock(side_effect=RuntimeError("KEK not configured"))
    )

    assert r.status_code == 500
    env = _wire_envelope(r)
    assert env["code"] == "KEK_UNAVAILABLE"
    assert env["dependency"] == "kek"
    assert env["retryable"] is False
    assert "retry-after" not in {k.lower() for k in r.headers}


async def test_s08_kek_failure_captures_exactly_one_sentry_alert_per_window(
    internal_client, monkeypatch
):
    """PYAPI-06 site 4 — a KEK misconfiguration leaves NO operator signal today
    (verified: internal.py:207-208 logs nothing). It gains one, but bounded: a
    stale KEK fires on EVERY permission probe, and five badges per dashboard
    render would turn the signal into a Sentry flood that gets muted — which is
    indistinguishable from having no signal at all.

    Also pins that neither the tag nor the message carries any substring of a
    secret: an alert that leaks the credential it is complaining about is worse
    than the outage."""
    import routers.internal as internal_mod

    spy = MagicMock()
    monkeypatch.setattr(internal_mod, "sentry_sdk", spy)

    for i in range(4):
        internal_mod._reset_rate_limit()
        r = _probe_internal(
            internal_client,
            key_id=f"key-{i}",
            get_kek=MagicMock(side_effect=RuntimeError("KEK not configured")),
        )
        assert r.status_code == 500

    assert spy.capture_message.call_count == 1, (
        "a KEK outage must produce ONE bounded operator signal, not one per request"
    )
    tag_calls = [c for c in spy.set_tag.call_args_list]
    assert len(tag_calls) == 1
    rendered = repr(spy.set_tag.call_args_list) + repr(spy.capture_message.call_args_list)
    for secret in ("KEK not configured", "test-token", "kek"):
        if secret == "kek":
            continue  # the dependency NAME is not a secret
        assert secret not in rendered, f"{secret!r} must never reach a Sentry tag/message"


# --- S-09 -------------------------------------------------------------------


async def test_s09_undecryptable_key_is_permanent_500(internal_client):
    """S-09 (internal.py:214) — A-02. The status was already right; what was
    missing is the machine code and the explicit retryable:false that stops 140.2
    counting a deterministic fault. A key that cannot be decrypted will never
    decrypt on a retry, so counting it guarantees a self-sustaining outage."""
    r = _probe_internal(
        internal_client, decrypt=MagicMock(side_effect=ValueError("bad ciphertext"))
    )

    assert r.status_code == 500
    env = _wire_envelope(r)
    assert env["code"] == "KEY_UNDECRYPTABLE"
    assert env["dependency"] == "kek"
    assert env["retryable"] is False


# --- S-10 -------------------------------------------------------------------


@pytest.mark.parametrize("exchange", [None, ""])
async def test_s10_key_with_no_exchange_is_caller_422(internal_client, exchange):
    """S-10 (internal.py:218) — the clearest mis-attribution in the file. A NULL
    column on the CALLER'S OWN row answered 502, i.e. "our upstream is broken",
    which is false under any reading and counts against our health. It is caller
    data: 422."""
    r = _probe_internal(internal_client, exchange=exchange)

    assert r.status_code == 422
    env = _wire_envelope(r)
    assert env["code"] == "KEY_MISSING_EXCHANGE"
    assert env["dependency"] is None
    assert env["retryable"] is False


# --- S-11 -------------------------------------------------------------------


async def test_s11_exchange_init_failure_is_venue_attributable_424(internal_client):
    """S-11 (internal.py:326) — C-12. A non-ValueError out of create_exchange is
    the caller's venue refusing us, not our service degrading. 424 keeps it out
    of the breaker entirely and names the venue."""
    r = _probe_internal(
        internal_client,
        create_exchange=MagicMock(side_effect=RuntimeError("binance handshake refused")),
    )

    assert r.status_code == 424
    env = _wire_envelope(r)
    assert env["code"] == "EXCHANGE_INIT_FAILED"
    assert env["dependency"] == "binance"
    assert env["retryable"] is True


# --- S-12 -------------------------------------------------------------------


async def test_s12_permission_probe_failure_is_venue_attributable_424(internal_client):
    """S-12 (internal.py:339) — C-12's headline. Binance maintenance, a key
    revoked at the venue and an IP-allowlist change ALL land here, uncached, five
    badges per dashboard render. As a 502 that is five recorded failures and a
    platform-wide trip that then denies Deribit users, the optimizer, admin match
    and CSV finalize. As a 424 it is zero recorded failures."""
    r = _probe_internal(
        internal_client,
        detect_permissions=AsyncMock(side_effect=RuntimeError("binance 503 maintenance")),
    )

    assert r.status_code == 424
    env = _wire_envelope(r)
    assert env["code"] == "EXCHANGE_PROBE_FAILED"
    assert env["dependency"] == "binance"
    assert env["retryable"] is True


async def test_s12_raw_exception_text_never_reaches_the_response_body(internal_client):
    """S-11/S-12 canary — the venue's raw exception must not be interpolated into
    a user-reachable body (C-13's class on a response body)."""
    r = _probe_internal(
        internal_client,
        detect_permissions=AsyncMock(side_effect=RuntimeError("CANARY_ERR_9a03 stack")),
    )

    assert "CANARY_ERR_9a03" not in r.text
