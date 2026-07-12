import functools
import pytest
import pandas as pd
import numpy as np
import json
from pathlib import Path


# ── CI speed: parallelize the offline test bulk with pytest-xdist ─────────────
# The suite runs under `pytest -n auto --dist loadgroup` in CI and `make test`.
# ~3.6k tests are pure/offline and distribute freely across workers. A handful
# of files exercise the SHARED remote Supabase test project (fencing/claim,
# drain, RPC round-trips). Running two of those concurrently races the shared
# rows exactly like two CI runs would — which is why the python job also carries
# a repo-wide `concurrency: shared-test-db` group. We pin every DB-touching
# module to a single xdist group so they land on ONE worker and stay serialized
# relative to each other (the same no-intra-run-race property the old serial job
# had), while the offline bulk parallelizes.
#
# Detection is content-based (not a hardcoded file list) so a future DB test is
# grouped automatically: any test module whose source references the shared
# test-DB env vars or the `_need_supabase` guard is treated as DB-touching.
# Both the PostgREST idiom (SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY /
# _need_supabase) and the psycopg idiom (TEST_SUPABASE_DB_URL / HAS_LIVE_DB) hit
# the shared remote test project, so both must group. Deliberately NOT the bare
# `SUPABASE_URL`: it names the app/prod env var and appears in ~10 offline unit
# files that never touch the shared DB — grouping them would pin the bulk to one
# worker and defeat the parallelism.
_DB_MODULE_SENTINELS = (
    "SUPABASE_TEST_URL",
    "SUPABASE_TEST_SERVICE_KEY",
    "_need_supabase",
    "TEST_SUPABASE_DB_URL",
    "HAS_LIVE_DB",
)


@functools.lru_cache(maxsize=None)
def _is_shared_db_module(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            source = fh.read()
    except OSError:
        return False
    return any(sentinel in source for sentinel in _DB_MODULE_SENTINELS)


def pytest_collection_modifyitems(config, items):
    for item in items:
        if _is_shared_db_module(str(item.fspath)):
            item.add_marker(pytest.mark.xdist_group("shared_test_db"))


# PR #181 take-2 red-team F16: services.metrics maintains a process-level
# `_FAIL_LOUD_TRACEBACK_EMITTED` set so the first occurrence of each
# (scalar_name, exc-type) pair emits `exc_info=True` and subsequent
# occurrences emit a single-line WARNING without traceback. Tests that
# pin the exc_info contract assume "first occurrence" semantics, so we
# reset the set before every test. The reset is a no-op for tests that
# don't import metrics.
@pytest.fixture(autouse=True)
def _reset_fail_loud_traceback_dedupe():
    try:
        from services.metrics import (
            _reset_fail_loud_traceback_dedupe_for_tests,
        )
    except ImportError:
        # services.metrics not on the path for this test (e.g., import-failure
        # smoke tests) — nothing to reset.
        yield
        return
    _reset_fail_loud_traceback_dedupe_for_tests()
    yield
    _reset_fail_loud_traceback_dedupe_for_tests()


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def golden_returns() -> pd.Series:
    """500 trading days of synthetic returns with known statistical properties.

    Constructed so expected metrics can be verified analytically:
    - Mean daily return ~0.05% (annualized ~13%)
    - Std daily return ~1.5% (annualized vol ~24%)
    - Contains a drawdown period (days 200-250) and a recovery
    - Mix of positive and negative days (~55% positive)
    """
    rng = np.random.default_rng(42)
    n_days = 500
    dates = pd.bdate_range("2023-01-01", periods=n_days)

    # Normal returns with slight positive drift
    base_returns = rng.normal(0.0005, 0.015, n_days)

    # Inject a drawdown period (days 200-250)
    base_returns[200:230] = rng.normal(-0.015, 0.02, 30)
    base_returns[230:250] = rng.normal(0.005, 0.01, 20)

    return pd.Series(base_returns, index=dates, name="returns")


@pytest.fixture
def zero_vol_returns() -> pd.Series:
    """Returns with zero volatility — should produce Inf Sharpe."""
    dates = pd.bdate_range("2023-01-01", periods=100)
    return pd.Series(0.001, index=dates, name="returns")


@pytest.fixture
def single_trade_returns() -> pd.Series:
    """Minimum viable: 2 days of returns."""
    dates = pd.bdate_range("2023-01-01", periods=2)
    return pd.Series([0.05, -0.02], index=dates, name="returns")


@pytest.fixture
def empty_returns() -> pd.Series:
    """Empty returns series."""
    return pd.Series(dtype=float, name="returns")


@pytest.fixture
def benchmark_returns() -> pd.Series:
    """BTC-like benchmark returns aligned with golden_returns dates."""
    rng = np.random.default_rng(123)
    dates = pd.bdate_range("2023-01-01", periods=500)
    return pd.Series(
        rng.normal(0.0003, 0.025, 500),
        index=dates,
        name="BTC",
    )


@pytest.fixture
def sample_trades() -> list[dict]:
    """Realistic trade records for testing transforms."""
    return [
        {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16500.00", "quantity": "0.1", "fee": "1.65", "order_type": "market"},
        {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16600.00", "quantity": "0.1", "fee": "1.66", "order_type": "market"},
        {"timestamp": "2023-01-03T09:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16550.00", "quantity": "0.2", "fee": "3.31", "order_type": "limit"},
        {"timestamp": "2023-01-03T15:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16400.00", "quantity": "0.2", "fee": "3.28", "order_type": "market"},
        {"timestamp": "2023-01-04T11:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16450.00", "quantity": "0.15", "fee": "2.47", "order_type": "limit"},
        {"timestamp": "2023-01-04T16:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16700.00", "quantity": "0.15", "fee": "2.51", "order_type": "market"},
    ]


# ---------------------------------------------------------------------------
# Phase 06 (allocator-api-ingestion): api_keys row factory for worker tests
# ---------------------------------------------------------------------------
# Added for plan 06-02. Allocator worker tests need a shape-correct api_keys
# row (the worker's preflight loads by id and reads exchange, user_id,
# is_active, sync_status, sync_error, api_key_encrypted, dek_encrypted,
# kek_version, last_429_at). Keep the default shape permissive; tests
# override per case via keyword args.

@pytest.fixture
def api_key_row_factory():
    """Return a dict shaped like an api_keys row for worker tests."""
    def _make(**overrides):
        row = {
            "id": "00000000-0000-0000-0000-000000000001",
            "user_id": "00000000-0000-0000-0000-000000000aaa",
            "exchange": "binance",
            "label": "test-key",
            "is_active": True,
            "api_key_encrypted": "enc",
            "dek_encrypted": "enc",
            "sync_status": "idle",
            "sync_error": None,
            "kek_version": 1,
            "last_429_at": None,
            "last_sync_at": None,
        }
        row.update(overrides)
        return row
    return _make


# ---------------------------------------------------------------------------
# Phase 12 / METRICS-13 — golden_252d cross-runtime parity fixtures
# ---------------------------------------------------------------------------
# Read the deterministic 252-day input parquet + the committed expected JSON
# (regenerated via `python -m tests.fixtures.regen_golden` from analytics-service/).
# See .planning/phases/12-backend-metric-contracts/12-09-PLAN.md for the contract.

@pytest.fixture
def golden_252d_input() -> dict:
    """Read the deterministic 252-day input fixture (returns + benchmark).

    Audit H-0752: pin the column list and ASSERT the dtype. The cross-runtime
    parity assertions run at 1e-12 / 1e-9 tolerances, so a silent dtype drift
    in ``regen_golden.py`` (e.g. float32 instead of float64) would trip them
    under environment-only changes with no schema signal. ``columns=`` fails
    loudly if a column is renamed; the dtype assert fails loudly on drift —
    deliberately NOT an ``.astype`` cast, which would upcast lossy float32 back
    to float64 and MASK the very drift we want to surface.
    """
    df = pd.read_parquet(
        FIXTURES_DIR / "golden_252d_input.parquet",
        columns=["returns", "benchmark"],
    )
    assert df["returns"].dtype == np.float64 and df["benchmark"].dtype == np.float64, (
        f"golden_252d_input.parquet dtype drift: returns={df['returns'].dtype}, "
        f"benchmark={df['benchmark'].dtype} (expected float64 — regenerate via "
        "`python -m tests.fixtures.regen_golden`)"
    )
    return {
        "returns": df["returns"],
        "benchmark": df["benchmark"],
    }


@pytest.fixture
def golden_252d_expected() -> dict:
    """Read the committed expected metrics output (metrics_json + sibling kinds)."""
    return json.loads((FIXTURES_DIR / "golden_252d_expected.json").read_text())
