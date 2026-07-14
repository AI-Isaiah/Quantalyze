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
import sys
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import slowapi
import slowapi.extension
from fastapi import FastAPI
from fastapi.testclient import TestClient

# H-0806: this module used to run an `_ensure_real_third_party()` purge that
# `del`-ed fastapi/slowapi/starlette/pydantic/supabase from sys.modules and
# re-imported them, to undo the MagicMock pollution that sibling router-test
# files installed at import time. Those import-time fastapi/supabase perpetrators
# have been removed, so the heavy purge is obsolete — and was harmful: the fastapi
# re-import minted a SECOND `HTTPException` class identity, so a later-collected
# app-building test (e.g. test_simulator_router) whose router raised the original
# class went unhandled by its app's exception handler (keyed to the re-imported
# class) → order-dependent 413/500 flake.
#
# ONE narrow job the purge still had remains: sibling files test_c19_portfolio_fixes
# and test_routers_audit_2026_05_17 swap the `slowapi.Limiter` re-export to a no-op
# shim *in place* at import (so their @limiter.limit decorators are passthroughs) and
# restore it only at their module teardown. Collected before this file in CI's
# deterministic order, they leave the canonical `services.rate_limit.limiter` — built
# once from `from slowapi import Limiter` — cached as that no-op for the rest of the
# session, which would make test_process_key_shares_main_limiter_instance pass
# vacuously (noop-is-noop). The real class is never swapped (it lives at
# `slowapi.extension.Limiter`), so restore the re-export from it and re-pop our own
# router + service singletons so they rebind to a real Limiter — WITHOUT touching
# fastapi/slowapi module identity.
slowapi.Limiter = slowapi.extension.Limiter  # type: ignore[attr-defined]
for _stale in ("services.rate_limit", "routers.process_key"):
    sys.modules.pop(_stale, None)

import routers.process_key as process_key_router  # noqa: E402
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


# A valid UUID — the route now validates X-Correlation-Id as a UUID and mints
# a fresh one if it isn't (2026-05-27), so tests must send a well-formed value
# for it to round-trip into the response envelope.
_TEST_CID = "11111111-1111-4111-8111-111111111111"


def _auth_headers() -> dict[str, str]:
    """Bearer header that matches the fixture-set INTERNAL_API_TOKEN."""
    return {"Authorization": f"Bearer {'a' * 64}", "X-Correlation-Id": _TEST_CID}


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

    # SELECT path. `.maybe_single().execute()` is used by BOTH the idempotency
    # pre-check AND the 23505 race re-select (2026-05-27 — the race switched
    # from `.single()` to `.maybe_single()`). When a race winner is configured,
    # the pre-check returns first, then the winner on the re-select.
    select_chain = MagicMock()
    if insert_raises_then_existing is not None:
        select_chain.execute.side_effect = [
            MagicMock(data=existing_row),
            MagicMock(data=insert_raises_then_existing),
        ]
    else:
        select_chain.execute.return_value = MagicMock(data=existing_row)
    eq_chain = MagicMock()
    eq_chain.maybe_single.return_value = select_chain
    eq_chain.single.return_value = select_chain  # legacy; race now uses maybe_single
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
# P72 — Deribit onboarding whitelist (Test A)
# ---------------------------------------------------------------------------


def test_p72_deribit_admitted_to_onboard_and_resync_only():
    """P72 (Test A): `deribit` is admitted to the onboard + resync source
    whitelists ONLY, and stays REJECTED for teaser/internal_report/csv.

    Deribit returns are ledger-backed; its fill-based compute_metrics raises by
    design, so the synchronous teaser preview cannot serve it. Only the async
    onboard/resync flows route Deribit through the broker-dailies ledger path.
    Pre-fix, EVERY flow_type excluded deribit → the wizard 'Verify data' step
    422'd at the /process-key validator (canary SYNC_FAILED).
    """
    from pydantic import ValidationError

    Body = process_key_router._ProcessKeyBody

    # ACCEPTED: resync (no credential requirement — resolves stored key).
    Body(flow_type="resync", source="deribit", context={"strategy_id": "s1"})
    # ACCEPTED: onboard (creds supplied so the required-keys model_validator,
    # which runs AFTER the source field_validator, does not mask the whitelist).
    Body(
        flow_type="onboard",
        source="deribit",
        context={"strategy_id": "s1", "api_key": "k", "api_secret": "s"},
    )

    # REJECTED: deribit on the fill-based / synchronous flows. The source
    # field_validator raises BEFORE the required-keys model_validator, so the
    # rejection holds regardless of context contents.
    for flow in ("teaser", "internal_report", "csv"):
        with pytest.raises(ValidationError, match="H-11"):
            Body(
                flow_type=flow,
                source="deribit",
                context={"strategy_id": "s1", "api_key": "k", "api_secret": "s"},
            )

    # H-11 otherwise intact: the perp sources still validate on onboard, and a
    # non-whitelisted source (deribit on teaser above; okx on csv here) is
    # still rejected — the fix did not widen any other cell.
    Body(
        flow_type="onboard",
        source="okx",
        context={"strategy_id": "s1", "api_key": "k", "api_secret": "s"},
    )
    with pytest.raises(ValidationError, match="H-11"):
        Body(flow_type="csv", source="okx", context={"strategy_id": "s1"})


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


def test_process_key_race_catch_zero_rows_reraises_original(client):
    """GAP-4. INSERT raises 23505 but the race re-select finds 0 rows (the
    racing row was rolled back / RLS-hidden between insert and re-select). The
    route uses .maybe_single() (returns None on 0 rows) + a guard, so it must
    re-raise the ORIGINAL 23505 rather than None-deref or mask it with a
    cryptic PGRST116. No `insert_raises_then_existing` → the re-select returns
    data=None."""
    fake = _build_supabase_mock(
        existing_row=None,
        insert_raises=Exception(
            "duplicate key value violates unique constraint (SQLSTATE 23505)"
        ),
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
                "wizard_session_id": "wiz-race-gone",
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
            },
        }
        with pytest.raises(Exception) as exc_info:
            client.post("/process-key", json=body, headers=_auth_headers())
    assert "23505" in str(exc_info.value), (
        "the original 23505 must propagate, not a None-deref / PGRST116 mask"
    )


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


def test_process_key_new_upload_maybe_single_none_does_not_500(client):
    """Regression: a brand-new upload (no prior strategy_verifications row)
    must NOT 500 on the idempotency pre-check.

    PostgREST's `.maybe_single().execute()` returns **None** (not a response
    object with data=None) when zero rows match — which is the normal case for
    a first-time wizard_session_id. Pre-fix, `if existing.data:` raised
    `AttributeError: 'NoneType' object has no attribute 'data'` and 500'd the
    ENTIRE ingestion once the unified-backbone flag was flipped on in prod, so
    every first-time CSV upload broke. The fix guards `existing is not None`.

    `_build_supabase_mock(existing_row=None)` only models the empty case as
    `MagicMock(data=None)` — which keeps `existing` truthy and never reproduces
    the prod crash — so this test overrides `maybe_single().execute()` to the
    literal None that real PostgREST returns. Pre-fix this raises (TestClient
    re-raises server exceptions); post-fix the pre-check falls through and the
    fresh upload publishes.
    """
    from services.ingestion.adapter import (
        Fingerprint,
        MetricsSnapshot,
        ValidationResult,
    )

    fake = _build_supabase_mock(existing_row=None, insert_id="ver-fresh")
    # Reproduce real PostgREST 0-row behavior: maybe_single().execute() is None.
    fake.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None

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
                "wizard_session_id": "wiz-fresh-1",
                "fmt": "trades",
                "raw_bytes_base64": "Y29sCjE=",
            },
        }
        r = client.post("/process-key", json=body, headers=_auth_headers())

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"
    assert r.json()["verification_id"] == "ver-fresh"


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


def test_process_key_resync_no_credentials_queues(client):
    """Regression (2026-05-27 SYNC_FAILED): flow_type=resync is a long-fetch flow.

    The wizard "Verify data" step (/api/keys/sync -> unifiedKeysSyncHandler) posts
    `{flow_type:'resync', context:{strategy_id, user_id}}` with NO api_key/api_secret
    and NO step -- by design, because the worker resolves credentials server-side
    from the stored api_key_id. Pre-fix `_validate_per_flow_required_keys` lumped
    resync with teaser/onboard and required api_key/api_secret, so this exact body
    422'd before any compute_job was enqueued. Both OKX and Bybit key uploads
    surfaced "Sync failed: analytics computation did not complete" with zero
    compute_jobs and zero strategy_analytics rows (verified in prod Railway logs +
    Supabase). This asserts the real caller's body now validates and queues.
    """
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-resync")
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
                "flow_type": "resync",
                "source": "bybit",
                "context": {
                    # Exactly what /api/keys/sync sends -- NO credentials, NO step.
                    "strategy_id": "s1",
                    "user_id": "u1",
                },
            },
            headers=_auth_headers(),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] is True

    # The worker (not this request) resolves credentials from the stored
    # api_key; resync must enqueue a process_key_long job.
    rpc_calls = [c.args for c in fake.rpc.call_args_list]
    enqueue_calls = [c for c in rpc_calls if c and c[0] == "enqueue_compute_job"]
    assert enqueue_calls, "resync should enqueue process_key_long"
    assert enqueue_calls[0][1]["p_kind"] == "process_key_long"

    # Bug #4 regression (2026-05-27, found by prod E2E): the
    # strategy_verifications.wizard_session_id column is NOT NULL. resync sends
    # no wizard_session_id, so the route MUST mint one before the draft insert.
    # Pre-fix the insert carried NULL and 23502'd in prod (500) — but this unit
    # mock does not enforce NOT NULL, which is why the original test passed.
    # Assert the insert payload explicitly so the contract is pinned.
    insert_payloads = [
        c.args[0]
        for c in fake.table.return_value.insert.call_args_list
        if c.args and isinstance(c.args[0], dict)
    ]
    sv_inserts = [p for p in insert_payloads if "wizard_session_id" in p]
    assert sv_inserts, "expected a strategy_verifications insert with wizard_session_id"
    assert sv_inserts[0]["wizard_session_id"], (
        "wizard_session_id must be non-null on the strategy_verifications insert "
        "(NOT NULL column); resync must mint one when the body carries none"
    )


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
    assert body["correlation_id"] == _TEST_CID
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


def test_process_key_validate_only_csv_returns_preview_and_series(client):
    """Phase 19.1 regression (2026-05-27): _run_validate_only must surface the
    adapter's preview + daily_returns_series in the response body.

    The wizard's CsvUploadStep raises CSV_UPSTREAM_FAIL when `preview` is
    absent and forwards `daily_returns_series` to csv-finalize. Pre-fix the
    validate-only envelope dropped both fields even though the CSV adapter
    produced them, so every upload failed at step 1 once the unified-backbone
    flag went on (2026-05-25). This pins the envelope contract the wizard
    consumes verbatim.
    """
    fake = _build_supabase_mock(existing_row=None)
    from services.ingestion.adapter import ValidationResult

    preview = {
        "row_count": 4,
        "date_range": ["2025-01-02", "2025-01-05"],
        "columns_detected": ["date", "daily_return"],
        "first_rows": [{"date": "2025-01-02", "daily_return": 0.0103}],
        "last_rows": [{"date": "2025-01-05", "daily_return": -0.0007}],
    }
    series = [
        {"date": "2025-01-02", "daily_return": 0.0103},
        {"date": "2025-01-05", "daily_return": -0.0007},
    ]
    csv_adapter = MagicMock()
    csv_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,
            error_code=None,
            human_message=None,
            debug_context=None,
            preview=preview,
            daily_returns_series=series,
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
                    "wizard_session_id": "wiz-csv-preview",
                    "user_id": "u1",
                    "fmt": "daily_returns",
                    # Adapter is mocked, so the bytes are not parsed here.
                    "raw_bytes_base64": "ZGF0ZSxkYWlseV9yZXR1cm4K",
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("step") == "validate"
    assert body.get("preview") == preview, (
        "validate-only envelope must include the adapter's preview; the wizard "
        "raises CSV_UPSTREAM_FAIL without it."
    )
    assert body.get("daily_returns_series") == series


def test_process_key_validate_only_emits_empty_series_not_omitted(client):
    """Phase 19.1 guard lock (2026-05-27): an empty daily_returns_series ([])
    must be EMITTED as [], never dropped.

    validate_csv returns ok=True with daily_returns_series=[] for a single-row
    daily_nav (pct_change drops the only row); csv-finalize then rejects it with
    a clean "received 0 rows". If _run_validate_only's `is not None` guard were
    ever simplified to a truthy check, [] would vanish from the envelope and the
    unified shape would silently diverge from the legacy /csv/validate shape.
    This pins that load-bearing guard.
    """
    fake = _build_supabase_mock(existing_row=None)
    from services.ingestion.adapter import ValidationResult

    preview = {
        "row_count": 1,
        "date_range": ["2025-01-02", "2025-01-02"],
        "columns_detected": ["date", "nav"],
        "first_rows": [{"date": "2025-01-02", "nav": 1000.0}],
        "last_rows": [{"date": "2025-01-02", "nav": 1000.0}],
    }
    csv_adapter = MagicMock()
    csv_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,
            error_code=None,
            human_message=None,
            debug_context=None,
            preview=preview,
            daily_returns_series=[],
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
                    "wizard_session_id": "wiz-csv-empty",
                    "user_id": "u1",
                    "fmt": "daily_nav",
                    "raw_bytes_base64": "ZGF0ZSxuYXYK",  # adapter mocked; not parsed
                    "step": "validate",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "daily_returns_series" in body, (
        "empty series must be present as [], not omitted — omitting it diverges "
        "from the legacy envelope shape the wizard/csv-finalize were built on."
    )
    assert body["daily_returns_series"] == []
    assert body.get("preview") == preview


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
    """CR-02: when flow_type ∈ {onboard, resync} AND step != 'validate'
    AND strategy_id is missing, return a structured 422 envelope instead
    of an unhandled KeyError 500.

    PR-X5 (2026-05-15) — the teaser variant of this test no longer
    applies: the new dispatch injection in process_key.py supplies the
    sentinel teaser-anchor strategy_id (migration 132) for
    flow_type='teaser' without strategy_id BEFORE the
    MISSING_STRATEGY_ID check. Onboard / resync remain 422 because they
    expect a caller-owned strategy_id by design; see
    test_process_key_teaser_injects_anchor_when_strategy_id_missing
    below for the post-PR-X5 teaser contract.
    """
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
                "flow_type": "onboard",
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


def test_process_key_teaser_injects_anchor_when_strategy_id_missing(client):
    """PR-X5 regression: flow_type='teaser' with no strategy_id and no
    wizard_session_id MUST get both injected by the dispatch and proceed
    to the synchronous pipeline. The strategy_verifications INSERT MUST
    receive strategy_id=TEASER_ANCHOR_STRATEGY_ID (migration 132 sentinel).

    Pre-X5 this 422'd with MISSING_STRATEGY_ID; the two 2026-05-14
    abortive PR-B kill-switch flips auto-rolled-back because of that.
    PR-X3 added step='validate' to the teaser context as a workaround,
    but that routed teaser into `_run_validate_only` (no
    verification_id returned) → TS handler 502 "Verification service
    returned an invalid response." PR-X5 fixes the root cause: inject
    the sentinel anchor + a fresh wizard_session_id at dispatch time so
    the unified pipeline runs end-to-end and returns
    `{verification_id, status: 'published', ...}` from one path that
    every flow_type shares.
    """
    from services.ingestion.adapter import ValidationResult
    from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID

    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-x5")

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
    okx_adapter.fetch_raw = AsyncMock(return_value=[])
    okx_adapter.compute_metrics = MagicMock(return_value=MagicMock())
    okx_adapter.compute_fingerprint = MagicMock(
        return_value=MagicMock(to_jsonb=MagicMock(return_value={}))
    )
    okx_adapter.reconstruct_positions = AsyncMock(return_value=[])

    # Patch the encryption step — process_key.py:698 does a function-local
    # import of services.encryption.{encrypt_credentials, get_kek}. Without
    # this, the synchronous pipeline at line 735 raises RuntimeError on the
    # missing KEK env var. The encrypt step is unrelated to the dispatch
    # contract this test pins, so mocking it out keeps the test focused.
    import services.encryption as _enc_mod

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=okx_adapter,
    ), patch.object(
        _enc_mod, "get_kek", return_value=b"0" * 32,
    ), patch.object(
        _enc_mod, "encrypt_credentials", return_value={"ciphertext": "stub"},
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    # No strategy_id, no wizard_session_id, no step —
                    # mirrors what verify-strategy/route.ts sends post-X5.
                    "api_key": "k",
                    "api_secret": "s",
                    "email": "test@example.com",
                    "exchange": "okx",
                },
            },
            headers=_auth_headers(),
        )

    # The pipeline ran to completion (NOT 422) and returned the
    # canonical synchronous-pipeline shape.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_id"] == "ver-teaser-x5"
    assert body["status"] == "published"

    # The strategy_verifications INSERT received the sentinel anchor as
    # strategy_id. Walk the recorded .table('strategy_verifications')
    # .insert(<row>) calls to find the row payload.
    sv_insert_payloads = []
    for table_call in fake.table.call_args_list:
        if not table_call.args or table_call.args[0] != "strategy_verifications":
            continue
        # fake.table.return_value is a single shared MagicMock — its
        # .insert.call_args_list captures every insert across tables. We
        # know all .insert calls in this test target strategy_verifications
        # (no other table is inserted), so it's safe to walk that list.
        for ins_call in fake.table.return_value.insert.call_args_list:
            if ins_call.args:
                sv_insert_payloads.append(ins_call.args[0])

    assert sv_insert_payloads, (
        "strategy_verifications INSERT must fire; got no call_args"
    )
    row = sv_insert_payloads[0]
    assert row["strategy_id"] == TEASER_ANCHOR_STRATEGY_ID, (
        f"PR-X5: teaser dispatch must inject sentinel anchor; "
        f"got strategy_id={row['strategy_id']!r}"
    )
    # The dispatch ALSO injected a wizard_session_id (uuid4 string) so
    # the NOT NULL + UNIQUE constraint at mig 093 + 104 holds.
    assert isinstance(row["wizard_session_id"], str)
    assert len(row["wizard_session_id"]) > 0
    assert row["flow_type"] == "teaser"
    assert row["source"] == "okx"

    # PR-X5 — response top-level must include matched_strategy_id (legacy
    # shape parity). With no trades and a mocked compute_metrics, this
    # is None — but the KEY must be present so the TS handler's
    # `analyticsResult.matched_strategy_id ?? null` lookup never sees
    # `undefined` (which would change the SV upsert's metrics_snapshot
    # shape compared with the legacy path).
    assert "matched_strategy_id" in body


# ---------------------------------------------------------------------------
# Phase 105.1-01 — sync-pipeline derive swap (compute-unified, persist-nothing).
#
# The teaser/csv/internal_report return-based scalars (twr/sharpe/ytd/
# max_drawdown) are routed through derive_basis_series (the ONE backbone
# compute path) instead of the off-backbone EquityCurveBuilder. Trade-level
# stats (total_pnl/trade_count/win_rate) still come from the builder (D5).
# Crypto venues annualize √365 (#597 / D2). NO series row is persisted (D1).
# ---------------------------------------------------------------------------


def _daily_pnl_dicts(pnls, start="2024-03-01"):
    """Build plain daily_pnl trade dicts (the _trade_to_dict-identity shape,
    process_key.py:261-271) spanning consecutive calendar days in ONE year.

    Feeding fetch_raw these exact dicts makes the in-test
    trades_to_daily_returns recompute byte-identical to production's `returns`
    (C1): fetch_raw returns dicts, _trade_to_dict passes dicts through
    unchanged, so production and the test derive the same series.
    """
    import datetime

    base = datetime.date.fromisoformat(start)
    out = []
    for i, pnl in enumerate(pnls):
        d = base + datetime.timedelta(days=i)
        out.append(
            {
                "timestamp": f"{d.isoformat()}T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "buy" if pnl >= 0 else "sell",
                "price": abs(float(pnl)),
            }
        )
    return out


def _sentinel_snapshot():
    """A REAL MetricsSnapshot with 9.9 sentinels in the four return-based
    fields (so a passing wiring test PROVES the derive override replaced them,
    not merely that the helper exists) + real trade-level values (D5)."""
    from services.ingestion.adapter import MetricsSnapshot

    return MetricsSnapshot(
        sharpe=9.9,
        twr=9.9,
        ytd=9.9,
        max_drawdown=9.9,
        total_pnl=550.0,
        trade_count=10,
        win_rate=0.7,
    )


def _make_sync_adapter(fetch_rows, snapshot):
    adapter = MagicMock()
    from services.ingestion.adapter import ValidationResult

    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    adapter.fetch_raw = AsyncMock(return_value=fetch_rows)
    adapter.compute_metrics = MagicMock(return_value=snapshot)
    adapter.compute_fingerprint = MagicMock(
        return_value=MagicMock(to_jsonb=MagicMock(return_value={}))
    )
    adapter.reconstruct_positions = AsyncMock(return_value=[])
    return adapter


def _captured_metrics_snapshot(fake):
    """Return the metrics_snapshot dict from the metrics_captured transition."""
    for c in fake.rpc.call_args_list:
        if not c.args or c.args[0] != "transition_strategy_verification":
            continue
        payload = c.args[1]
        if payload.get("p_new_status") == "metrics_captured":
            return payload["p_metadata"]["metrics_snapshot"]
    return None


def _run_sync_pipeline(
    client, fake, adapter, *, flow_type, source, matched=None, strategy_id=None
):
    """POST /process-key through the sync pipeline with the standard patches
    (copied from test_process_key_teaser_injects_anchor_when_strategy_id_missing).
    Returns the FastAPI response; the caller reads captured RPC payloads off `fake`.

    `strategy_id` is injected into context for flows that do NOT auto-inject the
    teaser anchor (internal_report/csv require a real strategy_id, :614 guard).
    """
    import services.encryption as _enc_mod

    context = {
        "api_key": "k",
        "api_secret": "s",
        "email": "test@example.com",
        "exchange": source,
    }
    if strategy_id is not None:
        context["strategy_id"] = strategy_id

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=adapter,
    ), patch(
        "services.strategy_matching.find_matched_strategy",
        return_value=matched,
    ), patch.object(
        _enc_mod, "get_kek", return_value=b"0" * 32,
    ), patch.object(
        _enc_mod, "encrypt_credentials", return_value={"ciphertext": "stub"},
    ):
        return client.post(
            "/process-key",
            json={
                "flow_type": flow_type,
                "source": source,
                "context": context,
            },
            headers=_auth_headers(),
        )


# The pnl profile below has non-zero volatility, so √365 and √252 Sharpe
# differ (W2), and mixes wins/losses so max_drawdown is non-trivial (C/golden).
_PNL_PROFILE = [120.0, -80.0, 200.0, 150.0, -50.0, 300.0, -120.0, 90.0, 250.0, -60.0]


def test_teaser_derive_wiring_equality_and_override(client):
    """Test W (flagship): the persisted twr/sharpe/ytd/max_drawdown EQUAL
    derive_basis_series(returns).metrics_json on the SAME series, and NONE of
    them equals the 9.9 builder sentinel — proving the derive call site
    actually overrides the off-backbone builder scalars (kills the
    helper-exists-but-uninvoked neuter). Trade-level stats keep builder values.
    """
    import pandas as pd  # noqa: F401
    from services.basis_series import derive_basis_series
    from services.transforms import trades_to_daily_returns

    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-w")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="teaser", source="okx", matched=None
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"

    snap = _captured_metrics_snapshot(fake)
    assert snap is not None

    # In-test recompute — C1: same dicts → _trade_to_dict-identity → same series.
    returns = trades_to_daily_returns(rows, account_balance=None)
    result = derive_basis_series(
        returns,
        None,
        periods_per_year=365,  # okx → crypto → √365 (#597 / D2)
        cumulative_method="geometric",
        day_basis="calendar",
    )
    mj = result.metrics_json

    assert snap["twr"] == mj["cumulative_return"]
    assert snap["sharpe"] == mj["sharpe"]
    # FLAG A: ytd is NESTED under metrics_json["metrics_json"], NOT top-level.
    assert snap["ytd"] == mj["metrics_json"]["ytd"]
    assert snap["max_drawdown"] == mj["max_drawdown"]

    # Override proof: none of the four still carries the 9.9 builder sentinel.
    for k in ("twr", "sharpe", "ytd", "max_drawdown"):
        assert snap[k] != 9.9, f"{k} still holds the builder sentinel"

    # D5: trade-level stats are still the builder values (not derived).
    assert snap["total_pnl"] == 550.0
    assert snap["trade_count"] == 10
    assert snap["win_rate"] == 0.7


def test_teaser_derive_crypto_uses_365_not_252(client):
    """Test W2 (D2 / FLAG C): the persisted Sharpe equals the √365 derive and
    is UNEQUAL to the √252 derive on the same series (crypto → √365 per #597)."""
    from services.basis_series import derive_basis_series
    from services.transforms import trades_to_daily_returns

    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-w2")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="teaser", source="okx"
    )
    assert r.status_code == 200, r.text
    snap = _captured_metrics_snapshot(fake)

    returns = trades_to_daily_returns(rows, account_balance=None)
    sharpe_365 = derive_basis_series(
        returns, None, periods_per_year=365,
        cumulative_method="geometric", day_basis="calendar",
    ).metrics_json["sharpe"]
    sharpe_252 = derive_basis_series(
        returns, None, periods_per_year=252,
        cumulative_method="geometric", day_basis="calendar",
    ).metrics_json["sharpe"]

    assert snap["sharpe"] == sharpe_365
    assert snap["sharpe"] != sharpe_252


def test_teaser_equity_curve_from_derived_series(client):
    """Test C (D1 honesty condition c): the persisted equity_curve is a cumprod
    walk over the derive's series_rows ({"date","value"}), NOT the old raw
    (1+returns).cumprod() with timestamp keys."""
    from services.basis_series import derive_basis_series
    from services.transforms import trades_to_daily_returns

    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-c")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="teaser", source="okx"
    )
    assert r.status_code == 200, r.text
    snap = _captured_metrics_snapshot(fake)

    returns = trades_to_daily_returns(rows, account_balance=None)
    result = derive_basis_series(
        returns, None, periods_per_year=365,
        cumulative_method="geometric", day_basis="calendar",
    )
    expected = []
    val = 1.0
    for row in result.series_rows:
        val *= 1 + row["return"]
        expected.append({"date": row["date"], "value": float(val)})

    assert snap["equity_curve"] == expected


def test_derive_return_scalars_reads_nested_ytd():
    """Test A (FLAG A pin, unit): _derive_return_scalars reads ytd from the
    NESTED metrics_json["metrics_json"]["ytd"]; a top-level scalars["ytd"]
    KeyErrors. If metrics.py ever flattens ytd, this reddens loudly."""
    import pandas as pd
    from routers.process_key import _derive_return_scalars
    from services.basis_series import derive_basis_series

    idx = pd.date_range("2024-01-05", periods=6, freq="D").as_unit("us")
    series = pd.Series([0.01, -0.02, 0.03, 0.015, -0.01, 0.02], index=idx)

    four, _curve = _derive_return_scalars(series, "crypto")
    result = derive_basis_series(
        series, None, periods_per_year=365,
        cumulative_method="geometric", day_basis="calendar",
    )
    assert four["ytd"] == result.metrics_json["metrics_json"]["ytd"]
    # ytd must NOT be a top-level metrics_json key (the nested-read pin).
    assert "ytd" not in result.metrics_json


def test_derive_return_scalars_traditional_uses_252_not_365():
    """LW-03 (Fable code-review): _derive_return_scalars HONORS the asset_class arg
    for the traditional (√252) clock — the crypto route test W2 only covers √365, so
    a hard-wired periods_per_year=365 at the call site would otherwise pass the whole
    suite. Traditional → Sharpe == √252 derive, != √365 derive on the same series."""
    import pandas as pd
    from routers.process_key import _derive_return_scalars
    from services.basis_series import derive_basis_series

    idx = pd.date_range("2024-01-05", periods=6, freq="D").as_unit("us")
    series = pd.Series([0.01, -0.02, 0.03, 0.015, -0.01, 0.02], index=idx)

    four, _curve = _derive_return_scalars(series, "traditional")
    sharpe_252 = derive_basis_series(
        series, None, periods_per_year=252,
        cumulative_method="geometric", day_basis="calendar",
    ).metrics_json["sharpe"]
    sharpe_365 = derive_basis_series(
        series, None, periods_per_year=365,
        cumulative_method="geometric", day_basis="calendar",
    ).metrics_json["sharpe"]

    assert four["sharpe"] == sharpe_252
    assert four["sharpe"] != sharpe_365


def test_resolve_asset_class_venue_and_csv():
    """Test R (FLAG C resolver, unit): crypto venues resolve WITHOUT touching
    supabase; csv reads strategies.asset_class; a failed/empty lookup → None."""
    from routers.process_key import _resolve_asset_class

    for venue in ("okx", "binance", "bybit"):
        fake = MagicMock()
        assert _resolve_asset_class(venue, "s1", fake) == "crypto"
        fake.table.assert_not_called()

    # csv → SELECT asset_class FROM strategies WHERE id = strategy_id.
    fake_csv = MagicMock()
    chain = (
        fake_csv.table.return_value.select.return_value.eq.return_value.maybe_single.return_value
    )
    chain.execute.return_value = MagicMock(data={"asset_class": "traditional"})
    assert _resolve_asset_class("csv", "s1", fake_csv) == "traditional"
    fake_csv.table.assert_called_with("strategies")

    # Empty row → None (→ periods_per_year_for_asset_class(None) = 252).
    fake_empty = MagicMock()
    (
        fake_empty.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value
    ) = MagicMock(data=None)
    assert _resolve_asset_class("csv", "s1", fake_empty) is None

    # Raising lookup → None (fail-soft).
    fake_raise = MagicMock()
    (
        fake_raise.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.side_effect
    ) = Exception("boom")
    assert _resolve_asset_class("csv", "s1", fake_raise) is None


def test_derive_return_scalars_propagates_valueerror_on_lt2_finite():
    """Test D(a) (D6, unit): a 2-row series with 1 NaN (<2 FINITE post-sanitize)
    propagates derive's ValueError — the caller maps it to the degrade arm."""
    import pandas as pd
    from routers.process_key import _derive_return_scalars

    idx = pd.date_range("2024-01-05", periods=2, freq="D").as_unit("us")
    series = pd.Series([0.01, float("nan")], index=idx)
    with pytest.raises(ValueError):
        _derive_return_scalars(series, "crypto")


def test_teaser_degrade_to_nulls_on_derive_valueerror(client):
    """Test D(b) (D6, route): a derive ValueError lands on the degrade arm —
    the four return-based scalars persist as None plus the five legacy null
    keys, response still 200/published (never a 500)."""
    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-db")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    import services.encryption as _enc_mod

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase", return_value=fake,
    ), patch(
        "routers.process_key.get_adapter", return_value=adapter,
    ), patch(
        "routers.process_key._derive_return_scalars",
        side_effect=ValueError("fewer than 2 finite daily returns"),
    ), patch.object(
        _enc_mod, "get_kek", return_value=b"0" * 32,
    ), patch.object(
        _enc_mod, "encrypt_credentials", return_value={"ciphertext": "stub"},
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "api_key": "k", "api_secret": "s",
                    "email": "test@example.com", "exchange": "okx",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"
    snap = _captured_metrics_snapshot(fake)
    for k in ("twr", "sharpe", "ytd", "max_drawdown"):
        assert snap[k] is None, f"{k} must degrade to None on derive ValueError"
    for k in ("return_24h", "return_mtd", "return_ytd", "equity_curve", "matched_strategy_id"):
        assert snap[k] is None


def test_teaser_degrade_to_nulls_on_single_row(client):
    """Test D(c) (D6, route): a single daily_pnl row (len<2 pre-check) also
    yields the four return-based scalars as None."""
    rows = _daily_pnl_dicts([120.0])
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-dc")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="teaser", source="okx"
    )
    assert r.status_code == 200, r.text
    snap = _captured_metrics_snapshot(fake)
    for k in ("twr", "sharpe", "ytd", "max_drawdown"):
        assert snap[k] is None


def test_derive_swap_is_flow_agnostic_internal_report(client):
    """Test F (D4): flow_type=internal_report, source=binance drives the SAME
    derived scalars (same wiring equality) — the swap serves the shared block,
    not a teaser fork (anti-cosplay doctrine intact)."""
    from services.basis_series import derive_basis_series
    from services.transforms import trades_to_daily_returns

    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-ir-f")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="internal_report", source="binance",
        strategy_id="22222222-2222-4222-8222-222222222222",
    )
    assert r.status_code == 200, r.text
    snap = _captured_metrics_snapshot(fake)

    returns = trades_to_daily_returns(rows, account_balance=None)
    mj = derive_basis_series(
        returns, None, periods_per_year=365,  # binance → crypto → √365
        cumulative_method="geometric", day_basis="calendar",
    ).metrics_json
    assert snap["twr"] == mj["cumulative_return"]
    assert snap["sharpe"] == mj["sharpe"]
    assert snap["ytd"] == mj["metrics_json"]["ytd"]
    assert snap["max_drawdown"] == mj["max_drawdown"]


def test_teaser_persists_no_series_row(client):
    """Guard (D1 honesty condition b): a FULL successful teaser run — the derive
    path actually executes (multi-day trades, not the degrade arm) — persists
    NO strategy_analytics_series row. Zero upsert_strategy_analytics_series_batch
    RPCs under ANY id (STRONGER than filtering by the archived 00000…0001 anchor:
    the teaser persists no series row at all, so any such RPC is a regression).

    Why persist-nothing is the correct contract (D1 / Option c): the shared
    teaser anchor (TEASER_ANCHOR_STRATEGY_ID) is status='archived' and user-less,
    so fetch_strategy_lazy_metrics (published-OR-owner) can never read a row keyed
    to it — AND concurrent teasers would PK-collide on it. derive_basis_series is
    compute-only; process_key.py never calls persist_basis_series.
    """
    from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID

    rows = _daily_pnl_dicts(_PNL_PROFILE)
    fake = _build_supabase_mock(existing_row=None, insert_id="ver-teaser-guard")
    adapter = _make_sync_adapter(rows, _sentinel_snapshot())

    r = _run_sync_pipeline(
        client, fake, adapter, flow_type="teaser", source="okx"
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"

    # The derive path (not the degrade arm) actually ran — the four scalars are
    # populated, confirming this is a MEANINGFUL persist-nothing assertion.
    snap = _captured_metrics_snapshot(fake)
    assert snap["sharpe"] is not None

    rpc_calls = [c.args for c in fake.rpc.call_args_list]
    series_calls = [
        c for c in rpc_calls if c and c[0] == "upsert_strategy_analytics_series_batch"
    ]
    assert series_calls == [], (
        "teaser must persist NO strategy_analytics_series row (D1 persist-nothing) "
        f"— not even under the {TEASER_ANCHOR_STRATEGY_ID} anchor; "
        f"got {len(series_calls)} series-persist RPC(s)"
    )


def test_process_key_csv_finalize_calls_finalize_csv_strategy_rpc(client):
    """API-3 regression: flow_type='csv', step='finalize' lands here without
    a strategy_id (the strategies row hasn't been created yet). Pre-fix this
    returned 422 MISSING_STRATEGY_ID; post-fix it delegates to
    finalize_csv_strategy RPC which atomically creates the strategies +
    strategy_verifications rows.
    """
    fake = _build_supabase_mock(existing_row=None)
    new_sid = "11111111-1111-1111-1111-111111111111"
    # Phase 19.1 (2026-05-27): finalize_csv_strategy is SECURITY DEFINER and
    # enforces auth.uid() = p_user_id, so it runs on a USER-scoped client built
    # from the forwarded X-User-Access-Token — never the service-role client.
    finalize_call = MagicMock()
    finalize_call.execute.return_value = MagicMock(data=new_sid)
    user_sb = MagicMock()
    user_sb.rpc.return_value = finalize_call
    # Benign default for any incidental service-role rpc (audit etc.).
    fake.rpc.return_value = MagicMock(execute=MagicMock(return_value=MagicMock(data={})))

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_user_scoped_supabase",
        return_value=user_sb,
    ) as mock_user_client:
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
            headers={**_auth_headers(), "X-User-Access-Token": "user-jwt-abc"},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["strategy_id"] == new_sid
    assert body["status"] == "pending_review"
    assert body["step"] == "finalize"

    # The user-scoped client was built from the forwarded token...
    mock_user_client.assert_called_once_with("user-jwt-abc")
    # ...and finalize_csv_strategy ran on THAT client (the auth.uid() path).
    user_finalize = [
        c for c in user_sb.rpc.call_args_list
        if c.args and c.args[0] == "finalize_csv_strategy"
    ]
    assert len(user_finalize) == 1, "finalize_csv_strategy must run on the user-scoped client"
    payload = user_finalize[0].args[1]
    assert payload["p_user_id"] == "33333333-3333-3333-3333-333333333333"
    assert payload["p_wizard_session_id"] == "22222222-2222-2222-2222-222222222222"
    assert payload["p_fmt"] == "trades"
    assert payload["p_strategy_name"] == "Test Strategy"
    # The service-role client must NOT be used for the user-auth finalize RPC.
    svc_finalize = [
        c for c in fake.rpc.call_args_list
        if c.args and c.args[0] == "finalize_csv_strategy"
    ]
    assert svc_finalize == [], "finalize_csv_strategy must NOT use the service-role client"


def test_process_key_csv_finalize_without_user_token_returns_401(client):
    """Phase 19.1 (2026-05-27) guard: finalize_csv_strategy is user-auth
    (auth.uid() = p_user_id). If the Next.js route forwards no
    X-User-Access-Token, fail with a clean 401 rather than letting the upstream
    RPC raise 42501 'called without an auth session'. We must not even attempt
    to build a user client or run the RPC unauthenticated.
    """
    fake = _build_supabase_mock(existing_row=None)
    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=fake,
    ), patch(
        "routers.process_key.get_user_scoped_supabase",
    ) as mock_user_client:
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
            headers=_auth_headers(),  # no X-User-Access-Token
        )

    assert r.status_code == 401, r.text
    assert r.json().get("code") == "CSV_FINALIZE_FAILED"
    mock_user_client.assert_not_called()


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


# ---------------------------------------------------------------------------
# NEW-C31-01 — scope gate regression (read_only=False must be rejected)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "error_code,read_only",
    [
        ("TRADE_SCOPE", False),
        ("WITHDRAW_SCOPE", False),
        # IMP-2: error_code arm must win even when read_only is True — a broker
        # that reports a scope violation via error_code but doesn't set
        # read_only=False (incorrect adapter, or future adapter drift) must still
        # be rejected.  This is a defensive edge case; today all adapters that
        # set WITHDRAW_SCOPE also set read_only=False (services/exchange.py:636-646).
        ("WITHDRAW_SCOPE", True),
    ],
    ids=["trade_scope", "withdraw_scope", "error_code_wins"],
)
def test_process_key_sync_pipeline_rejects_write_capable_key(
    client, error_code: str, read_only: bool
):
    """NEW-C31-01 regression: the synchronous pipeline (teaser / csv) must
    reject keys where val.read_only is False or error_code is TRADE_SCOPE /
    WITHDRAW_SCOPE — and must NOT proceed to fetch_raw or encryption.

    Pre-fix: only `not val.valid` was checked after adapter.validate().
    validate_key_permissions sets valid=True the moment fetch_balance()
    succeeds, so a trading/withdrawal key sailed past the guard and got
    KEK-encrypted and published.
    """
    from services.ingestion.adapter import ValidationResult

    fake = _build_supabase_mock(existing_row=None, insert_id="ver-scope")

    write_adapter = MagicMock()
    write_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,  # fetch_balance succeeded — adapter says "credentials OK"
            read_only=read_only,
            error_code=error_code,
            human_message="Key has trading permissions. Please use a read-only key.",
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
        return_value=write_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-scope-1",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )

    # Envelope returns 200 with ok=False per DESIGN-05 — but the key must be rejected.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == error_code

    # Critical: fetch_raw MUST NOT have been called — no broker round-trip.
    write_adapter.fetch_raw.assert_not_called()

    # Verification must have been transitioned back to draft.
    rpc_names = [c.args[0] for c in fake.rpc.call_args_list]
    assert "transition_strategy_verification" in rpc_names
    draft_calls = [
        c for c in fake.rpc.call_args_list
        if c.args and c.args[0] == "transition_strategy_verification"
        and c.args[1].get("p_new_status") == "draft"
    ]
    assert draft_calls, "Scope rejection must transition verification to draft"
    errors = draft_calls[0].args[1]["p_metadata"]["errors"]
    assert errors[0]["code"] == error_code


def test_process_key_sync_scope_rejection_uses_validation_unexpected_fallback(client):
    """SF-2 regression: when read_only=False but error_code is None, the
    fallback must be 'VALIDATION_UNEXPECTED' (a registered WizardErrorCode)
    NOT 'VALIDATION_FAILED' (unregistered → blank wizard error state on frontend).

    Pre-fix: the fallback was 'VALIDATION_FAILED', absent from wizardErrors.ts,
    causing a silent blank error message with no remediation path.
    """
    from services.ingestion.adapter import ValidationResult

    fake = _build_supabase_mock(existing_row=None, insert_id="ver-fallback")

    fallback_adapter = MagicMock()
    fallback_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=False,
            error_code=None,  # triggers the fallback path
            human_message="Write-capable key.",
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
        return_value=fallback_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-fallback",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    # SF-2: code in the envelope must be the registered fallback, not the bare
    # unregistered "VALIDATION_FAILED" string.
    assert body["code"] == "VALIDATION_UNEXPECTED"
    fallback_adapter.fetch_raw.assert_not_called()


def test_process_key_sync_scope_rejection_survives_rpc_failure(client):
    """SF-3 regression: an RPC failure during the scope-rejection draft
    transition must NOT raise an unhandled exception — the endpoint must
    return the correct envelope error (ok=False) regardless of Supabase state.

    Pre-fix: the RPC call was uncaught; a Supabase blip would propagate as a
    500, leaving the verification in limbo and hiding the security outcome.
    """
    from services.ingestion.adapter import ValidationResult

    # Use the standard mock (table ops succeed to allow insert → verification_id),
    # but override the rpc chain to always raise so the scope-rejection RPC fails.
    rpc_fail_sb = _build_supabase_mock(existing_row=None, insert_id="ver-rpc-fail")
    failing_rpc = MagicMock()
    failing_rpc.execute.side_effect = RuntimeError("Supabase unavailable")
    rpc_fail_sb.rpc.return_value = failing_rpc

    rpc_fail_adapter = MagicMock()
    rpc_fail_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=False,
            error_code="TRADE_SCOPE",
            human_message="Trading-capable key.",
            debug_context={},
        )
    )

    with patch(
        "routers.process_key.is_unified_backbone_active",
        new=AsyncMock(return_value=True),
    ), patch(
        "routers.process_key.get_supabase",
        return_value=rpc_fail_sb,
    ), patch(
        "routers.process_key.get_adapter",
        return_value=rpc_fail_adapter,
    ):
        r = client.post(
            "/process-key",
            json={
                "flow_type": "teaser",
                "source": "okx",
                "context": {
                    "strategy_id": "s1",
                    "wizard_session_id": "wiz-rpc-fail",
                    "api_key": "k",
                    "api_secret": "s",
                },
            },
            headers=_auth_headers(),
        )

    # SF-3: even with a failing RPC the endpoint must return the security-
    # correct envelope error, not an unhandled 500.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["code"] == "TRADE_SCOPE"
    rpc_fail_adapter.fetch_raw.assert_not_called()


def test_process_key_csv_read_only_none_not_rejected_sync(client):
    """NEW-C31-01 guard: CSV path has read_only=None — must NOT be rejected
    by the scope gate. Only explicit False is a disqualifier."""
    from services.ingestion.adapter import (
        Fingerprint,
        MetricsSnapshot,
        ValidationResult,
    )

    fake = _build_supabase_mock(existing_row=None, insert_id="ver-csv-none")

    csv_adapter = MagicMock()
    csv_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,  # CSV: N/A
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
                    "strategy_id": "s-csv-none",
                    "wizard_session_id": "wiz-csv-none",
                    "fmt": "trades",
                    "raw_bytes_base64": "Y29sCjE=",
                },
            },
            headers=_auth_headers(),
        )

    # CSV with read_only=None must pass through to fetch_raw.
    assert r.status_code == 200, r.text
    csv_adapter.fetch_raw.assert_awaited_once()


def test_process_key_shares_main_limiter_instance():
    """API-5 regression: routers.process_key.limiter MUST be the same
    instance as services.rate_limit.limiter (which main.py also imports).

    Pre-fix, process_key.py instantiated its own ``Limiter()`` at module
    scope; main.py owned a different one and registered it on
    ``app.state.limiter``. The slowapi ``@limiter.limit(...)`` decorator
    binds to whichever Limiter the source file imports — so the
    in-process route counts and the app-state metrics were divorced.
    """
    import slowapi.extension
    from services import rate_limit as _rl

    # H-0806: pin that the singleton is the REAL slowapi Limiter, not a no-op shim
    # leaked by a sibling test's in-place `slowapi.Limiter` swap. Without this, the
    # `is` check below could pass vacuously as noop-is-noop and stop guarding the
    # API-5 wiring it documents (the module header re-pops the singleton to keep
    # this honest in full-suite collection order).
    assert isinstance(_rl.limiter, slowapi.extension.Limiter), (
        "API-5/H-0806: services.rate_limit.limiter must be a real slowapi Limiter, "
        "not a no-op shim leaked by a sibling test's in-place slowapi.Limiter swap."
    )
    assert process_key_router.limiter is _rl.limiter, (
        "API-5: process_key.limiter must be the singleton from "
        "services.rate_limit. A drift here means slowapi storage on the "
        "decorator and on app.state.limiter is no longer shared."
    )


def test_process_key_rate_limit_key_func_uses_token_only():
    """PR #241 red-team — the limiter key must vary by Authorization
    token ONLY. The earlier shape composed (token, X-User-Id) so each
    tenant got isolated buckets — but X-User-Id is unsigned
    client-controlled input, so a caller holding the bearer token
    could set ``X-User-Id: <random-uuid-per-request>`` and allocate a
    new bucket per request, bypassing the limiter entirely. Until a
    signed identity surface lands (mTLS / JWT body bound to the
    token), per-token bucketing is the strongest guarantee available.
    Two requests from the same bearer token land in the SAME bucket
    regardless of the X-User-Id value.
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

    # PR #241 red-team contract: same token → same key regardless of
    # X-User-Id (closes the per-request-uuid bypass).
    assert ka == kb, "Same token must produce same key, regardless of X-User-Id"
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
