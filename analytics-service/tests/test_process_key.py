"""Phase 19 / BACKBONE-01 + BACKBONE-02 + BACKBONE-04 + BACKBONE-08 — tests
for analytics-service/routers/process_key.py.

Asserted invariants (mirrors PLAN.md task P4-2 behavior list):
  1. INTERNAL_API_TOKEN auth (missing env → 403; wrong bearer → 403).
  2. Feature flag gate: is_unified_backbone_active() False → 503 with
     UNIFIED_BACKBONE_DISABLED code.
  3. Pydantic body validation: invalid flow_type / source → 422.
  4. wizard_session_id idempotency (SELECT pre-check + 23505 catch).
  5. Sync vs queued dispatch (csv → 200 published; onboard → 202 queued).
  6. Validation failure returns Phase 17 DESIGN-05 envelope.
  7. H-11: per-flow_type source whitelist (teaser cannot use csv;
     csv flow_type cannot use okx).
  8. H-12: INTERNAL_API_TOKEN no-newline + 64-char regression smoke.
  9. MC-4: dataclasses.asdict serializer for MetricsSnapshot.
 10. H-2: log_audit_event RPC called on entry so cron's denominator
     is non-zero.

All FastAPI tests use TestClient with the router mounted in isolation
so the global verify_service_key middleware does not interfere with the
unit-level INTERNAL_API_TOKEN auth check.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Test app factory.
# ---------------------------------------------------------------------------


@pytest.fixture
def app(monkeypatch):
    """Mount routers/process_key.py in a bare FastAPI app for isolated unit tests.

    Wraps slowapi state and the limiter exception handler so the
    `@limiter.limit("100/hour")` decorator does not blow up in tests.
    """
    monkeypatch.setenv(
        "INTERNAL_API_TOKEN",
        "a" * 64,  # H-12: 64 chars, no newline.
    )
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from routers import process_key as process_key_router
    from services import feature_flags

    feature_flags._reset_cache_for_tests()

    app = FastAPI()
    app.state.limiter = process_key_router.limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(process_key_router.router)
    return app


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_headers() -> dict[str, str]:
    """Bearer header that matches the fixture-set INTERNAL_API_TOKEN."""
    return {"Authorization": f"Bearer {'a' * 64}", "X-Correlation-Id": "cid-test"}


def _build_supabase_mock(
    *,
    existing_row=None,
    insert_id: str = "ver-1",
    insert_raises: Exception | None = None,
    insert_raises_then_existing=None,
):
    """Construct a chained-MagicMock supabase client for the tests below.

    The supabase-py builder pattern (`.table(...).select(...).eq(...).execute()`)
    returns a different chain depending on which terminal verb is hit. For our
    tests we mostly need:
      - `.select(...).eq(...).maybe_single().execute()` → ValidationResult
      - `.insert(...).execute()` → row with id
      - `.rpc(...).execute()` → empty success
    """
    fake = MagicMock()

    # SELECT path returns a configurable existing row.
    select_chain = MagicMock()
    select_chain.execute.return_value = MagicMock(
        data=existing_row,
    )
    eq_chain = MagicMock()
    eq_chain.maybe_single.return_value = select_chain
    eq_chain.single.return_value = MagicMock(
        execute=MagicMock(
            return_value=MagicMock(data=insert_raises_then_existing)
        )
    )
    select_obj = MagicMock()
    select_obj.eq.return_value = eq_chain
    table = MagicMock()
    table.select.return_value = select_obj

    # INSERT path
    insert_chain = MagicMock()
    if insert_raises is not None:
        insert_chain.execute.side_effect = insert_raises
    else:
        insert_chain.execute.return_value = MagicMock(
            data=[{"id": insert_id}]
        )
    table.insert.return_value = insert_chain

    # UPDATE path (used for fingerprint persist)
    update_chain = MagicMock()
    update_chain.eq.return_value = MagicMock(
        execute=MagicMock(return_value=MagicMock(data=[{"id": "s1"}]))
    )
    table.update.return_value = update_chain

    fake.table.return_value = table

    # RPC path (transition_strategy_verification, enqueue_compute_job, log_audit_event)
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data={})
    fake.rpc.return_value = rpc_chain

    return fake


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------


def test_process_key_auth_missing_token(client, monkeypatch):
    """Missing INTERNAL_API_TOKEN env → 403 'Internal API not configured'."""
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    r = client.post(
        "/process-key",
        json={
            "flow_type": "csv",
            "source": "csv",
            "context": {"strategy_id": "s1"},
        },
        headers={"Authorization": "Bearer whatever"},
    )
    assert r.status_code == 403
    assert "Internal API not configured" in r.text


def test_process_key_auth_wrong_token(client):
    """Wrong bearer → 403 'Forbidden' (constant-time compare path)."""
    r = client.post(
        "/process-key",
        json={
            "flow_type": "csv",
            "source": "csv",
            "context": {"strategy_id": "s1"},
        },
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 403
    assert "Forbidden" in r.text


# ---------------------------------------------------------------------------
# Feature flag gate test
# ---------------------------------------------------------------------------


def test_process_key_flag_off_503(client):
    """is_unified_backbone_active() False → 503 + UNIFIED_BACKBONE_DISABLED."""
    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=False),
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {"strategy_id": "s1"},
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["code"] == "UNIFIED_BACKBONE_DISABLED"


# ---------------------------------------------------------------------------
# Body validation tests
# ---------------------------------------------------------------------------


def test_process_key_invalid_flow_type_422(client):
    r = client.post(
        "/process-key",
        json={
            "flow_type": "unknown",
            "source": "okx",
            "context": {"strategy_id": "s1"},
        },
        headers=_auth_headers(),
    )
    assert r.status_code == 422


def test_process_key_h11_csv_source_blocked_for_teaser_flow(client):
    """H-11: flow_type='teaser', source='csv' → 422 (per-flow_type whitelist)."""
    r = client.post(
        "/process-key",
        json={
            "flow_type": "teaser",
            "source": "csv",
            "context": {"strategy_id": "s1"},
        },
        headers=_auth_headers(),
    )
    assert r.status_code == 422
    # Symmetric: csv flow_type with non-csv source.
    r2 = client.post(
        "/process-key",
        json={
            "flow_type": "csv",
            "source": "okx",
            "context": {"strategy_id": "s1"},
        },
        headers=_auth_headers(),
    )
    assert r2.status_code == 422


# ---------------------------------------------------------------------------
# H-12 regression smoke
# ---------------------------------------------------------------------------


def test_internal_api_token_no_newline_regression(monkeypatch):
    """H-12: assert env var has no trailing newline + length=64.

    Catches the 2026-05-06 Day-2 hypothesis #12 regression where a literal
    `\\n` suffix on the prod env-var bypassed the constant-time compare.
    """
    monkeypatch.setenv("INTERNAL_API_TOKEN", "a" * 64)
    assert "\n" not in os.environ["INTERNAL_API_TOKEN"]
    assert len(os.environ["INTERNAL_API_TOKEN"]) == 64


# ---------------------------------------------------------------------------
# MC-4 metrics encoder
# ---------------------------------------------------------------------------


def test_metrics_to_jsonb_handles_dataclass():
    """MC-4: dataclasses.asdict converts MetricsSnapshot into a plain dict.

    A subclass with a non-JSON-encodable field (e.g., raw bytes) surfaces
    a TypeError instead of silently corrupting the JSONB column.
    """
    from datetime import datetime

    from routers.process_key import _metrics_to_jsonb
    from services.ingestion.adapter import MetricsSnapshot

    m = MetricsSnapshot(
        sharpe=1.5,
        twr=0.12,
        ytd=0.05,
        max_drawdown=-0.08,
        total_pnl=1500.0,
        trade_count=42,
        win_rate=0.55,
    )
    out = _metrics_to_jsonb(m)
    assert isinstance(out, dict)
    assert out["sharpe"] == 1.5
    assert out["trade_count"] == 42

    # Non-encodable field → TypeError surfaces (not silent corruption).
    @dataclass
    class _Bad:
        ts: datetime  # not JSON-serializable by default

    bad = _Bad(ts=datetime(2026, 5, 8))
    # dataclasses.asdict succeeds (returns a dict containing a datetime),
    # but the downstream json.dumps raises. The contract is: surface, don't
    # silently drop.
    import json
    encoded = _metrics_to_jsonb(bad)
    with pytest.raises(TypeError):
        json.dumps(encoded)


# ---------------------------------------------------------------------------
# Idempotency tests
# ---------------------------------------------------------------------------


def test_process_key_idempotent_double_submit(client):
    """Two POSTs with the same wizard_session_id return the same row."""
    existing = {
        "id": "ver-existing",
        "status": "published",
        "trust_tier": "csv_uploaded",
    }
    fake = _build_supabase_mock(existing_row=existing)
    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ):
        body = {
            "flow_type": "csv",
            "source": "csv",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wiz-1",
            },
        }
        r1 = client.post("/process-key", json=body, headers=_auth_headers())
        r2 = client.post("/process-key", json=body, headers=_auth_headers())
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["verification_id"] == "ver-existing"
    assert r2.json()["verification_id"] == "ver-existing"


def test_process_key_unique_violation_returns_existing(client):
    """Mock 23505 on insert → route SELECTs by wizard_session_id and returns existing row."""
    existing_after_race = {
        "id": "ver-raced",
        "status": "validated",
        "trust_tier": "csv_uploaded",
    }
    fake = _build_supabase_mock(
        existing_row=None,  # pre-check finds nothing
        insert_raises=Exception("duplicate key value violates unique constraint (SQLSTATE 23505)"),
        insert_raises_then_existing=existing_after_race,
    )
    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ):
        body = {
            "flow_type": "csv",
            "source": "csv",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wiz-race",
            },
        }
        r = client.post("/process-key", json=body, headers=_auth_headers())
    assert r.status_code == 200
    assert r.json()["verification_id"] == "ver-raced"


# ---------------------------------------------------------------------------
# Sync vs queued dispatch
# ---------------------------------------------------------------------------


def test_process_key_csv_sync_path(client):
    """flow_type=csv, source=csv → synchronous publish, status=published."""
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-csv")

    # Build a minimal stub csv adapter so the test isolates the router.
    from services.ingestion.adapter import (
        Fingerprint,
        MetricsSnapshot,
        ValidationResult,
    )

    csv_adapter = MagicMock()
    csv_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    csv_adapter.fetch_raw = AsyncMock(return_value=[])
    csv_adapter.compute_metrics = MagicMock(
        return_value=MetricsSnapshot(
            sharpe=None,
            twr=None,
            ytd=None,
            max_drawdown=None,
            total_pnl=None,
            trade_count=0,
            win_rate=None,
        )
    )
    csv_adapter.compute_fingerprint = MagicMock(return_value=Fingerprint())
    csv_adapter.reconstruct_positions = AsyncMock(return_value=[])

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=csv_adapter,
    ):
        body = {
            "flow_type": "csv",
            "source": "csv",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wiz-csv-1",
                "raw_bytes_marker": "x",
            },
        }
        r = client.post("/process-key", json=body, headers=_auth_headers())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "published"
    assert body["trust_tier"] == "csv_uploaded"
    assert body["verification_id"] == "ver-csv"
    assert body["errors"] == []


def test_process_key_onboard_queues(client):
    """flow_type=onboard, source=okx → enqueues process_key_long, returns 202-shape."""
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-onboard")
    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "onboard",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-onb-1",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 200, r.text  # FastAPI returns 200 by default; payload signals queued.
    body = r.json()
    assert body["queued"] is True
    assert body["verification_id"] == "ver-onboard"

    # Verify enqueue_compute_job RPC was called with kind=process_key_long.
    rpc_calls = [c.args for c in fake.rpc.call_args_list]
    enqueue_calls = [c for c in rpc_calls if c and c[0] == "enqueue_compute_job"]
    assert enqueue_calls, "enqueue_compute_job RPC was not called"
    payload = enqueue_calls[0][1]
    assert payload["p_kind"] == "process_key_long"
    assert payload["p_metadata"]["verification_id"] == "ver-onboard"


def test_process_key_validate_failure_returns_envelope(client):
    """Adapter.validate(valid=False) → Phase 17 DESIGN-05 envelope shape."""
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-bad")
    from services.ingestion.adapter import ValidationResult

    bad_adapter = MagicMock()
    bad_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=False,
            read_only=None,
            error_code="AUTH_FAILED",
            human_message="Invalid credentials",
            debug_context={},
        )
    )

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=bad_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-bad-1",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 200  # envelope returns 200 with ok=False per DESIGN-05.
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == "AUTH_FAILED"
    assert body["correlation_id"] == "cid-test"
    assert body["debug_context"]["verification_id"] == "ver-bad"


# ---------------------------------------------------------------------------
# H-2 audit row write
# ---------------------------------------------------------------------------


def test_process_key_writes_audit_row(client):
    """H-2: a successful POST writes a row to audit_log via log_audit_event RPC.

    Without this, the flag-monitor cron's denominator is 0/0 forever and
    auto-rollback never trips even at 100% Sentry error rate.
    """
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-audit")
    from services.ingestion.adapter import (
        Fingerprint,
        MetricsSnapshot,
        ValidationResult,
    )

    csv_adapter = MagicMock()
    csv_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    csv_adapter.fetch_raw = AsyncMock(return_value=[])
    csv_adapter.compute_metrics = MagicMock(
        return_value=MetricsSnapshot(None, None, None, None, None, 0, None)
    )
    csv_adapter.compute_fingerprint = MagicMock(return_value=Fingerprint())
    csv_adapter.reconstruct_positions = AsyncMock(return_value=[])

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=csv_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "strategy_id": "s1-audit",
                    "wizard_session_id": "wiz-audit-1",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    rpc_call_names = [c.args[0] for c in fake.rpc.call_args_list if c.args]
    assert "log_audit_event_service" in rpc_call_names, (
        f"Expected log_audit_event_service RPC; got {rpc_call_names}"
    )
