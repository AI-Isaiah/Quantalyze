-- Phase 36 (UNIFY-01/02) — index the per-key Overview read path.
--
-- queries.ts getMyAllocationDashboard now reads csv_daily_returns per allocator:
--     .eq("allocator_id", userId).gte("date", <730d ago>).order("date")
-- and the owner RLS policy csv_daily_returns_allocator_owner_select filters
--     USING (allocator_id = auth.uid())
-- (both from 20260624120000_csv_daily_returns_per_key_axis.sql).
--
-- Both predicates hit `allocator_id`, which had NO supporting index — only the
-- (strategy_id, date) and (api_key_id, date) UNIQUE indexes exist. Without this
-- index every Overview SSR load does a sequential scan + sort over the whole
-- csv_daily_returns table. The table is append-only and grows ~Nkeys * 365
-- rows/yr across ALL allocators, so the scan cost scales with total tenant
-- volume, not the requesting allocator's data — a latent hot-path regression
-- introduced by the Phase 36 repoint.
--
-- Design:
--  * Partial WHERE allocator_id IS NOT NULL — strategy-scoped rows carry a NULL
--    allocator_id and never match this read or the owner SELECT policy, so they
--    are excluded (smaller index; planner still uses it for the allocator
--    predicate). Mirrors the per-key axis's NULL-distinct index discipline.
--  * Leading allocator_id serves the equality filter + the RLS predicate;
--    trailing date serves the .gte range AND lets .order("date") be answered by
--    an index-ordered scan instead of a sort.
--  * Plain CREATE INDEX (not CONCURRENTLY): matches the table's existing index
--    style (20260624120000) and is safe at this size (a tiny table → sub-second
--    SHARE lock). Rebuild CONCURRENTLY later only if the table grows large.
CREATE INDEX IF NOT EXISTS csv_daily_returns_allocator_date_idx
  ON public.csv_daily_returns (allocator_id, date)
  WHERE allocator_id IS NOT NULL;
