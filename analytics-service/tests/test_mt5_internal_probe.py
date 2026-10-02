"""MT5-13 — the mt5 branch of the internal live-key permission probe
(routers/internal.py::get_key_permissions).

mt5 is NOT a ccxt exchange, and until this branch existed it had no arm here at
all: it fell through to create_exchange, which raises ValueError("Unsupported
exchange: mt5") -> 400 -> finalize-wizard rendered EVERY probe failure as
KEY_NETWORK_TIMEOUT. A permanent unsupported-venue condition was therefore sold
to the user as a transient one, on a route that fires on every submit, so MT5
strategies could not be finalized at all and the retry the copy invited could
never work. This is the sfox branch's twin (test_sfox_internal_probe.py) and
these gates mirror it.

Regression gates (Rule 9 — WHY each case matters):
  - an mt5 key returns the STRUCTURAL read-only triple. Read-only is structural
    twice over: Mt5Client composes read methods + order_check only (no trade
    surface, no __getattr__ passthrough), and the stored credential was already
    proven investor-only behaviourally at connect by
    routers/exchange._validate_mt5_key, which rejects a master login. An MT5
    investor password cannot be promoted to a master one, so the
    scope-broadening threat this force_refresh probe defends against has no MT5
    instance.
  - create_exchange is NEVER called for mt5. This is the gate that fails without
    the fix — the ccxt path is precisely what produced the misleading 400.
  - NO live gateway round-trip: the probe answers with MT5_GATEWAY_HOST unset,
    which it could not do if it opened an RPyC session. Deliberate — an RPyC
    login switches the ONE shared terminal onto this account (the MT5CONC-02
    hazard the worker serialises behind a single lock) and would buy zero scope
    information, since the answer is fixed by construction.
  - force_refresh=true (the finalize-wizard call shape) takes the same branch,
    because that is the caller that was blocked.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.internal import router, _reset_rate_limit


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    # Deliberately UNSET: if the branch ever grows a live gateway round-trip,
    # these tests start failing on the server-misconfig arm rather than passing
    # silently with a hidden RPyC dependency.
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)
    monkeypatch.delenv("MT5_GATEWAY_PORT", raising=False)
    _reset_rate_limit()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _supabase_with_mt5_key() -> MagicMock:
    """A supabase mock returning an active mt5 api_keys row + a no-op audit
    insert (the route inserts key_permission_audit best-effort)."""
    fake = MagicMock()

    def _table(name: str):
        tbl = MagicMock()
        if name == "api_keys":
            chain = tbl.select.return_value.eq.return_value.maybe_single.return_value
            chain.execute.return_value = MagicMock(
                data={"id": "key-mt5", "exchange": "mt5", "is_active": True}
            )
        else:  # key_permission_audit insert
            tbl.insert.return_value.execute.return_value = MagicMock(data=[{"id": 1}])
        return tbl

    fake.table.side_effect = _table
    return fake


def _headers() -> dict:
    return {"x-internal-token": "test-token"}


def _probe(client, *, url: str):
    """Drive the route with the mt5 credential seams patched. The MT5 credential
    slots are reused (login -> api_key, investor password -> api_secret, broker
    server -> passphrase); the branch reads none of them, which is the point."""
    spy = MagicMock(side_effect=AssertionError("create_exchange must NOT run for mt5"))
    with patch("routers.internal.get_supabase", return_value=_supabase_with_mt5_key()), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=("123456", "investor-pw", "Broker-Server"),
         ), \
         patch("routers.internal.create_exchange", new=spy):
        res = client.post(url, headers=_headers())
    return res, spy


def test_mt5_probe_returns_structural_readonly_triple(client):
    res, spy = _probe(client, url="/internal/keys/key-mt5/permissions")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["read"] is True
    assert body["trade"] is False
    assert body["withdraw"] is False
    assert body["probe_error"] is False
    assert body["detected_at"]
    # The gate that fails without the branch: the ccxt path is what produced the
    # misleading 400 the wizard then mislabelled as a network timeout.
    spy.assert_not_called()


def test_mt5_probe_force_refresh_takes_the_same_branch(client):
    """finalize-wizard always passes force_refresh=true — the caller that was
    blocked. A branch that only answered the cached call shape would leave the
    actual defect live."""
    res, spy = _probe(
        client, url="/internal/keys/key-mt5/permissions?force_refresh=true"
    )

    assert res.status_code == 200, res.text
    assert res.json()["trade"] is False
    spy.assert_not_called()
