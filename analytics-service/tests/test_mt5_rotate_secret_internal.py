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
  - Task 2 (failure paths): `_validate_mt5_key`'s three MT5 failure details
    propagate UNCAUGHT with encrypt_credentials never called, and a
    KEK/decrypt failure never even reaches `_validate_mt5_key`. This is the
    non-vacuous proof that D-04's "validate BEFORE persisting, and a failed
    validation persists NOTHING" holds at every step of the chain, not just
    at the final encrypt call.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import InvalidToken
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers.internal import router, _reset_rate_limit
from services.exchange import AUTH_FAILED_DETAIL
from services.closed_sets import MT5_MASTER_PASSWORD_DETAIL, MT5_WRONG_SERVER_DETAIL

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


def _supabase_with_row_owner_scoped(
    row_without_filter: dict | None, row_with_filter: dict | None
) -> MagicMock:
    """164.5.3 fix-python (review finding 1) — a supabase mock that
    distinguishes the id-only query chain (`.eq("id", ...).maybe_single()`)
    from the id+user_id-scoped chain (`.eq("id", ...).eq("user_id",
    ...).maybe_single()`), so a test can prove the owner filter is actually
    applied rather than merely present in the source. `row_without_filter` is
    what an UNFILTERED query would return (used to catch a mutant that drops
    the filter silently); `row_with_filter` is what the real, owner-scoped
    query returns."""
    fake = MagicMock()
    id_chain = fake.table.return_value.select.return_value.eq.return_value
    id_chain.maybe_single.return_value.execute.return_value = MagicMock(
        data=row_without_filter
    )
    id_chain.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=row_with_filter
    )
    return fake


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


# ---------------------------------------------------------------------------
# 164.5.3 fix-python (review finding 1): optional, backward-compatible owner
# scoping. `test_rotate_secret_happy_path_...` above already proves the
# absent-user_id (old-caller) path is unchanged — these two prove the
# present-user_id path actually filters, in both directions.
# ---------------------------------------------------------------------------


def test_rotate_secret_with_matching_user_id_succeeds(client):
    encrypted_fields = {
        "api_key_encrypted": "ciphertext-blob",
        "api_secret_encrypted": None,
        "passphrase_encrypted": None,
        "dek_encrypted": "ciphertext-dek",
        "nonce": None,
        "kek_version": 1,
    }
    # row_without_filter=None: if the owner filter were somehow SKIPPED, the
    # id-only chain would answer with no row and this would wrongly 404 —
    # the mock cannot accidentally pass by falling back to the wrong branch.
    with patch(
        "routers.internal.get_supabase",
        return_value=_supabase_with_row_owner_scoped(
            row_without_filter=None, row_with_filter=_mt5_row()
        ),
    ), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=(_SYNTH_LOGIN, _SYNTH_OLD_PASSWORD, _SYNTH_BROKER_SERVER),
         ), \
         patch(
             "routers.internal._validate_mt5_key",
             new=AsyncMock(return_value={"valid": True, "read_only": True}),
         ), \
         patch("routers.internal.encrypt_credentials", return_value=dict(encrypted_fields)):
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD, "user_id": "owner-uuid"},
        )

    assert res.status_code == 200, res.text
    assert res.json()["venue_account_id"] == _SYNTH_LOGIN


def test_rotate_secret_with_mismatched_user_id_returns_404_before_any_decrypt(client):
    """Anti-vacuity for the owner filter: `row_without_filter` is a REAL row
    (what an unfiltered `.eq("id", ...)` query alone would return);
    `row_with_filter` is None (what the real, owner-scoped query returns for
    a caller who does not own the key). If the `if req.user_id: query =
    query.eq("user_id", ...)` line in the handler were neutered/deleted, the
    code would read the id-only chain instead, find a row, and NOT 404 —
    making the mutation observable rather than vacuous."""
    with patch(
        "routers.internal.get_supabase",
        return_value=_supabase_with_row_owner_scoped(
            row_without_filter=_mt5_row(), row_with_filter=None
        ),
    ), patch("routers.internal.decrypt_credentials") as mock_decrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD, "user_id": "someone-elses-uuid"},
        )

    assert res.status_code == 404, res.text
    mock_decrypt.assert_not_called()


# ---------------------------------------------------------------------------
# 164.5.3 fix-python (review finding 2): the probe's result is captured and
# asserted rather than discarded.
# ---------------------------------------------------------------------------


def test_rotate_secret_validate_non_success_shape_without_raising_never_encrypts(client):
    """If `_validate_mt5_key` returns without raising but NOT the success
    shape (an invariant violation this endpoint has no control over but must
    not silently trust), the handler must reject rather than proceed to
    encrypt+persist. Deleting the finding-2 guard would make this observe 200
    instead of 500 — a genuine RED, not a vacuous one."""
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=(_SYNTH_LOGIN, _SYNTH_OLD_PASSWORD, _SYNTH_BROKER_SERVER),
         ), \
         patch(
             "routers.internal._validate_mt5_key",
             new=AsyncMock(return_value={"valid": False, "read_only": True}),
         ), \
         patch("routers.internal.encrypt_credentials") as mock_encrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 500, res.text
    assert res.json()["detail"]["code"] == "MT5_VALIDATE_INVARIANT_VIOLATION"
    mock_encrypt.assert_not_called()


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


# ---------------------------------------------------------------------------
# Task 2: failure paths — nothing persists on any of them
# ---------------------------------------------------------------------------


def _rotate_with_validate_raising(client, exc: Exception):
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             return_value=(_SYNTH_LOGIN, _SYNTH_OLD_PASSWORD, _SYNTH_BROKER_SERVER),
         ), \
         patch("routers.internal._validate_mt5_key", new=AsyncMock(side_effect=exc)), \
         patch("routers.internal.encrypt_credentials") as mock_encrypt:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )
    return res, mock_encrypt


def test_rotate_secret_auth_failed_propagates_and_never_encrypts(client):
    res, mock_encrypt = _rotate_with_validate_raising(
        client, HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
    )

    assert res.status_code == 400, res.text
    assert res.json()["detail"] == AUTH_FAILED_DETAIL
    mock_encrypt.assert_not_called()


def test_rotate_secret_master_password_propagates_and_never_encrypts(client):
    res, mock_encrypt = _rotate_with_validate_raising(
        client, HTTPException(status_code=400, detail=MT5_MASTER_PASSWORD_DETAIL)
    )

    assert res.status_code == 400, res.text
    assert res.json()["detail"] == MT5_MASTER_PASSWORD_DETAIL
    mock_encrypt.assert_not_called()


def test_rotate_secret_wrong_server_propagates_and_never_encrypts(client):
    res, mock_encrypt = _rotate_with_validate_raising(
        client, HTTPException(status_code=400, detail=MT5_WRONG_SERVER_DETAIL)
    )

    assert res.status_code == 400, res.text
    assert res.json()["detail"] == MT5_WRONG_SERVER_DETAIL
    mock_encrypt.assert_not_called()


def test_rotate_secret_kek_unavailable_never_reaches_validate(client):
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", side_effect=RuntimeError("KEK missing")), \
         patch("routers.internal.decrypt_credentials") as mock_decrypt, \
         patch("routers.internal._validate_mt5_key", new=AsyncMock()) as mock_validate:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 500, res.text
    assert res.json()["detail"]["code"] == "KEK_UNAVAILABLE"
    mock_decrypt.assert_not_called()
    mock_validate.assert_not_awaited()


def test_rotate_secret_undecryptable_never_reaches_validate(client):
    # 164.5.3 fix-python (review finding 3): the except in the handler was
    # narrowed from a bare `except Exception:` to the exception types
    # `decrypt_credentials` actually raises for a genuine decrypt failure.
    # `InvalidToken` (cryptography's own — raised both explicitly for a
    # malformed row and from a Fernet.decrypt failure) is the representative
    # one; a raw `Exception("bad blob")` no longer exercises this arm, since
    # it is exactly the kind of unrelated-bug shape the narrowing means to
    # let propagate instead of mislabeling as "reconnect your key".
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             side_effect=InvalidToken("bad blob"),
         ), \
         patch("routers.internal._validate_mt5_key", new=AsyncMock()) as mock_validate:
        res = client.post(
            "/internal/keys/key-mt5/rotate-secret",
            headers=_headers(),
            json={"new_secret": _SYNTH_NEW_PASSWORD},
        )

    assert res.status_code == 500, res.text
    assert res.json()["detail"]["code"] == "KEY_UNDECRYPTABLE"
    mock_validate.assert_not_awaited()


def test_rotate_secret_undecryptable_narrowed_except_lets_unrelated_bug_propagate(client):
    """Anti-vacuity companion to the case above: a bug shape the narrowed
    except does NOT claim (e.g. a TypeError from some future signature
    mismatch) must surface as an unhandled 500, not the misleading
    KEY_UNDECRYPTABLE/"reconnect your key" envelope. Proves the narrowing in
    review finding 3 actually narrowed something, rather than merely
    reformatting the same catch-all."""
    with patch("routers.internal.get_supabase", return_value=_supabase_with_row(_mt5_row())), \
         patch("routers.internal.get_kek", return_value=b"kek"), \
         patch(
             "routers.internal.decrypt_credentials",
             side_effect=TypeError("unrelated bug, not a decrypt failure"),
         ), \
         patch("routers.internal._validate_mt5_key", new=AsyncMock()) as mock_validate:
        with pytest.raises(TypeError):
            client.post(
                "/internal/keys/key-mt5/rotate-secret",
                headers=_headers(),
                json={"new_secret": _SYNTH_NEW_PASSWORD},
            )

    mock_validate.assert_not_awaited()
