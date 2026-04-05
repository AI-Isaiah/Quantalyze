import pytest
import os
from unittest.mock import patch
from services.encryption import encrypt_credentials, decrypt_credentials, get_kek


class TestEncryption:
    @pytest.fixture(autouse=True)
    def setup_kek(self):
        """Set up a test KEK for encryption tests."""
        # Fernet keys must be 32 url-safe base64-encoded bytes
        from cryptography.fernet import Fernet
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

    def test_wrong_kek_fails(self):
        from cryptography.fernet import Fernet
        other_kek = Fernet.generate_key().decode()
        encrypted = encrypt_credentials("key", "secret", None, self.test_kek)
        with pytest.raises(Exception):
            decrypt_credentials(encrypted, other_kek)

    def test_get_kek_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(RuntimeError):
                get_kek()
