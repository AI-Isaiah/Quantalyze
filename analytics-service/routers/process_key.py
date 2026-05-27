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

NOTE — DO NOT add ``from __future__ import annotations`` to this module.
FastAPI 0.115.x (pinned in requirements.txt) inspects ``param.annotation``
(the raw, source-form annotation) to decide body-vs-query for a route
parameter. Under PEP-563 stringification, the BaseModel-typed ``body``
parameter becomes the string ``"_ProcessKeyBody"`` and FastAPI falls
back to treating it as a query parameter — every JSON-body POST then
422s with ``loc:["query","body"], "Field required"``. The Annotated
``Body()`` marker survives PEP-563 in newer fastapi but not in the
pinned version. Until fastapi is bumped (separate PR), this module
must keep annotations evaluated at function-definition time.
"""

import asyncio
import os
import secrets
import time
import uuid
from typing import Annotated, Any

import hashlib

import structlog
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from services.db import get_supabase, get_user_scoped_supabase
from services.feature_flags import is_unified_backbone_active
from services.ingestion import get_adapter
from services.ingestion.adapter import KeySubmissionRequest
from services.ingestion.serde import metrics_to_jsonb as _metrics_to_jsonb
from services.rate_limit import limiter
from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID

router = APIRouter(prefix="/process-key", tags=["process-key"])
log = structlog.get_logger("quantalyze.analytics.process_key")

# CT-8 (army2) — module-level strong-reference set for the I-perf-3
# fire-and-forget audit tasks. Per CPython docs, asyncio.create_task()
# only holds a WEAK reference to the returned Task; if the caller
# discards the reference and there are no other strong refs, the GC
# may collect the Task mid-flight and raise
#   RuntimeError: Task was destroyed but it is pending!
# losing the audit row silently. Holding a strong ref in this set —
# combined with task.add_done_callback(_audit_tasks.discard) — keeps
# the Task alive until completion and self-cleans on success.
_audit_tasks: set[asyncio.Task[None]] = set()


def _process_key_rate_limit_key(request: Request) -> str:
    """API-5 — rate-limit key for /process-key.

    Pre-fix used ``get_remote_address`` which buckets all Vercel egress
    behind a single shared NAT into the same window — so one tenant's
    burst could starve every other tenant. The unified backbone is
    service-to-service auth via INTERNAL_API_TOKEN; we key on a hash of
    the bearer token so each calling service gets an isolated 100/hour
    window.

    Tokens are SHA-256-hashed with a non-cryptographic suffix because
    the resulting key shows up in slowapi error logs and we don't want
    raw bearer tokens in observability output. The hash collapses the
    bearer to a stable 16-char prefix.

    PR #241 red-team: an earlier version composed (token_id, X-User-Id)
    into the key so multi-user traffic on a single token got isolated
    buckets. But `X-User-Id` is unsigned client-controlled input — a
    caller holding the bearer token could set
    `X-User-Id: <random-uuid-per-request>` and allocate a new bucket
    per request, bypassing the limiter. The header read is removed
    until a signed identity surface lands (e.g. mTLS or a JWT body
    field bound to the token).
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):]
    else:
        token = auth or "unauthenticated"
    token_id = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    return f"process_key:{token_id}"


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

    # I-API2 — per-flow_type required-keys assertion. Pre-fix, missing
    # context fields surfaced deep inside the adapter as KeyError 500s;
    # this model_validator surfaces them as a clean 422 at the wire
    # boundary. Validate-only flows (step='validate') skip the credential
    # / file-bytes assertion because those keys are still being collected
    # by the wizard step.
    @model_validator(mode="after")
    def _validate_per_flow_required_keys(self) -> "_ProcessKeyBody":
        ctx = self.context or {}
        step = ctx.get("step")

        # Validate-only and finalize-step flows have their own pre-strategy
        # branches in the route handler; skip the credential / file-bytes
        # assertion here so those branches can run.
        if step in {"validate", "finalize"}:
            return self

        if self.flow_type in {"teaser", "onboard", "resync"}:
            missing = [k for k in ("api_key", "api_secret") if k not in ctx]
            if missing:
                raise ValueError(
                    f"flow_type={self.flow_type!r} requires context keys "
                    f"{missing!r}"
                )
        elif self.flow_type == "csv":
            # CSV needs raw_bytes_base64 (canonical) OR raw_bytes (legacy)
            # AND fmt AND wizard_session_id. internal_report has its own
            # set; keeping the strict check for csv only here keeps the
            # validator low-risk and tightly scoped.
            if "fmt" not in ctx:
                raise ValueError("flow_type='csv' requires context.fmt")
            if "wizard_session_id" not in ctx:
                raise ValueError(
                    "flow_type='csv' requires context.wizard_session_id"
                )
            if (
                "raw_bytes_base64" not in ctx
                and "raw_bytes" not in ctx
            ):
                raise ValueError(
                    "flow_type='csv' requires context.raw_bytes_base64 "
                    "(canonical) or context.raw_bytes (legacy)"
                )
        return self


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
    envelope: dict[str, Any] = {
        "ok": True,
        "valid": True,
        "read_only": val.read_only,
        "correlation_id": correlation_id,
        "step": "validate",
    }
    # Phase 19.1 fix (2026-05-27) — surface the CSV preview + normalized
    # daily-return series the wizard's CsvUploadStep requires. It raises
    # CSV_UPSTREAM_FAIL when `preview` is absent and forwards
    # `daily_returns_series` to csv-finalize. Only the CSV adapter populates
    # these; the API-key validate-only flow leaves them None, so the keys are
    # omitted and that envelope is unchanged.
    if val.preview is not None:
        envelope["preview"] = val.preview
    if val.daily_returns_series is not None:
        envelope["daily_returns_series"] = val.daily_returns_series
    return envelope


# ---------------------------------------------------------------------------
# POST /process-key
# ---------------------------------------------------------------------------


@router.post("")
@limiter.limit("100/hour", key_func=_process_key_rate_limit_key)
async def process_key(
    request: Request,
    body: Annotated[_ProcessKeyBody, Body()],
) -> dict:
    # `Annotated[_ProcessKeyBody, Body()]` — explicit Body marker. Without it,
    # `from __future__ import annotations` (line 18) stringifies the type hint
    # to "_ProcessKeyBody", and FastAPI 0.115.x's body-vs-query auto-detection
    # falls back to query, producing 422s with `loc:["query","body"]`. Newer
    # fastapi (0.135.x) auto-detects the BaseModel correctly, but the pinned
    # version in requirements.txt does not — and this is the request-body
    # contract surface, so explicit beats implicit.
    #
    # Slowapi inspects the function signature for a parameter literally named
    # `request` (or `websocket`) to attach the limiter context — see
    # slowapi/extension.py:713. Renaming this parameter from `req` to
    # `request` is non-negotiable; the closer-spelled `req` raised
    # `Exception: No "request" or "websocket" argument on function`.
    _verify_internal_token(request)

    # 2026-05-27 — the client-supplied correlation id flows into structured
    # logs AND the UUID column strategy_verifications.correlation_id. Accept it
    # only if it is a well-formed UUID; otherwise mint one. This prevents
    # log-shaping via an unbounded/newline header and the empty-string-into-
    # UUID-column insert failure. The TS client always sends a UUID, so this is
    # a no-op for the real caller.
    _raw_cid = request.headers.get("X-Correlation-Id", "")
    try:
        correlation_id = str(uuid.UUID(str(_raw_cid)))
    except (ValueError, AttributeError, TypeError):
        correlation_id = str(uuid.uuid4())
    started_at = time.monotonic()

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        flow_type=body.flow_type,
        source=body.source,
    )
    log.info("process_key.start")

    # CT-4 (army2) — emit a structured WARN when a non-teaser flow lacks
    # the X-User-Id header. The Vercel thin adapters MUST forward it (see
    # src/lib/process-key-client.ts) so the 100/hour rate-limit window
    # buckets per-tenant. teaser is the public/unauthenticated landing
    # form and intentionally passes 'public' as a shared anon bucket.
    # If a future caller drops the header, this WARN keeps it visible in
    # observability before cross-tenant burst can starve other tenants.
    if (
        body.flow_type != "teaser"
        and request.headers.get("X-User-Id") is None
    ):
        log.warning(
            "process_key.x_user_id_header_missing",
            flow_type=body.flow_type,
            source=body.source,
            wizard_session_id=body.context.get("wizard_session_id"),
        )

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
    # PR-X5 / D7 (2026-05-15) — unify the API key ingestion path. Teaser
    # submissions arrive from the public landing page without a
    # caller-owned strategy (the user is probing keys against the
    # universe of published strategies; no strategy exists yet) AND
    # without a wizard_session_id (no wizard — single-shot submission).
    #
    # Inject BOTH here, BEFORE audit_entity_id is computed below, so the
    # H-2 audit row write does not fail with NULL p_entity_id (which
    # log_audit_event_service raises). That keeps teaser submissions in
    # the flag-monitor cron's denominator post-flag-flip, preserving the
    # auto-rollback math.
    #
    # SECURITY (PR-X5 review fix): override UNCONDITIONALLY for teaser.
    # The TS handler at src/app/api/verify-strategy/route.ts is supposed
    # to allowlist context fields (post-X5), but if a future change
    # regresses and spreads the raw body again, an unauthenticated
    # attacker could POST `{strategy_id:<victim-uuid>,
    # wizard_session_id:<chosen>}` and bypass a fill-if-null injection,
    # writing an SV row anchored to an arbitrary strategy. Treating
    # teaser as anchor-less by definition closes that hole at the
    # backend boundary regardless of upstream input shape.
    #
    # NO downstream branches on `flow_type == 'teaser'` — that would be
    # unification cosplay. The fingerprint write on the sentinel and
    # reconstruct_positions(trades) on a discarded return value are both
    # harmless side effects, so they run unmodified.
    #
    # The injected wizard_session_id is a fresh uuid4 per submission;
    # teaser submissions are deliberately NOT idempotent (each landing-
    # page submission is a separate verification, so a fresh UUID
    # always misses the SELECT-pre-check below and writes a new row).
    if body.flow_type == "teaser":
        body.context["strategy_id"] = TEASER_ANCHOR_STRATEGY_ID
        body.context["wizard_session_id"] = str(uuid.uuid4())

    audit_entity_id = (
        body.context.get("strategy_id") or body.context.get("wizard_session_id")
    )

    # I-SEC2 — emit a structured warning when context.user_id is missing on
    # a non-public flow. The teaser flow_type is intentionally
    # unauthenticated and runs without a user_id (the public homepage form
    # can be submitted by anyone). For onboard / resync / csv / internal_report
    # the wizard ALWAYS has an auth session, so a missing user_id signals a
    # caller misconfiguration that the cron's audit-log denominator cannot
    # subsequently disambiguate.
    if (
        body.context.get("user_id") is None
        and body.flow_type != "teaser"
    ):
        log.warning(
            "process_key.user_id_missing",
            flow_type=body.flow_type,
            source=body.source,
            wizard_session_id=body.context.get("wizard_session_id"),
        )

    # I-perf-3 — fire-and-forget the audit row write. The RPC is
    # best-effort (non-fatal on failure; the request continues either
    # way), so adding its RTT to the synchronous /process-key path is
    # pure latency tax. Wrapping in asyncio.to_thread + create_task
    # detaches the write from the response path; failures still surface
    # via structlog WARN inside the helper. We intentionally do NOT
    # await the resulting task — that would re-serialize.
    #
    # CT-8 (army2) — hold a strong reference to the Task in
    # `_audit_tasks` and add a done_callback to discard it on
    # completion. Pre-fix the bare `asyncio.create_task(...)` discarded
    # the return value; CPython holds only a WEAK ref so the GC could
    # collect the Task mid-flight, raising
    #   RuntimeError: Task was destroyed but it is pending!
    # and silently losing the audit row.

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

    _audit_task = asyncio.create_task(asyncio.to_thread(_write_audit_sync))
    _audit_tasks.add(_audit_task)
    _audit_task.add_done_callback(_audit_tasks.discard)

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
        # `.maybe_single().execute()` returns None (NOT a response object with
        # data=None) when zero rows match — which is the normal case for a
        # brand-new upload (no prior strategy_verifications row for this
        # wizard_session_id). The pre-fix `if existing.data:` therefore raised
        # `AttributeError: 'NoneType' object has no attribute 'data'` and 500'd
        # the ENTIRE ingestion for every first-time upload once the
        # unified-backbone flag was flipped on. Guard the None: absent row →
        # not idempotent → fall through to the normal insert path below.
        if existing is not None and existing.data:
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
            # finalize_csv_strategy is SECURITY DEFINER and enforces
            # auth.uid() = p_user_id (migration 20260501055202): a user may
            # only finalize their OWN strategy. The module service-role client
            # has no auth.uid(), so calling it with `supabase` raised 42501
            # "called without an auth session" on every flag-on finalize. Call
            # it with a user-scoped client built from the access token the
            # Next.js csv-finalize route forwards in X-User-Access-Token; the
            # RPC's auth.uid() = p_user_id check still runs (defense in depth).
            # Everything else in this handler stays service-role.
            user_token = request.headers.get("X-User-Access-Token", "")
            if not user_token:
                log.warning("process_key.csv_finalize_missing_user_token")
                return JSONResponse(
                    status_code=401,
                    content=_envelope_error(
                        "CSV_FINALIZE_FAILED",
                        "finalize requires an authenticated user session.",
                        correlation_id,
                        None,
                    ),
                )
            try:
                user_sb = get_user_scoped_supabase(user_token)
                rpc_result = (
                    user_sb.rpc(
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
            # Re-fetch the row that won the race. Use maybe_single (returns
            # None on zero rows) rather than single (raises PGRST116): if a
            # TOCTOU delete / RLS hide between the failed insert and this
            # re-select leaves no row, we must surface the ORIGINAL 23505
            # rather than mask it with a cryptic None-deref or PGRST116 500.
            race_winner = (
                supabase.table("strategy_verifications")
                .select("*")
                .eq("wizard_session_id", wizard_session_id)
                .maybe_single()
                .execute()
            )
            if race_winner is None or not race_winner.data:
                raise
            log.info(
                "process_key.idempotent_race_resolved",
                verification_id=race_winner.data["id"],
            )
            # API-7 — race-resolved idempotent hit emits WIZARD_DUPLICATE
            # for the same reason as the SELECT-pre-check path above.
            return {
                "code": "WIZARD_DUPLICATE",
                "idempotent": True,
                "verification_id": race_winner.data["id"],
                "status": race_winner.data["status"],
                "trust_tier": race_winner.data.get("trust_tier"),
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
    # Unified rejection gate: covers both ordinary validation failures
    # (not val.valid — e.g. AUTH_FAILED, PERMISSION_DENIED) and
    # NEW-C31-01: write-capable key scope violations that must be caught
    # BEFORE any encryption step. The read_only arm only blocks on
    # explicit False — None (CSV, scope not applicable) is not rejected.
    # The error_code arm fires even when read_only is True (IMP-2: a
    # broker that sets a scope error_code without clearing read_only=True
    # must still be rejected — see test "error_code_wins").
    _scope_rejected = (
        not val.valid
        or val.read_only is False
        or val.error_code in {"TRADE_SCOPE", "WITHDRAW_SCOPE"}
    )
    if _scope_rejected:
        # SF-2: use VALIDATION_UNEXPECTED as the fallback — it is a registered
        # WizardErrorCode (adapter.py:74) and has defined copy in wizardErrors.ts.
        # "VALIDATION_FAILED" is not registered and causes a silent blank wizard
        # error state when the frontend lookup returns undefined.
        _reject_code = val.error_code or "VALIDATION_UNEXPECTED"
        # SF-1: security-sensitive scope rejections must be observable in the
        # structlog stream so operators can detect regressions / anomalies.
        log.warning(
            "process_key.write_capable_key_rejected",
            reject_code=_reject_code,
            read_only=val.read_only,
            verification_id=verification_id,
            correlation_id=correlation_id,
        )
        # SF-3: wrap the RPC call so a Supabase failure does not replace the
        # security-correct envelope error with an unexpected 500. Best-effort
        # status transition: returning the error to the caller is more
        # important than atomicity with the DB state machine.
        try:
            supabase.rpc(
                "transition_strategy_verification",
                {
                    "p_verification_id": verification_id,
                    "p_new_status": "draft",
                    "p_metadata": {
                        "errors": [
                            {
                                "code": _reject_code,
                                "human_message": val.human_message,
                            }
                        ]
                    },
                },
            ).execute()
        except Exception as _rpc_err:
            log.error(
                "process_key.scope_rejection_rpc_failed",
                reject_code=_reject_code,
                verification_id=verification_id,
                correlation_id=correlation_id,
                error=str(_rpc_err),
            )
        return _envelope_error(
            _reject_code, val.human_message, correlation_id, verification_id
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

    # PR-X5 (2026-05-15) — Enrich metrics_snapshot with the legacy
    # verify_strategy response shape so the landing-page card
    # (src/components/landing/VerificationSection.tsx::VerificationResultData)
    # renders fully for every flow_type. Pre-X5 the unified pipeline
    # only persisted MetricsSnapshot fields (sharpe/twr/ytd/...),
    # missing return_24h/mtd, equity_curve, and matched_strategy_id —
    # the legacy verify_strategy (portfolio.py:1055-1063) computed all
    # of them. D7 unification: enrichment runs for ALL flow_types so the
    # SV row's metrics_snapshot column has the same shape regardless of
    # how the row was created.
    #
    # account_balance is None here (the unified adapter pipeline doesn't
    # fetch USDT balance — that's an exchange-API call the legacy path
    # makes via fetch_usdt_balance). trades_to_daily_returns falls back
    # to the heuristic-capital path documented in services/transforms.py
    # (degrades 5–10× on volatile strategies). Same fallback the legacy
    # path uses when fetch_usdt_balance fails — no regression vs status
    # quo. Wiring real balance is a follow-up that touches the adapter
    # Protocol.
    enriched_metrics_snapshot: dict[str, Any] = _metrics_to_jsonb(metrics)
    matched_strategy_id: str | None = None
    try:
        import dataclasses

        from services.portfolio_metrics import compute_period_returns
        from services.strategy_matching import find_matched_strategy
        from services.transforms import trades_to_daily_returns

        trades_as_dicts = [
            dataclasses.asdict(t)
            if dataclasses.is_dataclass(t) and not isinstance(t, type)
            else t
            for t in trades
        ]
        returns = trades_to_daily_returns(
            trades_as_dicts, account_balance=None
        )
        if returns is not None and len(returns) >= 2:
            period_returns = compute_period_returns(returns)
            cumulative = (1 + returns).cumprod()
            equity_curve = [
                {"date": d.isoformat(), "value": float(v)}
                for d, v in cumulative.items()
            ]
            matched_strategy_id = find_matched_strategy(returns, supabase)
            enriched_metrics_snapshot.update(
                {
                    "return_24h": period_returns.get("return_24h"),
                    "return_mtd": period_returns.get("return_mtd"),
                    "return_ytd": period_returns.get("return_ytd"),
                    "equity_curve": equity_curve,
                    "matched_strategy_id": matched_strategy_id,
                }
            )
        else:
            # Insufficient trade history — null out the legacy-shape
            # fields so the landing-page card explicitly renders dashes
            # rather than silently omitting the keys.
            enriched_metrics_snapshot.update(
                {
                    "return_24h": None,
                    "return_mtd": None,
                    "return_ytd": None,
                    "equity_curve": None,
                    "matched_strategy_id": None,
                }
            )
    except Exception as exc:  # noqa: BLE001
        # Enrichment is best-effort. If the pandas math or the matching
        # SELECT raises, persist the base MetricsSnapshot shape and let
        # the user see partial data rather than failing the entire
        # verification. Same precedent as the legacy verify_strategy's
        # try/except around find_matched_strategy (portfolio.py:1052).
        log.warning(
            "process_key.enrichment_failed",
            error=str(exc)[:200],
            verification_id=verification_id,
        )

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "metrics_captured",
            "p_metadata": {"metrics_snapshot": enriched_metrics_snapshot},
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
        # PR-X5 — return the enriched snapshot (with return_24h/mtd/ytd,
        # equity_curve, matched_strategy_id) so the response shape
        # mirrors the SV row's metrics_snapshot column. Mirrors the
        # legacy verify_strategy's `results` payload shape.
        "metrics_snapshot": enriched_metrics_snapshot,
        # PR-X5 — top-level matched_strategy_id matches the legacy
        # verify_strategy response shape (portfolio.py:1075). The TS
        # legacy handler at src/app/api/verify-strategy/route.ts already
        # folds it into metrics_snapshot when stamping the SV row;
        # unified callers can read either location.
        "matched_strategy_id": matched_strategy_id,
        "fingerprint": fp.to_jsonb(),
        "encrypted_credentials": encrypted,
        "errors": [],
        "correlation_id": correlation_id,
    }
