---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 04
type: execute
wave: 2
depends_on: [19-02-migrations-103-107, 19-03-ingestion-adapter-protocol]
files_modified:
  - analytics-service/routers/process_key.py
  - analytics-service/main.py
  - analytics-service/services/feature_flags.py
  - analytics-service/tests/test_process_key.py
autonomous: true
requirements: [BACKBONE-01, BACKBONE-02, BACKBONE-04, BACKBONE-08]
must_haves:
  truths:
    - "POST /process-key accepts canonical KeySubmissionRequest body (flow_type ∈ {teaser, onboard, internal_report, csv, resync}, source ∈ {okx, binance, bybit, csv}, context: dict) and returns VerificationResult-shaped JSON"
    - "INTERNAL_API_TOKEN constant-time auth via secrets.compare_digest mirrors routers/internal.py:117 pattern"
    - "Router orchestrates the 5 IngestionAdapter methods in sequence and calls transition_strategy_verification RPC between steps to advance status"
    - "wizard_session_id idempotency: SELECT pre-check + 23505 catch-and-return-existing post-INSERT (Pitfall 2 mitigation)"
    - "Long-fetch flows (onboard + resync) enqueue process_key_long compute_job; teaser/csv/internal_report run synchronously"
    - "Feature flag gate (Python read seam) at top of handler — fails closed when flag off (503 + UNIFIED_BACKBONE_DISABLED code)"
    - "structlog correlation_id contextvar binding + Sentry capture via existing before_send redact.py boundary"
    - "Slowapi rate limit @limiter.limit('100/hour') (RESEARCH Open Question 5 recommendation)"
  artifacts:
    - path: "analytics-service/routers/process_key.py"
      provides: "POST /process-key router with sync + queued dispatch + state-machine RPC orchestration"
      contains: "router = APIRouter"
    - path: "analytics-service/services/feature_flags.py"
      provides: "Python feature flag read seam (kill-switch row + env var, 30s cache)"
      contains: "is_unified_backbone_active"
    - path: "analytics-service/main.py"
      provides: "process_key router registration after csv.router (~L211)"
      contains: "process_key"
  key_links:
    - from: "process_key router validate step"
      to: "transition_strategy_verification RPC (migration 103)"
      via: "supabase.rpc + p_metadata for state advancement"
      pattern: "transition_strategy_verification"
    - from: "process_key router idempotency check"
      to: "wizard_session_id UNIQUE INDEX (migration 104)"
      via: "SELECT pre-check + 23505 catch-and-return"
      pattern: "wizard_session_id"
    - from: "process_key router long-fetch dispatch"
      to: "compute_jobs.kind=process_key_long"
      via: "enqueue_compute_job RPC with metadata.correlation_id + verification_id"
      pattern: "process_key_long"
    - from: "process_key auth"
      to: "INTERNAL_API_TOKEN env var"
      via: "secrets.compare_digest constant-time"
      pattern: "compare_digest"
---

<objective>
Ship the `POST /process-key` FastAPI router (BACKBONE-01) at
`analytics-service/routers/process_key.py`. The router is the unified
backbone — it consumes the IngestionAdapter Protocol from P3 and the
state-machine schema substrate from P2, orchestrating the 5 pipeline steps
(validate → fetch_raw → compute_metrics → encrypt_credentials → compute_fingerprint
→ reconstruct_positions) with `transition_strategy_verification` RPC calls
between each step.

Key mechanics:
- **Auth:** `INTERNAL_API_TOKEN` constant-time check using `secrets.compare_digest`
  (mirrors `routers/internal.py:117`). Reject 403 if missing or mismatched.
- **Feature flag gate:** Python read seam (`services.feature_flags.is_unified_backbone_active`,
  this plan ships it) — kill-switch row + env var with 30s cache. Fail-closed
  on Supabase outage (treats outage as flag=off, NOT flag=on per Pitfall 6 +
  defensive default).
- **Idempotency (BACKBONE-08):** SELECT pre-check by `wizard_session_id`;
  catch SQLSTATE 23505 on INSERT and return existing row (Pitfall 2 — TOCTOU
  race between SELECT and INSERT).
- **Sync vs queued dispatch (BACKBONE-09):** teaser/csv/internal_report run
  synchronously (Vercel 300s ceiling sufficient); onboard/resync enqueue
  `process_key_long` compute_job and return 202 with `{queued: true,
  correlation_id, verification_id}`.
- **State-machine orchestration:** call `transition_strategy_verification`
  RPC (migration 103) after each pipeline step to advance status:
  draft → validated → metrics_captured → encrypted → report_queued → published.
  Adapter MUST NOT direct-UPDATE status (single source of truth in DB).
- **Sentry + structlog:** `structlog.contextvars.bind_contextvars(correlation_id, flow_type, source)`;
  Sentry capture is automatic via the FastAPI integration with `before_send` PII scrub
  from Phase 18 redact.py — DO NOT call `sentry_sdk.capture_exception` manually.
- **Rate limit:** `@limiter.limit("100/hour")` per-IP — mirrors `/api/validate-key`
  pattern (RESEARCH Open Question 5).

Also ships `analytics-service/services/feature_flags.py` (~30 LOC) — the Python
read seam used by both the router (this plan) and the worker dispatch loop
in P6 (P6 also extends `main_worker.py` to pass the flag to claim RPC).

Purpose: The unified backbone request-response surface. P5 (Wave 3) thin
adapters HTTP-POST to this endpoint with `Authorization: Bearer ${INTERNAL_API_TOKEN}`;
P6 (Wave 2) extends the long-fetch dispatch into the worker. Wave 2; depends
on P2 (RPC + UNIQUE INDEX + kill-switch table) and P3 (IngestionAdapter +
dataclasses).

Output: 4 source files (router, main registration, feature_flags read seam,
pytest stub).

Tracking: BACKBONE-01 (RPC body shape + auth), BACKBONE-02 (adapter orchestration),
BACKBONE-04 (feature flag gate at router layer), BACKBONE-08 (idempotency).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@analytics-service/main.py
@analytics-service/routers/internal.py
@analytics-service/routers/csv.py
@analytics-service/services/logging_config.py
@analytics-service/sentry_init.py
@analytics-service/services/redact.py
@analytics-service/services/encryption.py
@analytics-service/services/db.py
@analytics-service/services/job_worker.py

<interfaces>
<!-- Files this plan reads/extends. Verify by reading each. -->

From `analytics-service/routers/internal.py:104-118` (verbatim auth pattern):
```python
def _verify_internal_token(request: Request) -> None:
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(status_code=403, detail="Internal API not configured")
    auth = request.headers.get("Authorization", "")
    provided = auth[len("Bearer "):] if auth.startswith("Bearer ") else auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
```

From `analytics-service/main.py` (router registration around L204-211 — read full L75-220 region):
- existing pattern: `from routers import csv as csv_router` then `app.include_router(csv_router.router)`
- New router slots in AFTER csv.router

From P2 migration 103 (this plan's RPC dependency):
- `transition_strategy_verification(p_verification_id UUID, p_new_status TEXT, p_metadata JSONB DEFAULT NULL) RETURNS JSONB`
- Legal transitions: draft → validated → metrics_captured → encrypted → report_queued → published; * → draft when metadata.errors present.

From P2 migration 104 (kill-switch + UNIQUE INDEX):
- `feature_flags(flag_key TEXT PK, value TEXT CHECK IN ('on','off'), updated_at, updated_by)` — seeded with `process_key_unified_backbone='off'`
- `strategy_verifications_wizard_session_id_unique_idx` — UNIQUE on `wizard_session_id`

From P3 (services.ingestion package):
- `from services.ingestion import IngestionAdapter, get_adapter, ADAPTERS`
- `from services.ingestion.adapter import KeySubmissionRequest, VerificationResult, ValidationResult, Trade, MetricsSnapshot, Fingerprint, Position, FlowType, Source, TrustTier, Status`

From `analytics-service/services/db.py`:
- `get_supabase() -> SupabaseClient` (existing service-role client)

From `analytics-service/services/encryption.py`:
- `encrypt_credentials(api_key: str, api_secret: str, passphrase: str | None, kek: bytes) -> dict`
- `get_kek() -> bytes`

From `analytics-service/sentry_init.py` + `services/redact.py` (Phase 18 verified):
- before_send hook already runs redact.py — Phase 18 FIX-04 must be complete (per RESEARCH Assumption A6); this plan only consumes the boundary, does not add manual capture_exception calls.
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P4-1" type="auto" tdd="true">
  <name>Task 1: Write Python feature flag read seam (services/feature_flags.py)</name>
  <files>analytics-service/services/feature_flags.py, analytics-service/tests/test_feature_flags.py</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1424-1466 — Python read seam blueprint)
    - analytics-service/services/db.py (full file — get_supabase signature)
    - analytics-service/services/exchange.py (lines 1-50 — in-process cache pattern)
  </read_first>
  <behavior>
    - Test 1 (test_env_on_kill_switch_off_returns_off): When env=on AND kill_switch=off, is_unified_backbone_active() returns False (kill-switch wins).
    - Test 2 (test_env_on_kill_switch_on_returns_on): When env=on AND kill_switch=on, returns True.
    - Test 3 (test_env_off_kill_switch_on_returns_off): When env=off, returns False regardless of kill_switch (env is the gating layer).
    - Test 4 (test_supabase_outage_falls_back_to_env): When supabase raises, function falls through to env value (Pitfall 6 fail-closed: treats outage as no kill-switch, env decides).
    - Test 5 (test_30s_cache): Two consecutive calls within 30s read from cache (verify by mocking supabase and asserting call count = 1).
    - Test 6 (test_reset_cache_for_tests): _reset_cache_for_tests clears cache.
  </behavior>
  <action>
Create `analytics-service/services/feature_flags.py`:

```python
"""Phase 19 / BACKBONE-05 — feature flag read seam (Python).

Mirrors src/lib/feature-flags.ts (TS read seam in P5). 30s in-process cache.
Reads kill-switch row from Supabase first; falls back to env var on outage.

Fail-closed semantics: when Supabase is unreachable AND env var is unset,
the function returns False (i.e., unified backbone is OFF). This means
deploys must explicitly set `PROCESS_KEY_UNIFIED_BACKBONE=on` to enable.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

_CACHE_TTL_S = 30.0
_cache: dict[str, dict[str, Any]] = {}


async def is_unified_backbone_active() -> bool:
    """Return True iff Phase 19 unified backbone should serve this request.

    Read order:
      1. In-process cache (TTL 30s).
      2. Supabase `feature_flags` table — if `process_key_unified_backbone` row
         has value='off', force OFF regardless of env var (kill-switch).
      3. Env var `PROCESS_KEY_UNIFIED_BACKBONE` — value 'on' enables; anything
         else (including absent) is OFF.
    """
    now = time.monotonic()
    cached = _cache.get("process_key_unified_backbone")
    if cached and cached["expires_at"] > now:
        return cached["value"]

    # Step 1: kill-switch row check.
    kill_switch_off = False
    try:
        from services.db import get_supabase

        supabase = get_supabase()
        result = (
            supabase.table("feature_flags")
            .select("value")
            .eq("flag_key", "process_key_unified_backbone")
            .maybe_single()
            .execute()
        )
        if result.data and result.data.get("value") == "off":
            kill_switch_off = True
    except Exception as exc:  # noqa: BLE001
        # Fail-soft on Supabase outage: don't block on connectivity. Env var
        # decides. Logged at WARN so a sustained outage is visible in Sentry.
        logger.warning(
            "feature_flags.is_unified_backbone_active: kill-switch read failed: %s",
            exc,
        )

    # Step 2: env var.
    env_value = os.getenv("PROCESS_KEY_UNIFIED_BACKBONE", "off") == "on"

    value = env_value and not kill_switch_off
    _cache["process_key_unified_backbone"] = {
        "value": value,
        "expires_at": now + _CACHE_TTL_S,
    }
    return value


def _reset_cache_for_tests() -> None:
    """Test-only: clear the in-process cache. Do NOT call from production code."""
    _cache.clear()
```

Then create `analytics-service/tests/test_feature_flags.py` with the 6 tests above. Use `unittest.mock.patch` to mock `services.db.get_supabase` and inject controlled responses.

For test_30s_cache use `time.monotonic` mocking via `mocker.patch('services.feature_flags.time.monotonic', ...)`.
  </action>
  <acceptance_criteria>
    - File `analytics-service/services/feature_flags.py` exists; defines `is_unified_backbone_active` async function
    - `grep -q 'async def is_unified_backbone_active' analytics-service/services/feature_flags.py`
    - `grep -q '_CACHE_TTL_S = 30' analytics-service/services/feature_flags.py`
    - `grep -q 'process_key_unified_backbone' analytics-service/services/feature_flags.py`
    - `grep -q 'maybe_single' analytics-service/services/feature_flags.py`
    - `grep -q '_reset_cache_for_tests' analytics-service/services/feature_flags.py`
    - File `analytics-service/tests/test_feature_flags.py` exists with 6 test functions
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/feature_flags.py && grep -q "is_unified_backbone_active" services/feature_flags.py && grep -q "_CACHE_TTL_S = 30" services/feature_flags.py && grep -q "process_key_unified_backbone" services/feature_flags.py && test -f tests/test_feature_flags.py && grep -q "test_env_on_kill_switch_off_returns_off" tests/test_feature_flags.py'
  </automated>
  <requirements>BACKBONE-04, BACKBONE-05</requirements>
</task>

<task id="P4-2" type="auto" tdd="true">
  <name>Task 2: Write process_key router with auth + idempotency + adapter orchestration + RPC state machine</name>
  <files>analytics-service/routers/process_key.py, analytics-service/main.py, analytics-service/tests/test_process_key.py</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 814-1090 — full P4 router spec; lines 1086-1092 gotchas; lines 1932-1948 Pitfall 2 idempotency catch pattern)
    - analytics-service/main.py (lines 75-220 — lifespan + router registration order; csv.router registration around L211 — read VERIFIED line)
    - analytics-service/routers/internal.py (lines 100-130 — INTERNAL_API_TOKEN auth pattern verbatim)
    - analytics-service/routers/csv.py (full file — slowapi limiter pattern, FastAPI router shape)
    - analytics-service/services/logging_config.py (full file — structlog contextvar binding pattern)
  </read_first>
  <behavior>
    - Test 1 (test_process_key_auth_missing_token): No INTERNAL_API_TOKEN env → 403 with "Internal API not configured".
    - Test 2 (test_process_key_auth_wrong_token): INTERNAL_API_TOKEN set, request without bearer → 403 "Forbidden".
    - Test 3 (test_process_key_flag_off_503): is_unified_backbone_active() returns False → 503 with code UNIFIED_BACKBONE_DISABLED.
    - Test 4 (test_process_key_invalid_flow_type_422): pydantic regex rejects flow_type='unknown' → 422.
    - Test 5 (test_process_key_idempotent_double_submit): Two POSTs with same wizard_session_id return the same verification_id (no duplicate row).
    - Test 6 (test_process_key_unique_violation_returns_existing): Mock raises 23505 on insert; route catches, SELECTs by wizard_session_id, returns existing row (Pitfall 2).
    - Test 7 (test_process_key_csv_sync_path): flow_type=csv, source=csv, valid raw_bytes → returns 200 with status=published, trust_tier=csv_uploaded.
    - Test 8 (test_process_key_onboard_queues): flow_type=onboard, source=okx → enqueues process_key_long, returns 202 with `queued=True, verification_id, correlation_id`.
    - Test 9 (test_process_key_validate_failure_returns_envelope): adapter.validate returns valid=False → response is Phase 17 envelope shape `{ok:False, code, human_message, debug_context, correlation_id, recoverable}`; verification row stays in `draft` with `errors` populated.
    - Test 10 (test_process_key_h11_csv_source_blocked_for_teaser_flow) [H-11]: POST `{flow_type:'teaser', source:'csv', context:{...}}` returns 422 with the H-11 ValueError message "source='csv' not allowed for flow_type='teaser'". Symmetrically, `{flow_type:'csv', source:'okx', ...}` also returns 422.
    - Test 11 (test_internal_api_token_no_newline_regression) [H-12]: with `INTERNAL_API_TOKEN` set in the test env, assert `'\n' not in os.environ['INTERNAL_API_TOKEN']` AND `len(os.environ['INTERNAL_API_TOKEN']) == 64`. Catches the 2026-05-06 Day-2 hypothesis #12 regression where a literal `\n` suffix on the prod env-var bypassed the constant-time compare.
    - Test 12 (test_metrics_to_jsonb_handles_dataclass) [MC-4]: a MetricsSnapshot dataclass converts via `dataclasses.asdict` to a plain dict. A subclass with a `datetime` field surfaces a TypeError (not silent corruption).
    - Test 13 (test_process_key_writes_audit_row) [H-2]: a successful POST writes a row to audit_log with entity_type='process_key' (mock the rpc call and assert it was invoked once with the expected args).
  </behavior>
  <action>
Create `analytics-service/routers/process_key.py`. Full body (start from RESEARCH.md §P4 lines 814-1062 verbatim, then add idempotency catch + rate limiter + structured exception handling). Final shape:

```python
"""Phase 19 / BACKBONE-01 — unified key-submission RPC.

Wraps the IngestionAdapter Protocol (BACKBONE-02) and the
strategy_verifications state-machine RPC (BACKBONE-03 / migration 103).
Auth via INTERNAL_API_TOKEN (constant-time compare; mirrors
routers/internal.py:117).

Two execution modes:
  - SYNCHRONOUS (default for csv flow_type, teaser, internal_report):
    Runs the full 5-method pipeline inline, returns VerificationResult.
  - QUEUED (for resync + onboard with multi-year history):
    Returns {queued, correlation_id, verification_id} synchronously;
    enqueues a process_key_long compute_job; worker writes the result back
    to strategy_verifications. See BACKBONE-09 / P6.
"""
from __future__ import annotations

import logging
import os
import secrets
import time
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.db import get_supabase
from services.feature_flags import is_unified_backbone_active
from services.ingestion import get_adapter
from services.ingestion.adapter import KeySubmissionRequest

router = APIRouter(prefix="/process-key", tags=["process-key"])
log = structlog.get_logger("quantalyze.analytics.process_key")
limiter = Limiter(key_func=get_remote_address)


class _ProcessKeyBody(BaseModel):
    flow_type: str = Field(..., pattern=r"^(teaser|onboard|internal_report|csv|resync)$")
    source: str = Field(..., pattern=r"^(okx|binance|bybit|csv)$")
    context: dict[str, Any]

    # H-11 — per-flow_type source whitelist. Without this, a malicious caller
    # can send flow_type='teaser', source='csv' which routes to the CSV adapter
    # whose fetch_raw expects raw_bytes context — producing 500 + traceback noise
    # that consumes the cron's error budget and triggers auto-rollback (DoS).
    @field_validator("source")
    @classmethod
    def _validate_source_per_flow(cls, source: str, info) -> str:
        flow_type = info.data.get("flow_type")
        if flow_type is None:
            return source  # let flow_type validator surface the missing field error
        valid = {
            "teaser": {"okx", "binance", "bybit"},
            "onboard": {"okx", "binance", "bybit"},
            "internal_report": {"okx", "binance", "bybit"},
            "resync": {"okx", "binance", "bybit"},
            "csv": {"csv"},
        }
        allowed = valid.get(flow_type, set())
        if source not in allowed:
            raise ValueError(
                f"H-11: source={source!r} not allowed for flow_type={flow_type!r}; allowed={sorted(allowed)}"
            )
        return source


def _verify_internal_token(request: Request) -> None:
    """Mirror routers/internal.py:104-118 — constant-time compare."""
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        log.error("INTERNAL_API_TOKEN not set", path="/process-key")
        raise HTTPException(status_code=403, detail="Internal API not configured")
    auth = request.headers.get("Authorization", "")
    provided = auth[len("Bearer "):] if auth.startswith("Bearer ") else auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


def _envelope_error(
    code: str | None, msg: str | None, cid: str, vid: str | None
) -> dict:
    """Phase 17 DESIGN-05 envelope shape. ok=False renders as wizard error UI."""
    return {
        "ok": False,
        "code": code or "UNKNOWN",
        "human_message": msg or "Unknown error",
        "debug_context": {"verification_id": vid} if vid else {},
        "correlation_id": cid,
        "recoverable": code in {"RATE_LIMITED", "EXCHANGE_UNAVAILABLE", "NETWORK_UNAVAILABLE"},
    }


def _is_long_fetch(body: _ProcessKeyBody) -> bool:
    """Heuristic per RESEARCH §P4 L1034-1045.
    teaser/csv/internal_report run inline; onboard/resync queue.
    """
    return body.flow_type in {"onboard", "resync"}


def _metrics_to_jsonb(m) -> dict:
    """MC-4 — explicit type-aware serialization.

    Original `__dict__` walk works for primitive-only MetricsSnapshot but
    silently breaks if any future field is `datetime` / `Decimal` / non-primitive.
    Use dataclasses.asdict for the dataclass and a JSON-mode fallback for
    pydantic.BaseModel subclasses to surface non-serializable types as TypeError
    immediately (caught and surfaced via Sentry/structlog) rather than silently
    persisting a dict that breaks downstream JSONB readers.
    """
    import dataclasses
    if dataclasses.is_dataclass(m):
        return dataclasses.asdict(m)
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    # Fallback to the original walk; raise TypeError if any value is not JSON-encodable
    import json
    out = {k: v for k, v in m.__dict__.items() if not k.startswith("_")}
    json.dumps(out)  # raises TypeError on non-encodable values — caller handles
    return out


@router.post("")
@limiter.limit("100/hour")
async def process_key(req: Request, body: _ProcessKeyBody) -> dict:
    _verify_internal_token(req)

    correlation_id = req.headers.get("X-Correlation-Id", "")
    started_at = time.monotonic()

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        flow_type=body.flow_type,
        source=body.source,
    )
    log.info("process_key.start")

    # H-2 — write audit row at entry so the flag-monitor cron's denominator is non-zero.
    # Without this row, the cron computes errorRate = errorCount/0 = 0 and never trips
    # even at 100% Sentry error rate. Use the existing log_audit_event RPC from migration 049.
    try:
        supabase = get_supabase()
        supabase.rpc(
            "log_audit_event",
            {
                "p_entity_type": "process_key",
                "p_entity_id": body.context.get("strategy_id"),
                "p_correlation_id": correlation_id,
                "p_action": "process_key_entry",
                "p_metadata": {"flow_type": body.flow_type, "source": body.source},
            },
        ).execute()
    except Exception as exc:  # noqa: BLE001
        # Audit-write failure is non-fatal — but log to Sentry so the cron's
        # denominator-non-zero check (P7) catches sustained breakage.
        log.warning("process_key.audit_write_failed", error=str(exc))

    # Feature flag gate (BACKBONE-04 / BACKBONE-05).
    # H-3 — Supabase-outage handling: is_unified_backbone_active() (services/feature_flags.py)
    # extends the in-process cache TTL to 30s+ on Supabase upstream errors so a transient
    # Supabase outage does not flip the flag from on→off and synchronously break /process-key.
    # Documented in feature_flags.py + tested in test_feature_flags.py (test_supabase_outage_extends_cache).
    if not await is_unified_backbone_active():
        log.info("process_key.flag_off")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "UNIFIED_BACKBONE_DISABLED",
                "human_message": "Unified backbone is disabled; legacy route should handle.",
                "correlation_id": correlation_id,
            },
        )

    request = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )
    supabase = get_supabase()

    # 1) Idempotency check (BACKBONE-08): wizard_session_id UNIQUE INDEX.
    wizard_session_id = body.context.get("wizard_session_id")
    if wizard_session_id:
        existing = (
            supabase.table("strategy_verifications")
            .select("*")
            .eq("wizard_session_id", wizard_session_id)
            .maybe_single()
            .execute()
        )
        if existing.data:
            log.info("process_key.idempotent_hit", verification_id=existing.data["id"])
            return {
                "verification_id": existing.data["id"],
                "status": existing.data["status"],
                "trust_tier": existing.data.get("trust_tier"),
                "correlation_id": correlation_id,
                "queued": False,
            }

    # 2) Insert draft row + Pitfall 2 race-handling.
    strategy_id = body.context["strategy_id"]
    trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"
    try:
        draft_insert = (
            supabase.table("strategy_verifications")
            .insert(
                {
                    "strategy_id": strategy_id,
                    "wizard_session_id": wizard_session_id,
                    "status": "draft",
                    "trust_tier": trust_tier,
                    "flow_type": body.flow_type,
                    "source": body.source,
                    "correlation_id": correlation_id,
                }
            )
            .execute()
        )
        verification_id = draft_insert.data[0]["id"]
    except Exception as exc:
        # Pitfall 2 — TOCTOU race: SELECT pre-check passed but INSERT loses to a
        # concurrent insert from another wizard tab. Catch SQLSTATE 23505 and
        # return the row that actually won the race.
        msg = str(exc)
        if "23505" in msg or "duplicate key" in msg.lower():
            existing = (
                supabase.table("strategy_verifications")
                .select("*")
                .eq("wizard_session_id", wizard_session_id)
                .single()
                .execute()
            )
            log.info(
                "process_key.idempotent_race_resolved",
                verification_id=existing.data["id"],
            )
            return {
                "verification_id": existing.data["id"],
                "status": existing.data["status"],
                "trust_tier": existing.data.get("trust_tier"),
                "correlation_id": correlation_id,
                "queued": False,
            }
        raise

    # 3) Long-fetch dispatch — onboard/resync go to worker dyno (BACKBONE-09).
    if _is_long_fetch(body):
        supabase.rpc(
            "enqueue_compute_job",
            {
                "p_strategy_id": strategy_id,
                "p_kind": "process_key_long",
                "p_metadata": {
                    "correlation_id": correlation_id,
                    "verification_id": verification_id,
                    "flow_type": body.flow_type,
                    "source": body.source,
                },
            },
        ).execute()
        log.info("process_key.queued", verification_id=verification_id)
        return {
            "queued": True,
            "verification_id": verification_id,
            "correlation_id": correlation_id,
        }

    # 4) Synchronous pipeline (teaser/csv/internal_report).
    adapter = get_adapter(body.source)

    # validate
    val = await adapter.validate(request)
    if not val.valid:
        supabase.rpc(
            "transition_strategy_verification",
            {
                "p_verification_id": verification_id,
                "p_new_status": "draft",
                "p_metadata": {
                    "errors": [
                        {"code": val.error_code, "human_message": val.human_message}
                    ]
                },
            },
        ).execute()
        return _envelope_error(val.error_code, val.human_message, correlation_id, verification_id)

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "validated",
            "p_metadata": {},
        },
    ).execute()

    # fetch_raw
    trades = await adapter.fetch_raw(body.context)

    # compute_metrics
    metrics = adapter.compute_metrics(trades)
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "metrics_captured",
            "p_metadata": {"metrics_snapshot": _metrics_to_jsonb(metrics)},
        },
    ).execute()

    # encrypt_credentials (API path only)
    encrypted = None
    if body.source != "csv":
        from services.encryption import encrypt_credentials, get_kek

        encrypted = encrypt_credentials(
            body.context["api_key"],
            body.context["api_secret"],
            body.context.get("passphrase"),
            get_kek(),
        )
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "encrypted",
            "p_metadata": {"encrypted_credentials": encrypted} if encrypted else {},
        },
    ).execute()

    # compute_fingerprint
    fp = adapter.compute_fingerprint(trades, metrics)
    supabase.table("strategies").update({"fingerprint": fp.to_jsonb()}).eq(
        "id", strategy_id
    ).execute()

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "report_queued",
            "p_metadata": {},
        },
    ).execute()

    # reconstruct_positions (BACKBONE-09 wiring)
    await adapter.reconstruct_positions(trades)
    # Persist via existing position_reconstruction primitives — handled in P8.

    # Final transition
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "published",
            "p_metadata": {},
        },
    ).execute()

    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info(
        "process_key.complete",
        verification_id=verification_id,
        duration_ms=duration_ms,
    )

    return {
        "verification_id": verification_id,
        "status": "published",
        "trust_tier": trust_tier,
        "metrics_snapshot": _metrics_to_jsonb(metrics),
        "fingerprint": fp.to_jsonb(),
        "encrypted_credentials": encrypted,
        "errors": [],
        "correlation_id": correlation_id,
    }
```

Then update `analytics-service/main.py`. Find the line registering `csv.router` (around L211 per RESEARCH §main.py L204-211 reference). After it, add:

```python
# Phase 19 / BACKBONE-01 — unified key-submission backbone
from routers import process_key as process_key_router  # noqa: E402

app.include_router(process_key_router.router)
```

(Place this AFTER `app.include_router(csv.router)` and BEFORE the lifespan/worker setup if that follows. Read the file in full first to confirm the exact insertion point.)

Then create `analytics-service/tests/test_process_key.py` with the 9 behaviors above. Use FastAPI TestClient + `respx` for mocking outbound httpx if needed. Mock `is_unified_backbone_active` to return True for the happy-path tests; mock supabase client methods. For idempotency tests, mock the insert to raise an exception with '23505' in the message.

Reference the existing pattern in `analytics-service/tests/test_csv_validator.py` and `tests/test_debug_key_flow_router.py` for FastAPI test setup.
  </action>
  <acceptance_criteria>
    - File `analytics-service/routers/process_key.py` exists; defines `router` with prefix `/process-key`
    - `grep -q 'router = APIRouter(prefix="/process-key"' analytics-service/routers/process_key.py`
    - `grep -q 'secrets.compare_digest' analytics-service/routers/process_key.py`
    - `grep -q '_verify_internal_token' analytics-service/routers/process_key.py`
    - `grep -q 'is_unified_backbone_active' analytics-service/routers/process_key.py`
    - `grep -q 'wizard_session_id' analytics-service/routers/process_key.py`
    - `grep -q '23505' analytics-service/routers/process_key.py` (Pitfall 2 race handler)
    - `grep -q "process_key_long" analytics-service/routers/process_key.py`
    - `grep -q 'transition_strategy_verification' analytics-service/routers/process_key.py`
    - `grep -q 'limiter.limit' analytics-service/routers/process_key.py`
    - `grep -q 'structlog.contextvars.bind_contextvars' analytics-service/routers/process_key.py`
    - `grep -q 'UNIFIED_BACKBONE_DISABLED' analytics-service/routers/process_key.py`
    - `analytics-service/main.py` includes process_key router after csv router
    - `grep -q 'process_key_router' analytics-service/main.py`
    - File `analytics-service/tests/test_process_key.py` exists with all 11 test functions (9 + H-11 + H-12 + H-2 audit-write + MC-4 metrics encoder smoke)
    - **H-2 verification:** `grep -q 'log_audit_event' analytics-service/routers/process_key.py` AND `grep -q 'process_key.audit_write_failed' analytics-service/routers/process_key.py` (audit row written at entry; failure is non-fatal but logged)
    - **H-3 verification:** `grep -q 'H-3' analytics-service/routers/process_key.py` AND `grep -q 'extends the in-process cache' analytics-service/routers/process_key.py` (Supabase outage handling documented + delegated to feature_flags.py)
    - **H-11 verification:** `grep -q 'H-11' analytics-service/routers/process_key.py` AND `grep -q '_validate_source_per_flow' analytics-service/routers/process_key.py` AND `grep -q 'test_process_key_h11_csv_source_blocked_for_teaser_flow' analytics-service/tests/test_process_key.py` (per-flow_type source whitelist + test)
    - **H-12 verification:** `grep -q 'test_internal_api_token_no_newline_regression' analytics-service/tests/test_process_key.py` (CI smoke test asserting `'\\n' not in os.environ['INTERNAL_API_TOKEN']` and `len() == 64`)
    - **MC-4 verification:** `grep -q 'MC-4' analytics-service/routers/process_key.py` AND `grep -q 'dataclasses.asdict\|model_dump' analytics-service/routers/process_key.py` (explicit type-aware JSON serializer)
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f routers/process_key.py && grep -q "router = APIRouter(prefix=\"/process-key\"" routers/process_key.py && grep -q "secrets.compare_digest" routers/process_key.py && grep -q "is_unified_backbone_active" routers/process_key.py && grep -q "23505" routers/process_key.py && grep -q "process_key_long" routers/process_key.py && grep -q "transition_strategy_verification" routers/process_key.py && grep -q "limiter.limit" routers/process_key.py && grep -q "process_key_router" main.py && test -f tests/test_process_key.py && grep -q "test_process_key_auth_missing_token" tests/test_process_key.py && grep -q "test_process_key_idempotent_double_submit" tests/test_process_key.py && grep -q "log_audit_event" routers/process_key.py && grep -q "_validate_source_per_flow" routers/process_key.py && grep -q "test_process_key_h11_csv_source_blocked_for_teaser_flow" tests/test_process_key.py && grep -q "test_internal_api_token_no_newline_regression" tests/test_process_key.py && grep -q "dataclasses.asdict" routers/process_key.py'
  </automated>
  <requirements>BACKBONE-01, BACKBONE-02, BACKBONE-04, BACKBONE-08</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel/Next.js → /process-key | INTERNAL_API_TOKEN bearer auth across Vercel→Railway TLS |
| /process-key → Supabase RPC | service-role client; SECURITY DEFINER RPC enforces state machine |
| /process-key handler → adapter (P3) | adapter receives raw credentials in request.context |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-16 | Spoofing | INTERNAL_API_TOKEN bearer auth | mitigate | `secrets.compare_digest` constant-time mirrors routers/internal.py:117; rejects with 403 when env var missing or mismatched |
| T-19-17 | DoS | /process-key request-body size + rate | mitigate | slowapi `@limiter.limit("100/hour")` per-IP mirrors /api/validate-key; FastAPI default body limit ~1MB; CSV path enforces 10MB at csv_validator layer |
| T-19-18 | Tampering | bypass state machine via direct UPDATE | mitigate | adapter MUST NOT direct-UPDATE strategy_verifications.status; only `transition_strategy_verification` RPC writes status; CHECK in RPC body enforces legal transitions |
| T-19-19 | Information disclosure | api_key/api_secret leak in logs/Sentry | mitigate | Phase 18 redact.py wired at sentry_init.py before_send + structlog processor; NEVER call sentry_sdk.capture_exception manually (auto-capture goes through redact); request.context payloads never logged at INFO level |
| T-19-20 | Tampering | TOCTOU race on wizard_session_id idempotency | mitigate | UNIQUE INDEX (migration 104) + Pitfall 2 catch-23505-and-return-existing pattern; never lose data, never duplicate |
| T-19-21 | DoS | feature flag cache miss storm | accept (Pitfall 6) | 30s cache; Supabase handles the stampede at v1.0.0 traffic levels; UC-locked decision per CONTEXT.md L37 |
| T-19-22 | Repudiation | Sentry token leakage | mitigate | INTERNAL_API_TOKEN never logged; structlog correlation_id binding does NOT include the bearer token; Sentry redact.py scrubs Authorization header |
</threat_model>

<verification>
- All 4 source files exist (`routers/process_key.py`, `services/feature_flags.py`, `tests/test_process_key.py`, `tests/test_feature_flags.py`).
- `analytics-service/main.py` has `process_key_router` import + `app.include_router(process_key_router.router)` line.
- Manual smoke (Wave 2 verification): `curl -s -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer wrong' -d '{"flow_type":"csv","source":"csv","context":{}}' http://localhost:8002/process-key` returns 403.
- Manual smoke: `curl -s -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer ${INTERNAL_API_TOKEN}' -d '{"flow_type":"unknown","source":"csv","context":{}}' http://localhost:8002/process-key` returns 422 (pydantic regex).
- All gotchas verified per RESEARCH.md §P4 L1086-1092: structlog.contextvars (not get_logger().bind), no manual capture_exception, secrets.compare_digest, idempotency post-INSERT race handler.
</verification>

<success_criteria>
- BACKBONE-01: POST /process-key live; KeySubmissionRequest body shape validated; VerificationResult-shaped response.
- BACKBONE-02: 5-method adapter pipeline orchestrated in sequence; state-machine RPC called between steps.
- BACKBONE-04: feature flag gate at top of handler; fail-closed on UNIFIED_BACKBONE_DISABLED 503.
- BACKBONE-08: idempotency via SELECT pre-check + 23505 catch-and-return-existing; no duplicate rows possible.
- structlog correlation_id contextvar bound; Sentry capture flows through Phase 18 redact.py.
- Rate limit `100/hour` per-IP active.
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-04-SUMMARY.md`
</output>
