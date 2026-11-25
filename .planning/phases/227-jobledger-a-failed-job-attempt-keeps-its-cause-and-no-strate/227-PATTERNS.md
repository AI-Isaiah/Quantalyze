# Phase 227: JOBLEDGER - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 17 (new + modified)
**Analogs found:** 16 / 17

All paths are git-tracked source (checked with `git ls-files`). Latest bodies come from `supabase/schema/functions/*.sql` (generated mirror; its `-- source migration:` line names the migration to re-base on).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<ts>_jobledger_attempt_failures.sql` (new table `compute_job_attempt_failures` + re-based `mark_compute_job_failed`, `reset_stalled_compute_jobs`, `reclaim_stuck_compute_jobs`) | migration | CRUD (append-only write from SECDEF RPCs) | table: `supabase/migrations/20261117120000_mt5_server_clock_readings.sql` + `20261114130000_enqueue_dedup_record_retract.sql` STEP 1; bodies: `supabase/schema/functions/{mark_compute_job_failed,reset_stalled_compute_jobs,reclaim_stuck_compute_jobs}.sql` | exact |
| same or separate migration: `renew_compute_job_claims` RPC (HEAL-02) | migration (SECDEF RPC) | request-response | ACL/proconfig self-verify in `20260927120000_claim_pair_pre_rank_exclusion.sql:905-930` | role-match |
| HEAL-04 bridge loop inside re-based `reset_stalled_compute_jobs` | migration | event-driven (status bridge) | `supabase/schema/functions/mark_compute_job_failed.sql:250-275` | exact |
| `supabase/migrations/<ts>_reconcile_sweep_readmit_exhaustion_signal.sql` (re-register `reconcile_dropped_enqueue_sweep` + `reconcile_readmit_exhaustions` table) | migration (pg_cron) | batch | `supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql` (STEP 1 :309-438, STEP 2 :440-560) | exact |
| `supabase/migrations/<ts>_first_hop_enqueue_sweep.sql` (new pg_cron job + once-only marker table) | migration (pg_cron) | batch | `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` (original registration) + `20260819150000` shape | exact |
| `supabase/migrations/<ts>_poll_positions_cohort.sql` (re-base `enqueue_poll_positions_for_all_strategies`) | migration | batch | `supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql` (only def: `20260412094449`); cursor table `20260919120000_strategy_sync_cursors.sql:101-105` | exact |
| `analytics-service/services/ops_alert.py` (add source) | config/contract | — | itself `:71-85` | exact |
| `src/lib/ops-alert-contract.ts` (mirror source) | config/contract | — | itself `:15-27` | exact |
| new Python reader (e.g. `analytics-service/services/readmit_ceiling_alert.py`) | service | event-driven (poll row -> page -> stamp) | `analytics-service/services/mt5_outage_alert.py:394-500` + `services/ops_alert_open.py` | role-match |
| `analytics-service/main_worker.py` (fence + heartbeat renew in `dispatch_tick`; call reader from a loop) | worker loop | request-response | itself `:970-1000` (`_heartbeat`), `:1155-1206` (`watchdog_tick`) | exact |
| `supabase/tests/test_compute_job_attempt_failures.sql` | test (SQL gate) | — | `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql:312-460` | role-match |
| `supabase/tests/test_compute_job_claim_renewal.sql` | test (SQL gate) | — | same | role-match |
| `supabase/tests/test_reset_stalled_bridge_provenance.sql` | test (SQL gate) | — | `supabase/tests/test_sync_status_curated_sentence_survives.sql:234` (SETUP list) | role-match |
| `supabase/tests/test_first_hop_enqueue_sweep.sql`, `test_enqueue_poll_positions_cohort.sql` | test (SQL gate) | — | `test_reconcile_dropped_enqueue_sweep.sql` | role-match |
| `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` (Part 1 counts, new arms) | test (modify) | — | itself | exact |
| `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts`, `analytics-service/tests/test_main_worker.py` (pointer move) | test (modify) | — | themselves `:79-81`, `:3761` | exact |
| HEAL-01 named-state UI/status readers | component/reader | request-response | none identified yet (inventory at plan time, RESEARCH OQ5) | none |

## Pattern Assignments

### Attempt-failure table (MT5D-01) and the readmit exhaustion / first-hop marker tables

**Analog for the RLS/grant shape:** `supabase/migrations/20261117120000_mt5_server_clock_readings.sql:102, 195-204`. It enables RLS with NO policy and revokes everything before restating grants:
```sql
ALTER TABLE public.mt5_server_clock_readings ENABLE ROW LEVEL SECURITY;
-- STEP 3 - grants. REVOKE everything first ...
REVOKE ALL ON TABLE public.mt5_server_clock_readings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;
```
For `compute_job_attempt_failures` grant **SELECT only** (writers are SECDEF owners), as `20261114130000:228-229` does:
```sql
REVOKE ALL ON TABLE public.compute_job_dedup_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.compute_job_dedup_events TO service_role;
```
`reconcile_readmit_exhaustions` needs `UPDATE (paged_at)` for the Python reader (or a SECDEF stamp RPC). Decide at plan time.

**Column/COMMENT style:** copy `20261114130000:173-207`: plain `CREATE TABLE` (not IF NOT EXISTS, a collision must fail loud), named CHECK constraints, `COMMENT ON TABLE/COLUMN` for every column, and a table comment stating the retention, sanitize and GDPR position.

**Conflict (Rule 7), do NOT copy from `compute_job_dedup_events`:**
- Its `job_id ... REFERENCES public.compute_jobs(id) ON DELETE CASCADE` (`:176`) would delete MT5D-01 records under the 30/90-day prunes. Use no FK (precedent `strategy_analytics.computation_error_job_id`, `20260906120000:222`).
- It adds a deny-all `CREATE POLICY ... USING (false)` (`:216-219`). CONTEXT/research ask for RLS on with no policies (the `mt5_server_clock_readings` shape). Either is deny-by-default for non-owners. Pick the no-policy form and say why in the header. The `ENABLE` without `FORCE` reasoning at `:207-213` applies verbatim (the SECDEF owner writer must not be RLS-subject).
- Identity: `UNIQUE (job_id, claim_token)` (RESEARCH Pattern 1), not `(job_id, attempts)`.

### Re-based `reset_stalled_compute_jobs` (MT5D-01 write + HEAL-04 bridge)

**Latest body:** `supabase/schema/functions/reset_stalled_compute_jobs.sql` (source `20260516104201`). Keep: the `p_stale_threshold` RAISE with `ERRCODE = 'invalid_parameter_value'`, both bounded passes (`ORDER BY claimed_at LIMIT 500 FOR UPDATE SKIP LOCKED`), `last_error = 'worker_stalled'`, `claim_token = NULL -- mig 117: P97 fence invalidation`, `SECURITY DEFINER SET search_path = public, pg_catalog`, `RETURNS INTEGER`.

Change the two `UPDATE compute_jobs ... WHERE id IN (SELECT ...)` into a CTE that captures the old `claim_token`/`attempts` before the NULL, then INSERT ledger rows (`cause_class = 'watchdog_reset'`) from the UPDATE's RETURNING, then the bridge loop.

**Bridge loop to copy** (`supabase/schema/functions/mark_compute_job_failed.sql:259-272`, with its lock-order comment at :250-258):
```sql
  FOR r_b IN
    SELECT d.strategy_id, d.job_id
      FROM (SELECT DISTINCT ON (u.strategy_id) u.strategy_id, u.job_id
              FROM ... u
             WHERE u.strategy_id IS NOT NULL
             ORDER BY u.strategy_id, u.ord, u.job_id) d
     ORDER BY hashtext(d.strategy_id::text), d.strategy_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));
    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);
  END LOOP;
```
Accumulate reset rows across both passes (array or temp set) and run ONE sorted loop at the end, so the advisory locks are taken in one global order. Bridge latest body: `sync_strategy_analytics_status.sql` (source `20261105120000`).

### Re-based `mark_compute_job_failed` (MT5D-01 `error` row)

**Latest body:** `supabase/schema/functions/mark_compute_job_failed.sql` (source `20261024120000_fan_in_graph_and_decision_cascade.sql`). The write point is the UPDATE at `:107-112`:
```sql
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;
```
Insert the ledger row (`cause_class = 'error'`, `error_text = p_error`, `error_kind = p_error_kind`, old `claim_token`, `attempts`) right after it, in the same transaction. Do NOT record the fan-in cascade children (`:217-233`, they never ran). Keep the 55006 token refusal (`:77-82`) and the bridge loop untouched.

### Re-based `reclaim_stuck_compute_jobs`

**Latest body:** `supabase/schema/functions/reclaim_stuck_compute_jobs.sql` (source `20260516104201`). No live caller (PROD census (d)). Same CTE-capture + `cause_class = 'stall_reclaim'` + bridge-loop treatment, so it cannot become a silent second path.

### `renew_compute_job_claims` (HEAL-02)

**Analog for SECDEF hygiene and its self-verify:** `20260927120000_claim_pair_pre_rank_exclusion.sql:905-930`. It checks the `proconfig` search_path pin, `_assert_no_public_execute(sig)`, that anon/authenticated lack EXECUTE, and that service_role holds it:
```sql
  IF v_ccj_cfg IS NULL OR NOT (c_search_path = ANY(v_ccj_cfg)) THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not pin search_path ...', v_ccj_cfg;
  END IF;
  PERFORM public._assert_no_public_execute(c_ccj_sig);
  IF has_function_privilege('anon', v_ccj_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_ccj_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '...';
  END IF;
  IF NOT has_function_privilege('service_role', v_ccj_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '...';
  END IF;
```
Grants: copy `20261114130000:714-730` (`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`). The claim pair file itself stays unedited (its M-1137 pin at `:968` stays in force).

### Re-registered `reconcile_dropped_enqueue_sweep` (HEAL-03)

**Analog:** `supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql`.

STEP 1 (`:317-370`): pg_cron presence, unschedule-if-exists, schedule:
```sql
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION '<one literal naming the consequence>' USING ERRCODE = 'feature_not_supported';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep') THEN
    PERFORM cron.unschedule('reconcile_dropped_enqueue_sweep');
  END IF;
  PERFORM cron.schedule('reconcile_dropped_enqueue_sweep', '35 * * * *', $cron$ ... $cron$);
```
Transcription discipline (`:336-341`): the body is transcribed byte-for-byte from the prior writer, with ONLY the delta commented ("THE DELTA, in full"). The delta here is one INSERT into the exhaustion table, ahead of the existing INSERT.

STEP 2 (`:440-560`): read back from `cron.job`, never re-typed. Exactly one row (`v_count <> 1`), non-NULL command, schedule `35 * * * *`, comment-strip `v_stripped := regexp_replace(v_command, '--[^\n]*', '', 'g');`, word-bounded `< 3`, marker count, and the `public.compute_jobs` occurrence count (now more than 3; re-measure). Every RAISE names the consequence and is one literal.

**Pointer hygiene, same commit:**
- `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts:79-81` `FIX_TS` / `FIX_FILENAME` (the later-migration tripwire is at `:546-554`).
- `analytics-service/tests/test_main_worker.py:3761` `_SWEEP_MIGRATION_NAME`.
- `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`: the Part 1 counts, the `RED-UNDER-SETUP` at `:312` (append the new migration), and every `RED-UNDER-M` `"file":` that targets `20260819150000` (`:407, :438, :455`), which must re-point at the new last writer.

### First-hop sweep (HEAL-01)

**Analog:** `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` (first registration of a new jobname) for the STEP 1/STEP 2 pair, and `:612-700` for the rejected grace anchors (RESEARCH OQ3). Pick a new minute slot and check `cron.job` schedules for a collision (the `:35` rationale at `20260819150000:484`). Use a new jobname, and never unschedule a jobname that is not your own (`20260819150000:332`). The marker table follows the table pattern above (`UNIQUE (strategy_id)`, no FK to `compute_jobs`). The enqueue metadata shape is `{"source": "first-hop-sweep", "detected_at": now()}`.

### `enqueue_poll_positions_for_all_strategies` (HEAL-05)

**Latest body:** `supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql`. Keep everything (the SECDEF header, the pre-count of in-flight jobs, the `'daily-poll-' || to_char(now(),'YYYY-MM-DD') || '-' || v_strategy_id::text` idempotency key, `RETURNS INTEGER`). Change only the cohort WHERE:
```sql
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        AND EXISTS (SELECT 1 FROM compute_jobs cj WHERE cj.strategy_id = s.id
              AND cj.kind = 'sync_trades' AND cj.status = 'done'
              AND cj.updated_at > (now() - interval '30 days'))
```
The candidate key-health signal is `strategy_sync_cursors.last_sync_at` (`20260919120000_strategy_sync_cursors.sql:101-105`, per strategy, written only by `/cron-sync`). It avoids the finalize `after()` touch on `api_keys.last_sync_at`. Worker caller `daily_enqueue_tick` (`main_worker.py:1208-1220`) stays unchanged.

### ops_alert source (HEAL-03 contract)

Add the new source (e.g. `reconcile_readmit_ceiling`) to BOTH sets, with a one-line phase comment like the existing `# Phase 155.1 / D-01:` line:
- `analytics-service/services/ops_alert.py:71-85` `OPS_ALERT_SOURCES: Final = frozenset({...})`
- `src/lib/ops-alert-contract.ts:15-27` `OPS_ALERT_SOURCES = [...] as const`

`src/__tests__/ops-alert-contract-parity.test.ts` pins parity. `src/app/api/cron/ops-alert/route.ts` answers 400 to an unknown source.

### Python reader that pages without raising (HEAL-03)

**Analog:** `analytics-service/services/mt5_outage_alert.py:394-438` (`_finish_recovered`). A durable record is closed ONLY after `await_delivery` says delivered, and every exception is swallowed with a class-only log:
```python
    try:
        if not await await_delivery(delivery):
            logger.error("...reached no channel; the ... record stays open and the next ... sends it again")
            return
        delivered = True
        closed = await ops_alert_open.close_open_page(source)
    except Exception as exc:  # noqa: BLE001 - a held task must not die with an unretrieved error
        try:
            logger.warning("... failed - retried on the next ... (source=%s exc_class=%s)", source, type(exc).__name__)
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            pass
```
- Page call shape (`mt5_outage_alert.py:492-498`): `await ops_alert.page(source, cause, event="outage", since=..., detail=...)`.
- `await_delivery` contract: `ops_alert.py:402-420`.
- Supabase table read/write style for a durable alert record: `analytics-service/services/ops_alert_open.py:158-232` (`supabase.table(...).select/insert(...).execute()` inside the repo's db helpers).
- For the `paged_at` stamp, filter `paged_at IS NULL` so a stamp is idempotent.

### Worker loop changes (HEAL-02 fence + heartbeat; reader wiring)

**Analog:** `analytics-service/main_worker.py:981-1000`:
```python
            async def _heartbeat() -> None:
                while True:
                    await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
                    main_worker_healthz.LAST_TICK_AT = time.time()

            _hb = asyncio.create_task(_heartbeat())
            try:
                result = await dispatch(cast("dict[str, Any]", job))
            finally:
                _hb.cancel()
```
Add a renew call for the still-waiting batch-mates only, never the running row (RESEARCH anti-pattern). Add the pre-dispatch fence at the top of the `for job in jobs:` iteration: skip and log with an `event_type` when the job's id is not returned. RPC call style (`watchdog_tick`, `:1170-1185`): `supabase.rpc("<name>", {...}).execute()` wrapped in `db_read_with_retry` / `db_execute`. Renew is idempotent by its token filter, so a retry is safe. Never let it raise into the loop.

### SQL gate files (all new gates)

**Analog:** `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`.
- A single-line `-- RED-UNDER-SETUP: {"apply":[...]}` (`:312`): fixtures first (`scripts/pg-lane/fixtures/01-fixture-core.sql`, `03-fixture-compute-jobs.sql`, `29-fixture-compute-jobs-priority.sql`, ...), then every migration in order, ending in the new migration. The reset/bridge gate needs `20260516104201` and the bridge migrations; copy the base list from `test_sync_status_curated_sentence_survives.sql:234`.
- Each arm carries a prose `-- RED-UNDER:` line and an adjacent `-- RED-UNDER-M: {"arm":"<id>","apply":[{"kind":"edit","file":"supabase/migrations/<new>.sql","find":"...\n","replace":"...\n","occurrences":1}, {... "replace":"  IF FALSE THEN\n" ...}]}` twin (`:397-455`). The twin neuters the body clause AND the self-verify `IF` that would catch it, so the arm RED is attributable to the gate.
- Failures use the `RAISE EXCEPTION 'TEST FAILED (<arm>): ...'` idiom. Twins must never edit that literal (identity-rewrite). Gates seed rows only and never `CREATE TABLE` a migration-owned name (lint R5-R7).
- After adding files, raise `scripts/mutation-floors.mjs` (read by symbol) and re-run `node scripts/lint-sql-gates.mjs --self-test && node scripts/lint-sql-gates.mjs`.

## Shared Patterns

### Migration self-verify (all migrations)
**Source:** `20260819150000` STEP 2 and `20260927120000:756-1087`.
- Catalog-only reads: `pg_get_functiondef`, `pg_proc.proconfig`, `cron.job.command`. Never read `compute_jobs` rows (`scripts/lint-migration-data-dependence.mjs` refuses it).
- Comment-strip before any regex anchor.
- Each RAISE is one literal that names the consequence.

### SECDEF function hygiene
**Source:** `reset_stalled_compute_jobs.sql` header: `SECURITY DEFINER SET search_path = public, pg_catalog`. Grants follow `20261114130000:714-730`. Assert both the pin and the ACL in self-verify (`20260927120000:905-930`).

### VAC-04 / snapshots
Every changed function body needs `-- prod-body-ack: <hash>`, earned from VAC-04 (`20260927120000:110-155`). After the migration lands, run `npm run schema:functions` to regenerate `supabase/schema/functions/*.sql`.

### Never-raise paging
`ops_alert.page` + `await_delivery`, and close or stamp the record only on delivery (`mt5_outage_alert.py:394-438`).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| HEAL-01 named-state rendering (status readers, e.g. `useStrategySyncPoller`) | component/reader | request-response | The wording and carrier (an enum value or `computation_error` copy) are a plan-time decision, so the readers were not inventoried (RESEARCH OQ5) |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/schema/functions/`, `supabase/tests/`, `analytics-service/services/`, `analytics-service/main_worker.py`, `src/lib/`, `src/__tests__/`
**Files scanned:** about 20
**Pattern extraction date:** 2026-11-23
