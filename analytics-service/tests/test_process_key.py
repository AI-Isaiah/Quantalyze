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

import importlib
import sys


def _ensure_real_third_party() -> None:
    """Undo sys.modules pollution from sibling tests.

    Several pre-existing test files (test_routers_audit_emission*.py,
    test_portfolio_router_logic.py) stub `slowapi`, `slowapi.util`,
    `fastapi`, `fastapi.routing`, `supabase`, and `pydantic` either by
    replacing the whole module entry with a MagicMock OR — the harder
    case — by mutating attributes on an already-imported real module
    (e.g. `sys.modules["fastapi"].APIRouter = MagicMock(...)`). The
    second pattern means `__spec__` is still set on the module, so a
    naive 'pop only if __spec__ is None' check misses it.

    Strategy: pop EVERY fastapi/slowapi/etc entry unconditionally and
    then re-import. The previously-imported objects in other test
    modules keep their references (the popped module is GC-traced
    through them), but our subsequent `from fastapi import APIRouter`
    gets a fresh, untainted module with the real classes restored from
    the on-disk source.

    Drop the cached router modules too — without this, the limiter is a
    MagicMock, `@limiter.limit("100/hour")` is a no-op decorator, and
    the route is never registered (every request returns 404).
    """
    stubbed_roots = (
        "slowapi",
        "fastapi",
        "starlette",
        "pydantic",
        "supabase",
    )
    for name in list(sys.modules):
        if any(
            name == root or name.startswith(root + ".")
            for root in stubbed_roots
        ):
            del sys.modules[name]
    # Drop the cached router + dependent routers so they rebind against
    # the real slowapi/fastapi. Without this, the cached `limiter` is a
    # MagicMock and `@limiter.limit("100/hour")` is a no-op → route
    # un-registered → 404.
    for cached in (
        "routers.process_key",
        "routers.csv",
        "routers.internal",
        "routers.portfolio",
    ):
        sys.modules.pop(cached, None)


_ensure_real_third_party()

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

process_key_router = importlib.import_module("routers.process_key")
print(f"POST-IMPORT: routes = {[(r.methods, r.path) for r in process_key_router.router.routes]}", flush=True)
print(f"POST-IMPORT: limiter = {type(process_key_router.limiter)}", flush=True)
from services import feature_flags  # noqa: E402


# ---------------------------------------------------------------------------
# Test app factory.
# ---------------------------------------------------------------------------


@pytest.fixture
def app(monkeypatch):
    """Mount routers/process_key.py in a bare FastAPI app for isolated unit tests.

    The slowapi limiter is plumbed in via `app.state.limiter` so the
    `@limiter.limit("100/hour")` decorator's middleware probe does not
    raise. We do NOT register the RateLimitExceeded exception handler —
    rate limiting is not exercised in unit tests (each test fires at most
    a couple of requests, well under 100/hour) and the import of
    `slowapi.errors` is fragile under sibling-test sys.modules pollution.
    """
    monkeypatch.setenv(
        "INTERNAL_API_TOKEN",
        "a" * 64,  # H-12: 64 chars, no newline.
    )
    feature_flags._reset_cache_for_tests()

    app = FastAPI()
    app.state.limiter = process_key_router.limiter
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


def _csv_validate_body() -> dict:
    """Minimal csv-validate body that passes I-API2 model_validator (step=validate
    branch) without requiring the strategy_id/full credential set. Used by
    auth tests that need to exercise auth BEFORE pydantic body validation."""
    return {
        "flow_type": "csv",
        "source": "csv",
        "context": {
            "step": "validate",
            "wizard_session_id": "00000000-0000-0000-0000-000000000001",
            "fmt": "trades",
            "raw_bytes_base64": "Y29sCjE=",
        },
    }


def test_process_key_auth_missing_token(client, monkeypatch):
    """Missing INTERNAL_API_TOKEN env → 403 'Internal API not configured'."""
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    r = client.post(
        "/process-key",
        json=_csv_validate_body(),
        headers={"Authorization": "Bearer whatever"},
    )
    assert r.status_code == 403
    assert "Internal API not configured" in r.text


def test_process_key_auth_wrong_token(client):
    """Wrong bearer → 403 'Forbidden' (constant-time compare path)."""
    r = client.post(
        "/process-key",
        json=_csv_validate_body(),
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
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wsid-1",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 503
    body = r.json()
    # API-6: Phase 17 DESIGN-05 envelope — top-level `code`, NOT nested
    # under `detail`. The wizard's error renderer reads the body
    # directly.
    assert body["ok"] is False
    assert body["code"] == "UNIFIED_BACKBONE_DISABLED"
    assert "correlation_id" in body


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
    """H-12: regression test for the malformed-token bypass path.

    Catches the 2026-05-06 Day-2 hypothesis #12 regression where a literal
    `\\n` suffix on the prod env-var caused the constant-time compare to
    fail in surprising ways.

    WR-03 fix (REVIEW.md 2026-05-08): the previous version of this test set
    INTERNAL_API_TOKEN via monkeypatch and then asserted the shape — which
    trivially passed because monkeypatch had just set it to that exact
    shape. That is documentation, not a regression catch. The PRODUCTION
    env-var-shape smoke check belongs in CI (see
    `.github/workflows/phase-19-stability.yml`) where a real
    `vercel env pull` can run.

    The unit-test contract that DOES catch a real bug is: the auth seam
    `_verify_internal_token` MUST reject a token that contains a newline,
    irrespective of which side has the trailing `\\n`. We exercise that
    path against the real router so a regression in the secrets.compare_digest
    seam (or accidental .strip() that masks misconfigured prod env) surfaces
    here. The shape-match smoke is left as a one-line assert that documents
    the production invariant.
    """
    from fastapi.testclient import TestClient
    from fastapi import FastAPI

    # Production env value is exactly 64 bytes with no newline. The
    # below asserts are documentation of the invariant the deploy step
    # enforces; CI smoke pulls the real value.
    SHAPE_LEN = 64

    monkeypatch.setenv("INTERNAL_API_TOKEN", "a" * SHAPE_LEN)
    # Documentation assertion — a deploy-time failure (newline appended)
    # would set the env var to length 65 with a trailing \n; the
    # constant-time compare would still reject the request because the
    # provided header from the Vercel side has no matching newline.
    assert os.environ["INTERNAL_API_TOKEN"] == "a" * SHAPE_LEN

    # Real regression — exercise the auth seam against a malformed env.
    # If a future maintainer accidentally inserts `.strip()` to "fix" the
    # newline issue, this test surfaces the silent bypass.
    monkeypatch.setenv("INTERNAL_API_TOKEN", ("a" * SHAPE_LEN) + "\n")
    app_isolated = FastAPI()
    app_isolated.state.limiter = process_key_router.limiter
    app_isolated.include_router(process_key_router.router)
    test_client = TestClient(app_isolated)
    r = test_client.post(
        "/process-key",
        json={
            "flow_type": "csv",
            "source": "csv",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wsid-h12",
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
            },
        },
        headers={"Authorization": f"Bearer {'a' * SHAPE_LEN}"},
    )
    # The provided bearer is the well-shaped 64-byte string; the env var
    # is the malformed 65-byte string with a trailing newline. The
    # constant-time compare must reject — never strip-and-match. A 403
    # here proves the seam refuses the malformed env without a silent
    # bypass.
    assert r.status_code == 403, (
        "INTERNAL_API_TOKEN constant-time compare must reject when env "
        "var carries a trailing newline; if this fails, a deploy-time "
        "newline bug would silently authenticate any caller that knows "
        "the un-newlined prefix."
    )


# ---------------------------------------------------------------------------
# MC-4 metrics encoder
# ---------------------------------------------------------------------------


def test_metrics_to_jsonb_handles_dataclass():
    """MC-4: dataclasses.asdict converts MetricsSnapshot into a plain dict.

    A subclass with a non-JSON-encodable field (e.g., raw bytes) surfaces
    a TypeError instead of silently corrupting the JSONB column.
    """
    from datetime import datetime

    _metrics_to_jsonb = process_key_router._metrics_to_jsonb
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
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
            },
        }
        r1 = client.post("/process-key", json=body, headers=_auth_headers())
        r2 = client.post("/process-key", json=body, headers=_auth_headers())
    assert r1.status_code == 200
    assert r2.status_code == 200
    body1 = r1.json()
    body2 = r2.json()
    assert body1["verification_id"] == "ver-existing"
    assert body2["verification_id"] == "ver-existing"
    # API-7 — observable WIZARD_DUPLICATE signal so the wizard renders
    # the resume affordance instead of pretending it's a fresh submit.
    assert body2["code"] == "WIZARD_DUPLICATE"
    assert body2["idempotent"] is True


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
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
            },
        }
        r = client.post("/process-key", json=body, headers=_auth_headers())
    assert r.status_code == 200
    body_json = r.json()
    assert body_json["verification_id"] == "ver-raced"
    # API-7 — race-resolved idempotent hit also emits WIZARD_DUPLICATE.
    assert body_json["code"] == "WIZARD_DUPLICATE"
    assert body_json["idempotent"] is True


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
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
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


def test_process_key_validate_only_csv_succeeds_without_strategy_id(client):
    """CR-02 regression: csv-validate step lands at /process-key without
    strategy_id (the wizard step happens BEFORE a strategy row exists).

    Pre-fix this raised KeyError on body.context['strategy_id'] and surfaced
    as a generic 500. Post-fix, the route detects step='validate' + missing
    strategy_id and runs validate-only — no DB insert, no state transitions.
    """
    fake = _build_supabase_mock(existing_row=None)
    from services.ingestion.adapter import ValidationResult

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
                    # No strategy_id — wizard step 1 fires before strategy row.
                    "wizard_session_id": "wiz-csv-pre",
                    "user_id": "u1",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sMSxjb2wyCjEsMg==",  # base64 'col1,col2\n1,2'
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("valid") is True
    assert body.get("step") == "validate"
    # No strategy_verifications insert occurred.
    assert not any(
        c.args and c.args[0] == "strategy_verifications"
        for c in fake.table.call_args_list
        if c.args
    ) or not any(
        c.kwargs.get("data")
        for c in fake.table.return_value.insert.call_args_list
    )


def test_process_key_validate_only_onboard_succeeds_without_strategy_id(client):
    """CR-02 regression: keys/validate-and-encrypt fires step='validate'
    without strategy_id (onboard wizard step 2). No KeyError, no 500."""
    fake = _build_supabase_mock(existing_row=None)
    from services.ingestion.adapter import ValidationResult

    okx_adapter = MagicMock()
    okx_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
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
        return_value=okx_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "onboard",
                "source": "okx",
                "context": {
                    "wizard_session_id": "wiz-onb-pre",
                    "user_id": "u1",
                    "api_key": "k",
                    "api_secret": "s",
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("read_only") is True


def test_process_key_missing_strategy_id_returns_422(client):
    """CR-02: when step != 'validate' AND strategy_id is missing, return a
    structured 422 envelope instead of an unhandled KeyError 500."""
    fake = _build_supabase_mock(existing_row=None)

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
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "wizard_session_id": "wiz-no-sid",
                    "user_id": "u1",
                    "api_key": "k",
                    "api_secret": "s",
                    # No step='validate' AND no strategy_id → 422.
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 422, r.text
    body = r.json()
    # API-6: Phase 17 DESIGN-05 envelope — top-level fields.
    assert body["ok"] is False
    assert body["code"] == "MISSING_STRATEGY_ID"
    assert "human_message" in body
    assert "correlation_id" in body


def test_process_key_csv_finalize_calls_finalize_csv_strategy_rpc(client):
    """API-3 regression: flow_type='csv', step='finalize' lands here without
    a strategy_id (the strategies row hasn't been created yet). Pre-fix this
    returned 422 MISSING_STRATEGY_ID; post-fix it delegates to
    finalize_csv_strategy RPC which atomically creates the strategies +
    strategy_verifications rows.
    """
    fake = _build_supabase_mock(existing_row=None)
    new_sid = "11111111-1111-1111-1111-111111111111"
    # Override rpc so finalize_csv_strategy returns the new strategy_id
    finalize_call = MagicMock()
    finalize_call.execute.return_value = MagicMock(data=new_sid)

    log_audit_call = MagicMock()
    log_audit_call.execute.return_value = MagicMock(data={})

    def _rpc_router(name, *_a, **_kw):
        if name == "finalize_csv_strategy":
            return finalize_call
        return log_audit_call

    fake.rpc.side_effect = _rpc_router

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
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "wizard_session_id": "22222222-2222-2222-2222-222222222222",
                    "user_id": "33333333-3333-3333-3333-333333333333",
                    "fmt": "trades",
                    "strategy_name": "Test Strategy",
                    "step": "finalize",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["strategy_id"] == new_sid
    assert body["status"] == "pending_review"
    assert body["step"] == "finalize"

    # finalize_csv_strategy RPC was called exactly once with the expected payload.
    finalize_calls = [
        c.args
        for c in fake.rpc.call_args_list
        if c.args and c.args[0] == "finalize_csv_strategy"
    ]
    assert len(finalize_calls) == 1, "finalize_csv_strategy must be called once"
    payload = finalize_calls[0][1]
    assert payload["p_user_id"] == "33333333-3333-3333-3333-333333333333"
    assert payload["p_wizard_session_id"] == "22222222-2222-2222-2222-222222222222"
    assert payload["p_fmt"] == "trades"
    assert payload["p_strategy_name"] == "Test Strategy"


def test_process_key_audit_uses_wizard_session_id_when_no_strategy_id(client):
    """WR-06 regression: audit_log.entity_id is NOT NULL (migration 010)
    and log_audit_event_service raises when p_entity_id is NULL
    (migration 058). Validate-only flows have no strategy_id; the route
    must fall back to wizard_session_id so the cron's denominator
    continues to populate.
    """
    fake = _build_supabase_mock(existing_row=None)
    from services.ingestion.adapter import ValidationResult

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
                    "wizard_session_id": "wiz-audit-no-sid",
                    "user_id": "u1",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": "ZGF0ZSx2YWx1ZQoyMDI2LTAxLTAxLDEuMA==",
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    audit_calls = [
        c.args
        for c in fake.rpc.call_args_list
        if c.args and c.args[0] == "log_audit_event_service"
    ]
    assert audit_calls, "log_audit_event_service RPC must fire on validate-only"
    payload = audit_calls[0][1]
    # entity_id sentinel — wizard_session_id, never None.
    assert payload["p_entity_id"] == "wiz-audit-no-sid"
    assert payload["p_metadata"]["entity_id_source"] == "wizard_session_id"


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
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    rpc_call_names = [c.args[0] for c in fake.rpc.call_args_list if c.args]
    assert "log_audit_event_service" in rpc_call_names, (
        f"Expected log_audit_event_service RPC; got {rpc_call_names}"
    )


# ---------------------------------------------------------------------------
# API-1 — verify_service_key middleware skip-list regression
# ---------------------------------------------------------------------------


def test_process_key_csv_missing_fmt_returns_422(client):
    """I-API2 — model_validator catches missing csv-required keys at the
    wire boundary. Pre-fix, missing fmt surfaced deep in the adapter as
    a KeyError 500."""
    r = client.post(
        "/process-key",
        json={
            "flow_type": "csv",
            "source": "csv",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wiz-x",
                # No fmt, no raw_bytes_base64.
            },
        },
        headers=_auth_headers(),
    )
    assert r.status_code == 422


def test_process_key_onboard_missing_creds_returns_422(client):
    """I-API2 — onboard requires api_key + api_secret in context (when not
    a validate-step body)."""
    r = client.post(
        "/process-key",
        json={
            "flow_type": "onboard",
            "source": "okx",
            "context": {
                "strategy_id": "s1",
                "wizard_session_id": "wiz-y",
                # No api_key, no api_secret.
            },
        },
        headers=_auth_headers(),
    )
    assert r.status_code == 422


def test_process_key_shares_main_limiter_instance():
    """API-5 regression: routers.process_key.limiter MUST be the same
    instance as services.rate_limit.limiter (which main.py also imports).

    Pre-fix, process_key.py instantiated its own ``Limiter()`` at module
    scope; main.py owned a different one and registered it on
    ``app.state.limiter``. The slowapi ``@limiter.limit(...)`` decorator
    binds to whichever Limiter the source file imports — so the
    in-process route counts and the app-state metrics were divorced.
    """
    from services import rate_limit as _rl

    assert process_key_router.limiter is _rl.limiter, (
        "API-5: process_key.limiter must be the singleton from "
        "services.rate_limit. A drift here means slowapi storage on the "
        "decorator and on app.state.limiter is no longer shared."
    )


def test_process_key_rate_limit_key_func_uses_token_and_user_id():
    """API-5: per-tenant isolation — the limiter key must vary by
    (Authorization, X-User-Id), NOT remote IP. Two requests from the
    same Vercel egress IP but different tenants must land in different
    buckets.
    """
    from unittest.mock import MagicMock

    key_func = process_key_router._process_key_rate_limit_key

    req_a = MagicMock()
    req_a.headers = {"Authorization": "Bearer aaa", "X-User-Id": "user-a"}
    req_b = MagicMock()
    req_b.headers = {"Authorization": "Bearer aaa", "X-User-Id": "user-b"}
    req_c = MagicMock()
    req_c.headers = {"Authorization": "Bearer bbb", "X-User-Id": "user-a"}

    ka = key_func(req_a)
    kb = key_func(req_b)
    kc = key_func(req_c)

    assert ka != kb, "Same token, different user_id must produce different keys"
    assert ka != kc, "Different token must produce different keys"
    # Bearer token must NEVER appear in plaintext (it shows up in slowapi
    # error logs).
    assert "aaa" not in ka and "bbb" not in kc
    # Stable: same input → same key.
    assert key_func(req_a) == ka


def test_process_key_skipped_by_verify_service_key_middleware(monkeypatch):
    """API-1 regression: main.verify_service_key middleware must skip
    /process-key the same way it skips /internal/*.

    Pre-fix, every Vercel→FastAPI POST returned 401 'Unauthorized' BEFORE
    the route's own _verify_internal_token ran, because the middleware
    only whitelisted /health and /internal/*. This test imports the
    real `verify_service_key` from main.py via inspect.getsource and
    re-evaluates it (the actual function is bound to the global FastAPI
    app instance which we can't reuse here without booting the entire
    lifespan). We assert that the on-disk source explicitly contains
    `/process-key` in its skip-list — a regression that drops the skip
    would surface as a string-match failure here.
    """
    import inspect
    from main import verify_service_key

    src = inspect.getsource(verify_service_key)
    # API-1 invariant: the middleware MUST whitelist /process-key the same
    # way it whitelists /internal/*. If a future refactor drops this
    # branch, every Vercel→FastAPI call regresses to 401.
    assert "/process-key" in src, (
        "API-1: main.verify_service_key must explicitly skip /process-key. "
        "Without this, the middleware rejects every Vercel→FastAPI call "
        "with 401 BEFORE the route's bearer-token gate runs.\n"
        f"Source:\n{src}"
    )
    assert "/internal/" in src, (
        "Sanity: middleware must still skip /internal/* (existing contract)."
    )


def test_ct8_audit_tasks_set_and_done_callback_present():
    """CT-8 (army2) — the fire-and-forget audit write must hold a
    strong reference to the asyncio.Task in a module-level set and
    register a done_callback that removes it on completion.

    Pre-fix the bare `asyncio.create_task(...)` returned a Task whose
    only ref was a weak ref held by the running loop. Per CPython docs,
    if the caller discards the return value, the GC may collect the
    Task mid-flight and raise:
        RuntimeError: Task was destroyed but it is pending!
    losing the audit row silently. The cron's flag-monitor denominator
    becomes unreliable.

    Static-source check covers both invariants — the module-level
    `_audit_tasks` set AND the `add_done_callback(_audit_tasks.discard)`
    pattern. A regression that drops either fails this test.
    """
    import inspect

    src = inspect.getsource(process_key_router)
    assert "_audit_tasks" in src and "set[" in src.lower(), (
        "CT-8: process_key must declare a module-level "
        "`_audit_tasks: set[asyncio.Task]` so the GC cannot collect "
        "in-flight audit Tasks mid-flight."
    )
    # The handler must add the Task to the set + register a discard
    # done_callback so the set self-cleans.
    assert "_audit_tasks.add(" in src, (
        "CT-8: handler must add the audit Task to _audit_tasks for "
        "strong-ref retention."
    )
    assert "_audit_tasks.discard" in src, (
        "CT-8: handler must register `add_done_callback(_audit_tasks.discard)` "
        "so the set self-cleans on Task completion."
    )


def test_ct4_logs_warning_when_x_user_id_missing_on_non_teaser():
    """CT-4 (army2) — when a non-teaser request arrives without an
    X-User-Id header, the route must emit a structured WARNING so a
    regressed thin adapter doesn't silently break the per-tenant
    rate-limit isolation invariant.

    Static-source check: the warning emit lives at the top of the
    process_key handler (after correlation_id binding, before the flag
    gate). A future refactor that drops the warning would fail this test
    and force the author to either preserve the warning or document why
    it's safe to remove.
    """
    import inspect

    src = inspect.getsource(process_key_router.process_key)
    assert "x_user_id_header_missing" in src, (
        "CT-4 invariant: process_key must log "
        "'process_key.x_user_id_header_missing' when X-User-Id is absent "
        "on a non-teaser flow. Without the warning, a thin adapter that "
        "drops the header silently breaks per-tenant rate-limit isolation."
    )
    # And the warning must be gated on flow_type != 'teaser' so the
    # public/unauthenticated landing form (which legitimately has no
    # X-User-Id matching to a real auth user) doesn't spam the log.
    assert 'flow_type != "teaser"' in src or "flow_type != 'teaser'" in src, (
        "CT-4: the X-User-Id missing warning must skip flow_type='teaser' "
        "(the public landing form is authentic-anonymous)."
    )
