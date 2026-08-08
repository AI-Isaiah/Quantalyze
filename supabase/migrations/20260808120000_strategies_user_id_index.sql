-- Phase 151 review finding F3 (2026-08-08) — `strategies.user_id` has no index,
-- and every owner-scoped read in the app filters on it.
--
--
-- (a) WHAT IS MISSING.
-- --------------------
-- `public.strategies` carries exactly four indexes today, and NONE of them can
-- serve an owner-scoped read:
--   * idx_strategies_status                        (status)          20260405093623:3
--   * idx_strategies_org                           (organization_id) 20260405180928:83
--   * idx_strategies_tenant_id                     (tenant_id)       20260408113028:101
--       — itself partial on `tenant_id IS NOT NULL`
--   * strategies_user_wizard_session_source_uniq   (user_id, wizard_session_id, source)
--                                                                    20260728120000:167
--       — ⚠️ LEADS on user_id, and would otherwise be usable as a prefix index,
--         but it is PARTIAL on `wizard_session_id IS NOT NULL`. The planner may
--         only use a partial index when the query's own predicate PROVES the
--         index predicate, and no owner-scoped read mentions
--         `wizard_session_id` at all. So it is unusable here — this is the trap
--         worth naming, because the index LOOKS like it already covers the case.
--
-- Net: every `.eq("user_id", …)` read is a sequential scan of the WHOLE catalog
-- table. The cost does not scale with the caller's own data — it scales with
-- EVERY user's strategies, so it degrades for user #1 as user #10,000 signs up.
--
--
-- (b) WHY NOW — this branch adds two more of them, both per dashboard load.
-- -------------------------------------------------------------------------
--   * src/lib/queries.ts:1805 `getOwnCapitalStrategies(userId)`
--       .eq("user_id", …).eq("capital_ownership", 'own_capital').neq("status", "archived")
--   * src/lib/queries.ts:348  `hasAnyOwnStrategies(userId)`   (the 151 role discriminator)
--       .eq("user_id", …).neq("status", "archived").limit(1)
-- Both are called from `src/app/(dashboard)/allocations/page.tsx:116`, on the
-- server, on every allocations load — on TOP of the pre-existing owner-scoped
-- reads (`queries.ts:524`, `api/strategies/composite/members/route.ts:62`,
-- `api/trades/upload/route.ts:83`, the finalize/create-with-key/csv-finalize
-- owner guards, …).
--
--
-- (c) WHY SINGLE-COLUMN `(user_id)` AND NOT COMPOSITE `(user_id, status)`.
-- ------------------------------------------------------------------------
-- Considered and REJECTED. Every caller that pairs user_id with status uses an
-- INEQUALITY — `.neq("status", "archived")` — and `<>` is not an indexable
-- search key in a btree: Postgres cannot use it to narrow the index scan, only
-- to filter rows it has already visited. A trailing `status` column would
-- therefore never restrict the scan for the two callers this branch adds.
--
-- It could still pay for itself as an index-ONLY scan payload, so that was
-- checked too, and it does not:
--   * `getOwnCapitalStrategies` selects name, codename, disclosure_tier,
--     capital_ownership + an embedded `strategy_analytics` join — all heap
--     columns, so the heap fetch happens regardless.
--   * `hasAnyOwnStrategies` selects `id`, which is likewise not in the index.
-- The one caller with a status EQUALITY is
-- `api/strategies/draft/[id]/route.ts:155` (`.eq("source","wizard").eq("status","draft")`)
-- — but it is already scoped by `.eq("id", …)` on the primary key, so it reads
-- one row by PK and never consults this index at all.
--
-- The deciding argument: `user_id` alone narrows to ONE user's strategies, a set
-- whose cardinality is bounded by what a single human creates (tens), not by
-- table growth. Narrowing further inside a ten-row set buys nothing measurable
-- while charging a second column on every INSERT/UPDATE of the table. Revisit
-- ONLY if a future high-frequency caller filters `user_id = ? AND status = ?`
-- with an EQUALITY and selects nothing outside `(user_id, status)`.
--
-- `(user_id, capital_ownership)` was rejected for the same reason, more so: it
-- would exist to narrow within a single user's already-tiny row set.
--
-- MEASURED, not argued (PostgreSQL 16.13, 200,000 synthetic rows over 20,000
-- distinct user_ids — i.e. this table four orders of magnitude past today):
--   * no index          → Parallel Seq Scan, 12.181 ms actual
--   * (user_id)         → Bitmap Heap Scan,   0.046 ms actual, index 2032 kB
--   * (user_id, status) → IDENTICAL plan and cost (4.50..42.58), 0.040 ms,
--                         index 2392 kB (+18%)
-- The composite's EXPLAIN output is the proof of the argument above: its
-- `Recheck Cond` carries ONLY `user_id`, and `status <> 'archived'` stays down
-- in `Filter` — Postgres declines to use the second column as a search key,
-- exactly as a `<>` predicate implies. Same plan, more bytes, more write cost.
-- Single-column wins on evidence, not taste.
--
--
-- (d) ⚠️ LOCKING — `CONCURRENTLY` CONSIDERED AND UNAVAILABLE. WHY THE PLAIN
--     `CREATE INDEX` IS ACCEPTABLE HERE.
-- -------------------------------------------------------------------------
-- Merging `supabase/migrations/**` to `main` AUTO-APPLIES to PRODUCTION, so the
-- lock this statement takes is a production event and is reasoned about, not
-- assumed.
--
--   * `CREATE INDEX CONCURRENTLY` CANNOT be used. Supabase applies each
--     migration inside a transaction block, and CONCURRENTLY is prohibited
--     inside one (25001). This is the same constraint 20260510173005:75-82
--     documents for `strategy_verifications`, and the same conclusion.
--   * The plain `CREATE INDEX` below takes a SHARE lock on `public.strategies`
--     for the duration of the build. Concurrent READS are unaffected; concurrent
--     WRITES (INSERT/UPDATE/DELETE) block until it completes.
--   * MEASURED TABLE SIZE: `public.strategies` holds **46 rows** in PRODUCTION
--     (khslejtfbuezsmvmtsdn, read-only count via PostgREST `Prefer: count=exact`,
--     2026-08-08). The build is sub-millisecond at that size. This is ~2,000×
--     under the ~100k threshold at which 20260510173005:75-82 says CONCURRENTLY
--     would start to matter, and the same order of magnitude as the 20-row
--     `strategy_verifications` precedent that shipped a plain transactional
--     index (.planning/STATE.md:873).
--   * The only write path that could contend is a strategy INSERT from the
--     onboarding wizard. A sub-millisecond block on it is not a user-visible
--     event, and there is no long-running batch writer against this table.
--
-- VERDICT: the brief SHARE lock is acceptable. If `strategies` ever approaches
-- ~100k rows, a FUTURE index on this table must be split into a standalone
-- non-transactional migration using CONCURRENTLY — do not copy this file's
-- shape blindly at that size.
--
--
-- (e) ROLLBACK.
-- -------------
-- Dropping the index is safe and lossless — it changes plans, never rows:
--   DROP INDEX IF EXISTS public.idx_strategies_user_id;
-- Recorded inline rather than as a `down/` file, matching the convention of
-- 20260408113028:215 (the `down/` directory has carried nothing since
-- 20260714090000).

BEGIN;

-- IF NOT EXISTS so a re-apply (or a hand-apply to TEST that later replays here)
-- is a no-op rather than a 42P07 abort. The name is NEW — it is not reused from
-- any dropped index, which would make IF NOT EXISTS a silent no-op against a
-- stale definition (the 20260726000225 lesson).
CREATE INDEX IF NOT EXISTS idx_strategies_user_id
  ON public.strategies (user_id);

COMMENT ON INDEX public.idx_strategies_user_id IS
  'Phase 151 review F3. Owner-scoped reads (getOwnCapitalStrategies, hasAnyOwnStrategies, the composite-members / trades-upload / wizard owner guards) all filter strategies.user_id with an equality and had NO usable index: strategies_user_wizard_session_source_uniq leads on user_id but is PARTIAL on wizard_session_id IS NOT NULL, which no owner-scoped read can satisfy, so every one of them sequentially scanned the whole catalog. Deliberately single-column: the callers pair user_id with status <> ''archived'', and <> is not an indexable btree search key, so a trailing status column would narrow nothing and no caller selects only (user_id, status) so it cannot serve an index-only scan either.';

-- Self-verify (the 20260728120000:340 idiom): assert the index EXISTS, is VALID,
-- and covers exactly {user_id}. Asserting the column LIST — not just the name —
-- is what stops a pre-existing index of the same name with a different
-- definition from letting `IF NOT EXISTS` pass silently.
DO $$
DECLARE
  v_cols  TEXT[];
  v_valid BOOLEAN;
BEGIN
  SELECT array_agg(a.attname ORDER BY k.ord), bool_and(i.indisvalid)
    INTO v_cols, v_valid
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'idx_strategies_user_id';

  IF v_cols IS DISTINCT FROM ARRAY['user_id']::TEXT[] THEN
    RAISE EXCEPTION
      'F3: idx_strategies_user_id covers %, expected {user_id}', v_cols;
  END IF;
  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'F3: idx_strategies_user_id is not a VALID index';
  END IF;

  -- It must NOT be partial. A predicate would silently exclude rows from every
  -- owner-scoped read's plan and reintroduce the seq scan this migration exists
  -- to remove — the exact failure mode that makes
  -- strategies_user_wizard_session_source_uniq unusable here.
  -- Schema-qualified like the column check above: an index of this name in
  -- ANOTHER schema must not answer for the one in `public`.
  IF EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c     ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_strategies_user_id'
       AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'F3: idx_strategies_user_id must be a FULL index, not partial';
  END IF;
END $$;

COMMIT;
