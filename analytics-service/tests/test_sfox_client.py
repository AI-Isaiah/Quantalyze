"""Pure-unit contract tests for services.sfox_client.SfoxClient (SFOX-01).

These run in CI with ZERO network and ZERO credentials: every test patches the
aiohttp session request seam (`aiohttp.ClientSession.request`) with an
`AsyncMock` and asserts on the REAL wiring — the exact bytes SfoxClient would
put on the wire — never a helper re-asserting its own formula (P115 lesson).

Regression gates — WHY each case matters (Rule 9):
  - auth-header shape: sFOX is a Bearer-token API. If the client stops emitting
    `Authorization: Bearer <key>` (or emits HMAC signing machinery it does not
    need), every authed read 401s in prod. The header is asserted on the
    mocked request call kwargs, so the test fails the moment the wiring is
    neutered — not just when a header-builder helper changes.
  - base-URL switch: prod vs sandbox is selected by the ctor `base_url`. Phase
    118's SC-3 smoke test hits `api.staging.sfox.com`; if the override is not
    honored in the built URL the "green sandbox smoke" would silently probe
    prod. The test pins the literal URL for both hosts.
  - explicit-proxy seam (T-121 carry-forward / RESEARCH Pitfall 2): aiohttp
    SILENTLY ignores HTTPS_PROXY unless `proxy=` is passed per request. Phase
    121 static-IP egress depends on this. The test asserts `proxy=` lands on
    the request call verbatim (and defaults to None) so a regression that drops
    the kwarg — which "works locally" — is caught here, not in prod whitelist
    failures.
  - read-only surface (T-118-02): a "read" adapter that grows a create_order /
    withdraw / transfer method is a financial-action footgun. The test asserts
    NO such attribute exists on the class — read-only by construction.
  - fail-loud + secret scrub (T-118-01 / T-118-04): a non-2xx raises a typed
    SfoxApiError carrying the HTTP status (401 must stay distinguishable for
    phase-119 KEY_AUTH_FAILED mapping), and the api_key must NEVER appear in
    str(exc). If the scrub is unwired, a leaked upstream body containing the key
    becomes a real credential disclosure in Sentry.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from services.sfox_client import (
    SFOX_PROD_BASE_URL,
    SFOX_SANDBOX_BASE_URL,
    SfoxApiError,
    SfoxClient,
)

API_KEY = "secretkey123456"


def _stub_response(status: int = 200, body: str = "[]") -> MagicMock:
    """A stand-in aiohttp ClientResponse: `.status` + awaitable `.text()`/`.json()`."""
    resp = MagicMock()
    resp.status = status
    resp.text = AsyncMock(return_value=body)
    resp.json = AsyncMock(return_value=json.loads(body) if body else None)
    resp.release = MagicMock()
    return resp


def _patch_request(response: MagicMock) -> "patch":
    """Patch the aiohttp session request seam so `await session.request(...)` -> response."""
    return patch.object(
        aiohttp.ClientSession, "request", new=AsyncMock(return_value=response)
    )


async def test_get_balances_bearer_auth_and_endpoint():
    """Auth-header shape + endpoint URL: get_balances GETs {base}/v1/user/balance
    carrying exactly `Authorization: Bearer <key>`. Fails if the header wiring or
    the endpoint path drifts."""
    resp = _stub_response(200, json.dumps([{"currency": "USD", "balance": "10"}]))
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        out = await client.get_balances()
        await client.aclose()

    assert out == [{"currency": "USD", "balance": "10"}]
    args, kwargs = mock_req.call_args
    assert args[0] == "GET"
    assert args[1] == f"{SFOX_PROD_BASE_URL}/v1/user/balance"
    assert kwargs["headers"] == {"Authorization": f"Bearer {API_KEY}"}


async def test_default_and_sandbox_base_urls():
    """Base-URL switch: default is prod; explicit sandbox override is honored in
    the built request URL. Guards the SC-3 smoke test hitting staging, not prod."""
    assert SFOX_PROD_BASE_URL == "https://api.sfox.com"
    assert SFOX_SANDBOX_BASE_URL == "https://api.staging.sfox.com"

    resp = _stub_response(200, "[]")
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY, base_url=SFOX_SANDBOX_BASE_URL)
        await client.get_balances()
        await client.aclose()

    args, _ = mock_req.call_args
    assert args[1] == "https://api.staging.sfox.com/v1/user/balance"


async def test_trailing_slash_stripped_from_base_url():
    """A base_url with a trailing slash must not produce a `//v1/...` path."""
    resp = _stub_response(200, "[]")
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY, base_url="https://api.sfox.com/")
        await client.get_balances()
        await client.aclose()
    args, _ = mock_req.call_args
    assert args[1] == "https://api.sfox.com/v1/user/balance"


async def test_proxy_threaded_into_request():
    """Explicit-proxy seam (phase 121): the ctor proxy= must land as the request
    `proxy=` kwarg verbatim. Without it, static-IP egress is silently bypassed."""
    resp = _stub_response(200, "[]")
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY, proxy="http://1.2.3.4:8888")
        await client.get_balances()
        await client.aclose()
    _, kwargs = mock_req.call_args
    assert kwargs["proxy"] == "http://1.2.3.4:8888"


async def test_proxy_defaults_to_none_not_env_pickup():
    """Proxy omitted -> proxy=None passed EXPLICITLY (never trust_env / env pickup).
    aiohttp ignores HTTPS_PROXY without this, so the None must be explicit."""
    resp = _stub_response(200, "[]")
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        await client.get_balances()
        await client.aclose()
    _, kwargs = mock_req.call_args
    assert "proxy" in kwargs
    assert kwargs["proxy"] is None


@pytest.mark.parametrize(
    "forbidden", ["create_order", "place_order", "cancel_order", "withdraw", "transfer"]
)
def test_read_only_surface_no_write_methods(forbidden):
    """Read-only by construction (T-118-02): no order/withdraw/transfer surface
    may exist on the class. A financial-action method appearing here is a footgun."""
    assert not hasattr(SfoxClient, forbidden)


async def test_non_2xx_raises_sfox_api_error_with_status():
    """Fail-loud: a non-2xx raises SfoxApiError carrying the HTTP status. 401 must
    stay distinguishable for phase-119 KEY_AUTH_FAILED mapping."""
    resp = _stub_response(401, "unauthorized")
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError) as excinfo:
            await client.get_balances()
        await client.aclose()
    assert excinfo.value.status == 401


async def test_error_message_scrubs_api_key():
    """T-118-01 info-disclosure: the api_key must NEVER survive into str(exc).
    An upstream body echoing the key is scrubbed via services.redact. If the
    scrub is unwired, this leaks a live credential into logs/Sentry."""
    body = f"upstream rejected api_key={API_KEY} as invalid"
    resp = _stub_response(403, body)
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError) as excinfo:
            await client.get_balances()
        await client.aclose()
    assert API_KEY not in str(excinfo.value)


async def test_non_json_2xx_body_raises():
    """Fail-loud (T-118-04, no invented data): a 2xx with a non-JSON body raises
    rather than silently coercing to an empty/garbage payload."""
    resp = _stub_response(200, "<html>gateway</html>")
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError):
            await client.get_balances()
        await client.aclose()


async def test_non_list_balances_payload_raises():
    """get_balances is a bare array per docs; a non-list 2xx payload raises
    (never coerce a dict/error-object into a balance list)."""
    resp = _stub_response(200, json.dumps({"error": "nope"}))
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError):
            await client.get_balances()
        await client.aclose()


async def test_aclose_is_idempotent():
    """Bounded close must be safe to call twice (mirrors aclose_exchange discipline)."""
    client = SfoxClient(api_key=API_KEY)
    # Force session creation without a real request.
    await client._ensure_session()
    await client.aclose()
    await client.aclose()  # second call must not raise
