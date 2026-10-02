# Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL - Pattern Map

**Mapped:** 2026-08-02
**Files analyzed:** 10 (4 created, 5 modified, 1 deleted)
**Analogs found:** 8 exact-or-role-match / 10
**Branch:** `feat/v1.16-141-jobs-rate-retry`

> Every excerpt below is a direct read at the cited `file:line` on this branch. Where the expected
> file set handed to this mapper was wrong, the correction is called out inline under
> **⚠️ CORRECTION** and repeated in §Corrections to the Expected File Set.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20260802HHMMSS_strategy_analytics_stuck_computing_reaper.sql` | migration (DDL + data + cron + fn) | batch / scheduled | `20260719120000_retention_orphaned_running_compute_jobs.sql` (+3 secondaries) | **exact** (composite) |
| `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | test (SQL gate) | batch | `supabase/tests/test_retention_orphaned_running.sql` + `test_sync_status_supersede_failed_per_kind.sql` | **exact** (composite) |
| `analytics-service/tests/test_computing_started_at_stamp.py` | test (static/AST, two-runtime) | transform | `tests/test_verify_strategy_no_legacy_writes.py` + `tests/test_migration_132.py` | role-match |
| `analytics-service/tests/test_job07_reaper_off_worker_loop.py` | test (structural + e2e probe) | event-driven | `tests/test_worker_isolation_e2e.py:113-206` + `tests/test_dark_path_deleted.py` | **exact** (composite) |
| `analytics-service/services/analytics_runner.py:1226-1232` | service (writer) | CRUD upsert | `analytics_runner.py:1269-1281` (`_mark_failed`, same function) | **exact** |
| `analytics-service/tests/test_main_worker.py` (append ~:1085) | test (threshold invariant) | transform | `test_main_worker.py:994-1084` `TestWatchdogInvariant` | **exact** |
| `analytics-service/services/job_worker.py` (~:492) — chain-topology constant | config (module constant) | — | `job_worker.py:476-492` `TIMEOUT_PER_KIND` / `main_worker.py:121-124` `BACKFILL_KINDS` | role-match |
| `src/lib/types.ts:288-329` | model (hand-maintained row type) | — | *(no recent analog — see §No Analog Found)* | **none** |
| `src/app/api/keys/sync/route.ts:41-59` | doc-comment (live invariant census) | — | the comment itself (self-analog) | exact |
| `analytics-service/scripts/reset_stuck_computing_rows.py` **(DELETE)** | script | — | `test_dark_path_deleted.py:157-165` (deleted-file-stays-absent gate) | role-match |

---

## Pattern Assignments

### 1. `supabase/migrations/<ts>_strategy_analytics_stuck_computing_reaper.sql` (migration, scheduled batch)

This file is a **composite of four analogs**. Assemble in this order (research §Migration Shape):
prose header → `BEGIN; SET lock_timeout` → DDL → backfill → index → `CREATE OR REPLACE FUNCTION` →
`cron.schedule` → self-verify `DO` → `COMMIT;`.

#### 1a. Filename timestamp convention — SETTLED

Newest 6 filenames on disk (`ls supabase/migrations | tail -6`):

```
20260719140000_get_published_trust_signals.sql
20260720120000_retention_orphaned_running_window_4h.sql
20260723172032_mt5_exchange_boundary_checks.sql
20260726000225_strategy_verifications_tenant_scope_uniq.sql
20260728120000_csv_finalize_double_submit_idempotency.sql
```

Convention: `YYYYMMDDHHMMSS_snake_name.sql`, 14 digits. **Repo tip is `20260728120000`** — the new
file MUST sort strictly after it (`20260802HHMMSS_…`) or `.github/workflows/migration-policy.yml`
blocks the PR. Note the mixed style in the tail: hand-authored migrations use round times
(`120000`, `140000`), MCP/CLI-generated ones use real clock times (`172032`, `000225`). Either is
accepted; pick a round `20260802120000`-style stamp to match the pg_cron family.

**`down/` rollback file: NOT required.** `ls supabase/migrations/down/` shows the newest rollback is
`20260714090000-rollback.sql`; neither `20260719120000`, `20260720120000` nor `20260728120000` has
one. Do not invent one for consistency's sake.

#### 1b. Prose header + `BEGIN`/`lock_timeout` + fail-loud pg_cron gate + idempotency

**Analog:** `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql`

Header shape (lines 1-56) — sectioned prose with cited `file:line` evidence. The section headings to
mirror verbatim: `Why this migration exists`, `<Number> rationale (why N is prod-safe)`,
`Safety backstop`, `Scope discipline`, `Idempotency`. Excerpt (`:20-27`) showing how the *number* is
justified — this is the shape the JOB-03 threshold rationale must take:

```sql
-- Window rationale (why 2 hours is prod-safe)
-- -------------------------------------------
-- analytics-service/main_worker.py WATCHDOG_PER_KIND_OVERRIDES (line 206) caps
-- the max per-kind stale threshold at process_key_long = 40 minutes. On prod
-- ...
-- the 2h window carries a ~3x margin over the 40-minute max threshold.
```

Transaction + fail-loud + idempotent schedule (`:57-107`) — copy this block structure exactly:

```sql
BEGIN;
SET lock_timeout = '5s';

DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'WORKER-04: pg_cron extension is NOT installed. The orphaned-running purge cron cannot be scheduled. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '15 4 * * *',
    $cron$
    DELETE FROM public.compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '2 hours';
    $cron$
  );

  RAISE NOTICE 'WORKER-04: retention_compute_jobs_orphaned_running scheduled (daily 04:15 UTC, 2h window).';
END $$;
```

Note four load-bearing details: (1) the `RAISE EXCEPTION` format string is **one literal, no `||`**
(migration-reviewer #21); (2) the cron body is a `$cron$…$cron$` fixed literal with **no
interpolation** and **schema-qualified** `public.<table>`; (3) `PERFORM cron.schedule(...)` inside a
`DO`, never a bare `SELECT cron.schedule`; (4) a closing `RAISE NOTICE`.

**Second, separate self-verify `DO` block** (`:114-135`) — re-reads the deployed command and RAISEs
per expected shape. The 4h migration (`20260720120000:95-97`) adds the pattern this phase needs for
the threshold anchor — a **negative** assertion that the wrong value is gone:

```sql
DO $$
DECLARE
  v_command TEXT;
BEGIN
  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: retention_compute_jobs_orphaned_running cron job missing after schedule';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: purge body does not scope to status = ''running''';
  END IF;
  IF v_command NOT ILIKE '%interval ''4 hours''%' THEN         -- positive anchor
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body does not use the corrected 4-hour window';
  END IF;
  IF v_command ILIKE '%interval ''2 hours''%' THEN             -- NEGATIVE anchor
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body still carries the old 2-hour window';
  END IF;
  IF v_command NOT ILIKE '%public.compute_jobs%' THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: purge body is not schema-qualified to public.compute_jobs';
  END IF;

  RAISE NOTICE 'WORKER-04: retention_compute_jobs_orphaned_running self-verify passed (predicate pinned).';
END $$;

COMMIT;
```

⚠️ **Deviation to pre-document in the header:** `migration-reviewer.md:92-94` (invariant #14)
forbids `BEGIN`/`COMMIT`. Both analogs above use them, as does the repo tip. CONTEXT.md resolved this
in favour of the repo. State that in the header so review does not re-litigate. `ROLLBACK` must still
never appear outside `supabase/tests/`.

#### 1c. Additive nullable column + backfill, in one migration

**Primary analog (column shape):** `supabase/migrations/20260710120000_strategy_keys.sql:131-145`

```sql
-- 5. COMP-04 stub: additive NULLABLE per-basis metrics column on strategy_analytics.
--    No DEFAULT, no backfill, NO SET NOT NULL (a 23502 timebomb on existing rows).
--    NULL for every existing row; Phase 86 populates it at derive time.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS metrics_json_by_basis jsonb;

COMMENT ON COLUMN public.strategy_analytics.metrics_json_by_basis IS
  'NULLABLE stub for COMP-04 (Phase 86): per-basis metrics object keyed '
  'cash_settlement / mark_to_market. NULL for all existing rows (no backfill). '
  'Populated at derive time in Phase 86.';
```

Copy: `ADD COLUMN IF NOT EXISTS`, `public.`-qualified, no DEFAULT, no `SET NOT NULL`, and a
`COMMENT ON COLUMN` that states the NULL semantics. For `computing_started_at` the comment must say
**NULL = "not currently computing"** and that `computed_at` is *not* a substitute (C-1/C-2).

**Primary analog (column + same-file backfill):** `20260708120000_sync_status_failed_final_bounce.sql:52-63`
— the only in-repo precedent for `ALTER TABLE … ADD COLUMN` followed immediately by a scoped backfill
`UPDATE`, in the same transaction, ahead of the function replace:

```sql
-- Runner-owned PERSISTED warned marker. Its OWN column so a compute_jobs-derived
-- branch (b) 'failed' write over computation_status cannot destroy the warning.
-- ... Backfill existing warned rows so an already-warned strategy is
-- protected immediately (the preserve migration ensured such rows can now exist).
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computation_warned BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.strategy_analytics
   SET computation_warned = TRUE
 WHERE computation_status = 'complete_with_warnings'
   AND computation_warned IS DISTINCT FROM TRUE;
```

Note the `IS DISTINCT FROM` idempotency guard on the backfill's `WHERE` — re-apply is a no-op. The
`computing_started_at` backfill should mirror it:
`WHERE computation_status = 'computing' AND computing_started_at IS NULL`.

#### 1d. Index (the CONCURRENTLY trap)

`CREATE INDEX CONCURRENTLY` **cannot** sit inside the `BEGIN…COMMIT` (migration-reviewer #5). The
in-repo split precedent is `20260516170400_portfolio_analytics_computing_idx_concurrently.sql`, but
research recommends a **plain non-concurrent partial `CREATE INDEX` inside the transaction** here —
one row per strategy, tiny partial predicate. If the planner chooses CONCURRENTLY it must live
outside the transaction block; migration-reviewer #18 (DROP+CONCURRENTLY blind window) does **not**
apply since nothing is dropped.

#### 1e. `CREATE OR REPLACE` re-basing discipline — the highest-risk edit

**Analog:** `supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql` (the LATEST
definition — re-base on THIS, not on `20260708120000`).

The header states the re-base contract explicitly (`:45-51`) — reproduce this paragraph shape:

```sql
-- Re-based verbatim on the SOLE live CREATE OR REPLACE of this function
-- (20260708120000_sync_status_failed_final_bounce.sql / mig-038) — verified via
-- grep across ALL migrations that every later migration only CALLS it. Branches
-- (a), (c), (d), the SECURITY DEFINER posture, search_path, and REVOKE are
-- byte-identical to that definition — INCLUDING both `OR strategy_analytics.
-- computation_warned` marker reads in branches (a)/(c) (dropping either re-opens
-- the SI-02 failed_final-bounce launder). ONLY branch (b) diverges.
```

Elements that MUST survive the replace byte-for-byte (`20260710150000`):
- the signature + posture (`:71-76`): `SECURITY DEFINER` / `SET search_path = public, pg_catalog`
- branch (b)'s per-kind `NOT EXISTS` supersession (`:144-181`)
- the `OR strategy_analytics.computation_warned` reads in branches (a) **and** (c) (`:119-120`, `:193-194`)
- `COMMENT ON FUNCTION` (`:203-204`) — must **gain** a `computing_started_at` clause
- `REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;` (`:206`)
- the self-verify `DO` block (`:211-283`)

The **only** line that changes is branch (a)'s `ON CONFLICT DO UPDATE` (`:117-125`), which today is:

```sql
  IF v_nonterminal_count > 0 THEN
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();          -- ⚠️ THIS is why computed_at is the wrong key
    RETURN;
  END IF;
```

⚠️ **The C-3 trap.** A new `computing_started_at = now()` line here is *unconditional* and resets the
stamp on every hop. The stamp expression must be a `CASE` keyed off the **resolved** status (which
can be `complete_with_warnings`, per the `CASE` above) **and** the prior status — see CONTEXT.md's
preferred form. Also note branches (b) `:174-179` and (c) `:189-199` are the two SQL **exit**
transitions and must set `computing_started_at = NULL`.

**Self-verify pattern for a function body** (`20260710150000:211-251`) — this is precisely the
mechanism the JOB-01 SQL half needs:

```sql
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_search_path TEXT;
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  ...
  -- THIS migration's fail-without-fix anchors:
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'supersede-failed migration failed: branch (b) does not scope supersession per-kind (d.kind = f.kind missing)';
  END IF;
  ...
  -- The marker column must exist (the bridge reads it).
  IF NOT EXISTS(
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.strategy_analytics'::regclass
       AND attname = 'computation_warned'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'supersede-failed migration failed: strategy_analytics.computation_warned column missing';
  END IF;
END
$$;
```

The `pg_attribute` existence check (`:254-261`) is the exact template for asserting
`computing_started_at` exists; extend it with `atttypid = 'timestamptz'::regtype`, `attnotnull = FALSE`,
and `atthasdef = FALSE` for the JOB-01 shape assertions.

#### 1f. Reap-UPDATE `SET` list — carry these three columns

**Analog (semantics):** `analytics-service/services/job_worker.py:1890-1905`, the canonical terminal-
`failed` writer. The reaper's SQL `SET` list must be the SQL translation of it plus the stamp clear:

```python
ctx.supabase.table("strategy_analytics").upsert(
    {
        "strategy_id": strategy_id,
        "computation_status": "failed",
        # SI-02 (MEDIUM-2): clear the runner-owned warned marker on
        # every terminal 'failed' so the status bridge (branches a/c)
        # cannot resurrect a stale complete_with_warnings.
        "computation_warned": False,
        "computation_error": (...),
    },
    on_conflict="strategy_id",
).execute()
```

⇒ `SET computation_status='failed', computation_warned=FALSE, computation_error='<literal>',
computing_started_at=NULL` — **four** columns. Research P-4: "Warning sign: the reaper's `SET` list
has two columns."

Also preserve the one-off script's compare-and-set fence (`reset_stuck_computing_rows.py:102`,
`.eq("computation_status","computing")`) as `AND computation_status = 'computing'` in the outer
`UPDATE … WHERE`, not only in the inner `LIMIT` subselect.

---

### 2. `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` (test, SQL gate)

**Composite of two analogs.** pgTAP is NOT installed — plain PL/pgSQL `DO` + `RAISE EXCEPTION` under
`psql -v ON_ERROR_STOP=1`. CI auto-discovers by glob (`.github/workflows/ci.yml:960-963`:
`files=(supabase/tests/test_*.sql)`) — **no workflow edit needed**. The preflight
(`ci.yml:891-935`) rejects `\!`, `\copy`, `\COPY`, `\o` — no psql meta-commands.

#### 2a. Cron-body oracle + seeding + directional four-arm seed

**Analog:** `supabase/tests/test_retention_orphaned_running.sql`

Header contract (`:38-52`) — state the oracle discipline, the pgTAP absence, and the usage line:

```sql
-- Oracle discipline: the behavioral section EXECUTEs the REAL deployed
-- cron.job.command (not a re-typed copy of the predicate) so the test pins the
-- shipped body, not the test author's transcription of it.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_retention_orphaned_running.sql
```

The oracle itself (`:156-164`) — **reproduce exactly**:

```sql
  -- ----- ASSERTION 3: EXECUTE the DEPLOYED cron body (the oracle) --------
  -- Run the REAL stored command, not a re-typed predicate.
  EXECUTE v_command;

  SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_a;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): orphaned >4h running row survived the purge (count=%), expected 0', row_cnt;
  END IF;
```

Four-arm directional seed (`:60-68` declarations, `:135-152` inserts) — the template for SC#2's
falsification pair. Note the one-line-per-arm comment naming the expected outcome:

```sql
  key_a        UUID;  -- orphaned running (5h old) — MUST be deleted
  key_b        UUID;  -- fresh running (now)       — MUST survive
  key_c        UUID;  -- non-running done (5h old) — MUST survive
  key_d        UUID;  -- RT-01: running 3h old     — MUST survive (batch-tail)
```

Map to this phase: (a) old `computing_started_at`, **fresh `computed_at`** → MUST reap; (b) fresh
`computing_started_at`, **old `computed_at`** → MUST survive; (c) `computing` + an active
`compute_jobs` row → MUST survive; (d) `computing` + NULL stamp → MUST survive; (e) an N+1th
stranded row proving the `LIMIT` bound.

⚠️ **P-10 — do NOT copy assertion 2** (`:107-114`):

```sql
  SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
```

With a `*/15 * * * *` schedule the hour field is `*` and the `::INT` cast errors. Assert the schedule
string equals the expected cron expression instead.

#### 2b. ⚠️ The green-skip trap — this file must NOT green-skip

`test_retention_orphaned_running.sql:71-83` has **two presence gates that `RETURN` on absence**:

```sql
  -- ----- PRESENCE GATE 1: pg_cron extension (local dev) ------------------
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP: pg_cron extension not installed here (local dev). Assertions enforce where pg_cron is present.';
    RETURN;
  END IF;

  -- ----- PRESENCE GATE 2: cron job registered (test-DB lag) --------------
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260719120000 not yet applied here ... Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;
```

**Under those gates the whole file is a no-op and CI is green.** VALIDATION.md flags this as a trap.
The counter-analog is `supabase/tests/test_sync_status_supersede_failed_per_kind.sql`, which has **no
presence gate at all** — its Part 1 `pg_get_functiondef(...)` structural block simply reddens when the
migration isn't applied (its header at `:42-44` says exactly that: *"Expected pre-migration state (the
TDD RED proof): Part 1 FAILS … and ON_ERROR_STOP aborts the whole file there"*).

**Recommended shape for this phase:** split the file into an **ungated structural part** (column
existence + `pg_get_functiondef` anchors on the bridge — these need no pg_cron and MUST redden if
unapplied) and a **cron-gated behavioural part** (gated only on `pg_extension`, never on
`cron.job` presence — or, if the cron gate is kept, make the structural part assert the job is
registered so absence is a failure, not a skip).

#### 2c. `strategy_analytics` FK seed + drive the real RPC

**Analog:** `supabase/tests/test_sync_status_supersede_failed_per_kind.sql:98-149`. The FK chain is
`auth.users → profiles → strategies → strategy_analytics` (shorter than the retention test's
`api_keys` chain), each part wrapped in its own `BEGIN;…ROLLBACK;`:

```sql
BEGIN;
DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_strat      uuid;
  ...
BEGIN
  -- FK chain: compute_jobs/strategy_analytics.strategy_id -> strategies.id ->
  -- profiles.id -> auth.users.id.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-supersede-poison-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-supersede-poison') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-supersede-poison-strat') RETURNING id INTO v_strat;

  INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_warned)
    VALUES (v_strat, 'failed', FALSE);
  ...
  -- Drive the REAL RPC: flip running→done, then in-RPC bridge.
  PERFORM public.mark_compute_job_done(v_job_new, v_token_new);

  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'supersede-failed: ... computation_status = % (expected complete; F-3 re-opened)', v_status;
  END IF;
END $$;
ROLLBACK;
```

⭐ Its header (`:25-32`) carries the lesson that decides the JOB-01 SC-2b test: **drive the real
`mark_compute_job_done` RPC, not `sync_strategy_analytics_status` directly** —

```sql
-- Parts 2-4 drive the REAL worker RPCs mark_compute_job_done /
-- mark_compute_job_failed, not the isolated bridge. An earlier convention seeded
-- jobs already-'done' and called sync_strategy_analytics_status directly; that is
-- a vacuum — it never reproduces the worker running→done flip + in-RPC bridge and
-- stays green while production launders.
```

That is exactly how to build the "a second bridge call on an already-`computing` row does NOT advance
the stamp" test: two sequential real RPC transitions, capture `computing_started_at` after each,
assert equality.

Structural anchors on the deployed function body (`:53-86`) — regex form, one literal per RAISE:

```sql
DO $$
DECLARE
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'supersede-failed: branch (b) does not scope supersession per-kind (d.kind = f.kind missing — cross-kind failures could be masked)';
  END IF;
  IF v_fn ~* 'data_quality_flags' THEN
    RAISE EXCEPTION 'supersede-failed: bridge reads data_quality_flags (policy fork ...)';
  END IF;
  IF v_fn !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'supersede-failed: function lost SECURITY DEFINER';
  END IF;
END $$;
```

Note both a **positive** anchor (`!~*` must-contain) and a **negative** anchor (`~*` must-not-contain)
— the negative form is how JOB-01's "no unconditional stamp" and JOB-02's "the cron body must never
mention `computed_at`" (research P-1) get pinned.

#### 2d. ⚠️ Do NOT register the new cron in `test_retention_crons_safe.sql`

`supabase/tests/test_retention_crons_safe.sql:92-98` holds an `expected_jobs TEXT[]` array and asserts
at `:112` that **every** listed body matches `ILIKE '%where%created_at%'`. The new reaper's body must
never reference `created_at`/`computed_at` (research P-1), so adding it there would be an
own-goal. Note `retention_compute_jobs_orphaned_running` is *also* absent from that array — precedent
exists for leaving a new cron out.

---

### 3. `analytics-service/tests/test_computing_started_at_stamp.py` (test, static/AST, two runtimes)

**Analog A (Python half — AST walk of a supabase call chain):**
`analytics-service/tests/test_verify_strategy_no_legacy_writes.py:34-98`

```python
_ROUTER_PATH = (
    pathlib.Path(__file__).resolve().parents[1] / "routers" / "portfolio.py"
)

def _verify_strategy_source() -> str:
    """Static-AST extraction so the regression is scoped to this endpoint
    rather than the whole file — other endpoints (or comments / docstrings
    elsewhere in the file) are free to mention ``verification_requests``."""
    tree = ast.parse(_ROUTER_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name == "verify_strategy":
                return ast.get_source_segment(_ROUTER_PATH.read_text(encoding="utf-8"), node) or ""
    raise AssertionError("verify_strategy function not found in routers/portfolio.py")

def test_verify_strategy_does_not_call_supabase_table_verification_requests() -> None:
    src = _verify_strategy_source()
    tree = ast.parse(src)
    forbidden_calls: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        cursor: ast.expr = node.func
        while isinstance(cursor, ast.Attribute):
            cursor = cursor.value
        if not isinstance(cursor, ast.Call):
            continue
        if not (isinstance(cursor.func, ast.Attribute) and cursor.func.attr == "table"):
            continue
        if len(cursor.args) != 1 or not isinstance(cursor.args[0], ast.Constant):
            continue
        if cursor.args[0].value == "verification_requests":
            forbidden_calls.append(f"line ~{node.lineno}: supabase.table('verification_requests').<...>")
    assert not forbidden_calls, ("... Found:\n  " + "\n  ".join(forbidden_calls))
```

This is the exact chain-unwind the JOB-01 Python gate needs — it already resolves
`supabase.table("<name>").<op>(...)` to the table literal. Extend it to inspect the `.upsert(...)`
first positional `ast.Dict` and require: if any key is `"computation_status"` with value
`"computing"`, then the **same dict** must carry `"computing_started_at"`. Scan the whole of
`analytics-service/` (not just `analytics_runner.py`), per research P-11's whole-repo rule.

**Analog B (SQL half from Python — read the migration source and pin a constant):**
`analytics-service/tests/test_migration_132.py:20-73`

```python
from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID

_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase" / "migrations" / "20260515095804_teaser_anchor_strategy.sql"
)

def _read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")

def test_migration_132_exists() -> None:
    """The migration file is on disk. Catches misnamed-slot regressions
    (a rebase that drops the file silently ...)."""
    assert _MIGRATION_PATH.is_file(), f"Migration 132 missing at {_MIGRATION_PATH}"

def test_migration_132_seeds_sentinel_auth_users_row() -> None:
    src = _read(_MIGRATION_PATH)
    assert re.search(r"INSERT\s+INTO\s+auth\.users\s*\([^)]*\)\s*VALUES", src, flags=re.IGNORECASE), ...
```

Note `parents[2]` — from `analytics-service/tests/` that is the repo root. This is the analog for the
**JOB-03 SQL↔Python drift gate**: import the canonical Python threshold constant, render it as the
Postgres interval literal, and assert it appears in the new migration's text. ⚠️ Oracle caveat for
VALIDATION.md's checklist: this *deliberately* imports a constant from the module it pins. That is
correct for a drift gate (the Python side is declared canonical), but the planner must note it
explicitly under "Oracle Independence → deliberate exceptions", and the *value-correctness* oracle
(headroom, sane upper bound) must stay literal-pinned and separate.

**Analog C (whole-repo two-language grep hygiene):** `analytics-service/tests/test_dark_path_deleted.py:37-68`

```python
def _repo_root() -> Path:
    """The monorepo root — the first ancestor containing BOTH ``src/`` and
    ``analytics-service/``. Resolved by walking up so the scan works from the
    ``analytics-service`` pytest cwd and in CI."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "src").is_dir() and (parent / "analytics-service").is_dir():
            return parent
    raise RuntimeError("could not locate the repo root ...")

def _strip_comment(line: str, *, lang: str) -> bool:
    """True when ``line`` is a pure comment for its language (grep-gate
    hygiene: a docstring/comment mentioning a token must neither trip nor
    satisfy the gate)."""
    stripped = line.lstrip()
    if lang == "py":
        return stripped.startswith("#")
    return stripped.startswith("//") or stripped.startswith("*")
```

Use `_repo_root()` (not `parents[2]`) if the gate needs to reach both `src/` and `supabase/`, and
`_strip_comment` so a comment mentioning `computing_started_at` neither trips nor satisfies the gate.

---

### 4. `analytics-service/tests/test_job07_reaper_off_worker_loop.py` (test, structural + e2e probe)

**Analog A (behavioural half + positive control):** `analytics-service/tests/test_worker_isolation_e2e.py`

Reusable helpers to import or copy — all in that file, all stdlib:

| Helper | Line | Purpose |
|--------|------|---------|
| `_free_ephemeral_port()` | `:48` | bind port 0, read assignment, release |
| `_wait_port_listening(port)` | `:62` | poll-connect until `serve_forever` |
| `_probe_healthz(port)` | `:80` | raw `GET /healthz HTTP/1.1` over TCP, 5s read guard |
| `_empty_claim_supabase()` | `:102` | MagicMock claim RPC returning `data=[]` |

The positive case (`:118-179`) — note the `monkeypatch` of `_HEARTBEAT_INTERVAL_S`, the real server
task, the mid-dispatch probe, and the `assert not dt.done()` that proves the probe landed *during*
the dispatch:

```python
    @pytest.mark.asyncio
    async def test_healthz_stays_200_through_long_backfill(self, monkeypatch) -> None:
        monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", 0.02)
        port = _free_ephemeral_port()
        monkeypatch.setenv("PORT", str(port))
        ...
        _saved_tick = main_worker_healthz.LAST_TICK_AT
        server_task = asyncio.create_task(main_worker_healthz.start_healthz_server())
        try:
            await _wait_port_listening(port)
            with patch("main_worker.get_supabase", return_value=mock_supabase), \
                 patch("main_worker.dispatch", new=_slow_dispatch):
                dt = asyncio.create_task(dispatch_tick("worker-hz-alive"))
                await started.wait()
                start_stamp = main_worker_healthz.LAST_TICK_AT
                await asyncio.sleep(0.05)
                mid_dispatch_resp = await _probe_healthz(port)
                assert not dt.done(), (
                    "probe must be captured WHILE the slow dispatch is in flight"
                )
                await dt
            assert b"200 OK" in mid_dispatch_resp, mid_dispatch_resp[:120]
            assert main_worker_healthz.LAST_TICK_AT > start_stamp, (...)
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass
            main_worker_healthz.LAST_TICK_AT = _saved_tick
```

The control (`:181-206`) — **this is what makes the 200 falsifiable**:

```python
    @pytest.mark.asyncio
    async def test_healthz_503_when_tick_stale(self, monkeypatch) -> None:
        """With LAST_TICK_AT forced past STALE_THRESHOLD and NO dispatch running,
        the same real-socket probe returns "503 Service Unavailable" — proving
        the probe exercises the staleness contract against the deployed server
        code, not a stub that always answers 200."""
        ...
            main_worker_healthz.LAST_TICK_AT = time.time() - (
                main_worker_healthz.STALE_THRESHOLD + 10
            )
            resp = await _probe_healthz(port)
            assert b"503 Service Unavailable" in resp, resp[:120]
            assert b'"status": "stale"' in resp
```

⚠️ Per CONTEXT.md, the control this phase needs is **stronger** than the analog's: the analog forces
`LAST_TICK_AT` directly. JOB-07 needs a control that injects a genuinely **loop-blocking synchronous**
reap (`time.sleep` / tight CPU loop, *not* an `await`) into the dispatch path and observes 503. That
proves the probe can detect the property under test, not merely that the server reads a stale stamp.
Also copy the file's honesty note (`test_worker_isolation_e2e.py:1-26` docstring; `main_worker.py:637-641`):
the heartbeat catches a loop-blocking freeze but **not** a yielding single-job hang — do not over-claim.

**Analog B (structural half, with the anti-vacuity positive control):**
`analytics-service/tests/test_dark_path_deleted.py`

The two-direction contract (docstring `:23-29`) — reproduce this framing verbatim in the new file:

```python
Two directions are enforced, so the gate can never quietly rot:
  * NEGATIVE — the retired tokens appear ZERO times across the live compute
    surface (both runtimes).
  * POSITIVE (SC-3) — the KEPT CSV/backbone path and its shared helpers are
    still present, proving the deletion was surgical and the gate is not
    merely over-broad (a gate that also nuked the live path would pass the
    negative asserts vacuously).
```

The scan surface (`:71-95`) is the exact set of modules "reachable from `dispatch_tick`" that JOB-07
must assert the reaper identifier is absent from:

```python
def _py_scan_files() -> list[Path]:
    """The live PYTHON compute surface: the runner + worker + cron entrypoints
    plus a full walk of ``routers/`` and ``scripts/``. Any re-entry into the
    dark path would land in one of these."""
    svc = _repo_root() / "analytics-service"
    files: list[Path] = [
        svc / "services" / "analytics_runner.py",
        svc / "services" / "job_worker.py",
        svc / "routers" / "cron.py",
        svc / "main_worker.py",
        svc / "main.py",
    ]
    for sub in ("routers", "scripts"):
        files.extend(sorted((svc / sub).rglob("*.py")))
    ...
```

Negative assert shape (`:103-118`) and the deleted-file gate (`:157-165`) — the latter is the analog
for pinning `scripts/reset_stuck_computing_rows.py` **stays** deleted:

```python
def test_deleted_dark_path_files_stay_absent() -> None:
    """The dark-path module files deleted in 106-07/08 stay deleted."""
    svc = _repo_root() / "analytics-service"
    for rel in ("routers/analytics.py", "scripts/phase12_backfill_enqueue.py"):
        assert not (svc / rel).exists(), (
            f"dark path re-entry survived deletion: {rel} was recreated — ..."
        )
```

**Analog C (AST, not grep, for a "zero constructions" gate):** `tests/test_limiter_identity.py:498-521`
— use this shape if the JOB-07 gate should be AST-based rather than token-count-based:

```python
    def test_no_router_constructs_its_own_limiter(self) -> None:
        """Zero private ``Limiter()`` instances — by AST, not by grep."""
        import ast
        constructions: list[str] = []
        for p in sorted(ROUTERS_DIR.glob("*.py")):
            for node in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = (func.id if isinstance(func, ast.Name)
                        else func.attr if isinstance(func, ast.Attribute) else None)
                if name == "Limiter":
                    constructions.append(f"{p.name}:{node.lineno}")
        assert constructions == [], (
            f"private Limiter() construction(s) reintroduced: {constructions}"
        )
```

---

### 5. `analytics-service/services/analytics_runner.py:1226-1232` (service, CRUD upsert)

**Analog: the sibling writer 43 lines below, in the same function** (`:1269-1281`). Copy its comment
discipline (an inline tag naming the invariant) into the stamp:

```python
    # Mark computing.
    def _mark_computing() -> None:
        supabase.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, "computation_status": "computing"},
            on_conflict="strategy_id",
        ).execute()
    await db_execute(_mark_computing)
```

vs. the exit writer, which shows the SI-02 comment convention to mirror:

```python
            def _mark_failed() -> None:
                supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                        "computation_warned": False,
                        "computation_error": "Insufficient CSV history. At least 2 data points required.",
                        "data_quality_flags": {"csv_source": True},
                    },
                    on_conflict="strategy_id",
                ).execute()
            await db_execute(_mark_failed)
```

Three pattern rules this analog establishes:
1. Every write is a **sync closure passed to `await db_execute(...)`** — never a bare `await` on the
   supabase client.
2. Multi-key payloads use the exploded-dict form with a tagged comment above the invariant-bearing key.
3. Timestamps must be **client-side** — PostgREST cannot express SQL `now()` in a payload
   (research §Don't Hand-Roll). Use `datetime.now(timezone.utc).isoformat()`.

⚠️ **Partial upserts that must NOT be swept.** `job_worker.py:1702`, `:4875`, `analytics_runner.py:1555`
upsert `{strategy_id, data_quality_flags…}` only. PostgREST merge-duplicates writes only supplied
columns, so they do not disturb the stamp — a naive "add the stamp everywhere" edit breaks them.

---

### 6. `analytics-service/tests/test_main_worker.py` — JOB-03 threshold invariants (append after `:1084`)

**Analog:** `test_main_worker.py:994-1084`, `class TestWatchdogInvariant`. Mirror all three shapes.

Class docstring states the *consequence*, not the mechanic (`:994-998`):

```python
class TestWatchdogInvariant:
    """The watchdog reset threshold for every kind MUST exceed that kind's
    handler timeout. If it doesn't, the watchdog reclaims still-running jobs,
    they retry forever, and any caller polling for terminal status (e.g. the
    Strategy Wizard) hangs without ever seeing 'failed' or 'complete'."""
```

The headroom invariant JOB-03 names (`:1020-1051`) — note it iterates the **source of truth** map and
declares the default as a **local literal**, not an import:

```python
    def test_every_kind_has_watchdog_headroom(self) -> None:
        """The override-only test above missed kinds that fall through to
        the global default. ... This test iterates TIMEOUT_PER_KIND (source of truth)
        and asserts every kind has watchdog headroom, including ones
        that take the default."""
        from main_worker import WATCHDOG_PER_KIND_OVERRIDES
        from services.job_worker import TIMEOUT_PER_KIND

        # Mirror of main_worker.watchdog_tick `p_stale_threshold` default.
        # Keep in lock-step with that literal ...
        DEFAULT_WATCHDOG_INTERVAL = "10 minutes"

        for kind, handler_seconds in TIMEOUT_PER_KIND.items():
            override = WATCHDOG_PER_KIND_OVERRIDES.get(kind)
            watchdog_seconds = _watchdog_seconds(override or DEFAULT_WATCHDOG_INTERVAL)
            assert watchdog_seconds > handler_seconds, (
                f"Kind {kind!r}: handler timeout {handler_seconds:.0f}s "
                f"exceeds watchdog threshold {watchdog_seconds:.0f}s. ..."
            )
```

The sane-upper-bound typo-catcher (`:1053-1084`) — copy the `MAX_RATIO` framing and the "if the large
window is intentional, raise MAX_RATIO and document why" escape hatch:

```python
    def test_watchdog_threshold_has_sane_upper_bound(self) -> None:
        """H-0777: ... a maintainer typo — e.g. `"60 minutes"` intended as
        `"60 seconds"` — produces an absurdly large watchdog window. ...
        Observed ratios across all current overrides are 1.17x–2.0x of the
        handler timeout. Cap at 4x ... A deliberate larger window must update
        this bound (and justify why ...), which is the point — make the
        decision explicit instead of letting a typo through silently."""
        MAX_RATIO = 4.0
        for kind, watchdog_str in WATCHDOG_PER_KIND_OVERRIDES.items():
            handler_seconds = TIMEOUT_PER_KIND[kind]
            ratio = _watchdog_seconds(watchdog_str) / handler_seconds
            assert ratio <= MAX_RATIO, (...)
```

Interval parsing helper to reuse — `_watchdog_seconds` at `:978-991` (module-level, above the class),
with `_INTERVAL_UNIT_SECONDS` at `:~970`. The reaper threshold is a Postgres interval literal too, so
this oracle already exists; **do not write a second one** (`test_job_worker_csv_kind.py:118-121`
already has a divergent local `_parse_minutes`, which is the drift to avoid, not to copy).

⚠️ **The one place NOT to mirror:** `test_every_kind_has_watchdog_headroom` derives its ceiling from
`TIMEOUT_PER_KIND` alone — that is the **per-job** quantity. JOB-03's oracle must compute a
**chain-inclusive** ceiling from the topology constant (item 7) plus `TIMEOUT_PER_KIND` plus the batch
tail. Per C-6 and P-8, `batch_size × max(TIMEOUT_PER_KIND)` is the `compute_jobs` formula and must not
be re-applied here.

**Second consumer, likely NO change needed:** `analytics-service/tests/test_job_worker_csv_kind.py:109-134`
re-asserts the watchdog headroom rule. It only breaks if `TIMEOUT_PER_KIND` or
`WATCHDOG_PER_KIND_OVERRIDES` changes — this phase changes neither.

---

### 7. Job-chain-topology constant — `analytics-service/services/job_worker.py` (~:492)

**⚠️ CORRECTION to the expected file set.** The prompt suggested `main_worker.py` "around 200-230".
That range is `WATCHDOG_PER_KIND_OVERRIDES` (`main_worker.py:206-242`), a *watchdog* map. The chain
topology is about **which handler enqueues which follow-on kind**, and every one of those sites lives
in `services/job_worker.py` and `services/ingestion/long_fetch.py`. Placing the constant in
`main_worker.py` would put it in a module the enqueue sites do not import.

**Analog A (map-shaped constant beside the data it describes):** `job_worker.py:468-492`

```python
# ---------------------------------------------------------------------------
# Per-kind timeout map (seconds)
# ---------------------------------------------------------------------------
# Matches the reset_stalled_compute_jobs per-kind overrides that main_worker
# passes to the watchdog. The handler timeout must be less than the watchdog
# stale threshold (10/20/10 minutes) so that a slow handler gets a chance
# to fail-classify itself rather than being yanked back to 'pending' by the
# watchdog while still running.
TIMEOUT_PER_KIND: dict[str, float] = {
    "sync_trades": 15 * 60,      # 15 minutes (supports 90-day raw fill backfill)
    "compute_analytics_from_csv": 10 * 60,   # Phase 19.1 — pure math, no exchange I/O
    ...
    "process_key_long": 30 * 60,   # Phase 19 / BACKBONE-09 — 30 min ceiling ...
    "derive_broker_dailies": 15 * 60,  # full-history realized PnL + funding fetch ...
    "stitch_composite": 20 * 60,  # Phase 86 / COMP-02 — N-member fan-out ...
}
```

Per-entry trailing comment naming the phase and the rationale is the house style — carry it.

**Analog B (`Final`-typed module constant):** `main_worker.py:121-124`

```python
BACKFILL_KINDS: Final[tuple[str, ...]] = (
    "derive_broker_dailies",
    "derive_allocator_equity",
)
```

`Final` is imported at `main_worker.py:41` (`from typing import Any, Final, TypedDict, cast`).
`job_worker.py`'s `TIMEOUT_PER_KIND` is *not* `Final`-annotated; either is acceptable, but `Final`
is preferable for a new constant under `mypy --strict`.

**Analog C (single-sourcing comment, the anti-drift idiom):** `job_worker.py:494-497`

```python
# Fallback derive budget (seconds) used when TIMEOUT_PER_KIND lacks
# "derive_broker_dailies". Single-sourced so the MTM second pass and the smoothed
# third pass can never drift; TIMEOUT_PER_KIND stays the real source of truth.
_DERIVE_BUDGET_DEFAULT_S = 15 * 60
```

⚠️ **Pattern risk the planner must resolve.** There is **no existing topology constant** — the chain
edges are hardcoded string literals at three sites:

| Site | Literal |
|------|---------|
| `services/ingestion/long_fetch.py:583` | `tail_kind = "derive_broker_dailies" if is_ledger_backed else "sync_trades"` |
| `services/job_worker.py:1857` | `_follow_on_kind = "derive_broker_dailies"` |
| `services/job_worker.py:4885` | `{"p_strategy_id": strategy_id, "p_kind": "compute_analytics_from_csv"}` |

If the new constant merely *restates* those literals without the sites reading from it, it is
decorative and can drift silently — the JOB-03 oracle would then be pinned to a fiction. Two
acceptable shapes: (a) have the three enqueue sites read the constant (surgical, three one-line
edits), or (b) add a gate asserting the enqueue-site literals match the topology map (AST walk of
`enqueue_compute_job` calls' `p_kind` values, using the Analog-A walker from item 3). Prefer (a).

---

### 8. `src/lib/types.ts:288-329` (model, hand-maintained row type)

**No recent analog — see §No Analog Found.** The current interface, verbatim head (`:288-296`):

```typescript
export interface StrategyAnalytics {
  id: string;
  strategy_id: string;
  computed_at: string;
  // B9: single source of truth is STRATEGY_ANALYTICS_COMPUTATION_STATUSES in
  // closed-sets.ts, pinned against the DB CHECK by check-zod-db-check-parity.test.ts.
  computation_status: StrategyAnalyticsComputationStatus;
  computation_error: string | null;
  benchmark: string | null;
  ...
  data_quality_flags: AnalyticsDataQualityFlags | null;
}
```

⚠️ **CORRECTION to research.** `142-RESEARCH.md` flags `src/lib/database.types.ts` as stale by two
columns and treats `src/lib/types.ts` as current. **Both are stale by the same two columns.**
Verified: `grep -n "computation_warned\|metrics_json_by_basis" src/lib/types.ts src/lib/database.types.ts`
returns **zero** hits in either file, while both columns are live in the DB and read by app code
(`src/app/api/strategies/finalize-wizard/route.ts:1480,1542`; `src/app/factsheet/[id]/v2/page.tsx:45,106`).
So the last `strategy_analytics` column addition that actually threaded into `types.ts` was
`volume_metrics`/`exposure_metrics` (`types.ts:326-327`, migration `20260412125725`) — **four months
and two columns ago**.

Consequence for planning: adding only `computing_started_at` leaves the interface still wrong by two
columns and gives the false impression it is maintained. Either (a) add all three in one line-group
with a comment naming the drift, or (b) add only `computing_started_at` and log the other two to
`TODOS.md` (research §Open Questions #4 recommends this scope containment). Do not silently widen.

Nullability shape to copy: every optional column in this interface uses `T | null`, never `T?`.
A `timestamptz` renders as `string`, so: `computing_started_at: string | null;`.

Field-comment style to copy — the `computation_status` comment above names the pinning test. The new
field's comment should name the reaper cron and say NULL = "not currently computing".

`src/lib/database.types.ts:2477-2506` is generated-shaped but hand-drifted, with **no CI freshness
gate** (grep of `package.json` + `ci.yml` for `database.types` returns nothing). Leave it alone.

**TS coverage note:** `types.ts` is a pure declaration file — a type-only addition does not move the
blocking coverage ratchet.

---

### 9. `src/app/api/keys/sync/route.ts:41-59` (live invariant comment)

Research §Runtime State Inventory names this as in-repo documentation that becomes false. It is a
"Direct-writes audit (D.10)" census comment listing the `computation_status` writers. It must gain the
stamp obligation in the same PR. Its own body is the analog for its own style; keep the lettered-entry
format.

---

## Shared Patterns

### S-1. Fail loud, never silently skip (Rule 12)

**Source:** `20260719120000:73-77`; **Apply to:** the migration, and the SQL gate's presence logic.

```sql
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'WORKER-04: pg_cron extension is NOT installed. ... Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;
```

A migration RAISEs. A test file may `RAISE NOTICE … RETURN` **only** for genuinely-absent local
infrastructure (`pg_extension`), never for "the object under test isn't there yet" — see §2b.

### S-2. `RAISE` format strings are single literals

**Source:** `migration-reviewer.md:162-194` (invariant #21, the PR #182 incident, SQLSTATE 42601).
**Apply to:** every `RAISE` in the migration and the SQL gate. Never `||`-concatenate the format slot;
use `%` placeholders (`test_retention_orphaned_running.sql:92`) or `$msg$…$msg$` dollar-quoting.

### S-3. SECURITY DEFINER posture (only if a named function is created)

**Source:** `20260710150000:71-76` + `:206`; **Apply to:** any new SECDEF function.

```sql
CREATE OR REPLACE FUNCTION sync_strategy_analytics_status(p_strategy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$ ... $$;

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;
```

`public, pg_catalog` — never bare `public`, never `''` (migration-reviewer #3). The `REVOKE` must be in
the **same** migration as the `CREATE` (invariant #20; the `reset_stalled_portfolio_analytics` leak
window is the named incident). Self-verify with `PERFORM public._assert_no_public_execute('public.<fn>(…)')`
(defined `20260515205431`). Research P-5 prefers an **inline cron body** so none of this surface exists.

### S-4. Comment-tagged invariants at the write site

**Source:** `job_worker.py:1893` / `analytics_runner.py:1274`.
**Apply to:** the Python stamp, the SQL branch (a) stamp, and the reaper's `SET` list.

```python
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                        "computation_warned": False,
```

Every non-obvious column in a status write carries a tagged one-line comment naming the defect class
it closes. The stamp lines should carry `JOB-01:` tags; the `computation_warned = FALSE` in the reaper
should carry the `SI-02` tag so it reads as part of the existing class, not a new idea.

### S-5. Two-direction gates (negative + positive control)

**Source:** `test_dark_path_deleted.py:23-29` (docstring) + `:236-252` (the positive assert);
`test_worker_isolation_e2e.py:181-206` (the 503 control);
`20260720120000:92-97` (positive + negative cron-body anchors).
**Apply to:** every new gate in this phase. A negative-only assert passes vacuously when the scan
target moves, the path resolution breaks, or the whole feature is deleted.

```python
    scan = _py_scan_files()
    assert scan, "the py scan found no files — path resolution is broken"
```

That one line (`test_dark_path_deleted.py:108`) is the cheapest anti-vacuity guard in the repo. Copy it.

### S-6. Real-RPC oracle, never the isolated helper

**Source:** `test_sync_status_supersede_failed_per_kind.sql:25-32`;
`test_retention_orphaned_running.sql:156-158` (`EXECUTE v_command`).
**Apply to:** the JOB-01 stamp-transition test and the JOB-02 reap test. Drive
`mark_compute_job_done`/`_failed` and `EXECUTE` the deployed `cron.job.command`; never re-type the
predicate or call the bridge directly.

### S-7. SQL-test file frame

**Source:** `test_retention_orphaned_running.sql:54` + `:186-191`.
**Apply to:** the new SQL gate.

```sql
BEGIN;
DO $$ ... 
  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id = uid;
END
$$;
ROLLBACK;
```

Whole file wrapped `BEGIN;…ROLLBACK;` (the one legitimate `ROLLBACK` location) so the shared TEST DB
is not polluted — critical given `project_shared_testdb_concurrent_ci_flake`. Seed ids from
`gen_random_uuid()`, never fixed literals, so concurrent CI runs cannot collide. Per-part
`BEGIN;…ROLLBACK;` (the supersede test's style) is also acceptable and gives finer isolation.

### S-8. Deleted-file gate

**Source:** `test_dark_path_deleted.py:157-165`.
**Apply to:** `analytics-service/scripts/reset_stuck_computing_rows.py`. Deleting the file is not
enough — add the path to a stays-absent assert so a future agent cannot resurrect the broken
`updated_at` implementation (C-5). Repo-wide references to remove/leave: only
`CHANGELOG.md:9797` (historical, leave) and the script's own docstring `:21`. Nothing imports it; no
test covers it.

---

## Corrections to the Expected File Set

| Expected (from the prompt) | Reality | Action |
|---|---|---|
| Chain-topology constant "in `main_worker.py` around 200-230" | That range is `WATCHDOG_PER_KIND_OVERRIDES` (a watchdog map). All three enqueue sites live in `services/job_worker.py` + `services/ingestion/long_fetch.py`. | Put the constant in `services/job_worker.py` beside `TIMEOUT_PER_KIND` (~:492). See item 7. |
| `src/lib/types.ts` gains the new column (research says `database.types.ts` is the stale one) | **Both** are stale by `computation_warned` + `metrics_json_by_basis`. | Decide explicitly (item 8); do not widen silently. |
| *(not listed)* `src/app/api/keys/sync/route.ts:41-59` | Live "Direct-writes audit (D.10)" invariant comment that becomes false. | Add as a modified file (item 9). |
| *(not listed)* `supabase/migrations/down/<ts>-rollback.sql` | The three most recent migrations ship no rollback file. | Do not create one. |
| *(implied)* register the new cron in `test_retention_crons_safe.sql` | Its assertion requires `%where%created_at%` in every listed body — the opposite of P-1. | Do **not** add it. |
| `analytics-service/tests/test_job_worker_csv_kind.py:109` (second consumer) | Only breaks if `TIMEOUT_PER_KIND`/`WATCHDOG_PER_KIND_OVERRIDES` change; this phase changes neither. | No edit expected; re-run it as a sampling gate only. |

---

## No Analog Found

| File / Element | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/types.ts` — the row-type addition | model | — | The last two `strategy_analytics` column additions (`computation_warned` 20260708120000, `metrics_json_by_basis` 20260710120000) **skipped** `types.ts` entirely. The last one that threaded through is `volume_metrics`/`exposure_metrics` (migration `20260412125725` → `types.ts:326-327`), four months old and predating the current interface conventions. There is no CI gate on either TS type file. Follow the `types.ts:326-327` line shape and research §Open Questions #4. |
| The job-chain-topology constant itself | config | — | No topology map exists anywhere in `analytics-service/`; the chain edges are three inline string literals. Constant *shape* has analogs (`TIMEOUT_PER_KIND`, `BACKFILL_KINDS`); the *concept* is new. See the pattern risk in item 7. |
| A pg_cron janitor that **UPDATEs** with `LIMIT` + `FOR UPDATE SKIP LOCKED` | migration | scheduled batch | All six existing pg_cron janitors are unbounded `DELETE`s. `reset_stalled_portfolio_analytics` (`20260516122247:43-50`) is the only reaping **UPDATE**, and it is unbounded *and* Python-invoked, not pg_cron. The bounded-UPDATE shape (research P-6) has **no in-repo precedent** — the planner writes it from first principles and it deserves extra review attention. |
| A cron→Sentry alerting bridge | — | event-driven | Does not exist (research §Open Questions #3). CONTEXT.md already withdrew the Sentry claim. Honest minimum is `RAISE WARNING` + a documented operator query. Do not claim delivery that isn't built (SEAMUX-08 class). |

---

## Metadata

**Analog search scope:** `supabase/migrations/` (232 files, filename census + 6 read in full or in
part), `supabase/migrations/down/`, `supabase/tests/` (52 files listed, 4 read), `analytics-service/tests/`
(6 read + AST-usage census across 20), `analytics-service/services/`, `analytics-service/main_worker.py`,
`src/lib/`, `.github/workflows/ci.yml`, `.claude/agents/migration-reviewer.md`.

**Files read in full or in targeted range:** 20.
**Project skills:** none — no `.claude/skills/` or `.agents/skills/` directory exists in this repo.
**Project instructions applied:** root `CLAUDE.md` (coverage gates, DESIGN.md — no visual surface here),
`AGENTS.md` (no Next.js runtime surface touched), `.claude/agents/migration-reviewer.md` (invariants
#3, #5, #6, #11, #14 [deviated, pre-documented], #16, #20, #21).

**Pattern extraction date:** 2026-08-02
