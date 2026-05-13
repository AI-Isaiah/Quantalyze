"""
Phase 19 / BACKBONE-03: tests for transition_strategy_verification RPC.

5 behaviors (4 from plan + H-14 idempotent draft→draft):
  1. test_legal_transition_succeeds — draft → validated returns updated row
  2. test_illegal_transition_raises — draft → published raises SQLSTATE 22023
  3. test_metadata_merge — metrics_snapshot metadata merges into column
  4. test_restart_path — metrics_captured → draft with errors metadata is legal
  5. test_validate_failure_resets_draft_with_errors (H-14) — draft → draft with
     metadata.errors is idempotent (succeeds twice in a row); used by the
     synchronous /process-key router validate-failure path.

These are integration tests against the test Supabase project. When
SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset they auto-skip.
"""
from __future__ import annotations

import os
import re
import uuid

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover — supabase-py not installed in this env
    create_client = None  # type: ignore[assignment]


SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")


def _need_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY or create_client is None:
        pytest.skip("test Supabase project not configured (SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY)")


@pytest.fixture
def admin():
    """Service-role client against the test Supabase project."""
    _need_supabase()
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _seed_user_id(admin) -> str:
    """Return any existing profile id from the test DB to satisfy
    strategies.user_id FK. See test_compute_jobs_fencing.py for rationale."""
    res = admin.table("profiles").select("id").limit(1).execute()
    if not res.data:
        pytest.skip("test Supabase project has no seeded profiles")
    return res.data[0]["id"]


@pytest.fixture
def strategy_id(admin):
    """Insert a synthetic strategy and yield its id; cleanup deletes the row.

    The cascade FK on strategy_verifications.strategy_id removes any
    verification rows we created during the test.
    """
    user_id = _seed_user_id(admin)
    res = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"test-transition-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute()
    sid = res.data[0]["id"]
    yield sid
    try:
        admin.table("strategies").delete().eq("id", sid).execute()
    except Exception:  # pragma: no cover — best-effort cleanup
        pass


def _make_draft(admin, sid):
    """Insert a draft strategy_verifications row and return it."""
    return admin.table("strategy_verifications").insert({
        "strategy_id": sid,
        "wizard_session_id": str(uuid.uuid4()),
        "status": "draft",
        "trust_tier": "api_verified",
        "flow_type": "onboard",
        "source": "okx",
    }).execute().data[0]


def test_legal_transition_succeeds(admin, strategy_id):
    """Legal draft → validated returns the updated row JSONB."""
    row = _make_draft(admin, strategy_id)
    res = admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"],
        "p_new_status": "validated",
        "p_metadata": None,
    }).execute()
    assert res.data is not None
    assert res.data["status"] == "validated"
    # transitioned_at advanced relative to created_at
    assert res.data["transitioned_at"] >= row["created_at"]


def test_illegal_transition_raises(admin, strategy_id):
    """Illegal draft → published raises SQLSTATE 22023 (illegal transition)."""
    row = _make_draft(admin, strategy_id)
    with pytest.raises(Exception) as excinfo:
        admin.rpc("transition_strategy_verification", {
            "p_verification_id": row["id"],
            "p_new_status": "published",
            "p_metadata": None,
        }).execute()
    msg = str(excinfo.value)
    # SQLSTATE 22023 surfaces in PostgREST error payload as code "22023" or in the message
    assert "22023" in msg or "illegal transition" in msg.lower()


def test_metadata_merge(admin, strategy_id):
    """Metadata metrics_snapshot merges into the column."""
    row = _make_draft(admin, strategy_id)
    res = admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"],
        "p_new_status": "validated",
        "p_metadata": {"metrics_snapshot": {"sharpe": 1.5}},
    }).execute()
    assert res.data["metrics_snapshot"] == {"sharpe": 1.5}
    assert res.data["status"] == "validated"


def test_restart_path(admin, strategy_id):
    """metrics_captured → draft with errors metadata is legal (restart path)."""
    row = _make_draft(admin, strategy_id)
    # Walk forward to metrics_captured
    admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"], "p_new_status": "validated", "p_metadata": None,
    }).execute()
    admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"], "p_new_status": "metrics_captured", "p_metadata": None,
    }).execute()
    # Restart with errors
    res = admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"],
        "p_new_status": "draft",
        "p_metadata": {"errors": [{"code": "RESTART"}]},
    }).execute()
    assert res.data["status"] == "draft"
    assert res.data["errors"] == [{"code": "RESTART"}]


def test_validate_failure_resets_draft_with_errors(admin, strategy_id):
    """H-14 — draft → draft with metadata.errors persists errors column +
    sets transitioned_at idempotently. Required for the synchronous
    /process-key router validate-failure path that keeps a row in 'draft'
    status while recording the validation error. Re-calling MUST succeed
    idempotently with errors already present.
    """
    row = _make_draft(admin, strategy_id)
    err_payload = {"errors": [{"code": "VALIDATE_FAILED", "human_message": "Bad creds"}]}

    # First call: draft → draft with errors
    res1 = admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"],
        "p_new_status": "draft",
        "p_metadata": err_payload,
    }).execute()
    assert res1.data["status"] == "draft"
    assert res1.data["errors"] == err_payload["errors"]
    first_transitioned = res1.data["transitioned_at"]

    # Second call (idempotent re-call) must succeed
    res2 = admin.rpc("transition_strategy_verification", {
        "p_verification_id": row["id"],
        "p_new_status": "draft",
        "p_metadata": err_payload,
    }).execute()
    assert res2.data["status"] == "draft"
    assert res2.data["errors"] == err_payload["errors"]
    # transitioned_at should advance (or at minimum stay equal — idempotent stamp)
    assert res2.data["transitioned_at"] >= first_transitioned
