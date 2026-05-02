"""Phase 16 / OBSERV-02 — integration tests for CorrelationMiddleware.

Asserted invariants:
  1. Inbound X-Correlation-Id header is bound to the structlog contextvar AND
     a Sentry tag for the request scope.
  2. Outbound response echoes X-Correlation-Id header back to caller.
  3. Token-based reset (FIX 11) — sequential requests do NOT bleed cid AND
     no zombie contextvar binding survives at request end.
  4. Missing inbound header yields a fresh UUID v4 in the response.
  5. 100-request sequential stress test (FIX 11) — every request emits the
     right cid AND the contextvar returns to its default after each request.
"""

from __future__ import annotations

import re

import httpx
import pytest
import structlog
from fastapi import FastAPI

from services.logging_config import (
    CorrelationMiddleware,
    configure_logging,
    correlation_id_var,
)


UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


@pytest.fixture
def app(monkeypatch):
    configure_logging()
    test_app = FastAPI()
    test_app.add_middleware(CorrelationMiddleware)

    @test_app.post("/_test")
    async def _route():
        # Read BOTH the explicit ContextVar (FIX 11) AND structlog's contextvars
        # bindings — they should be in lockstep during the request.
        bound = structlog.contextvars.get_contextvars()
        return {
            "correlation_id_struct": bound.get("correlation_id"),
            "correlation_id_var": correlation_id_var.get(),
        }

    return test_app


@pytest.fixture
def sentry_mock(monkeypatch):
    set_tag_calls: list[tuple[str, str]] = []

    class _Scope:
        def set_tag(self, key, value):
            set_tag_calls.append((key, value))

    class _ScopeCtx:
        def __enter__(self):
            return _Scope()

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(
        "services.logging_config.sentry_sdk.new_scope",
        lambda: _ScopeCtx(),
    )
    return set_tag_calls


@pytest.mark.asyncio
async def test_inbound_header_bound_and_echoed(app, sentry_mock):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/_test", headers={"X-Correlation-Id": "abc-123"})
    assert resp.headers["x-correlation-id"] == "abc-123"
    body = resp.json()
    assert body["correlation_id_struct"] == "abc-123"
    assert body["correlation_id_var"] == "abc-123"
    assert ("correlation_id", "abc-123") in sentry_mock


@pytest.mark.asyncio
async def test_missing_header_generates_fresh_uuid(app, sentry_mock):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/_test")
    cid = resp.headers["x-correlation-id"]
    assert UUID_V4_RE.match(cid), f"expected UUID v4, got {cid!r}"


@pytest.mark.asyncio
async def test_no_bleed_across_two_requests_via_token_reset(app, sentry_mock):
    """FIX 11: Token-based reset prevents bleed AND leaves no zombie binding."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r1 = await client.post("/_test", headers={"X-Correlation-Id": "first"})
        r2 = await client.post("/_test", headers={"X-Correlation-Id": "second"})
    assert r1.json()["correlation_id_struct"] == "first"
    assert r2.json()["correlation_id_struct"] == "second"
    assert r1.json()["correlation_id_var"] == "first"
    assert r2.json()["correlation_id_var"] == "second"
    # After both requests complete, the explicit ContextVar must be reset to default.
    assert correlation_id_var.get() is None, (
        "FIX 11 violation: correlation_id_var did NOT reset to default after "
        "request — Token-based reset is broken or clear_contextvars was used "
        "instead"
    )
    # structlog contextvars must also be empty (or at least not contain correlation_id).
    assert structlog.contextvars.get_contextvars().get("correlation_id") is None


@pytest.mark.asyncio
async def test_sequential_100_requests_no_bleed_no_zombie(app, sentry_mock):
    """FIX 11 stress: 100 sequential requests with unique cids; assert each emits
    the right cid AND the contextvar returns to default after each."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for i in range(100):
            cid = f"cid-{i:04d}"
            resp = await client.post(
                "/_test", headers={"X-Correlation-Id": cid}
            )
            body = resp.json()
            assert body["correlation_id_struct"] == cid, (
                f"Request {i}: structlog cid bled — expected {cid!r}, got "
                f"{body['correlation_id_struct']!r}"
            )
            assert body["correlation_id_var"] == cid, (
                f"Request {i}: ContextVar cid bled — expected {cid!r}, got "
                f"{body['correlation_id_var']!r}"
            )
            assert resp.headers["x-correlation-id"] == cid
    # Final state: no zombie binding survived the loop.
    assert correlation_id_var.get() is None
    assert structlog.contextvars.get_contextvars().get("correlation_id") is None
