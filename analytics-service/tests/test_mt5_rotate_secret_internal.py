"""164.5.3 / MT5CREDS Plan 03, D-04 — POST /internal/keys/{key_id}/rotate-secret
(routers/internal.py::rotate_key_secret).

This is the ONLY place in the phase that touches a live credential in
plaintext. No test in this file ever writes a real credential or a
credential-shaped literal — every login/password/broker-server value below is
a synthetic placeholder, and the SAME synthetic placeholders are asserted
ABSENT from every response body (never merely "asserted equal" — an equality
assertion against a placeholder that happens to also appear in a log line
would pass vacuously).

Mirrors test_mt5_internal_probe.py's fixture/monkeypatch conventions: a fresh
FastAPI app + TestClient per test, `_reset_rate_limit()` between cases, and
patching every collaborator at the name it is imported into `routers.internal`
(not at its original module) — the same patch-target discipline that file
documents.

Regression gates (Rule 9 — WHY each case matters):
  - Task 1 (happy path): decrypt -> validate the NEW password against the
    UNCHANGED login/server -> re-encrypt -> return ciphertext + login. Proves
    D-03 (login/server never accepted from the caller) and the response-body
    non-leak (T-164.5.3-06) non-vacuously — by asserting the exact old/new
    password strings are absent from the serialized response, not merely that
    a field name is missing.
  - Task 1 (403/404/422 gates): each must fire BEFORE any decrypt is
    attempted — proven with a not-called assertion on the decrypt mock, not
    just a status-code check, which is what actually pins D-04's ordering
    claim rather than an implementation detail that happens to match it today.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.internal import router, _reset_rate_limit

# Synthetic placeholders only — never a real MT5 login, password or broker
# server. See the phase's non-negotiable rule (CONTEXT.md) and the module
# docstring above.
_SYNTH_LOGIN = "9999999"
_SYNTH_OLD_PASSWORD = "synthetic-old-password-placeholder"  # noqa: S105 (test fixture, not a secret)
_SYNTH_NEW_PASSWORD = "synthetic-new-password-placeholder"  # noqa: S105
_SYNTH_BROKER_SERVER = "Synthetic-Demo-Server"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    _reset_rate_limit()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _headers() -> dict:
    return {"x-internal-token": "test-token"}


def _supabase_with_row(row: dict | None) -> MagicMock:
    """A supabase mock returning the given `api_keys` row (or None for an
    unknown key_id) — mirrors test_mt5_internal_probe.py's
    `_supabase_with_mt5_key` helper."""
    fake = MagicMock()
    chain = fake.table.return_value.select.return_value.eq.return_value.maybe_single.return_value
    chain.execute.return_value = MagicMock(data=row)
    return fake


def _mt5_row(key_id: str = "key-mt5") -> dict:
    return {"id": key_id, "exchange": "mt5", "is_active": True}


# ---------------------------------------------------------------------------
# Task 1: happy path
# ---------------------------------------------------------------------------


def test_rotate_secret_happy_path_returns_ciphertext_and_login_never_passwords(client):
    encrypted_fields = {
        "api_key_encrypted": "ciphertext-blob",
        "api_secret_encrypted": None,
        "passphrase_encrypted": None,
        "dek_encrypted": "ciphertext-dek",
        "nonce": None,
        "kek_version": 1,
    }
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=(_SYNTH_LOGIN, _SYNTH_OLD_PASSWORD, _SYNTH_BROKER_SERVER),
         ) as mock_decrypt, \
         patch(
             "routers.internal._validate_mt5_key",
             new=AsyncMock(return_value={"valid": True, "read_only": True}),
         ) as mock_validate, \
         patch(
             "routers.internal.encrypt_credentials", return_value=dict(encrypted_fields)
         ) as mock_encrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 200, res.text
    body = res.json()

    # Ciphertext + non-secret login only.
    assert body["api_key_encrypted"] == "ciphertext-blob"
    assert body["dek_encrypted"] == "ciphertext-dek"
    assert body["venue_account_id"] == _SYNTH_LOGIN

    # Non-vacuous leak check: the exact synthetic old/new password strings
    # must not appear anywhere in the serialized response body.
    raw = res.text
    assert _SYNTH_OLD_PASSWORD not in raw
    assert _SYNTH_NEW_PASSWORD not in raw
    assert _SYNTH_BROKER_SERVER not in raw

    # D-03: validate is called with the UNCHANGED (decrypted) login/server and
    # the CALLER-SUPPLIED new password — never anything from the request body
    # for login/server.
    mock_validate.assert_awaited_once_with(_SYNTH_LOGIN, _SYNTH_NEW_PASSWORD, _SYNTH_BROKER_SERVER)
    mock_encrypt.assert_called_once_with(
        _SYNTH_LOGIN, _SYNTH_NEW_PASSWORD, _SYNTH_BROKER_SERVER, b"kek"
    )
    mock_decrypt.assert_called_once()


def test_rotate_secret_missing_token_returns_403_before_any_decrypt(client):
    with patch("routers.internal.get_supabase") as mock_get_supabase, \
         patch("routers.internal.decrypt_credentials") as mock_decrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 403, res.text
    mock_get_supabase.assert_not_called()
    mock_decrypt.assert_not_called()


def test_rotate_secret_wrong_token_returns_403_before_any_decrypt(client):
    with patch("routers.internal.get_supabase") as mock_get_supabase, \
         patch("routers.internal.decrypt_credentials") as mock_decrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers={"x-internal-token": "wrong-token"},
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 403, res.text
    mock_get_supabase.assert_not_called()
    mock_decrypt.assert_not_called()


def test_rotate_secret_unknown_key_returns_404_before_any_decrypt(client):
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(None)), \
         patch("routers.internal.decrypt_credentials") as mock_decrypt:
        res = client.post(
            "/internal/keys/unknown-key/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 404, res.text
    mock_decrypt.assert_not_called()


def test_rotate_secret_non_mt5_exchange_returns_422_before_any_decrypt(client):
    row = {"id": "key-ccxt", "exchange": "binance", "is_active": True}
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(row)), \
         patch("routers.internal.decrypt_credentials") as mock_decrypt:
        res = client.post(
            "/internal/keys/key-ccxt/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 422, res.text
    mock_decrypt.assert_not_called()
