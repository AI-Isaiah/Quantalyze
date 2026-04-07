import os
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet, InvalidToken

from services.encryption import (
    decrypt_credentials,
    encrypt_credentials,
    get_kek,
    rotate_kek,
    validate_kek_on_startup,
)


class TestEncryption:
    @pytest.fixture(autouse=True)
    def setup_kek(self):
        """Set up a test KEK for encryption tests."""
        # Fernet keys must be 32 url-safe base64-encoded bytes
        self.test_kek = Fernet.generate_key().decode()
        self.test_kek_version = "1"

    def test_round_trip(self):
        api_key = "test_api_key_12345"
        api_secret = "test_api_secret_67890"
        passphrase = "test_passphrase"

        encrypted = encrypt_credentials(api_key, api_secret, passphrase, self.test_kek)

        assert "api_key_encrypted" in encrypted
        assert "api_secret_encrypted" in encrypted
        assert "passphrase_encrypted" in encrypted
        assert encrypted["api_key_encrypted"] != api_key
        assert encrypted["api_secret_encrypted"] != api_secret

        # Decrypt
        dec_key, dec_secret, dec_pass = decrypt_credentials(encrypted, self.test_kek)
        assert dec_key == api_key
        assert dec_secret == api_secret
        assert dec_pass == passphrase

    def test_round_trip_no_passphrase(self):
        encrypted = encrypt_credentials("key", "secret", None, self.test_kek)
        dec_key, dec_secret, dec_pass = decrypt_credentials(encrypted, self.test_kek)
        assert dec_key == "key"
        assert dec_secret == "secret"
        assert dec_pass is None

    def test_different_keys_different_ciphertext(self):
        enc1 = encrypt_credentials("key", "secret", None, self.test_kek)
        enc2 = encrypt_credentials("key", "secret", None, self.test_kek)
        # Each encryption should produce different ciphertext (random DEK)
        assert enc1["api_key_encrypted"] != enc2["api_key_encrypted"]

    def test_wrong_kek_raises_invalid_token(self):
        """Tightened from generic Exception to InvalidToken — that's the
        actual cryptographic-rejection failure mode. A test that catches
        Exception passes if the function raises AttributeError on a typo;
        catching InvalidToken proves the auth check actually fired."""
        other_kek = Fernet.generate_key().decode()
        encrypted = encrypt_credentials("key", "secret", None, self.test_kek)
        with pytest.raises(InvalidToken):
            decrypt_credentials(encrypted, other_kek)

    def test_get_kek_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(RuntimeError):
                get_kek()


# ─── Module-level tests (don't need the test_kek fixture) ──────────────


def test_validate_kek_on_startup_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """validate_kek_on_startup runs at every service boot (main.py:80).
    It must not raise when KEK is a valid Fernet key."""
    valid_kek = Fernet.generate_key().decode()
    monkeypatch.setenv("KEK", valid_kek)
    # No exception expected
    validate_kek_on_startup()


def test_validate_kek_on_startup_malformed_kek_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If KEK is not a valid Fernet key (wrong length, not base64, etc.),
    the service must fail to start with a clear error. This is the
    fail-fast guarantee."""
    monkeypatch.setenv("KEK", "not-a-valid-fernet-key")
    with pytest.raises(RuntimeError, match="not a valid Fernet key"):
        validate_kek_on_startup()


def test_decrypt_detects_tampered_ciphertext() -> None:
    """The data layer of the envelope must be authenticated. If someone
    flips bits in api_key_encrypted, decryption must fail loudly. This
    test proves the AEAD guarantee at the credential ciphertext layer."""
    kek = Fernet.generate_key().decode()
    encrypted = encrypt_credentials("real_key", "real_secret", None, kek)

    # Flip the last character of the ciphertext (still valid base64 length,
    # but the auth tag won't validate)
    tampered = dict(encrypted)
    last_char = tampered["api_key_encrypted"][-1]
    new_char = "B" if last_char != "B" else "C"
    tampered["api_key_encrypted"] = tampered["api_key_encrypted"][:-1] + new_char

    with pytest.raises(InvalidToken):
        decrypt_credentials(tampered, kek)


def test_decrypt_detects_tampered_dek_wrapper() -> None:
    """The KEK layer of the envelope must also be authenticated. If
    someone flips bits in dek_encrypted (the wrapped DEK), decryption
    must fail. This proves both layers of the envelope are AEAD."""
    kek = Fernet.generate_key().decode()
    encrypted = encrypt_credentials("real_key", "real_secret", None, kek)

    tampered = dict(encrypted)
    last_char = tampered["dek_encrypted"][-1]
    new_char = "B" if last_char != "B" else "C"
    tampered["dek_encrypted"] = tampered["dek_encrypted"][:-1] + new_char

    with pytest.raises(InvalidToken):
        decrypt_credentials(tampered, kek)


def test_rotate_kek_preserves_plaintext_and_invalidates_old_kek() -> None:
    """rotate_kek is the documented key-rotation procedure. After rotation:
    1. The new KEK can decrypt the credentials
    2. The old KEK can no longer decrypt them
    3. The plaintext is unchanged
    This test is the only coverage for rotate_kek and locks in the
    rotation contract for any future operational use."""
    old_kek = Fernet.generate_key().decode()
    new_kek = Fernet.generate_key().decode()

    encrypted = encrypt_credentials("api_key_xyz", "api_secret_abc", "pass", old_kek)
    rotated_partial = rotate_kek(
        encrypted, old_kek.encode(), new_kek.encode(), new_version=2
    )

    # Build the rotated row by merging the new dek_encrypted into the original
    rotated = dict(encrypted)
    rotated["dek_encrypted"] = rotated_partial["dek_encrypted"]
    rotated["kek_version"] = rotated_partial["kek_version"]

    # New KEK decrypts successfully and produces the original plaintext
    dec_key, dec_secret, dec_pass = decrypt_credentials(rotated, new_kek)
    assert dec_key == "api_key_xyz"
    assert dec_secret == "api_secret_abc"
    assert dec_pass == "pass"
    assert rotated["kek_version"] == 2

    # Old KEK can no longer decrypt the rotated row
    with pytest.raises(InvalidToken):
        decrypt_credentials(rotated, old_kek)
