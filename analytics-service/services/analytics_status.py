"""UI status bridge between compute_jobs (backend queue state) and
strategy_analytics.computation_status (frontend-visible status).

Every strategy-scoped job handler calls sync_strategy_analytics_status
after the job resolves (success or failure), so the strategy card in the
dashboard shows 'computing' / 'complete' / 'failed' aligned with what the
worker is actually doing.

The mapping lives in the 038 RPC (sync_strategy_analytics_status), not in
Python. Python just calls the RPC. The RPC is atomic — it computes the
derived status from a compute_jobs aggregate and upserts into
strategy_analytics.computation_status in a single statement. This avoids
the read-then-write race that Eng review Finding 2-B (2026-04-11) called
out when two workers finish strategy jobs near-simultaneously.

See supabase/migrations/038_sync_strategy_analytics_status.sql for the RPC
body and mapping semantics. The no-compute_jobs-rows path preserves
whatever the existing strategy_analytics row says (pending default from
migration 001) so brand-new strategies don't get their default 'pending'
status stomped.
"""
from __future__ import annotations

import logging

from services.db import db_execute, get_supabase

logger = logging.getLogger("quantalyze.analytics.status_bridge")


async def sync_strategy_analytics_status(strategy_id: str) -> None:
    """Call the 038 atomic RPC to derive + write UI status.

    Raises no exceptions for "normal" outcomes (row absent, status unchanged,
    etc.). Lets Supabase-layer exceptions bubble so the caller can log them
    as a bridge failure — the bridge is best-effort, not load-bearing.
    """
    if not strategy_id:
        return

    supabase = get_supabase()

    def _rpc() -> None:
        supabase.rpc(
            "sync_strategy_analytics_status",
            {"p_strategy_id": strategy_id},
        ).execute()

    await db_execute(_rpc)
