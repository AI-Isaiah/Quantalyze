"""PYAPI-08 (C-15) — the 429 must be machine-readable and carry Retry-After.

slowapi's default handler (`slowapi/extension.py:76-87`, identical in the
installed 0.1.9 and the CI-pinned 0.1.10) is::

    JSONResponse({"error": f"Rate limit exceeded: {exc.detail}"}, status_code=429)

Two defects in one line:

* the key is **`error`**, not `detail`, so `src/lib/analytics-client.ts:179`
  reads `err.detail` → `undefined` → falls through to the literal
  `"Analytics service error"`, which matches no classifier branch and renders
  as UNKNOWN (C-15 / G-9);
* it then calls `limiter._inject_headers(...)`, which is gated on
  `self._headers_enabled` — default `False` (`extension.py:135`) and never
  raised anywhere in this repo — so the 429 carries **no `Retry-After`** and
  140.3 cannot name the real wait (B-11).

The replacement is an app-global `RateLimitExceeded` handler emitting the same
envelope as the 422 handler, with `code: "RATE_LIMITED"` — a code that is
ALREADY registered as a recoverable `WizardErrorCode`
(`routers/process_key.py:358-359`), reused rather than re-minted.

Oracle discipline (programme non-negotiable #3): every expected status, key,
code, header and copy string below is a **LITERAL**. Nothing is imported from
`main` and compared to itself.
"""

from __future__ import annotations

from typing import Any, Iterator

import httpx
import pytest

_SERVICE_KEY = "test-service-key-for-rate-limit-contract"

# Route A — POST /api/verify-strategy, 5/hour (PYAPI-03 L-8). The cheapest trip
# in the service: `exchange="sfox"` is inside the pydantic Literal, so the body
# VALIDATES (the limiter is only reached after validation), and the handler's
# first statement raises 400 before any network I/O. Five 400s, then a 429.
_ROUTE_A = "/api/verify-strategy"
_ROUTE_A_LIMIT = 5
_ROUTE_A_LIMIT_TEXT = "5 per 1 hour"
_ROUTE_A_WINDOW_S = 3600
_ROUTE_A_BODY: dict[str, Any] = {
    "email": "ratelimit-contract@example.com",
    "exchange": "sfox",
    "api_key": "k",
    "api_secret": "s",
}

# Route B — POST /api/csv/validate, 30/hour (L-4). A DIFFERENT router, so a
# green here proves the handler is app-global rather than point-patched.
_ROUTE_B = "/api/csv/validate"
_ROUTE_B_LIMIT = 30
_ROUTE_B_LIMIT_TEXT = "30 per 1 hour"
_ROUTE_B_WINDOW_S = 3600


@pytest.fixture
def service_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY)
    yield


@pytest.fixture
def fresh_limiter() -> Iterator[Any]:
    """`services.rate_limit.limiter` is a process-wide singleton over `memory://`
    (RESEARCH G-3), so counts leak across the session. Reset both ways.
    """
    from services.rate_limit import limiter

    limiter.reset()
    yield limiter
    limiter.reset()


def _client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _headers() -> dict[str, str]:
    return {"X-Service-Key": _SERVICE_KEY}


async def _trip_route_a(client: httpx.AsyncClient) -> httpx.Response:
    """Spend route A's whole window, then return the refused response."""
    for _ in range(_ROUTE_A_LIMIT):
        spent = await client.post(_ROUTE_A, json=_ROUTE_A_BODY, headers=_headers())
        assert spent.status_code == 400, (
            "harness: each budget-spending call must reach the handler and be "
            f"refused 400 for sfox. Got {spent.status_code}: {spent.text[:300]}"
        )
    return await client.post(_ROUTE_A, json=_ROUTE_A_BODY, headers=_headers())


def _csv_files() -> dict[str, Any]:
    return {"file": ("x.csv", b"col\n1\n", "text/csv")}


def _csv_form() -> dict[str, str]:
    # `fmt` is deliberately invalid so the handler 400s immediately after the
    # limiter has counted the hit — no pandera run, no CSV parse.
    return {"fmt": "not-a-real-format", "wizard_session_id": "wiz-rate-limit"}


async def _trip_route_b(client: httpx.AsyncClient) -> httpx.Response:
    for _ in range(_ROUTE_B_LIMIT):
        spent = await client.post(
            _ROUTE_B, files=_csv_files(), data=_csv_form(), headers=_headers()
        )
        assert spent.status_code == 400, (
            "harness: each budget-spending call must reach the handler and be "
            f"refused 400 for a bad fmt. Got {spent.status_code}: {spent.text[:300]}"
        )
    return await client.post(
        _ROUTE_B, files=_csv_files(), data=_csv_form(), headers=_headers()
    )


# ---------------------------------------------------------------------------
# PYAPI-08a — the body is machine-readable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_08a_429_body_is_the_rate_limited_envelope(
    service_key: None, fresh_limiter: Any
) -> None:
    """Literal code, literal copy, scalar strings. The whole body is pinned as
    an EQUALITY except `correlation_id` (a per-request uuid), so a later "just
    add one more debug key" cannot slip past.
    """
    async with _client() as client:
        resp = await _trip_route_a(client)

    assert resp.status_code == 429, (
        f"the {_ROUTE_A_LIMIT + 1}th call must be throttled. "
        f"Got {resp.status_code}: {resp.text[:300]}"
    )
    body = resp.json()
    assert body["code"] == "RATE_LIMITED"
    assert body["ok"] is False
    assert body["recoverable"] is True
    assert type(body["detail"]) is str
    assert type(body["human_message"]) is str
    assert body["detail"] == f"Rate limit exceeded: {_ROUTE_A_LIMIT_TEXT}"
    assert body["human_message"] == (
        "Too many requests. Please wait a moment and try again."
    )
    assert set(body.keys()) == {
        "ok",
        "code",
        "human_message",
        "detail",
        "correlation_id",
        "recoverable",
        "retry_after_seconds",
    }, f"unexpected 429 envelope keys: {sorted(body.keys())}"
    assert type(body["correlation_id"]) is str and body["correlation_id"]


@pytest.mark.asyncio
async def test_08a_slowapi_default_error_key_is_gone(
    service_key: None, fresh_limiter: Any
) -> None:
    """The old shape was `{"error": "Rate limit exceeded: ..."}` with NO
    `detail`. `error` must be gone AND `detail` must be present — asserting
    only one of the two lets a handler that emits both pass.
    """
    async with _client() as client:
        resp = await _trip_route_a(client)

    body = resp.json()
    assert "error" not in body, (
        "the slowapi default handler is still registered — analytics-client.ts:179 "
        f"reads `.detail` and gets undefined. Body: {body}"
    )
    assert "detail" in body


# ---------------------------------------------------------------------------
# PYAPI-08b — Retry-After
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_08b_429_carries_a_parseable_positive_retry_after(
    service_key: None, fresh_limiter: Any
) -> None:
    """B-11: without this header 140.3 has to invent a wait."""
    async with _client() as client:
        resp = await _trip_route_a(client)

    assert "Retry-After" in resp.headers, (
        "PYAPI-08b: no Retry-After. slowapi's _inject_headers is gated on "
        "_headers_enabled, which is False on the shared Limiter."
    )
    seconds = int(resp.headers["Retry-After"])
    assert 0 < seconds <= _ROUTE_A_WINDOW_S, (
        f"Retry-After must be a positive wait inside the 1-hour window, got {seconds}"
    )


@pytest.mark.asyncio
async def test_08b_retry_after_header_and_body_field_agree(
    service_key: None, fresh_limiter: Any
) -> None:
    """A body-reading consumer and a header-reading consumer must not disagree
    — the same reason `retryable` is carried redundantly in the 5xx envelope.
    """
    async with _client() as client:
        resp = await _trip_route_a(client)

    body = resp.json()
    assert type(body["retry_after_seconds"]) is int
    assert body["retry_after_seconds"] == int(resp.headers["Retry-After"])


# ---------------------------------------------------------------------------
# PYAPI-08c — the SECOND decorated route (app-global, not point-patched)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_08c_second_route_gets_the_same_envelope_and_header(
    service_key: None, fresh_limiter: Any
) -> None:
    """`/api/csv/validate` lives in a different router and was re-keyed by
    PYAPI-03 (L-4). All 10 decorated routes inherit this handler; two are
    enough to prove it is registered on the app rather than on one endpoint.
    """
    async with _client() as client:
        resp = await _trip_route_b(client)

    assert resp.status_code == 429, (
        f"the {_ROUTE_B_LIMIT + 1}th call must be throttled. "
        f"Got {resp.status_code}: {resp.text[:300]}"
    )
    body = resp.json()
    assert body["code"] == "RATE_LIMITED"
    assert body["ok"] is False
    assert body["recoverable"] is True
    assert type(body["detail"]) is str
    assert body["detail"] == f"Rate limit exceeded: {_ROUTE_B_LIMIT_TEXT}"
    assert "error" not in body
    seconds = int(resp.headers["Retry-After"])
    assert 0 < seconds <= _ROUTE_B_WINDOW_S


# ---------------------------------------------------------------------------
# Gate order — 422 still resolves BEFORE 429
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validation_still_precedes_the_throttle(
    service_key: None, fresh_limiter: Any
) -> None:
    """The phase's gate order is: bearer 500/401 -> 422 -> 429 -> 403.

    With route A's budget fully spent, an INVALID body must still answer 422 —
    pydantic resolves before the endpoint (and therefore before slowapi's
    decorator) is ever called. Pinned here because both handlers are being
    replaced in the same plan and a registration order slip is invisible
    otherwise.
    """
    async with _client() as client:
        throttled = await _trip_route_a(client)
        assert throttled.status_code == 429  # budget is provably spent

        resp = await client.post(
            _ROUTE_A,
            json={"email": "not-an-email", "exchange": "kraken"},
            headers=_headers(),
        )

    assert resp.status_code == 422, (
        "gate order regressed: an invalid body answered "
        f"{resp.status_code} instead of 422 with the bucket empty"
    )
    assert resp.json()["code"] == "VALIDATION_FAILED"


@pytest.mark.asyncio
async def test_service_key_gate_still_precedes_the_throttle(
    service_key: None, fresh_limiter: Any
) -> None:
    """...and the middleware still runs before both. A wrong X-Service-Key on a
    throttled route is 401, not 429.
    """
    async with _client() as client:
        throttled = await _trip_route_a(client)
        assert throttled.status_code == 429

        resp = await client.post(
            _ROUTE_A,
            json=_ROUTE_A_BODY,
            headers={"X-Service-Key": "the-wrong-key"},
        )

    assert resp.status_code == 401
