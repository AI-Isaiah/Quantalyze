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

import sys
import time
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
    Retry-After so 140.3 can name the real wait (B-11).

    RE-CUT for 153.3-03 (D-03): this used to fire the ceiling by timing out the
    FIRST ``wait_for`` call, which was the connect stage. Connect and probe now
    share ONE end-to-end deadline, so the first call is the DEADLINE and the old
    form would have walked into the 424 transient arm — i.e. it would have silently
    started testing a different S-row. It now fires the CONNECT STAGE by name:
    a genuinely slow construction against a hair-width stage ceiling. No ordinal, so
    a future stage cannot re-point it."""
    router = exchange_router
    router.Mt5Client = MagicMock(side_effect=lambda *a, **k: time.sleep(0.3))
    monkeypatch.setattr(router, "_MT5_VALIDATE_STAGE_TIMEOUT_S", 0.05)

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

# The S-06 split is pinned by the ccxt exception FAMILY, never by one member.
#
# WHY (140.1-REVIEW H-4 / survivors #1 and #2): the first version of this fence
# raised exactly ONE subclass — ``ccxt.ExchangeNotAvailable`` — so narrowing the
# arm from ``except ccxt.BaseError`` to ``except ccxt.NetworkError`` (or to
# ``except ccxt.ExchangeNotAvailable`` itself) SURVIVED the mutation twice with a
# fully green suite. Under either narrowing, ``ccxt.PermissionDenied`` and
# ``ccxt.AuthenticationError`` fall through to the generic arm and answer **500**
# — which is A-01/C-12 verbatim, the exact defect this entire programme exists to
# fix, shipped under a green test.
#
# The oracle below is the **ccxt class hierarchy**, not the arm's own except
# clause: the family straddles both ccxt roots (``ExchangeError`` and
# ``NetworkError``), so no single narrowing can satisfy all seven rows.
# ``RuntimeError`` is the non-ccxt control that keeps the *split* visible — a fix
# that widened the 424 arm to ``except Exception`` would satisfy the seven venue
# rows and fail this one.
#
# Every expected status and code below is a LITERAL typed into this file.
_S06_ESCAPES = [
    # (exception class, expected status, expected code)
    (ccxt.RateLimitExceeded, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.PermissionDenied, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.AuthenticationError, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.RequestTimeout, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.ExchangeError, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.ExchangeNotAvailable, 424, "EXCHANGE_PROBE_FAILED"),
    (ccxt.DDoSProtection, 424, "EXCHANGE_PROBE_FAILED"),
    (RuntimeError, 500, "INTERNAL"),
]


@pytest.mark.parametrize(
    "exc_class,expected_status,expected_code",
    _S06_ESCAPES,
    ids=[c.__name__ for c, _, _ in _S06_ESCAPES],
)
async def test_s06_ccxt_family_escape_is_exchange_attributable_424(
    exchange_router, exc_class, expected_status: int, expected_code: str
):
    """S-06a (exchange.py, the ``except ccxt.BaseError`` arm) —
    ``services/exchange.py`` already classifies every known ccxt error, so a ccxt
    exception ESCAPING to this arm is by definition unclassified — but it is
    still attributable to the VENUE. The contract answers 424: breaker-inert
    (4xx), recoverable, and carrying the venue name so 140.3 can say "Binance is
    not responding" rather than blaming the user's key.

    A 5xx on ANY member of the family is C-12 verbatim: five keys on one
    dashboard render during a venue throttle become five 5xx and a platform-wide
    breaker trip that then denies every other venue, the optimizer, admin match
    and CSV finalize. ``RateLimitExceeded`` is the single most likely member to
    fire in production and the one a naive narrowing loses first.
    """
    router = exchange_router
    router.create_exchange = MagicMock(return_value=MagicMock(name="ccxt-exchange"))
    router.validate_key_permissions = AsyncMock(
        side_effect=exc_class("binance GET /api/v3/account failed")
    )
    router.aclose_exchange = AsyncMock()

    with pytest.raises(HTTPException) as ei:
        await _call_validate(router, _validate_req(router, exchange="binance"))

    assert ei.value.status_code == expected_status, (
        f"{exc_class.__name__} must answer {expected_status}, got "
        f"{ei.value.status_code} — a ccxt escape answering 5xx is C-12, and a "
        f"non-ccxt escape answering 4xx hides OUR bug"
    )
    _assert_r2_keys(ei.value)
    body = _envelope(ei.value)
    assert body["code"] == expected_code
    if expected_status == 424:
        assert body["dependency"] == "binance"
        assert body["retryable"] is True
    else:
        # The non-ccxt control: OUR unclassified bug names no venue and is
        # permanent, so it counts as a real 5xx and never as a breaker input.
        assert body["dependency"] is None
        assert body["retryable"] is False
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


class _FakeClock:
    """A monotonic clock the test drives, substituted for ``routers.internal``'s
    ``time`` module. ``internal.py`` uses ``time.monotonic`` and nothing else
    (its two ``datetime.now`` sites import ``datetime`` separately), so this is
    a complete stand-in for that module's whole time surface."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


async def test_s08_kek_alert_is_one_per_window_and_fires_again_after_it_expires(
    internal_client, monkeypatch
):
    """PYAPI-06 site 4 — a KEK misconfiguration leaves NO operator signal today
    (verified: internal.py's KEK arm logged nothing). It gains one, but bounded:
    a stale KEK fires on EVERY permission probe, and five badges per dashboard
    render would turn the signal into a Sentry flood that gets muted — which is
    indistinguishable from having no signal at all.

    SURVIVOR #7 (140.1-REVIEW): the previous form fired four times against a
    free-running clock and asserted ``call_count == 1``. That assertion is
    satisfied by ANY window at least as long as the test's own runtime, so
    widening ``_KEK_ALERT_WINDOW_S`` from 300 to 1e18 — a window that never
    expires, i.e. exactly ONE Sentry alert per process lifetime for a fault that
    persists until an operator acts — shipped green. Suppression is only half the
    contract; the other half is that the signal RETURNS, and an unexpired-window
    test cannot see it.

    So the clock is driven, in three phases, and the window is a LITERAL 300
    seconds typed here — never imported from ``routers.internal``:

      1. the first fault opens the window and captures once;
      2. a second fault 299 s later is INSIDE the window and captures nothing more;
      3. a third fault at 301 s is PAST it and captures again.

    Phase 3 is the one that has teeth against a widened window.

    Also pins that neither the tag nor the message carries any substring of a
    secret: an alert that leaks the credential it is complaining about is worse
    than the outage.
    """
    import routers.internal as internal_mod

    spy = MagicMock()
    monkeypatch.setattr(internal_mod, "sentry_sdk", spy)
    clock = _FakeClock()
    monkeypatch.setattr(internal_mod, "time", clock)
    internal_mod._reset_kek_alert()

    def _fire(i: int) -> None:
        internal_mod._reset_rate_limit()
        r = _probe_internal(
            internal_client,
            key_id=f"key-{i}",
            get_kek=MagicMock(side_effect=RuntimeError("KEK not configured")),
        )
        assert r.status_code == 500

    # Phase 1 — the first fault opens the window.
    _fire(0)
    assert spy.capture_message.call_count == 1, (
        "the first KEK fault must reach the operator"
    )

    # Phase 2 — 299 s later, still INSIDE the 300 s window: no second flood.
    clock.advance(299.0)
    _fire(1)
    assert spy.capture_message.call_count == 1, (
        "a KEK outage must produce ONE bounded operator signal per window, not "
        "one per request — five badges per dashboard render would mute it"
    )

    # Phase 3 — 301 s in total, PAST the 300 s window: the signal comes back.
    # A window that never expires is indistinguishable from no signal at all
    # once the first alert has been triaged and closed.
    clock.advance(2.0)
    _fire(2)
    assert spy.capture_message.call_count == 2, (
        "the operator signal must RETURN once the 300 s window expires — a "
        "suppression window that never lets go silences a fault that only an "
        "operator can clear"
    )

    assert len(spy.set_tag.call_args_list) == 2, (
        "every capture is tagged, so tags and captures move together"
    )
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


async def test_s11_exchange_init_failure_is_permanent_500_and_names_no_venue(
    internal_client,
):
    """S-11 (internal.py:414-433) — PYAPIFIX-03 / H-2, the 424 REVERSED.

    ``services/exchange.py`` ``create_exchange`` is ``EXCHANGE_CLASSES.get()``, a
    dict build, ``cls(config)`` and two attribute sets: **zero network I/O**. So a
    non-``ValueError`` escape is a ``TypeError`` / ``AttributeError`` /
    ``ImportError`` / OOM in OUR adapter construction — it cannot be the venue
    refusing us, because at that point we have not spoken to the venue at all.

    The shipped 424 was wrong in the direction that HIDES the fault: a 424 is
    breaker-inert *and* a 4xx, so an outright bug in our own code counted nowhere
    and paged nobody, while the body told the user their exchange was down. R-1's
    SERVICE-PERMANENT class answers **500 retryable:false** — which counts as a
    real 5xx in the platform's own health signal, and never as a breaker input.

    The WHOLE body is pinned as a dict literal (the
    ``tests/test_verify_service_key_middleware.py`` idiom): a key-by-key
    assertion would let a re-added ``dependency`` or a stray extra field survive
    unnoticed, and this arm's entire defect was an extra field.
    """
    r = _probe_internal(
        internal_client,
        create_exchange=MagicMock(side_effect=RuntimeError("binance handshake refused")),
    )

    assert r.status_code == 500
    assert r.json() == {
        "detail": {
            "code": "ADAPTER_INIT_FAILED",
            "dependency": None,
            "retryable": False,
            "detail": (
                "Something went wrong on our side while opening this connection. "
                "Nothing is wrong with your key."
            ),
        }
    }
    # R-1: a permanent fault never advertises a wait. Nothing can clear it but a
    # deploy, so a Retry-After here invites the retry loop R-1 exists to stop.
    assert "Retry-After" not in r.headers

    env = _wire_envelope(r)
    # 140.2 keys its breaker on `dependency` (SEAMCORE-01), so "binance" on a 500
    # would mint a per-dependency breaker key for something that is not ours —
    # the A-01 defect class in a new disguise. Plan 140.1.1-01's C3 membership
    # guard now raises at CONSTRUCTION if anyone re-adds it; this is the wire-side
    # half of the same fence, and it is the assertion that fails if the guard is
    # ever loosened.
    assert env["dependency"] is None
    assert "binance" not in r.text, (
        "a SERVICE-PERMANENT body must name no venue — the venue is not at fault "
        "and naming it re-teaches the caller the wrong remedy"
    )


async def test_s11_unsupported_exchange_name_stays_a_caller_400(internal_client):
    """The other half of the split, and the reason this is not a blanket remap.

    ``create_exchange`` raises ``ValueError`` for an exchange name that is not in
    ``EXCHANGE_CLASSES``. That IS caller input (the name comes off the caller's
    own ``api_keys`` row), so it stays a 400 CALLER fault. Pinned here so the
    PYAPIFIX-03 remap cannot later be widened into "every escape is a 500",
    which would blame us for a name we never supported.
    """
    r = _probe_internal(
        internal_client,
        create_exchange=MagicMock(side_effect=ValueError("Unsupported exchange: nasdaq")),
    )

    assert r.status_code == 400
    assert r.json() == {"detail": "Unsupported exchange: nasdaq"}


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


# --- PYAPIFIX2-03: the per-key throttle answers the service's own envelope ---

# ORACLE DISCIPLINE (see the module docstring): every number and string below is
# typed HERE and never imported from ``routers.internal``. ``10`` is the bucket
# size that DRIVES the fixture into the throttled state; ``"60"`` is the window
# the wire must advertise; the sentence is the human copy the caller reads. An
# oracle that read any of the three back out of ``routers.internal`` would ship
# green through a reworded body, a widened window and a raised cap alike.
_INTERNAL_BUCKET_CALLS = 10
_EXPECTED_INTERNAL_RETRY_AFTER = "60"
_EXPECTED_INTERNAL_THROTTLE_DETAIL = (
    "Too many permission probes for this key. Try again in a moment."
)


async def test_internal_throttle_429_carries_the_service_envelope(internal_client):
    """PYAPIFIX2-03 — the ``/internal`` 429 emits the contract's own envelope.

    Before this, the site raised a bare ``HTTPException(429, detail="<string>")``
    one line away from an ``error_contract`` arm that would validate it cleanly,
    and that arm had **zero call sites**: it was unadopted, not unreachable. A
    throttle with no machine ``code`` is indistinguishable, to a discriminator
    keying on ``body.detail.code``, from any other 4xx — so the one 4xx an
    identical retry DOES clear reads as one an identical retry cannot, and the
    caller is told to give up on a condition that expires in a minute.

    The assertions are on the WIRE (status line, body, headers), because the
    wire is what 140.2's discriminator and the Next.js proxy consume.

    ⚠️ A THIRD 429 body shape now coexists in this service (flat ``main.py``
    handler · this nested envelope · the bare scalars still at
    match/simulator/portfolio). That is deliberate and recorded — TS-23's owner
    (140.2 / 146) picks the winner when it migrates the remaining two. This test
    pins THIS site's shape so the choice is made explicitly, not by drift.
    """
    for i in range(_INTERNAL_BUCKET_CALLS):
        ok = _probe_internal(internal_client)
        assert ok.status_code == 200, (
            f"call {i + 1} of {_INTERNAL_BUCKET_CALLS} must be admitted before the "
            f"bucket is spent; got {ok.status_code}"
        )

    r = _probe_internal(internal_client)

    assert r.status_code == 429
    env = _wire_envelope(r)
    assert env["code"] == "RATE_LIMITED", (
        "the throttle must carry the SAME machine code the app-global limiter "
        "handler already emits — reused vocabulary, not a re-minted synonym"
    )
    assert env["retryable"] is True, (
        "a 429 is the one CALLER fault an identical retry clears after the "
        "advertised wait; retryable:false beside a Retry-After is the "
        "self-contradicting body R-1 forbids"
    )
    assert env["dependency"] is None, (
        "a 429 is a CALLER fault — naming a dependency here would mint a "
        "breaker key for a throttle we imposed ourselves (the A-01 class)"
    )
    assert isinstance(env["detail"], str), "body.detail.detail stays a scalar human string"
    assert env["detail"] == _EXPECTED_INTERNAL_THROTTLE_DETAIL, (
        "the human copy is byte-identical to what shipped before the migration; "
        "this edit changes the envelope, not what the user is told"
    )
    assert r.headers["Retry-After"] == _EXPECTED_INTERNAL_RETRY_AFTER, (
        "the wait is the limiter's own window, advertised on the wire — the "
        "builder sets this header itself, so the raise site no longer does"
    )


async def test_internal_throttle_is_never_consumed_before_the_token_check(
    internal_client,
):
    """T-140.1.2-04 — the throttle sits AFTER ``_verify_internal_token`` (ASVS V2).

    Ordering is the whole point, and it is not observable from the 403 alone: a
    single unauthenticated call answers 403 under EITHER ordering. What
    distinguishes them is whether the anonymous call SPENT bucket capacity. So
    the bucket is emptied by unauthenticated callers first — if the throttle ran
    first, call 11 would answer 429 (leaking the existence and cadence of the
    key's probe traffic to an unauthenticated caller) and the legitimate caller
    that follows would be locked out by traffic it never sent.

    Under the correct ordering every anonymous call is refused at the token gate
    and the bucket is untouched, so the authenticated call that follows is
    admitted.
    """
    for _ in range(_INTERNAL_BUCKET_CALLS + 1):
        anon = internal_client.post(
            "/internal/keys/key-1/permissions",
            headers={"x-internal-token": "wrong-token"},
        )
        assert anon.status_code == 403, (
            "an unauthenticated caller is refused at the token gate, never at "
            f"the throttle; got {anon.status_code}"
        )

    admitted = _probe_internal(internal_client)
    assert admitted.status_code == 200, (
        "unauthenticated traffic must not spend the per-key bucket — a 429 here "
        "would mean the throttle runs before the authn boundary"
    )
