"""One-time deploy script (plan D.11): reset stranded computation_status rows.

Finds strategy_analytics rows stuck at computation_status='computing' that:
  - Were last updated more than 5 minutes ago, AND
  - Have no active compute_jobs row (i.e. no row with status outside
    'done'/'failed_final')

These rows were left behind by the legacy after() path when it was
interrupted during the platform upgrade to the compute_jobs queue.

Sets them to 'failed' with a user-friendly error message so the user
can retry via the new queue path.

Idempotent: safe to re-run. Rows already set to 'failed' with this
specific error message won't be touched again (they already match the
target state). Rows that have since been retried and are now
'computing' with an active compute_jobs row will be skipped.

Usage:
  cd analytics-service
  python -m scripts.reset_stuck_computing_rows
"""

import os
import sys

from supabase import create_client


RESET_ERROR_MESSAGE = (
    "Sync was interrupted during platform upgrade. Please retry."
)


def main() -> None:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required.", file=sys.stderr)
        sys.exit(1)

    supabase = create_client(url, key)

    # Find stranded rows: computing for 5+ minutes with no active jobs.
    # The query uses a raw SQL RPC because the filter condition involves
    # a NOT EXISTS subquery that the PostgREST query builder cannot express.
    #
    # We use a direct SQL call via supabase.rpc or postgrest. Since the
    # supabase-py client doesn't have a raw SQL endpoint, we use the
    # query builder with a two-step approach:
    #   1. Find all 'computing' rows older than 5 minutes
    #   2. For each, check if there's an active compute_jobs row
    #   3. Reset those without active jobs

    # Step 1: Get all computing rows updated more than 5 minutes ago
    result = (
        supabase.table("strategy_analytics")
        .select("strategy_id, updated_at")
        .eq("computation_status", "computing")
        .lt("updated_at", "now() - interval '5 minutes'")
        .execute()
    )

    if not result.data:
        print("No stranded computing rows found. Nothing to do.")
        return

    candidates = result.data
    print(f"Found {len(candidates)} computing rows older than 5 minutes.")

    reset_count = 0
    for row in candidates:
        sid = row["strategy_id"]

        # Step 2: Check for active compute_jobs (non-terminal status)
        jobs = (
            supabase.table("compute_jobs")
            .select("id")
            .eq("strategy_id", sid)
            .in_("status", ["pending", "running", "done_pending_children", "failed_retry"])
            .limit(1)
            .execute()
        )

        if jobs.data:
            # Active job exists — worker is handling this, skip.
            print(f"  SKIP {sid}: active compute_jobs row exists.")
            continue

        # Step 3: Reset to failed
        supabase.table("strategy_analytics").update(
            {
                "computation_status": "failed",
                "computation_error": RESET_ERROR_MESSAGE,
            }
        ).eq("strategy_id", sid).eq("computation_status", "computing").execute()

        reset_count += 1
        print(f"  RESET {sid} → failed")

    print(f"\nDone. Reset {reset_count} of {len(candidates)} candidate rows.")


if __name__ == "__main__":
    main()
