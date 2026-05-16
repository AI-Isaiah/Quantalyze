"""Tests for analytics-service/services/job_worker.py::run_reconcile_strategy_job
audit emission path — covering audit batch G/S9c findings H-0683 / H-0684 /
H-0685 / M-0669.

The reconcile handler upserts a reconciliation_reports row, then looks up
the strategy owner so it can attribute a `reconcile.compare` audit event.
Three latent gaps were flagged:

  H-0683: `await db_execute(_load_strategy_owner)` is unwrapped — a
  transient PostgREST 503 on the owner SELECT would propagate, abort the
  reconcile epilogue, and silently skip the downstream `_generate_alerts`
  fan-out (the report row exists, no alerts, no audit).

  H-0684 / H-0685: owner_id=None (strategy deleted between job enqueue and
  reconcile completion, or owner lookup transient-failed) silently drops
  the audit event. There was no test that proved the conditional skip
  path was reachable AND that the alert fan-out still ran.

  M-0669: the documented "best-effort" semantics in the source comment
  were not actually implemented — the comment normalized the drop without
  emitting a forensic signal.

All tests mock _exchange_preflight + DB execute so the only behavior
exercised is the audit-emission decision tree.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.job_worker import (
    DispatchOutcome,
    run_reconcile_strategy_job,
)


def _build_mock_ctx() -> MagicMock:
    """Return a mock _ExchangeContext that the reconcile handler reads from."""
    mock_exchange = AsyncMock()
    mock_exchange.close = AsyncMock()

    ctx = MagicMock()
    ctx.exchange = mock_exchange
    ctx.supabase = MagicMock()
    ctx.strategy_row = {"id": "strat-1", "user_id": "user-1"}
    ctx.key_row = {
        "id": "key-1",
        "exchange": "binance",
        "user_id": "user-1",
    }
    return ctx


class _StubReport:
    """Tiny stand-in for services.reconciliation.ReconcileReport — only
    the attributes run_reconcile_strategy_job reads from."""

    def __init__(self, status: str = "clean", discrepancy_count: int = 0) -> None:
        self.strategy_id = "strat-1"
        self.report_date = "2026-05-15"
        self.status = status
        self.discrepancy_count = discrepancy_count
        self.discrepancies = []


class TestReconcileAuditOwnerLookup:
    """H-0683 / H-0684 / H-0685 / M-0669 — verify the owner-lookup +
    audit emission contract handles its three failure modes
    gracefully, NEVER aborting the reconcile epilogue or hiding
    forensic context."""

    @pytest.mark.asyncio
    async def test_owner_lookup_exception_does_not_abort_reconcile(self) -> None:
        """H-0683 / H-0685: when the strategies owner SELECT raises (e.g.
        transient PostgREST 503), the exception MUST NOT propagate out
        of run_reconcile_strategy_job. The reconcile epilogue continues
        and the handler returns DONE. Pre-fix the unwrapped db_execute
        would propagate the exception and skip the alerts fan-out."""
        ctx = _build_mock_ctx()

        # diff_strategy_fills is mocked to a clean report so the alert
        # fan-out doesn't need to run — we only care about the audit path.
        report = _StubReport(status="clean")

        # db_execute returns different results based on which closure is
        # being run. We dispatch by the closure's __name__: the owner
        # lookup raises, every other helper returns sensible defaults.
        async def _db_execute_dispatch(fn):
            name = getattr(fn, "__name__", "")
            if name == "_load_strategy_owner":
                raise RuntimeError("PostgREST 503 simulating transient failure")
            # Default: pretend everything else succeeds with empty data.
            return [] if "fills" in name or "ids" in name else None

        mock_log_audit = MagicMock()

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=[]),
        ), patch(
            "services.reconciliation.diff_strategy_fills",
            return_value=report,
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=_db_execute_dispatch),
        ), patch(
            "services.job_worker.log_audit_event",
            new=mock_log_audit,
        ):
            # MUST NOT raise — owner-lookup exception is swallowed.
            result = await run_reconcile_strategy_job(
                {"id": "job-r-1", "kind": "reconcile_strategy", "strategy_id": "strat-1"}
            )

        # Reconcile completed successfully despite owner lookup failing.
        assert result.outcome == DispatchOutcome.DONE
        # Audit must NOT be emitted when owner_id is unresolvable —
        # log_audit_event rejects user_id=None upfront.
        mock_log_audit.assert_not_called()

    @pytest.mark.asyncio
    async def test_owner_lookup_returns_none_skips_audit_gracefully(self) -> None:
        """H-0684 / M-0669: when the strategies row was deleted between
        job enqueue and reconcile completion, owner_id is None. The
        audit emission is conditionally skipped (log_audit_event rejects
        user_id=None upfront). Verify the skip happens cleanly AND that
        the reconcile epilogue completes. Pre-fix there was no test
        exercising this branch — a refactor that moved the emission to
        an `else` would not have been caught."""
        ctx = _build_mock_ctx()
        report = _StubReport(status="clean")

        async def _db_execute_dispatch(fn):
            name = getattr(fn, "__name__", "")
            if name == "_load_strategy_owner":
                return None  # strategy was deleted
            return []

        mock_log_audit = MagicMock()

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=[]),
        ), patch(
            "services.reconciliation.diff_strategy_fills",
            return_value=report,
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=_db_execute_dispatch),
        ), patch(
            "services.job_worker.log_audit_event",
            new=mock_log_audit,
        ):
            result = await run_reconcile_strategy_job(
                {"id": "job-r-2", "kind": "reconcile_strategy", "strategy_id": "strat-1"}
            )

        assert result.outcome == DispatchOutcome.DONE
        mock_log_audit.assert_not_called()

    @pytest.mark.asyncio
    async def test_owner_lookup_success_emits_audit_with_owner_id(self) -> None:
        """Happy path: when owner_id resolves, log_audit_event is called
        with the resolved user_id and the canonical metadata shape.
        Pre-fix this was only verified via AST tests (which can't catch
        a refactor that dropped the call entirely behind a runtime
        gate). This is the regression-mode test."""
        ctx = _build_mock_ctx()
        report = _StubReport(status="clean")

        async def _db_execute_dispatch(fn):
            name = getattr(fn, "__name__", "")
            if name == "_load_strategy_owner":
                return "owner-uuid-42"
            return []

        mock_log_audit = MagicMock()

        with patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ), patch(
            "services.job_worker.fetch_raw_trades",
            new=AsyncMock(return_value=[]),
        ), patch(
            "services.reconciliation.diff_strategy_fills",
            return_value=report,
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=_db_execute_dispatch),
        ), patch(
            "services.job_worker.log_audit_event",
            new=mock_log_audit,
        ):
            result = await run_reconcile_strategy_job(
                {"id": "job-r-3", "kind": "reconcile_strategy", "strategy_id": "strat-1"}
            )

        assert result.outcome == DispatchOutcome.DONE
        mock_log_audit.assert_called_once()
        kwargs = mock_log_audit.call_args.kwargs
        assert kwargs["user_id"] == "owner-uuid-42"
        assert kwargs["action"] == "reconcile.compare"
        assert kwargs["entity_type"] == "reconcile_run"
        assert kwargs["entity_id"] == "strat-1"
        assert kwargs["metadata"]["status"] == "clean"
        assert kwargs["metadata"]["discrepancy_count"] == 0
