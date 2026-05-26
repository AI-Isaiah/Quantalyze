"""Phase 19 / BACKBONE-09 — process_key_long worker handler.

Runs the same 5-method IngestionAdapter pipeline as routers/process_key.py
(P4) but for queued (long-fetch) flows. Dispatched from
services.job_worker.dispatch when compute_jobs.kind='process_key_long'.

The handler reads compute_jobs.metadata for:
  - unified_backbone_at_claim — drain check (Pitfall 3); legacy claims FAIL
  - correlation_id, verification_id, flow_type, source, context

Writes results back to strategy_verifications via
transition_strategy_verification RPC at each pipeline step. Idempotent on
retry — if verification_id is already at status='published', returns DONE
without re-running the pipeline.

D-2 — Legacy claim handling
    Legacy claims (metadata['unified_backbone_at_claim'] != 'true', including
    missing metadata or NULL) MUST NOT re-enter the unified path. PR-B's
    operational gate requires the queue to be drained of process_key_long
    jobs before flag-flip, so this branch is reached only on operator error.
    Returning FAILED-permanent moves the row to failed_final → /admin review.

Pitfall 3 — Drain semantics
    Read `flag_at_claim` from `job.metadata['unified_backbone_at_claim']`,
    NOT from the live env var (`is_unified_backbone_active()`). The env var
    can flip mid-run; the metadata snapshot was stamped atomically at claim
    time by migration 104 and is the source-of-truth for this job's path.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast, get_args

import structlog

from services.db import get_supabase
from services.ingestion import get_adapter
from services.ingestion.adapter import FlowType, KeySubmissionRequest, Source
from services.ingestion.serde import metrics_to_jsonb as _metrics_to_jsonb

if TYPE_CHECKING:
    from services.job_worker import DispatchResult

log = structlog.get_logger("quantalyze.analytics.long_fetch")


async def run_process_key_long_job(job: dict[str, Any]) -> "DispatchResult":
    """Phase 19 / BACKBONE-09 — long-fetch worker handler.

    Returns a DispatchResult; the calling job_worker dispatch loop handles
    mark_compute_job_done / mark_compute_job_failed atomically.
    """
    # Late import to avoid circular dependency at module load time
    # (services.job_worker imports from services.ingestion when it dispatches).
    from services.job_worker import DispatchOutcome, DispatchResult

    metadata = job.get("metadata") or {}
    verification_id = metadata.get("verification_id")
    flow_type = metadata.get("flow_type")
    source = metadata.get("source")
    correlation_id = metadata.get("correlation_id", "")
    flag_at_claim = metadata.get("unified_backbone_at_claim")

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        verification_id=verification_id,
        flow_type=flow_type,
        source=source,
    )
    log.info("process_key_long.start")

    # Drain check (Pitfall 3 + D-2): legacy claims (or missing metadata) MUST
    # NOT re-enter the unified path. This is the worker-side enforcement of
    # BACKBONE-05 drain semantics.
    if flag_at_claim != "true":
        log.info("process_key_long.drain_skip", flag_at_claim=flag_at_claim)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                f"process_key_long claimed under legacy backbone "
                f"(unified_backbone_at_claim={flag_at_claim!r}); D-2 — legacy "
                f"claims must be drained pre-PR-B; failed_final triggers "
                f"/admin review."
            ),
            error_kind="permanent",
        )

    if not verification_id or not source:
        log.error("process_key_long.bad_metadata", metadata=metadata)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="process_key_long: missing verification_id or source in metadata",
            error_kind="permanent",
        )

    # Narrow Any → Literal so the dataclass construction below is type-safe.
    # The metadata blob is JSON, so flow_type / source can be anything; reject
    # values outside the locked enum (CONTEXT.md L72) as permanent failures
    # instead of letting them propagate into the adapter pipeline.
    if flow_type not in get_args(FlowType) or source not in get_args(Source):
        log.error(
            "process_key_long.bad_enum",
            flow_type=flow_type,
            source=source,
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                f"process_key_long: invalid flow_type={flow_type!r} or "
                f"source={source!r} (locked enum violation)"
            ),
            error_kind="permanent",
        )

    supabase = get_supabase()

    # Idempotency: if already published, return success without re-running.
    # Worker retries (transient errors) and watchdog reclaims can both land
    # back here for a verification that already finished. The transition RPC
    # would reject illegal transitions anyway, but skipping the pipeline is
    # cheaper and avoids spurious side effects (broker fetch, encryption).
    try:
        existing = (
            supabase.table("strategy_verifications")
            .select("status")
            .eq("id", verification_id)
            .maybe_single()
            .execute()
        )
        existing_data = getattr(existing, "data", None)
    except Exception as exc:  # noqa: BLE001
        log.warning("process_key_long.idempotency_check_failed", error=str(exc)[:200])
        existing_data = None

    if existing_data and existing_data.get("status") == "published":
        log.info("process_key_long.already_published_skip")
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # I-perf-5 — broker-work short-circuit. If the verification has already
    # advanced past draft (validated / metrics_captured / encrypted /
    # report_queued / near-published), the validate + broker fetch +
    # metrics compute are at minimum wasted, and on metrics_captured the
    # subsequent `transition validated → metrics_captured` would RAISE
    # because metrics_captured → validated is not a legal pair in
    # migration 103. On a worker retry-after-transient-error this
    # avoids hammering the broker for trades we already have AND
    # avoids the illegal-transition crash. We still return DONE rather
    # than re-running the post-fetch tail because those side effects
    # already landed before the transient-failure checkpoint. A
    # follow-up that resumes the tail from metrics_captured belongs in
    # a separate plan.
    #
    # CT-6 (army2) — pre-fix this set was {'encrypted','report_queued'},
    # missing 'validated' and 'metrics_captured'. A retry that landed on
    # metrics_captured would re-run validate (transition validated→validated
    # raises) + broker fetch (burning quota) and then crash on the
    # transition_strategy_verification('metrics_captured' → 'validated').
    # The crash poisoned the next retry. Source of truth: status CHECK in
    # migration 093 (strategy_verifications).
    #
    # Any non-draft status short-circuits. The migration-093 status
    # vocabulary is closed: {draft, validated, metrics_captured, encrypted,
    # report_queued, published}. Published is already short-circuited by the
    # `existing_data.status == 'published'` branch above; we keep it here too
    # for symmetry against any future status value the closed-set CHECK
    # constraint may add (so the worker fails closed, not open).
    advanced_statuses = {
        "validated",
        "metrics_captured",
        "encrypted",
        "report_queued",
        "published",
    }
    if existing_data and existing_data.get("status") in advanced_statuses:
        log.info(
            "process_key_long.advanced_status_skip",
            status=existing_data.get("status"),
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # Build the request from the job's strategy + stored credentials.
    # NOTE: For onboard, credentials are in job.metadata.context.
    # For resync, credentials decrypt from
    # strategy_verifications.encrypted_credentials.
    context = metadata.get("context") or {}
    request = KeySubmissionRequest(
        flow_type=cast(FlowType, flow_type),
        source=cast(Source, source),
        context=context,
    )

    adapter = get_adapter(source)

    # 1. validate
    val = await adapter.validate(request)

    # C-1 (red-team): probe_error=True means detect_permissions() hit a
    # transient network/WAF failure and returned _FAIL_CLOSED
    # {read:T, trade:T, withdraw:T, probe_error:T}. exchange.py derives
    # read_only=False + error_code="WITHDRAW_SCOPE" from those fail-closed
    # defaults — NOT from real scope evidence. Treating those as a
    # permanent scope rejection would permanently ban a legitimately
    # read-only key that happened to hit an exchange 502. Bail out early
    # with transient so the worker retries the whole probe.
    # Defensive: only inspect debug_context when it is actually a dict
    # (CSV/mock adapters may leave it None or MagicMock in tests).
    _debug = val.debug_context if isinstance(val.debug_context, dict) else {}
    _probe_error = bool(_debug.get("probe_error", False))
    if _probe_error:
        log.warning(
            "process_key_long.probe_error_transient",
            error_code=val.error_code,
            verification_id=verification_id,
            correlation_id=correlation_id,
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="validate: probe_error — transient permission-probe failure",
            error_kind="transient",
        )

    # NEW-C31-01: reject write-capable keys BEFORE any encryption step.
    # val.read_only is None for CSV (not applicable); only block on
    # explicit False (exchange key with trade/withdraw scope confirmed).
    _scope_rejected = (
        not val.valid
        or val.read_only is False
        or val.error_code in {"TRADE_SCOPE", "WITHDRAW_SCOPE"}
    )
    if _scope_rejected:
        # SF-2: use VALIDATION_UNEXPECTED as the fallback — it is a registered
        # WizardErrorCode (adapter.py:74) and has defined copy in wizardErrors.ts.
        # "VALIDATION_FAILED" is not registered, causing a silent blank UI state.
        # _is_unexpected_fallback tracks whether the VALIDATION_UNEXPECTED code
        # was chosen by us as a fallback (val.error_code was None → write-capable
        # key with no scope code) vs set by the adapter for a genuine unexpected
        # exception. Only the fallback case is permanent — an adapter-set
        # VALIDATION_UNEXPECTED may be a transient exchange error (M-1 fix).
        _is_unexpected_fallback = (val.error_code is None)
        _reject_code = val.error_code or "VALIDATION_UNEXPECTED"
        # SF-1 + SF-4: security-sensitive scope rejection must be observable;
        # log verification_id + correlation_id so the operator can correlate
        # this worker event with the user's submission (DispatchResult does not
        # carry tracing fields, so the log entry is the authoritative trace anchor).
        log.warning(
            "process_key_long.write_capable_key_rejected",
            reject_code=_reject_code,
            read_only=val.read_only,
            is_unexpected_fallback=_is_unexpected_fallback,
            verification_id=verification_id,
            correlation_id=correlation_id,
        )
        # SF-3: wrap the RPC call so a Supabase failure does not leave the
        # verification in limbo AND swallow the security outcome. Best-effort
        # transition: returning FAILED to the dispatcher is more important
        # than atomicity with the DB state machine.
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
                "process_key_long.scope_rejection_rpc_failed",
                reject_code=_reject_code,
                verification_id=verification_id,
                correlation_id=correlation_id,
                error=str(_rpc_err),
            )
        # IMP-1 (M-1 fix): VALIDATION_UNEXPECTED is permanent ONLY when it
        # is our own fallback for read_only=False + no error_code — i.e. the
        # adapter confirmed write scope but did not set an error_code. When the
        # adapter itself sets VALIDATION_UNEXPECTED (unexpected exception during
        # validate), the failure MAY be transient (e.g. ccxt.ExchangeNotAvailable
        # not in the typed exception hierarchy) and must remain retryable.
        permanent_codes = {
            "AUTH_FAILED", "PERMISSION_DENIED",
            "TRADE_SCOPE", "WITHDRAW_SCOPE",
        }
        _is_permanent = (
            _reject_code in permanent_codes
            or (_reject_code == "VALIDATION_UNEXPECTED" and _is_unexpected_fallback)
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"validate failed: {_reject_code}",
            error_kind="permanent" if _is_permanent else "transient",
        )

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "validated",
            "p_metadata": {},
        },
    ).execute()

    # 2. fetch_raw — the long-fetch step (multi-year backfill)
    trades = await adapter.fetch_raw(context)

    # 3. compute_metrics
    metrics = adapter.compute_metrics(trades)
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "metrics_captured",
            "p_metadata": {"metrics_snapshot": _metrics_to_jsonb(metrics)},
        },
    ).execute()

    # 3.5 encrypt_credentials (API path only — CSV has no creds)
    encrypted: dict[str, Any] | None = None
    if source != "csv":
        from services.encryption import encrypt_credentials, get_kek

        encrypted = encrypt_credentials(
            context["api_key"],
            context["api_secret"],
            context.get("passphrase"),
            get_kek(),
        )
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "encrypted",
            "p_metadata": (
                {"encrypted_credentials": encrypted} if encrypted else {}
            ),
        },
    ).execute()

    # 4. compute_fingerprint + persist
    fp = adapter.compute_fingerprint(trades, metrics)
    strategy_id = context.get("strategy_id") or job.get("strategy_id")
    if strategy_id:
        try:
            supabase.table("strategies").update(
                {"fingerprint": fp.to_jsonb()}
            ).eq("id", strategy_id).execute()
        except Exception as exc:  # noqa: BLE001
            # Fingerprint persistence is best-effort — a failure here doesn't
            # block the rest of the pipeline. The state machine still advances
            # and the row can be re-fingerprinted via a follow-up job.
            log.warning(
                "process_key_long.fingerprint_persist_failed",
                error=str(exc)[:200],
            )

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "report_queued",
            "p_metadata": {},
        },
    ).execute()

    # 5. reconstruct_positions (BACKBONE-09 wiring) — runs after report_queued
    # because positions are a derived view; trades are the SoT.
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

    log.info("process_key_long.complete")
    return DispatchResult(outcome=DispatchOutcome.DONE)
