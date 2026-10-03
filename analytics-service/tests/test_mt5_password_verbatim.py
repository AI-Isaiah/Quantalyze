"""D-08 (Phase 164.6.6) — an MT5 investor password is never trimmed.

The password is user-chosen and an edge space may be part of it. The broker
compares it byte for byte, so a trim anywhere between entry and storage stores a
password the user never chose and every later login fails.

Two Python seams are pinned here, both with a space-bearing password:

  - ``services.mt5_validation.parse_mt5_credentials``: the offline parse that the
    wizard validate path (``/api/validate-key``) and the worker validate path
    both call. It returns the password verbatim and trims only login and server.
  - ``routers.exchange.encrypt_key``: the ``/api/encrypt-key`` store step of the
    wizard path. It must hand ``encrypt_credentials`` the exact secret bytes that
    ``analytics-client.ts::encryptKey`` sends, which since D-08 are the bytes the
    user entered.

Both pass at the commit that added them because neither path ever trimmed; the
plan's neuter run injected a trim at each and observed these tests go RED.

Every value below is fabricated (no real login, password or broker server).
Kept out of ``test_mt5_validate_parity.py`` and
``test_status_contract_exchange_internal.py`` so this plan stays file-disjoint
from the other plans of the phase.
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest

from services.mt5_validation import parse_mt5_credentials
from tests.limiter_stub import evict_module, patch_shared_limiter

_PADDED_LOGIN = " 5550001 "
_PADDED_PASSWORD = " Inv Pw 7 "  # noqa: S105 (fabricated test fixture, not a secret)
_PADDED_SERVER = " Example-Demo "


def test_parse_mt5_credentials_d08_returns_a_space_bearing_password_verbatim():
    login, password, server = parse_mt5_credentials(
        _PADDED_LOGIN, _PADDED_PASSWORD, _PADDED_SERVER
    )

    assert (login, password, server) == (5550001, _PADDED_PASSWORD, "Example-Demo"), (
        "the login and broker server are trimmed (the v1.11 credential-trim "
        "convention); the password is not"
    )
    assert password == _PADDED_PASSWORD, (
        "D-08: the investor password must come back byte for byte. A trim here "
        "would validate a password other than the one the user chose, on both the "
        "wizard and the worker validate paths."
    )


@pytest.fixture()
def exchange_router(monkeypatch):
    """``routers.exchange`` with slowapi stubbed (no-op Limiter) so the handler
    can be awaited directly. Cloned from
    ``test_status_contract_exchange_internal.py``'s fixture of the same name,
    not imported from it (another plan of this phase edits that file)."""

    class _NoopLimiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            def decorator(fn):
                return fn

            return decorator

    slowapi_stub = MagicMock()
    slowapi_stub.Limiter = _NoopLimiter
    slowapi_util_stub = MagicMock()
    slowapi_util_stub.get_remote_address = lambda *a, **k: "1.2.3.4"

    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)
    # PYAPI-03: the router imports the limiter SINGLETON, so stub the instance
    # too, before the re-import below. See tests/limiter_stub.py.
    patch_shared_limiter(monkeypatch)

    monkeypatch.setenv("MT5_ENABLED", "true")

    evict_module("routers.exchange")
    from routers import exchange as router

    yield router

    evict_module("routers.exchange")


async def test_encrypt_key_d08_stores_a_space_bearing_mt5_password_verbatim(
    exchange_router, monkeypatch
):
    router = exchange_router
    encrypt = MagicMock(
        return_value={
            "api_key_encrypted": "ciphertext-blob",
            "api_secret_encrypted": None,
            "passphrase_encrypted": None,
            "dek_encrypted": "ciphertext-dek",
            "nonce": None,
            "kek_version": 1,
        }
    )
    monkeypatch.setattr(router, "get_kek", MagicMock(return_value=b"kek"))
    monkeypatch.setattr(router, "encrypt_credentials", encrypt)

    # Built THROUGH the model, so a future strip config on EncryptKeyRequest
    # also fails this test.
    req = router.EncryptKeyRequest(
        exchange="mt5",
        api_key="5550001",
        api_secret=_PADDED_PASSWORD,
        passphrase="Example-Demo",
    )
    await router.encrypt_key(MagicMock(name="request"), req)

    assert encrypt.call_count == 1, "encrypt_key must encrypt exactly once"
    assert encrypt.call_args.args == ("5550001", _PADDED_PASSWORD, "Example-Demo", b"kek"), (
        "D-08: this is the store step of the wizard path. A trim here would store "
        "a password other than the one /api/validate-key just accepted, and every "
        "later sync would fail against the broker."
    )
