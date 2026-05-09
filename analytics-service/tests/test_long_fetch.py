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
            "context": {"strategy_id": "s-unified"},
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
            "context": {"strategy_id": "s-retry"},
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
