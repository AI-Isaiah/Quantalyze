"""Phase 19 / BACKBONE-09 — tests for `services/ingestion/long_fetch.py`.

Six behaviors covering:
  1. Drain semantics — legacy claim (flag_at_claim='false') returns FAILED-permanent.
  2. Drain semantics — unified claim ('true') runs the pipeline + RPC transitions.
  3. Drain semantics — missing metadata is treated as legacy claim.
  4. Idempotency — already 'published' verification returns SUCCESS without re-running.
  5. Dispatch wiring — services/job_worker.py routes kind='process_key_long' to handler.
  6. Timeout config — TIMEOUT_PER_KIND['process_key_long'] == 30 * 60.

These are unit tests (no Supabase round-trip). Module-level Supabase + adapter
calls are patched. The integration-level drain test lives in
test_drain_semantics.py and exercises the SQL behavior.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ingestion.long_fetch import run_process_key_long_job
from services.job_worker import (
    DispatchOutcome,
    DispatchResult,
    TIMEOUT_PER_KIND,
    dispatch,
)


def _build_supabase_mock(existing_status: str | None = None) -> MagicMock:
    """Build a Supabase client mock that returns a strategy_verifications row
    with the given status when .table('strategy_verifications').select('status')
    .eq('id', X).maybe_single().execute() is called. RPC calls are no-ops.
    """
    sb = MagicMock()
    table_chain = MagicMock()
    table_chain.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"status": existing_status} if existing_status else None
    )
    sb.table.return_value = table_chain

    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data=None)
    sb.rpc.return_value = rpc_chain

    return sb


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drain_legacy_claim_returns_failed():
    """When job.metadata['unified_backbone_at_claim'] == 'false', handler
    returns DispatchOutcome.FAILED with error_kind='permanent' and
    NEVER imports/calls a broker adapter."""
    job = {
        "id": "job-legacy",
        "kind": "process_key_long",
        "metadata": {
            "unified_backbone_at_claim": "false",
            "verification_id": "v-1",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-1",
        },
    }
    with patch("services.ingestion.long_fetch.get_adapter") as mock_get_adapter, \
         patch("services.ingestion.long_fetch.get_supabase") as mock_get_sb:
        result = await run_process_key_long_job(job)
        # Critical: adapter MUST NOT be called for a drained legacy claim.
        mock_get_adapter.assert_not_called()
        # And no Supabase round-trip on the legacy-drain path.
        mock_get_sb.assert_not_called()

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "legacy" in (result.error_message or "").lower()


@pytest.mark.asyncio
async def test_drain_unified_claim_runs_pipeline():
    """When metadata says 'true', handler runs the pipeline and calls
    transition_strategy_verification RPC at each step."""
    job = {
        "id": "job-unified",
        "kind": "process_key_long",
        "strategy_id": "s-unified",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-2",
            "source": "csv",  # CSV path skips encrypt_credentials branch.
            "flow_type": "onboard",
            "correlation_id": "cid-2",
            "context": {"strategy_id": "s-unified", "api_key": "k", "api_secret": "s"},
        },
    }
    fake_trades: list = []

    fake_metrics = MagicMock()
    fake_metrics.__dict__ = {
        "sharpe": 1.0,
        "twr": 0.05,
        "ytd": 0.02,
        "max_drawdown": -0.1,
        "total_pnl": 100.0,
        "trade_count": 0,
        "win_rate": 0.0,
    }

    fake_fp = MagicMock()
    fake_fp.to_jsonb.return_value = {"version": 1}

    fake_adapter = MagicMock()
    fake_adapter.validate = AsyncMock(
        return_value=MagicMock(
            valid=True,
            error_code=None,
            human_message=None,
        )
    )
    fake_adapter.fetch_raw = AsyncMock(return_value=fake_trades)
    fake_adapter.compute_metrics = MagicMock(return_value=fake_metrics)
    fake_adapter.compute_fingerprint = MagicMock(return_value=fake_fp)
    fake_adapter.reconstruct_positions = AsyncMock(return_value=[])

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=fake_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE
    # Five RPC transitions: validated, metrics_captured, encrypted (no-op for csv),
    # report_queued, published. (encrypted is still emitted because the state
    # machine requires the transition; it carries an empty metadata blob for csv.)
    rpc_names = [c.args[0] for c in sb.rpc.call_args_list]
    assert rpc_names.count("transition_strategy_verification") >= 5
    fake_adapter.fetch_raw.assert_awaited_once()
    fake_adapter.reconstruct_positions.assert_awaited_once_with(fake_trades)


@pytest.mark.asyncio
async def test_long_fetch_resolves_stored_credentials_when_absent() -> None:
    """Bug #2 regression (2026-05-27): queued resync/onboard arrive with NO
    credentials in context (the /process-key enqueue never forwards context), so
    the handler must resolve the stored key server-side via
    job_worker._load_strategy_and_key + services.encryption.decrypt_credentials
    and inject the decrypted creds into the adapter request BEFORE validate.
    Pre-fix the adapter pipeline hit `context["api_key"]` KeyError / validated
    against empty creds. This asserts the decrypted stored creds reach validate."""
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-creds",
        "kind": "process_key_long",
        "strategy_id": "s-creds",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-creds",
            "source": "okx",
            "flow_type": "resync",
            "correlation_id": "cid-creds",
            "context": {"strategy_id": "s-creds"},  # NO api_key / api_secret
        },
    }

    captured: dict[str, Any] = {}

    async def _capture_validate(req):
        captured["ctx"] = dict(req.context)
        return ValidationResult(
            valid=True, read_only=True, error_code=None,
            human_message=None, debug_context={},
        )

    fake_metrics = MagicMock()
    fake_metrics.__dict__ = {"sharpe": 1.0, "trade_count": 0}
    fake_fp = MagicMock()
    fake_fp.to_jsonb.return_value = {"version": 1}

    adapter = MagicMock()
    adapter.validate = AsyncMock(side_effect=_capture_validate)
    adapter.fetch_raw = AsyncMock(return_value=[])
    adapter.compute_metrics = MagicMock(return_value=fake_metrics)
    adapter.compute_fingerprint = MagicMock(return_value=fake_fp)
    adapter.reconstruct_positions = AsyncMock(return_value=[])

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch(
             "services.job_worker._load_strategy_and_key",
             new=AsyncMock(return_value=(
                 {"id": "s-creds", "user_id": "u1", "api_key_id": "k1"},
                 {"id": "k1", "user_id": "u1", "exchange": "okx"},
                 None,
             )),
         ), \
         patch(
             "services.encryption.decrypt_credentials",
             return_value=("RESOLVED_KEY", "RESOLVED_SECRET", "RESOLVED_PASS"),
         ), \
         patch("services.encryption.get_kek", return_value=b"0" * 32), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE
    # The decrypted STORED credentials (not request-body creds) must reach validate.
    assert captured["ctx"]["api_key"] == "RESOLVED_KEY"
    assert captured["ctx"]["api_secret"] == "RESOLVED_SECRET"
    assert captured["ctx"]["passphrase"] == "RESOLVED_PASS"


@pytest.mark.asyncio
async def test_long_fetch_credential_resolution_failure_is_permanent() -> None:
    """Bug #2 edge: when the strategy has no connected key, credential resolution
    fails permanently (matches the legacy _exchange_preflight convention) rather
    than crashing on KeyError or validating against empty creds."""
    job = {
        "id": "job-nokey",
        "kind": "process_key_long",
        "strategy_id": "s-nokey",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-nokey",
            "source": "okx",
            "flow_type": "resync",
            "correlation_id": "cid-nokey",
            "context": {"strategy_id": "s-nokey"},
        },
    }
    sb = _build_supabase_mock(existing_status="draft")
    with patch("services.ingestion.long_fetch.get_adapter") as mock_adapter, \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch(
             "services.job_worker._load_strategy_and_key",
             new=AsyncMock(return_value=(None, None, "Strategy has no connected API key")),
         ):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # No broker adapter should be constructed when creds cannot be resolved.
    mock_adapter.return_value.validate.assert_not_called()


@pytest.mark.asyncio
async def test_long_fetch_enqueues_sync_trades_on_success() -> None:
    """Bug #3 regression (2026-05-27): the queued path advanced the verification
    to 'published' but never wrote `strategy_analytics` -- which is what the
    wizard's SyncPreviewStep polls (`computation_status='complete'`). On success
    a non-csv flow must enqueue the proven sync_trades job, which persists trades
    and auto-chains to compute_analytics -> strategy_analytics -> status bridge.
    Pre-fix the wizard polled forever and timed out to SYNC_FAILED."""
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-st",
        "kind": "process_key_long",
        "strategy_id": "s-st",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-st",
            "source": "okx",
            "flow_type": "resync",
            "correlation_id": "cid-st",
            # creds present -> credential resolution is skipped (bug #2 path
            # covered separately); this test focuses on the sync_trades enqueue.
            "context": {"strategy_id": "s-st", "api_key": "k", "api_secret": "s"},
        },
    }

    fake_metrics = MagicMock()
    fake_metrics.__dict__ = {"sharpe": 1.0, "trade_count": 0}
    fake_fp = MagicMock()
    fake_fp.to_jsonb.return_value = {"version": 1}

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    adapter.fetch_raw = AsyncMock(return_value=[])
    adapter.compute_metrics = MagicMock(return_value=fake_metrics)
    adapter.compute_fingerprint = MagicMock(return_value=fake_fp)
    adapter.reconstruct_positions = AsyncMock(return_value=[])

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE
    enqueue = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "enqueue_compute_job"
    ]
    assert enqueue, "success must enqueue a follow-on sync_trades job"
    assert enqueue[0].args[1]["p_kind"] == "sync_trades"
    assert enqueue[0].args[1]["p_strategy_id"] == "s-st"


@pytest.mark.asyncio
async def test_long_fetch_deribit_enqueues_derive_broker_dailies_and_skips_fills() -> None:
    """P72 (Test B): a ledger-backed source (deribit) must route the queued
    onboarding through the broker-dailies ledger path, NOT the fill-based
    pipeline.

    Deribit returns are ledger-backed and DeribitAdapter.compute_metrics raises
    by design, so the handler must:
      - NEVER call fetch_raw / compute_metrics / compute_fingerprint /
        reconstruct_positions (those are fill-derived);
      - still advance the state machine through 'published';
      - enqueue `derive_broker_dailies` (strategy-mode) as the factsheet tail
        instead of `sync_trades`.
    Pre-fix (P70) deribit was excluded from every process_key flow and its
    fill pipeline raised — the wizard 'Verify data' step 422'd / SYNC_FAILED.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-deribit",
        "kind": "process_key_long",
        "strategy_id": "s-deribit",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-deribit",
            "source": "deribit",
            "flow_type": "onboard",
            "correlation_id": "cid-deribit",
            "context": {"strategy_id": "s-deribit", "api_key": "k", "api_secret": "s"},
        },
    }

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    # These fill-based methods MUST NOT be called for a ledger-backed source.
    adapter.fetch_raw = AsyncMock(side_effect=AssertionError("fetch_raw must not run for deribit"))
    adapter.compute_metrics = MagicMock(
        side_effect=AssertionError("compute_metrics must not run for deribit")
    )
    adapter.compute_fingerprint = MagicMock(
        side_effect=AssertionError("compute_fingerprint must not run for deribit")
    )
    adapter.reconstruct_positions = AsyncMock(
        side_effect=AssertionError("reconstruct_positions must not run for deribit")
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE

    # Fill methods were never awaited/called.
    adapter.fetch_raw.assert_not_called()
    adapter.compute_metrics.assert_not_called()
    adapter.compute_fingerprint.assert_not_called()
    adapter.reconstruct_positions.assert_not_called()

    # State machine reached 'published'.
    published = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "transition_strategy_verification"
        and c.args[1].get("p_new_status") == "published"
    ]
    assert published, "deribit run must advance the verification to 'published'"

    # The factsheet tail is the ledger job, NOT sync_trades.
    enqueue = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "enqueue_compute_job"
    ]
    assert enqueue, "deribit success must enqueue a ledger factsheet tail"
    assert enqueue[0].args[1]["p_kind"] == "derive_broker_dailies", (
        "ledger-backed source must enqueue derive_broker_dailies, not sync_trades"
    )
    assert enqueue[0].args[1]["p_strategy_id"] == "s-deribit"


@pytest.mark.asyncio
async def test_long_fetch_sfox_routes_ledger_path_never_calls_fetch_raw() -> None:
    """F1 (P120 red-team): sFOX is balance-history-backed, so onboard/resync
    MUST route through the ledger (derive_broker_dailies) path exactly like
    deribit — NEVER the fill pipeline.

    Pre-fix, ``is_ledger_backed = source == "deribit"`` excluded sfox, so the
    handler fell into the fill branch and called ``SfoxAdapter.fetch_raw``,
    which raises NotImplementedError BY DESIGN → every sfox onboard/resync
    crashed in production. The tail also enqueued ``sync_trades`` (which
    re-fetches fills) instead of ``derive_broker_dailies``. This test pins that
    sfox reaches the derive path and never touches a fill-based method.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-sfox",
        "kind": "process_key_long",
        "strategy_id": "s-sfox",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-sfox",
            "source": "sfox",
            "flow_type": "onboard",
            "correlation_id": "cid-sfox",
            "context": {"strategy_id": "s-sfox", "api_key": "k", "api_secret": "s"},
        },
    }

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    # SfoxAdapter.fetch_raw / compute_metrics raise NotImplementedError by
    # design; wire them to fail loudly here so a routing regression is caught.
    adapter.fetch_raw = AsyncMock(
        side_effect=AssertionError("fetch_raw must not run for sfox")
    )
    adapter.compute_metrics = MagicMock(
        side_effect=AssertionError("compute_metrics must not run for sfox")
    )
    adapter.compute_fingerprint = MagicMock(
        side_effect=AssertionError("compute_fingerprint must not run for sfox")
    )
    adapter.reconstruct_positions = AsyncMock(
        side_effect=AssertionError("reconstruct_positions must not run for sfox")
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE

    # No fill-based method was ever invoked (would have raised otherwise).
    adapter.fetch_raw.assert_not_called()
    adapter.compute_metrics.assert_not_called()
    adapter.compute_fingerprint.assert_not_called()
    adapter.reconstruct_positions.assert_not_called()

    published = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "transition_strategy_verification"
        and c.args[1].get("p_new_status") == "published"
    ]
    assert published, "sfox run must advance the verification to 'published'"

    enqueue = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "enqueue_compute_job"
    ]
    assert enqueue, "sfox success must enqueue a ledger factsheet tail"
    assert enqueue[0].args[1]["p_kind"] == "derive_broker_dailies", (
        "sfox must enqueue derive_broker_dailies, not sync_trades"
    )
    assert enqueue[0].args[1]["p_strategy_id"] == "s-sfox"


@pytest.mark.asyncio
async def test_drain_missing_metadata_treated_as_legacy():
    """When metadata is None or has no `unified_backbone_at_claim` key,
    handler treats it as a legacy claim → FAILED-permanent."""
    job_no_meta = {
        "id": "job-missing-meta",
        "kind": "process_key_long",
        "metadata": None,
    }
    job_no_key = {
        "id": "job-no-key",
        "kind": "process_key_long",
        "metadata": {"verification_id": "v-3", "source": "okx", "flow_type": "onboard"},
    }
    with patch("services.ingestion.long_fetch.get_adapter") as mock_get_adapter, \
         patch("services.ingestion.long_fetch.get_supabase") as mock_get_sb:
        r1 = await run_process_key_long_job(job_no_meta)
        r2 = await run_process_key_long_job(job_no_key)
        mock_get_adapter.assert_not_called()
        mock_get_sb.assert_not_called()

    assert r1.outcome == DispatchOutcome.FAILED
    assert r1.error_kind == "permanent"
    assert r2.outcome == DispatchOutcome.FAILED
    assert r2.error_kind == "permanent"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata,reason",
    [
        (
            {
                "unified_backbone_at_claim": "true",
                "verification_id": "v-bad-flow",
                "flow_type": "haxor",  # not in FlowType locked enum
                "source": "okx",
            },
            "bad flow_type",
        ),
        (
            {
                "unified_backbone_at_claim": "true",
                "verification_id": "v-bad-source",
                "flow_type": "onboard",
                "source": "ftx",  # not in Source locked enum (UC-B drops MT5/IBKR/FTX)
            },
            "bad source",
        ),
    ],
    ids=["bad_flow_type", "bad_source"],
)
async def test_locked_enum_violation_returns_failed_permanent(
    metadata: dict[str, Any], reason: str
) -> None:
    """Regression: long_fetch must reject flow_type / source values outside
    the CONTEXT.md L72 locked enum with FAILED-permanent BEFORE the adapter
    pipeline runs.

    Pre-fix path was: dataclass construction succeeded silently (dataclasses
    don't runtime-validate Literal annotations) and get_adapter(source) only
    raised on bogus source — a typo'd flow_type would flow into adapter.validate
    and burn the broker round-trip on a job that should have been dropped at
    the gate. The CI gate (mypy --strict) catches the type-side; this test
    pins the runtime narrowing that backs it up.
    """
    job = {"id": "job-bad-enum", "kind": "process_key_long", "metadata": metadata}
    with patch("services.ingestion.long_fetch.get_adapter") as mock_get_adapter, \
         patch("services.ingestion.long_fetch.get_supabase") as mock_get_sb:
        result = await run_process_key_long_job(job)
        mock_get_adapter.assert_not_called()
        mock_get_sb.assert_not_called()

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "locked enum violation" in result.error_message


@pytest.mark.asyncio
async def test_pipeline_idempotent_on_retry():
    """If verification_id is already at status='published', handler returns
    SUCCESS without re-running the pipeline (worker retry safety)."""
    job = {
        "id": "job-published",
        "kind": "process_key_long",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-already-done",
            "source": "csv",
            "flow_type": "onboard",
            "correlation_id": "cid-5",
        },
    }
    sb = _build_supabase_mock(existing_status="published")

    with patch("services.ingestion.long_fetch.get_adapter") as mock_get_adapter, \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)
        # Pipeline must be skipped — no adapter resolution at all.
        mock_get_adapter.assert_not_called()
        # No transition RPC calls — the row is already terminal.
        rpc_names = [c.args[0] for c in sb.rpc.call_args_list]
        assert "transition_strategy_verification" not in rpc_names

    assert result.outcome == DispatchOutcome.DONE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "advanced_status",
    ["validated", "metrics_captured", "encrypted", "report_queued"],
)
async def test_short_circuit_skips_broker_on_non_draft_status(advanced_status):
    """CT-6 (army2) — when a worker retry sees the row already past draft
    (validated / metrics_captured / encrypted / report_queued), the
    handler MUST short-circuit BEFORE invoking the broker adapter and
    return DONE.

    Pre-fix the short-circuit set was {'encrypted','report_queued'},
    missing 'validated' and 'metrics_captured'. A retry that landed on
    metrics_captured would (a) re-run validate (transition validated→
    validated raises) + broker fetch_raw burning quota, AND (b) crash
    when the worker called transition_strategy_verification(metrics_captured
    → validated) because that pair is not in migration 103's legal_pairs.
    The crash poisoned the next retry.

    Sanity-tests for the full closed status set per migration 093.
    """
    job = {
        "id": f"job-{advanced_status}",
        "kind": "process_key_long",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-retry",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-retry",
            "context": {"strategy_id": "s-retry", "api_key": "k", "api_secret": "s"},
        },
    }
    sb = _build_supabase_mock(existing_status=advanced_status)

    with patch("services.ingestion.long_fetch.get_adapter") as mock_get_adapter, \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # Pipeline MUST be skipped — broker adapter is never resolved.
    mock_get_adapter.assert_not_called()
    # And no transition_strategy_verification RPC calls — the worker
    # leaves the post-fetch tail to a follow-up resume job.
    rpc_names = [c.args[0] for c in sb.rpc.call_args_list]
    assert "transition_strategy_verification" not in rpc_names, (
        f"Worker must not attempt a transition from {advanced_status!r} — "
        "the legal-pairs check in migration 103 only allows "
        "draft→validated→metrics_captured→encrypted→report_queued→published"
    )

    assert result.outcome == DispatchOutcome.DONE


@pytest.mark.asyncio
async def test_dispatch_dict_routes_process_key_long():
    """The job_worker.dispatch chain routes kind='process_key_long' to
    run_process_key_long_job."""
    job = {
        "id": "job-route",
        "kind": "process_key_long",
        "metadata": {"unified_backbone_at_claim": "false"},  # short-circuit drain
        "strategy_id": None,
    }
    # Patch the analytics_status bridge so the strategy_id=None branch is taken.
    with patch(
        "services.job_worker.sync_strategy_analytics_status",
        new=AsyncMock(),
    ):
        result = await dispatch(job)

    # Drained legacy claim → FAILED-permanent. The fact that we reached this
    # outcome (rather than "Unknown job kind") proves the dispatch chain
    # routes process_key_long to the long_fetch handler.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"


def test_timeout_per_kind_set():
    """TIMEOUT_PER_KIND['process_key_long'] == 30 * 60 (30 min)."""
    assert TIMEOUT_PER_KIND["process_key_long"] == 30 * 60


# ---------------------------------------------------------------------------
# NEW-C31-01 — scope gate regression (read_only=False must be rejected)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_code,read_only",
    [
        ("TRADE_SCOPE", False),
        ("WITHDRAW_SCOPE", False),
        ("WITHDRAW_SCOPE", True),  # edge: error_code wins even if read_only is True
    ],
    ids=["trade_scope", "withdraw_scope", "error_code_wins"],
)
async def test_long_fetch_rejects_write_capable_key(
    error_code: str, read_only: bool
) -> None:
    """NEW-C31-01 regression: a key returning TRADE_SCOPE or WITHDRAW_SCOPE
    must be rejected by long_fetch BEFORE encryption, transitioning the
    verification back to 'draft'.

    Pre-fix: only `not val.valid` was tested; val.read_only=False / a
    TRADE_SCOPE error_code passed silently through to fetch_raw and
    encryption because validate_key_permissions sets valid=True the moment
    fetch_balance() succeeds and only then derives the scope error.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-scope",
        "kind": "process_key_long",
        "strategy_id": "s-scope",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-scope",
            "source": "binance",
            "flow_type": "onboard",
            "correlation_id": "cid-scope",
            "context": {"strategy_id": "s-scope", "api_key": "k", "api_secret": "s"},
        },
    }

    scope_adapter = MagicMock()
    scope_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,  # fetch_balance succeeded — adapter says valid
            read_only=read_only,
            error_code=error_code,
            human_message="Key has trading permissions.",
            debug_context={},
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=scope_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # Must fail permanently — scope violations are not transient.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"

    # fetch_raw MUST NOT have been called — no broker round-trip after rejection.
    scope_adapter.fetch_raw.assert_not_called()

    # Verification must have been transitioned back to draft.
    rpc_names = [c.args[0] for c in sb.rpc.call_args_list]
    assert "transition_strategy_verification" in rpc_names, (
        "Scope rejection must call transition_strategy_verification to set "
        "status=draft. Pre-fix: the validate-failure path was bypassed and "
        "the row was left in whatever pre-validate state it had."
    )
    # Find the draft transition and confirm it carries the scope error code.
    for call in sb.rpc.call_args_list:
        if call.args and call.args[0] == "transition_strategy_verification":
            meta = call.args[1].get("p_metadata", {})
            if call.args[1].get("p_new_status") == "draft":
                errors = meta.get("errors", [])
                assert errors, "Draft transition must carry the scope error code"
                assert errors[0]["code"] == error_code
                break
    else:
        raise AssertionError("No draft transition RPC found")


@pytest.mark.asyncio
async def test_long_fetch_scope_rejection_uses_validation_unexpected_fallback() -> None:
    """IMP-1 + SF-2 regression: when read_only=False but error_code is None,
    the fallback must be 'VALIDATION_UNEXPECTED' (a registered WizardErrorCode)
    NOT 'VALIDATION_FAILED' (unregistered → blank wizard error state).

    Pre-fix: the fallback was 'VALIDATION_FAILED', which is absent from
    wizardErrors.ts and caused a silent blank-message state on the frontend.
    Additionally 'VALIDATION_FAILED' was absent from permanent_codes, so the
    job would have retried forever instead of marking the error permanent.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-fallback",
        "kind": "process_key_long",
        "strategy_id": "s-fallback",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-fallback",
            "source": "binance",
            "flow_type": "onboard",
            "correlation_id": "cid-fallback",
            "context": {"strategy_id": "s-fallback", "api_key": "k", "api_secret": "s"},
        },
    }

    # Adapter says valid=True (fetch_balance succeeded) but read_only=False
    # AND no error_code — simulates a future adapter that sets read_only=False
    # without a scope error_code.
    fallback_adapter = MagicMock()
    fallback_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=False,
            error_code=None,  # triggers the fallback path
            human_message="Write-capable key detected.",
            debug_context={},
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=fallback_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # IMP-1: must be permanent, not transient — VALIDATION_UNEXPECTED is in
    # permanent_codes so the worker does not retry a write-capable key forever.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"

    # SF-2: the draft transition must carry VALIDATION_UNEXPECTED, not
    # VALIDATION_FAILED (which is unregistered on the frontend).
    for call in sb.rpc.call_args_list:
        if call.args and call.args[0] == "transition_strategy_verification":
            if call.args[1].get("p_new_status") == "draft":
                errors = call.args[1]["p_metadata"]["errors"]
                assert errors[0]["code"] == "VALIDATION_UNEXPECTED", (
                    f"Fallback code must be VALIDATION_UNEXPECTED; got {errors[0]['code']}. "
                    "VALIDATION_FAILED is not a registered WizardErrorCode."
                )
                break
    else:
        raise AssertionError("No draft transition RPC found")

    fallback_adapter.fetch_raw.assert_not_called()


@pytest.mark.asyncio
async def test_long_fetch_scope_rejection_survives_rpc_failure() -> None:
    """SF-3 regression: a Supabase RPC failure in the scope-rejection branch
    must NOT propagate as an unhandled exception — the DispatchResult must still
    be FAILED/permanent so the caller receives the security-correct outcome.

    Pre-fix: the RPC call was uncaught; a Supabase blip would propagate as an
    unhandled exception, leaving the verification row in limbo and the worker
    receiving a 500 instead of the expected FAILED result.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-rpc-fail",
        "kind": "process_key_long",
        "strategy_id": "s-rpc-fail",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-rpc-fail",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-rpc-fail",
            "context": {"strategy_id": "s-rpc-fail", "api_key": "k", "api_secret": "s"},
        },
    }

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

    # Supabase mock where every RPC call raises a network error.
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"status": "draft"}
    )
    sb.rpc.return_value.execute.side_effect = RuntimeError("Supabase unavailable")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=rpc_fail_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # The security outcome must be preserved even when the DB transition fails.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    rpc_fail_adapter.fetch_raw.assert_not_called()


@pytest.mark.asyncio
async def test_long_fetch_csv_read_only_none_not_rejected() -> None:
    """NEW-C31-01 guard: read_only=None (CSV path) must NOT be rejected by
    the scope gate — only explicit False is a disqualifier for exchange keys."""
    from services.ingestion.adapter import ValidationResult, MetricsSnapshot, Fingerprint

    job = {
        "id": "job-csv-ok",
        "kind": "process_key_long",
        "strategy_id": "s-csv",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-csv-ok",
            "source": "csv",
            "flow_type": "onboard",
            "correlation_id": "cid-csv",
            "context": {"strategy_id": "s-csv", "api_key": "k", "api_secret": "s"},
        },
    }

    fake_metrics = MagicMock()
    fake_metrics.__dict__ = {
        "sharpe": None, "twr": None, "ytd": None,
        "max_drawdown": None, "total_pnl": None,
        "trade_count": 0, "win_rate": None,
    }
    fake_fp = MagicMock()
    fake_fp.to_jsonb.return_value = {"version": 1}

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
    csv_adapter.compute_metrics = MagicMock(return_value=fake_metrics)
    csv_adapter.compute_fingerprint = MagicMock(return_value=fake_fp)
    csv_adapter.reconstruct_positions = AsyncMock(return_value=[])

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=csv_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # CSV with read_only=None must NOT be rejected — pipeline should proceed.
    csv_adapter.fetch_raw.assert_awaited_once()


# ---------------------------------------------------------------------------
# Red-team regression tests (2026-05-26)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_long_fetch_probe_error_is_transient_not_permanent() -> None:
    """C-1 / L-3 (red-team): when detect_permissions() returned _FAIL_CLOSED
    (probe_error=True), long_fetch must NOT permanently reject the key.

    _FAIL_CLOSED sets has_withdraw=True, has_trade=True → exchange.py derives
    read_only=False, error_code="WITHDRAW_SCOPE" from those fail-closed defaults.
    Before this fix, "WITHDRAW_SCOPE" was in permanent_codes → the worker marked
    the job failed-permanent and never retried, permanently banning a user whose
    legitimately-read-only key happened to hit an exchange 502 during the probe.

    After the fix: probe_error=True in debug_context → transient early-return
    before the scope gate fires, so the worker retries the entire probe.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-probe-error",
        "kind": "process_key_long",
        "strategy_id": "s-probe",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-probe",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-probe",
            "context": {"strategy_id": "s-probe", "api_key": "k", "api_secret": "s"},
        },
    }

    # Simulate _FAIL_CLOSED result: detect_permissions raised a network
    # error, returned the fail-closed default, and exchange.py derived
    # read_only=False + error_code="WITHDRAW_SCOPE" from those defaults.
    probe_error_adapter = MagicMock()
    probe_error_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=False,  # derived from _FAIL_CLOSED has_withdraw=True
            error_code="WITHDRAW_SCOPE",  # derived from _FAIL_CLOSED has_withdraw=True
            human_message="Key has withdrawal permissions.",
            debug_context={"probe_error": True},  # the discriminating signal
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=probe_error_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # C-1 fix: probe_error → transient, not permanent.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient", (
        "probe_error=True must produce a transient failure so the worker retries. "
        "Pre-fix: WITHDRAW_SCOPE was in permanent_codes → irrecoverable permanent "
        "ban from an exchange 502 during the permission probe."
    )
    # The scope gate must NOT have fired — no draft-transition RPC.
    for call in sb.rpc.call_args_list:
        if call.args and call.args[0] == "transition_strategy_verification":
            assert False, (
                "probe_error path must NOT call transition_strategy_verification — "
                "the key was not scope-rejected, only the probe was transient."
            )

    # Pipeline must have bailed before broker fetch.
    probe_error_adapter.fetch_raw.assert_not_called()


@pytest.mark.asyncio
async def test_long_fetch_validation_unexpected_from_adapter_is_transient() -> None:
    """M-1 (red-team): VALIDATION_UNEXPECTED set by the adapter for a genuine
    unexpected exception (e.g. ccxt.ExchangeNotAvailable not in typed hierarchy)
    must remain retryable (transient), not permanent.

    Pre-fix: VALIDATION_UNEXPECTED was unconditionally added to permanent_codes
    (IMP-1 comment). But VALIDATION_UNEXPECTED is also the code set by
    exchange.py line 621 for any unexpected exception during validate — those
    can be transient (exchange down, WAF block on a different endpoint). A
    legitimate user's key submission would silently become irrecoverable.

    Post-fix: VALIDATION_UNEXPECTED is permanent ONLY when it is our own
    fallback (val.error_code was None + read_only=False). When the adapter
    set it for an actual exception (val.error_code == "VALIDATION_UNEXPECTED"
    explicitly), it is transient.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-unexpected-exc",
        "kind": "process_key_long",
        "strategy_id": "s-unexpected",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-unexpected",
            "source": "binance",
            "flow_type": "onboard",
            "correlation_id": "cid-unexpected",
            "context": {"strategy_id": "s-unexpected", "api_key": "k", "api_secret": "s"},
        },
    }

    # Adapter had an unexpected exception → set valid=False, error_code="VALIDATION_UNEXPECTED".
    unexpected_adapter = MagicMock()
    unexpected_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=False,
            read_only=None,
            error_code="VALIDATION_UNEXPECTED",  # adapter-set, not our fallback
            human_message="Key validation failed unexpectedly.",
            debug_context={"probe_error": False},
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=unexpected_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient", (
        "VALIDATION_UNEXPECTED set by the adapter (unexpected exception) must be "
        "transient so the worker can retry when the exchange comes back up. "
        "Pre-fix: it was unconditionally in permanent_codes → irrecoverable."
    )


@pytest.mark.asyncio
async def test_long_fetch_validation_unexpected_fallback_is_permanent() -> None:
    """M-1 complement: VALIDATION_UNEXPECTED as our OWN fallback
    (val.error_code is None + read_only=False) must still be permanent.

    This is the IMP-1 case: an adapter confirms write-scope (read_only=False)
    but doesn't set an error_code. We fallback to VALIDATION_UNEXPECTED and
    must NOT retry forever.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-fallback-perm",
        "kind": "process_key_long",
        "strategy_id": "s-fallback-perm",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-fallback-perm",
            "source": "bybit",
            "flow_type": "onboard",
            "correlation_id": "cid-fallback-perm",
            "context": {"strategy_id": "s-fallback-perm", "api_key": "k", "api_secret": "s"},
        },
    }

    fallback_adapter = MagicMock()
    fallback_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=False,   # write-capable confirmed by adapter
            error_code=None,   # but no error_code set — our fallback fires
            human_message="Write-capable key.",
            debug_context={"probe_error": False},
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=fallback_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent", (
        "VALIDATION_UNEXPECTED as fallback (read_only=False + no error_code) must "
        "be permanent so a write-capable key does not retry forever."
    )


@pytest.mark.asyncio
async def test_long_fetch_defense_in_depth_error_code_none_read_only_gate() -> None:
    """H-2 (red-team): defense-in-depth branch — read_only=None + explicit
    TRADE_SCOPE error_code still fires the scope gate.

    A future adapter that sets error_code="TRADE_SCOPE" but leaves read_only
    unset (None) should still be rejected. The `val.error_code in {...}` arm of
    _scope_rejected is the only arm that catches this, since
    `val.read_only is False` is False when read_only=None.
    """
    from services.ingestion.adapter import ValidationResult

    job = {
        "id": "job-dib",
        "kind": "process_key_long",
        "strategy_id": "s-dib",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-dib",
            "source": "okx",
            "flow_type": "onboard",
            "correlation_id": "cid-dib",
            "context": {"strategy_id": "s-dib", "api_key": "k", "api_secret": "s"},
        },
    }

    dib_adapter = MagicMock()
    dib_adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=None,         # adapter omitted read_only
            error_code="TRADE_SCOPE",  # but still set the scope code
            human_message="Key has trading permissions.",
            debug_context={"probe_error": False},
        )
    )

    sb = _build_supabase_mock(existing_status="draft")

    with patch("services.ingestion.long_fetch.get_adapter", return_value=dib_adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    # Defense-in-depth: the error_code arm catches this even with read_only=None.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    dib_adapter.fetch_raw.assert_not_called()


def test_long_fetch_uses_shared_metrics_encoder() -> None:
    """WR-05 regression (REVIEW.md 2026-05-08).

    The pre-fix `long_fetch._metrics_to_jsonb` was a `__dict__` walk —
    while `process_key.py._metrics_to_jsonb` got the MC-4 type-aware
    encoder. If a future MetricsSnapshot field becomes datetime/Decimal,
    the long-fetch path would silently corrupt the JSONB column.

    After the fix both paths delegate to services.ingestion.serde —
    single source of truth.
    """
    import inspect

    from services.ingestion import long_fetch, serde
    from services.ingestion.adapter import MetricsSnapshot
    from routers import process_key

    # Source-level guard — long_fetch must reference the shared encoder.
    src = inspect.getsource(long_fetch)
    assert "from services.ingestion.serde import metrics_to_jsonb" in src, (
        "long_fetch must import the shared MC-4 encoder per WR-05; "
        "the local __dict__ walk silently corrupts JSONB if a future "
        "MetricsSnapshot field is datetime / Decimal."
    )

    # Functional equivalence — both delegators produce the same output for
    # a dataclass MetricsSnapshot.
    m = MetricsSnapshot(
        sharpe=1.2,
        twr=0.10,
        ytd=0.05,
        max_drawdown=-0.07,
        total_pnl=999.0,
        trade_count=7,
        win_rate=0.6,
    )
    assert long_fetch._metrics_to_jsonb(m) == process_key._metrics_to_jsonb(m)
    assert long_fetch._metrics_to_jsonb(m) == serde.metrics_to_jsonb(m)

    # MC-4 type-awareness — uses dataclasses.asdict so the result is a
    # plain dict with the dataclass field values intact.
    out = long_fetch._metrics_to_jsonb(m)
    assert out["sharpe"] == 1.2
    assert out["trade_count"] == 7
