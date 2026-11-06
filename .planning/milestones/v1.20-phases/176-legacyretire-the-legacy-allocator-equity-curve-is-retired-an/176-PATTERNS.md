# Phase 176: LEGACYRETIRE - Pattern Map

**Mapped:** 2026-10-31
**Files analyzed:** 38 new/modified/deleted file groups (Census A-E of 176-RESEARCH.md, grouped by the three ordered PRs of D-02)
**Analogs found:** 36 / 38 (2 groups have no analog and use RESEARCH.md: the derived-account-delta SQL helper body, and the Option-R retired handler stub)

All analog paths below were checked with `git ls-files` (tracked source, no gitignored mirror). Line numbers are at the worktree HEAD of this phase and drift quickly; re-grep before each PR. Paths are repo-relative.

## File Classification

### PR 1 (readers move; deployed and read live on PROD before PR 2)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<new>_bridge_outcome_holding_branch_derived.sql` (re-base `compute_bridge_outcome_deltas` + helper) | migration (SECDEF function re-base) | batch (daily cron) | `supabase/migrations/20260426131718_match_decisions_kind_enum.sql` (body to re-base) + `supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql` (catalogue-only verify, schema-qualified re-base) | exact (body) / exact (verify) |
| `supabase/migrations/down/<new>-rollback.sql` | migration rollback | n/a | `supabase/migrations/down/20261028120000-rollback.sql` | exact |
| `supabase/tests/test_bridge_outcome_deltas_derived.sql` | test (SQL gate, RED-UNDER annotated) | request-response (function call over seeded rows) | `supabase/tests/test_api_key_flow_prices.sql` (annotation shape) + `supabase/tests/test_replace_allocator_equity_snapshots_window.sql` (function-body edit twins) | role-match |
| `supabase/schema/functions/*.sql` (regenerated) | generated artifact | transform | `npm run schema:functions` (never hand-edited) | n/a |
| `src/lib/queries.ts` (`getMyAllocationDashboard`: remove legacy select, `snapshotCount`, `minHistoryDepthMonths`, `equityBaselineUnknown`, `equitySnapshots`, `partitionTrustworthyEquitySnapshots`; `allocatorEligibleApiKeyIds`) | service (server-only data module) | request-response | itself: `trustworthyDerivedCurve` use at ~:5105 and the `eligibleKeyIds` rule at ~:6101-6112 | exact (self) |
| `src/lib/allocation-helpers.ts` (`equitySnapshotsToDailyPoints`) + `allocation-helpers.equity-adapter.test.ts` | utility + test | transform | delete with consumers | n/a (deletion) |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | component | request-response | itself (`warmupCopy` ~:147-163, `warmingUp` ~:356) | exact (self) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (`snapshotCount` / `minHistoryDepthMonths` props ~:963-965) | component | request-response | itself | exact (self) |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (+ `BaselineUnknownBanner`, two render sites) and `AllocationDashboardV2.baseline-unknown.test.tsx` (delete) | component + test | request-response | itself | exact (self) |
| `src/lib/queries.my-allocation.test.ts` (TC p7-02/03/07/08/09, D-02 block, AUM-04 blocks) | test (vitest, mocked supabase chain) | request-response | itself (harness `buildChain`, `rowsFor` switch ~:274-345, `chainAudit`) | exact (self) |
| `src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx`, `AllocationDashboardV2.warmup.test.tsx` | test (component) | request-response | themselves | exact (self) |
| `src/__tests__/bridge-outcome-cron-holding.test.ts` (live DB, `HAS_LIVE_DB` gated) | test (live-DB) | batch | itself | exact (self) |
| `e2e/helpers/seed-test-project.ts` (drop the legacy upsert ~:972) | test helper | CRUD (seed) | itself (the derived upsert ~:994 stays) | exact (self) |
| `docs/runbooks/bridge-outcome-cron.md` | runbook | n/a | `docs/runbooks/flipretry-derived-equity-go-live.md` AMENDED banner form (for the stale parts) | role-match |
| `TODOS.md` (3 MARKSOURCE entries), `.planning/ROADMAP.md` 181/182 lines | ledger | n/a | existing `**CLOSED 2026-10-28.**` entries; ROADMAP "Absorbed/Superseded 2026-10-31" lines already present | exact |

### PR 2 (legacy writers stop; cron unscheduled by hand)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/equity_reconstruction.py` (delete `persist_equity_snapshots`, `_purge_allocator_equity_snapshots`, `_allocator_has_equity_snapshots`, `replace_equity_snapshots[_window]`, `_owed_reconstructs_for_zero_snapshot_book` and, only on zero remaining references, `_fanout_would_still_retry`, `_strategy_linked_key_ids`) | service | CRUD (writers) | itself; module stays (derive imports `read_marked_equity_usd`, `read_okx_option_exposure`, `EquityCurveBuilder`, `_NO_CAPITAL_ANCHOR_REASONS`) | exact (self) |
| `run_refresh_allocator_equity_daily_job` / `run_reconstruct_allocator_history_job` (retire or reduce) | job handler | event-driven (queue) | `return DispatchResult(outcome=DispatchOutcome.DONE)` early-exit form in the same file (~:7471) and the unknown-kind branch in `analytics-service/services/job_worker.py` (~:15995) | role-match |
| `analytics-service/services/job_worker.py` (`TIMEOUT_PER_KIND` ~:907-908, dispatch arms ~:15964-15969, reconstruct cap hook ~:16033), `analytics-service/main_worker.py` (watchdog override ~:355) | config / dispatch | event-driven | itself | exact (self) |
| `supabase/migrations/<new>_request_allocator_holdings_sync_no_reconstruct.sql` (Option R only) | migration (SECDEF re-base) | request-response | `supabase/schema/functions/request_allocator_holdings_sync.sql` (latest, source `20261014120000`) + house style of `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` | exact (body) / exact (style) |
| Python tests that assert the fake DB recorded no legacy rows | test (pytest) | event-driven | `analytics-service/tests/test_bybit_two_year_window.py` (~:325), `test_refresh_allocator_equity_carry_forward.py` (~:1783, :2073, :2107), `test_derive_allocator_equity_job.py` (`LEGACY_TABLE` guard) | exact |
| Operator step: `cron.unschedule('refresh-allocator-equity')` + `scripts/prod-prober/cron-manifest.json` re-capture | runbook step + config | batch | `docs/runbooks/derivecron-go-live.md` Step C and `## Rollback` | exact |
| Runbook retirement banners (`marksource-legacy-chain-move-go-live.md`, `navmtm-chain-move-go-live.md`, `ledger-refresh-go-live.md`, `marksource-okx-history-correction.md`, OKX census SQL/runbooks) | runbook | n/a | `docs/runbooks/flipretry-derived-equity-go-live.md` lines 7, 13, 33, 95, 105 | exact |
| `analytics-service/scripts/allocator_history_probe.py`, `e2_allocator_ground_truth.py` + their tests | tooling | batch | delete (Census C) | n/a (deletion) |

### PR 3 (the drop, its own migration and PR)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<new>_drop_allocator_equity_snapshots.sql` (re-base `delete_allocator_api_key`, DROP functions, DELETE orphan derived rows, DROP TABLE, catalogue-only verify) | migration (DDL, one-way) | batch | `supabase/migrations/20260908120000_drop_create_allocator_connected_strategy.sql` (DROP FUNCTION + inverted catalogue verify) + `supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql` (re-based `delete_allocator_api_key`, verify block) | role-match (two analogs compose) |
| `supabase/migrations/down/<new>-rollback.sql` | rollback | n/a | `supabase/migrations/down/20261028120000-rollback.sql` | role-match |
| `supabase/tests/test_api_key_delete_atomicity.sql` (rewrite Part 1 and Part 3) | test (SQL gate, no annotations today) | CRUD | itself | exact (self) |
| `supabase/tests/test_replace_allocator_equity_snapshots_window.sql`, `test_allocator_equity_pre_terminus_flag.sql`, `test_refresh_fanout_zero_snapshot_bootstrap.sql`, `test_refresh_fanout_owed_key_reconstruct.sql` (delete) | test | n/a | deletion; floors move (below) | n/a |
| `scripts/mutation-floors.mjs` (`FILES_FLOOR`, `ARMS_FLOOR`), `.github/workflows/ci.yml` (`SENTINEL_FLOOR`, `ARMS_FLOOR`, contiguous table), and the by-name pins in `src/__tests__/*` | config / census | n/a | the dated RAISED/lowered comment blocks in the same files | exact |
| `src/lib/gdpr-export-manifest.ts`, `scripts/check-gdpr-export-coverage.ts`, `src/__tests__/gdpr-export.test.ts`, `src/__tests__/gdpr-export-schema.test.ts` | config + tests | CRUD (export) | the `allocator_equity_derived` entries in the same files (kept as the neighbour) | exact |
| `src/lib/database.types.ts` | generated types | n/a | regenerate / hand-edit the table Row/Insert/Update and the RPC entries | n/a |
| `TODOS.md` (`CLOSED` paragraphs), `.planning/ROADMAP.md` | ledger | n/a | `**CLOSED 2026-10-28.**` form | exact |

## Pattern Assignments

### New migration, PR 1: re-base of `compute_bridge_outcome_deltas` onto the derived series (migration, SECDEF, batch)

**Analog (body to re-base):** `supabase/migrations/20260426131718_match_decisions_kind_enum.sql` lines 180-356. It is the LATEST definer of `compute_bridge_outcome_deltas()`. Only the `holding_computed` CTE (lines 253-284) changes; the strategy branch (192-235) and voluntary_add branch (299-347) must stay byte-identical.

**Header/signature to preserve** (lines 180-190, 354-356, 367-369):
```sql
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
...
  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$func$;
...
-- CREATE OR REPLACE strips existing GRANTs - re-apply per migration 073 STEP 4.
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;
```

**The block being replaced** (lines 253-264, the same shape repeated for 90 and 180):
```sql
holding_computed AS (
  SELECT
    hc.id,
    CASE
      WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
        OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) IS NULL
      THEN NULL
      ELSE ( ... ) - 1
    END AS d30,
```
The holding update keeps `COALESCE(hc.d30, bo.delta_30d)`, `needs_recompute = FALSE`, `deltas_computed_at = v_started` and sets no `estimated_*` column (lines 286-297). 30, 90 and 180 use one rule (RESEARCH "Bridge outcomes").

**Helper analog for shape (D-03):** `supabase/schema/functions/extract_delta.sql` (IMMUTABLE, `PARALLEL SAFE`, `LANGUAGE sql`, NULL when an endpoint is absent) and `extract_symbol_value_at.sql` (STABLE, reads one table). The new helper (RESEARCH "Code Examples", flagged `[ASSUMED]`) has no exact analog: it reads `allocator_equity_derived` kind `equity_curve` with `version = 2` and `is_trustworthy = true`, uses `returns[].r` (flow-neutral) or `curve[].equity_usd` (RESEARCH OQ2: recommended flow-neutral), casts defensively so a malformed row yields NULL and never aborts the daily batch, and is `SECURITY DEFINER SET search_path = public, pg_catalog` with a full-signature `REVOKE`. The existing `extract_equity_at` reads the key `value` and cannot be reused (derived curve uses `equity_usd`).

**Catalogue-only verify-block pattern (copy this shape, NOT the old 080 DO block):** `supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql` lines 396-470. The old `20260426131718` block reads `match_decisions` rows and RAISEs (lines 385-441); it is a data-dependent guard that the data-dependence lint now refuses for new files, so do not copy it.
```sql
DO $verify$
DECLARE
  v_oid    oid := to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)');
  v_n      integer;
  v_secdef boolean;
  v_cfg    text[];
  v_src    text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'replace_allocator_equity_snapshots_window';
  IF v_n <> 1 OR v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: expected exactly one public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date), found % overloads', v_n;
  END IF;
  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_secdef, v_cfg, v_src FROM pg_proc p WHERE p.oid = v_oid;
  ...
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '...';
  END IF;
```
Its header (lines 54-58) states the rule in one sentence: "NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and none of its data... the verify block below reads the catalogue only (pg_proc, pg_namespace, has_function_privilege, to_regprocedure)." For this migration add: the holding branch no longer mentions `extract_symbol_value_at` (`pg_proc.prosrc`), and the new helper has no `anon`/`authenticated` EXECUTE. Do not assert the exact formula lines in the verify block (the file's comment at lines 396-401 explains why: a verify that checks the mutated lines would abort the apply of the mutated copy and the RED-UNDER twin could never score).

**Re-base discipline and schema qualification:** lines 61-62 of the same file ("Schema-qualified CREATE: an unqualified CREATE OR REPLACE resolves against the SESSION search_path and can mint a second function with default privileges"). `20260716090000_retire_compute_analytics_kind_rpc_guard.sql` lines 22-33 is the written form of "re-base on the LATEST def; copy bodies VERBATIM; only change is the marked block".

**Transaction style (conflict surfaced, Rule 7):** the repo holds two conventions. `20261028120000` and `20261030120000` open with `BEGIN;` ... `COMMIT;` plus `SET LOCAL lock_timeout`. `20260716090000` (lines 32-37) and `20260717233529` (lines 44-46) state "NO explicit BEGIN/COMMIT - Supabase wraps each migration in an implicit transaction (migration-reviewer invariant #14)", and the 164.9.3 migration review lists "no transaction control" as a passed invariant. RESEARCH.md says the same. Pick the reviewer invariant (no `BEGIN`/`COMMIT`, `SET LOCAL lock_timeout = '3s';` at the top, single-literal `RAISE`, no `CONCURRENTLY`) and copy the no-transaction-control precedent `20260716090000`; flag the BEGIN/COMMIT files as the older style, not a pattern to follow. `20260908120000` also uses `BEGIN;` (lines 164-165) and states why (its RAISE must roll the removal back); with the implicit wrap that reason no longer needs an explicit block.

**Rollback file:** `supabase/migrations/down/20261028120000-rollback.sql` lines 1-30 (what it undoes, "DATA IS KEPT", "THE MIGRATION LEDGER ROW IS LEFT IN PLACE").

---

### `supabase/tests/test_bridge_outcome_deltas_derived.sql` (SQL gate with RED-UNDER and RED-UNDER-SETUP)

**Analog:** `supabase/tests/test_api_key_flow_prices.sql` (annotation grammar, pg_temp helpers, sentinel) and `supabase/tests/test_replace_allocator_equity_snapshots_window.sql` (function-body edit twins; this file is deleted in PR 3 but is the nearest function-behaviour gate). Grammar contract: `scripts/mutation-runner/GRAMMAR.md` (markers count only at comment line start; `occurrences` is a required measured integer).

**File skeleton** (test_api_key_flow_prices.sql lines 1-20, 60-125, 158-216, 612-616):
```sql
-- Header: background, arm list "(LISTED and EXECUTED in this order)", ANTI-GREEN-SKIP CONTRACT,
-- SENTINEL paragraph, then the annotation paragraph and:
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql", ..., "supabase/migrations/20261101120000_api_key_flow_prices.sql"]}

BEGIN;

CREATE FUNCTION pg_temp.fp_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'fp-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

DO $$
DECLARE ...
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): ... does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - ... =====
  -- RED-UNDER: <human claim>
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/<the migration that DEFINES the body>.sql","find":"<exact needle>","replace":"<mutant>","occurrences":1}]}
  ...
  RAISE NOTICE 'ALL 8 ARMS EXECUTED (1,2,3,...): ...';
END $$;

ROLLBACK;
```
Rules lifted from the analog's header: every `TEST FAILED (N)` raise sits DIRECTLY in the DO body (helpers return values, never raise an identity); sub-identities such as `5a`/`7b` for several defects in one arm, with the sentinel counting arms not twins; the twin edits the migration that LAST defines what it mutates, so for the bridge gate every twin targets the PR 1 migration; the verify block asserts none of the edited lines so the mutated migration applies clean; seed data is synthetic (`gen_random_uuid()`, `@invalid.local`, invented dates).

**RED-UNDER-SETUP list for a function gate:** copy the flow-prices list (core, auth-role, sanitize-tables, compute-jobs, default-privileges, api-keys-created-at, app-role-helper, credential-columns, enqueue chain fixtures; `compute_jobs_queue`, `allocator_holdings`, `allocator_equity_derived_surface`, `strategy_keys` etc. migrations) and ADD the bridge-outcome tables' migrations plus `20260426131718_match_decisions_kind_enum.sql` and the new PR 1 migration last. Measure the exact set by running the pg-lane; do not guess (`scripts/pg-lane/run.sh --workdir <scratch> --apply <files...> --gate <gate.sql>`).

**Arms the gate needs (from RESEARCH B-05):** derived v2 trustworthy row gives the expected delta for 30, 90 and 180; a missing day inside the window yields NULL; an untrustworthy or version-1 row yields NULL; the strategy and voluntary_add branches are unchanged; a malformed payload yields NULL without aborting the batch; the helper is not callable by `anon`/`authenticated`. Each arm gets a twin; WAIVED_CEILING stays 0.

**Adding this file moves** `FILES_FLOOR`, `ARMS_FLOOR`, the `sql-tests` sentinel census if it declares `ALL N ARMS EXECUTED`, and every by-name pin (see Shared Patterns, Census/floor moves).

---

### `supabase/migrations/<new>_drop_allocator_equity_snapshots.sql` (PR 3 migration, DDL, one-way)

**Analog 1 (DROP FUNCTION + inverted catalogue verify):** `supabase/migrations/20260908120000_drop_create_allocator_connected_strategy.sql`. Lines 164-174 (the statement, no existence-tolerant modifier and no dependent-removing modifier) and 200-249 (the verify):
```sql
BEGIN;
SET lock_timeout = '5s';
DROP FUNCTION public.create_allocator_connected_strategy(
  uuid, uuid, text, text, text, text, text, text, text, text, integer
);
DO $verify$
DECLARE
  v_exact   INTEGER;
  v_any     INTEGER;
BEGIN
  SELECT count(*) INTO v_exact
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_allocator_connected_strategy'
     AND p.pronargs = 11;
  IF v_exact <> 0 THEN
    RAISE EXCEPTION 'Migration 20260908120000: ... still has % overload(s) ...', v_exact;
  END IF;
```
Why the two modifiers are refused (lines 81-111): the existence-tolerant form turns a signature mismatch into a vacuous pass; the dependent-removing form removes unlisted objects silently. Name every function at its exact signature: `replace_allocator_equity_snapshots(uuid, jsonb, integer)`, `replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)`, `extract_symbol_value_at(uuid, text, date)`, `enqueue_refresh_allocator_equity_for_all()`. Header sections to copy in spirit: WHY, BLAST RADIUS, REVERSIBILITY ("reversibility of the definition, nothing more"), "WHAT THIS FILE DOES NOT CLEAR" (the name-set ratchet row clears only when the baseline is regenerated).

**Analog 2 (re-base `delete_allocator_api_key` without the snapshot statements):** `supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql` lines 337-399 (latest definer). Re-base byte-identically and delete only Step 4's two statements:
```sql
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_snapshots
      WHERE allocator_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );

    -- WR-01: ... clear the seam record under the same key-presence test.
    DELETE FROM allocator_equity_derived ck
      WHERE ck.allocator_id = auth.uid()
        AND ck.kind = 'snapshot_rebuild_boundary'
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );
  END IF;
```
Keep: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `SET lock_timeout = '3s'`, the `pg_advisory_xact_lock(hashtext('alloc:' || auth.uid()::text))` line, Steps 1-3, `RETURN v_holdings_deleted`. Once the snapshot DELETE goes, decide whether the advisory lock still has a counterpart (it was shared with the replace RPC); do not remove it silently, say so in the migration header. Grants are preserved by `CREATE OR REPLACE` (line 260: "CREATE OR REPLACE keeps the existing ACL, so no GRANT is re-issued"). Assert the preserved ACL in the verify block (`has_function_privilege('authenticated', ...)` true, `anon` false), as test_api_key_delete_atomicity.sql Part 1 does at runtime.

**Order inside the file (RESEARCH Pattern 1, Pitfall 1):** (1) re-base `delete_allocator_api_key`; (2) the four `DROP FUNCTION`s; (3) plain `DELETE FROM public.allocator_equity_derived WHERE kind = 'snapshot_rebuild_boundary';` (an UPDATE/DELETE with no row-conditioned RAISE passes the lint); (4) `DROP TABLE public.allocator_equity_snapshots;`; (5) catalogue verify.

**Catalogue-only verify to add** (RESEARCH skeleton, all reads on `pg_class`/`pg_proc`, none on application rows):
```sql
DO $verify$ BEGIN
  IF to_regclass('public.allocator_equity_snapshots') IS NOT NULL THEN RAISE EXCEPTION '...'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosrc ILIKE '%allocator_equity_snapshots%') THEN
    RAISE EXCEPTION '...';  -- plpgsql and SQL bodies are not dependency-tracked: this is the ONLY thing that catches a missed dependent
  END IF;
END $verify$;
```
Single-literal `RAISE` messages only. Transaction style: see the conflict note in the PR 1 section (reviewer invariant: none).

**Data-dependence lint:** `node scripts/lint-migration-data-dependence.mjs --self-test` then `node scripts/lint-migration-data-dependence.mjs`; expected `0 NEW`. There is no opt-out marker. The three baseline entries naming the table at `scripts/lint-migration-data-dependence-baseline.txt:104-106` stay (their migration files stay).

**Do not** copy `20260908120000`'s statement that its file is unusable in a gate apply list (lines 127-133): this PR's targets are all defined by migrations, so the pg-lane replays it. Do copy its REVERSIBILITY and "ONE-WAY production DDL event" warnings, adapted: D-02 says undoing the drop needs a restore from backup, and the rollback file can restore only the definition (the DDL is in `supabase/schema/baseline.sql`), never the rows.

---

### `supabase/tests/test_api_key_delete_atomicity.sql` (rewrite for the dropped table)

**Analog:** itself (283 lines). Unannotated; plain `DO $$` blocks with `RAISE EXCEPTION`.
- **Part 1** (lines 31-139): keep the `delete_allocator_api_key` assertions (lines 31-53: advisory lock, `NOT EXISTS`, no `v_remaining_keys`, `lock_timeout=3s`, authenticated EXECUTE, anon denied, lock key prefix check lines 125-136). Delete the `replace_allocator_equity_snapshots` assertions (lines 91-119).
- **Part 3** (lines 207-283): delete the snapshot seed (`INSERT INTO public.allocator_equity_snapshots` lines 225-227, 249-250) and the snapshot counts (231-235, 252-256, 262-266) and arm (d) (268-283). Keep the cascade behaviour that survives: a sole-key hard delete removes the key and its holdings; `cascade=false` never removes holdings. Reframe "wipes snapshots" as "removes holdings" so the arm can still fail (Rule 9). Add the new truth: no function body names the table.
- This file must be free of the table in the PR that carries the migration, because the local-stack lane replays the migration on top of a dump that still holds the table.

---

### `src/lib/queries.ts`: `getMyAllocationDashboard` (service, request-response; PR 1)

**Analog:** itself. What changes:

1. Delete the read (lines ~5390-5400, the first `.from("allocator_equity_snapshots")` in the `Promise.all`) and `assertOk(phase07EquityRes, "allocator_equity_snapshots")` (~:5764). The `Promise.all` destructuring list loses `phase07EquityRes`.
2. Values come from the derived row already fetched. `snapshotCount` (RESEARCH, Code Examples):
```typescript
const drawn = trustworthyDerivedCurve(derivedPayload);   // DailyPoint[] | null  (queries.ts ~:5105 already computes curveForSource this way)
const snapshotCount = drawn?.length ?? 0;                 // days of the drawn derived curve
```
   Pitfall 7: an untrustworthy or rebuilding row gives 0 and the Scenario KPI strip would print a false "Warming up" countdown; decide the composer's rebuilding branch with the same fail-closed reading as the Overview (`equityHistoryState`) and pin it in a test.
3. Delete `minHistoryDepthMonths` (~:5117-5120, `depths = equitySnapshots.map(...)`), `equityBaselineUnknown` and `partitionTrustworthyEquitySnapshots` (helper ~:3793, call ~:5800), the `equitySnapshots` payload field (type ~:3165-3183, ~:4925, ~:5218). `activeVenues` stays (~:5122-5129). Founder acknowledgement for the user-facing copy loss is RESEARCH OQ4; R0 names who sees the banner.
4. `equityCurveSource: "derived" | "legacy"` (~:5100-5107): the `"legacy"` arm names the retired source. Ten test files and `widgets/lib/widget-data.ts` reference the field; decide narrow-to-`"derived"` versus leave inert, and grep consumers first. The existing comment says do NOT restore a source-based gate.
5. `allocatorEligibleApiKeyIds` (lines ~6101-6112 at the time of mapping):
```typescript
const strategyLinkedKeyIds = deriveStrategyLinkedKeyIds(
  ((phase151OwnStrategiesRes.data ?? []) as Array<{ ... }>).filter((s) => !isAllocatable(s.capital_ownership)),
  phase151StrategyKeyLinksRes.data ?? [],
);
const allocatorEligibleApiKeyIds = eligibleKeyIds.filter(
  (id) => !strategyLinkedKeyIds.has(id),
);
```
   becomes `const allocatorEligibleApiKeyIds = eligibleKeyIds;` (181 rule). `deriveStrategyLinkedKeyIds` (~:903) stays: it is also used by `deriveStrategylessKeys` (~:955) and `reconstructCappedKeyIds` (~:4824). `phase151OwnStrategiesRes` / `phase151StrategyKeyLinksRes` remain needed by `reconstructLinkSource` while the reconstruct note exists (OQ1). The ~80-line AUM-04 rationale comment above becomes false and must be rewritten, not left.

**Error-handling pattern retained:** `assertOk(res, "<table>")` for the remaining reads (~:5764-5769 list). Keep it for every read that stays.

---

### `src/lib/queries.my-allocation.test.ts` (vitest, mocked supabase chain)

**Analog:** itself. Harness shape to reuse:

**State reset + chain audit** (lines ~215-270): `resetState()` zeroes `state.*` arrays; `chainAudit.entries` records one entry per `.from(table)`; `rowsFor()` is a `switch (table)` (lines 274-345) with a `case "allocator_equity_snapshots": return applyFilters(state.allocatorEquitySnapshots ...)` arm and a derived arm `case "allocator_equity_derived": return applyFilters(state.allocatorEquityDerived ...)`.

**B-02 new arm (no legacy read), RED on base because base calls it** (shape from lines ~4906-4915):
```typescript
const { getMyAllocationDashboard } = await import("./queries");
await getMyAllocationDashboard("user-1");
const legacyReads = chainAudit.entries.filter(
  (e) => e.table === "allocator_equity_snapshots",
);
expect(legacyReads).toHaveLength(0);
```
Delete the `case "allocator_equity_snapshots"` arm and `state.allocatorEquitySnapshots` only after every test that seeds it is rewritten (typecheck is the oracle).

**B-01 rewrite of TC p7-03** (lines 1259-1273): replace the seeded legacy rows with a derived v2 row of N days and assert `snapshotCount === N`; the legacy mock stays empty so base returns 0. Derived fixtures to reuse: `derivedRow(isTrustworthy)` (line 3127: `{allocator_id, kind: "equity_curve", payload: {curve, flags, degrade_reasons, is_trustworthy, scalars, inputs}}`) and `v2Row()` (line 3215: adds `payload.version = 2` and `payload.returns`). Extend the curve length rather than inventing a new fixture shape.

**B-04 key rule** (AUM-04 blocks, lines 4011-4503, 4521-4680): the existing assertions are the RED-on-base after the rule change:
```typescript
expect(result.eligibleApiKeyIds).toHaveLength(8);
expect(result.allocatorEligibleApiKeyIds).toEqual(["k-bybit", "k-okx"]);   // flips to all eligible keys, order preserved
```
The fixtures `AUM04_STRATEGIES`, `AUM04_LINKS`, `AUM04_KEYS` (INTERLEAVED order on purpose), `seedSeriesFor(...)` stay and are reused. Rewrite expectations to the new rule; the tests that assert a link-excluded key `not.toContain(...)` (own-capital exemption block) become inversions. `src/lib/queries.test.ts:2184-2340` tests the unchanged helper `deriveStrategyLinkedKeyIds`; keep.

**Component tests:** `KpiStrip.warmup.test.tsx` lines 1-60 (render `<KpiStrip snapshotCount={10} allKeysStale={false} minHistoryDepthMonths={null} activeVenues={[]} />` and `screen.getAllByText("Warming up — need 20 more days of synced data.")`) is the pattern for the generic-countdown test; delete the venue-specific tests with `minHistoryDepthMonths`. `AllocationDashboardV2.warmup.test.tsx` (describe at line 135, "the note's day count is the smallest ready curve the real builder accepts") measures day count against the real builder: use it as the oracle that `snapshotCount` and `FactsheetWarmupNote` count the same unit.

---

### `src/lib/gdpr-export-manifest.ts` and friends (PR 3, config + tests, GDPR manifest table removal)

**Analog:** the neighbouring `allocator_equity_derived` entries in the same files (they stay).

Remove, in one PR with the migration:
- `src/lib/gdpr-export-manifest.ts` lines 628-632 (comment + `{ kind: "direct", table: "allocator_equity_snapshots", user_column: "allocator_id" },`), the order-override line 1011 `allocator_equity_snapshots: "asof",`, the doc-list line 977, and re-word the comments at lines 618 and 643 that use the table as a sensitivity-class reference (point them at `allocator_equity_derived`).
- `scripts/check-gdpr-export-coverage.ts` lines 374-387, the `allocator_equity_snapshots: { reason: "PRESERVE-historical: ..." }` allowlist entry. The script flags a stale entry for a dropped table (its own text at ~:1235: "Either the table was renamed/dropped (remove this entry)").
- Tests: `src/__tests__/gdpr-export-schema.test.ts:136` and `src/__tests__/gdpr-export.test.ts:951` (the `allocator_equity_snapshots: "asof"` rows in the expected-override maps). The test names say "the four id-less tables"; the count in the title and comment changes.
- `src/lib/database.types.ts` (table Row/Insert/Update ~:137, RPC ~:4328, plus `extract_symbol_value_at` and the changed `compute_bridge_outcome_deltas` entries). The schema test pins each override column against `database.types.ts`, so remove both together or it fails the other way.

Verify: `npx tsx scripts/check-gdpr-export-coverage.ts`; `npx vitest run src/__tests__/gdpr-export.test.ts src/__tests__/gdpr-export-schema.test.ts`. The derived `equity_curve`/`key_inputs` rows and `api_key_nav_marks` stay exported (Art. 15 coverage remains).

---

### Python: a pytest test that the fake DB recorded no legacy rows (PR 2)

**Analog A (assert-no-rows on a fake):** `analytics-service/tests/test_bybit_two_year_window.py` lines 322-326:
```python
assert exchange.fetch_my_trades.await_count == 0
assert fake.rows_for("allocator_equity_snapshots") == []
assert [n for (n, _p) in fake.rpc_calls if n.startswith("replace_allocator_equity")] == []
assert _marker_of(fake, API_KEY_ID_1) is None
```
and `analytics-service/tests/test_refresh_allocator_equity_carry_forward.py` ~:1783 (`_no_snapshot_row(fake)`, `assert fake.rows_for("allocator_equity_snapshots") == []`, `assert fake.rows_for("compute_jobs") == []`, `assert fake.rpc_calls == []`).

**Fake DB:** `analytics-service/tests/test_equity_reconstruction.py` lines 320-345 and 489-490: `FakeSupabaseClient` keeps `self.store: dict[tuple, dict]` and `self.rpc_calls: list[tuple[str, dict]]`; `rows_for(table)` returns the stored rows. Its `rpc()` emulates the replace RPC against the store (so a call is recorded AND applied, which is why the assertion must check both `rpc_calls` and `rows_for`).

**Analog B (a fake that REFUSES the table, stronger than "recorded none"):** `analytics-service/tests/test_derive_allocator_equity_job.py` lines 46-110: `LEGACY_TABLE = "allocator_equity_snapshots"`, `class _LegacyWriteError(AssertionError)`, `_guard_legacy(op)` raising on `upsert/insert/update/delete`, and `select()` raising on a read; the guard test at ~:2652:
```python
with pytest.raises(_LegacyWriteError):
    fake.table(LEGACY_TABLE).select("date").execute()
...
selects = [name for name, _cols in fake.selects]
assert LEGACY_TABLE not in selects
```
For B-07 the new test points the same guard (or `rows_for(...) == []` plus `rpc_calls`) at the retired refresh/reconstruct handlers: RED on base because the base fake records legacy rows.

**Keep until the drop, then trim:** the `LEGACY_TABLE` constant is also imported by `test_allocator_equity_departed.py`, `test_allocator_equity_inception.py` and `test_allocator_equity_writer_basis.py` (each seeds `LEGACY_TABLE: []` in its fake). Removing the constant or the guard class early breaks those three files; trim all four in the PR 3 cleanup together. These are in addition to the "fake-table list" files named in RESEARCH Census D.

**mypy** (verbatim, from `analytics-service/`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. pytest only from `analytics-service/`; never `importlib.reload`.

---

### The two shapes of reconstruct handling (OQ1, scope still open; PR 2)

Do not delete `services/equity_reconstruction.py`: the derive path imports from it (`job_worker.py` ~:4094, ~:4193, ~:14404; `services/nav_marks.py` ~:378; `services/okx_opening_balance.py`; `services/ingestion/*.py`). Delete symbols only on zero remaining `grep -a` references.

**Shape R (retire the job kind; RESEARCH recommendation).** Three enqueue paths exist: the fan-out bootstrap loop (function dropped in PR 3, cron unscheduled in PR 2), `request_allocator_holdings_sync` (user/first-sync RPC), and a service-role/owner `force_rebuild` enqueue.
- Stop the user path by re-basing `request_allocator_holdings_sync`: `supabase/schema/functions/request_allocator_holdings_sync.sql` lines 77-108 are the block to remove (the `v_prior_reconstruct` check, the `history_reconstructed_at` read, and the guarded `enqueue_compute_job(... p_kind := 'reconstruct_allocator_history' ...)` with its `EXCEPTION WHEN unique_violation`). Keep line 70-75 (the `poll_allocator_positions` enqueue), `UPDATE api_keys SET sync_status = 'syncing'`, and `RETURN jsonb_build_object('ok', true, 'job_id', v_job_id)`. The latest definer is `20261014120000_api_keys_history_reconstruct_marker.sql`; re-base on it, then check the other tests that pin it (`test_api_keys_history_reconstruct_marker.sql` lists it in `RED-UNDER-SETUP`).
- House style for retiring a kind without breaking retained job rows: `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` lines 1-30: "WHY A GUARD, NOT A CHECK/REGISTRY DROP: ... historical prod compute_jobs rows FK-reference kind=... the registry row + BOTH CHECK constraints STAY". Keep the `compute_job_kinds` rows for both kinds (FK target; `scripts/restore-test-refdata-allowlist.txt:391` lists them). Residual (same file, lines 21-24): a direct service-role INSERT of a retired kind is rejected by the worker's unknown-kind branch as a permanent FAILED, which is fail-loud.
- Handler for stragglers: keep the dispatch arms in `job_worker.py` (~:15964-15969) and make the handler a thin no-op that audits and returns `DispatchResult(outcome=DispatchOutcome.DONE)`, because an absent handler gives `DispatchResult(outcome=FAILED, error_message=f"Unknown job kind: {kind!r}", error_kind="permanent")` (`job_worker.py` ~:15995) and writes `failed_final` rows for any job still queued. The early-return form to copy is `equity_reconstruction.py` ~:7471 (`return DispatchResult(outcome=DispatchOutcome.DONE)` after an audit event, no key id / allocator id / USD in any message). No exact analog exists for a fully inert handler; this one is new, tested by B-07.
- The cap / marker / note machinery (SQL, Python and TS twins, `_capture_history_reconstruct_capped`, `report_orphaned_capped_reconstructs`, `reconstructCappedKeyIds`, the "history reconstruct failed" note) is left inert and removed in a follow-up phase unless the founder says otherwise. The twin tests (`test_fanout_owed_predicate_twins.py`, `test_history_reconstruct_cap_twins.py`, `test_history_reconstruct_cap_orphan_sweep.py`, TS `history-reconstruct-cap-twins.test.ts`, `history-reconstruct-note-predicate-twins.test.ts`) select the NEWEST fan-out definer through `_newest_fanout_body()`; they retire with the fan-out, and a DROP is not modelled by their regexes (Pitfall 8).

**Shape W (writes-only removal; RESEARCH fallback).** Keep the crawl and all enqueue paths; delete only the persist/replace call sites:
- Reconstruct job: `equity_reconstruction.py` ~:7000 (`replace_equity_snapshots_window`), ~:7036 (`replace_equity_snapshots`), ~:7044 (`persist_equity_snapshots`). Refresh job: ~:7726 (`persist_equity_snapshots`) and ~:7654 (`_owed_reconstructs_for_zero_snapshot_book`).
- Existing assertion pattern to turn into the new tests is Analog A above plus the audit-event assertions the same files already carry. The crawl keeps producing the marker (`_mark_api_key_history_reconstructed`, ~:2480), audits, and the trade-read store purge, so every test on those stays and only the snapshot-row assertions flip to "no rows".
- Cost recorded in RESEARCH: wasted exchange traffic and an unreachable "completion" meaning. The marker-driven UI note (`historyReconstructFailed`) keeps firing for a crawl whose product output no longer exists.

Both shapes: the refresh job has no product output except the legacy table (`refresh_allocator_equity_daily` is enqueued only by the fan-out), so under either shape the refresh handler is retired or reduced to the DONE stub.

---

### Cron: `refresh-allocator-equity` unschedule + manifest re-capture (operator step, PR 2)

**Analog:** `docs/runbooks/derivecron-go-live.md`. Rollback block (lines 774-795), manifest step (lines 635-664). The repo rule: cron jobs are not moved by a migration (a PROD migration auto-applies with no human stop; `docs/runbooks/marksource-legacy-chain-move-go-live.md`).
```sql
__GUARD__
SELECT cron.unschedule('derive-allocator-key-dailies'); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') AS job_rows
  FROM m;
```
Substitute `refresh-allocator-equity`; readback is one row, `marker_is_prod`, `job_rows` expected `1,0` (a missing job makes `cron.unschedule` raise, so use the guard-check form to read state). Unschedule by NAME, never by jobid. The marker query comes first: `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();` run with `supabase db query --linked -f <file>` (a leading `--` comment breaks the inline form).

**Manifest:** `node scripts/prod-prober/run.mjs --capture-manifest --out "$SCRATCH/cron-manifest-capture.json"`, `diff` against `scripts/prod-prober/cron-manifest.json`, move into place only if the ONLY change is the removal of the row (`jobid` 17, `"jobname": "refresh-allocator-equity"`, `"schedule": "30 1 * * *"`, `"command": "SELECT enqueue_refresh_allocator_equity_for_all();"`) plus `captured_at`. Never edit the manifest by hand. Then `node scripts/prod-prober/run.mjs --self-test`; the manifest PR is its own PR. Cron must be unscheduled BEFORE PR 3 drops the function (daily failed pg_cron runs and prober drift otherwise).

---

### Runbook retirement banner (docs, PR 2; bridge-outcome-cron.md in PR 1)

**Analog:** `docs/runbooks/flipretry-derived-equity-go-live.md` lines 7, 13, 33, 95, 105: a blockquote that names the date, the phase, the decision and what is now true, then "Original text kept below."
```markdown
> ⛔ **AMENDED 2026-10-07 (Phase 167.1.2.2 DERIVECRON):** the "dormant" framing above is stale (decision D-04). ... The live procedure ... moved to `docs/runbooks/derivecron-go-live.md`; this file stays as the record of the original staged gate. Original text kept below.
```
Apply to `marksource-legacy-chain-move-go-live.md` (its `state`/reading forms count legacy rows; its rollback form `alter_job`s the refresh cron), `navmtm-chain-move-go-live.md`, `ledger-refresh-go-live.md`, `marksource-okx-history-correction.md`, the `marksource-okx-census/*.sql` set, `docs/architecture/adr-0023-audit-event-taxonomy.md:518`, `docs/runbooks/sql-migrations-coverage-2026-05-16.md`, `docs/sql-gate-lineage.md`. History is not rewritten. `src/__tests__/marksource-okx-census-sql.test.ts` pins runbook cron names (~:847, :860): run it after the banner edits. `marksource-okx-nonworking-keys-exec.test.ts` creates its OWN fixture table (~:60) and survives the drop unchanged.

`docs/runbooks/bridge-outcome-cron.md` is rewritten rather than bannered: its "What it computes" describes only the strategy path; add the holding branch on the derived account total (D-03), per account not per symbol; check `OutcomesWidget.tsx` ~:159 and ~:431 wording ("Realized delta from Bridge-driven reallocations", "Realized delta vs held baseline"; no test pins either string).

---

### Census / floor constants moved downward with the reason recorded (PR 3; also upward in PR 1)

**Analog:** the dated comment blocks directly above each constant.

`scripts/mutation-floors.mjs` (`FILES_FLOOR` at line ~1323, `ARMS_FLOOR` at ~3335, `WAIVED_CEILING` at ~3449 as of mapping). House form, a dated line above the constant giving old -> new, what changed, and ONE measured full run:
```javascript
// RAISED 81 -> 82 2026-10-28 (Phase 177 DERIBITFLOWS plan 07): +1 file, test_api_key_flow_prices.sql (...), so 82 of 109 files. MEASURED by ONE full `node scripts/mutation-runner/run.mjs`,
// no file edited during it, exit 0: `scope: FULL 82/82 annotated files`, `lane-concurrency: 4`, `coverage: files 82/109`, `arms: 829/829/0`, `biting: 829`,
// `lane-invocations: 829 ... plus 82 baseline / 82 restore leg(s)` (the two independent tallies AGREE), ... The stale-low direction was observed first:
// `RATCHET STALE: 82 of 109 gate files are now annotated but FILES_FLOOR is still 81. Raise FILES_FLOOR in scripts/mutation-floors.mjs to 82.` WAIVED_CEILING stays 0.
export const FILES_FLOOR = 82;
```
A downward precedent exists at lines ~80-84 ("the floor moved DOWN because two arms were never proven against a production regression"). For this phase write a `LOWERED <old> -> <new> <date> (Phase 176 LEGACYRETIRE ...)` line stating the gate files deliberately retired (the window gate with its 16 `RED-UNDER:` lines, and any of the other three that carry annotations) and the measured run. Never subtract by hand; never lower to make a run green. Because PR 1 adds the bridge gate and PR 3 retires four, each PR re-measures.

`.github/workflows/ci.yml` (`SENTINEL_FLOOR=26`, `ARMS_FLOOR=394` at ~:5197-5198, the contiguous table with row `test_replace_allocator_equity_snapshots_window.sql 15` at ~:4956, and the dated "Re-measured" paragraphs): add a `Re-measured <date> (Phase 176 ...)` paragraph in the same voice, delete the table row, and update the `ARMS_FLOOR` sum comment. `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` re-derives both numbers from the corpus; it is the oracle. The "Read off each file's own sentinel, never off this table" rule applies.

By-name and count pins that move with the retired/added gate files (from RESEARCH Census E; grep each): `src/__tests__/mutation-runner-floors.test.ts`, `mutation-annotation-parser.test.ts`, `gate-family-meta.test.ts` (~:944-945), `lint-sql-gates.test.ts` (~:1169 file count), `drift-check-scripts.test.ts` (~:5021). Other artifacts: `scripts/baseline-content-drift-check.mjs` (`COMPARED_FLOOR` = 134 now; drops by the number of dropped functions), `scripts/dump-sql-functions.ts` (`NAME_SET_RATCHET`; expect `baseline-only` rows until the AUTOREDUMP PR merges, precedent `20260908120000`'s DRIFT-04 row), `supabase/schema/functions/*.sql` (`npm run schema:functions` then `:check`). The baseline dump and `baseline-carried-migrations.txt` are never hand-edited.

Run before pushing each PR: `node scripts/lint-migration-data-dependence.mjs --self-test && node scripts/lint-migration-data-dependence.mjs`; `npx tsx scripts/dump-sql-functions.ts --check`; `node scripts/baseline-content-drift-check.mjs`; `node scripts/lint-sql-gates.mjs --self-test`; the six vitest files above; a full `node scripts/mutation-runner/run.mjs` whenever a gate file is added or removed.

---

### `e2e/helpers/seed-test-project.ts` (PR 1; drop the legacy seed)

**Analog:** itself, lines ~960-1000. Remove the `snapshots` upsert (`.from("allocator_equity_snapshots").upsert(snapshots, { onConflict: "allocator_id,asof" })` and its error throw) but keep the day series: the derived row below it is built FROM `snapshots` (`curve = snapshots.map(...)`, `returns = curve.slice(1).map(...)`), so keep the `snapshots` array as a local day/level generator or rename it, and keep the `allocator_equity_derived` upsert (version 2, `is_trustworthy: true`). The doc comment ~:827 and `src/__tests__/seed-integrity.test.ts` (~:444-483 no-seeding pin) and `OnboardingWizard.noseeed.test.tsx` (~:147-149, becomes vacuous once the table is gone) need matching edits.

---

## Shared Patterns

### Re-base before `CREATE OR REPLACE`
**Source:** `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` lines 22-33; `20261028120000...sql` lines 61-62.
**Apply to:** every migration in PR 1, PR 2 (Option R) and PR 3.
Latest definers at mapping time: `compute_bridge_outcome_deltas` `20260426131718`; `extract_symbol_value_at` `20260421154030`; `enqueue_refresh_allocator_equity_for_all` `20261021120000`; `delete_allocator_api_key` and both replace RPCs `20261028120000`; `request_allocator_holdings_sync` `20261014120000`. Re-grep all migrations for a newer definer against a fresh `origin/main` before writing (the repo adds several migrations a day; the newest file at mapping time is `20261101120000`, so the new file must sort after whatever is newest then). Schema-qualify (`public.`), keep `SECURITY DEFINER` and the existing `search_path`, copy bodies verbatim outside marked blocks, re-issue REVOKE with the full signature when the function is newly created.

### Catalogue-only self-verification (the data-dependence lint)
**Source:** `20261028120000_replace_allocator_equity_snapshots_window.sql` lines 396-470 (and the header lines 54-58).
**Apply to:** every new migration. Read `pg_proc`, `pg_class`/`to_regclass`, `pg_namespace`, `has_function_privilege`, `information_schema`; never an application table. TEST holds PROD's catalogue and none of its data, so a data-reading RAISE can pass PROD and refuse on TEST, and a failed TEST apply blocks the PROD apply. `RAISE NOTICE` is not an exception; an UPDATE/DELETE with no row-conditioned RAISE is allowed. Single-literal `RAISE EXCEPTION` messages. No `CONCURRENTLY`.

### Gate annotations
**Source:** `scripts/mutation-runner/GRAMMAR.md`; `supabase/tests/test_api_key_flow_prices.sql`.
**Apply to:** the new bridge gate and any rewritten gate that joins the mutation corpus. Prose `-- RED-UNDER:` line, then the `-- RED-UNDER-M:` JSON twin on the next line, one unique arm id per twin, measured `occurrences`, a `-- RED-UNDER-SETUP:` file list, a final `ALL N ARMS EXECUTED (...)` notice before `ROLLBACK`. WAIVED_CEILING stays 0.

### Neuter, see RED, restore (repo testing rule)
Every data-integrity or user-facing gate must be shown to fail: edit a copy, see the named arm RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work). Money-math oracles are independent invariants. Always `grep -a`. A new or removed `supabase/tests` file or arm moves several censuses: grep them all.

### Ship rules every PR carries
- CHANGELOG entry in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B`), mechanism in `CLAUDE.md` ("CHANGELOG discipline"); `VERSION` and `package.json` byte-equal; never `npm version`. Entry sections use this repo's vocabulary (`### Fixed/Added/Changed/Removed/Tests/Notes/Security/Root cause/Why`). Never quote a credential-shaped literal.
- Never write a CI skip token in any commit message or PR body, not even to deny it.
- A ship branch changes nothing under `.planning/`; planning records go to main afterwards.
- No AI authorship trailers in commits (founder 2026-10-20).
- PROD reads and writes: marker query first, counts only, no ids in tracked text. The Production reviewer gate is gone, so migration-reviewer, rls-policy-auditor and the data-dependence lint run before merge.
- Public repo: no PROD ids, home paths or account numbers in any tracked text, including this file.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Body of the derived-account-delta helper (`extract_derived_account_delta` or similar) | SQL function | transform | No existing function reads `allocator_equity_derived` payload arrays in SQL. Use the `[ASSUMED]` skeleton in RESEARCH "Code Examples" plus `extract_delta.sql` for NULL-on-missing-endpoint semantics; test against an independent product (RESEARCH A5). |
| Retired no-op handler for `reconstruct_allocator_history` / `refresh_allocator_equity_daily` (Shape R) | job handler | event-driven | No existing handler is an inert DONE stub. Compose from the early-return `DispatchResult(outcome=DispatchOutcome.DONE)` form (~:7471) and the unknown-kind branch (`job_worker.py` ~:15995); keep the dispatch arms so straggler jobs finish `done`, not `failed_final`. |

## Conflicts surfaced (Rule 7: not averaged)

1. **Transaction control in migrations.** `20260908120000`, `20261028120000`, `20261030120000` use explicit `BEGIN;`/`COMMIT;`; `20260710130000`, `20260716090000`, `20260717233529` and the 164.9.3 migration review use none (reviewer invariant #14). Recommendation: follow the invariant (none; `SET LOCAL lock_timeout`), because it is the one the reviewer agent enforces. The `20260908120000` header's argument for an explicit transaction (a RAISE must roll the removal back) is covered by the implicit wrap.
2. **Phase 151 AUM-04 versus the 181 rule.** About 15 test blocks pin `allocatorEligibleApiKeyIds` excluding strategy-linked keys; they go RED on the new rule by design. `managerSideKeyIds` (`live-holdings-summary.ts` ~:298) and the composer's `excludedManagerSide` disclosure become inert (RESEARCH OQ5: leave inert, follow-up cleanup).
3. **Stored holding-branch outcomes (OQ3).** `COALESCE(new, old)` in the holding update would leave a mixed-basis column where the derived curve lacks a day. D-03 reads "keep their values"; the planner raises recompute to the founder with the R3 PROD count.

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/schema/functions/`, `supabase/tests/`, `scripts/` (mutation runner, floors, prober, lints), `.github/workflows/ci.yml`, `analytics-service/services/` and `analytics-service/tests/`, `src/lib/`, `src/app/(dashboard)/allocations/`, `src/__tests__/`, `e2e/helpers/`, `docs/runbooks/`, `TODOS.md`, `.planning/ROADMAP.md`.
**Files scanned:** about 60 opened or excerpted; every analog path verified tracked with `git ls-files`.
**Pattern extraction date:** 2026-10-31
