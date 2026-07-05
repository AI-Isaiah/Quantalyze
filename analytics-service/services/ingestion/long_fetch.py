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
    #
    # The /process-key long-fetch enqueue (routers/process_key.py) puts only
    # {correlation_id, verification_id, flow_type, source} in compute_jobs.metadata
    # -- it does NOT forward `context`. So BOTH queued flows (onboard and resync)
    # arrive here credential-less, and we resolve + decrypt the stored key
    # server-side: the strategy already has an api_key_id linkage. Reuses the
    # same load+decrypt the legacy sync_trades handler uses
    # (job_worker._load_strategy_and_key + services.encryption.decrypt_credentials,
    # including the key-belongs-to-strategy-owner check). Without it the adapter
    # pipeline below hit `context["api_key"]` KeyError / validated against empty
    # creds. This path never ran in prod before 2026-05-27 because resync 422'd
    # at the /process-key validator first (onboard's callers use
    # step=validate/finalize, which take the synchronous branches, not this one).
    # csv carries no broker credentials, so it is excluded.
    context = dict(metadata.get("context") or {})
    if source != "csv" and ("api_key" not in context or "api_secret" not in context):
        from services.encryption import decrypt_credentials, get_kek
        from services.job_worker import _load_strategy_and_key

        cred_strategy_id = context.get("strategy_id") or job.get("strategy_id")
        if not cred_strategy_id:
            log.error("process_key_long.no_strategy_id_for_creds", metadata=metadata)
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "process_key_long: missing strategy_id -- cannot resolve "
                    "stored credentials for a credential-less flow"
                ),
                error_kind="permanent",
            )
        _strategy_row, key_row, cred_err = await _load_strategy_and_key(
            supabase, cred_strategy_id
        )
        if cred_err or not key_row:
            log.error(
                "process_key_long.credential_resolution_failed",
                error=cred_err or "api key not found",
                verification_id=verification_id,
                correlation_id=correlation_id,
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=f"process_key_long: {cred_err or 'API key not found'}",
                error_kind="permanent",
            )
        api_key, api_secret, passphrase = decrypt_credentials(key_row, get_kek())
        context["api_key"] = api_key
        context["api_secret"] = api_secret
        if passphrase:
            context["passphrase"] = passphrase

    request = KeySubmissionRequest(
        flow_type=cast(FlowType, flow_type),
        source=cast(Source, source),
        context=context,
    )

    adapter = get_adapter(source)

    # P72 — Deribit returns are ledger-backed (txn-log settlement cash deltas),
    # NOT fill-derived: DeribitAdapter.compute_metrics raises NotImplementedError
    # by design. So the fill steps (fetch_raw → compute_metrics → fingerprint →
    # reconstruct_positions) cannot serve Deribit. For a ledger-backed source we
    # still run validate (the scope gate applies) + encrypt + advance the state
    # machine, but the factsheet is produced by the derive_broker_dailies ledger
    # job enqueued at the tail (the exact analogue of the perp sync_trades tail).
    is_ledger_backed = source == "deribit"

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
    # 3. compute_metrics
    #
    # Skipped entirely for a ledger-backed source: fetch_raw would hit the
    # fills endpoint and compute_metrics raises by design. metrics_captured is
    # still emitted (empty metadata) so the state machine advances and the
    # wizard poller sees forward progress.
    if is_ledger_backed:
        trades = None
        metrics = None
        supabase.rpc(
            "transition_strategy_verification",
            {
                "p_verification_id": verification_id,
                "p_new_status": "metrics_captured",
                "p_metadata": {},
            },
        ).execute()
    else:
        trades = await adapter.fetch_raw(context)
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
    #
    # Skipped for a ledger-backed source: the fingerprint is fill-derived, so
    # Deribit is deferred out of similarity matching until a follow-up (P72
    # accepted risk 4). The state machine still advances to report_queued.
    if not is_ledger_backed:
        # Invariant: the fill branch above assigns trades + metrics whenever
        # is_ledger_backed is False (they are only None on the ledger path).
        assert trades is not None and metrics is not None
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
    # because positions are a derived view; trades are the SoT. Skipped for a
    # ledger-backed source: there are no reconstructed fills to derive from.
    if not is_ledger_backed:
        # Invariant: trades is non-None on the fill path (see above).
        assert trades is not None
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

    # Produce the verified factsheet the wizard waits on. This handler advances
    # the strategy_verifications state machine and captures a metrics_snapshot,
    # but it does NOT write `strategy_analytics` -- which is exactly what the
    # wizard's SyncPreviewStep polls (`computation_status='complete'`). Enqueue
    # the proven tail job: it persists the return series and auto-chains to the
    # analytics compute, which writes strategy_analytics; the dispatch loop's
    # sync_strategy_analytics_status bridge then flips computation_status to
    # 'complete'.
    #
    # - Fill-based sources (okx/binance/bybit): enqueue `sync_trades` — it
    #   persists trades and auto-chains to compute_analytics.
    # - Ledger-backed source (deribit): enqueue `derive_broker_dailies`
    #   (strategy-mode, p_strategy_id) — it crawls the txn-log ledger, asserts
    #   completeness (fails loud if partial), upserts csv_daily_returns and
    #   auto-chains to compute_analytics_from_csv.
    # CSV has no broker fills, so it is excluded (csv analytics run via
    # compute_analytics_from_csv on the synchronous path).
    #
    # FOLLOW-UP (noted in QUEUED-PATH-COMPLETION-PLAN.md): sync_trades re-fetches
    # from the broker, duplicating this handler's fetch_raw above. The redundant
    # in-handler fetch should be retired once the delegate path is E2E-verified
    # and the verification-state-machine consumers are mapped; kept additive
    # here to avoid changing the published/fingerprint behavior other code reads.
    analytics_strategy_id = context.get("strategy_id") or job.get("strategy_id")
    if source != "csv" and analytics_strategy_id:
        tail_kind = "derive_broker_dailies" if is_ledger_backed else "sync_trades"
        # Best-effort, mirroring run_sync_trades_job's follow-on compute_analytics
        # enqueue (which is also wrapped). The verification is already 'published',
        # so a worker retry short-circuits on that status (idempotency check above)
        # and would NOT re-run this tail — therefore we must NOT let an enqueue
        # blip crash the handler. Log loudly instead; strategy_analytics can be
        # recomputed via a manual re-sync if this rare path is hit.
        try:
            supabase.rpc(
                "enqueue_compute_job",
                {
                    "p_strategy_id": analytics_strategy_id,
                    "p_kind": tail_kind,
                    "p_metadata": {"correlation_id": correlation_id},
                },
            ).execute()
            log.info(
                "process_key_long.enqueued_tail",
                tail_kind=tail_kind,
                strategy_id=analytics_strategy_id,
            )
        except Exception as exc:  # noqa: BLE001
            log.error(
                "process_key_long.enqueue_tail_failed",
                tail_kind=tail_kind,
                error=str(exc)[:200],
                strategy_id=analytics_strategy_id,
                verification_id=verification_id,
            )

    log.info("process_key_long.complete")
    return DispatchResult(outcome=DispatchOutcome.DONE)
