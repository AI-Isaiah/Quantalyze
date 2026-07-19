"""SFOX-05 (F2) — the sfox branch of the internal live-key permission probe
(routers/internal.py::get_key_permissions).

sFOX is NOT a ccxt exchange: create_exchange RAISES ValueError for it, which the
ccxt path maps to a misleading 400/502 at the finalize-wizard permission probe
(the phase-119 F2 misdirection). The sfox branch instead probes via the GET-only
SfoxClient and returns the HONEST structural read-only triple.

Regression gates (Rule 9 — WHY each case matters):
  - SFOX_ENABLED unset → the founder go-live gate returns 400 BEFORE any live read
    (parity with routers/exchange.validate_key + process_key; the DB CHECK admits
    'sfox' unconditionally, so a stored sfox key must not trigger a prod probe).
  - success → the STRUCTURAL read-only triple {read:True, trade:False,
    withdraw:False, probe_error:False}. sFOX has no scope endpoint and no
    trade/withdraw surface, so a successful auth+read proof is honestly read-only.
  - 401/403 → DEFINITIVE auth rejection {read:False, probe_error:False} —
    consistent with routers/exchange._validate_sfox_key (401/403 → AUTH_FAILED);
    the exchange answered, so it is scopeless, NOT a network/"could not contact"
    state. 429/5xx/shape(0) → fail CLOSED transient {probe_error:True} (no clear
    answer about the key), the ccxt _FAIL_CLOSED semantics.
  - an empty/whitespace credential and a client-construction ValueError both fail
    CLOSED {probe_error:True}, never an unhandled 500 at the finalize-wizard probe.
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
    monkeypatch.setenv("SFOX_ENABLED", "true")  # go-live gate on (see disabled test)
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
         patch("services.sfox_factory.make_sfox_client", return_value=sfox_client), \
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


# 401/403 → DEFINITIVE auth rejection (probe_error:False), parity with
# _validate_sfox_key. The exchange answered rejecting the key → honestly scopeless,
# never a misleading "could not contact the exchange" at the finalize probe.
@pytest.mark.parametrize("status", [401, 403])
def test_sfox_probe_auth_rejection_is_definitive_scopeless(client, status):
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
    # Definitive (the exchange answered) — NOT a probe_error/network state.
    assert body["probe_error"] is False
    sfox.aclose.assert_awaited_once()


# 429 / 5xx / shape(0) → fail CLOSED transient (probe_error:True): no clear answer
# about the key, so never cached as a scope fact and never a false grant.
@pytest.mark.parametrize("status", [429, 500, 0])
def test_sfox_probe_transient_upstream_fails_closed_probe_error(client, status):
    from services.sfox_client import SfoxApiError

    sfox = MagicMock()
    sfox.get_balances = AsyncMock(side_effect=SfoxApiError(status, "upstream"))
    sfox.aclose = AsyncMock()

    r = _probe(client, sfox, create_exchange_spy=MagicMock())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["probe_error"] is True
    assert body["read"] is False
    assert body["trade"] is False
    assert body["withdraw"] is False
    sfox.aclose.assert_awaited_once()


def test_sfox_probe_gate_blocks_live_read_when_disabled(client, monkeypatch):
    """SFOX_ENABLED unset ⇒ 400 BEFORE any live read (the founder go-live gate).
    make_sfox_client must never be constructed, so no prod token ever leaves."""
    monkeypatch.delenv("SFOX_ENABLED", raising=False)
    sfox = MagicMock()
    sfox.get_balances = AsyncMock(return_value=[])
    sfox.aclose = AsyncMock()
    factory = MagicMock(
        side_effect=AssertionError("make_sfox_client must NOT run when disabled")
    )
    with patch("services.sfox_factory.make_sfox_client", new=factory):
        r = _probe(client, sfox, create_exchange_spy=MagicMock())
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "sFOX integration is not yet available."
    sfox.get_balances.assert_not_awaited()


def test_sfox_probe_empty_credential_fails_closed_not_500(client):
    """A whitespace-only decrypted credential fails CLOSED (probe_error) BEFORE
    SfoxClient construction — never the empty-key ValueError as an unhandled 500."""
    sfox = MagicMock()
    sfox.aclose = AsyncMock()
    with patch("routers.internal.get_supabase", return_value=_supabase_with_sfox_key()), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch("routers.internal.decrypt_credentials", return_value=("   ", "", None)), \
         patch(
             "services.sfox_factory.make_sfox_client",
             new=MagicMock(side_effect=AssertionError("must not construct on empty key")),
         ), \
         patch("routers.internal.create_exchange", new=MagicMock()):
        r = client.post("/internal/keys/key-sfox/permissions", headers=_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["probe_error"] is True
    assert body["read"] is False


def test_sfox_probe_construction_valueerror_fails_closed_not_500(client):
    """A make_sfox_client / SfoxClient ctor ValueError (e.g. bad proxy URL) fails
    CLOSED as probe_error, not an unhandled 500 escaping the branch."""
    factory = MagicMock(side_effect=ValueError("bad WORKER_EGRESS_PROXY_URL"))
    with patch("routers.internal.get_supabase", return_value=_supabase_with_sfox_key()), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch("routers.internal.decrypt_credentials", return_value=("tok", "", None)), \
         patch("services.sfox_factory.make_sfox_client", new=factory), \
         patch("routers.internal.create_exchange", new=MagicMock()):
        r = client.post("/internal/keys/key-sfox/permissions", headers=_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["probe_error"] is True
    assert body["read"] is False
