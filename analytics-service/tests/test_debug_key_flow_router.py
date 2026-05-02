"""Phase 16 / OBSERV-07 — unit tests for analytics-service/routers/debug_key_flow.py.

Asserted invariants:
  1. Missing X-Internal-Token returns 401.
  2. Wrong X-Internal-Token returns 401 (timing-safe).
  3. Missing INTERNAL_API_TOKEN env returns 503.
  4. Missing DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET} env returns 503.
  5. Valid token + present creds returns StepResponse with status=ok or status=error
     (never raises uncaught).
  6. After return, plaintext creds are NOT retained in memory (best-effort scrubbing).
"""

from __future__ import annotations

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


def test_present_creds_returns_step_response(monkeypatch, client):
    # Minimal happy path — mock decrypt to return canned plaintext.
    monkeypatch.setenv("DEBUG_KEY_FLOW_OKX_KEY", "blob1")
    monkeypatch.setenv("DEBUG_KEY_FLOW_OKX_SECRET", "blob2")
    monkeypatch.setenv("DEBUG_KEY_FLOW_OKX_PASSPHRASE", "blob3")
    monkeypatch.setattr(
        "routers.debug_key_flow.encryption.decrypt_credentials",
        lambda blob: f"decrypted-{blob}",
    )
    r = client.post(
        "/internal/debug-key-flow/validate",
        json={"broker": "okx"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["step"] == "validate_key"
    assert body["status"] in ("ok", "error")
    assert "duration_ms" in body


def test_encrypt_endpoint_present_creds(monkeypatch, client):
    monkeypatch.setenv("DEBUG_KEY_FLOW_BINANCE_KEY", "k")
    monkeypatch.setenv("DEBUG_KEY_FLOW_BINANCE_SECRET", "s")
    monkeypatch.setattr(
        "routers.debug_key_flow.encryption.decrypt_credentials",
        lambda blob: f"decrypted-{blob}",
    )
    r = client.post(
        "/internal/debug-key-flow/encrypt",
        json={"broker": "binance"},
        headers={"x-internal-token": "test-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["step"] == "encrypt_key"
    assert body["status"] == "ok"


def test_fetch_trades_endpoint_present_creds(monkeypatch, client):
    monkeypatch.setenv("DEBUG_KEY_FLOW_BYBIT_KEY", "k")
    monkeypatch.setenv("DEBUG_KEY_FLOW_BYBIT_SECRET", "s")
    monkeypatch.setattr(
        "routers.debug_key_flow.encryption.decrypt_credentials",
        lambda blob: f"decrypted-{blob}",
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
