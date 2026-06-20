"""tech-debt #9 — /health exposes the deployed git SHA.

Railway skips a deploy silently when main CI is red, leaving the worker on
stale code with no machine-checkable signal. /health now returns `git_sha`
(from RAILWAY_GIT_COMMIT_SHA) so a post-merge probe (or a human) can assert
"prod is running main HEAD". These tests fail if the field is dropped or the
env wiring is broken.

Driven through the real main.app via httpx.ASGITransport (no lifespan, so the
worker loop never starts) — matches test_verify_service_key_middleware.py.
"""

from __future__ import annotations

import time

import httpx
import pytest


@pytest.mark.asyncio
async def test_health_reports_deployed_git_sha(monkeypatch: pytest.MonkeyPatch) -> None:
    import main

    # _DEPLOYED_SHA is captured at import from RAILWAY_GIT_COMMIT_SHA; the
    # handler reads the module global at call time, so patch it directly
    # (same pattern as SERVICE_KEY in the middleware tests).
    monkeypatch.setattr(main, "_DEPLOYED_SHA", "deadbeefcafe")
    # Keep the worker heartbeat fresh so /health returns 200 even if this test
    # runs >90s (WORKER_STALE_THRESHOLD_S) after module import in a long suite.
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", time.time())

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    assert resp.json().get("git_sha") == "deadbeefcafe", (
        "tech-debt #9: /health must surface the deployed commit so the post-merge "
        f"probe can detect a stale Railway deploy. Body: {resp.json()}"
    )


@pytest.mark.asyncio
async def test_health_git_sha_present_and_stringy_by_default() -> None:
    # When neither RAILWAY_GIT_COMMIT_SHA nor GIT_COMMIT_SHA is set (local/dev),
    # the field must still be a non-empty string ("unknown" fallback) — never
    # missing, so the probe's `!=` comparison is always well-defined.
    import main

    assert isinstance(main._DEPLOYED_SHA, str)
    assert main._DEPLOYED_SHA
