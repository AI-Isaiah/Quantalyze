"""SFOX-03 — the non-ccxt `is_sfox` branch in the worker `validate_key` path.

sFOX is NOT a ccxt exchange, so `routers/exchange.py::validate_key` must NOT
route it through `create_exchange`/`EXCHANGE_CLASSES` (ccxt-typed — sfox
ValueErrors there). Instead the branch proves auth + read access through the
Phase-118 `SfoxClient.get_balances()` and returns an HONEST shape:
`read_only=True` asserted STRUCTURALLY (the adapter has no order/withdraw
surface — 118 WR-03; sFOX exposes no per-key scope endpoint, so this is NOT a
probed {read,trade,withdraw} scope claim — A1, no invented data).

Regression gates — WHY each case matters (Rule 9):
  - auth+read proof: `get_balances()` is the single live proof the Bearer token
    authenticates AND can read. If the branch stopped awaiting it, a bad key
    would false-verify. The test asserts it is awaited on the success path.
  - AUTH-string byte-identity: a 401/403 must map to the EXACT ccxt AUTH_FAILED
    string so the cross-language TS `classifyKeyValidationError` returns
    `KEY_AUTH_FAILED` with ZERO TS edits. A reworded detail silently breaks
    that classification — the test pins the literal.
  - fail-CLOSED + HONEST on non-auth failure (F4): a transport/shape blip
    (status==0) or 5xx maps to the shared ccxt NETWORK_ERROR_DETAIL and a 429 to
    the shared RATE_LIMITED_DETAIL — a 400 that fails CLOSED (never {"valid":
    true}) and never blames the user's credentials (no "authentication failed" /
    "check your credentials"). Only a genuine 401/403 is an auth failure.
  - aclose on EVERY path: the adapter owns an aiohttp session; a missed aclose
    on any branch leaks a session (Sentry "Unclosed client session"). Asserted
    on success + every failure.
  - ccxt path untouched: the branch is additive and sits BEFORE create_exchange
    only for exchange=='sfox'. A binance request must still flow through
    create_exchange → validate_key_permissions — pinned so branch placement
    can't perturb the ccxt flow.
  - empty-secret acceptance (Q1 worker contract): sFOX auth is a single Bearer
    token; the branch takes only api_key and ignores api_secret, so an empty
    secret is accepted.
"""
from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# The EXACT string the TS classifyKeyValidationError matches on
# (lower.includes("authentication failed")) — byte-identical to
# services/exchange.py's ccxt AUTH_FAILED arm. Pinned here so a reword on
# either side is caught.
EXPECTED_AUTH_DETAIL = "Authentication failed. Check your API key and secret."


@pytest.fixture()
def exchange_router(monkeypatch):
    """Import routers.exchange with slowapi stubbed so the module-level Limiter()
    and @limiter.limit decorator are no-op passthroughs (the handler coroutine
    keeps its plain (request, req) signature)."""

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

    sys.modules.pop("routers.exchange", None)
    from routers import exchange as exchange_router

    yield exchange_router

    sys.modules.pop("routers.exchange", None)


def _make_client(get_balances_side_effect=None):
    """A mock SfoxClient instance: async get_balances + async aclose."""
    client = MagicMock(name="SfoxClient-instance")
    client.get_balances = AsyncMock(side_effect=get_balances_side_effect)
    client.aclose = AsyncMock()
    return client


def _install_sfox_client(router, client):
    """Patch the router's make_sfox_client factory to return `client`; return a spy
    on the factory so the test can assert construction args. (121-02: the router
    now constructs via the make_sfox_client egress-proxy factory, not SfoxClient
    directly — the behavioral contract is unchanged, the injection seam moved.)"""
    factory = MagicMock(return_value=client)
    router.make_sfox_client = factory
    return factory


def _make_req(router, exchange="sfox", api_key="tok_abc", api_secret="", passphrase=None):
    from models.schemas import ValidateKeyRequest

    return ValidateKeyRequest(
        exchange=exchange,
        api_key=api_key,
        api_secret=api_secret,
        passphrase=passphrase,
    )


async def _call(router, req):
    return await router.validate_key(MagicMock(name="request"), req)


# --------------------------------------------------------------------------- #
# Success path
# --------------------------------------------------------------------------- #


async def test_sfox_success_returns_valid_readonly_and_never_ccxt(exchange_router):
    """sfox + get_balances() success -> {valid:true, read_only:true}; the ccxt
    create_exchange is NEVER called for sfox."""
    router = exchange_router
    client = _make_client(get_balances_side_effect=None)
    client.get_balances.return_value = []  # empty balance list is still a valid auth+read
    _install_sfox_client(router, client)

    create_exchange_spy = MagicMock(side_effect=AssertionError("create_exchange must not be called for sfox"))
    router.create_exchange = create_exchange_spy

    result = await _call(router, _make_req(router, api_key="tok_abc"))

    assert result == {"valid": True, "read_only": True}
    client.get_balances.assert_awaited_once()
    client.aclose.assert_awaited_once()
    create_exchange_spy.assert_not_called()


async def test_sfox_constructed_with_bearer_token_and_prod_base_url(exchange_router):
    """The branch constructs SfoxClient with the token as api_key and the prod
    base URL (no proxy — phase 121)."""
    router = exchange_router
    client = _make_client()
    client.get_balances.return_value = []
    factory = _install_sfox_client(router, client)

    await _call(router, _make_req(router, api_key="tok_xyz"))

    factory.assert_called_once()
    args, kwargs = factory.call_args
    # 121-02: the router calls make_sfox_client(api_key, base_url=SFOX_PROD_BASE_URL)
    # — api_key is positional at the site now, base_url stays a kwarg.
    assert args[0] == "tok_xyz"
    assert kwargs.get("base_url") == router.SFOX_PROD_BASE_URL


async def test_sfox_empty_secret_accepted(exchange_router):
    """Q1 worker contract: sFOX has a single Bearer token; an empty api_secret
    is accepted (the branch takes only api_key)."""
    router = exchange_router
    client = _make_client()
    client.get_balances.return_value = []
    _install_sfox_client(router, client)

    result = await _call(router, _make_req(router, api_key="tok_abc", api_secret=""))

    assert result == {"valid": True, "read_only": True}
    client.aclose.assert_awaited_once()


# --------------------------------------------------------------------------- #
# Auth failure -> exact AUTH_FAILED string (401 / 403)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("status", [401, 403])
async def test_sfox_auth_failure_maps_to_exact_auth_string(exchange_router, status):
    """401/403 -> HTTPException 400 with the byte-identical AUTH_FAILED string."""
    from services.sfox_client import SfoxApiError

    router = exchange_router
    client = _make_client(get_balances_side_effect=SfoxApiError(status, "denied"))
    _install_sfox_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(router))

    assert ei.value.status_code == 400
    assert ei.value.detail == EXPECTED_AUTH_DETAIL
    client.aclose.assert_awaited_once()


# --------------------------------------------------------------------------- #
# Non-auth failure -> fail CLOSED, never valid, never mislabelled auth
# --------------------------------------------------------------------------- #


async def test_sfox_rate_limit_maps_to_rate_limited_detail_not_credentials(exchange_router):
    """F4: a sFOX 429 is an UPSTREAM throttle, not bad credentials. It must fail
    CLOSED with the SHARED ccxt RATE_LIMITED_DETAIL (→ KEY_RATE_LIMIT), NEVER the
    old 500 "check your credentials" (which the 110.1 fix already killed for
    ccxt). WHY (Rule 9): mislabelling a throttle as a bad key tells the founder to
    regenerate a credential that is perfectly fine."""
    from services.exchange import RATE_LIMITED_DETAIL
    from services.sfox_client import SfoxApiError

    router = exchange_router
    client = _make_client(get_balances_side_effect=SfoxApiError(429, "slow down"))
    _install_sfox_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(router))

    assert ei.value.status_code == 400
    assert ei.value.detail == RATE_LIMITED_DETAIL
    # honesty anti-assertions: never a 500, never "check your credentials".
    assert ei.value.status_code != 500
    assert "authentication failed" not in ei.value.detail.lower()
    assert "check your credentials" not in ei.value.detail.lower()
    # classifier contract: the shared detail routes to KEY_RATE_LIMIT via "rate".
    assert "rate" in RATE_LIMITED_DETAIL.lower()
    client.aclose.assert_awaited_once()


@pytest.mark.parametrize("status", [0, 500, 502, 503])
async def test_sfox_transient_upstream_maps_to_network_detail_not_credentials(
    exchange_router, status
):
    """F4: a sFOX 5xx (exchange down) or status==0 (transport/shape blip) is an
    UPSTREAM failure, not a bad key. It must fail CLOSED with the SHARED ccxt
    NETWORK_ERROR_DETAIL, mapped identically to the ccxt NetworkError arm, NEVER
    the old 500 "check your credentials"."""
    from services.exchange import NETWORK_ERROR_DETAIL
    from services.sfox_client import SfoxApiError

    router = exchange_router
    client = _make_client(get_balances_side_effect=SfoxApiError(status, "boom"))
    _install_sfox_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(router))

    assert ei.value.status_code == 400
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    # honesty anti-assertions: never a 500, never blame the credentials.
    assert ei.value.status_code != 500
    assert "authentication failed" not in ei.value.detail.lower()
    assert "check your credentials" not in ei.value.detail.lower()
    client.aclose.assert_awaited_once()


def test_sfox_transient_details_are_the_shared_ccxt_constants():
    """F4 no-drift guard: the sfox branch must reuse the SAME hoisted constants
    the ccxt arms emit (single source of truth, like AUTH_FAILED_DETAIL), so a
    reword updates BOTH paths at once and the TS classifier maps them identically.
    Pins that both constants are non-empty and rate-limit copy carries the "rate"
    keyword classifyKeyValidationError matches on."""
    from services.exchange import NETWORK_ERROR_DETAIL, RATE_LIMITED_DETAIL

    assert RATE_LIMITED_DETAIL and NETWORK_ERROR_DETAIL
    assert "rate" in RATE_LIMITED_DETAIL.lower()


@pytest.mark.parametrize("token", ["", "   ", "\t\n"])
async def test_sfox_empty_or_blank_token_fails_closed_not_500(exchange_router, token):
    """IN-01 regression: an empty/whitespace-only Bearer token must fail CLOSED
    with the honest AUTH_FAILED mapping (400 → KEY_AUTH_FAILED), NOT leak
    SfoxClient.__init__'s ValueError as an unhandled 500.

    WHY (Rule 9): an 8-space token passes the TS `length < 8` gate and is trimmed
    to "" at analytics-client's trimCredential, arriving here empty. Pre-fix the
    client was constructed BEFORE the try/finally, so the ctor's non-empty-key
    ValueError escaped the fail-closed mapping and surfaced as an opaque 500
    (degraded UX + Sentry noise, and the docstring's fail-closed claim silently
    did not cover this path). The guard now short-circuits BEFORE construction —
    so the client is NEVER built (nothing to leak) and the user sees the same
    KEY_AUTH_FAILED a bad ccxt key produces. Must never be a 500, never valid:true.
    """
    router = exchange_router
    client = _make_client()
    client.get_balances.return_value = []
    factory = _install_sfox_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(router, api_key=token))

    assert ei.value.status_code == 400
    # byte-identical AUTH_FAILED string → KEY_AUTH_FAILED, not an opaque 500
    assert ei.value.detail == EXPECTED_AUTH_DETAIL
    assert "authentication failed" in ei.value.detail.lower()
    # Guarded BEFORE construction: no client, no session, no get_balances call.
    factory.assert_not_called()
    client.get_balances.assert_not_awaited()


async def test_sfox_control_char_token_fails_closed_not_500_and_never_logs_token(exchange_router):
    """F5 regression: a token with an embedded control char (\\n / \\r) survives
    trimCredential (which strips only leading/trailing whitespace) and makes
    aiohttp raise a bare ValueError at request time — neither SfoxApiError nor
    aiohttp.ClientError. Pre-fix it escaped `_validate_sfox_key` as an unhandled
    FastAPI 500 (same wart class as IN-01).

    WHY (Rule 9): a malformed token IS a credential problem — it must fail CLOSED
    with the honest KEY_AUTH_FAILED (400), never an opaque 500, and the raw token
    must never reach the response body OR any log line (aiohttp's ValueError
    message can embed the offending header value).
    """
    router = exchange_router

    # A realistic aiohttp control-char ValueError whose message embeds the token,
    # so the test can prove neither the detail nor any log line leaks it.
    token = "tok_abc\ndef"  # embedded newline — passes the non-empty guard
    leaky_message = f"Invalid header value {token!r}"
    client = _make_client(get_balances_side_effect=ValueError(leaky_message))
    _install_sfox_client(router, client)

    with patch.object(router, "logger") as mock_logger:
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req(router, api_key=token))

    # Fail CLOSED, honest, never a 500.
    assert ei.value.status_code == 400
    assert ei.value.detail == EXPECTED_AUTH_DETAIL
    assert ei.value.status_code != 500
    # The raw token must NOT appear in the client-facing detail.
    assert token not in ei.value.detail
    assert "def" not in ei.value.detail
    # The session is still closed (finally runs) even on this new arm.
    client.aclose.assert_awaited_once()
    # The token must NOT be written to ANY log line (no logging at all on this
    # branch — the aiohttp message that embeds it is never passed to the logger).
    for meth in ("exception", "error", "warning", "info", "debug"):
        for call in getattr(mock_logger, meth).call_args_list:
            assert token not in repr(call)


async def test_sfox_aclose_awaited_even_when_get_balances_raises(exchange_router):
    """aclose() runs on the failure path (finally), not only on success."""
    from services.sfox_client import SfoxApiError

    router = exchange_router
    client = _make_client(get_balances_side_effect=SfoxApiError(401, "nope"))
    _install_sfox_client(router, client)

    with pytest.raises(HTTPException):
        await _call(router, _make_req(router))

    client.aclose.assert_awaited_once()


# --------------------------------------------------------------------------- #
# ccxt regression — branch placement does not perturb the ccxt flow
# --------------------------------------------------------------------------- #


async def test_ccxt_exchange_still_uses_create_exchange_path(exchange_router):
    """binance still flows through create_exchange -> validate_key_permissions;
    SfoxClient is NOT constructed for a ccxt exchange."""
    router = exchange_router

    fake_exchange = MagicMock(name="ccxt-exchange")
    create_exchange_spy = MagicMock(return_value=fake_exchange)
    router.create_exchange = create_exchange_spy
    router.validate_key_permissions = AsyncMock(
        return_value={"valid": True, "read_only": True, "error": None}
    )
    router.aclose_exchange = AsyncMock()

    sfox_factory = MagicMock(side_effect=AssertionError("SfoxClient must not be built for ccxt"))
    router.make_sfox_client = sfox_factory

    result = await _call(
        router, _make_req(router, exchange="binance", api_key="k", api_secret="s")
    )

    assert result == {"valid": True, "read_only": True}
    create_exchange_spy.assert_called_once()
    assert create_exchange_spy.call_args.args[0] == "binance"
    sfox_factory.assert_not_called()


# --------------------------------------------------------------------------- #
# Composed-state regression (Task 2): encrypt path + AUTH-string cross-language
# --------------------------------------------------------------------------- #


def test_encrypt_credentials_roundtrips_empty_secret():
    """Q1 storage shape: a sFOX Bearer token is stored as api_key with an EMPTY
    api_secret. encrypt_credentials must JSON-serialize + round-trip that empty
    secret (it is exchange-agnostic — no sfox branch in encrypt_key), so the
    worker validate/encrypt path needs no sfox encryption carve-out."""
    from cryptography.fernet import Fernet

    from services.encryption import decrypt_credentials, encrypt_credentials

    kek = Fernet.generate_key()
    encrypted = encrypt_credentials("tok_bearer_only", "", None, kek)

    # Build the stored-row shape decrypt_credentials consumes.
    row = dict(encrypted)
    row["id"] = "k-sfox-1"

    api_key, api_secret, passphrase = decrypt_credentials(row, kek)
    assert api_key == "tok_bearer_only"
    assert api_secret == ""
    assert passphrase is None


def test_auth_failed_constant_matches_ts_classifier_literal():
    """Cross-language guard: the hoisted AUTH_FAILED_DETAIL constant (the single
    source both the ccxt arm and the sfox branch emit) must stay byte-identical
    to the literal the TS classifyKeyValidationError matches on
    (lower.includes("authentication failed")). A reword here silently breaks
    KEY_AUTH_FAILED classification for sFOX AND ccxt — this pins it."""
    from services.exchange import AUTH_FAILED_DETAIL

    assert AUTH_FAILED_DETAIL == EXPECTED_AUTH_DETAIL
    assert "authentication failed" in AUTH_FAILED_DETAIL.lower()
