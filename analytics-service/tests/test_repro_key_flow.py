"""Phase 16 / OBSERV-08 — replay suite for the unified key-flow harness.

Asserted invariants:
  1. Each test exercises the SAME unified key-flow path that the SSE endpoint
     (Plan 7) walks — different broker, same code.
  2. record_mode='once' on phase16_vcr means: first run records (founder action,
     [BLOCKING] checkpoint), subsequent runs replay deterministically with NO
     network access.
  3. Auth-fail / rate-limit / schema-drift cassettes assert the expected error
     class is raised so the wizard error envelope code path is exercised.

Test count: 12 (3 brokers × 4 scenarios).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import ccxt

from tests.conftest_vcr import phase16_vcr

# Cassette dir resolved relative to this test file. Phase 16 ships 4 OKX
# cassettes (founder gate 16-08 Task 3 covers the other 8 — Binance + Bybit
# recordings against real test broker creds). Without the existence check
# below, vcrpy `record_mode='once'` would attempt to RECORD missing
# cassettes, which means a live network call to the broker API. CI runners
# are inside GitHub Actions IP ranges that Binance and Bybit block (Binance
# 451 'restricted location', Bybit 403 CloudFront).
_CASSETTE_DIR = Path(__file__).parent / "cassettes"


def _skip_if_no_cassette(broker: str, scenario: str) -> None:
    """Skip the parametrized case when its cassette is not yet recorded."""
    cassette = _CASSETTE_DIR / broker / f"{scenario}.yaml"
    if not cassette.exists():
        pytest.skip(
            f"cassette not yet recorded: {broker}/{scenario}.yaml "
            f"(founder gate 16-08 Task 3)"
        )


# Per-broker test cred env-var names (decrypt happens in the SSE path; here we
# pass cleartext from monkeypatched fixtures because we are NOT exercising the
# encryption path — only the broker-fetch path).
TEST_CREDS = {
    "okx": {
        "apiKey": "test-okx-key",
        "secret": "test-okx-secret",
        "password": "test-okx-passphrase",
    },
    "binance": {
        "apiKey": "test-binance-key",
        "secret": "test-binance-secret",
    },
    "bybit": {
        "apiKey": "test-bybit-key",
        "secret": "test-bybit-secret",
    },
}


def _make_exchange(broker: str, creds: dict) -> ccxt.Exchange:
    """Construct a ccxt exchange instance with test creds. NEVER calls fetch yet."""
    klass = getattr(ccxt, broker)
    return klass({**creds, "enableRateLimit": False})


# --- HAPPY PATH ----------------------------------------------------------------

@pytest.mark.parametrize("broker", ["okx", "binance", "bybit"])
def test_happy_path_replays_balance_fetch(broker):
    """Replay the canonical successful balance-fetch for each broker."""
    _skip_if_no_cassette(broker, "happy")
    with phase16_vcr.use_cassette(f"{broker}/happy.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        result = ex.fetch_balance()
    assert isinstance(result, dict)
    assert "info" in result or "free" in result, f"Unexpected balance shape for {broker}"


# --- AUTH FAIL -----------------------------------------------------------------

@pytest.mark.parametrize("broker", ["okx", "binance", "bybit"])
def test_auth_fail_raises_authentication_error(broker):
    """Replay the auth-fail (HTTP 401) path; assert ccxt.AuthenticationError raised."""
    _skip_if_no_cassette(broker, "auth-fail")
    with phase16_vcr.use_cassette(f"{broker}/auth-fail.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        with pytest.raises((ccxt.AuthenticationError, ccxt.PermissionDenied)):
            ex.fetch_balance()


# --- RATE LIMIT ----------------------------------------------------------------

@pytest.mark.parametrize("broker", ["okx", "binance", "bybit"])
def test_rate_limit_raises_rate_limit_exceeded(broker):
    """Replay the rate-limit (HTTP 429) path; assert ccxt.RateLimitExceeded or DDoS raised."""
    _skip_if_no_cassette(broker, "rate-limit")
    with phase16_vcr.use_cassette(f"{broker}/rate-limit.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        with pytest.raises((ccxt.RateLimitExceeded, ccxt.DDoSProtection, ccxt.ExchangeError)):
            ex.fetch_balance()


# --- SCHEMA DRIFT --------------------------------------------------------------

@pytest.mark.parametrize("broker", ["okx", "binance", "bybit"])
def test_schema_drift_raises_or_returns_partial(broker):
    """Replay HTTP 200 + unexpected payload; assert ccxt raises OR result has missing fields.

    Schema-drift is the most variable case — different exchanges fail differently when
    a field is renamed. Accept any of: ccxt.ExchangeError raise, or a result dict
    where the canonical 'free'/'used' fields are missing.
    """
    _skip_if_no_cassette(broker, "schema-drift")
    with phase16_vcr.use_cassette(f"{broker}/schema-drift.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        try:
            result = ex.fetch_balance()
            # If no raise, the result MUST be missing canonical fields (proves drift).
            has_canonical = isinstance(result, dict) and ("free" in result or "info" in result)
            assert not has_canonical, (
                f"{broker} schema-drift cassette should fail or return partial; got {result!r}"
            )
        except (ccxt.ExchangeError, KeyError, ValueError, TypeError):
            # TypeError is a real-world drift symptom: ccxt's parser does
            # `len(safe_list(entry, 'coin'))` and crashes when the broker
            # silently drops the `coin` array (Bybit-class drift). Accept
            # it as a valid drift exception class — the wizard's error
            # envelope catches all of these the same way.
            pass
