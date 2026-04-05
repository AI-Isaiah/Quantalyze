import pytest
from services.exchange import create_exchange, validate_key_permissions


class TestCreateExchange:
    def test_supported_exchanges(self):
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "key", "secret")
            assert exchange is not None
            assert exchange.id == name

    def test_unsupported_exchange_raises(self):
        with pytest.raises(ValueError, match="Unsupported"):
            create_exchange("kraken", "key", "secret")

    def test_okx_passphrase(self):
        exchange = create_exchange("okx", "key", "secret", "passphrase")
        assert exchange.password == "passphrase"

    def test_binance_no_passphrase(self):
        exchange = create_exchange("binance", "key", "secret")
        assert not exchange.password  # empty string or None


class TestValidateKeyPermissions:
    @pytest.mark.asyncio
    async def test_invalid_credentials_returns_auth_error(self):
        """Invalid API credentials should return an error, not crash."""
        exchange = create_exchange("binance", "invalid-key", "invalid-secret")
        result = await validate_key_permissions(exchange)
        # Should have an error message, not crash
        assert result["error"] is not None
        assert result["valid"] is False

    @pytest.mark.asyncio
    async def test_result_structure(self):
        """validate_key_permissions always returns a dict with valid, read_only, error."""
        exchange = create_exchange("binance", "test", "test")
        result = await validate_key_permissions(exchange)
        assert "valid" in result
        assert "read_only" in result
        assert "error" in result

    @pytest.mark.asyncio
    async def test_all_exchanges_handle_bad_keys(self):
        """Every supported exchange should handle bad credentials gracefully."""
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "bad-key", "bad-secret", "bad-pass")
            result = await validate_key_permissions(exchange)
            # Must not crash, must return error
            assert result["error"] is not None, f"{name} did not return error for bad keys"
            assert isinstance(result["error"], str)
