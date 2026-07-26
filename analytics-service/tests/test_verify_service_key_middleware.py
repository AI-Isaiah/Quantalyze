"""QUANTALYZE-4 — verify_service_key middleware must return a clean status, not
raise.

`verify_service_key` is a Starlette BaseHTTPMiddleware. It sits ABOVE the
ExceptionMiddleware that would translate a `raise HTTPException` into a clean
response, so a raise escaped to ServerErrorMiddleware, which renders a 500 AND
re-raises (the Sentry integration then captured it). Every missing/empty
X-Service-Key produced a 500 + a captured error instead of a clean 401
(24 prod events). The fix returns a JSONResponse directly.

These tests drive the REAL main.app middleware stack via httpx.ASGITransport
(which does NOT run lifespan, so the worker loop never starts) and assert the
status is the correct 401 (bad caller key) or classified 500 (SERVICE_KEY unset
— PYAPI-05 S-23; it was a 503 before, which made an operator-only fault look
transient and flapped 140.2's breaker forever). Both fail if anyone reverts to
`raise`: ServerErrorMiddleware would answer `text/plain` with no JSON body at
all, so `resp.json()` on the asserted envelope is the return-path proof.
"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_missing_service_key_returns_clean_401(monkeypatch: pytest.MonkeyPatch) -> None:
    import main

    # verify_service_key reads the module-global SERVICE_KEY at call time.
    monkeypatch.setattr(main, "SERVICE_KEY", "the-configured-key")

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # A guarded path (not /health, /internal/*, /process-key) with NO
        # X-Service-Key header. Must be rejected cleanly BEFORE routing.
        resp = await client.post("/cron-sync")

    assert resp.status_code == 401, (
        "QUANTALYZE-4: a missing X-Service-Key must yield a clean 401, not a 500 "
        "from ServerErrorMiddleware (which happens if the middleware `raise`s an "
        f"HTTPException instead of returning a JSONResponse). Got {resp.status_code}."
    )
    assert resp.json() == {"detail": "Unauthorized"}


@pytest.mark.asyncio
async def test_wrong_service_key_returns_clean_401(monkeypatch: pytest.MonkeyPatch) -> None:
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", "the-configured-key")

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/cron-sync", headers={"X-Service-Key": "wrong"})

    assert resp.status_code == 401
    assert resp.json() == {"detail": "Unauthorized"}


@pytest.mark.asyncio
async def test_correct_service_key_passes_middleware(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rule 12 cuts both ways: the gate must REJECT bad keys AND ADMIT good ones.
    With the matching X-Service-Key the request passes verify_service_key to
    call_next and reaches the route (which may then fail for unrelated reasons —
    e.g. no DB env in the test — but must NOT be the middleware's 401/503). Guards
    the happy path against a regression in the raise->return refactor."""
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", "the-configured-key")

    # raise_app_exceptions=False so a route-level error surfaces as a 5xx response
    # rather than propagating — we only care that the middleware admitted the call.
    transport = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/cron-sync", headers={"X-Service-Key": "the-configured-key"}
        )

    assert resp.status_code not in (401, 503), (
        "a correct X-Service-Key must pass the auth middleware (reach the route); "
        f"got {resp.status_code}, which is a middleware rejection."
    )


@pytest.mark.asyncio
async def test_unconfigured_service_key_returns_classified_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SERVICE_KEY unset → fail closed with a CLASSIFIED 500, still RETURNED.

    PYAPI-05 S-23 changed the status, not the mechanism. The old 503 said
    "we are temporarily unavailable, retry" about a fault only an operator can
    clear, so every request to every guarded route fed 140.2's breaker: trip →
    expire → re-probe → trip, forever. R-1 makes an operator-only fault a 500
    with ``retryable:false``, which never counts.

    The QUANTALYZE-4 property this file exists for is UNCHANGED and still
    asserted: the response is RETURNED, not raised. A raise here escapes to
    ServerErrorMiddleware, which renders ``text/plain`` "Internal Server Error"
    and re-raises into Sentry — so a well-formed JSON envelope at this status
    is the proof the return path was taken.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/cron-sync", headers={"X-Service-Key": "anything"})

    assert resp.status_code == 500, (
        "an unset SERVICE_KEY is an operator-only misconfiguration: permanent, "
        f"never retryable, and never a breaker input (R-1). Got {resp.status_code}."
    )
    body = resp.json()  # would raise on the ServerErrorMiddleware text/plain body
    assert body == {
        "detail": {
            "code": "SERVICE_KEY_UNCONFIGURED",
            "dependency": None,
            "retryable": False,
            "detail": "Service not configured",
        }
    }
    assert "Retry-After" not in resp.headers
