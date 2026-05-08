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

from typing import Any

import structlog

from services.db import get_supabase
from services.ingestion import get_adapter
from services.ingestion.adapter import KeySubmissionRequest
from services.ingestion.serde import metrics_to_jsonb as _shared_metrics_to_jsonb

log = structlog.get_logger("quantalyze.analytics.long_fetch")


def _metrics_to_jsonb(m: Any) -> dict:
    """WR-05 fix (REVIEW.md 2026-05-08): delegate to the shared MC-4
    encoder in services.ingestion.serde so the long-fetch worker path
    matches the synchronous router path. The pre-fix ``__dict__`` walk
    silently corrupted JSONB if any future MetricsSnapshot field became
    ``datetime`` / ``Decimal`` / non-primitive.
    """
    return _shared_metrics_to_jsonb(m)


async def run_process_key_long_job(job: dict) -> "DispatchResult":
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
    # advanced past metrics_captured (i.e. report_queued / encrypted /
    # near-published), the broker fetch + metrics compute are wasted: the
    # remaining work is post-fetch (encryption + fingerprint persistence
    # + final transition). On a worker retry-after-transient-error this
    # avoids hammering the broker for trades we already have. We still
    # return DONE rather than re-running the post-fetch tail because
    # those side effects already landed before the transient-failure
    # checkpoint. A follow-up that resumes the tail from
    # metrics_captured belongs in a separate plan.
    advanced_statuses = {"encrypted", "report_queued"}
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
        flow_type=flow_type,
        source=source,
        context=context,
    )

    adapter = get_adapter(source)

    # 1. validate
    val = await adapter.validate(request)
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
        permanent_codes = {"AUTH_FAILED", "PERMISSION_DENIED"}
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"validate failed: {val.error_code}",
            error_kind="permanent" if val.error_code in permanent_codes else "transient",
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
    encrypted: dict | None = None
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
