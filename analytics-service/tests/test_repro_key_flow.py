"""Phase 16 / OBSERV-08 — replay suite for the unified key-flow harness.

Asserted invariants:
  1. Each test exercises the SAME unified key-flow path that the SSE endpoint
     (Plan 7) walks — different broker, same code.
  2. record_mode='once' on phase16_vcr means: first run records (founder action,
     [BLOCKING] checkpoint), subsequent runs replay deterministically with NO
     network access.
  3. Auth-fail / rate-limit / schema-drift cassettes assert the expected error
     class is raised so the wizard error envelope code path is exercised.

Test count: 11 (2 brokers × 4 scenarios, 2 synthesizer regressions, 1 cassette-set pin).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import ccxt

from tests.conftest_vcr import phase16_vcr

# Cassette dir resolved relative to this test file. Both replayed brokers ship
# all four scenario cassettes. Without the existence check below, vcrpy
# `record_mode='once'` would attempt to RECORD a missing cassette, which means
# a live network call to the broker API from a CI runner.
_CASSETTE_DIR = Path(__file__).parent / "cassettes"

# The brokers this suite replays. 2026-11-15 (Phase 215 TESTREACH): the binance
# broker was retired from this list. No binance cassette can be recorded: CI
# runners sit in IP ranges binance refuses with a 451, and no live binance test
# key exists locally or in CI, so its four cases skipped forever and read as
# green. okx and bybit keep the replay shape covered. To re-add binance, record
# its four cassettes with scripts/record_cassettes.py, then add it here.
_REPLAY_BROKERS = ["okx", "bybit"]

_SCENARIOS = ["auth-fail", "happy", "rate-limit", "schema-drift"]


def _require_cassette(broker: str, scenario: str) -> None:
    """Fail the case when its cassette is missing.

    A skipped missing cassette reads as green while checking nothing, so a
    missing file is a failure: every broker in _REPLAY_BROKERS must have all
    four cassettes.
    """
    cassette = _CASSETTE_DIR / broker / f"{scenario}.yaml"
    if not cassette.exists():
        pytest.fail(
            f"cassette missing: {broker}/{scenario}.yaml; every broker in "
            f"_REPLAY_BROKERS must have all four cassettes "
            f"(record them with scripts/record_cassettes.py)"
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

@pytest.mark.parametrize("broker", _REPLAY_BROKERS)
def test_happy_path_replays_balance_fetch(broker):
    """Replay the canonical successful balance-fetch for each broker."""
    _require_cassette(broker, "happy")
    with phase16_vcr.use_cassette(f"{broker}/happy.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        result = ex.fetch_balance()
    assert isinstance(result, dict)
    assert "info" in result or "free" in result, f"Unexpected balance shape for {broker}"


# --- AUTH FAIL -----------------------------------------------------------------

@pytest.mark.parametrize("broker", _REPLAY_BROKERS)
def test_auth_fail_raises_authentication_error(broker):
    """Replay the auth-fail (HTTP 401) path; assert ccxt.AuthenticationError raised."""
    _require_cassette(broker, "auth-fail")
    with phase16_vcr.use_cassette(f"{broker}/auth-fail.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        with pytest.raises((ccxt.AuthenticationError, ccxt.PermissionDenied)):
            ex.fetch_balance()


# --- RATE LIMIT ----------------------------------------------------------------

@pytest.mark.parametrize("broker", _REPLAY_BROKERS)
def test_rate_limit_raises_rate_limit_exceeded(broker):
    """Replay the rate-limit (HTTP 429) path; assert ccxt.RateLimitExceeded or DDoS raised."""
    _require_cassette(broker, "rate-limit")
    with phase16_vcr.use_cassette(f"{broker}/rate-limit.yaml"):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        with pytest.raises((ccxt.RateLimitExceeded, ccxt.DDoSProtection, ccxt.ExchangeError)):
            ex.fetch_balance()


# --- SCHEMA DRIFT --------------------------------------------------------------

@pytest.mark.parametrize("broker", _REPLAY_BROKERS)
def test_schema_drift_raises_or_returns_partial(broker):
    """Replay HTTP 200 + unexpected payload; assert ccxt raises OR result has missing fields.

    Schema-drift is the most variable case — different exchanges fail differently when
    a field is renamed. Accept any of: ccxt.ExchangeError raise, or a result dict
    where the canonical 'free'/'used' fields are missing.
    """
    _require_cassette(broker, "schema-drift")
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


# --- SCHEMA DRIFT — synthesizer regression (the cassette-refresh gate) ----------

@pytest.mark.parametrize("broker", _REPLAY_BROKERS)
def test_synthesized_schema_drift_makes_ccxt_raise(broker, tmp_path):
    """The daily cassette-refresh workflow REGENERATES schema-drift.yaml from a
    freshly-recorded happy.yaml via record_cassettes._synthesize_schema_drift,
    then replays it through test_schema_drift_raises_or_returns_partial. That
    replay passes only if ccxt RAISES: its `has_canonical` check includes
    `"info"`, which ccxt always passes through on a non-raising parse, so the
    "returns partial" branch is unreachable.

    Regression for the cassette-refresh gate (red 22/22 since 2026-05-27): the
    prior synthesizer dropped a single canonical field. For OKX's multi-row
    `data[].details[]` payload ccxt shrugged that off, returned a full balance
    with `info`, and the job failed its own replay every run. This asserts the
    synthesizer emits a cassette ccxt detects as drift — i.e. the soak gate can
    actually go green. Fails against the field-drop synthesizer (OKX), passes
    against the error-envelope synthesizer.
    """
    import importlib.util

    _require_cassette(broker, "happy")

    rc_path = Path(__file__).resolve().parents[1] / "scripts" / "record_cassettes.py"
    spec = importlib.util.spec_from_file_location("record_cassettes", rc_path)
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)  # fresh instance, NOT registered in sys.modules

    broker_dir = tmp_path / broker
    broker_dir.mkdir(parents=True)
    happy_dst = broker_dir / "happy.yaml"
    happy_dst.write_bytes((_CASSETTE_DIR / broker / "happy.yaml").read_bytes())

    rc.CASSETTE_DIR = tmp_path  # synthesize under tmp, never touch committed fixtures
    drift = rc._synthesize_schema_drift(broker, happy_dst)

    # Absolute path bypasses phase16_vcr's cassette_library_dir join.
    with phase16_vcr.use_cassette(str(drift)):
        ex = _make_exchange(broker, TEST_CREDS[broker])
        with pytest.raises((ccxt.ExchangeError, KeyError, ValueError, TypeError)):
            ex.fetch_balance()


# --- CASSETTE SET PIN -----------------------------------------------------------

def test_every_replay_broker_has_all_four_cassettes():
    """Each replayed broker has all four scenario cassettes on disk.

    The hand-typed floor stops an emptied _REPLAY_BROKERS from passing
    vacuously (zero brokers, zero checks, green).
    """
    assert len(_REPLAY_BROKERS) == 2
    missing = [
        f"{broker}/{scenario}.yaml"
        for broker in _REPLAY_BROKERS
        for scenario in _SCENARIOS
        if not (_CASSETTE_DIR / broker / f"{scenario}.yaml").exists()
    ]
    assert not missing, f"missing cassettes: {missing}"
