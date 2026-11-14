---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
reviewed: 2026-11-14T17:53:01Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/tests/test_ledger_refresh_gates.py
  - analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py
  - docs/runbooks/ledger-refresh-go-live.md
  - e2e/freshness-chip-width.spec.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/csv-validate-route.test.ts
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/lib/ledger-refresh-marker.ts
  - supabase/migrations/20261114151700_ledger_staleness_closed_composites.sql
  - supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql
  - supabase/migrations/down/20261114151700-rollback.sql
  - supabase/migrations/down/20261114152300-rollback.sql
  - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
  - supabase/tests/test_enqueue_dedup_record_retract.sql
  - supabase/tests/test_ledger_refresh_composite_arm.sql
  - supabase/tests/test_ledger_refresh_fanout.sql
  - supabase/tests/test_ledger_refresh_staleness.sql
findings:
  critical: 0
  warning: 2
  info: 10
  total: 12
  necessity: 1
status: issues_found
---

# Phase 214: Code Review Report

**Reviewed:** 2026-11-14T17:53:01Z
**Depth:** standard, plus cross-file checks on the SQL call chain and gate annotations
**Files Reviewed:** 24 (`git diff 4c4fa1993..HEAD -- . ':!.planning'`)
**Status:** issues_found

Severity mapping for this repo: frontmatter `critical` = HIGH/CRITICAL, `warning` = MEDIUM,
`info` = LOW/INFO. **Only the two MEDIUM findings (WR-01, WR-02) are actionable.** The LOW and INFO
items are recorded here only, under the TODOS rule (a): they are not booked in `TODOS.md`.

## Summary

No HIGH or CRITICAL defect was found. The SQL is correct where it carries load. Two MEDIUM findings
are about the integrity of the gates around the new fan-out body. Neither one is a runtime defect
today.

**Verified clean. I measured each of these; none is assumed:**
- **SC-3 view (`20261114151700`).**
  - The view body diffs against `20260825120000` and against the `baseline.sql` definition with
    exactly two one-conjunct edits (`AND NOT cl.is_closed` on the verdict and on the
    `series_behind` CASE branch), the appended columns and the `cl` lateral. Nothing else moved.
  - Operator precedence is right: `AND` binds tighter than `OR`, so the excuse attaches only to the
    age disjunct.
  - `is_closed` is never NULL, through COALESCE on the raw aggregate. When the series is empty,
    `is_stale` is still TRUE through `last_return_date IS NULL`, so the view fails toward stale.
  - `security_invoker = true` is restated. The REVOKE/GRANT are restated. The DO block reads the
    catalogue only.
  - `window_end` is `date` (baseline `strategy_keys`), so `max(window_end) - 1` and
    `<= CURRENT_DATE` are type-correct.
- **Rollback for `20261114151700`.** It uses DROP + CREATE, which is required because a column
  cannot be dropped through CREATE OR REPLACE. It re-revokes anon/authenticated after the
  default-privilege re-grant and re-asserts `security_invoker`. No plpgsql or view dependants block
  the DROP.
- **SC-2 fan-out (`20261114152300`).**
  - The function body diffs against `20261030120000` with exactly two additions: the
    `OR (no-advance signal)` spliced after the marks-paused `EXISTS` close paren and before
    `THEN INTERVAL '7 days'`, and the skip-count block after the last `pg_advisory_unlock`, plus
    their locals.
  - SECURITY DEFINER, the `search_path = public, pg_catalog` pin and the owner-only EXECUTE ACL are
    all kept and asserted.
  - The rollback body is byte-identical to `20261030120000`'s.
  - The regenerated snapshot is byte-identical to the migration body.
- **cron_runs row.** `status 'ok'` satisfies `cron_runs_status_check` (`running|ok|error`) in PROD
  and in the lane fixture. `error` is NULL, so the row is invisible to `cron-obs.mjs`, to the
  failed-attempt cooldown (`cr.error = 'candidate_enqueue_failed'`) and to the test trigger.
- **Apply-time blocks.** Neither migration's DO block reads a row. `lint-migration-data-dependence.mjs`
  reports `0 NEW`. Neither block can refuse on an empty TEST.
- **Mutation annotations.** A script re-counted every `RED-UNDER-M` edit `find` in the four touched
  gate files against the raw migration text. All occurrence counts match, and every `nth` lands in
  the intended site: candidate query vs skip block.
- **Censuses.**
  - Sentinels read 38/14/24/18.
  - The `ARMS_FLOOR=477` table sums correctly. `ARMS_FLOOR` 864 matches the stated subset run.
- **SC-8 routes.**
  - Both routes now send `correlation_id`. Both are in scope as non-optional strings.
  - The tests use exact `toEqual`, and `TEST_CORRELATION_ID` is a non-empty string returned by the
    mocked `getCorrelationId`, so the assertion is not vacuous.
  - Now that SQL retracts first, a `no_marker` answer from the TS backstop is not treated as an
    anomaly: only `retracted` logs.
  - The other TS senders of a marker-capable kind are `keys/sync`, which was already correlated,
    and nothing else.
- **Re-runs.**

  | Check | Result |
  |---|---|
  | pytest (`test_ledger_refresh_gates.py` + the SC-1 file) | 42 passed |
  | vitest (anti-skip contract, floors, annotation parser, gate-family-meta, drift-check, csv-validate-route, finalize-wizard route) | 1453 passed |
  | `schema:functions:check` | current |

- I read `necessity-review.md` and applied it.
- As instructed, SC-5 spec test (a)'s intended failure is not flagged.

## Warnings (MEDIUM, actionable)

### WR-01: The `series_behind` conjunct of the no-advance signal can be deleted with every gate green

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:593` (the gates
are in `supabase/tests/test_ledger_refresh_fanout.sql`, arms NA1-NA4)

**Issue:** The signal has three conjuncts: `lrs.stale_reason = 'series_behind'`, age `>= 8`, and the
done-tail `EXISTS`. The `EXISTS` covers kind, `status = 'done'` and the `+ 5` cutoff.
- The twins mutate the age (NA1 and NA2), `cj3.status = 'done'` (NA3) and the `+ 5` (NA4).
- No arm and no twin touches `lrs.stale_reason = 'series_behind'`.
- No fixture has a stale strategy whose reason is not `series_behind` (for example
  `status_not_success`), whose series is 8 or more days old, which has a done compute job created
  after it went stale, and whose last attempt falls between 20 h and 7 d.
- So deleting that line from the candidate query leaves the whole corpus green. Commit `e94b2d932`
  claims "one arm per conjunct of the signal".
- The `cj3.kind` conjunct is at least covered by NA3's assertions, because NA3 seeds a done derive
  next to a failed compute. It still has no machine twin.

**Why it matters:**
- This is a live, hourly SECURITY DEFINER function that auto-applies to TEST and then PROD with no
  human gate.
- The conjunct is what keeps the weekly throttle off a strategy whose latest analytics run FAILED
  (a status that is not success) while an older done tail exists. A failing strategy should keep
  the 20-hour retry.
- Losing the conjunct moves those strategies to one attempt a week, and no gate in the repo would
  notice.

**Fix:** Add one arm and its twin, following the NA3 pattern:

```sql
-- fixture s_na5: computation_status 'failed', series 20 days old, a done
-- compute_analytics_from_csv created 1 day ago (>= lrd + 5), no attempt in 20h.
-- expect exactly 1 derive enqueued (20-hour window, not the week).
-- RED-UNDER-M: {"arm":"NA5","apply":[{"kind":"edit","file":"supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql","find":"lrs.stale_reason = 'series_behind'","replace":"TRUE","occurrences":2,"nth":1}]}
```

The needle occurs twice, at `:593` and `:879`. `nth: 1` is the candidate query. Move the sentinel,
the anti-skip table and `ARMS_FLOOR` by +1 in the same commit.

### WR-02: Two of STEP 2's carried-over apply-time guards no longer check the candidate query

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:1233` and `:1333`

**Issue:** STEP 2 still asserts presence by `position(needle IN v_def) <> 0` over the whole
function. Plan 06's skip block re-spells the same text:
- `AND s.status IN (` appears at `:537` (candidate) and `:875` (skip block).
- `marks_trailing_since`, `INTERVAL '7 days'` and `CURRENT_DATE - 3` appear at `:574-575`/`:603`
  (candidate CASE) and at `:893-894`/`:901` (skip block).

So the guard "no longer filters candidates on the strategy lifecycle column" (`:1233`) and the
"marks-paused attempt window" guard (`:1333`) are now satisfied by the skip block alone. A future
re-base that drops the candidate query's lifecycle filter or its paused branch would verify itself
green at apply time. The header's DISJOINTNESS section lists the changes STEP 2 took on (`3`
cron_runs writes, the skip needle) but not this loss.

**Why it matters:**
- These are the guards that stand on the auto-apply route between a bad re-base and PROD.
- The gate arms (H, P, P2-P5, `nth: 1`) still bite in CI, so nothing is broken today.
- But the apply-time layer has silently become vacuous. That is the "a check that proves nothing"
  class this repo records as a defect.

**Fix:** Scope the two checks to the candidate region, which is the text before the first unlock,
or pin the count:

```sql
v_first_unlock := position(v_lock_needle IN v_def);
IF position(v_life_needle IN substr(v_def, 1, v_first_unlock)) = 0 THEN ... END IF;
IF position(v_pause_needle IN substr(v_def, 1, v_first_unlock)) = 0
   OR position(v_week_needle IN substr(v_def, 1, v_first_unlock)) = 0
   OR position(v_age_needle  IN substr(v_def, 1, v_first_unlock)) = 0 THEN ... END IF;
```

Check this against the candidate query's position first: the candidate query sits inside the
lock-holding block, before the first `pg_advisory_unlock(`. Confirm that no twin mutates the
unlock needle's first occurrence.

## Info (LOW / INFO, recorded only, not actionable)

### IN-01 (LOW): One failed weekly attempt keeps a capped strategy on the weekly window

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:595-601`

**Issue:** The signal's done-tail `EXISTS` has no recency bound. The 7-day window counts any
attempt, whatever its status.
- Once one completed run has happened after going stale, the signal stays true for as long as
  `last_return_date` does not move.
- Every later attempt that fails therefore costs a full week, not 20 hours.
- A failed marked refresh can leave `computation_status` complete through the status bridge's
  `is_protected`, so the view keeps reading `series_behind`.
- An account that resumes trading while its derive fails transiently can wait up to about 14 days.

This is never an exclusion: the strategy is still admitted every 7 days. It sits inside the
founder's "weekly cap", but it widens the case the decision describes.

**Fix (if wanted):** require that the newest chain attempt is the done one, for example by adding
`AND NOT EXISTS (a failed_final attempt created after cj3.created_at)`.

### IN-02 (LOW): Most of the skip statement's mirrored conjuncts are unmutated

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:859-921`

**Issue:** The skip count re-spells the candidate cohort by hand. Only SK2 (the 20-hour
`NOT EXISTS`) and SK3 (`disconnected_at`, `nth: 2`) mutate its copy.
- Its copy of the signal is unmutated: age, `series_behind`, the done tail and `+ 5`.
- So are `NOT` marks-paused, the 7-day `EXISTS`, the in-flight guard, the lifecycle set,
  `revoked` and `is_active`.

The two copies can drift apart. The result would be a wrong count in an observability row, never a
wrong enqueue.

### IN-03 (LOW): The skip rows change what `latest_cron_success('ledger_refresh_fanout')` returns, and they accrue

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:906-912`

**Issue:** Before this change, `ledger_refresh_fanout` never wrote a `status = 'ok'` row. The
admin-only point query used by `docs/demos/pre-flight-checklist.md` now answers with skip-count
rows, and only on ticks that capped something. A reader could take one as "the fan-out last
succeeded at …".

The growth (about 8.8k rows a year, no purge) is recorded as accepted in the migration and the
runbook.

### IN-04 (LOW): "never raises" is overstated for the skip block

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:925`

**Issue:** `EXCEPTION WHEN OTHERS` does not catch `query_canceled` (57014). A `statement_timeout`
or cancel that fires during the second evaluation of the view aborts the call. pg_cron's statement
then rolls back the enqueues the tick already made.

The risk is small at cohort size, and the comment's claim is still absolute.

### IN-05 (LOW, Category: necessity): `count(*) > 0` in the closed lateral can never change the result

**Category:** necessity

**File:** `supabase/migrations/20261114151700_ledger_staleness_closed_composites.sql:245`

**Issue:** With zero members, `max(sk.window_end)` is NULL. `max(...) <= CURRENT_DATE` is
therefore NULL, `closed_raw` is NULL or FALSE, and COALESCE yields FALSE. The single-key case is
already closed without the conjunct, so no twin could make it bite.

It is harmless as documentation. The comment calls it one of "four conditions, one per line so each
can be falsified alone", which is not true for this one.

### IN-06 (LOW): The closed excuse itself has no machine twin

**File:** `supabase/migrations/20261114151700_ledger_staleness_closed_composites.sql:162,172`

**Issue:** The twins mutate the reach conjunct (I, CL, K), the member-count conjunct (J), the
future-end conjunct (L), widening the excuse (M) and the COALESCE (N). None removes `AND NOT
cl.is_closed` from the verdict or from the CASE branch.
- Arm I's assertions (`is_stale` FALSE and `stale_reason` NULL) would catch either removal by hand.
- The DO block's `NOT\s+cl\.is_closed` check is still satisfied while one copy remains.

### IN-07 (INFO): The prose names a PROD reader that does not exist

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql` (SKIP COUNT header) and `docs/runbooks/ledger-refresh-go-live.md` (new section)

**Issue:** "the trigger that refuses a failure row" is `lrf_refuse_fail_row_trg`, which the gate
arms V1/V2 create. `baseline.sql` has no trigger on `public.cron_runs`. The runbook lists it beside
the prober and the cooldown as if it were a production reader.

### IN-08 (INFO): For ccxt venues the cap removes little or no daily work

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:589-603` (the related code is `analytics-service/routers/cron.py`, D-02 NAVMTM block)

**Issue:** `cron_sync` enqueues an unmarked `derive_broker_dailies` for every eligible strategy of
a healthy key every day, whether or not it traded. This applies to venues in `EXCHANGE_CLASSES` and
`DAILY_PNL_VENUES`.
- For such a single-key ledger strategy, those derives keep the fan-out's 7-day window permanently
  occupied, so the fan-out never re-admits it.
- That is not an exclusion, because `cron_sync` is itself doing the daily refresh. But the
  "idle account re-derived every day" cost survives there.
- RESEARCH does not mention this producer. The MT5 target strategy does not appear to go through
  `cron_sync`.

### IN-09 (INFO): The signal's day boundary depends on session TimeZone

**File:** `supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql:600`

**Issue:** `(lrs.last_return_date + 5)::timestamptz` is midnight in the session TimeZone, which is
UTC under pg_cron today. Spelling it `AT TIME ZONE 'UTC'` would make it independent of the session.

### IN-10 (INFO): Arm K's DECLARE comment does not match the arm

**File:** `supabase/tests/test_ledger_refresh_staleness.sql` (DECLARE, `s_k`)

**Issue:** The comment says "series two days short of the end". The fixture and the arm's own
message say one day short of the exclusive-end allowance: series at `-201`, allowance `-200`.

---

_Reviewed: 2026-11-14T17:53:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (round 1, 2026-11-14) — orchestrator triage

- **SFH-F1 (MEDIUM, user-facing) — FIX.** The cap's completed-refresh proof accepts a done `compute_analytics_from_csv` with no done `derive_broker_dailies`. The founder decision names "a completed derive+compute run after the strategy went stale", so the signal must require both. Minimal fix: also require a done `derive_broker_dailies` created on or after `last_return_date + 5`, in the cap predicate and the skip-count read, plus a gate arm (done tail only, no done derive → 20 h window).
- **SFH-F2 (MEDIUM claimed → LOW, recorded).** The skip-count row has no automated reader, and its failure only raises a WARNING. The founder's decision specified the cron_runs count. The best-effort contract (never fail the tick) is deliberate. A reader would be a new abstraction outside this phase. Recorded only.
- **SFH-F3 (MEDIUM) — FIX.** Nothing pins the skip block's own exception handler. Minimal fix: add a STEP 2 needle for the handler, ordered after the skip needle, plus an SK arm that forces the skip write to fail (a lane-only BEFORE INSERT trigger raising for the weekly-cap cause). That arm asserts the tick still returns its enqueue count and no raise escapes.
- **SFH-F4 (LOW, recorded).** `is_closed` uses the composite series max, not per-member coverage, and the direct-key-plus-members shape exists. View D-06 records that `api_key_id` and `strategy_keys` are mutually exclusive (finalize-wizard), and a failed member stitch surfaces as `status_not_success`. Recorded only.
- **SFH-F5 (LOW, recorded).** Retraction faults can now fail the enqueue for the two finalize routes. Both paths are loud: finalize-wizard throws, and csv-finalize logs and reports to Sentry.

Fixer round 1 scope: WR-01, WR-02, SFH-F1, SFH-F3.

## Fix round 1 (2026-11-14, gsd-code-fixer)

Scope: WR-01, WR-02, SFH-F1, SFH-F3. Nothing else was touched. All proof ran on the throwaway pg-lane and the
subset mutation runner (no FULL run: disk); the migration is unmerged and was edited in place. VAC-04's
`prod-body-ack` line is byte-unchanged. Snapshot regenerated (`schema:functions:check`: current, 133 functions).

| Finding | Commit | Evidence |
|---|---|---|
| WR-01 | `d684c4b58` | Arm NA5 (fixture: analytics status failed, series 20 days old, done compute and derive a day old; expects the 20-hour window, 1 job). Twin replaces the first `lrs.stale_reason = 'series_behind'` (occurrences 2, nth 1): `arm NA5  exit 3  RED (identity ok)`. |
| SFH-F1 | `372d1439b` | Candidate cooldown signal and skip-count read both gain an `EXISTS` on a done `derive_broker_dailies` job created on or after `last_return_date + 5` (alias `cj4`). Arm NA6 (done compute tail only, no derive; expects 1 job). Twin points the first derive test at the compute kind: `arm NA6  exit 3  RED (identity ok)`. NA2's fixture gained the done derive its age twin needs (`arm NA2 ... RED (identity ok)`); NA4's twin occurrences 2 to 4 (`arm NA4 ... RED (identity ok)`). |
| WR-02 | `608f7bf81` | Checks 8 and 12 search `substr(v_def, 1, <first unlock>)`. Scratch copies of the migration: with the candidate's lifecycle filter removed, or its seven-day branch swapped for 20 hours, the PRE-fix migration applied (the `Migration 20261114152300: ... re-based` NOTICE printed, the gate then failed later on an arm) and the fixed migration refuses at apply (`ERROR: P0001: Migration 20261114152300: ... no longer filters candidates on the strategy lifecycle column (looked for "AND s.status IN (" in the candidate query ...` and `... no longer carries the marks-paused attempt window in the candidate query ...`, lane exit 3). |
| SFH-F3 | `188412c9e` | STEP 2 needle 15 (`EXCEPTION WHEN OTHERS`, searched after the skip needle). Scratch copy with the handler's condition changed: apply refuses (`... has no exception handler after it (looked for "EXCEPTION WHEN OTHERS")`). Arm SK4 (lane-only trigger refuses the skip row; tick returns 1, keeps the job, raises nothing, writes no skip row; lane log shows `skip-count write failed (SQLSTATE LRSK4)` once). Twin turns the handler's warning into a bare re-raise: `arm SK4  exit 3  RED (identity ok)`. |
| census | `134beaca7` | Sentinel `ALL 41 ARMS EXECUTED` (3 occurrences, 38 to 41), ci.yml sql-tests row 38 to 41 and its `ARMS_FLOOR` 477 to 480, `scripts/mutation-floors.mjs` `ARMS_FLOOR` 864 to 867, annotation-parser `armsSeen` 867 / `stepsSeen` 984 / `needles.length` 984, floors fixtures and the gate-family-meta key. Neuter drill: ci.yml fan-out row set to 40 gave `ci.yml's derivation credits test_ledger_refresh_fanout.sql with 40 arms; the file declares 41`; restored from a byte backup, `cmp` clean. |

Gate readings on the final tree:
- Lane: `ALL 41 ARMS EXECUTED`, exit 0.
- Subset mutation run over the fan-out gate: `arms: 47/47/0`, `biting: 47`, `lane-invocations: 47`, `file test_ledger_refresh_fanout.sql: sections 47 / judged 47 / annotated 47 / waived 0 / biting 47`, `No defects in the SUBSET`, exit 0.
- `--parse-only`: `arms: 0/867/0`, `No static defects`.
- All 44 edit-kind twins recounted against the migration's raw bytes: 0 mismatches.
- Lints (sql-gates 7 rules, app-guc, migration-data-dependence 0 NEW): clean.
- pytest `test_ledger_refresh_gates.py` + `test_sql_gate_scoped_updates.py`: 41 passed.
- vitest (anti-skip contract 33, drift-check-scripts, annotation parser, runner floors, gate-family-meta, lint-sql-gates): all passed.

Not done, by instruction: LOW/INFO items, SFH-F2/F4/F5. The census landed as one closing commit rather than per finding, so the
four fix commits each leave only the census tests behind by their own arm count until `134beaca7`.
