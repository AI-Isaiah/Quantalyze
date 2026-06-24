"""Phase 35 / DAILIES-03: backfill per-key dailies for existing exchange keys.

Enqueues ONE api_key-scoped ``derive_broker_dailies`` compute job per active,
connected exchange key, so historical keys get a per-key daily-returns series —
not only keys onboarded after this milestone. The dual-mode handler (Plan 02)
does the actual realized+funding fetch and the (api_key_id, date) upsert; this
script only fans the job out across the current key population.

Mirrors the proven ``phase12_backfill_enqueue.py`` shape:
    pre-check duplicate guard (fail loud if the count header is absent)
    + a SINGLE atomic bulk INSERT (a racing duplicate aborts the whole
      statement via the compute_jobs (api_key_id, kind) in-flight partial
      unique index — errcode 23505, caught and reported)
    + non-zero exit on ANY skip / race / partial (Rule 12 — fail loud).

Active-key predicate (DAILIES-03 / A1, role-agnostic — the per-key axis is
key-identity, not role-identity; no profiles.role filter):

    is_active = true
    AND sync_status IS DISTINCT FROM 'revoked'   (a NULL sync_status IS included)
    AND disconnected_at IS NULL

NOTE on the sync_status filter: PostgREST ``.neq("sync_status", "revoked")``
uses three-valued logic and DROPS rows where sync_status IS NULL — which would
wrongly skip never-synced active keys. To faithfully encode "IS DISTINCT FROM
'revoked'" (which includes NULL), we use
``.or_("sync_status.is.null,sync_status.neq.revoked")``.

Idempotency model: the best-effort pre-check (pending derive_broker_dailies jobs
with api_key_id NOT NULL) bails early on a re-run; the DURABLE guarantee is the
single atomic bulk INSERT + the (api_key_id, kind) in-flight partial unique
index, which aborts a racing duplicate atomically.

Usage:
    railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"
    (needs SUPABASE_SERVICE_KEY — service-role bypasses RLS for the enqueue.)
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone

from services.db import db_execute, get_supabase


async def main() -> int:
    supabase = get_supabase()

    # Pre-check existing pending api_key-scoped derive_broker_dailies jobs. If
    # any exist, the worker is still draining a prior batch (or a previous
    # invocation already enqueued) — do not pile on a duplicate backfill.
    existing = await db_execute(
        lambda: supabase.table("compute_jobs")
        .select("id", count="exact")
        .eq("kind", "derive_broker_dailies")
        .eq("status", "pending")
        .not_.is_("api_key_id", "null")
        .execute()
    )
    # A None count means the duplicate guard could not be evaluated (count
    # header absent under a PostgREST/RLS quirk). count="exact" explicitly asked
    # for a count — fail loud rather than skip the guard blind (Rule 12).
    if existing.count is None:
        raise RuntimeError(
            "phase35_backfill_enqueue: pending derive_broker_dailies count came "
            "back None (count header absent); refusing to run the duplicate guard "
            "blind. Re-run or inspect PostgREST/RLS before backfilling."
        )
    pending_count = existing.count
    if pending_count > 0:
        print(
            f"[backfill] {pending_count} existing pending api_key derive_broker_dailies "
            f"jobs found — skipping to avoid duplicates. Re-run after worker drains."
        )
        return 0

    # Fetch every active, connected exchange key (role-agnostic).
    rows = await db_execute(
        lambda: supabase.table("api_keys")
        .select("id")
        .eq("is_active", True)
        # IS DISTINCT FROM 'revoked' — include NULL sync_status (never-synced
        # active keys). Plain .neq drops NULLs (three-valued logic).
        .or_("sync_status.is.null,sync_status.neq.revoked")
        .is_("disconnected_at", "null")
        .execute()
    )
    # rows.data is None on a PostgREST query failure; coercing to [] would
    # silently print "enqueueing 0 keys" and exit 0 on a broken query (Rule 12).
    if rows.data is None:
        raise RuntimeError(
            "phase35_backfill_enqueue: api_keys select returned None "
            "(PostgREST query failure); refusing to claim a zero-key no-op "
            "against an unverified row set."
        )
    keys = rows.data
    total = len(keys)
    print(
        f"phase35_backfill_enqueue: enqueueing {total} active connected exchange "
        f"keys as derive_broker_dailies (api_key-scoped)"
    )

    # Defensive id extraction: a row missing 'id' (schema rename, RLS-projection
    # change, malformed response) must NOT raise KeyError and abort the batch.
    # Filter to valid ids BEFORE building the bulk payload; any skipped row is
    # recorded as a failure so the script exits non-zero (Rule 12) without
    # losing the rows that ARE enqueueable.
    now_iso = datetime.now(timezone.utc).isoformat()
    payload: list[dict] = []
    skipped: list[str] = []
    for idx, r in enumerate(keys):
        kid = r.get("id") if isinstance(r, dict) else None
        if not isinstance(kid, str) or not kid:
            skipped.append(f"<row-{idx}>")
            print(
                f"phase35_backfill_enqueue: WARNING — api_key row {idx} "
                f"missing/invalid 'id' field: {r!r} (skipping)"
            )
            continue
        # api_key-scoped derive job: NEVER set strategy_id (coherence requires
        # it NULL for the api_key arm).
        payload.append(
            {
                "api_key_id": kid,
                "kind": "derive_broker_dailies",
                "status": "pending",
                "next_attempt_at": now_iso,
                "metadata": {"phase": "35-backfill"},
            }
        )

    # ONE atomic bulk INSERT (PostgREST accepts a list payload). A duplicate-
    # guard race (parallel operator, or a worker re-enqueue between the
    # pre-check and here) aborts the ENTIRE insert atomically via the
    # (api_key_id, kind) in-flight partial unique index — never a split-brain
    # half-enqueued batch. We narrow-catch that collision (23505) and report it
    # cleanly, mirroring phase12_backfill_enqueue + job_worker reconcile.
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
                # The best-effort pre-check lost a race: another invocation or a
                # worker already has an in-flight (api_key_id, kind) for a row in
                # this batch. The whole INSERT rolled back atomically — zero rows
                # enqueued, no partial state.
                raced = True
                print(
                    "phase35_backfill_enqueue: ERROR — bulk insert hit the "
                    "(api_key_id, kind) in-flight partial unique index "
                    f"(errcode 23505): {exc!r}. A concurrent backfill/worker beat "
                    "us; the batch rolled back atomically (0 enqueued). Re-run "
                    "after the queue drains."
                )
            else:
                # Any other failure (network, auth, malformed payload) is not a
                # benign race — surface it loudly rather than swallow.
                print(
                    "phase35_backfill_enqueue: ERROR — bulk insert failed "
                    f"({code}): {exc!r}. 0 enqueued (atomic rollback)."
                )

    print(f"phase35_backfill_enqueue: enqueued {inserted}/{total} jobs.")
    if skipped:
        print(
            f"phase35_backfill_enqueue: {len(skipped)} api_key rows skipped "
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
