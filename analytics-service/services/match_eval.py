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

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from services.db import PaginatedSelectTruncated, one, paginated_select

logger = logging.getLogger(__name__)

__all__ = ["compute_hit_rate_metrics"]


def compute_hit_rate_metrics(
    lookback_days: int = 28,
    partner_tag: str | None = None,
) -> dict[str, Any]:
    """Compute hit rate metrics over the last lookback_days.

    When `partner_tag` is provided, scope the metrics to intros shipped to
    allocators whose profile has that partner_tag — used by the cap-intro demo
    sprint's partner pilot flow (T-1.3). Unscoped calls continue to include
    every allocator.

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

    filtered_allocator_ids: list[str] | None = None
    if partner_tag:
        allocators_result = (
            supabase.table("profiles")
            .select("id")
            .eq("partner_tag", partner_tag)
            .in_("role", ["allocator", "both"])
            .execute()
        )
        filtered_allocator_ids = [p["id"] for p in (allocators_result.data or [])]
        if not filtered_allocator_ids:
            return _empty_metrics(lookback_days)

    # All sent_as_intro decisions in the window
    intros_query = (
        supabase.table("match_decisions")
        .select("allocator_id, strategy_id, created_at, candidate_id")
        .eq("decision", "sent_as_intro")
        .gte("created_at", cutoff.isoformat())
    )
    if filtered_allocator_ids is not None:
        intros_query = intros_query.in_("allocator_id", filtered_allocator_ids)
    intros_result = intros_query.execute()
    intros = intros_result.data or []

    if not intros:
        return _empty_metrics(lookback_days)

    # ── Batched lookups ───────────────────────────────────────────────
    # The legacy path called `_find_strategy_rank_in_latest_batch_before`
    # per intro, which fires 2 sequential Supabase round-trips each. At
    # 100 intros that's ~200 RTTs ≈ 20s on a 100ms link.
    #
    # The batched path issues AT MOST two queries regardless of fan-out:
    #   1. One `match_batches` fetch for every allocator referenced by
    #      any valid intro in the window (`.in_("allocator_id", ...)`).
    #   2. One `match_candidates` fetch across every relevant batch id
    #      (`.in_("batch_id", ...)`).
    # The per-intro "most recent batch before this timestamp" + rank
    # lookup then runs entirely in-memory against the pre-fetched maps.
    #
    # The helper `_find_strategy_rank_in_latest_batch_before` is kept as
    # a public API surface for tests that patch it directly.
    valid_intros: list[dict[str, Any]] = []
    skipped = 0
    for intro in intros:
        allocator_id = intro.get("allocator_id") if isinstance(intro, dict) else None
        strategy_id = intro.get("strategy_id") if isinstance(intro, dict) else None
        created_at = intro.get("created_at") if isinstance(intro, dict) else None
        if not (allocator_id and strategy_id and created_at):
            logger.warning(
                "compute_hit_rate_metrics: skipping malformed intro (missing required fields): %s",
                intro,
            )
            skipped += 1
            continue
        valid_intros.append(intro)

    if not valid_intros:
        # Preserve the skipped count so a "100% malformed" run is
        # distinguishable from a "zero intros shipped" run.
        empty = _empty_metrics(lookback_days)
        empty["skipped"] = skipped
        empty["skipped_rate"] = skipped / len(intros) if intros else 0.0
        return empty

    allocator_ids = sorted({i["allocator_id"] for i in valid_intros})

    # audit-2026-05-07 C-0231: compute the max intro timestamp so the
    # match_batches fetch can be bounded by `.lt("computed_at",
    # max_intro_ts)`. Without this bound, the paginated SELECT pulls the
    # ENTIRE allocator-batch history every call — for a long-lived
    # allocator with thousands of historical batches, that's quadratic
    # memory growth as match_batches fills. The "latest batch before
    # intro" lookup downstream only ever consults rows older than the
    # NEWEST intro in this window, so any batch with `computed_at >=
    # max_intro_ts` is irrelevant. Adding a SMALL guard (1 microsecond
    # buffer via `<=` semantics in `.lt`) keeps PostgREST's half-open
    # range semantics intact (`.lt` is strict `<`, so the bound stays
    # accurate even if a batch is computed at the exact same instant as
    # the intro — the in-memory comparison uses `<` too).
    max_intro_ts: str | None = None
    for intro in valid_intros:
        ts = intro.get("created_at")
        if ts and (max_intro_ts is None or ts > max_intro_ts):
            max_intro_ts = ts

    # batches_by_allocator: allocator_id -> list of {id, computed_at}.
    # Paginated fetch over `match_batches` filtered to the relevant
    # allocators. We do NOT wrap this in a try/except: if PostgREST errors
    # here, the caller (analytics-service match router) should see the 500
    # — silently fabricating "no_prior_batch" misses for every intro would
    # corrupt the hit-rate metric with no signal.
    #
    # Why paginate instead of a single `.limit(N)`: PostgREST has an
    # admin-configurable `db-max-rows` ceiling and a hard per-response
    # limit, and a single `.limit(50000)` would silently drop any rows
    # beyond that page. Pagination keeps us correct at every scale.
    batches_by_allocator: dict[str, list[dict[str, Any]]] = defaultdict(list)
    # audit-2026-05-07 #27: order by (allocator_id, computed_at DESC) so the
    # query rides `idx_match_batches_allocator_recent`. Pre-fix the helper
    # ordered by `id` (UUIDv4 PK), which produces a random scan + ignores the
    # composite index AND races with concurrent writes — newly-inserted batches
    # could land in any UUID bucket, so a row-index-based pagination would skip
    # or duplicate them. The composite ordering is stable because writers
    # never mutate `(allocator_id, computed_at)` post-insert.
    batches_query = (
        supabase.table("match_batches")
        .select("id, allocator_id, computed_at")
        .in_("allocator_id", allocator_ids)
    )
    if max_intro_ts is not None:
        # audit-2026-05-07 C-0231: bound the fetch by max intro timestamp.
        # Use strict `<` semantics — the downstream in-memory comparison
        # also uses `<` (line: `if computed_at_dt < created_at_dt`), so any
        # batch at exactly `max_intro_ts` would never win for any intro in
        # the window anyway. Bounding here saves PostgREST round-trip
        # bandwidth + memory for every call.
        batches_query = batches_query.lt("computed_at", max_intro_ts)
    for row in paginated_select(
        batches_query,
        order_by=(("allocator_id", False), ("computed_at", True)),
        truncation_hint=f"match_batches in_(allocator_id, n={len(allocator_ids)})",
    ):
        aid = row.get("allocator_id")
        if aid:
            batches_by_allocator[aid].append(row)

    # The server-side ORDER BY is `(allocator_id ASC, computed_at DESC)` so
    # the helper's `.range()` pagination is index-friendly. Within an
    # allocator the rows arrive most-recent-first, but we still re-sort
    # in-memory so the per-allocator slice is robust against tied
    # `computed_at` values (which would be PostgREST-undefined otherwise).
    # The per-intro comparison below parses each timestamp via
    # datetime.fromisoformat so the chosen batch is always chronologically
    # correct regardless of string format.
    def _sort_key(row: dict[str, Any]) -> datetime:
        ts = row.get("computed_at")
        if not ts:
            return datetime.min.replace(tzinfo=timezone.utc)
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return datetime.min.replace(tzinfo=timezone.utc)

    for aid in batches_by_allocator:
        batches_by_allocator[aid].sort(key=_sort_key, reverse=True)

    # Resolve the "latest batch BEFORE intro timestamp" per intro in-memory.
    # Also collect the set of batch ids we'll need candidates for.
    #
    # Timestamps come from PostgREST as ISO 8601 strings with explicit zone
    # (e.g. "2026-04-06T00:00:00+00:00"). Parse both sides via
    # datetime.fromisoformat so the comparison is chronological instead of
    # lexicographic — matches how the rest of this module handles ISO strings
    # (see _week_start_iso) and is resilient to "Z" vs "+00:00" drift.
    def _to_dt(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))

    intro_to_batch_id: dict[int, str | None] = {}
    needed_batch_ids: set[str] = set()
    for idx, intro in enumerate(valid_intros):
        allocator_id = intro["allocator_id"]
        try:
            created_at_dt = _to_dt(intro["created_at"])
        except (TypeError, ValueError):
            logger.warning(
                "compute_hit_rate_metrics: unparseable created_at, treating as no_prior_batch: %s",
                intro.get("created_at"),
            )
            intro_to_batch_id[idx] = None
            continue
        chosen: str | None = None
        for batch in batches_by_allocator.get(allocator_id, []):
            computed_at = batch.get("computed_at")
            if not computed_at:
                continue
            try:
                computed_at_dt = _to_dt(computed_at)
            except (TypeError, ValueError):
                continue
            if computed_at_dt < created_at_dt:
                chosen = batch.get("id")
                break
        intro_to_batch_id[idx] = chosen
        if chosen:
            needed_batch_ids.add(chosen)

    # candidates_by_batch_and_strategy: (batch_id, strategy_id) -> rank (int)
    # Only eligible candidates (exclusion_reason IS NULL) are included —
    # this matches the legacy helper which filtered with `.is_("exclusion_reason", None)`.
    # As with the batches fetch, a PostgREST error here propagates — we do
    # not silently mark every intro as no_prior_batch. Paginated so we
    # never silently truncate at large scale.
    # `match_candidates` has no UNIQUE (batch_id, strategy_id) constraint,
    # so in principle a bad writer could insert duplicates. The legacy
    # `_find_strategy_rank_in_latest_batch_before` used `.maybe_single()`
    # which would throw on that case. Preserve equivalent signal here: if
    # we ever see the same (batch_id, strategy_id) twice in the rank map,
    # log a warning so the next operator sees the corruption.
    candidates_by_batch_and_strategy: dict[tuple[str, str], int | None] = {}
    if needed_batch_ids:
        # audit-2026-05-07 #27: order by (batch_id, rank) so the query rides
        # `idx_match_cand_batch_rank` (partial index WHERE exclusion_reason
        # IS NULL). The `.is_("exclusion_reason", "null")` predicate below
        # pushes the partial-index filter into the query so the planner can
        # actually use the partial index — without it the predicate sits in
        # Python and the planner falls back to a sort. In-memory `continue`
        # still defends against any post-write race that surfaces an excluded
        # row through a stale snapshot.
        for row in paginated_select(
            supabase.table("match_candidates")
            .select("batch_id, strategy_id, rank, exclusion_reason")
            .in_("batch_id", sorted(needed_batch_ids))
            .is_("exclusion_reason", "null"),
            order_by=(("batch_id", False), ("rank", False)),
            truncation_hint=f"match_candidates in_(batch_id, n={len(needed_batch_ids)})",
        ):
            if row.get("exclusion_reason") is not None:
                continue
            batch_id = row.get("batch_id")
            strategy_id = row.get("strategy_id")
            if not (batch_id and strategy_id):
                continue
            key = (batch_id, strategy_id)
            if key in candidates_by_batch_and_strategy:
                logger.warning(
                    "compute_hit_rate_metrics: duplicate match_candidates row for "
                    "batch_id=%s strategy_id=%s — keeping first rank %s, ignoring %s",
                    batch_id,
                    strategy_id,
                    candidates_by_batch_and_strategy[key],
                    row.get("rank"),
                )
                continue
            candidates_by_batch_and_strategy[key] = row.get("rank")

    # Per-intro aggregation, now purely in-memory.
    hits_top_3 = 0
    hits_top_10 = 0
    weekly_agg: dict[str, dict[str, int]] = defaultdict(
        lambda: {"intros": 0, "hits_top_3": 0, "hits_top_10": 0}
    )
    missed: list[dict[str, Any]] = []

    for idx, intro in enumerate(valid_intros):
        try:
            allocator_id = intro["allocator_id"]
            strategy_id = intro["strategy_id"]
            created_at = intro["created_at"]

            batch_id = intro_to_batch_id.get(idx)
            rank: int | None
            if batch_id is None:
                rank = None
            else:
                rank = candidates_by_batch_and_strategy.get((batch_id, strategy_id))

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
        except Exception:
            logger.exception(
                "compute_hit_rate_metrics: intro processing failed, skipping: %s",
                intro,
            )
            skipped += 1
            continue

    intros_seen = len(intros)
    total = intros_seen - skipped
    if total <= 0:
        empty = _empty_metrics(lookback_days)
        empty["skipped"] = skipped
        empty["skipped_rate"] = skipped / intros_seen if intros_seen else 0.0
        return empty

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

    # ``skipped`` is load-bearing telemetry: a run where 80% of intros
    # raise during processing currently shrinks the denominator silently
    # and looks identical to a healthy 20-intro run. Surface it so
    # operators can spot the bad-row rate.
    return {
        "window_days": lookback_days,
        "intros_shipped": total,
        "skipped": skipped,
        "skipped_rate": skipped / intros_seen if intros_seen else 0.0,
        "hits_top_3": hits_top_3,
        "hits_top_10": hits_top_10,
        "hit_rate_top_3": hits_top_3 / total,
        "hit_rate_top_10": hits_top_10 / total,
        "weekly": weekly,
        "missed": missed[:50],  # Cap at 50 for payload size
    }


def _find_strategy_rank_in_latest_batch_before(
    supabase: Client,
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
        .maybe_single()
        .execute()
    )
    # `.maybe_single().execute()` returns LITERAL None on zero rows in postgrest
    # 1.0.x (supabase 2.15.1) — not an APIResponse with .data=None — so a bare
    # `cand_result.data` raises AttributeError on the (normal) candidate-absent
    # case. Route through one() (-> Row | None) which collapses both the None
    # response and the no-row case. Same maybe_single class as Sentry
    # QUANTALYZE-1/-5 (the router sites were migrated onto one() in PR #390).
    cand_row = one(cand_result)
    if not cand_row:
        return None
    # `rank` is a NOT NULL int column on match_candidates; isinstance-narrow the
    # Any-typed PostgREST scalar (supabase 2.15.1 leaves .data Any) back to int.
    # A non-int would mean SQL contract drift — fall through to None, the same
    # "not in batch" outcome the guard above produces.
    rank = cand_row.get("rank")
    return rank if isinstance(rank, int) else None


def _week_start_iso(timestamp_str: str) -> str:
    """Return the Monday of the week containing the given ISO timestamp, as an ISO date string."""
    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()


def _empty_metrics(lookback_days: int) -> dict[str, Any]:
    return {
        "window_days": lookback_days,
        "intros_shipped": 0,
        "skipped": 0,
        "skipped_rate": 0.0,
        "hits_top_3": 0,
        "hits_top_10": 0,
        "hit_rate_top_3": 0.0,
        "hit_rate_top_10": 0.0,
        "weekly": [],
        "missed": [],
    }
