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


class TestPhase16ScrubPaths:
    """Phase 16 review-fix regression tests — surfaces previously NOT scrubbed
    by `_redact_before_send` even though they carry user credentials in
    practice (FastApiIntegration auto-captures POST body into request.data,
    HTTP breadcrumbs into breadcrumbs[*].data, and frame locals into
    exception.values[*].stacktrace.frames[*].vars).
    """

    def test_snake_case_api_key_in_denylist(self):
        # Wire form posted by ConnectKeyStep.tsx — must be denied.
        assert "api_key" in sentry_init._PII_KEYS
        assert "api_secret" in sentry_init._PII_KEYS

    def test_internal_token_in_denylist(self):
        # Forwarded by route.ts seam to FastAPI — must be denied so HTTP
        # breadcrumb capture does not leak it.
        assert "x-internal-token" in sentry_init._PII_KEYS

    def test_request_data_dict_is_scrubbed(self):
        # FastApiIntegration captures parsed POST body into request.data.
        event = {
            "request": {
                "data": {
                    "broker": "okx",
                    "api_key": "live-key-AAA",
                    "api_secret": "live-secret-BBB",
                    "passphrase": "live-pass-CCC",
                }
            }
        }
        result = sentry_init._redact_before_send(event, None)
        data = result["request"]["data"]
        assert data["broker"] == "okx"
        assert data["api_key"] == "[REDACTED]"
        assert data["api_secret"] == "[REDACTED]"
        assert data["passphrase"] == "[REDACTED]"

    def test_request_data_list_is_scrubbed(self):
        # Edge case: data could be a JSON array.
        event = {
            "request": {
                "data": [
                    {"api_key": "leaked-1", "ok": True},
                    {"api_secret": "leaked-2", "ok": False},
                ]
            }
        }
        result = sentry_init._redact_before_send(event, None)
        scrubbed = result["request"]["data"]
        assert scrubbed[0]["api_key"] == "[REDACTED]"
        assert scrubbed[0]["ok"] is True
        assert scrubbed[1]["api_secret"] == "[REDACTED]"

    def test_request_json_alt_key_is_scrubbed(self):
        # Some integration versions populate `request.json` instead of `data`.
        event = {"request": {"json": {"api_key": "leaked"}}}
        result = sentry_init._redact_before_send(event, None)
        assert result["request"]["json"]["api_key"] == "[REDACTED]"

    def test_breadcrumb_data_is_scrubbed(self):
        # Outbound HTTP breadcrumbs include headers + body via FastAPI hook.
        event = {
            "breadcrumbs": {
                "values": [
                    {
                        "category": "http",
                        "data": {
                            "url": "/api/strategies/create-with-key",
                            "x-internal-token": "secret-internal",
                            "headers": {"authorization": "Bearer x"},
                        },
                    },
                    {
                        "category": "default",
                        "data": {"api_key": "leaked-from-form-crumb"},
                    },
                ]
            }
        }
        result = sentry_init._redact_before_send(event, None)
        crumbs = result["breadcrumbs"]["values"]
        assert crumbs[0]["data"]["x-internal-token"] == "[REDACTED]"
        assert crumbs[0]["data"]["headers"]["authorization"] == "[REDACTED]"
        assert crumbs[0]["data"]["url"] == "/api/strategies/create-with-key"
        assert crumbs[1]["data"]["api_key"] == "[REDACTED]"

    def test_exception_frame_vars_are_scrubbed(self):
        # Sentry default with_locals=True attaches frame vars on every captured
        # exception. Wizard endpoints define `creds`, `api_key`, `api_secret`
        # in the failing scope.
        event = {
            "exception": {
                "values": [
                    {
                        "type": "ValueError",
                        "stacktrace": {
                            "frames": [
                                {
                                    "function": "validate_key",
                                    "vars": {
                                        "broker": "okx",
                                        "api_key": "leaked-local",
                                        "creds": {
                                            "api_secret": "leaked-nested",
                                            "passphrase": "leaked-nested-2",
                                        },
                                    },
                                },
                                {
                                    "function": "outer",
                                    "vars": {"counter": 3},
                                },
                            ]
                        },
                    }
                ]
            }
        }
        result = sentry_init._redact_before_send(event, None)
        frames = result["exception"]["values"][0]["stacktrace"]["frames"]
        assert frames[0]["vars"]["broker"] == "okx"
        assert frames[0]["vars"]["api_key"] == "[REDACTED]"
        assert frames[0]["vars"]["creds"]["api_secret"] == "[REDACTED]"
        assert frames[0]["vars"]["creds"]["passphrase"] == "[REDACTED]"
        assert frames[1]["vars"]["counter"] == 3

    def test_malformed_breadcrumbs_does_not_raise(self):
        # Pitfall 6: redactor must NEVER raise. Defensive shape mismatch.
        event = {"breadcrumbs": "not-a-dict"}
        assert sentry_init._redact_before_send(event, None) == event
        event2 = {"breadcrumbs": {"values": "not-a-list"}}
        assert sentry_init._redact_before_send(event2, None) == event2

    def test_malformed_exception_does_not_raise(self):
        event = {"exception": {"values": "not-a-list"}}
        assert sentry_init._redact_before_send(event, None) == event
        event2 = {"exception": {"values": [{"stacktrace": "not-a-dict"}]}}
        assert sentry_init._redact_before_send(event2, None) == event2


# ---------------------------------------------------------------------------
# Phase 18 / FIX-04 — _scrub now delegates to services.redact.scrub_pii.
# The locally-defined PII surface (sentry_init._PII_KEYS) is still the
# enumeration ground-truth for THIS module's defense-in-depth; the canonical
# 17-key set lives in services.redact.DENYLIST_EXACT (Grok B1 promotions
# included). The shim ensures both surfaces redact.
# ---------------------------------------------------------------------------


class TestRedactPyDelegation:
    def test_scrub_imports_canonical_module(self):
        """The shim must import services.redact.scrub_pii."""
        from services import redact as redact_module

        # Sanity: the canonical module exposes scrub_pii.
        assert callable(redact_module.scrub_pii)

    def test_canonical_grok_b1_keys_redacted_in_event(self):
        """The 6 Grok-B1 promoted keys (now in canonical denylist) MUST be
        scrubbed by the new _scrub shim path."""
        event = {
            "request": {
                "headers": {
                    "x-bapi-apikey": "leaky-bybit-1",
                    "x-bapi-sign": "leaky-bybit-2",
                    "x-bapi-signature": "leaky-bybit-3",
                    "ok-access-passphrase": "leaky-okx-1",
                    "ok-access-key": "leaky-okx-2",
                    "ok-access-timestamp": "leaky-okx-3",
                    "x-harmless": "ok",
                }
            }
        }
        result = sentry_init._redact_before_send(event, None)
        h = result["request"]["headers"]
        assert h["x-bapi-apikey"] == "[REDACTED]"
        assert h["x-bapi-sign"] == "[REDACTED]"
        assert h["x-bapi-signature"] == "[REDACTED]"
        assert h["ok-access-passphrase"] == "[REDACTED]"
        assert h["ok-access-key"] == "[REDACTED]"
        assert h["ok-access-timestamp"] == "[REDACTED]"
        assert h["x-harmless"] == "ok"

    def test_broker_quirk_sweep_handles_unpromoted_keys(self):
        """Forward-compat: keys still in _PII_KEYS but NOT in the canonical
        DENYLIST_EXACT are still redacted by the broker-quirk sweep
        (Bybit-specific x-bapi-api-key with hyphen between api-key, x-bapi-timestamp,
        etc., and the Binance x-mbx-time-unit)."""
        event = {
            "request": {
                "headers": {
                    "x-bapi-api-key": "leaky-old-form",
                    "x-bapi-timestamp": "leaky-ts",
                    "x-bapi-recv-window": "leaky-rw",
                    "x-bapi-sign-type": "leaky-st",
                    "x-mbx-time-unit": "leaky-tu",
                    "x-harmless": "ok",
                }
            }
        }
        result = sentry_init._redact_before_send(event, None)
        h = result["request"]["headers"]
        assert h["x-bapi-api-key"] == "[REDACTED]"
        assert h["x-bapi-timestamp"] == "[REDACTED]"
        assert h["x-bapi-recv-window"] == "[REDACTED]"
        assert h["x-bapi-sign-type"] == "[REDACTED]"
        assert h["x-mbx-time-unit"] == "[REDACTED]"
        assert h["x-harmless"] == "ok"
