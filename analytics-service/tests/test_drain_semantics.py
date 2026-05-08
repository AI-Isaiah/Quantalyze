"""
Phase 19 / BACKBONE-09 + BACKBONE-08 + BACKBONE-05: tests for migration 104
drain semantics, wizard idempotency, and feature_flags kill-switch.

6 behaviors:
  1. test_unique_wizard_session_id_blocks_double_insert
  2. test_compute_jobs_kind_admits_process_key_long
  3. test_claim_writes_unified_backbone_metadata
  4. test_feature_flags_table_seeded_off
  5. test_drain_reclaim_preserves_snapshot (D-1)
  6. test_status_enum_pending_not_queued (C-1)

These are integration tests against the test Supabase project. When
SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset they auto-skip.
"""
from __future__ import annotations

import os
import uuid

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]


SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")


def _need_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY or create_client is None:
        pytest.skip("test Supabase project not configured")


@pytest.fixture
def admin():
    _need_supabase()
    return create_client(SUPABASE_URL, SUPABASE_KEY)


@pytest.fixture
def strategy_id(admin):
    user_id = str(uuid.uuid4())
    res = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"drain-test-{uuid.uuid4().hex[:8]}",
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
    except Exception:
        pass


def test_unique_wizard_session_id_blocks_double_insert(admin, strategy_id):
    """Inserting two rows with the same wizard_session_id raises 23505."""
    wsid = str(uuid.uuid4())
    payload = {
        "strategy_id": strategy_id,
        "wizard_session_id": wsid,
        "status": "draft",
        "trust_tier": "api_verified",
        "flow_type": "onboard",
        "source": "okx",
    }
    admin.table("strategy_verifications").insert(payload).execute()
    with pytest.raises(Exception) as excinfo:
        admin.table("strategy_verifications").insert(payload).execute()
    msg = str(excinfo.value)
    assert "23505" in msg or "duplicate" in msg.lower() or "unique" in msg.lower()


def test_compute_jobs_kind_admits_process_key_long(admin, strategy_id):
    """Inserting a compute_jobs row with kind='process_key_long' succeeds."""
    res = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "process_key_long",
        "status": "pending",
        "priority": "normal",
    }).execute()
    assert res.data and res.data[0]["kind"] == "process_key_long"
    # cleanup
    admin.table("compute_jobs").delete().eq("id", res.data[0]["id"]).execute()


def test_claim_writes_unified_backbone_metadata(admin, strategy_id):
    """Calling claim_compute_jobs_with_priority(..., unified_backbone_active=TRUE)
    on a pending row stamps metadata->>'unified_backbone_at_claim' = 'true'."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "process_key_long",
        "status": "pending",
        "priority": "normal",
        "metadata": {},
    }).execute().data[0]
    job_id = job["id"]
    try:
        admin.rpc("claim_compute_jobs_with_priority", {
            "p_batch_size": 50,
            "p_worker_id": "drain-test",
            "p_unified_backbone_active": True,
        }).execute()
        row = admin.table("compute_jobs").select("metadata,status").eq("id", job_id).single().execute().data
        assert row["status"] == "running"
        assert row["metadata"].get("unified_backbone_at_claim") == "true"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_feature_flags_table_seeded_off(admin):
    """SELECT value FROM feature_flags WHERE flag_key='process_key_unified_backbone'
    returns 'off' on fresh apply."""
    res = admin.table("feature_flags").select("value").eq("flag_key", "process_key_unified_backbone").single().execute()
    assert res.data["value"] == "off"


def test_drain_reclaim_preserves_snapshot(admin, strategy_id):
    """D-1 — claim a job with unified_backbone_active=TRUE (metadata stamped 'true');
    manually reset job back to pending (simulate watchdog reset_stalled);
    call claim again with unified_backbone_active=FALSE — assert
    metadata->>'unified_backbone_at_claim' STILL says 'true' (original
    snapshot preserved via COALESCE)."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "process_key_long",
        "status": "pending",
        "priority": "normal",
        "metadata": {},
    }).execute().data[0]
    job_id = job["id"]
    try:
        # First claim with backbone=TRUE
        admin.rpc("claim_compute_jobs_with_priority", {
            "p_batch_size": 50,
            "p_worker_id": "drain-test-1",
            "p_unified_backbone_active": True,
        }).execute()
        row1 = admin.table("compute_jobs").select("metadata").eq("id", job_id).single().execute().data
        assert row1["metadata"]["unified_backbone_at_claim"] == "true"

        # Reset to pending (simulate watchdog reset_stalled) — preserve metadata
        admin.table("compute_jobs").update({
            "status": "pending",
            "claimed_at": None,
            "claimed_by": None,
        }).eq("id", job_id).execute()

        # Re-claim with backbone=FALSE
        admin.rpc("claim_compute_jobs_with_priority", {
            "p_batch_size": 50,
            "p_worker_id": "drain-test-2",
            "p_unified_backbone_active": False,
        }).execute()
        row2 = admin.table("compute_jobs").select("metadata").eq("id", job_id).single().execute().data
        # D-1: snapshot preserved
        assert row2["metadata"]["unified_backbone_at_claim"] == "true", \
            "D-1 violation: re-claim overwrote the original snapshot"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_status_enum_pending_not_queued(admin, strategy_id):
    """C-1 — insert a pending row, claim succeeds; insert a 'queued' row
    (will fail CHECK, proving the enum value 'queued' is invalid in the
    schema and confirming C-1 plan correction)."""
    # pending row claims
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "process_key_long",
        "status": "pending",
        "priority": "normal",
    }).execute().data[0]
    try:
        admin.rpc("claim_compute_jobs_with_priority", {
            "p_batch_size": 50,
            "p_worker_id": "c1-test",
            "p_unified_backbone_active": True,
        }).execute()
        row = admin.table("compute_jobs").select("status").eq("id", job["id"]).single().execute().data
        assert row["status"] == "running", "pending row should claim"
    finally:
        admin.table("compute_jobs").delete().eq("id", job["id"]).execute()

    # 'queued' fails CHECK — proves the enum doesn't admit 'queued'
    with pytest.raises(Exception) as excinfo:
        admin.table("compute_jobs").insert({
            "strategy_id": strategy_id,
            "kind": "process_key_long",
            "status": "queued",
            "priority": "normal",
        }).execute()
    msg = str(excinfo.value).lower()
    assert "check" in msg or "invalid" in msg or "violates" in msg or "23514" in msg
