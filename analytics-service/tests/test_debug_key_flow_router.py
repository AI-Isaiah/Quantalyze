"""Phase 16 / OBSERV-07 — unit tests for analytics-service/routers/debug_key_flow.py.

Asserted invariants:
  1. Missing X-Internal-Token returns 401.
  2. Wrong X-Internal-Token returns 401 (timing-safe).
  3. Missing INTERNAL_API_TOKEN env returns 503.
  4. Missing DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET} env returns 503.
  5. Valid token + present creds returns StepResponse with status=ok or status=error
     (never raises uncaught).
  6. Phase 18 wiring (Day-2 #13 + #14): validate_key invokes
     services.exchange.validate_key_permissions; fetch_trades invokes
     ccxt.exchange.fetch_my_trades. Mocks prove the call paths.
  7. Exchanges are explicitly closed in `finally` blocks.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.debug_key_flow import router


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _stub_creds(monkeypatch, broker: str, *, with_passphrase: bool = False) -> None:
    upper = broker.upper()
    monkeypatch.setenv(f"DEBUG_KEY_FLOW_{upper}_KEY", f"raw-{upper}-key")
    monkeypatch.setenv(f"DEBUG_KEY_FLOW_{upper}_SECRET", f"raw-{upper}-secret")
    if with_passphrase:
        monkeypatch.setenv(f"DEBUG_KEY_FLOW_{upper}_PASSPHRASE", f"raw-{upper}-pass")
    else:
        monkeypatch.delenv(f"DEBUG_KEY_FLOW_{upper}_PASSPHRASE", raising=False)


def _make_mock_exchange() -> MagicMock:
    """Build a stub ccxt-like exchange whose async methods return canned data."""
    ex = MagicMock()
    ex.id = "okx"
    ex.fetch_my_trades = AsyncMock(return_value=[])
    ex.close = AsyncMock(return_value=None)
    ex.set_sandbox_mode = MagicMock()
    return ex


def test_missing_header_returns_401(client):
    r = client.post("/internal/debug-key-flow/validate", json={"broker": "okx"})
    assert r.status_code == 401


def test_wrong_token_returns_401(client):
    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "wrong"},
    )
    assert r.status_code == 401


def test_missing_internal_token_env_returns_503(monkeypatch, client):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "anything"},
    )
    assert r.status_code == 503


def test_missing_creds_env_returns_503(monkeypatch, client):
    monkeypatch.delenv("DEBUG_KEY_FLOW_OKX_KEY", raising=False)
    monkeypatch.delenv("DEBUG_KEY_FLOW_OKX_SECRET", raising=False)
    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 503


def test_validate_invokes_validate_key_permissions(monkeypatch, client):
    """Phase 18 #13/#14 — validate step calls real broker SDK path."""
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    mock_exchange = _make_mock_exchange()
    create_calls: list[tuple] = []

    def fake_create(broker, key, secret, passphrase=None):
        create_calls.append((broker, key, secret, passphrase))
        return mock_exchange

    fake_validate = AsyncMock(return_value={"valid": True, "read_only": True})

    monkeypatch.setattr("routers.debug_key_flow.create_exchange", fake_create)
    monkeypatch.setattr("routers.debug_key_flow.validate_key_permissions", fake_validate)

    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["step"] == "validate_key"
    assert body["status"] == "ok"
    assert body["detail"]["broker"] == "okx"
    assert body["detail"]["valid"] is True

    assert create_calls == [("okx", "raw-OKX-key", "raw-OKX-secret", "raw-OKX-pass")]
    fake_validate.assert_awaited_once_with(mock_exchange)
    mock_exchange.close.assert_awaited_once()


def test_validate_returns_error_when_permissions_invalid(monkeypatch, client):
    _stub_creds(monkeypatch, "binance")
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )
    monkeypatch.setattr(
        "routers.debug_key_flow.validate_key_permissions",
        AsyncMock(return_value={
            "valid": False,
            "error": "AuthenticationError: bad signature",
            "error_code": "AUTH_FAILED",
        }),
    )

    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "binance"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200  # FastAPI handler always returns 200 with structured payload
    body = r.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "AUTH_FAILED"
    assert "bad signature" in body["error"]["human_message"]
    mock_exchange.close.assert_awaited_once()


def test_validate_closes_exchange_on_exception(monkeypatch, client):
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )
    monkeypatch.setattr(
        "routers.debug_key_flow.validate_key_permissions",
        AsyncMock(side_effect=RuntimeError("ccxt blew up")),
    )

    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "RuntimeError"
    mock_exchange.close.assert_awaited_once()


def test_encrypt_step_returns_field_lengths(monkeypatch, client):
    _stub_creds(monkeypatch, "binance")
    r = client.post(
        "/internal/debug-key-flow/encrypt",
        json={"broker": "binance"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["step"] == "encrypt_key"
    assert body["status"] == "ok"
    assert body["detail"]["broker"] == "binance"
    assert body["detail"]["field_lengths"] == {
        "key": len("raw-BINANCE-key"),
        "secret": len("raw-BINANCE-secret"),
    }


def test_fetch_trades_invokes_fetch_my_trades(monkeypatch, client):
    """Phase 18 #14 — fetch-trades step calls ccxt.exchange.fetch_my_trades."""
    _stub_creds(monkeypatch, "bybit")
    mock_exchange = _make_mock_exchange()
    mock_exchange.fetch_my_trades = AsyncMock(return_value=[
        {"timestamp": 1700000000000, "symbol": "BTC/USDT"},
    ])
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )

    r = client.post(
        "/internal/debug-key-flow/fetch-trades",
        json={"broker": "bybit"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["step"] == "fetch_trades"
    assert body["status"] == "ok"
    assert body["detail"] == {
        "broker": "bybit",
        "symbol": "BTC/USDT",
        "fetched": 1,
        "first_ts": 1700000000000,
    }
    mock_exchange.fetch_my_trades.assert_awaited_once_with("BTC/USDT", limit=5)
    mock_exchange.close.assert_awaited_once()


def test_fetch_trades_zero_fills_is_ok(monkeypatch, client):
    """Empty trade list on a fresh testnet account is still status=ok."""
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )

    r = client.post(
        "/internal/debug-key-flow/fetch-trades",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["detail"]["fetched"] == 0
    assert body["detail"]["first_ts"] is None


def test_validate_enables_sandbox_mode_by_default(monkeypatch, client):
    """Day-2 follow-up — testnet creds must hit the testnet endpoint, else the 4/6
    smoke fails with AuthenticationError. Default behavior: sandbox=on. The
    DEBUG_KEY_FLOW_SANDBOX env var is the explicit opt-out."""
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    monkeypatch.delenv("DEBUG_KEY_FLOW_SANDBOX", raising=False)
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )
    monkeypatch.setattr(
        "routers.debug_key_flow.validate_key_permissions",
        AsyncMock(return_value={"valid": True, "read_only": True}),
    )

    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    mock_exchange.set_sandbox_mode.assert_called_once_with(True)


def test_fetch_trades_enables_sandbox_mode_by_default(monkeypatch, client):
    _stub_creds(monkeypatch, "bybit")
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )

    r = client.post(
        "/internal/debug-key-flow/fetch-trades",
        json={"broker": "bybit"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    mock_exchange.set_sandbox_mode.assert_called_once_with(True)


def test_sandbox_mode_can_be_disabled_via_env(monkeypatch, client):
    """DEBUG_KEY_FLOW_SANDBOX=false leaves the exchange pointed at prod —
    documented escape hatch for the rare case someone wires real broker creds
    into the testnet env vars."""
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    monkeypatch.setenv("DEBUG_KEY_FLOW_SANDBOX", "false")
    mock_exchange = _make_mock_exchange()
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )
    monkeypatch.setattr(
        "routers.debug_key_flow.validate_key_permissions",
        AsyncMock(return_value={"valid": True, "read_only": True}),
    )

    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    mock_exchange.set_sandbox_mode.assert_not_called()


def test_fetch_trades_propagates_broker_error(monkeypatch, client):
    _stub_creds(monkeypatch, "okx", with_passphrase=True)
    mock_exchange = _make_mock_exchange()
    mock_exchange.fetch_my_trades = AsyncMock(
        side_effect=RuntimeError("PermissionDenied: trade scope missing"),
    )
    monkeypatch.setattr(
        "routers.debug_key_flow.create_exchange",
        lambda *a, **kw: mock_exchange,
    )

    r = client.post(
        "/internal/debug-key-flow/fetch-trades",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "RuntimeError"
    assert "PermissionDenied" in body["error"]["human_message"]
    mock_exchange.close.assert_awaited_once()
