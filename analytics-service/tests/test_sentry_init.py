"""Phase 16 / OBSERV-04 + OBSERV-05 — unit tests for analytics-service/sentry_init.py.

Asserted invariants:
  1. _PII_KEYS contains the 8 base keys + broker signing headers (FIX 7).
  2. _PII_KEY_PREFIXES contains sb-ec- (FIX 7).
  3. _JWT_SHAPE detects JWT-shaped values regardless of key name (FIX 7).
  4. _redact_before_send redacts denylist keys case-insensitively in request.headers AND extra.
  5. _redact_before_send returns the event unmodified on any internal exception (Pitfall 6).
  6. init_sentry() is a no-op when SENTRY_DSN unset.
  7. init_sentry() calls sentry_sdk.init with the canonical kwargs when SENTRY_DSN set.
"""

from __future__ import annotations

import sentry_init


class TestPIIDenylist:
    def test_denylist_contains_8_base_keys(self):
        base_keys = {
            "apikey", "apisecret", "secret", "signature",
            "passphrase", "authorization", "x-mbx-apikey", "ok-access-sign",
        }
        assert base_keys.issubset(sentry_init._PII_KEYS)

    def test_denylist_contains_bybit_v5_signing_headers(self):
        bybit = {
            "x-bapi-api-key", "x-bapi-sign", "x-bapi-timestamp",
            "x-bapi-recv-window", "x-bapi-sign-type",
        }
        assert bybit.issubset(sentry_init._PII_KEYS)

    def test_denylist_contains_okx_extras(self):
        okx = {"ok-access-passphrase", "ok-access-key", "ok-access-timestamp"}
        assert okx.issubset(sentry_init._PII_KEYS)

    def test_denylist_contains_binance_extras(self):
        assert "x-mbx-time-unit" in sentry_init._PII_KEYS

    def test_denylist_prefix_sb_ec(self):
        assert "sb-ec-" in sentry_init._PII_KEY_PREFIXES

    def test_jwt_shape_matches_canonical_jwt(self):
        sample = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ"
            ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
        assert sentry_init._JWT_SHAPE.match(sample) is not None


class TestRedactBeforeSend:
    def test_redacts_authorization_header_case_insensitive(self):
        event = {"request": {"headers": {"Authorization": "Bearer xyz", "X-Custom": "ok"}}}
        result = sentry_init._redact_before_send(event, None)
        assert result["request"]["headers"]["Authorization"] == "[REDACTED]"
        assert result["request"]["headers"]["X-Custom"] == "ok"

    def test_redacts_extra_apikey_and_ok_access_sign(self):
        event = {"extra": {"apikey": "leaky", "ok-access-sign": "leaky", "user_id": "preserved"}}
        result = sentry_init._redact_before_send(event, None)
        assert result["extra"]["apikey"] == "[REDACTED]"
        assert result["extra"]["ok-access-sign"] == "[REDACTED]"
        assert result["extra"]["user_id"] == "preserved"

    def test_redacts_jwt_shaped_value_regardless_of_key_name(self):
        # FIX 7: JWT detector must replace the value even if key name is benign.
        jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            ".eyJzdWIiOiIxMjM0NTY3ODkwIn0"
            ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
        event = {"extra": {"auth_token": jwt, "user_id": "preserved"}}
        result = sentry_init._redact_before_send(event, None)
        assert result["extra"]["auth_token"] == "[JWT-REDACTED]"
        assert result["extra"]["user_id"] == "preserved"

    def test_redacts_sb_ec_prefixed_cookie_keys(self):
        # FIX 7: prefix match against pii-scrub.ts L27 DENYLIST_PREFIX.
        event = {"request": {"cookies": {"sb-ec-session": "value", "harmless": "ok"}}}
        result = sentry_init._redact_before_send(event, None)
        assert result["request"]["cookies"]["sb-ec-session"] == "[REDACTED]"
        assert result["request"]["cookies"]["harmless"] == "ok"

    def test_redacts_broker_specific_signing_headers(self):
        # FIX 7: Bybit + OKX extras + Binance extras all redacted.
        event = {"request": {"headers": {
            "x-bapi-sign": "abc",
            "ok-access-passphrase": "xyz",
            "x-mbx-time-unit": "1",
            "X-Harmless": "ok",
        }}}
        result = sentry_init._redact_before_send(event, None)
        assert result["request"]["headers"]["x-bapi-sign"] == "[REDACTED]"
        assert result["request"]["headers"]["ok-access-passphrase"] == "[REDACTED]"
        assert result["request"]["headers"]["x-mbx-time-unit"] == "[REDACTED]"
        assert result["request"]["headers"]["X-Harmless"] == "ok"

    def test_handles_empty_event(self):
        assert sentry_init._redact_before_send({}, None) == {}

    def test_pitfall_6_never_raises_on_malformed_event(self):
        event = {"request": "not-a-dict"}
        result = sentry_init._redact_before_send(event, None)
        assert result == event


class TestInitSentry:
    def test_noop_when_dsn_unset(self, monkeypatch):
        called = []
        monkeypatch.delenv("SENTRY_DSN", raising=False)
        monkeypatch.setattr(
            "sentry_init.sentry_sdk.init",
            lambda **kwargs: called.append(kwargs),
        )
        sentry_init.init_sentry()
        assert called == []

    def test_inits_with_canonical_kwargs_when_dsn_set(self, monkeypatch):
        captured: dict = {}
        monkeypatch.setenv("SENTRY_DSN", "https://example@sentry.io/1")
        monkeypatch.setattr(
            "sentry_init.sentry_sdk.init",
            lambda **kwargs: captured.update(kwargs),
        )
        sentry_init.init_sentry()
        assert captured["traces_sample_rate"] == 0.1
        assert captured["send_default_pii"] is False
        assert captured["before_send"] is sentry_init._redact_before_send
        integration_types = [type(i).__name__ for i in captured["integrations"]]
        assert "FastApiIntegration" in integration_types
        assert "StarletteIntegration" in integration_types
