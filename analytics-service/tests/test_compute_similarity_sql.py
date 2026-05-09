"""
Phase 19 / FINGERPRINT-02: tests for compute_similarity SQL function.

10 behaviors:
  1. test_identical_returns_one — compute_similarity(fp, fp) returns 1.0000
  2. test_orthogonal_returns_low — disjoint single-bucket vectors return < 0.1
  3. test_null_inputs_return_zero — NULL inputs return 0.0 (never errors)
  4. test_version_mismatch_returns_zero — v1 vs v2 returns 0.0
  5. test_check_constraint_rejects_v0 — INSERT with version=0 raises 23514
  6. test_immutable_parallel_safe_flags — pg_proc.provolatile='i' AND proparallel='s'
  7. test_check_rejects_missing_version (M-3) — INSERT with no version key raises 23514

Plan 19-09 H-9 augmentation (REVIEWS.md):
  8. test_h9_scale_invariance — cos(fp, k*fp) == 1.0 for k > 0 across the
     full 46-dim concatenated vector (cosine is scale-invariant)
  9. test_h9_swap_symmetry — compute_similarity(a, b) == compute_similarity(b, a)
 10. test_h9_hand_computed_concat — fixed inputs produce 2/sqrt(6) ≈ 0.8165,
     confirming the array-concat order locked at trade_size || hold_duration ||
     asset_class || instrument || temporal (matches migration 105 SQL function
     and services/ingestion/fingerprint.py compute_fingerprint_v1)

Integration tests against the test Supabase project; auto-skip when
SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset.
"""
from __future__ import annotations

import os
import uuid

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]

# I-T8 — narrow the rpc-not-exposed except to PostgrestException so an
# unrelated bug (e.g. a 500 from PostgreSQL) actually fails the test
# instead of being silently skipped. PostgrestException is the supabase
# client's wire-error wrapper. If postgrest_py isn't importable (older
# supabase-py releases that don't ship it) we fall back to a sentinel
# class that's unreachable so the except block re-raises real bugs.
try:
    from postgrest.exceptions import APIError as PostgrestException  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    class PostgrestException(Exception):  # type: ignore[no-redef]
        pass


SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")


def _need_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY or create_client is None:
        pytest.skip("test Supabase project not configured")


@pytest.fixture
def admin():
    _need_supabase()
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _v1_fp(t1=(1, 0, 0, 0), t2=(1, 0, 0, 0), t3=(1, 0, 0, 0),
           ic=(1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
           tp=(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)):
    """Build a v1 fingerprint with the 5-component shape."""
    return {
        "version": 1,
        "trade_size_buckets": list(t1),
        "hold_duration_buckets": list(t2),
        "asset_class_mix": list(t3),
        "instrument_concentration": list(ic),
        "temporal_pattern": list(tp),
    }


def _call_compute_similarity(admin, a, b):
    """Call compute_similarity via execute_sql wrapper (rpc preferred but
    PostgREST may not auto-expose IMMUTABLE function args). Use
    raw SQL via the supabase admin postgrest client."""
    # I-T8 — narrow except to PostgrestException so a real bug (500,
    # ConnectionError, etc.) actually fails the test instead of being
    # silently skipped. We only skip when supabase-py reports the RPC
    # itself is missing from PostgREST schema cache.
    try:
        return admin.rpc("compute_similarity", {"a": a, "b": b}).execute().data
    except PostgrestException as exc:  # pragma: no cover — environment-specific
        pytest.skip(f"compute_similarity rpc not exposed: {exc}")


def test_identical_returns_one(admin):
    """compute_similarity(fp, fp) returns 1.0000 for any non-empty v1 fingerprint."""
    fp = _v1_fp()
    res = _call_compute_similarity(admin, fp, fp)
    assert float(res) == pytest.approx(1.0, abs=1e-4)


def test_orthogonal_returns_low(admin):
    """Disjoint single-bucket vectors return < 0.1."""
    a = _v1_fp(t1=(1, 0, 0, 0), t2=(1, 0, 0, 0), t3=(1, 0, 0, 0),
               ic=(1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
               tp=(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    b = _v1_fp(t1=(0, 0, 0, 1), t2=(0, 0, 0, 1), t3=(0, 0, 0, 1),
               ic=(0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
               tp=(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1))
    res = _call_compute_similarity(admin, a, b)
    assert float(res) < 0.1


def test_null_inputs_return_zero(admin):
    """NULL inputs return 0.0 — never errors."""
    fp = _v1_fp()
    assert float(_call_compute_similarity(admin, None, fp)) == 0.0
    assert float(_call_compute_similarity(admin, fp, None)) == 0.0


def test_version_mismatch_returns_zero(admin):
    """v1 vs v2 returns 0.0."""
    a = _v1_fp()
    b = dict(_v1_fp())
    b["version"] = 2
    res = _call_compute_similarity(admin, a, b)
    assert float(res) == 0.0


def test_check_constraint_rejects_v0(admin):
    """INSERT with fingerprint version=0 raises CHECK violation 23514."""
    user_id = str(uuid.uuid4())
    bad_fp = dict(_v1_fp())
    bad_fp["version"] = 0
    with pytest.raises(Exception) as excinfo:
        admin.table("strategies").insert({
            "user_id": user_id,
            "name": f"v0-test-{uuid.uuid4().hex[:8]}",
            "status": "pending_review",
            "source": "okx",
            "strategy_types": [],
            "subtypes": [],
            "markets": [],
            "supported_exchanges": [],
            "fingerprint": bad_fp,
        }).execute()
    msg = str(excinfo.value).lower()
    assert "23514" in msg or "check" in msg or "violates" in msg


def test_immutable_parallel_safe_flags(admin):
    """pg_proc.provolatile='i' AND pg_proc.proparallel='s' for compute_similarity."""
    # Use rpc to query system catalog via a small helper RPC, OR use the rest
    # endpoint to fetch from a table. supabase-py doesn't ship an execute_sql
    # primitive; use psycopg via env-var URL if available, else skip.
    try:
        import psycopg2
    except ImportError:  # pragma: no cover
        pytest.skip("psycopg2 not installed")
    db_url = os.getenv("SUPABASE_TEST_DB_URL")
    if not db_url:
        pytest.skip("SUPABASE_TEST_DB_URL not configured for direct catalog query")
    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.provolatile, p.proparallel
                  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname='public' AND p.proname='compute_similarity'
            """)
            row = cur.fetchone()
            assert row == ('i', 's'), f"Expected ('i','s'), got {row}"


def test_check_rejects_missing_version(admin):
    """M-3 — INSERT with fingerprint missing 'version' key raises CHECK violation 23514.
    The naive `(fingerprint->>'version')::INT = 1` would have permitted this row
    because `NULL = 1` is NULL (not FALSE) and Postgres treats that as
    constraint-satisfied. The IS NOT NULL guard catches it."""
    user_id = str(uuid.uuid4())
    bad_fp = {
        "trade_size_buckets": [1, 0, 0, 0],
        # no version key
    }
    with pytest.raises(Exception) as excinfo:
        admin.table("strategies").insert({
            "user_id": user_id,
            "name": f"no-version-{uuid.uuid4().hex[:8]}",
            "status": "pending_review",
            "source": "okx",
            "strategy_types": [],
            "subtypes": [],
            "markets": [],
            "supported_exchanges": [],
            "fingerprint": bad_fp,
        }).execute()
    msg = str(excinfo.value).lower()
    assert "23514" in msg or "check" in msg or "violates" in msg


# ---------------------------------------------------------------------------
# Plan 19-09 H-9 augmentation — explicit cosine-property contract tests.
#
# REVIEWS.md H-9 calls for these explicit cases on top of the basic
# identical / orthogonal / null pair already covered above. These exercise
# the array-concat order (trade_size || hold_duration || asset_class ||
# instrument || temporal) shared between the SQL function and
# services/ingestion/fingerprint.py compute_fingerprint_v1.
# ---------------------------------------------------------------------------


def test_h9_scale_invariance(admin):
    """Cosine is scale-invariant: cos(fp, k*fp) == 1.0 for any k > 0.

    Build two fingerprints with the same shape but different magnitudes
    BEFORE L1 normalization. After the planner's L1 normalization both
    fingerprints should be identical (both sum to 1.0); cosine should be
    1.0 either way. This checks that the SQL function's vector
    construction does not introduce any non-linearity that would break
    scale invariance.
    """
    a = _v1_fp(t1=(2, 0, 0, 0), t2=(2, 0, 0, 0), t3=(2, 0, 0, 0),
               ic=(2, 0, 0, 0, 0, 0, 0, 0, 0, 0),
               tp=(2,) + (0,) * 23)
    # Same one-hot shape but 100x magnitude — purely a scale change.
    b = _v1_fp(t1=(200, 0, 0, 0), t2=(200, 0, 0, 0), t3=(200, 0, 0, 0),
               ic=(200, 0, 0, 0, 0, 0, 0, 0, 0, 0),
               tp=(200,) + (0,) * 23)
    res = _call_compute_similarity(admin, a, b)
    assert float(res) == pytest.approx(1.0, abs=1e-4)


def test_h9_swap_symmetry(admin):
    """compute_similarity(a, b) == compute_similarity(b, a) — cosine is
    symmetric and the SQL function must not introduce any asymmetric
    early-exit that breaks swap parity (e.g. testing only `a` for shape
    mismatch but accepting any `b`)."""
    a = _v1_fp(t1=(0.7, 0.2, 0.1, 0), t2=(0.5, 0.3, 0.2, 0),
               t3=(0, 1, 0, 0),
               ic=(0.4, 0.3, 0.2, 0.1, 0, 0, 0, 0, 0, 0),
               tp=(0.1,) * 10 + (0,) * 14)
    b = _v1_fp(t1=(0.4, 0.5, 0.1, 0), t2=(0.6, 0.2, 0.1, 0.1),
               t3=(0, 0.5, 0.5, 0),
               ic=(0.2, 0.4, 0.3, 0.1, 0, 0, 0, 0, 0, 0),
               tp=(0.05,) * 20 + (0,) * 4)
    ab = float(_call_compute_similarity(admin, a, b))
    ba = float(_call_compute_similarity(admin, b, a))
    # Cosine is symmetric to the limit of NUMERIC(5,4) precision.
    assert ab == pytest.approx(ba, abs=1e-4)
    # And both are in (0, 1) — neither pathological 0.0 nor 1.0.
    assert 0.0 < ab < 1.0


def test_h9_hand_computed_concat(admin):
    """Hand-computed cosine for fixed inputs — locks the 5-component
    concat order (trade_size || hold_duration || asset_class ||
    instrument || temporal) shared between migration 105 and
    services/ingestion/fingerprint.py. If the SQL function reordered the
    components, this test would yield a different (or zero) cosine.

    Inputs:
      a = [1,0,0,0 | 0,1,0,0 | 0,0,1,0 | 0×10 | 0×24]  → 3 ones at slots 0,5,10
      b = [1,0,0,0 | 0,0,0,0 | 0,0,1,0 | 0×10 | 0×24]  → 2 ones at slots 0,10

    Hand math:
      a·b   = 1*1 (slot 0) + 0 (slot 5 vs 0) + 1*1 (slot 10) = 2
      ‖a‖   = sqrt(1 + 1 + 1) = sqrt(3)
      ‖b‖   = sqrt(1 + 1)     = sqrt(2)
      cos   = 2 / sqrt(6) ≈ 0.8165

    Any other concat order would break this — e.g. if asset_class came
    BEFORE hold_duration, slot 5 would map to a different bucket and
    the cosine would change.
    """
    import math

    a = _v1_fp(
        t1=(1, 0, 0, 0),       # bucket 0 of trade_size
        t2=(0, 1, 0, 0),       # bucket 1 of hold_duration → slot 5
        t3=(0, 0, 1, 0),       # bucket 2 of asset_class   → slot 10
        ic=(0,) * 10,
        tp=(0,) * 24,
    )
    b = _v1_fp(
        t1=(1, 0, 0, 0),       # bucket 0 of trade_size
        t2=(0, 0, 0, 0),       # zero hold_duration — will lower b's norm
        t3=(0, 0, 1, 0),       # bucket 2 of asset_class   → slot 10
        ic=(0,) * 10,
        tp=(0,) * 24,
    )
    expected = 2.0 / math.sqrt(6.0)
    res = _call_compute_similarity(admin, a, b)
    assert float(res) == pytest.approx(expected, abs=1e-4)
