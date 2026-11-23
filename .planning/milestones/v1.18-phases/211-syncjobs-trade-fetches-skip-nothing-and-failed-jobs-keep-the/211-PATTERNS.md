# Phase 211: SYNCJOBS - Pattern Map

**Mapped:** 2026-11-14
**Files analyzed:** 20 rows in the table below (8 new files, one of them generated, and 12 modified)
**Analogs found:** 20 / 20 rows have an analog. Three sub-cases inside those rows have only a partial or no analog (the route-level `fetch_trades` happy-path test, the SITE B lost-race success arm, the 7-arg behavioural arm); see "No Analog Found".
**Tracked-source gate (#3645):** every existing repo path named in this file (about 55; extracted by regex plus the analog list and checked with `git ls-files --error-unmatch`) is git-tracked in this worktree. Planned new files (`<ts>_enqueue_dedup_record_retract.sql`, `trade_resume.py`, the new tests, `_record_enqueue_dedup.sql`) do not exist yet by design. No `.gsd/capabilities` mirror paths appear.
**Citation rule:** line numbers are measured at this worktree (HEAD `d3ec031da`) and are for the planner's orientation. Durable text (comments, SUMMARYs) must cite by symbol, per CLAUDE.md `[164.7-CITATION-DRIFT-01]`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_enqueue_dedup_record_retract.sql` (new): side table + helper + 2 re-based overloads + ACL + catalogue verify | migration | CRUD (SECDEF writer) + request-response | `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` (SECDEF + ACL + verify) and `20260919120000_strategy_sync_cursors.sql` (deny-all side table) | role-match, two analogs (no single file does both) |
| (same file) re-base of `_enqueue_compute_job_internal` 10-arg | migration (function re-base) | request-response | `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql` (the body to copy verbatim, plus its `prod-body-ack`, REVOKE/GRANT, COMMENT blocks) | exact |
| (same file) re-base of 7-arg overload | migration (function re-base) | request-response | `supabase/schema/functions/_enqueue_compute_job_internal.sql` section 1 (source: `20260716090000`) | exact |
| `supabase/migrations/down/<ts>-rollback.sql` (new) | migration (rollback) | batch | `supabase/migrations/down/20261106120000-rollback.sql` | exact |
| `supabase/schema/functions/*.sql` (regenerated, never hand-edited) | generated snapshot | transform | `npm run schema:functions` (`scripts/dump-sql-functions.ts`) | n/a (tool output) |
| `supabase/tests/test_enqueue_dedup_record_retract.sql` (new, LANE-ONLY / pg-lane gate with RED-UNDER) | test (SQL gate) | CRUD + request-response | `supabase/tests/test_compute_job_metadata_merge.sql` (arm structure, twins, ACL arms, body-shape arms) + `test_enqueue_compute_job_dedupe_non_terminal.sql` (calling `enqueue_compute_job` as service_role, dedup arms) + `test_strategy_sync_cursors_rls.sql` (RLS/grant arms) | role-match, three analogs |
| `scripts/mutation-floors.mjs` (modified: `FILES_FLOOR` +1, `ARMS_FLOOR` +N) | config | transform | its own dated paragraphs above each constant | exact |
| `analytics-service/services/trade_resume.py` (new leaf): `high_water_floor_iso`, `load_strategy_high_waters` | service/utility | CRUD (read-only, fail-open) | `analytics-service/routers/cron.py` `_floor_to_utc_day_ms` / `_high_water_floor_iso` / `_load_strategy_high_waters` (move, do not copy) | exact (it IS the source) |
| `analytics-service/routers/cron.py` (modified: import the moved helpers under the old names) | route | request-response | itself; Pattern 3 in RESEARCH | exact |
| `analytics-service/routers/exchange.py` `fetch_trades` (modified: seed) | route | request-response | `routers/cron.py` cron_sync high-water seeding block (`_load_strategy_high_waters` call, ~2395-2410) | role-match |
| `analytics-service/services/job_worker.py` `run_sync_trades_job` (modified: split `since_ms`) | service (worker handler) | request-response + event-driven (queue) | same file, `parse_since_ms(None, preferred=since_iso)` at the long-fetch tail (~14541) for the "fills cursor only" call shape | partial |
| `analytics-service/services/job_worker.py` `run_stitch_composite_job._stamp_failed` + new entry read (modified) | service (worker handler) | request-response | same file, `_read_entry_publish_state` block in `run_derive_broker_dailies_job` (~4755-4838) | exact |
| `analytics-service/tests/test_fetch_trades_resume_seed.py` (new) | test | request-response | `tests/test_exchange_router_c0202.py` (fixture + handler call) + `tests/test_cron_router.py` `_FakeTradesQuery` (filtering fake) | partial (no existing test reaches `fetch_all_trades` in this route) |
| `analytics-service/tests/test_sync_trades_resume_seed.py` (new) | test | request-response | `tests/test_job_worker.py` `TestSyncTradesPhase2PartialBatchFailure` (~3640) + `test_cron_router.py` `_FakeTradesQuery` | role-match |
| `analytics-service/tests/test_stitch_composite_entry_snapshot.py` (new) | test | request-response | `tests/test_ledger_refresh_composite_nondestructive.py` `_run` harness + `tests/test_ledger_refresh_reuse_collision.py` `TestEntryPublishStateReadFailsTransient` | exact |
| `analytics-service/tests/test_stitch_composite_job.py` (modified: `_FakeSupabase` per-read status sequence + skip-N-reads) | test fixture | request-response | itself (`_FakeSupabase`, `_FakeQuery.execute`) | exact |
| `analytics-service/tests/test_ledger_refresh_composite_nondestructive.py` (modified: re-point 4 marked stamp-read tests) | test | request-response | itself | exact |
| `analytics-service/tests/test_compute_job_metadata_merge_parity.py` + `src/lib/ledger-refresh-marker.test.ts` (modified: read the helper snapshot) | test (parity) | transform | themselves | exact |
| Comment updates: `services/ingestion/long_fetch.py`, `services/job_worker.py` REUSE-01 block, `src/lib/ledger-refresh-marker.ts`, `tests/test_ledger_refresh_reuse_collision.py::_Queue` docstring | comments | n/a | themselves | exact |
| `CHANGELOG.md`, `VERSION`, `package.json`, `TODOS.md` | docs/config | n/a | CLAUDE.md "CHANGELOG discipline" | n/a |

---

## Pattern Assignments

### Migration: `<ts>_enqueue_dedup_record_retract.sql` (migration, SECDEF writer + deny-all side table)

There is no single analog. Compose from three tracked files, in this order inside the one migration: (1) side table and RLS, (2) helper function, (3) both overload re-bases, (4) ACL for all three functions, (5) catalogue-only verify.

#### Header and lock timeout

**Analog:** `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` lines 1-67. House style: a long WHY/WHAT/WHAT-IT-DOES-NOT-DO header, then:

```sql
SET LOCAL lock_timeout = '3s';
```

No explicit `BEGIN`/`COMMIT` (migration-reviewer invariant 14). **Do not copy** the trailing `COMMIT;` at line 378 of `20260919120000_strategy_sync_cursors.sql`; that file predates the rule (the 20261106 and 20261101 files carry none). The header must also state the D11-5 census with both background route names (`cron/reconcile-strategies`, `cron/sync-funding`) and the kind-scope containment (RESEARCH Open Question 1, D11-8).

#### Step 1: the side table (deny-all RLS, REVOKE then positive GRANT)

**Analog:** `supabase/migrations/20260919120000_strategy_sync_cursors.sql` lines 101-214. Columns come from RESEARCH "Design Details" item 7 (`id`, `job_id` FK to `compute_jobs` ON DELETE CASCADE, `caller_metadata jsonb NOT NULL`, `retracted_marker text`, `deduped_at`), plus a `CREATE INDEX` on `job_id`.

```sql
-- strategy_sync_cursors.sql:101-108 (table + COMMENT ON TABLE shape)
CREATE TABLE IF NOT EXISTS strategy_sync_cursors (
  strategy_id  UUID PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  ...
);
COMMENT ON TABLE strategy_sync_cursors IS '...';
COMMENT ON COLUMN strategy_sync_cursors.strategy_id IS '...';

-- :169-178 (RLS: ENABLE, not FORCE; one FOR ALL deny policy; COMMENT ON POLICY)
ALTER TABLE strategy_sync_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategy_sync_cursors_deny_all ON strategy_sync_cursors;
CREATE POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors
  FOR ALL
  USING (false)
  WITH CHECK (false);
COMMENT ON POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors IS '...';

-- :185 and :214 (REVOKE the client roles, then the POSITIVE half, which is not optional)
REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE strategy_sync_cursors TO service_role;
```

Adaptations to carry (all grounded in RESEARCH Pitfall 6 and A4):
- Use plain `CREATE TABLE` (not `IF NOT EXISTS`) like `20261101120000_api_key_flow_prices.sql:88`; the name is new, so a collision should fail loud.
- Keep ENABLE and NOT FORCE (the SECDEF helper is a WRITER; FORCE could refuse the INSERT and abort an enqueue). The strategy_sync_cursors block at lines 160-168 is the written reason to copy into this file's comments, retargeted to "SECDEF writer".
- **Grant shape, ONE recommendation:** `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated, service_role;` then `GRANT SELECT ON ... TO service_role;` (the `api_key_flow_prices` form, `20261101120000...sql:134-135`, minus INSERT). Reason: the only writer is the SECDEF helper, which runs as the table owner and needs no table grant, so a service_role INSERT grant would be unused authority; service_role keeps SELECT for operators and the gate's positive arm. The two rejected shapes, flagged per Rule 7: `GRANT ALL ... TO service_role` (`strategy_sync_cursors:214`) is right THERE because `cron.py` writes that table directly through PostgREST (its lines 187-214 "positive half" lesson is about a DIRECT writer); `GRANT SELECT, INSERT` (`api_key_flow_prices`) is right there because a worker inserts directly. Neither applies here. Cost accepted (RESEARCH A4): a future direct service_role writer gets 42501, loudly. The gate needs `has_table_privilege('service_role', ..., 'SELECT')` true, `'INSERT'`/`'UPDATE'`/`'DELETE'` false, and anon/authenticated/PUBLIC holding nothing via `aclexplode(relacl)`. The migration's own verify block must assert only catalogue facts its own gate twins can survive (see the "Deliberately NOT asserted" note at `20261101120000...sql:137-142`: a verify that asserts the mutated lines would abort the apply of the gate's own twin).
- Every value rule as a NAMED constraint (`api_key_flow_prices_*_chk` style, `20261101120000...sql:96-103`), so the gate can name which constraint refused. The size CHECK mirrors `compute_jobs_metadata_size_bounded` (`octet_length(metadata::text) <= 8192`); note D11-11 says oversize is recorded as `{"oversize_bytes": n}` in the helper rather than raised, so the CHECK is a backstop, not the policy.
- FK on delete cascade: add NO delete-guard trigger. If one is ever added it must exempt `quantalyze.sanitize_in_progress = 'on'` (see the column COMMENT at `20261101120000...sql:109-110` for the sentence to copy).

#### Step 2: the new SECDEF helper

**Analog:** `20261106120000_refusalrace_metadata_merge_rpcs.sql` lines 97-144. Plain `CREATE FUNCTION` (not OR REPLACE) for a new name, `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`, a long `COMMENT ON FUNCTION`.

```sql
CREATE FUNCTION public.retract_ledger_refresh_marker(p_job_id uuid, p_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_marker      text;
  ...
BEGIN
  UPDATE public.compute_jobs
     SET metadata = (metadata - 'source')
                    || jsonb_build_object('refresh_marker_retracted', metadata ->> 'source',
                                          'correlation_id', p_correlation_id)
   WHERE id = p_job_id
     AND status <> 'done'
     AND (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
  RETURNING metadata ->> 'refresh_marker_retracted' INTO v_marker;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'retracted', 'marker', v_marker);
  END IF;
  ...
```

The new helper (`_record_enqueue_dedup`, skeleton in RESEARCH "Code Examples") CALLS this function (`v_res := public.retract_ledger_refresh_marker(...)`), never re-writes its UPDATE. Constraints the skeleton must honour, all from existing gates:
- Write the "caller has no marker" test so the Python/TS parity regex `->>\s*'source'\)\s*IN\s*\(([^)]*)\)` (`tests/test_compute_job_metadata_merge_parity.py` `_SOURCE_LIST_RE`) still sees it, or extend both parity tests with a second regex (RESEARCH Pitfall 4, Code Examples note on `COALESCE`). The `COALESCE(... ->> 'source','')` spelling does NOT match that regex.
- A caller with `correlation_id` and no `source` at all (the `process_key_long` tail sends exactly `{correlation_id}`) must count as "no marker"; a bare `NOT (NULL IN (...))` is NULL and silently skips the retraction. The gate needs an arm for that exact caller.
- Skip everything when `p_parent_job_ids` is non-empty (D11-10) and for NULL / `{}` / non-object metadata (D11-11).

#### Step 3: re-base both overloads (verbatim plus four call sites)

**Analog (10-arg):** `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql`. Re-base from this body, not from the generated snapshot (the snapshot is a derived view). The two return sites to instrument:

```sql
-- :645-648 optimistic look-up hit  -> SITE A
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

-- :706-749 lost-race re-read, after the NULL raise block -> SITE B
  IF v_new_id IS NULL THEN
    ... RAISE EXCEPTION 'enqueue race lost: ...' USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;
```

The fresh-insert return (`IF v_new_id IS NOT NULL THEN RETURN v_new_id;`, :664-666) is NOT a dedup and gets nothing.

**Analog (7-arg):** `supabase/schema/functions/_enqueue_compute_job_internal.sql` section 1 (generated from `20260716090000_retire_compute_analytics_kind_rpc_guard.sql`, lines 5-~170 of the snapshot). Latest 7-arg source is `20260716090000`; nothing newer (RESEARCH, verified by grep). It is unreachable (42725), so its proof is a body-text pin (D11-13).

**Constraints enforced by existing gates (do not violate):** `supabase/tests/test_enqueue_internal_destrict.sql` counts exactly four `SELECT id INTO v_new_id` re-reads in the 10-arg body, zero `INTO STRICT` in both, requires the `serialization_failure` raise and the `p_kind = 'compute_analytics'` guard to survive. Call the helper with `PERFORM public._record_enqueue_dedup(...)` only; add no new `SELECT id INTO v_new_id`.

#### Step 4: ACL restated after the re-base (default-grant event trigger)

**Analog:** `20261024120000_fan_in_graph_and_decision_cascade.sql:757-790`. Name every overload with its full argument list:

```sql
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) IS
  'Private shared implementation ... (Phase 163 OPS-08, parity with the '
  ...
```

The `COMMENT` MUST keep `Phase 163 OPS-08` verbatim (`test_enqueue_internal_destrict.sql` greps the catalog for it). The 7-arg REVOKE/GRANT names the signature `(uuid, uuid, text, text, uuid[], text, jsonb)`, as `20260515130001` line 62 does (RESEARCH "ACL / catalog text"). The helper gets its own REVOKE/GRANT/COMMENT exactly like `20261106120000...sql:149-153`.

#### Step 5: catalogue-only verify (TEST has no data)

**Analog:** `20261106120000_refusalrace_metadata_merge_rpcs.sql:158-202` (function ACL arms) plus `20260919120000_strategy_sync_cursors.sql:231-376` (table arms: `relrowsecurity`, `pg_policy.polcmd = '*'`, `information_schema.columns` shape, `has_table_privilege`).

```sql
-- 20261106120000...sql:158-198 (copy the loop, extend v_names with the helper, add the two overloads)
DO $$
DECLARE
  v_fn_oid OID; v_name TEXT;
  v_names  TEXT[] := ARRAY['mark_compute_job_kept_figures', 'retract_ledger_refresh_marker'];
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT p.oid INTO v_fn_oid FROM pg_proc p
     WHERE p.proname = v_name AND p.pronamespace = 'public'::regnamespace;
    IF v_fn_oid IS NULL THEN RAISE EXCEPTION 'Migration 20261106120000: % function missing', v_name; END IF;
    IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN ... END IF;
    IF NOT COALESCE((SELECT 'search_path=public, pg_catalog' = ANY(p.proconfig)
                       FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN ... END IF;
    IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN ... END IF;
    IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN ... END IF;
    IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN ... END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN ... END IF;
  END LOOP;
```

Caution for the two overloads of `_enqueue_compute_job_internal`: `pg_proc.proname` matches both, so resolve by `to_regprocedure('public._enqueue_compute_job_internal(uuid,uuid,text,text,uuid[],text,jsonb,uuid,uuid,timestamptz)')` and the 7-arg signature, not by name alone. Verify must read no `compute_jobs` rows and raise on no data-dependent condition (`scripts/lint-migration-data-dependence.mjs` fails CI; `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`). Single-literal `RAISE` format strings.

#### VAC-04 pragmas (one per re-based function whose PROD body differs from snapshot)

**Analog:** `20261024120000_fan_in_graph_and_decision_cascade.sql:205-232` (the `-- prod-body-ack: <sha256>` lines and the "EARNED, not pasted" warning). The hash is the `live` column of `node scripts/sql-body-normalize.mjs --diff-bodies <new snapshot> <(git show origin/main:supabase/schema/functions/<fn>.sql)`, NOT `--hash` of the file. Both overloads now change, so the 7-arg gets its own pragma. The helper has no PROD body and needs none.

---

### `supabase/migrations/down/<ts>-rollback.sql` (migration rollback)

**Analog:** `supabase/migrations/down/20261106120000-rollback.sql` (header: manual, off the auto-apply path, "CALLERS FIRST", "WHAT ROLLING BACK COSTS", "THE MIGRATION LEDGER ROW IS LEFT IN PLACE"; body `BEGIN; SET lock_timeout = '3s'; DROP FUNCTION IF EXISTS ...`). For this phase the rollback restores BOTH overload bodies (from `20261024120000` and `20260716090000`), drops the helper, and per the `20261101120000` precedent KEEPS every stored side-table row (do not drop the table) or states plainly that it does.

---

### `supabase/tests/test_enqueue_dedup_record_retract.sql` (SQL gate; pg-lane / LANE-ONLY with RED-UNDER annotations)

**Primary analog:** `supabase/tests/test_compute_job_metadata_merge.sql` (586 lines). Copy its structure, not its content.

**Header contract** (lines 1-87): background, arm list "LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's FIRST `TEST FAILED (N)` must name its own arm", the sentence "Every `TEST FAILED (N)` raise sits DIRECTLY in the DO body (the mutation runner reads an identity only from a single-frame `inline_code_block` raise); the pg_temp helpers return values and never raise an identity", "pgTAP is NOT installed", and:

```sql
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql", ... ,"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql"]}

BEGIN;
...
DO $$ ... END $$;   -- whole file BEGIN ... ROLLBACK (see :72)
```

**RED-UNDER-SETUP apply list for the new gate.** Template: the list in `supabase/tests/test_fan_in_lock_order_race.sql:124` (it ends at `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql`, and it is the one that already carries the enqueue chain: fixtures 01, 02, 03, 07, 11, 15, 20, 21, 23, 24, 27, 36, then `20260411144407`, fixture 04, fixture 37, `20260416125430` ... `20261009120000`, fixture 40, `20261024120000`). Then APPEND `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` (the helper calls `retract_ledger_refresh_marker`) and the new migration. RESEARCH assumption A1 stands: verify by running the lane; add missing fixtures if it fails to apply.

**Lane placement and the `LANE-ONLY` marker (located; the new gate should NOT carry one).** `LANE-ONLY` is a real convention: a one-line JSON header that says why a gate cannot run on the local-stack lane behind `sql-tests`. Measured examples: `supabase/tests/test_fan_in_lock_order_race.sql:123`, `test_sync_status_bridge_lock.sql:101`, `test_mark_rpc_bridge_advisory_lock.sql:107` (all `dblink`, because separate backends need COMMITTED seeds and a trust-auth loopback) and `test_prod_prober_cadence.sql:182` (a pg-net stand-in):

```sql
-- LANE-ONLY: {"object":"dblink","fixture":"scripts/pg-lane/fixtures/36-fixture-dblink.sql","job":"sql-mutation","reason":"Every arm drives two or three dblink sessions back into the database it runs in ... The arms execute on the pg-lane under sql-mutation."}
```

Such files drop the `BEGIN ... ROLLBACK` wrapper (their seeds are committed; header lines 90-100 of `test_fan_in_lock_order_race.sql`). The new gate needs only one session (dedup hit, retraction, record, ACL, RLS) so it is NOT lane-only: copy the BOTH-LANES contract from `test_enqueue_race_loss_40001.sql` ("no dblink, no psql meta-commands, so the file runs on BOTH lanes: the pg-lane under sql-mutation and the local Supabase stack under sql-tests", whole file `BEGIN; DO $$ ... $$; ROLLBACK;`). Consequence the planner must carry: on the `sql-tests` leg the file runs against the committed dump plus the D-F replay of the new migration, so its seeds must work on both, and every assertion stays scoped to its own fixture ids. Add a `LANE-ONLY` line ONLY if the SITE B arm turns out to need dblink (see the SITE B subsection; it does not).

**Arm shapes to copy**

ACL arm (twin is a post-apply `sql` step, because an `edit` widening the GRANT would trip the migration's own verify during apply; `test_compute_job_metadata_merge.sql:160-195`):

```sql
  -- RED-UNDER: ... GRANT EXECUTE ... TO authenticated ...
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.mark_compute_job_kept_figures(uuid) TO authenticated"}]}
  v_oid := to_regprocedure('public.mark_compute_job_kept_figures(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): ... does not exist - this gate has nothing to test and must not skip';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN ...
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN ...
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN ...
```

Behavioural arm whose twin edits the migration (`:229-251` for the shape; mutation JSON with a MEASURED `occurrences`, `:237`):

```sql
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"CASE WHEN jsonb_typeof(metadata) = 'object'\n ...","replace":"jsonb_build_object('read_refusal_kept_figures', true)","occurrences":1}]}
```

For this gate each twin edits the NEW migration copy. One twin per return site of each overload: removing the `PERFORM public._record_enqueue_dedup(...)` line at SITE A (the optimistic look-up) must red a "dedup hit records" arm; at SITE B (lost race) a separate arm. SITE B needs a lost-race fixture; study `supabase/tests/test_enqueue_race_loss_40001.sql` (4 twins) for how it forces the re-read branch. RESEARCH notes the dedup is LAYERED (look-up AND the partial unique index): see the warning at `test_enqueue_compute_job_dedupe_non_terminal.sql:161-176` — a twin that removes only one arbiter "proves nothing"; a SITE A twin must be measured biting, and SITE B only fires when the optimistic look-up misses (so its twin may need to neuter the look-up too).

Body-shape arms (the only way to pin the unreachable 7-arg overload, and for "reads compute_jobs only where expected"), `test_compute_job_metadata_merge.sql:526-581`:

```sql
  v_src := regexp_replace(pg_get_functiondef(v_oid), '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', '', 'g');
  IF v_src IS NULL THEN RAISE EXCEPTION 'TEST FAILED (12): the marker definition came back NULL, ...'; END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, 'compute_jobs', 'g');
  IF v_n <> 1 OR substr(v_src, strpos(v_src, 'compute_jobs') - 14, 14) IS DISTINCT FROM 'UPDATE public.' THEN
    RAISE EXCEPTION 'TEST FAILED (12): ...';
```

For the 7-arg: assert the comment-stripped definition contains the helper call twice (`PERFORM public._record_enqueue_dedup`), as RESEARCH Pitfall 5 states; a behavioural arm is possible only via an in-transaction `DROP FUNCTION` of the 10-arg overload then a direct 7-arg call (A2, unproven: say so in the arm if it is body-pin only).

Untwinned control arm convention (`:497-524`): an illustration that can never fail from a code change raises `ARM 11 FAILED (control)`, NOT `TEST FAILED (N)`, because "a `TEST FAILED (N)` identity here would be a section with no twin, which mutation-annotation-parser.test.ts refuses".

**Seeding helpers** (`:91-125`): `pg_temp` functions seed `auth.users` / `profiles` / `strategies` / `compute_jobs`, one in-flight job per strategy and kind (the partial unique index). Two adaptations are required for this gate:
1. `mc_job` seeds kind `'compute_analytics'`, the RETIRED kind, which the enqueue function rejects with `invalid_parameter_value`. Seed marker-capable kinds (`derive_broker_dailies`, `stitch_composite`, `compute_analytics_from_csv`; their kind CHECKs arrive with migrations `20260614120000`, `20260710130000`, `20260522111858`, all in the apply list) and use `process_key_long` as the single non-marker kind for the kind-scope arm: it is verified usable (the dedupe gate `test_enqueue_compute_job_dedupe_non_terminal.sql` already enqueues it on this apply list). `reconcile_strategy` also exists in the kind CHECK of `20260416125430` (line 135, in the list) but is not exercised by any current gate, so prefer `process_key_long`.
2. Seed rows directly and then call `enqueue_compute_job(...)` as `service_role` so the call dedups onto the seeded row.

**How to call the RPC** (`test_enqueue_compute_job_dedupe_non_terminal.sql:148-199`):

```sql
  SET LOCAL ROLE service_role;
  first_id := enqueue_compute_job(
    p_strategy_id => strat_c,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'pyapi09-b1-first')
  );
  ...
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (B1): ...';
  END IF;
  ...
  RESET ROLE;
```

`RESET ROLE` before every `RAISE EXCEPTION` that follows a `SET LOCAL ROLE`. `enqueue_compute_job` is SECDEF and its `_assert_owner` gate short-circuits when `auth.uid()` is NULL (same file :149-152). Scope every assertion to the fixture's literal strategy id, never a global count (shared TEST DB, `:50-52`).

**SITE B (lost-race return) forcing mechanism, read from `supabase/tests/test_enqueue_race_loss_40001.sql` (lines 38-62, 117-170):** inside the file's one transaction, a `BEFORE INSERT` row trigger on `public.compute_jobs`, bound by its `WHEN` clause to the file's own fresh strategy id and kind, inserts a COMPETING in-flight row once, so the RPC's own INSERT loses to the partial unique index and `ON CONFLICT DO NOTHING` returns no row. The once-only arming is a SEQUENCE (`nextval(...) > 1` returns early), because a sequence is not rolled back with the inner exception block, so the counters survive for the assertions. Objects live in a throwaway schema created in the same transaction:

```sql
  CREATE SCHEMA enq40001_gate;
  CREATE SEQUENCE enq40001_gate.shots;
  CREATE SEQUENCE enq40001_gate.flips;
  CREATE FUNCTION enq40001_gate.before_ins() RETURNS trigger ...   -- :130, nextval('enq40001_gate.shots') > 1 => RETURN NEW
  CREATE TRIGGER enq40001_gate_bi BEFORE INSERT ON public.compute_jobs ...   -- :160, WHEN-bound to this file's strategy and kind
  CREATE TRIGGER enq40001_gate_ai AFTER INSERT ON public.compute_jobs ...    -- :164, flips the competitor to done
```

That file's `AFTER INSERT` trigger moves the competitor to `done` so the re-read finds nothing and the function RAISES 40001. **For SITE B's SUCCESSFUL return, copy the `BEFORE INSERT` half only and OMIT the `AFTER INSERT` flip**: the competitor stays in flight, the re-read finds it, and the function takes the new `PERFORM public._record_enqueue_dedup(v_new_id, ...)` line and returns the winner's id. Every call sits in an inner `BEGIN/EXCEPTION` block that only captures SQLSTATE/SQLERRM, with all assertions after it (lint R1). Seed the competitor with a marker (`source = 'ledger-refresh'`) and have the call carry `correlation_id` and no marker, so the SITE B arm observes the retraction and the side-table row, not merely the id. The SITE B twin removes the second `PERFORM public._record_enqueue_dedup(...)` in the migration copy; the SITE A twin removes the first. SITE A is only reachable when the optimistic look-up hits, so the SITE A arm must NOT arm the trigger (`shots` stays 0, which doubles as the proof that the look-up, not the race, served it). Removing only one of the two dedup arbiters can leave a twin non-biting (`test_enqueue_compute_job_dedupe_non_terminal.sql:161-176`), so measure each twin on the lane before trusting it. This file's twin pattern is also the model for a layered, two-step `RED-UNDER-M` (its R1 twin edits the raise AND stands down the migration's own verify guard on the scratch copy).

**RLS/grant arms for the side table** copy `supabase/tests/test_strategy_sync_cursors_rls.sql`: a pristine-ACL arm first (`GRANT 1`, `aclexplode(relacl)` requires PUBLIC/anon/authenticated hold nothing, line ~254), then restore client grants in the seeding context so the POLICY arms are falsifiable (a 42501 from the grant layer must never be read as proof the policy fired; header lines 37-84), then `RLS 1` (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY` twin, :282) and `RLS 2` (policy narrowed to SELECT, :305), `POLICY 1..4` (`USING (false)` -> `(true)`, :351-498) and a precondition arm before the INSERT probe (:516-521). Each policy arm asserts no exception was raised BEFORE it asserts a row count. Fixture `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` is in the apply list so the bootstrap grants exist. NEW requirement specific to this table: an arm proving the SECDEF helper CAN insert into the table while the client roles cannot read or write it.

**Censuses a new gate FILE moves** (RESEARCH "D11 SQL Facts"; all measured there, re-measure at plan time): `scripts/mutation-floors.mjs` `FILES_FLOOR` +1 and `ARMS_FLOOR` +1 per twinned arm, each with a dated paragraph above the constant; `WAIVED_CEILING` stays 0; `src/__tests__/mutation-runner-floors.test.ts` re-derives both and fails in BOTH directions; run `node scripts/mutation-runner/run.mjs --parse-only` and `node scripts/lint-sql-gates.mjs --self-test` then `node scripts/lint-sql-gates.mjs`. Existing gates that run against the NEW body on the real-DB lane and must be re-run: `test_enqueue_internal_destrict.sql`, `test_compute_analytics_kind_retired.sql`, `test_enqueue_race_loss_40001.sql`, `test_enqueue_compute_job_dedupe_non_terminal.sql`, `test_resync_retry_single_job.sql`, `test_fan_in_lock_order_race.sql`, `test_fan_in_failure_cascade.sql`.

---

### `analytics-service/services/trade_resume.py` (new leaf; move, do not copy)

**Source to MOVE verbatim:** `analytics-service/routers/cron.py`: `_floor_to_utc_day_ms` (527-545), `_high_water_floor_iso` (547-558), `_load_strategy_high_waters` (560-608). `_MS_PER_UTC_DAY = 86_400_000` is at `cron.py:466` and is used by `_floor_to_utc_day_ms`; decide whether `_floor_to_utc_day_ms` moves too (cron still uses it at ~1091 as a module global; only the two named helpers need to stay importable from `routers.cron`).

```python
# cron.py:547-558
def _high_water_floor_iso(timestamp: str) -> str:
    parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    return parsed.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

# cron.py:560-608 (the exact chain the cron tests pin: .eq("is_fill", False), order desc, limit 1)
def _load_strategy_high_waters(
    supabase: Any, strategy_ids: list[str]
) -> tuple[dict[str, str | None], str | None]:
    mapping: dict[str, str | None] = {}
    errors: list[str] = []
    for sid in strategy_ids:
        try:
            result = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", sid)
                .eq("is_fill", False)
                .order("timestamp", desc=True)
                .limit(1)
                .execute()
            )
            newest = rows(result)
            mapping[sid] = (
                _high_water_floor_iso(newest[0]["timestamp"]) if newest else None
            )
        except Exception as exc:
            logger.exception("cron_sync: stored-high-water read failed for strategy %s — "
                             "failing OPEN to a full-reach fetch for it this tick", sid)
            mapping[sid] = None
            errors.append(f"{sid}: {type(exc).__name__}: {exc}")
    return mapping, ("; ".join(errors) if errors else None)
```

**Imports/logger convention for the new leaf** (`cron.py:19,24`, `exchange.py` uses the same logger): `from services.db import rows` and `logger = logging.getLogger("quantalyze.analytics")` so existing `caplog` expectations keep working. A services-level leaf creates no import cycle: `routers/*` import `services.*` at module level; `job_worker.py` imports `routers.*` only lazily (RESEARCH "Best home").

**Edit in `routers/cron.py`** (Pattern 3, RESEARCH): replace the definitions with
`from services.trade_resume import high_water_floor_iso as _high_water_floor_iso, load_strategy_high_waters as _load_strategy_high_waters` (or keep the leaf's names underscore-prefixed). Call sites stay module-global lookups (`cron.py:~2404` `_load_strategy_high_waters(supabase, _hw_strategy_ids)`). RESEARCH measured zero cron tests patch either name; CONTEXT still requires the names to remain importable from `routers.cron`. `parse_since_ms` must stay a module global of `routers.cron` (patched in many cron tests via `patch.object(cron_mod, "parse_since_ms", ...)`); do not move it. The log line text says `cron_sync:`; the shared version's message should be caller-neutral or take a prefix, but `tests/test_cron_router.py` `TestHighWaterLookupFailsOpen` (7027+) asserts the envelope field `strategy_high_water_lookup_error` contains `RuntimeError` and the strategy id (7057-7058), so the error STRING format `f"{sid}: {type(exc).__name__}: {exc}"` must not change.

---

### `analytics-service/routers/exchange.py::fetch_trades` (route, request-response)

**Current code to change** (`exchange.py:1766-1820`):

```python
    exchange = create_exchange(key_data["exchange"], api_key, api_secret, passphrase)
    since_ms = parse_since_ms(key_data.get("last_sync_at"))     # <-- the defect (1767)
    ...
    if since_ms is not None:
        try:
            span = (supabase.table("trades").select("timestamp").eq("strategy_id", req.strategy_id)
                    .order("timestamp", desc=False).limit(1).execute())
            span_max = (... .order("timestamp", desc=True).limit(1).execute())
            ...
                if span_days < STRATEGY_GATE_MIN_DAYS:        # 7
                    since_ms = None
        except Exception as e:
            logger.warning("fetch-trades clamp probe failed: %s", e)   # falls through to the original since_ms
```

**Pattern to copy for the new seed:** the cron's own call shape (`cron.py:2395-2410`): call the shared loader, take the mapping value, hand it to `parse_since_ms`:

```python
    hw, hw_err = load_strategy_high_waters(supabase, [req.strategy_id])
    since_ms = parse_since_ms(hw.get(req.strategy_id))   # None => full reach; NEVER last_sync_at
```

Keep unchanged (CONTEXT decision 5): the span guard (still runs only on a non-None seed), the post-fetch `last_sync_at` + `account_balance_usdt` write (`exchange.py:1843-1847`), the sync RPC. The probe's `except` now leaves the high-water value in place. Note: import the loader from `services.trade_resume` at module level next to line 13's `from services.exchange import ... parse_since_ms ...` (single long import line; match the style). A high-water read failure is already fail-open inside the helper (never raises).

---

### `analytics-service/services/job_worker.py::run_sync_trades_job` (worker handler)

**Current code** (`job_worker.py:2061-2067`, `2127`, `2153-2155`):

```python
    strategy_id = job["strategy_id"]
    since_ms = parse_since_ms(
        ctx.key_row.get("last_sync_at"),
        preferred=ctx.key_row.get("last_fetched_trade_timestamp"),
    )
    ...
        else:   # ccxt arm (MT5 arm above it fetches no daily P&L)
            trades = await fetch_all_trades(ctx.exchange, since_ms=since_ms)
    ...
                raw_fills = await fetch_raw_trades(
                    ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms
                )
```

**Target shape** (CONTEXT decision 4, RESEARCH "LASTSYNC-SEED Facts"): split into `daily_since_ms` (from the helper) and `fills_since_ms = parse_since_ms(None, preferred=last_fetched_trade_timestamp)` if non-NULL else `daily_since_ms`. `parse_since_ms(None, preferred=...)` is already used in this file in exactly the "cursor only, no last_sync_at" shape at the long-fetch tail (`job_worker.py:~14541`: `since_ms = parse_since_ms(None, preferred=since_iso)`); copy that call form. `services/exchange.py:3049-3061` confirms `value = preferred if preferred is not None else last_sync_at`, so passing `None` for the first argument removes the `last_sync_at` fallback entirely.

Run the helper only in the ccxt `else` arm, off the event loop, via the module's `db_execute` (`job_worker.py` imports `db_read_with_retry`, `db_execute`, `rows` from `services.db`, lines ~105-113): `hw, hw_err = await db_execute(lambda: load_strategy_high_waters(ctx.supabase, [strategy_id]))`. Unchanged: the MT5 arm, `advance_sync_cursor` epilogue, the follow-on enqueue.

---

### `analytics-service/services/job_worker.py::run_stitch_composite_job` entry snapshot + `_stamp_failed`

**Analog (exact):** the derive handler's entry block, `job_worker.py:4755-4838`. Copy its structure, gate, and failure handling; it is gated on the marker so an unmarked job pays nothing.

```python
    _refresh_publish_status: str | None = None
    _refresh_publish_warned = False
    if not is_key_mode:
        _entry_metadata = job.get("metadata")
        _entry_source = (
            _entry_metadata.get("source") if isinstance(_entry_metadata, dict) else None
        )
        if _entry_source == LEDGER_REFRESH_SINGLE_KEY_SOURCE:

            def _read_entry_publish_state() -> dict[str, Any]:
                res = (
                    ctx.supabase.table("strategy_analytics")
                    .select("computation_status, computation_warned")
                    .eq("strategy_id", strategy_id)
                    .maybe_single()
                    .execute()
                )
                row = getattr(res, "data", None) or {}
                return dict(row) if isinstance(row, dict) else {}

            try:
                _entry_row = await db_read_with_retry(_read_entry_publish_state)
            except Exception as _entry_exc:  # noqa: BLE001 — reported, then re-raised
                try:
                    await aclose_exchange(ctx.exchange)      # NOT applicable to the composite
                except Exception:  # noqa: BLE001  # pragma: no cover
                    pass
                if isinstance(_entry_exc, _READ_PROGRAMMING_ERRORS):
                    logger.error("derive_broker_dailies: the pre-refresh publish-state read ... raised a programming error (%s). ...",
                                 strategy_id, job.get("id"), _read_failure_text(_entry_exc))
                    _capture_read_failure(_entry_exc, job_id=job.get("id"))
                    raise
                logger.error("derive_broker_dailies: could not read the pre-refresh publish state ... failing the job TRANSIENT so the queue can retry it.",
                             strategy_id, job.get("id"), _read_failure_text(_entry_exc))
                _capture_read_failure(_entry_exc, job_id=job.get("id"))
                raise RefreshMarkerRereadUnavailable(
                    "derive_broker_dailies: the pre-refresh publish-state read "
                    "failed for a marked refresh, so the job stopped before any "
                    "crawl and wrote nothing "
                    f"({_read_failure_text(_entry_exc)})"
                ) from _entry_exc
            _entry_status = _entry_row.get("computation_status")
            if isinstance(_entry_status, str):
                _refresh_publish_status = _entry_status
                _refresh_publish_warned = bool(_entry_row.get("computation_warned"))
```

Helper names, all defined in `job_worker.py`: `RefreshMarkerRereadUnavailable` (3327), `_READ_PROGRAMMING_ERRORS` (3388), `_read_failure_text` (3400), `_capture_read_failure` (3409), `db_read_with_retry` (imported at ~109). Composite adaptations: gate on `_entry_source == LEDGER_REFRESH_COMPOSITE_SOURCE` (`job_worker.py:1150`; the stamp site spells the literal `"ledger-refresh-composite"` inline on purpose, `:11315-11322`, keep that spelling convention there); there is no open exchange so drop the `aclose_exchange` step; place the read after `_stitch_start` (`:11165`) and before the member load (`:11474`); the message strings say "stitch_composite" not "derive_broker_dailies". The `supabase` client in this handler is the local `supabase = get_supabase()` (`:11157`), not `ctx.supabase`.

**The stamp site to change** (`_stamp_failed`, `job_worker.py:11205-11270`, `11323-11326`):

```python
        # ONE select, BOTH columns: the flags for M-2's merge above, and the
        # CURRENT status for the non-destructive guard below.
        def _read_existing_failed_row() -> dict[str, Any]:
            res = (supabase.table("strategy_analytics")
                   .select("data_quality_flags, computation_status")
                   .eq("strategy_id", strategy_id).maybe_single().execute())
            ...
        existing_row = await _stamp_io(lambda: db_read_with_retry(_read_existing_failed_row),
                                       op=_STAMP_OP_STATUS_READ, **_stamp_io_args)
        existing_flags = _flags_object_or_dropped(existing_row.get("data_quality_flags"), site="stitch_composite", ...)
        _existing_status = existing_row.get("computation_status")
        existing_status: str | None = (_existing_status if isinstance(_existing_status, str) else None)
        ...
        _honour_marker = (
            _job_source == "ledger-refresh-composite"
            and existing_status in STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES
        )
```

Target (CONTEXT D5 1-4): on the marked path `existing_status` comes from the captured entry snapshot (a closure variable, Claude's discretion; closure capture is the lighter choice and `_stamp_failed` is a nested closure already); `data_quality_flags` stays a LIVE read at stamp time (narrow the select to that column, RESEARCH D5 facts); an unmarked job keeps today's LOUD path with no entry read. Unchanged: `_read_refresh_marker_state` re-ask (`:11363-11380`), `_stamp_io` wrapping, `_upsert_error_only` and `_upsert` payloads.

**M-3 wording hazard** (`tests/test_stitch_composite_job.py:3438-3440`): `inspect.getsource(run_stitch_composite_job)` must not contain `verification_status` or `published` anywhere (comments included; `unpublished` also matches). Existing prose says "live" (`:11285-11290`). `publish_status`, `publish_warned`, `publish-lifecycle` do NOT match, so the derive handler's names are fine to reuse; do not name the snapshot variable anything containing `published`.

---

### `analytics-service/tests/test_fetch_trades_resume_seed.py` (new; route RED-first)

**Fixture analog:** `tests/test_exchange_router_c0202.py:29-79`, the `stubbed_exchange_router` fixture (stubs `slowapi`, calls `patch_shared_limiter`, uses `evicted("routers.exchange")` so there is no `importlib.reload`; CLAUDE.md forbids reload):

```python
@pytest.fixture()
def stubbed_exchange_router(monkeypatch):
    ...
    build_shared_limiter_from_real_slowapi()
    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)
    patch_shared_limiter(monkeypatch)
    with evicted("routers.exchange"):
        from routers import exchange as exchange_router
        yield exchange_router
```

Import it, do not copy it, if conftest placement allows; otherwise copy the fixture (tests in this repo import fixtures from sibling test modules, e.g. `from tests.test_stitch_composite_job import _apply, _FakeSupabase`). Handler call convention (`c0202.py:130-157`): `monkeypatch.setattr(stubbed_exchange_router, "get_supabase", lambda: supabase)`, `monkeypatch.setattr(stubbed_exchange_router, "get_kek", lambda: b"\x00" * 32)`, `req = MagicMock(); req.strategy_id = "s-1"`, `await stubbed_exchange_router.fetch_trades(MagicMock(), req)`. This test must additionally patch `decrypt_credentials`, `create_exchange`, `fetch_all_trades` (capture `since_ms`), `fetch_usdt_balance` and `aclose_exchange` on the router module so the handler runs through.

**Filtering fake:** `tests/test_cron_router.py:430-472`, the closure `_FakeTradesQuery` (it APPLIES `.eq` filters, `.order`, `.limit`, records each query in `trades_queries`, and can raise `trades_select_error`). It is nested inside `_make_mock_supabase_for_cron_sync` and cannot be imported; copy the ~40 lines into the new file (the planner may instead hoist it to a shared helper module in `tests/`, which changes an existing test file, so note that trade-off).

```python
        def execute(self) -> Any:
            trades_queries.append({"eq": list(self._eq), "order": self._order, "limit": self._limit})
            if trades_select_error is not None:
                raise trades_select_error
            matched = [r for r in _trades_table_rows if all(r.get(c) == v for c, v in self._eq)]
            if self._order is not None:
                col, desc = self._order
                matched.sort(key=lambda r: r[col], reverse=desc)
            if self._limit is not None:
                matched = matched[: self._limit]
            return MagicMock(data=[{"timestamp": r["timestamp"]} for r in matched])
```

**Assertion style to copy** (`test_cron_router.py:6946-7024`, `TestHighWaterIgnoresFillRows`; literal-instant constants `HW_ROW_TS = "2026-05-07T05:17:00+00:00"`, `HW_DAY_START_MS = 1778112000000` at 6743-6744). Assert the RESULT and the QUERY: `fetch_mock.call_args.kwargs["since_ms"] == HW_DAY_START_MS`, `("is_fill", False) in queries[0]["eq"]`, `queries[0]["order"] == ("timestamp", True)`, `queries[0]["limit"] == 1`. Failed-read case: `trades_select_error=RuntimeError("PostgREST 503 ...")` then `since_ms is None` (`:7044-7062`), and "not the `last_sync_at` value".

⚠️ **TRAP found while reading: the span guard can mask the RED.** The route's span probe (`exchange.py:1778-1820`) reads min/max `timestamp` over ALL stored rows (fills included) and nulls `since_ms` when the span is under 7 days. A fake `trades` table with a single old daily row gives `span_days == 0`, so `since_ms` becomes `None` on BOTH the old and the new code and the test cannot go red. Seed at least two stored rows more than 7 days apart (e.g. a daily row 2026-04-20 and one 2026-05-07) so the guard does not fire, and put a FRESH `last_sync_at` on the `api_keys` row. The fake must therefore serve the span queries (no `is_fill` filter) and the high-water query (with `is_fill=False`) from the same row list; `_FakeTradesQuery` does this because it filters on whatever `.eq` calls it sees.

Neuter proof to record in the docstring (RESEARCH Validation map): restore `since_ms = parse_since_ms(key_data.get("last_sync_at"))`; the asserted `since_ms` becomes the `last_sync_at` value. Second neuter: make the loader's `except` return `last_sync_at` or re-raise.

---

### `analytics-service/tests/test_sync_trades_resume_seed.py` (new; job RED-first with a filtering fake supabase)

**Analog:** `tests/test_job_worker.py` `TestSyncTradesPhase2PartialBatchFailure` (3640-3800) for the whole harness; copy its scaffolding:

```python
        mock_ctx = MagicMock()
        mock_ctx.exchange = mock_exchange            # AsyncMock with .close = AsyncMock()
        mock_ctx.supabase = MagicMock()
        mock_ctx.strategy_row = {"id": "strat-...", "user_id": "user-1"}
        mock_ctx.key_row = {"id": "key-1", "exchange": "okx", "last_sync_at": <FRESH>,
                            "last_fetched_trade_timestamp": None, "user_id": "user-1"}
        def _rpc(name: str, payload: dict) -> MagicMock: ...      # advance_sync_cursor returns data=True
        mock_ctx.supabase.rpc.side_effect = _rpc
        mock_ctx.supabase.table.side_effect = _table              # return the filtering fake for "trades"

        with patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=mock_ctx)), \
             patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[...])) as daily, \
             patch("services.job_worker.fetch_usdt_balance", new=AsyncMock(return_value=10000.0)), \
             patch("services.job_worker.fetch_raw_trades", new=AsyncMock(return_value=[])) as fills, \
             patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())), \
             patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", True):
            result = await run_sync_trades_job(job)
```

`daily.call_args.kwargs["since_ms"]` and `fills.call_args.kwargs["since_ms"]` are the two captured values (RESEARCH confirmed no existing test asserts either). Cases from CONTEXT decision 6 and 4: (a) fresh `last_sync_at` + old stored daily row, `last_fetched_trade_timestamp` NULL: BOTH `since_ms` equal the high-water day start, (b) `last_fetched_trade_timestamp` set: fills read uses it, daily read still uses the high-water, (c) failed high-water read: daily `since_ms is None` and fills falls back to `None` when the cursor is NULL. The `db_execute` passthrough patch is required because the helper is sync and the handler awaits it through `db_execute`.

**Silent-pass hazard (RESEARCH):** existing `run_sync_trades_job` tests use a bare `MagicMock` supabase. The new high-water read runs against those mocks; the helper catches whatever they raise and maps it to `None` (full reach), so those tests keep passing without exercising a real resume point and with extra `logger.exception` noise. After the change, run `tests/test_job_worker.py`, `tests/test_mt5_sync_path.py`, `tests/test_mt5_handover.py`, `tests/test_failed_status_logged.py`, `tests/test_ana_recon_audit.py` and READ the log noise. The RED-first test must use the filtering fake, not `MagicMock`.

---

### `analytics-service/tests/test_stitch_composite_entry_snapshot.py` (new; D5 F2-shape RED-first) and the harness changes

**Harness analog (exact):** `tests/test_ledger_refresh_composite_nondestructive.py` `_run(...)` (lines ~134-206). It drives the zero-member permanent failure through `dispatch`, the production entry, with `_FakeSupabase` and `_deribit_patches`:

```python
    fake = _FakeSupabase(members=[], existing_flags=existing_flags or {}, existing_status=existing_status,
                         live_job_metadata=live_metadata, live_job_id=job_id,
                         live_job_read_raises=live_job_read_raises,
                         analytics_read_raises=analytics_read_raises)
    job = {"id": job_id, "kind": "stitch_composite", "strategy_id": _STRATEGY_ID}
    if metadata is not _UNSET:
        job["metadata"] = metadata
    with ExitStack() as stack:
        stack.enter_context(_apply(_deribit_patches(fake, combine_returns=[], has_option_activity=False)))
        if log is not None: stack.enter_context(patch("services.job_worker.logger", log))
        if sentry is not None: stack.enter_context(patch("services.job_worker.sentry_sdk", sentry))
        result = await dispatch(job)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == expect_error_kind
    return fake
```

Reuse `_run`, `_analytics_upserts`, `_PUBLISH_STATE_KEYS = ("computation_status", "computation_warned")`, `_COMPOSITE_MARKER`, `_Gateway504` (line 709) by import, as `test_ledger_refresh_composite_nondestructive.py` itself imports from `tests.test_stitch_composite_job`.

**The F2 shape needs a fake extension.** `_FakeQuery.execute` (`tests/test_stitch_composite_job.py:187-207`) serves one constant `existing_status` to EVERY `strategy_analytics` select and pops `analytics_read_raises` once per read:

```python
        if self.table == "strategy_analytics":
            self.fake.analytics_reads += 1
            if self.fake.analytics_read_raises:
                raise self.fake.analytics_read_raises.pop(0)
            return SimpleNamespace(data={"data_quality_flags": dict(self.fake.existing_flags),
                                         "computation_status": self.fake.existing_status})
```

Add to `_FakeSupabase.__init__` (`:239-300`) a per-read status sequence (e.g. `existing_status_by_read: list[str | None] | None`, popped per read, falling back to `existing_status`) and thread it through `_run`. Default `None` keeps every other construction unchanged (same convention as `analytics_read_raises`, whose comment at `:253-257` is the style to copy).

**The RED test** (RESEARCH "Test that must go RED on revert"): marked job, entry read answers `complete_with_warnings`, stamp-time read answers `computing`; assert the upsert payload carries NO `_PUBLISH_STATE_KEYS` and still carries `computation_error`. Neuter: restore the live-read oracle for `existing_status` in `_stamp_failed`; the guard disarms and the LOUD payload (`computation_status = "failed"`) lands.

**Entry-read failure tests** copy `tests/test_ledger_refresh_reuse_collision.py::TestEntryPublishStateReadFailsTransient` (1671-1741): assert `result.error_kind == "transient"`, no `strategy_analytics` write, `log.error.call_count == 1`, `sentry.capture_exception.call_count == 1`, a message fragment, `"RuntimeError: simulated entry read failure" in result.error_message`, `set_tag.assert_any_call("compute_job_id", ...)`; and the parametrized programming-error case (1743-1760; `AttributeError`, `TypeError`, `KeyError`, `NameError`) which must propagate as `unknown`, not TRANSIENT. For the composite the failing read is the FIRST `strategy_analytics` select, so `analytics_read_raises=[RuntimeError(...)]` with `expect_error_kind="transient"` exercises it, and `fake.analytics_reads == 1` proves the stamp read never ran. An UNMARKED job takes no entry read: assert `fake.analytics_reads == 1` (stamp read only) for `metadata=_UNSET`.

**Existing tests that go red by construction (re-point them; the COMPLETE set is FOUR test items, one more than RESEARCH names; `grep -rn analytics_read_raises tests/` shows these are the only consumers outside the fake itself):** in `tests/test_ledger_refresh_composite_nondestructive.py`: (1) `TestStampReadRetriesAGateway504.test_one_gateway_504_is_retried_and_the_stamp_still_decides` (line 716 class, 737 raise, asserts `fake.analytics_reads == 2` at 739); (2) and (3) the two MARKED params of `TestAFailedStampReadKeepsTheCause.test_the_cause_reaches_last_error_and_the_error_log` (class 754, raise list 822, count assert 828; ids `marked-persistent-504`, `marked-non-504-first-failure`); (4) `TestAFailedStampReadKeepsTheCause.test_a_long_read_error_cannot_push_the_cause_out_of_last_error` (line ~861, raise at 870, `metadata={"source": _COMPOSITE_MARKER}`, asserts the zero-member cause is in `last_error`). Item (4) was not in RESEARCH: with a marked job its `RuntimeError("x" * 2000)` now lands on the ENTRY read, the job stops before the member load, so `_ZERO_MEMBER_CAUSE` ("Composite strategy has no member keys.") never reaches `last_error` and the assertion at 872-874 fails. With a marked job the entry read is now the first select, so the queued exceptions land on it. Re-point via the new fake feature (let the first read answer, then fail the stamp read; a "skip N reads before raising" knob). The `unmarked-user-stitch-non-504` param is unaffected (unmarked jobs take no entry read). Also run `tests/test_stamp_io_exhaustive.py` (its discovery scenarios include marked composite jobs through `tests.test_derive_broker_dailies_dualmode._build_ctx`), `tests/test_ledger_refresh_gates.py`, `tests/test_failed_status_logged.py`, `tests/test_probe_composite_claimtime.py`.

---

### Parity tests (modified): `tests/test_compute_job_metadata_merge_parity.py`, `src/lib/ledger-refresh-marker.test.ts`

**Analog:** themselves. Python (lines 30-60, 84-100):

```python
_FUNCTIONS = Path(__file__).resolve().parents[2] / "supabase" / "schema" / "functions"
_RETRACT_SQL = (_FUNCTIONS / "retract_ledger_refresh_marker.sql").read_text()
_SOURCE_LIST_RE = re.compile(r"->>\s*'source'\)\s*IN\s*\(([^)]*)\)")

def test_retraction_marker_lists_equal_the_python_marker_set() -> None:
    lists = _source_lists(_RETRACT_SQL)
    assert len(lists) == 2, ...          # anti-vacuity count pin
    for found in lists:
        assert found == LEDGER_REFRESH_JOB_SOURCES

def test_a_marker_added_to_the_sql_alone_fails_the_comparison() -> None:
    widened = _RETRACT_SQL.replace("IN ('ledger-refresh', 'ledger-refresh-composite')",
                                   "IN ('ledger-refresh', 'ledger-refresh-composite', 'ledger-refresh-mt5')", 1)
    assert widened != _RETRACT_SQL, "the replace matched nothing: re-point the widened-copy case"
```

TS twin: `src/lib/ledger-refresh-marker.test.ts:206-296` reads `supabase/schema/functions/retract_ledger_refresh_marker.sql`, pins `lists.length` to 2, and has the same widened-copy case. Extend BOTH to read the new helper's generated snapshot (`supabase/schema/functions/_record_enqueue_dedup.sql`, regenerated by `npm run schema:functions`) with a measured list count and its own widened-copy case. Pin the helper's kind list too if the plan keeps one (a kind scope is a new list no existing parity test reads: RESEARCH Pitfall 4).

---

### Comment-only updates (D11-7: "comments that describe D-02 as open are updated")

Measured locations (re-grep `D-02` / `no merge arm` / `DISCARD`): `analytics-service/services/ingestion/long_fetch.py:126` (docstring paragraph "D-02, unchanged and NOT that race ...") and `:788` ("there is no merge arm"); `analytics-service/services/job_worker.py:3191` (REUSE-01 block "`p_metadata` is DISCARDED, there is no merge arm"); `src/lib/ledger-refresh-marker.ts:61` ("returns the EXISTING id with the caller's `p_metadata` discarded") and `:77` ("D-02, UNCHANGED and stated rather than hidden"); `analytics-service/tests/test_ledger_refresh_reuse_collision.py` `_Queue` docstring (line 105: "DISCARD `p_metadata`, exactly as in SQL") and `_Queue.enqueue` (133-142). RESEARCH Pitfall 8: the `_Queue` double is the Python view; consider making `_Queue.enqueue` retract so a test shows the backstop answering `no_marker`. Do NOT overclaim: D11-2 fires only for senders carrying `correlation_id` (D11-9), so finalize-wizard and csv-finalize remain the recorded residual.

---

## Shared Patterns

### SECDEF function hygiene
**Source:** `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql:72-153`
**Apply to:** the new helper and both re-based overloads.
`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`, schema-qualify every object, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` plus `GRANT EXECUTE ... TO service_role` restated after any `CREATE [OR REPLACE]`, grantees named (a Supabase default-grant event trigger re-opens EXECUTE; `20260515130001` records it).

### Catalogue-only migration verify
**Source:** `20261106120000...sql:158-202`, `20260919120000_strategy_sync_cursors.sql:231-376`
**Apply to:** the new migration. `pg_proc`/`pg_class`/`pg_policy`/`information_schema`/`has_*_privilege`/`aclexplode` only; never read `compute_jobs` rows and raise (TEST holds PROD's catalogue, not its data; `lint-migration-data-dependence.mjs` fails CI with no opt-out).

### Fail-OPEN toward over-fetch, fail-LOUD toward the destructive stamp
**Source:** `routers/cron.py:560-608` (high-water: per-strategy `except` -> `None` + recorded error string); `job_worker.py:4785-4834` (entry read: report, then re-raise, never guess).
**Apply to:** `trade_resume.py` (open) and the composite entry read (loud/transient).

### Entry-read failure taxonomy
**Source:** `job_worker.py:4806-4834`
**Apply to:** the composite entry read. Programming error (`_READ_PROGRAMMING_ERRORS`): `logger.error` + `_capture_read_failure`, re-raise unchanged (becomes `unknown`). Anything else: `logger.error` + `_capture_read_failure` + `raise RefreshMarkerRereadUnavailable(...) from exc` (TRANSIENT). Exactly one ERROR line and one Sentry capture per failed read (runbook alert-volume table; the tests pin `log.error.call_count == 1`).

### Stamp I/O
**Source:** `job_worker.py:11223-11250` (`_stamp_io`, `_stamp_io_args`, `_STAMP_OP_*` at 3610-3614)
**Apply to:** anything new inside `_stamp_failed`. Every DB read/write inside the closure goes through `_stamp_io`; `tests/test_stamp_io_exhaustive.py` statically scans the closures. The NEW entry read is OUTSIDE the closure (handler body), so it follows the derive entry-read pattern, not `_stamp_io`.

### Test neuter-to-RED documentation
**Source:** docstrings of `TestStampReadRetriesAGateway504` (`test_ledger_refresh_composite_nondestructive.py:717-726`), `TestEntryPublishStateReadFailsTransient` (`test_ledger_refresh_reuse_collision.py:1672-1683`), and `TestHighWaterIgnoresFillRows`
**Apply to:** every new Python test class. Each docstring states "Neuter to redden: <exact edit>; <test> goes RED on <observable>". SC-4 requires it; the neuter is exercised and restored from a byte backup (never `git checkout/restore/stash` on uncommitted work).

### Mutation-runner annotation grammar
**Source:** `scripts/mutation-runner/GRAMMAR.md`; live examples in `test_compute_job_metadata_merge.sql`
**Apply to:** the new SQL gate. Prose `RED-UNDER:` plus adjacent `RED-UNDER-M:` JSON twin per arm that exercises the migration; MEASURED `occurrences` on each `edit`; markers count only at line start; a mutation may not inject `TEST FAILED (`; first `TEST FAILED (N)` must name the arm; `RED-UNDER-SETUP` apply list at file top; `WAIVED_CEILING` stays 0.

### Python gates every analytics-touching change must pass
From project memory and RESEARCH: pytest only from `analytics-service/`; mypy strict as CI runs it (`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`); never `importlib.reload`; `grep -a`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Happy-path `fetch_trades` route test (inside `test_fetch_trades_resume_seed.py`) | test | request-response | `tests/test_exchange_router_c0202.py` stops at the 404 before the fetch; no existing test drives `/fetch-trades` through `fetch_all_trades`. Compose: its `stubbed_exchange_router` fixture + handler call + `test_cron_router.py`'s `_FakeTradesQuery`. The span-guard trap above is the main thing the planner must carry. |
| Lost-race SUCCESS return (SITE B) arm in the SQL gate | test | request-response | `test_enqueue_race_loss_40001.sql` forces the race with a BEFORE INSERT competitor trigger and an AFTER INSERT flip to `done`; no gate observes the successful return. The mechanism is concrete (see the SITE B subsection: keep the BEFORE INSERT trigger, omit the flip). It is untested on the lane for this purpose; if it cannot be made to bite, SITE B falls back to a body-text pin and the plan must say so, as for the 7-arg overload. |
| In-transaction `DROP FUNCTION` of the 10-arg overload to call the 7-arg directly | test | n/a | Unproven (RESEARCH A2); body-text pin is the safe SC-4 for the 7-arg overload (D11-13). |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/migrations/down/`, `supabase/tests/`, `supabase/schema/functions/`, `analytics-service/routers/`, `analytics-service/services/`, `analytics-service/tests/`, `src/lib/ledger-refresh-marker.test.ts`, `scripts/pg-lane/fixtures/`.
**Files read for excerpts:** 19 (migrations x4, SQL gates x4 including `test_enqueue_race_loss_40001.sql`, Python source x3, Python tests x6, parity tests x2); RESEARCH and CONTEXT read in full.
**Pattern extraction date:** 2026-11-14
