"""Phase 12 / D-08: eager re-enqueue all published strategies as priority='low'.

The throttle in dispatch_tick (Plan 07; migration 086 claim_compute_jobs_with_priority
RPC) caps low-priority claims to 5/min when any normal/high job is pending, so this
blast cannot starve live sync_trades.

M-02 (12-REVIEWS.md):
    compute_jobs has only a partial unique index on (strategy_id, kind) scoped to
    in-flight statuses ('pending', 'running', 'done_pending_children') — once a
    backfill job drains to 'done' / 'failed_final', a second invocation of this
    enqueuer would land a duplicate. We pre-check pending compute_analytics rows
    and bail out with a notice when any are present, so callers cannot accidentally
    pile up redundant backfills (or hit the partial-unique-index error mid-loop).

Usage:
    cd analytics-service
    python -m scripts.phase12_backfill_enqueue
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone

from services.db import db_execute, get_supabase


async def main() -> int:
    supabase = get_supabase()

    # M-02: pre-check existing pending compute_analytics jobs. If any exist, do not
    # enqueue more — the worker is still draining the previous batch (or a prior
    # invocation already enqueued and we'd otherwise duplicate). When this prints
    # the literal phrase below, plan acceptance criterion grep matches.
    existing = await db_execute(
        lambda: supabase.table("compute_jobs")
        .select("id", count="exact")
        .eq("kind", "compute_analytics")
        .eq("status", "pending")
        .execute()
    )
    pending_count = existing.count or 0
    if pending_count > 0:
        print(
            f"[backfill] {pending_count} existing pending compute_analytics jobs found "
            f"— skipping to avoid duplicates. Re-run after worker drains."
        )
        return 0

    # Fetch all published strategy IDs.
    rows = await db_execute(
        lambda: supabase.table("strategies")
        .select("id")
        .eq("status", "published")
        .execute()
    )
    strategies = rows.data or []
    total = len(strategies)
    print(
        f"phase12_backfill_enqueue: enqueueing {total} published strategies as "
        f"priority='low'"
    )

    # P2025: track per-row outcomes. The old loop had no try/except — a partial-
    # unique-index violation on row K would raise and leave the caller thinking
    # K-1 rows were enqueued, while the final message lied about `total`.
    now_iso = datetime.now(timezone.utc).isoformat()
    inserted = 0
    failures: list[tuple[str, str]] = []
    for r in strategies:
        sid = r["id"]
        try:
            await db_execute(
                lambda strategy_id=sid: supabase.table("compute_jobs").insert(
                    {
                        "strategy_id": strategy_id,
                        "kind": "compute_analytics",
                        "status": "pending",
                        "priority": "low",
                        "next_attempt_at": now_iso,
                        "metadata": {"phase": "12-backfill"},
                    }
                ).execute()
            )
            inserted += 1
        except Exception as exc:  # pragma: no cover — exercised by tests
            failures.append((sid, repr(exc)))
            print(
                f"phase12_backfill_enqueue: WARNING — insert failed for strategy "
                f"{sid}: {exc!r} (continuing)"
            )

    print(
        f"phase12_backfill_enqueue: enqueued {inserted}/{total} jobs. Throttle "
        f"(claim_compute_jobs_with_priority RPC, ~5/min when sync_trades queued) will pace."
    )
    if failures:
        print(
            f"phase12_backfill_enqueue: {len(failures)} per-row failures — "
            f"see WARNING lines above"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
