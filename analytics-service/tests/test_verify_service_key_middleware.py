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
status is the correct 401/503 — which fails if anyone reverts to `raise`
(ServerErrorMiddleware would turn it into a 500 / propagated exception).
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
async def test_unconfigured_service_key_returns_clean_503(monkeypatch: pytest.MonkeyPatch) -> None:
    import main

    # SERVICE_KEY unset → fail closed with a clean 503, not a 500.
    monkeypatch.setattr(main, "SERVICE_KEY", None)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/cron-sync", headers={"X-Service-Key": "anything"})

    assert resp.status_code == 503
    assert resp.json() == {"detail": "Service not configured"}
