import os
import json
from cryptography.fernet import Fernet


def get_kek() -> bytes:
    """Get the Key Encryption Key from environment."""
    kek = os.getenv("KEK")
    if not kek:
        raise RuntimeError("KEK environment variable is required for encryption")
    return kek.encode()


def get_kek_version() -> int:
    """Get the current KEK version for tracking rotation."""
    return int(os.getenv("KEK_VERSION", "1"))


def generate_dek() -> bytes:
    """Generate a new Data Encryption Key."""
    return Fernet.generate_key()


def encrypt_credentials(
    api_key: str,
    api_secret: str,
    passphrase: str | None,
    kek: bytes,
) -> dict:
    """Encrypt exchange credentials using envelope encryption.

    1. Generate a unique DEK for this key pair
    2. Encrypt the credentials with the DEK
    3. Encrypt the DEK with the KEK
    """
    dek = generate_dek()
    data_cipher = Fernet(dek)
    kek_cipher = Fernet(kek)

    payload = json.dumps({
        "api_key": api_key,
        "api_secret": api_secret,
        "passphrase": passphrase,
    }).encode()

    encrypted_data = data_cipher.encrypt(payload)
    encrypted_dek = kek_cipher.encrypt(dek)

    return {
        "api_key_encrypted": encrypted_data.decode(),
        "api_secret_encrypted": "",  # All credentials in single encrypted blob
        "passphrase_encrypted": None,
        "dek_encrypted": encrypted_dek.decode(),
        "nonce": "",  # Fernet handles nonce internally
        "kek_version": get_kek_version(),
    }


def decrypt_credentials(
    encrypted_row: dict,
    kek: bytes,
) -> tuple[str, str, str | None]:
    """Decrypt exchange credentials.

    1. Decrypt the DEK with the KEK
    2. Decrypt the credentials with the DEK
    """
    kek_cipher = Fernet(kek)
    dek = kek_cipher.decrypt(encrypted_row["dek_encrypted"].encode())

    data_cipher = Fernet(dek)
    payload = json.loads(
        data_cipher.decrypt(encrypted_row["api_key_encrypted"].encode())
    )

    return payload["api_key"], payload["api_secret"], payload.get("passphrase")


def rotate_kek(
    encrypted_row: dict,
    old_kek: bytes,
    new_kek: bytes,
    new_version: int,
) -> dict:
    """Re-encrypt the DEK with a new KEK. Data stays untouched."""
    old_cipher = Fernet(old_kek)
    dek = old_cipher.decrypt(encrypted_row["dek_encrypted"].encode())

    new_cipher = Fernet(new_kek)
    new_encrypted_dek = new_cipher.encrypt(dek)

    return {
        "dek_encrypted": new_encrypted_dek.decode(),
        "kek_version": new_version,
    }
