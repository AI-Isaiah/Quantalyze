# Phase 214: FRESHTRUTH - Pattern Map

**Mapped:** 2026-11-14
**Files analyzed:** 24 table rows (7 new: 2 migrations, 2 rollbacks, 1 pytest, 1 e2e spec, `214-DIAGNOSIS.md`; 17 modified, generated or doc)
**Analogs found:** 21 / 21 files that need one. 3 rows need none (`214-DIAGNOSIS.md`, the unchanged prober arm, the ship ledger).
3 sub-patterns inside a file have no analog (see "No Analog Found").

Every analog path named below was checked tracked with `git ls-files` (e2e helpers, the pg-lane and
mutation-runner scripts, every test, migration and route file included). One test path in RESEARCH is not where
it was guessed: the anti-skip contract test lives at
`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`. Line numbers were read at the worktree HEAD
(migration `20261114130000` newest on `origin/main`); re-resolve before quoting. Cites marked *(relayed)* were
taken from RESEARCH without opening the file this pass. No PROD ids or home paths appear here.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<stamp1>_ledger_staleness_closed_composites.sql` (new) | migration (view) | request-response (read view) | `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` | exact |
| `supabase/migrations/<stamp2>_ledger_fanout_no_advance_weekly_cap.sql` (new) | migration (SECDEF fan-out re-base) | batch (hourly cron) | `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql` | exact |
| `supabase/migrations/down/<stamp1>-rollback.sql`, `<stamp2>-rollback.sql` (new) | migration (manual rollback) | batch | `supabase/migrations/down/20261114130000-rollback.sql` | role-match |
| `supabase/tests/test_ledger_refresh_fanout.sql` (mod: 37 twins re-pointed, new arms, setup list) | test (SQL gate + mutation twins) | batch | itself, arms P1-P5 (lines 1501-1628) | exact |
| `supabase/tests/test_ledger_refresh_staleness.sql` (mod: re-point view twins, new arms) | test (SQL gate) | request-response | itself, arms A and F (lines 150-262, 402-407) | exact |
| `supabase/tests/test_ledger_refresh_composite_arm.sql` (mod: 1 arm, setup list) | test (SQL gate) | batch | itself, arm C (lines 1054-1078) | exact |
| `supabase/tests/test_enqueue_dedup_record_retract.sql` (mod: 2 arms) | test (SQL gate) | event-driven (dedup retract) | itself, arms KIND-CSV / NO-CORRELATION (lines 456-554) | exact |
| `analytics-service/tests/test_ledger_refresh_gates.py` (mod: pointers, windows) | test (static gate) | transform (file-text assertions) | itself, `_FANOUT_*` / `_PHASE_MIGRATION_WINDOW_6_*` (lines 89-150, 318-357) | exact |
| `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` (new) | test (pytest characterization) | transform | `analytics-service/tests/test_broker_dailies.py` lines 1045-1092, 1176-1208 | role-match |
| `src/app/api/strategies/finalize-wizard/route.ts` (mod, 1 line) | route (API handler) | request-response | itself line 2327 (`correlationId` in scope at 2159) | exact |
| `src/app/api/strategies/csv-finalize/route.ts` (mod, 1 line) | route (API handler) | request-response | itself line 2064 (`opts.correlationId`) | exact |
| `src/app/api/strategies/finalize-wizard/route.test.ts` (mod: new payload case) | test (vitest) | request-response | itself lines 1840-1866 + mock at 670-682 | exact |
| `src/__tests__/csv-validate-route.test.ts` (mod: tighten to exact object) | test (vitest) | request-response | itself lines 1540-1565 | exact |
| `src/lib/ledger-refresh-marker.ts` (mod: JSDoc only, lines 83-84) | utility | request-response | itself | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (mod: FreshnessChip label row, ~1898 and 1825) | component | request-response | itself, SyncBadge WR-02 note (per RESEARCH SC-5) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx` (+ `recency-line` test) (mod/pin) | test (vitest/jsdom) | request-response | itself, `readChip` (lines 165-200) | exact |
| `e2e/freshness-chip-width.spec.ts` (new) | test (Playwright, seeded) | request-response | `e2e/layout-narrow.spec.ts` (geometry) + `e2e/composite-factsheet-render.spec.ts` (HAS_SEED_ENV, goto) | role-match |
| `.github/workflows/ci.yml` (mod: e2e-seeded list at ~7083 and `sql-tests` derivation rows) | config | batch | existing list entries | exact |
| `scripts/mutation-floors.mjs` + 6 census tests (mod: counts) | config / test | transform | Phase 174 and Phase 211 plan 06 precedent | exact |
| `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` (generated) | config (snapshot) | transform | `npm run schema:functions` output | exact |
| `docs/runbooks/ledger-refresh-go-live.md` (mod: prose) | doc | n/a | itself | exact |
| `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` (ship) | config | n/a | CLAUDE.md rules | exact |
| `214-DIAGNOSIS.md` (new, phase dir) | doc | n/a | none needed | n/a |
| `scripts/prod-prober/arms/cron-obs.mjs` | unchanged | n/a | read-only audit only | n/a |

## Pattern Assignments

### `<stamp2>_ledger_fanout_no_advance_weekly_cap.sql` (SECDEF fan-out re-base, batch)

**Analog:** `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql` (1148 lines).
Re-create ONLY the single-key body: tags `$fanout$` and `$verify$`, never `$composite$`, never spell
the composite function name (gate 10c). Body identical to the analog except the CASE edit, the new skip-count
statement, and STEP 2 changes.

**Header skeleton to copy** (lines 1-16, 84-107, 129-161): the OPS auto-apply warning, "forward
migration, not an edit", VAC-04 ack paragraph with a freshly measured hash, DISJOINTNESS section, and the
no-gate-needle-in-prose rule. The ack hash is the 5th field of
`node scripts/sql-body-normalize.mjs --diff-bodies <snapshot> <snapshot>`.
```sql
-- prod-body-ack: <64-hex measured on the committed snapshot, never --hash of a file>
BEGIN;
CREATE OR REPLACE FUNCTION public.enqueue_ledger_refresh_for_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fanout$
```
(analog lines 102, 163, 173-178)

**Core pattern: the cooldown CASE to edit** (lines 512-540). OR the SC-2 signal INTO the existing `WHEN`,
so `THEN INTERVAL '7 days'`, `INTERVAL '20 hours'` (2 occurrences), `WHEN EXISTS (` and
`CURRENT_DATE - 3, 'YYYY-MM-DD')` keep their occurrence counts (twins E/F/T/P1-P4 bind to them):
```sql
AND cj.created_at > now() - CASE
      WHEN EXISTS (
        SELECT 1
          FROM public.strategy_analytics sa
         WHERE sa.strategy_id = lrs.strategy_id
           AND (sa.data_quality_flags ->> 'marks_trailing_since') ~ '^\d{4}-\d{2}-\d{2}$'
           AND sa.data_quality_flags ->> 'marks_trailing_since' <= to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')
      ) THEN INTERVAL '7 days'
      ELSE INTERVAL '20 hours'
    END
```
RESEARCH signal (relayed): `OR ( lrs.stale_reason = 'series_behind' AND (CURRENT_DATE - lrs.last_return_date) >= 8 AND EXISTS ( ...compute_jobs cj3 kind='compute_analytics_from_csv' status='done' created_at >= (lrs.last_return_date + 5)::timestamptz ) )`.
**Splice point: AFTER the `EXISTS (...)` subquery's closing parenthesis and BEFORE `THEN`**, giving
`WHEN EXISTS ( SELECT 1 FROM public.strategy_analytics sa WHERE ... ) OR ( <signal> ) THEN INTERVAL '7 days'`.
The `)` on the `) THEN INTERVAL '7 days'` line closes that EXISTS. An `OR` placed before it lands INSIDE the
`strategy_analytics` WHERE clause, still compiles (`lrs` is correlated) and silently reads "true whenever any
analytics row exists", so every strategy gets the weekly window. Arm P2 (a daily-window strategy with an empty
flags object, lines 1536-1548) is the arm that catches that mistake; do not trust the eye.
Do not write `WHEN EXISTS (` anywhere new (use `AND EXISTS (`).
**Gate 2 (`TestGate2SingleSource`, `test_ledger_refresh_gates.py:1294-1330`, read this pass):** the raw `$fanout$`
body, comments included, must contain none of the lowercase substrings in `_banned_venue_names()` (the three
ledger venues from `_LEDGER_BACKED_SOURCES` plus `binance`, `okx`, `bybit`; plain `in`, no word boundary). So no
SC-2 comment or skip-count statement INSIDE the dollar quotes may spell a venue in lowercase (uppercase "MT5"
passes only by accident; do not rely on it). Put venue-flavoured narrative in the header, outside the quotes.

**Failure-instrument write to copy for the skip-count row** (lines 719-766): AFTER the last
`pg_advisory_unlock`, best-effort block with `EXCEPTION WHEN OTHERS THEN RAISE WARNING` (never raise, never roll
back enqueues; the analog's raise on `v_enqueued = 0` is specific to the failure row and must NOT be copied).
```sql
  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));
  IF v_failed > 0 THEN
    BEGIN
      INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
      VALUES ('ledger_refresh_fanout', 'error', now(), 'candidate_enqueue_failed',
              jsonb_build_object('function', 'enqueue_ledger_refresh_for_strategies',
                                 'cause', 'candidate_enqueue_failed', 'failed_count', v_failed, ...
```
New row shape (discretion; RESEARCH recommendation): `status 'ok'`, `error NULL`,
`metadata {function, cause: 'no_advance_weekly_cap', skipped_count, skipped_targets:[{strategy_id, days_unmoved}]}`.
`cron_runs.status` CHECK allows `'ok'` (`20260408113029_cron_heartbeat.sql:31-39`, *relayed*). The prober
(`scripts/prod-prober/arms/cron-obs.mjs:231-234`, *relayed*) and the failed-attempt cooldown (analog lines 561-569)
both filter `error = 'candidate_enqueue_failed'`, so an `error NULL` row cannot disturb them.

**Pitfall specific to the skip count:** its cohort "no attempt in the last 20 hours" would add a THIRD
`INTERVAL '20 hours'` and break twins E/F/T (`"occurrences":2,"nth":1/2`). Either recount every needle with
`grep -c -F` and update those twins to the new count (Phase 174 plan 02 recount table), or spell the window
differently and prove equivalence with a parity arm. Likewise any re-spelled `WHERE lrs.is_stale`,
`AND lrs.is_composite = FALSE`, `AND s.status IN (`, `AND ak.*` conjunct raises that needle's count from 1.

**STEP 2 verify block to copy and edit** (lines 854-1147): all DECLAREs up front (plpgsql compiles whole),
needles built by concatenation so the migration's own text never repeats a twin's `find` string:
```sql
  v_instr_needle TEXT := 'INSERT INTO public.' || 'cron_runs';
  v_week_needle  TEXT := 'INTERVAL ''7 ' || 'days''';
  ...
  v_instr_count := (length(v_def) - length(replace(v_def, v_instr_needle, ''))) / length(v_instr_needle);
  IF v_instr_count <> 2 THEN            -- becomes 3 (and the message), check 7, line 1037
```
Add a needle for the skip statement that no twin mutates (e.g. the `'no_advance_' || 'weekly_cap'` token).
Keep the catalogue-only rule (`pg_proc`, `pg_namespace`, `pg_roles`, `aclexplode`; lines 834-847): reading
application rows and RAISEing is refused by `scripts/lint-migration-data-dependence.mjs`. Never call the
function in the verify block (line 828). Keep check 11 (EXECUTE grantees == owner, lines 1108-1132) and
restate the REVOKE (lines 818-819):
```sql
REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated, service_role;
```
Extend `COMMENT ON FUNCTION` with one Phase 214 sentence (analog lines 786-809). Close with `COMMIT;`.

---

### `<stamp1>_ledger_staleness_closed_composites.sql` (view, read)

**Analog:** `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` (492 lines).
Do NOT spell either fan-out function name even in prose (gates 3b/10c). Restate the full
`CREATE OR REPLACE VIEW` including the venue arrays and status pair verbatim (static gates 1, 9).

**View head, options, verdict region** (lines 181-262, abridged):
```sql
CREATE OR REPLACE VIEW public.ledger_refresh_staleness
WITH (security_invoker = true) AS      -- MUST be restated: OR REPLACE keeps ACL but resets WITH(...)
WITH ledger_venue_set AS (
  SELECT ARRAY['deribit', 'sfox', 'mt5']::TEXT[] AS venues,
         ARRAY['mt5']::TEXT[]                    AS deferred_venues
), strategy_venue AS ( ... )
SELECT sv.strategy_id, sv.is_composite, sv.exchanges, (sv.exchanges && lv.deferred_venues) AS has_mt5_member,
  sa.computation_status, sa.computed_at AS analytics_computed_at, sas.computed_at AS series_written_at,
  lr.last_return_date, (CURRENT_DATE - lr.last_return_date) AS days_since_last_return,
  -- >>> LEDGER_REFRESH_VERDICT_BEGIN
  ( sa.strategy_id IS NULL OR sa.computation_status IS NULL
    OR sa.computation_status NOT IN ('complete', 'complete_with_warnings')
    OR lr.last_return_date IS NULL
    OR (CURRENT_DATE - lr.last_return_date) > 4 ) AS is_stale,
  CASE ... WHEN (CURRENT_DATE - lr.last_return_date) > 4 THEN 'series_behind' ELSE NULL END AS stale_reason
  -- <<< LEDGER_REFRESH_VERDICT_END
FROM strategy_venue sv CROSS JOIN ledger_venue_set lv ... CROSS JOIN LATERAL ( ... ) AS lr
WHERE sv.exchanges && lv.venues;
```
**Edit shape (RESEARCH "needle-preserving"):** add a second `CROSS JOIN LATERAL` (`cl`: `count(*) members`,
`count(sk.window_end) windowed`, `max(sk.window_end) max_window_end` over `strategy_keys`), keep the existing
`> 4` text and append `AND NOT cl.is_closed`-style predicate in the two verdict spots; append `is_closed`
(COALESCE'd so it is never NULL, otherwise `is_stale` could go NULL and read fresh to `WHERE lrs.is_stale`) and
`closed_through` AFTER `stale_reason`. Orchestrator addendum: `is_closed` also requires
`max(window_end) <= CURRENT_DATE`. No `computed_at` / `last_sync_at` / `series_written_at` inside the markers
(gate 6). The `lr` lateral and its `jsonb_typeof` guards (lines 270-292) stay byte-identical.

**Grants and comments to restate** (lines 295-334): `COMMENT ON VIEW`, `COMMENT ON COLUMN` for each new column,
```sql
REVOKE ALL ON public.ledger_refresh_staleness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ledger_refresh_staleness TO service_role;
```

**Verify block (STEP 3) to re-run catalogue-only** (lines 340-490): `pg_class.reloptions` contains
`security_invoker=true` (387-396), zero grants for anon/authenticated/PUBLIC and `has_table_privilege` false for
anon/authenticated, true for service_role (398-423), and the `pg_get_viewdef` readback of `ARRAY[...] AS venues`
with the anti-vacuity floors (443-476). The analog's step 7 (lines 486-489) runs
`SELECT count(*) INTO v_rows FROM public.ledger_refresh_staleness` and uses `v_rows` only in a `RAISE NOTICE`.
`scripts/lint-migration-data-dependence.mjs` (read this pass) refuses the CONJUNCTION of an application-relation
read and a `RAISE EXCEPTION`, `INTO STRICT`, `IF NOT FOUND THEN RAISE` or `ASSERT` derived from it; it allows
`RAISE NOTICE` and a read that only drives a conditional write, and it has no opt-out marker. So step 7 is legal
only while `v_rows` never reaches a raise. **Recommendation: drop step 7 in the new view migration** (the viewdef
readback is catalogue-only and a whole-view evaluation at apply time buys nothing it does not); if kept, keep it
NOTICE-only and never add a count-based refusal.

**Static-gate facts for the view file** (read this pass): Gate 1 (`TestGate1VenueDrift`, lines 1155-1262) reads only
the migration `_STALENESS_VIEW_MIGRATION_NAME` points at and requires, in its comment-stripped body, exactly ONE
`ARRAY[...]::TEXT[] AS venues` and exactly one `... AS has_mt5_member` whose expression reads `deferred_venues` and
names no venue. The original migration keeps its own array and is not counted once the pointer moves, so
restating the arrays verbatim in the new file is correct, not a second drift surface for this gate. Gate 2 scans
only the fan-out body, not the view.

---

### Down-migrations `down/<stamp>-rollback.sql`

**Analog:** `supabase/migrations/down/20261114130000-rollback.sql` (header lines 1-39 then `BEGIN; SET lock_timeout = '3s';`).
Copy the structure: a long header stating WHAT IT UNDOES / KEEPS / COSTS and the
"ledger row is left in place" paragraph; body restores the prior definition verbatim (fan-out: the
`20261030120000` body with the same REVOKE and verify shape). **The view rollback cannot be a
`CREATE OR REPLACE`:** that statement can only append columns, so restoring the 11-column view over the 13-column
one errors. State the choice in the header and take one of: (a) `DROP VIEW public.ledger_refresh_staleness;` then
`CREATE VIEW ... WITH (security_invoker = true)` with the original body and the REVOKE/GRANT restated, because
DROP loses the ACL and the reloptions (assert both afterwards, as the analog STEP 3 does); or (b) keep the two
appended columns and revert only the verdict region with an in-place `CREATE OR REPLACE`. Nothing in the repo
depends on the view by object (RESEARCH, relayed), so (a) is safe. Manual, off the auto-apply path.

---

### `supabase/tests/test_ledger_refresh_fanout.sql` (SQL gate, mutation twins)

**Analog:** itself. Needs: (a) every edit-kind twin's `"file"` re-pointed from `20261030120000_...` to the new
fan-out migration; (b) `RED-UNDER-SETUP` apply list (line 346) gets the new view migration then the new fan-out
migration appended, in that order, last entry stays the fan-out; (c) new arms; (d) sentinel and count.

**RED-UNDER-SETUP shape** (line 346): one JSON object on one `-- RED-UNDER-SETUP:` line,
`..., "supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql"]}`.

**New-arm shape to copy: matched pair per cooldown branch** (arms P1/P2/P3, lines 1501-1575). A prose
`RED-UNDER:` paragraph, a single-line `RED-UNDER-M:` twin whose replacement KEEPS the original token as a prefix
so STEP 2's apply-time needle still passes (the ARM, not the apply, is the first failure), then the assertion:
```sql
  -- RED-UNDER-M: {"arm":"P1","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql","find":"THEN INTERVAL '7 days'","replace":"THEN INTERVAL '7 days' - INTERVAL '6 days'","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id IN (s_mp1, s_mp2);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_mp1 AND kind = 'derive_broker_dailies' AND created_at > now() - INTERVAL '1 hour';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P1): ... Likely cause: ...', v_cnt;
  END IF;
  ...
  UPDATE strategies SET status = 'draft' WHERE id IN (s_mp1, s_mp2);   -- re-park after each arm
```
**Fixture shape** (lines 678-679, 781-790): fixtures are seeded `draft` ("parked") and each arm promotes only its
own strategies to `published`; stale series via `returns_series = jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - N, 'YYYY-MM-DD'), 'value', 0.002))`;
attempts via `INSERT INTO compute_jobs (strategy_id, kind, status, created_at) VALUES (s, 'derive_broker_dailies', 'done', now() - INTERVAL '2 days')`.
New SC-2 fixtures need a `done` `compute_analytics_from_csv` job (none of the existing arms insert that kind, so
none can trip the new branch) and `last_return_date` ages 7 (daily window kept) and 8+ (weekly) as a matched pair,
plus a P3-style "admitted after 7 days, never excluded" arm, plus a skip-row assertion keyed on `cron_name`,
`metadata->>'cause'` and the strategy id (assert about YOUR OWN rows on shared TEST).
The arm count appears in several places and ALL move with every arm added: header prose at line 225, the prose at
line 1102 (which says "THE TWO PROSE MENTIONS ABOVE CARRY THE COUNT ON PURPOSE AND MUST MOVE"), and the executed
`RAISE NOTICE 'ALL 31 ARMS EXECUTED (A, B, ..., W) and passed ...'` at line 2652 (list and count). The executed
notice is the pinned sentinel; edit it only there.

---

### `supabase/tests/test_ledger_refresh_staleness.sql` (SQL gate)

**Analog:** itself. Existing twins A, B, C, D, E1, E2 (view part), F, G edit `20260825120000_...`'s text
(lines 227, 269, 288, 324, 360, 377, 407, 436); once the new view migration redefines the view they mutate dead
text and report `no-red`. Re-point the view-text edits to the new file (needles must occur once there), keep E2/E3
parser edits on the original file (the parser function is not re-created). Append the new view migration to
`RED-UNDER-SETUP` (line 89, currently ends `...20260825130000..., ...20260825140000_ledger_refresh_composite_arm.sql`).

**Arm shape** (arm A, lines 221-262): read the view row for the seeded strategy, assert `is_stale`, `stale_reason`,
`last_return_date`, then advance the REJECTED timestamps and assert the verdict does not move:
```sql
  SELECT is_stale, stale_reason, last_return_date, days_since_last_return, has_mt5_member
    INTO v_stale, v_reason, v_last, v_days, v_has_mt5
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_a;
  IF v_stale IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'TEST FAILED (A): ...', ...;
```
**Fixtures for new arms** (lines 150-217): composites are `strategies` with `api_key_id NULL` plus
`INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)`; add `window_end` for the closed
cases (EXCLUSIVE end; closed series end = `window_end - 1`). The existing composite `s_d` has open windows and a
36-day-old series and must still read stale (negative control). New arms to cover: closed composite
`is_stale FALSE`, `stale_reason NULL`, `is_closed TRUE`, `closed_through`; one NULL window, series one day short,
failed status, no return date, single-key all read stale; `count(*) FILTER (WHERE is_stale IS NULL) = 0`.
Arm-count mentions: header prose at lines 73 and 88, the executed `RAISE NOTICE 'ALL 8 ARMS EXECUTED (A-H) and passed ...'`
at line 504, plus the `ci.yml` derivation-table row.

---

### `supabase/tests/test_ledger_refresh_composite_arm.sql` (one arm)

**Analog:** arm C (lines 1054-1078), the negative-control shape; composite twins edit
`20260924120000_ledger_fanout_failure_count.sql` with `nth 2` and stay there (the composite body is unchanged).
Add a closed-composite arm: composite with every member `window_end` set, series at `max(window_end) - 1`,
`UPDATE strategies SET status = 'published'`, call the composite fan-out, assert 0 enqueues and 0 jobs, re-park to
`draft`. Append the new view migration to this file's `RED-UNDER-SETUP` so the arm sees `is_closed`. Arm count: the header mention at line 209
(`ALL 23 ARMS EXECUTED`) and the executed notice of the same sentinel at the file's end both move to 24. Existing composite fixtures (lines 606-641) all use open
windows, so no earlier arm reads as closed.

---

### `supabase/tests/test_enqueue_dedup_record_retract.sql` (2 new arms, SQL unchanged)

**Analog:** arms KIND-CSV (456-485) and NO-CORRELATION (522-554), helpers `pg_temp.dd_seed/dd_strat/dd_call/dd_job`
(lines 107-170). New arms `FINALIZE-WIZARD-SHAPE` and `CSV-FINALIZE-SHAPE`, inserted after KIND-CSV:
```sql
  -- RED-UNDER-M: {"arm":"KIND-CSV","apply":[{"kind":"edit","file":"supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","find":"'derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite')","replace":"'derive_broker_dailies', 'stitch_composite')","occurrences":1}]}
  v_sent := jsonb_build_object('correlation_id', 'c-csv');
  v_strat := pg_temp.dd_seed('compute_analytics_from_csv', 'pending',
               jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', v_enq_at));
  v_seed := pg_temp.dd_job(v_strat, 'compute_analytics_from_csv');
  SELECT o_ret, o_state, o_msg INTO v_ret, v_state, v_msg
    FROM pg_temp.dd_call(v_strat, 'compute_analytics_from_csv', v_sent);
  ... assert v_m ? 'source' is false, refresh_marker_retracted = 'ledger-refresh',
      compute_job_dedup_events.retracted_marker = 'ledger-refresh'
```
Use the real route payloads: `jsonb_build_object('source','finalize-wizard','correlation_id', ...)` against a
`stitch_composite` row marked `ledger-refresh-composite`; `jsonb_build_object('source','csv-finalize','fmt','daily_returns','correlation_id', ...)`
against a `compute_analytics_from_csv` row marked `ledger-refresh`.

**Twin choice (RESEARCH, reasoned; keep):** the obvious mutations are taken (KIND-COMPOSITE and KIND-CSV delete a
kind, NO-CORRELATION deletes the correlation conjunct at line 528's find, MARKED-CALLER rewrites the marker test).
Use a SOURCE-keyed carve-out: reuse NO-CORRELATION's find
`     AND (p_metadata ->> 'correlation_id') IS NOT NULL\n` (legal: each twin runs on its own lane copy) and replace
with that line plus `AND (p_metadata ->> 'source') IS DISTINCT FROM 'finalize-wizard'` (and `'csv-finalize'`),
so the new arm is the first failure and NO-CORRELATION still passes. The arms are GREEN on today's SQL by design
(founder accepted; the TS test carries "RED on Phase 211 code").
Also fix prose only at line 43 (confirmed this pass: the header bullet calling the finalize-wizard shape the recorded residual) and lines 522-526 (the NO-CORRELATION arm's description of finalize-wizard as the
residual): the arm still pins "no correlation_id, no retraction"; change its payload label/prose, not its logic.
The executed sentinel at line 899 (`ALL 16 ARMS EXECUTED (SITE-A, ..., BODY-PIN)`), any header mention, and the ci.yml row move to 18.

---

### `analytics-service/tests/test_ledger_refresh_gates.py` (static gate pointers)

**Analog:** itself. In ONE commit with the migrations. ABRIDGED paraphrase of lines 89-93, 126-150, 252-253, 332-333,
338-357 and 557-563 (the real constants carry long dated comments; copy their convention, not this block):
```python
_STALENESS_VIEW_MIGRATION_NAME: Final[str] = "20260825120000_ledger_refresh_staleness_view.sql"   # -> new view file
_FANOUT_MIGRATION_NAME: Final[str] = "20261030120000_ledger_fanout_marks_paused_weekly.sql"        # -> new fan-out file
_FANOUT_SUPERSEDED_MIGRATION_NAMES = frozenset({ ..., "20260924120000_ledger_fanout_failure_count.sql",
                                                 # add "20261030120000_ledger_fanout_marks_paused_weekly.sql" })
_PHASE_MIGRATION_WINDOW_6_START = "20261030120000"; _PHASE_MIGRATION_WINDOW_6_END = "20261030120001"
# add _PHASE_MIGRATION_WINDOW_7_* and _8_* (one second wide, half-open), append both to _PHASE_MIGRATION_WINDOWS (lines 557-563)
```
Add the original view migration name to a "superseded" set so it stays named (floor 3a escape check), and add the
new names to `_PHASE_MIGRATION_NAMES` (lines 338-357). Gates 3a (named set, escape), 3b (`max(expected) == _FANOUT_MIGRATION_NAME`,
line 1545) and 7 follow the pointer. Keep the pointer-move comment convention (lines 84-137): a dated
"MOVED <date> (Phase 214 FRESHTRUTH), in the SAME COMMIT as the migration" paragraph. Phase 174 recorded three
failures (`test_3a` escape, `test_3b`, `test_10c`) when a pointer was left behind. The view file must keep the
`LEDGER_REFRESH_VERDICT_BEGIN/END` markers, the `WHERE sv.exchanges && lv.venues;` sentinel (offset past 1200
chars) and `stale_reason` past offset 300 inside the region. Run from `analytics-service/`:
`python3 -m pytest tests/test_ledger_refresh_gates.py -q`.

---

### `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` (new, characterization)

**Analog:** `analytics-service/tests/test_broker_dailies.py` lines 1045-1092 and 1176-1208 (imports `pandas`, `pytest`,
`datetime/timezone`; call `combine_mt5_deal_ledger` with a hand-built deal list). Copy the deal-row shape and call:
```python
def _mt5_trading_deals() -> list[dict]:
    return [
        {"type": 0, "entry": 1, "profit": 500.0, "swap": 0.0, "commission": -100.0,
         "fee": 0.0, "time": int(datetime(2025, 6, 2, 12, tzinfo=timezone.utc).timestamp())},
        {"type": 1, "entry": 1, "profit": -200.0, ...},
    ]
...
    from services.broker_dailies import combine_mt5_deal_ledger
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=100_200.0, account_balance=100_200.0, server_utc_offset_s=0
    )
```
Assert: series index max equals the last ledger-activity day (a `type: 2` balance-operation deal counts as a flow day),
trailing flat days are not emitted, gap_fill only fills between first and last. RESEARCH cases A-E give the matrix
(healthy, blow-up then withdrawal, dust-NaN, idle). Add `from __future__ import annotations` as in the analog.
SC-7 RED drill: neuter `gap_fill_daily_returns` (`services/broker_dailies.py:218-232`) to extend to today, see RED,
restore from a byte backup. Pytest only from `analytics-service/`; mypy strict applies only if Python source changes.

---

### `finalize-wizard/route.ts` and `csv-finalize/route.ts` (SC-8, one line each)

**finalize-wizard** (route.ts:2159 resolves `const correlationId = await getCorrelationId();` in request scope;
enqueue at 2323-2328):
```ts
const { data: jobId, error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
  p_strategy_id: resolvedId,
  p_kind: "stitch_composite",
  p_metadata: { source: "finalize-wizard" },        // -> { source: "finalize-wizard", correlation_id: correlationId }
});
```
Leave the later `sync_trades` enqueue literal (non-marker kind) alone.

**csv-finalize** (`const correlation_id = crypto.randomUUID();` at 2291; passed as `correlationId: args.correlationId`
at 2889-2892; success envelope `correlation_id: args.correlationId` at 2911; enqueue inside `retryOnceOnSerializationFailure` at 2060-2066):
```ts
admin.rpc("enqueue_compute_job", {
  p_strategy_id: strategyId,
  p_kind: "compute_analytics_from_csv",
  p_metadata: { source: "csv-finalize", fmt },       // -> { source: "csv-finalize", fmt, correlation_id: opts.correlationId }
}),
```
No SQL or helper change: the SQL already retracts when `(p_metadata ->> 'correlation_id') IS NOT NULL` and `source`
is not a refresh marker (`20261114130000_enqueue_dedup_record_retract.sql:286-288`).

### `src/lib/ledger-refresh-marker.ts`

JSDoc at lines 83-84 says "`finalize-wizard` sends only `source`, so SQL does not retract for it and this helper
remains its ONLY retraction (D11-9 residual, booked at ship)". Becomes false; rewrite to say both finalize routes
now send `correlation_id`, SQL retracts, and this helper answers `no_marker`. Keep the backstop (D11-4). Prose only.

---

### Route tests (SC-8, RED when `correlation_id` is dropped)

**csv-validate-route.test.ts** (lines 1546-1565). The current assertion is a subset match and does NOT go RED:
```ts
const [, args] = enqueueCall!;
expect(args).toMatchObject({
  p_strategy_id: NEW_STRATEGY_ID,
  p_kind: "compute_analytics_from_csv",
  p_metadata: { source: "csv-finalize", fmt: "daily_returns" },
});
```
Tighten: `expect(args.p_metadata).toEqual({ source: "csv-finalize", fmt: "daily_returns", correlation_id: <envelope id> })`
using the same `await res.json()` body the test already gets from `POST`.

**finalize-wizard route.test.ts**: the file mocks the id to a constant (lines 670-682), and the enqueue tests assert only `p_kind`/`p_strategy_id` (1851-1866):
```ts
const TEST_CORRELATION_ID = "66666666-7777-8888-9999-000000000000";
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn().mockResolvedValue(TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));
...
const enqueueCall = STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job");
expect(enqueueCall!.args.p_kind).toBe("stitch_composite");
```
Add `expect(enqueueCall!.args.p_metadata).toEqual({ source: "finalize-wizard", correlation_id: TEST_CORRELATION_ID })`
inside the "enqueues stitch_composite unconditionally for a composite (via the hoist)" case (route.test.ts:1851-1866 region).
SC-7 drill: delete `correlation_id` from either payload, see the exact-object assertion RED. Run under Node 22:
`PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <files>` after `npm ci` (worktree has no `node_modules`).

---

### `FactsheetView.tsx` FreshnessChip (SC-5)

**Analog:** itself. Current label row (the epoch-sentinel branch at ~1825 has the same row):
```tsx
<div className="flex items-center justify-end gap-1.5 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">
  <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: toneColor }} />
  {subject} · {label}
</div>
```
with `: tone === "future" ? "future — check data"` in the label ternary (~1885). Constraints the edit must keep
(from `FactsheetView.chip-honesty.test.tsx:176-190`, `readChip`): the row keeps class `tracking-[0.18em]`
(`header.querySelector('[class*="tracking-[0.18em]"]')`), its dot stays the only `span[aria-hidden]` in the row, the
text stays inside the row and `textContent` equals `Track record · future — check data`, and the chip root's
`parentElement` still holds the date `<p>` (`F-1/F-4` of `FactsheetView.recency-line.test.tsx`, *relayed*). RESEARCH shape:
keep the row one flex line, `shrink-0` the dot aligned to the first text line, wrap the text in
`<span className="min-w-0 text-right">`. Founder decision: no copy change. Reproduce the overflow RED at 1485px
in a real browser BEFORE changing a class (the August measurement predates masthead changes). The structural pin
is a vitest assertion on the new wrapper; the measurement is the Playwright spec.

---

### `e2e/freshness-chip-width.spec.ts` (new, seeded Playwright)

**Analogs:** `e2e/composite-factsheet-render.spec.ts` (HAS_SEED_ENV gate, `gotoFactsheet`, cleanup by prefix) and
`e2e/layout-narrow.spec.ts` (viewport + geometry helpers). Copy:
```ts
import { test, expect, type Page } from "./helpers/hydration-guard";
import { assertChildrenInside, assertNotClippedByAncestors } from "./helpers/geometry";
import { seedStrategyWithHistory, cleanupStrategiesByNamePrefix } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

test.describe("...", () => {
  test.skip(!HAS_SEED_ENV, "... seed env not wired ... prevents a false-green against an empty/404 factsheet (W-02)");
  test.afterAll(async () => { if (HAS_SEED_ENV) await cleanupStrategiesByNamePrefix("e2e-p214-"); });
  ...
  await page.setViewportSize({ width: 1485, height: 900 });
  const res = await page.goto(`/factsheet/${id}/v2`);
  if (res && res.status() >= 400) throw new Error(...);            // W-02 guard
```
Seed a "future" state with `seedStrategyWithHistory({ days: ..., name: "e2e-p214-...", anchorMs: Date.now() + 5 * 86_400_000 })`
(`anchorMs` at seed-test-project.ts:525; three days ahead already reads `future`, C-14). Assert with
`assertChildrenInside(page, <label row locator>, label)` (geometry.ts:281, measures text nodes with a Range, W-02
zero-element guard) and `assertNotClippedByAncestors`, for both the future label and the `Computed · fresh` baseline.
Use your own prefix and delete only that prefix (spec header, layout-narrow.spec.ts:12-13). **Two-place rule:**
place 2 is the HAS_SEED_ENV gate here; place 1 is adding the spec path to the `e2e-seeded` list in
`.github/workflows/ci.yml` (the block that lists `e2e/composite-factsheet-render.spec.ts \` at ~7083).

---

### Census and config files (mechanical tax; no new gate file)

Add arms to the three existing gate files only, so `FILES_FLOOR` and the `lint-sql-gates` file count do not move.
For N arms added, move by measured delta: `scripts/mutation-floors.mjs` (`ARMS_FLOOR`; cite by symbol, `WAIVED_CEILING`
stays 0), `src/__tests__/mutation-runner-floors.test.ts` (per-file `sections N / judged N / annotated N / biting N`
and totals), `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`,
`src/__tests__/drift-check-scripts.test.ts`, `.github/workflows/ci.yml` `sql-tests` derivation rows
(`test_enqueue_dedup_record_retract.sql 16`, `test_ledger_refresh_composite_arm.sql 23`,
`test_ledger_refresh_fanout.sql 31`, `test_ledger_refresh_staleness.sql 8`, plus `SENTINEL_FLOOR`/`ARMS_FLOOR` of that
step) and `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`. Re-measure every number at HEAD with `grep -a` before editing; do not
copy figures from this file. Procedure precedent: Phase 174 plan 02 recount table and Phase 211 plan 06 (find them
under `.planning/` by name; not re-quoted here).
`npm run schema:functions` regenerates the function snapshot; `npm run schema:functions:check` verifies. VAC-04 ack
paragraph per the fan-out migration.

---

## Shared Patterns

### Mutation twin grammar and needle hygiene
**Source:** `scripts/mutation-runner/GRAMMAR.md`; live examples at `supabase/tests/test_ledger_refresh_fanout.sql:1527`,
`:1543`, `:1567`, `:1593`.
**Apply to:** both new migrations, all four SQL gate files.
- The runner counts `occurrences` over RAW file text, comments included. A `find` string pasted into a migration
  header or comment adds an occurrence and the arm reports `occurrence-mismatch` (analog header lines 137-146 says so).
- A STEP 2 needle that a twin MUTATES aborts the apply and no arm can be first failure (header lines 129-146). Pattern:
  the twin's replacement keeps the original token (`THEN INTERVAL '7 days' - INTERVAL '6 days'`) and STEP 2 needles that
  token, built by concatenation (`'INTERVAL ''7 ' || 'days'''`).
- `WAIVED_CEILING` is 0: fix the cause, never waive.
- Prove on the lane only, never PROD: `scripts/pg-lane/run.sh --apply <RED-UNDER-SETUP list> --gate <file>`; mutation
  subset: `node scripts/mutation-runner/run.mjs --subset-from <file-list>` (disk is tight; CI owns the FULL run).

### Re-base and migration safety
**Source:** `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql` lines 1-161 and 854-1148.
**Apply to:** both migrations and both rollbacks.
Forward-only, `BEGIN; ... COMMIT;`, no `cron.schedule`/`cron.unschedule`/`PERFORM` of a fan-out in the file
(static gate scans raw), catalogue-only verification (no row-count RAISE), SECDEF with pinned `search_path`, REVOKE
restated, VAC-04 `prod-body-ack`, every needle concatenated. Migrations auto-apply TEST then PROD on merge with no
human gate, so migration-reviewer and rls-policy-auditor run clean BEFORE merge. Re-check the stamp against
`origin/main` before shipping.

### Marker-first environment safety
**Source:** project CLAUDE.md. Run the `COMMENT ON DATABASE` marker query before any PROD read (SC-4 post-merge read
goes through the Supabase MCP); no `supabase db push`, `--linked`, `--db-url` from this checkout.

### Test hygiene for gates
**Source:** user memory + CLAUDE.md. Each fix gets a neuter-restore drill from a byte backup (never `git checkout`,
`restore` or `stash` on uncommitted work), seen RED, then restored. On shared TEST assert about your own rows.
Always `grep -a`.

### Public repo hygiene
No PROD strategy ids, home paths, or account numbers in CONTEXT, RESEARCH, PATTERNS, PLAN, CHANGELOG, commits.
Never write the CI skip-trailer tokens in a commit or PR body. No authorship trailers in commits (founder rule
2026-10-20; note the harness reminder asks for them, and the user-memory rule takes precedence).
Ship step: CHANGELOG entry (this repo's section vocabulary), `VERSION`/`package.json` byte-equal, delete the closed
`TODOS.md` entries (`0.1`, `0.12`, `211-D11-RESIDUAL-UNCORRELATED-SENDERS`) in the same PR and name them in the entry.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| the skip-count `cron_runs` row (inside the fan-out migration) | instrument write | event-driven | The only existing `cron_runs` writes in this function are the dormancy row and the `status 'error'` failure row. There is no `status 'ok'` counted-skip row anywhere; shape it from the failure instrument (lines 719-766) with the differences listed above (no re-raise, `error NULL`, distinct `cause`). |
| `214-DIAGNOSIS.md` | doc | n/a | A free-form phase record: counts and ages only, no ids. The orchestrator's addendum (verdict H1, R1-R5) is its source. |
| the "closed" LATERAL in the view | SQL view | transform | Closest is the existing `lr` lateral (lines 270-292) for the aggregate-with-no-GROUP-BY idiom (always yields exactly one row); the `members/windowed/max_window_end` aggregate itself is new. |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/migrations/down/`, `supabase/tests/`, `analytics-service/tests/`,
`analytics-service/services/broker_dailies.py`, `src/app/api/strategies/{finalize-wizard,csv-finalize}/`, `src/__tests__/`,
`src/lib/`, `src/app/factsheet/[id]/v2/`, `e2e/`, `e2e/helpers/`, `.github/workflows/ci.yml`.
**Files scanned:** about 30 read (targeted ranges for large files), plus grep censuses.
**Pattern extraction date:** 2026-11-14
