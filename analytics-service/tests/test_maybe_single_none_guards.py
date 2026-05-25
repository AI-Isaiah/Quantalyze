"""Regression tests: postgrest ``maybe_single().execute()`` -> None crash class.

In this postgrest-py version, ``.maybe_single().execute()`` returns ``None`` (not
an APIResponse with ``data=None``) when zero rows match. Several call sites
assumed an APIResponse and dereferenced ``.data`` directly, raising
``AttributeError: 'NoneType' object has no attribute 'data'``.

Surfaced in production via Sentry during the Phase 19 soak:
  - routers/match.py:_load_allocator_context (issue 122529812, /api/match/cron-recompute)

Latent siblings of the same root cause, fixed alongside it:
  - routers/match.py:_kill_switch_enabled  (fail-open, but logged a spurious ERROR)
  - routers/internal.py:get_key_permissions (500 instead of the intended 404)

Each test models the real contract: the prefs/flags/api_keys ``maybe_single`` chain
returns ``None`` while every other query returns an empty (``data=[]``) result.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

try:
    import routers.internal as internal_router
    from routers.match import _kill_switch_enabled, _load_allocator_context

    IMPORTS_OK = True
except ImportError:  # pragma: no cover - import guard mirrors sibling tests
    _kill_switch_enabled = None  # type: ignore
    _load_allocator_context = None  # type: ignore
    internal_router = None  # type: ignore
    IMPORTS_OK = False


class _Chain:
    """Chainable postgrest-query stand-in.

    Every builder method returns ``self``. ``.maybe_single()`` flips a flag so the
    terminal ``.execute()`` returns ``None`` (the 0-row postgrest contract that
    triggered the bug); every other chain returns an empty ``data=[]`` response.
    """

    def __init__(self) -> None:
        self._maybe_single = False

    def __getattr__(self, name: str):
        if name.startswith("__"):
            raise AttributeError(name)
        if name == "maybe_single":
            def _ms(*_a, **_k):
                self._maybe_single = True
                return self

            return _ms
        return lambda *_a, **_k: self

    def execute(self):
        return None if self._maybe_single else SimpleNamespace(data=[])


class _FakeSupabase:
    def table(self, _name: str) -> _Chain:
        return _Chain()


@pytest.mark.skipif(not IMPORTS_OK, reason="analytics-service imports unavailable")
def test_load_allocator_context_survives_missing_preferences_row(monkeypatch):
    """Sentry 122529812: an allocator with no allocator_preferences row makes
    ``maybe_single().execute()`` return None. ``_load_allocator_context`` must
    return ``preferences=None`` (the caller normalizes it to {}) rather than
    raising ``AttributeError: 'NoneType' object has no attribute 'data'``.
    """
    monkeypatch.setattr("routers.match.get_supabase", lambda: _FakeSupabase())
    ctx = _load_allocator_context("alloc-without-prefs")
    assert ctx["preferences"] is None


@pytest.mark.skipif(not IMPORTS_OK, reason="analytics-service imports unavailable")
def test_kill_switch_fails_open_quietly_when_flag_row_absent(monkeypatch):
    """A missing system_flags row makes ``maybe_single().execute()`` return None.
    ``_kill_switch_enabled`` must fail open (return True) WITHOUT routing through
    the except branch's ``logger.error`` — pre-fix the None.data AttributeError
    tripped that error log on every cron tick, inflating the soak error rate.
    """
    monkeypatch.setattr("routers.match.get_supabase", lambda: _FakeSupabase())
    fake_logger = MagicMock()
    monkeypatch.setattr("routers.match.logger", fake_logger)

    assert _kill_switch_enabled() is True
    fake_logger.error.assert_not_called()


@pytest.mark.skipif(not IMPORTS_OK, reason="analytics-service imports unavailable")
def test_get_key_permissions_returns_404_for_unknown_key(monkeypatch):
    """An unknown key_id makes ``maybe_single().execute()`` return None. The
    route must answer the intended 404, not a 500 from
    ``AttributeError: 'NoneType' object has no attribute 'data'``.
    """
    monkeypatch.setattr(internal_router, "_verify_internal_token", lambda _req: None)
    monkeypatch.setattr(internal_router, "_consume_rate_limit", lambda _kid: True)
    monkeypatch.setattr(internal_router, "get_supabase", lambda: _FakeSupabase())

    app = FastAPI()
    app.include_router(internal_router.router)
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.post("/internal/keys/does-not-exist/permissions")
    assert resp.status_code == 404
