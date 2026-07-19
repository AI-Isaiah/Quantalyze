"""SFOX-05 (F2) — the sfox branch of the internal live-key permission probe
(routers/internal.py::get_key_permissions).

sFOX is NOT a ccxt exchange: create_exchange RAISES ValueError for it, which the
ccxt path maps to a misleading 400/502 at the finalize-wizard permission probe
(the phase-119 F2 misdirection). The sfox branch instead probes via the GET-only
SfoxClient and returns the HONEST structural read-only triple.

Regression gates (Rule 9 — WHY each case matters):
  - success → the STRUCTURAL read-only triple {read:True, trade:False,
    withdraw:False, probe_error:False}. sFOX has no scope endpoint and no
    trade/withdraw surface, so a successful auth+read proof is honestly read-only.
  - 401/403 → an auth-dead key is honestly SCOPELESS {read:False, ...,
    probe_error:False} — NOT a probe error (it authenticated-and-failed cleanly).
  - other SfoxApiError (429/5xx/shape) → fail CLOSED {probe_error:True, read:False}
    — never a false read/trade/withdraw grant on a transient blip.
  - aclose on EVERY path (the adapter owns an aiohttp session).
  - the ccxt create_exchange is NEVER called for sfox.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.internal import router, _reset_rate_limit


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    _reset_rate_limit()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _supabase_with_sfox_key() -> MagicMock:
    """A supabase mock returning an active sfox api_keys row + a no-op audit
    insert (the route inserts key_permission_audit best-effort)."""
    fake = MagicMock()

    def _table(name: str):
        tbl = MagicMock()
        if name == "api_keys":
            chain = tbl.select.return_value.eq.return_value.maybe_single.return_value
            chain.execute.return_value = MagicMock(
                data={"id": "key-sfox", "exchange": "sfox", "is_active": True}
            )
        else:  # key_permission_audit insert
            tbl.insert.return_value.execute.return_value = MagicMock(data=[{"id": 1}])
        return tbl

    fake.table.side_effect = _table
    return fake


def _headers() -> dict:
    return {"x-internal-token": "test-token"}


def _probe(client, sfox_client, *, create_exchange_spy):
    """Drive the route with the sfox seams patched. Returns the JSON response."""
    with patch("routers.internal.get_supabase", return_value=_supabase_with_sfox_key()), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=("tok-sfox", "", None),
         ), \
         patch("services.sfox_client.SfoxClient", return_value=sfox_client), \
         patch("routers.internal.create_exchange", new=create_exchange_spy):
        return client.post(
            "/internal/keys/key-sfox/permissions", headers=_headers()
        )


def test_sfox_probe_success_returns_structural_readonly_triple(client):
    sfox = MagicMock()
    sfox.get_balances = AsyncMock(return_value=[])  # empty list = auth+read OK
    sfox.aclose = AsyncMock()
    spy = MagicMock(side_effect=AssertionError("create_exchange must NOT run for sfox"))

    r = _probe(client, sfox, create_exchange_spy=spy)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["read"] is True
    assert body["trade"] is False
    assert body["withdraw"] is False
    assert body["probe_error"] is False
    sfox.aclose.assert_awaited_once()


@pytest.mark.parametrize("status", [401, 403])
def test_sfox_probe_auth_dead_is_honestly_scopeless_not_probe_error(client, status):
    from services.sfox_client import SfoxApiError

    sfox = MagicMock()
    sfox.get_balances = AsyncMock(side_effect=SfoxApiError(status, "unauthorized"))
    sfox.aclose = AsyncMock()

    r = _probe(client, sfox, create_exchange_spy=MagicMock())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["read"] is False
    assert body["trade"] is False
    assert body["withdraw"] is False
    # An auth-dead key is honestly scopeless — NOT a probe error.
    assert body["probe_error"] is False
    sfox.aclose.assert_awaited_once()


@pytest.mark.parametrize("status", [429, 500, 0])
def test_sfox_probe_transient_fails_closed_probe_error(client, status):
    from services.sfox_client import SfoxApiError

    sfox = MagicMock()
    sfox.get_balances = AsyncMock(side_effect=SfoxApiError(status, "upstream"))
    sfox.aclose = AsyncMock()

    r = _probe(client, sfox, create_exchange_spy=MagicMock())

    assert r.status_code == 200, r.text
    body = r.json()
    # Fail CLOSED: probe_error True, never a false read/trade/withdraw grant.
    assert body["probe_error"] is True
    assert body["read"] is False
    assert body["trade"] is False
    assert body["withdraw"] is False
    sfox.aclose.assert_awaited_once()
