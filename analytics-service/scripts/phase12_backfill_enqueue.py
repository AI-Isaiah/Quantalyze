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
    pile up redundant backfills.

    The pre-check is best-effort, NOT a lock: two operators racing in parallel
    can both observe pending_count=0. The durable guarantee comes from the SINGLE
    atomic bulk INSERT below (H-0599 / H-0600 / S15e). PostgREST runs a list
    .insert([...]) as one statement in one transaction, so if a racing invocation
    (or a worker re-enqueue) has already landed an in-flight row for any
    (strategy_id, kind) in our batch, the partial unique index aborts the WHOLE
    statement atomically — there is no split-brain half-enqueued state and no
    non-deterministic mid-loop crash. We catch that collision (errcode 23505) and
    report it loudly instead of dumping a raw traceback.

    NOTE on ON CONFLICT: the partial unique index cannot be used as a PostgREST
    upsert arbiter — Postgres raises 42P10 ("no matching constraint") because a
    partial index's predicate is not inferable from `on_conflict=(strategy_id,kind)`
    (verified against the live schema). So we do a plain bulk INSERT guarded by the
    pre-check + atomic-abort semantics rather than .upsert(..., ignore_duplicates).

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
    # H-0600(c) / S15e type-design #17: `existing.count or 0` collapsed a
    # missing count header (None — possible under RLS/PostgREST quirks) into 0,
    # which would silently SKIP the duplicate guard and let us pile on a second
    # backfill. A None count means the guard could not be evaluated — fail loud
    # rather than guess (Rule 12), because the count="exact" request above
    # explicitly asked PostgREST for a count.
    if existing.count is None:
        raise RuntimeError(
            "phase12_backfill_enqueue: pending compute_analytics count came back "
            "None (count header absent); refusing to run the duplicate guard "
            "blind. Re-run or inspect PostgREST/RLS before backfilling."
        )
    pending_count = existing.count
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
    # rows.data is None on PostgREST query failure; coercing to [] would
    # silently print "enqueueing 0 published strategies" and exit 0 on a
    # broken query (Rule 12 — fail loud).
    if rows.data is None:
        raise RuntimeError(
            "phase12_backfill_enqueue: strategies select returned None "
            "(PostgREST query failure); refusing to claim a zero-strategy "
            "no-op against an unverified row set."
        )
    strategies = rows.data
    total = len(strategies)
    print(
        f"phase12_backfill_enqueue: enqueueing {total} published strategies as "
        f"priority='low'"
    )

    # Defensive id extraction: a row missing 'id' (schema rename, RLS-
    # projection change, malformed response) must NOT raise KeyError and
    # abort the batch. Filter to valid ids BEFORE building the bulk payload;
    # any skipped row is recorded as a failure so the script exits non-zero
    # (Rule 12 — fail loud) without losing the rows that ARE enqueueable.
    now_iso = datetime.now(timezone.utc).isoformat()
    payload: list[dict] = []
    skipped: list[str] = []
    for idx, r in enumerate(strategies):
        sid = r.get("id") if isinstance(r, dict) else None
        if not isinstance(sid, str) or not sid:
            skipped.append(f"<row-{idx}>")
            print(
                f"phase12_backfill_enqueue: WARNING — strategy row {idx} "
                f"missing/invalid 'id' field: {r!r} (skipping)"
            )
            continue
        payload.append(
            {
                "strategy_id": sid,
                "kind": "compute_analytics",
                "status": "pending",
                "priority": "low",
                "next_attempt_at": now_iso,
                "metadata": {"phase": "12-backfill"},
            }
        )

    # H-0596: ONE bulk INSERT instead of N serial round-trips (PostgREST
    # accepts a list payload). H-0599 / H-0600: this single statement runs in
    # one transaction, so a duplicate-guard race (parallel operator, or a
    # worker re-enqueue between the pre-check and here) aborts the ENTIRE
    # insert atomically via the partial unique index — never a split-brain
    # half-enqueued batch. We narrow-catch that collision (23505) and report
    # it cleanly, mirroring services/job_worker.py reconcile_strategy.
    inserted = 0
    raced = False
    if payload:
        try:
            await db_execute(
                lambda: supabase.table("compute_jobs").insert(payload).execute()
            )
            inserted = len(payload)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "code", None)
            msg = str(exc)
            if code == "23505" or "23505" in msg or "duplicate key" in msg.lower():
                # The best-effort pre-check lost a race: another invocation or
                # a worker already has an in-flight (strategy_id, kind) for a
                # row in this batch. The whole INSERT rolled back atomically —
                # zero rows enqueued, no partial state.
                raced = True
                print(
                    "phase12_backfill_enqueue: ERROR — bulk insert hit the "
                    "(strategy_id, kind) partial unique index (errcode 23505): "
                    f"{exc!r}. A concurrent backfill/worker beat us; the batch "
                    "rolled back atomically (0 enqueued). Re-run after the queue "
                    "drains."
                )
            else:
                # Any other failure (network, auth, malformed payload) is not a
                # benign race — surface it loudly rather than swallow.
                print(
                    "phase12_backfill_enqueue: ERROR — bulk insert failed "
                    f"({code}): {exc!r}. 0 enqueued (atomic rollback)."
                )

    print(
        f"phase12_backfill_enqueue: enqueued {inserted}/{total} jobs. Throttle "
        f"(claim_compute_jobs_with_priority RPC, ~5/min when sync_trades queued) will pace."
    )
    if skipped:
        print(
            f"phase12_backfill_enqueue: {len(skipped)} strategy rows skipped "
            f"(missing/invalid id) — see WARNING lines above"
        )
    # Non-zero exit when ANY row could not be enqueued: malformed rows skipped,
    # a duplicate-guard race, or a bulk-insert error. inserted < len(payload)
    # only happens on an atomic abort (inserted stays 0), so the union check is:
    if skipped or raced or inserted != len(payload):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
