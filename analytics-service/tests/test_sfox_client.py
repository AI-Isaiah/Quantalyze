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
    SFOX_REQUEST_TIMEOUT_S,
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


def test_request_chokepoint_has_no_method_parameter():
    """WR-03 (structural): read-only is enforced at the ONE place that talks to the
    network. _request must expose NO `method` parameter, so there is no code path —
    internal or phase-119 — to coerce a write (POST /v1/orders) through the generic
    request seam. The verb is hardcoded to GET inside _request."""
    import inspect

    params = inspect.signature(SfoxClient._request).parameters
    assert "method" not in params, "_request must not accept a caller-supplied HTTP verb"


@pytest.mark.parametrize(
    "invoke, body",
    [
        (lambda c: c.get_balances(), "[]"),
        (lambda c: c.get_transactions(), "[]"),
        (lambda c: c.get_trades(), '{"data": []}'),
        (lambda c: c.get_balance_history(start_date_ms=111), '{"data": []}'),
    ],
    ids=["balances", "transactions", "trades", "balance_history"],
)
async def test_every_read_method_issues_a_get(invoke, body):
    """WR-03: every read method must put a GET on the wire. The verb is asserted on
    the mocked request call (args[0]) for ALL four paths — not just the URL — so a
    regression that lets any read issue a non-GET is caught at the seam. Each case
    uses the shape its method parses (bare array vs {data:[...]} envelope)."""
    resp = _stub_response(200, body)
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        await invoke(client)
        await client.aclose()
    args, _ = mock_req.call_args
    assert args[0] == "GET"


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


async def test_error_message_scrubs_bare_api_key_echo():
    """WR-02: a BARE echo of the raw key — no denylisted `key=` prefix, no JWT shape,
    and (as here) no `:`/`=`/`.` punctuation so scrub_freeform_string's fast-path
    returns it VERBATIM — must still not survive into str(exc). The prior test used an
    `api_key=<key>` body that the pattern denylist happens to catch, masking this gap.
    Fixed by redacting self._api_key by value at the chokepoint before the freeform
    scrub. Fails against the pre-WR-02 code."""
    # Body is exactly the punctuation-free key: hits the redact fast-path passthrough.
    resp = _stub_response(403, API_KEY)
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError) as excinfo:
            await client.get_balances()
        await client.aclose()
    assert API_KEY not in str(excinfo.value)
    assert "[REDACTED]" in str(excinfo.value)


async def test_non_json_2xx_body_raises():
    """Fail-loud (T-118-04, no invented data): a 2xx with a non-JSON body raises
    rather than silently coercing to an empty/garbage payload."""
    resp = _stub_response(200, "<html>gateway</html>")
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError):
            await client.get_balances()
        await client.aclose()


async def test_non_json_2xx_raises_with_shape_violation_status_zero():
    """F4: a 2xx whose body isn't JSON (e.g. an HTML gateway page behind a 200) is a
    SHAPE/contract violation, not an HTTP error — it must raise with status==0, the
    same sentinel the list/envelope guards use. This keeps status==0 uniformly
    meaning 'shape violation' so a phase-119 classifier keyed on it cannot misread a
    200-wrapped HTML page as a real HTTP status. Fails against the pre-F4 code that
    carried the real 200 into the error."""
    resp = _stub_response(200, "<html>gateway timeout</html>")
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError) as excinfo:
            await client.get_balances()
        await client.aclose()
    assert excinfo.value.status == 0


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


async def test_session_has_bounded_request_timeout_not_aiohttp_default():
    """F2 (worker-wedge): the owned session must carry an EXPLICIT bounded
    ClientTimeout, not aiohttp's implicit total=300s. A 5-minute hang on the
    sequential worker blows the ~90s healthz budget (the v1.11 wedge class).
    Pins the configured total to SFOX_REQUEST_TIMEOUT_S (30s) and, explicitly,
    that it is NOT the 300s default."""
    client = SfoxClient(api_key=API_KEY)
    session = await client._ensure_session()
    try:
        assert session.timeout.total == SFOX_REQUEST_TIMEOUT_S
        assert SFOX_REQUEST_TIMEOUT_S == 30.0
        assert session.timeout.total != 300
    finally:
        await client.aclose()


async def test_read_after_aclose_fails_loud_no_session_reopen():
    """WR-01 + F1: the closed state is terminal, and the raise happens at the TOP of
    _request BEFORE the rate gate. A read after aclose() must raise rather than
    silently reopening a fresh session that the (already-early-returning) second
    aclose() can never close (the guaranteed 'Unclosed client session' leak) AND it
    must raise IMMEDIATELY — never real-sleep the rate-gate wait (up to 10s) on the
    sequential worker first. Injected clock/sleep assert zero gate wait on the
    post-close call. Fails against the pre-F1 code where _rate_gate ran first."""
    clock = _FakeClock()
    sleeps: list[float] = []

    async def fake_sleep(d: float) -> None:
        sleeps.append(d)
        clock.t += d

    resp = _stub_response(200, "[]")
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY, _clock=clock, _sleep=fake_sleep)
        await client.get_balances()
        await client.aclose()
        with pytest.raises(RuntimeError):
            # transactions has the 10s interval; a pre-F1 gate-first path would
            # sleep ~10s here before raising. Post-F1 it raises with no sleep.
            await client.get_transactions()
        # The post-close call raised BEFORE the rate gate — no wall-clock wait.
        assert sleeps == [], "post-close call must raise before the rate gate sleeps"
        # No new session was ever created, so the second aclose() has nothing to leak.
        assert client._session is None
        await client.aclose()


# ---------------------------------------------------------------------------
# Task 2 — paginated read methods + per-endpoint rate gate
#
# Regression gates — WHY each case matters (Rule 9):
#   - wire param names: sFOX documents `from`/`to`/`limit`/`after`/`offset`/`types`
#     (transactions), `page_size`/`last_seen_id` (trades), `start_date`/`end_date`/
#     `interval` (balance history). The Python signature uses `from_ms` (from is a
#     keyword) but the BYTES on the wire must be the documented names — an invented
#     param name silently returns the wrong window and phase-120 reconstruction
#     stitches garbage. Asserted on the mocked request `params` kwarg.
#   - envelope handling: trades and balance_history wrap the payload in `{data:[...]}`;
#     balances and transactions are bare arrays. A missing `data` key is a real API
#     contract break and must fail loud, never coerce to an empty series (no invented data).
#   - cursor plumbing: phase 120 drives crawls with `after`/`last_seen_id`; if the
#     cursor does not land verbatim in the request, pagination breaks at the seam.
#   - transactions rate gate (T-118-03 / FLIPRETRY-01 at the client layer): the
#     documented 1 req/10s limit MUST be enforced in _request. A second immediate
#     call must sleep >= ~10s. This is the exact v1.11 wedge lesson — an unbounded
#     un-gated crawl on the sequential worker loop stalls healthz. Proven with an
#     injected clock so the suite still runs in milliseconds.
# ---------------------------------------------------------------------------


class _FakeClock:
    """Controllable monotonic clock for rate-gate tests (no real sleeping)."""

    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t


async def test_get_transactions_endpoint_and_wire_params():
    """Transactions GET the documented path with EXACTLY the documented wire param
    names (from/to/limit/after/offset/types); only provided ones are sent."""
    resp = _stub_response(200, json.dumps([{"id": 1, "account_balance": "100"}]))
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        out = await client.get_transactions(
            from_ms=1000, to_ms=2000, after="12345", offset=5, types="deposit"
        )
        await client.aclose()

    assert out == [{"id": 1, "account_balance": "100"}]
    args, kwargs = mock_req.call_args
    assert args[0] == "GET"
    assert args[1] == f"{SFOX_PROD_BASE_URL}/v1/account/transactions"
    assert kwargs["params"] == {
        "from": 1000,
        "to": 2000,
        "limit": 250,
        "after": "12345",
        "offset": 5,
        "types": "deposit",
    }


async def test_get_transactions_omits_unset_params():
    """Only provided params reach the wire — a bare call sends just the default limit."""
    resp = _stub_response(200, "[]")
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        await client.get_transactions()
        await client.aclose()
    _, kwargs = mock_req.call_args
    assert kwargs["params"] == {"limit": 250}


async def test_get_transactions_limit_over_max_raises_before_request():
    """Documented max limit is 1000; a larger limit raises ValueError BEFORE any
    request is issued (no wasted rate-limited round-trip)."""
    with _patch_request(_stub_response(200, "[]")) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(ValueError):
            await client.get_transactions(limit=1001)
        await client.aclose()
    mock_req.assert_not_called()


async def test_get_trades_endpoint_params_and_envelope():
    """Trades GET /v1/account/trades with page_size/last_seen_id and unwrap the
    documented {data:[...]} envelope to the inner list."""
    resp = _stub_response(200, json.dumps({"data": [{"trade_id": 7}]}))
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        out = await client.get_trades(page_size=100, last_seen_id="67890")
        await client.aclose()

    assert out == [{"trade_id": 7}]
    args, kwargs = mock_req.call_args
    assert args[1] == f"{SFOX_PROD_BASE_URL}/v1/account/trades"
    assert kwargs["params"] == {"page_size": 100, "last_seen_id": "67890"}


async def test_get_trades_missing_data_envelope_raises():
    """A trades payload with no `data` key is a contract break — fail loud."""
    resp = _stub_response(200, json.dumps({"unexpected": []}))
    with _patch_request(resp):
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(SfoxApiError):
            await client.get_trades()
        await client.aclose()


async def test_get_balance_history_endpoint_params_and_envelope():
    """Balance history GET /v1/account/balance/history with start_date (required),
    end_date (optional), interval; unwraps {data:[{timestamp,usd_value}]}."""
    resp = _stub_response(
        200, json.dumps({"data": [{"timestamp": 1, "usd_value": "42"}]})
    )
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        out = await client.get_balance_history(
            start_date_ms=111, end_date_ms=222, interval=3600
        )
        await client.aclose()

    assert out == [{"timestamp": 1, "usd_value": "42"}]
    args, kwargs = mock_req.call_args
    assert args[1] == f"{SFOX_PROD_BASE_URL}/v1/account/balance/history"
    assert kwargs["params"] == {"start_date": 111, "end_date": 222, "interval": 3600}


async def test_get_balance_history_default_interval_daily():
    """Interval defaults to daily (86400s); end_date omitted is not sent."""
    resp = _stub_response(200, json.dumps({"data": []}))
    with _patch_request(resp) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        await client.get_balance_history(start_date_ms=111)
        await client.aclose()
    _, kwargs = mock_req.call_args
    assert kwargs["params"] == {"start_date": 111, "interval": 86400}


async def test_get_balance_history_bad_interval_raises_before_request():
    """interval must be 3600 or 86400; anything else raises ValueError pre-request."""
    with _patch_request(_stub_response(200, json.dumps({"data": []}))) as mock_req:
        client = SfoxClient(api_key=API_KEY)
        with pytest.raises(ValueError):
            await client.get_balance_history(start_date_ms=111, interval=60)
        await client.aclose()
    mock_req.assert_not_called()


async def test_transactions_rate_gate_enforces_10s():
    """T-118-03 / FLIPRETRY-01: a second immediate transactions call must sleep
    >= ~10s. The strict 1 req/10s limit lives in _request, not the call site."""
    clock = _FakeClock()
    sleeps: list[float] = []

    async def fake_sleep(d: float) -> None:
        sleeps.append(d)
        clock.t += d

    with _patch_request(_stub_response(200, "[]")):
        client = SfoxClient(
            api_key=API_KEY, _clock=clock, _sleep=fake_sleep
        )
        await client.get_transactions()
        await client.get_transactions()
        await client.aclose()

    assert sleeps, "second transactions call did not hit the rate gate"
    assert max(sleeps) >= 10.0


async def test_rate_gate_serializes_concurrent_same_endpoint_calls():
    """F3 (prevents a 429/ban on the founder's real key): two concurrent calls to
    the SAME endpoint must be serialized by the gate lock, so the second observes
    the first's stamp and waits a full interval — not race it inside the window.

    The tell: with the lock, the two gate-sleeps START at DISTINCT clock values
    (the second cannot enter the critical section until the first has stamped);
    WITHOUT the lock both read the same stale `last` and start their sleeps at the
    SAME clock value. `fake_sleep` yields the event loop (await asyncio.sleep(0)) so
    the two gathered coroutines actually interleave at the sleep await point."""
    import asyncio as _asyncio

    clock = _FakeClock()
    sleep_start_clocks: list[float] = []

    async def fake_sleep(d: float) -> None:
        sleep_start_clocks.append(clock.t)
        await _asyncio.sleep(0)  # yield so the sibling coroutine can interleave
        clock.t += d

    with _patch_request(_stub_response(200, "[]")):
        client = SfoxClient(api_key=API_KEY, _clock=clock, _sleep=fake_sleep)
        # Prime the endpoint so BOTH concurrent calls hit the gate (last is set).
        await client.get_balances()  # stamps last=1000, no sleep (first call)
        await _asyncio.gather(client.get_balances(), client.get_balances())
        await client.aclose()

    # Both concurrent calls slept (each waited a full 1s default interval)...
    assert len(sleep_start_clocks) == 2
    # ...and critically, at DISTINCT, monotonically increasing clocks — proving the
    # second waited behind the first's stamp. Without the lock this is [1000, 1000].
    assert sleep_start_clocks == [1000.0, 1001.0]


async def test_other_endpoints_use_smaller_default_interval():
    """Non-transactions endpoints enforce a smaller default interval (1s), proving
    the gate is per-endpoint-path, not a single global 10s throttle."""
    clock = _FakeClock()
    sleeps: list[float] = []

    async def fake_sleep(d: float) -> None:
        sleeps.append(d)
        clock.t += d

    with _patch_request(_stub_response(200, "[]")):
        client = SfoxClient(api_key=API_KEY, _clock=clock, _sleep=fake_sleep)
        await client.get_balances()
        await client.get_balances()
        await client.aclose()

    assert sleeps == [1.0]
