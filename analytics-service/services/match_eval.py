"""Match Engine Evaluation — compare the algorithm's picks vs. the founder's actual intros.

Approach (eng review M1 — pragmatic approximation):
We compare historical `match_batches` against the founder's `sent_as_intro` decisions.
For each week with at least one shipped intro, we check whether that intro appeared
in the top-3 / top-10 of the closest `match_batches` computed for the same allocator.

This is honest about being approximate: we don't replay scoring against frozen data,
we compare against whatever batch was stored at the time. If there was no batch for
that week, the intro counts as a miss (or excluded from the metric — configurable).

Used by /api/match/eval via the Python router. The admin dashboard at /admin/match/eval
reads this.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any


def compute_hit_rate_metrics(lookback_days: int = 28) -> dict[str, Any]:
    """Compute hit rate metrics over the last lookback_days.

    Returns:
    {
      "window_days": int,
      "intros_shipped": int,
      "hits_top_3": int,
      "hits_top_10": int,
      "hit_rate_top_3": float,
      "hit_rate_top_10": float,
      "weekly": [{week_start, intros, hits_top_3, hits_top_10, hit_rate_top_3, hit_rate_top_10}],
      "missed": [{created_at, allocator_id, strategy_id, rank_if_any, reason}],
    }
    """
    from services.db import get_supabase  # Deferred import for local test isolation
    supabase = get_supabase()
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    # All sent_as_intro decisions in the window
    intros_result = (
        supabase.table("match_decisions")
        .select("allocator_id, strategy_id, created_at, candidate_id")
        .eq("decision", "sent_as_intro")
        .gte("created_at", cutoff.isoformat())
        .execute()
    )
    intros = intros_result.data or []

    if not intros:
        return _empty_metrics(lookback_days)

    # For each intro, find the closest prior match_batch for that allocator
    # and check the rank of the strategy.
    hits_top_3 = 0
    hits_top_10 = 0
    weekly_agg: dict[str, dict[str, int]] = defaultdict(
        lambda: {"intros": 0, "hits_top_3": 0, "hits_top_10": 0}
    )
    missed: list[dict[str, Any]] = []

    for intro in intros:
        allocator_id = intro["allocator_id"]
        strategy_id = intro["strategy_id"]
        created_at = intro["created_at"]

        rank = _find_strategy_rank_in_latest_batch_before(
            supabase, allocator_id, strategy_id, created_at
        )

        week_start = _week_start_iso(created_at)
        weekly_agg[week_start]["intros"] += 1

        if rank is not None and rank <= 3:
            hits_top_3 += 1
            weekly_agg[week_start]["hits_top_3"] += 1
        if rank is not None and rank <= 10:
            hits_top_10 += 1
            weekly_agg[week_start]["hits_top_10"] += 1
        if rank is None or rank > 3:
            missed.append({
                "allocator_id": allocator_id,
                "strategy_id": strategy_id,
                "created_at": created_at,
                "rank_if_any": rank,
                "reason": "not_in_top_3" if rank is not None else "no_prior_batch",
            })

    total = len(intros)
    weekly = sorted(
        [
            {
                "week_start": week_start,
                "intros": data["intros"],
                "hits_top_3": data["hits_top_3"],
                "hits_top_10": data["hits_top_10"],
                "hit_rate_top_3": data["hits_top_3"] / data["intros"] if data["intros"] else 0,
                "hit_rate_top_10": data["hits_top_10"] / data["intros"] if data["intros"] else 0,
            }
            for week_start, data in weekly_agg.items()
        ],
        key=lambda w: w["week_start"],
    )

    return {
        "window_days": lookback_days,
        "intros_shipped": total,
        "hits_top_3": hits_top_3,
        "hits_top_10": hits_top_10,
        "hit_rate_top_3": hits_top_3 / total,
        "hit_rate_top_10": hits_top_10 / total,
        "weekly": weekly,
        "missed": missed[:50],  # Cap at 50 for payload size
    }


def _find_strategy_rank_in_latest_batch_before(
    supabase,
    allocator_id: str,
    strategy_id: str,
    before_timestamp: str,
) -> int | None:
    """Return the rank of the strategy in the most recent match_batch BEFORE the given timestamp.
    Returns None if no prior batch or the strategy wasn't in the batch.
    """
    # Get the most recent batch before the intro was sent
    batch_result = (
        supabase.table("match_batches")
        .select("id")
        .eq("allocator_id", allocator_id)
        .lt("computed_at", before_timestamp)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    if not batch_result.data:
        return None
    batch_id = batch_result.data[0]["id"]

    # Look for the candidate in that batch
    cand_result = (
        supabase.table("match_candidates")
        .select("rank")
        .eq("batch_id", batch_id)
        .eq("strategy_id", strategy_id)
        .is_("exclusion_reason", None)
        .maybeSingle()
        .execute()
    )
    if not cand_result.data:
        return None
    return cand_result.data.get("rank")


def _week_start_iso(timestamp_str: str) -> str:
    """Return the Monday of the week containing the given ISO timestamp, as an ISO date string."""
    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()


def _empty_metrics(lookback_days: int) -> dict[str, Any]:
    return {
        "window_days": lookback_days,
        "intros_shipped": 0,
        "hits_top_3": 0,
        "hits_top_10": 0,
        "hit_rate_top_3": 0.0,
        "hit_rate_top_10": 0.0,
        "weekly": [],
        "missed": [],
    }
