"""Phase 19 / BACKBONE-01 — unified key-submission RPC.

Wraps the IngestionAdapter Protocol (BACKBONE-02) and the
strategy_verifications state-machine RPC (BACKBONE-03 / migration 103).
Auth via INTERNAL_API_TOKEN (constant-time compare; mirrors
routers/internal.py:117).

Two execution modes
-------------------
  - SYNCHRONOUS (default for csv flow_type, teaser, internal_report):
    Runs the full 5-method pipeline inline, returns a VerificationResult-
    shaped dict.
  - QUEUED (for resync + onboard):
    Returns ``{queued, correlation_id, verification_id}`` synchronously;
    enqueues a process_key_long compute_job; the worker (P6) writes the
    result back to strategy_verifications. See BACKBONE-09 / P6.
"""
from __future__ import annotations

import os
import secrets
import time
from typing import Any

import hashlib

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from services.db import get_supabase
from services.feature_flags import is_unified_backbone_active
from services.ingestion import get_adapter
from services.ingestion.adapter import KeySubmissionRequest
from services.ingestion.serde import metrics_to_jsonb as _shared_metrics_to_jsonb
from services.rate_limit import limiter

router = APIRouter(prefix="/process-key", tags=["process-key"])
log = structlog.get_logger("quantalyze.analytics.process_key")


def _process_key_rate_limit_key(request: Request) -> str:
    """API-5 — rate-limit key for /process-key.

    Pre-fix used ``get_remote_address`` which buckets all Vercel egress
    behind a single shared NAT into the same window — so one tenant's
    burst can starve every other tenant. The unified backbone is
    service-to-service auth via INTERNAL_API_TOKEN with a JSON
    ``context.user_id``; we key on a hash of (token, user_id) so each
    user gets an isolated 100/hour window.

    Tokens are SHA-256-hashed with a non-cryptographic suffix because
    the resulting key shows up in slowapi error logs and we don't want
    raw bearer tokens in observability output. The hash collapses the
    bearer to a stable 16-char prefix.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):]
    else:
        token = auth or "unauthenticated"
    token_id = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    # Best-effort user_id extraction. The body has been parsed by the time
    # FastAPI hands it to slowapi only if slowapi reads it from
    # request.state — which it does NOT. We fall back to a header sent by
    # the Vercel thin adapters where available.
    user_id = request.headers.get("X-User-Id") or "anon"
    return f"process_key:{token_id}:{user_id}"


# ---------------------------------------------------------------------------
# Request body
# ---------------------------------------------------------------------------


class _ProcessKeyBody(BaseModel):
    flow_type: str = Field(
        ...,
        pattern=r"^(teaser|onboard|internal_report|csv|resync)$",
    )
    source: str = Field(..., pattern=r"^(okx|binance|bybit|csv)$")
    context: dict[str, Any]

    # H-11 — per-flow_type source whitelist. Without this, a malicious caller
    # can send flow_type='teaser', source='csv' which routes to the CSV
    # adapter whose fetch_raw expects raw_bytes context — producing 500 +
    # traceback noise that consumes the cron's error budget and triggers
    # auto-rollback (DoS).
    @field_validator("source")
    @classmethod
    def _validate_source_per_flow(cls, source: str, info) -> str:
        flow_type = info.data.get("flow_type")
        if flow_type is None:
            # If flow_type is absent or already invalid, let its own
            # validator surface the error rather than masking it here.
            return source
        valid: dict[str, set[str]] = {
            "teaser": {"okx", "binance", "bybit"},
            "onboard": {"okx", "binance", "bybit"},
            "internal_report": {"okx", "binance", "bybit"},
            "resync": {"okx", "binance", "bybit"},
            "csv": {"csv"},
        }
        allowed = valid.get(flow_type, set())
        if source not in allowed:
            raise ValueError(
                f"H-11: source={source!r} not allowed for flow_type={flow_type!r}; "
                f"allowed={sorted(allowed)}"
            )
        return source


# ---------------------------------------------------------------------------
# Auth (mirrors routers/internal.py:104-118)
# ---------------------------------------------------------------------------


def _verify_internal_token(request: Request) -> None:
    """Constant-time compare on Authorization header.

    Mirrors routers/internal.py:117 verbatim. The X-Internal-Token header
    is the wire shape used by the existing /internal/* surface, but the
    Phase 19 thin adapters (P5) post `Authorization: Bearer ${token}`
    (the standard idiom for cross-service calls between Vercel and
    Railway). We accept both shapes — the bearer form for the new
    callers and a bare token for any internal call that piggybacks on
    this seam — but always run the compare via secrets.compare_digest.
    """
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        log.error("INTERNAL_API_TOKEN not set", path="/process-key")
        raise HTTPException(
            status_code=403, detail="Internal API not configured"
        )
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        provided = auth[len("Bearer ") :]
    else:
        provided = auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _envelope_error(
    code: str | None,
    msg: str | None,
    cid: str,
    vid: str | None,
) -> dict:
    """Phase 17 DESIGN-05 envelope. ok=False renders as wizard error UI."""
    return {
        "ok": False,
        "code": code or "UNKNOWN",
        "human_message": msg or "Unknown error",
        "debug_context": {"verification_id": vid} if vid else {},
        "correlation_id": cid,
        "recoverable": code
        in {"RATE_LIMITED", "EXCHANGE_UNAVAILABLE", "NETWORK_UNAVAILABLE"},
    }


def _is_long_fetch(body: _ProcessKeyBody) -> bool:
    """Heuristic per RESEARCH §P4 L1034-1045.

    teaser/csv/internal_report run inline (Vercel 300s ceiling sufficient);
    onboard + resync queue via worker dyno (BACKBONE-09).
    """
    return body.flow_type in {"onboard", "resync"}


def _metrics_to_jsonb(m: Any) -> dict:
    """MC-4 — re-export from services.ingestion.serde so the synchronous
    router and the async long_fetch worker share a single source of truth
    (WR-05 fix per REVIEW.md 2026-05-08). The wrapper keeps the existing
    ``routers.process_key._metrics_to_jsonb`` symbol stable for tests that
    import it directly.
    """
    return _shared_metrics_to_jsonb(m)


async def _run_validate_only(
    *,
    body: "_ProcessKeyBody",
    correlation_id: str,
    started_at: float,
) -> dict:
    """CR-02 — pre-strategy validation flow.

    Runs only `adapter.validate()` (no DB insert, no state-machine
    transitions, no fingerprint/encryption). Used by the two wizard steps
    that fire BEFORE a strategy_verifications row exists:
      - keys/validate-and-encrypt (onboard step 2, context.step='validate')
      - strategies/csv-validate    (CSV step 1, context.step='validate')

    Returns the same envelope shape both legacy callers were already
    consuming (`{ ok, code, human_message, debug_context, ... }` for failure;
    `{ valid: true, ... }` for success), so the thin adapters do not need
    to branch on the flow shape.
    """
    submission = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )
    adapter = get_adapter(body.source)
    val = await adapter.validate(submission)
    duration_ms = int((time.monotonic() - started_at) * 1000)
    if not val.valid:
        log.info(
            "process_key.validate_only_failed",
            error_code=val.error_code,
            duration_ms=duration_ms,
        )
        return _envelope_error(
            val.error_code, val.human_message, correlation_id, None
        )
    log.info("process_key.validate_only_ok", duration_ms=duration_ms)
    return {
        "ok": True,
        "valid": True,
        "read_only": val.read_only,
        "correlation_id": correlation_id,
        "step": "validate",
    }


# ---------------------------------------------------------------------------
# POST /process-key
# ---------------------------------------------------------------------------


@router.post("")
@limiter.limit("100/hour", key_func=_process_key_rate_limit_key)
async def process_key(request: Request, body: _ProcessKeyBody) -> dict:
    # Slowapi inspects the function signature for a parameter literally named
    # `request` (or `websocket`) to attach the limiter context — see
    # slowapi/extension.py:713. Renaming this parameter from `req` to
    # `request` is non-negotiable; the closer-spelled `req` raised
    # `Exception: No "request" or "websocket" argument on function`.
    _verify_internal_token(request)

    correlation_id = request.headers.get("X-Correlation-Id", "")
    started_at = time.monotonic()

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        flow_type=body.flow_type,
        source=body.source,
    )
    log.info("process_key.start")

    # Feature flag gate (BACKBONE-04 / BACKBONE-05) BEFORE any Supabase work.
    # H-3 — Supabase outage handling: is_unified_backbone_active() in
    # services/feature_flags.py keeps the in-process cache live across
    # transient Supabase failures so a brief upstream outage does NOT flip
    # the synchronous /process-key path to 503. The kill-switch read fails
    # open (env decides) and extends the in-process cache TTL across the
    # outage; tested in test_feature_flags.py::test_supabase_outage_falls_back_to_env.
    if not await is_unified_backbone_active():
        log.info("process_key.flag_off")
        # API-6 — Phase 17 DESIGN-05 envelope. Pre-fix used
        # HTTPException(detail={code,...}) which serialized to
        # {"detail": {"code": ...}} — incompatible with the wizard
        # error renderer that reads top-level `code` / `human_message`.
        return JSONResponse(
            status_code=503,
            content=_envelope_error(
                "UNIFIED_BACKBONE_DISABLED",
                "Unified backbone is disabled; legacy route should handle.",
                correlation_id,
                None,
            ),
        )

    supabase = get_supabase()

    # H-2 — write audit row at entry (after the flag gate) so the
    # flag-monitor cron's denominator is non-zero on the served path.
    # Without this row, the cron computes errorRate = errorCount/0 = 0 and
    # never trips even at 100% Sentry error rate. Use the existing
    # log_audit_event_service RPC (migration 058) so the service-role client
    # can write without auth.uid(). Audit-write failure is non-fatal — the
    # request continues — but we log so a sustained outage surfaces in
    # Sentry (cron P7 also alerts when the denominator stays at 0 for >2
    # windows). We intentionally write AFTER the flag gate so the cron
    # measures only requests that actually traversed the unified backbone;
    # flag-off rejections should not inflate the denominator.
    #
    # WR-06 fix: audit_log.entity_id is NOT NULL (migration 010 line 72) and
    # log_audit_event_service raises when p_entity_id is NULL (migration 058
    # line 105-106). For validate-only flows (CR-02), strategy_id is absent
    # because the wizard step happens before strategy creation; fall back to
    # wizard_session_id (a UUID, schema-compatible with the entity_id UUID
    # column). The cron's denominator query keys on entity_type='process_key'
    # only, so the entity_id sentinel does not affect the rollback math.
    audit_entity_id = (
        body.context.get("strategy_id") or body.context.get("wizard_session_id")
    )

    # I-perf-3 — fire-and-forget the audit row write. The RPC is
    # best-effort (non-fatal on failure; the request continues either
    # way), so adding its RTT to the synchronous /process-key path is
    # pure latency tax. Wrapping in asyncio.to_thread + create_task
    # detaches the write from the response path; failures still surface
    # via structlog WARN inside the helper. We intentionally do NOT
    # await the resulting task — that would re-serialize.
    import asyncio

    def _write_audit_sync() -> None:
        try:
            supabase.rpc(
                "log_audit_event_service",
                {
                    "p_user_id": body.context.get("user_id"),
                    "p_action": "process_key.entry",
                    "p_entity_type": "process_key",
                    "p_entity_id": audit_entity_id,
                    "p_metadata": {
                        "flow_type": body.flow_type,
                        "source": body.source,
                        "correlation_id": correlation_id,
                        "entity_id_source": (
                            "strategy_id"
                            if body.context.get("strategy_id")
                            else "wizard_session_id"
                        ),
                    },
                },
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log.warning("process_key.audit_write_failed", error=str(exc))

    asyncio.create_task(asyncio.to_thread(_write_audit_sync))

    submission = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )

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
            log.info(
                "process_key.idempotent_hit",
                verification_id=existing.data["id"],
            )
            # API-7 — emit WIZARD_DUPLICATE so the wizard renders the
            # idempotent-resume affordance. Pre-fix this path returned a
            # plain happy-shape dict and the wizard had no observable
            # signal that the row pre-existed. Status 200 (NOT a 409) per
            # the spec — idempotency is a feature, not a failure.
            return {
                "code": "WIZARD_DUPLICATE",
                "idempotent": True,
                "verification_id": existing.data["id"],
                "status": existing.data["status"],
                "trust_tier": existing.data.get("trust_tier"),
                "correlation_id": correlation_id,
                "queued": False,
            }

    # CR-02 fix (REVIEW.md 2026-05-08): two flag-on entry routes do NOT carry
    # strategy_id because the wizard step runs BEFORE the strategy row exists:
    #   - keys/validate-and-encrypt (onboard wizard step 2, context.step="validate")
    #   - strategies/csv-validate    (CSV wizard step 1, context.step="validate")
    # The pre-fix `body.context["strategy_id"]` lookup raised KeyError on every
    # such call. We treat `step=="validate"` AND missing strategy_id as the
    # pre-strategy validation flow: run only adapter.validate() and return the
    # envelope without persisting a strategy_verifications row. The eventual
    # full pipeline runs later via finalize-wizard / verify-strategy once a
    # strategy_id has been allocated.
    step = body.context.get("step")
    strategy_id = body.context.get("strategy_id")
    if strategy_id is None:
        if step == "validate":
            return await _run_validate_only(
                body=body,
                correlation_id=correlation_id,
                started_at=started_at,
            )
        # API-3 — csv-finalize step. The CSV wizard's finalize step (POST
        # /api/strategies/csv-finalize) lands here AFTER validate but
        # BEFORE the strategies row exists. We delegate to the
        # finalize_csv_strategy RPC (migration 093 STEP 5) which atomically
        # creates the strategies row + strategy_verifications row in a
        # single SECURITY DEFINER transaction. Pre-fix this returned 422
        # because the strategy_id branch only allowed step='validate'.
        if (
            body.flow_type == "csv"
            and step == "finalize"
            and body.source == "csv"
        ):
            user_id = body.context.get("user_id")
            wsid = body.context.get("wizard_session_id")
            fmt = body.context.get("fmt")
            strategy_name = body.context.get("strategy_name")
            try:
                rpc_result = (
                    supabase.rpc(
                        "finalize_csv_strategy",
                        {
                            "p_user_id": user_id,
                            "p_wizard_session_id": wsid,
                            "p_fmt": fmt,
                            "p_strategy_name": strategy_name,
                        },
                    ).execute()
                )
                new_strategy_id = rpc_result.data
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "process_key.csv_finalize_rpc_failed", error=str(exc)[:200]
                )
                return JSONResponse(
                    status_code=422,
                    content=_envelope_error(
                        "CSV_FINALIZE_FAILED",
                        f"finalize_csv_strategy RPC failed: {exc}",
                        correlation_id,
                        None,
                    ),
                )
            log.info(
                "process_key.csv_finalize_ok",
                strategy_id=str(new_strategy_id),
            )
            return {
                "ok": True,
                "strategy_id": new_strategy_id,
                "status": "pending_review",
                "correlation_id": correlation_id,
                "step": "finalize",
            }
        # API-6 — Phase 17 DESIGN-05 envelope (top-level code/human_message,
        # not nested under `detail`). The wizard's error renderer reads the
        # envelope shape directly off the response body.
        return JSONResponse(
            status_code=422,
            content=_envelope_error(
                "MISSING_STRATEGY_ID",
                (
                    "context.strategy_id is required for this flow_type. "
                    "Validate-only flows must set context.step='validate'."
                ),
                correlation_id,
                None,
            ),
        )
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
        # Pitfall 2 — TOCTOU race: SELECT pre-check passed but INSERT loses
        # to a concurrent insert from another wizard tab. Catch SQLSTATE
        # 23505 and return the row that actually won the race.
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
            # API-7 — race-resolved idempotent hit emits WIZARD_DUPLICATE
            # for the same reason as the SELECT-pre-check path above.
            return {
                "code": "WIZARD_DUPLICATE",
                "idempotent": True,
                "verification_id": existing.data["id"],
                "status": existing.data["status"],
                "trust_tier": existing.data.get("trust_tier"),
                "correlation_id": correlation_id,
                "queued": False,
            }
        raise

    # 3) Long-fetch dispatch (BACKBONE-09) — onboard/resync go to worker dyno.
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

    # 4) Synchronous pipeline (teaser / csv / internal_report).
    adapter = get_adapter(body.source)

    # validate
    val = await adapter.validate(submission)
    if not val.valid:
        supabase.rpc(
            "transition_strategy_verification",
            {
                "p_verification_id": verification_id,
                "p_new_status": "draft",
                "p_metadata": {
                    "errors": [
                        {
                            "code": val.error_code,
                            "human_message": val.human_message,
                        }
                    ]
                },
            },
        ).execute()
        return _envelope_error(
            val.error_code, val.human_message, correlation_id, verification_id
        )

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
    encrypted: dict[str, Any] | None = None
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
            "p_metadata": {"encrypted_credentials": encrypted}
            if encrypted
            else {},
        },
    ).execute()

    # compute_fingerprint + persist on strategies row
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

    # reconstruct_positions (BACKBONE-09 wiring); persisted in P8.
    await adapter.reconstruct_positions(trades)

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
