---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
reviewed: 2026-11-25T13:20:44Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - analytics-service/routers/portfolio.py
  - analytics-service/services/csv_validator.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_computation_error_provenance_census.py
  - analytics-service/tests/test_failed_status_logged.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_live_db_reach_roster.py
  - analytics-service/tests/test_no_contact_support_copy.py
  - analytics-service/tests/test_portfolio_benchmark_pairing.py
  - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx
  - src/app/api/strategies/csv-finalize/route.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/lib/portfolio-analytics-adapter.test.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
  - supabase/migrations/20261125212222_computation_error_copy_contact_form.sql
  - supabase/migrations/down/20261125212222-rollback.sql
  - supabase/schema/functions/computation_error_copy.sql
  - supabase/tests/test_sync_status_curated_sentence_survives.sql
  - supabase/tests/test_sync_status_marked_refresh_protected.sql
# Counts and status below are the OPEN set after round 3 (see "## Round 3").
# Round 2 counted warning 1 / info 3; its MEDIUM (R2-WR-01) was taken by the fixer in round 2 and is closed in round 3.
# Round 1 counted warning 2 / info 2; its two MEDIUMs (WR-01, SFH-01) were taken by the fixer.
round: 3
round_2_reviewed: 2026-11-25T15:10:00Z
round_2_scope: "git diff 84d7ce330..HEAD -- . ':!.planning' (8e82ab636, 1d5f488ff)"
round_3_reviewed: 2026-11-25T14:28:44Z
round_3_scope: "git diff 5d52587f3..HEAD -- . ':!.planning' (12b56c5e4)"
findings:
  critical: 0
  warning: 0
  info: 6
  total: 6
  necessity: 0
status: clean
---

# Phase 222: Code Review Report

**Reviewed:** 2026-11-25T13:20:44Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Scope: `git diff 017ba2e08..HEAD -- . ':!.planning'` on branch `gsd/phase-222-alerttruth`, which is 24 files. The founder rulings in 222-CONTEXT.md were treated as locked and are not reported as defects. Those rulings are:

- ERRC-03 option (a) together with OQ2 (transient) and OQ4 (a `computing` row with `metrics_json` counts as published).
- The enqueue-failure payload stays unstamped and its write is kept (`EXPECTED_INERT_SITES` unchanged).
- OQ1: `benchmarkNoteTone` has no renderer by design.
- OQ3: `first_hop_enqueue_sweep`, `get_user_compute_jobs.user_message` and the `prevent_profile_role_change` RAISE are out of scope, booked through plan 01's TODOS step.
- The T-222-13 double-fault residual is accepted in plan 04's threat register.

**What was traced, and holds:**

- **`run_sync_trades_job` enqueue-failure tail (job_worker.py:2876-3025).** I traced every outcome against the current bridge (`supabase/schema/functions/sync_strategy_analytics_status.sql`) and `mark_compute_job_failed.sql`:
  - **Nothing published:** the handler writes the five-key `failed` row and returns FAILED/transient. `mark_compute_job_failed` then sets `failed_retry` and the bridge takes branch (a): the row reads `computing`, `computation_error` is NULL, and `computation_warned` is cleared by the handler's own write. At `attempts >= max_attempts` (default 3, `baseline.sql:2016`) the job is `failed_final` and the bridge takes branch (b), storing the curated transient sentence. The payload is unstamped, so the `writer`-provenance CASE does not keep the handler's sentence.
  - **Published:** no write, DONE, branch (c) keeps `complete` / `complete_with_warnings`, and the figures are untouched.
  - **Unreadable publish state:** no write and DONE (T-222-13).
  - **Predicate parity:** `_strategy_has_published_numbers` (job_worker.py:2903-2918) is the same predicate as the bridge's `v_has_figures` and as the derive handler's `_published_numbers_exist` (job_worker.py:5517).
  - **`maybe_single()` returning `None`:** with no row, `getattr(None, "data", None) or {}` yields `{}`, which correctly means "nothing published".
- **Retry path (attempt 2+).** I traced it from the top of the handler (job_worker.py:2101). The only early exits before the tail are:
  - `_exchange_preflight`, which returns FAILED or DEFERRED and never DONE (job_worker.py:1847-1880).
  - The `ccxt.RateLimitExceeded` arm, which returns FAILED.
  
  A refetch that finds no new fills still reaches the enqueue (comment at job_worker.py:2553). So a retried attempt cannot return DONE early and drop back to branch (c).
- **Migration 20261125212222:**
  - **Re-base:** the function body diffs against `20260826120000_computation_error_curated_copy.sql:263-318` in exactly the four sentences plus the `public.` qualifier. IMMUTABLE, NOT STRICT, `SET search_path = pg_catalog` and the `CANARY_162_F3_PROSE_ONLY` comment all carry over.
  - **Security and transactions:** the function is not SECURITY DEFINER. The ACL is symmetric (REVOKE PUBLIC/anon/authenticated, GRANT service_role). There are no transaction statements, and `SET LOCAL lock_timeout` is present.
  - **Self-verify:** it asserts all five arms by literal, the absence of the legacy pointer, and the ACL in both directions.
  - **Rollback:** the down file's body is byte-equal to the old one apart from the `public.` qualifier, and it keeps the canary.
  - **Mutation runner:** the two SQL gates' RED-UNDER-M arms still bite with the new file appended. 222-01-SUMMARY records `curated: arms 8/8/0 biting 8` and `marked: arms 1/1/0 biting 1`, and the marked arm `0a` mutates the bridge COMMENT, which the new file does not restamp.
- **Snapshot-parsing oracle (route.test.ts:740-817).** The ELSE and WHEN regexes cannot match the prose in the snapshot. The prose `WHEN 'somekind' THEN` is followed by text, not a newline and a quote, and the only prose "else" is lower-case. An anti-vacuity case runs per arm, and a parse failure throws at module load.
- **Benchmark split (portfolio.py:1048-1108).** `get_benchmark_returns` has exactly one `None` exit, `(None, True)` at `services/benchmark.py:496`, so `BENCHMARK_NOTE_NO_SOURCE` cannot capture another exit. Nothing else in the repo reads `benchmark_comparison.stale`. The new router tests run through the real service, and they were RED before the change.
- **Other copy.** Every changed Python sentence is pinned in its own function by `test_no_contact_support_copy.py`. No TypeScript code matches the old strings. No test still pins an old `computation_error_copy` sentence; the only remaining pin is first-hop's own constant, which OQ3 leaves out of scope.

**Concerns:** one MEDIUM data-integrity test gap: the publish predicate's gates cannot fail for a plausible mutation (WR-01). The other findings are LOW or INFO, which this repo does not fix or book.

## Warnings

### WR-01: The publish-predicate gates cannot catch a predicate collapsed to "has metrics_json". The uncaught mutation resurrects a failed strategy to `complete` (MEDIUM, data-integrity)

**Files:**
- `analytics-service/tests/test_job_worker.py:3361-3401`: the parametrized published cases and `test_computing_without_figures_is_not_published`.
- `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py:275-385`.
- The predicate under test, `analytics-service/services/job_worker.py:2903-2918`.

**Issue:** Each case the tests feed the predicate falls in one of these groups:

- **published:** `complete_with_warnings` with metrics, `complete` with metrics, `computing` with metrics;
- **not published:** `computing` with `metrics_json = None`, and no row at all.

No case has a non-success, non-`computing` status that still carries `metrics_json`. So this mutation survives every offline and live test in the phase:

```python
return isinstance(row, dict) and row.get("metrics_json") is not None
```

That state is real. Bridge branch (b) updates only the status and error columns, so a strategy that was published and whose later recompute failed reads `computation_status = 'failed'` with its old `metrics_json` still present.

Under the mutation, such a row counts as "published", so an enqueue failure returns DONE. `mark_compute_job_done` then runs the bridge, branch (c) writes `complete` with `computation_error = NULL`, and a strategy whose last computation failed is shown as healthy with stale figures. That is the SC-3 erasure class this phase exists to close, and the gate built for it cannot see it. Per OQ4, "published" is a success status or `computing` with `metrics_json`, so `failed` with metrics must take the FAILED path.

**Fix:** Add the missing negative case to the offline class and, for the stored-truth half, to the live module:

```python
# test_job_worker.py, TestSyncTradesEnqueueFailurePublishState
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "row",
    [
        {"computation_status": "failed", "metrics_json": {"sharpe": 1.0}},
        {"computation_status": "pending", "metrics_json": {"sharpe": 1.0}},
    ],
    ids=["failed_with_old_figures", "pending_with_figures"],
)
async def test_a_non_success_row_with_old_figures_is_not_published(self, row, caplog):
    result, upserts = await self._run(row, caplog)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert len(upserts) == 1 and upserts[0]["computation_status"] == "failed"
```

In the live module, add `_drive(admin, tag="failed-figures", seed_row={"computation_status": "failed", "metrics_json": _METRICS})` and assert that the row ends `failed` with `_TRANSIENT_SENTENCE` and not `complete`. Then run the mutation above and confirm both go RED.

### WR-02: The kept `failed` write is now a transient state that the wizard poller treats as terminal, and its sentence promises the wrong retry (LOW, user-facing, transient)

**Files:**
- `analytics-service/services/job_worker.py:2978-3013`: the write, with the sentence at `:2990-2994`.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1435`: the poller's terminal `failed` branch.

**Issue:** On the nothing-published path, the handler commits `computation_status = 'failed'` and then returns FAILED/transient. The status bridge does not rewrite the row until `mark_compute_job_failed` runs, after the handler has returned. For that interval the row reads `failed`. While retries remain, the bridge then turns it into `computing`.

The poller (fixed backoff of 3-10 s, `POLL_BACKOFF_MS`, with no realtime channel) treats `failed` as terminal. If a poll lands in that interval, it sets `GATE_ANALYTICS_FAILED` and stops polling, even though the queue retries the sync 30 s later and usually succeeds.

The stored sentence also says "The next scheduled sync will retry". On this path that is no longer true: the queue retries this same job within minutes, and at the last attempt the bridge replaces the sentence anyway. The flash existed before this phase too (write, then DONE, then `complete`).

The write itself is retained by the founder's census ruling, so only the timing and the sentence's retry claim are at issue. The window is milliseconds and the event is rare, hence LOW.

**Fix (if ever taken up):** Either word the sentence so it is true on this path, for example "Analytics could not be queued after this sync; it will retry automatically — use the contact form if this persists." The contact-form tail is the founder's wording; only the retry clause changes. Or have the poller treat `failed` as terminal only once no `failed_retry` / `pending` job remains for the strategy. Per the repo rule, this is recorded here only and not booked in TODOS.md.

## Info

### IN-01: The operator log on enqueue failure says it is "marking strategy_analytics as failed" on every path

**File:** `analytics-service/services/job_worker.py:2885-2892`
**Issue:** The `logger.exception` at the top of the `except` still says "marking strategy_analytics as failed so the wizard surfaces an error envelope". For a published strategy, and for an unreadable publish state, nothing is written and the job is DONE. A second ERROR line follows and corrects it, but an operator grepping the first line is misled.
**Fix:** Reword it to "sync_trades: failed to enqueue follow-on %s for strategy %s — deciding the outcome from the publish state. Error: %s", and leave the branch-specific lines below as they are.

### IN-02: The publish read and the `failed` upsert are not atomic

**File:** `analytics-service/services/job_worker.py:2919-3008`
**Issue:** If a concurrent success writer lands between the publish read at `:2922` and the unconditional upsert at `:3000`, its `computation_status` is overwritten with `failed` and `computation_warned` is cleared. Such a writer would be a `compute_analytics_from_csv` chained from a different enqueue. The figures are kept. The retry, and then branch (a), heal the row while attempts remain, but a last-attempt collision would leave `failed` over fresh figures. The window is a single round trip, and the write was unconditional before this phase.
**Fix:** None needed now. If it is ever closed, make the upsert conditional, for example an RPC or `update().eq("strategy_id", …).not_.in_("computation_status", [...])` with an insert-if-absent.

---

_Reviewed: 2026-11-25T13:20:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings (round 1, appended by the orchestrator)

### SFH-01 (MEDIUM, data-integrity): publish read and failed upsert are not atomic

**File:** `analytics-service/services/job_worker.py` (~2913-3013, the enqueue-failure tail of `run_sync_trades_job`)

The publish read (`_strategy_has_published_numbers`) and the `failed` upsert (`computation_status="failed"`, `computation_warned=False`) are separate round trips. If a concurrent derive or analytics job publishes between them, the upsert overwrites the live row's status and warned flag, so a published strategy can read `failed` and lose its warning. The race predates this phase (the old write was unconditional) but the phase now owns this block. Same observation as IN-02.

**Fix direction:** make the write itself conditional on "nothing published" (for example an update filtered to rows that are not at a success status and not `computing` with `metrics_json`, falling back to insert only when no row exists), or another minimal mechanism that closes the window. Keep the payload's five keys and the founder rulings unchanged.

SFH LOW/INFO findings (not fixed, per repo rule): stale "wizard may still hang" log text; `benchmarkNoteTone` has no caller (accepted by OQ1); migration self-verify does not assert volatility/search_path/canary; parity test ties to the snapshot, not the migration.

## Round 2

**Reviewed:** 2026-11-25T15:10:00Z
**Scope:** `git diff 84d7ce330..HEAD -- . ':!.planning'`, which covers `8e82ab636` (WR-01 tests) and `1d5f488ff` (SFH-01's conditional UPDATE plus the re-pointed tests). Four files:
- `analytics-service/services/job_worker.py`
- `analytics-service/tests/test_job_worker.py`
- `analytics-service/tests/test_failed_status_logged.py`
- `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py`

**Status:** issues_found. One MEDIUM (data-integrity) remains.

**Evidence base.** The offline gates ran here and passed (`14 passed, 7 skipped`). The 7 skips are the live module: no local-stack lane was booted for this round. Every live RED and GREEN result quoted below comes from the fixer (222-REVIEW-FIX.md), not from this round. The SQL claims below come from reading `supabase/schema/functions/*.sql`.

### What holds

1. **The filter is the exact inverse of `_strategy_has_published_numbers`.**
   - The predicate (job_worker.py:2903-2918) is `status IN success OR (status = 'computing' AND metrics_json IS NOT NULL)`.
   - Its negation is `status NOT IN success AND (status <> 'computing' OR metrics_json IS NULL)`, and that is what `.not_.in_(...)` and `.or_(...)` express.
   - `computation_status` is `NOT NULL DEFAULT 'pending'` (baseline.sql:14718; initial_schema.sql:74), so no NULL-status row can fall through the `neq`.
   - Syntax was built with the pinned postgrest-py 2.33.0. The chain serialises to `computation_status=not.in.(complete,complete_with_warnings)&or=(computation_status.neq.computing,metrics_json.is.null)`, which is valid PostgREST. `update()` defaults to `returning=representation`.
   - One parity edge, a JSON `null` stored in `metrics_json`, is recorded as R2-IN-02.
2. **With no row, the bridge creates one.**
   - `mark_compute_job_failed` always runs `sync_strategy_analytics_status(strategy, job)` (mark_compute_job_failed.sql:270-283).
   - `v_job_count >= 1`, because the `sync_trades` job itself counts. `sync_trades` is not in `v_side_kinds`, so neither side-trigger early return fires.
   - On `failed_retry`, the job is nonterminal and branch (a) INSERTs `computing`. On `failed_final`, the job is a live, unprotected failure and branch (b) INSERTs `failed` with `computation_error_copy('transient')`. Both branches use `INSERT … ON CONFLICT`, so a strategy with no row does get one.
   - The only window that differs is a mark-RPC failure, recorded as R2-IN-03.
3. **WR-01 is closed.**
   - The offline `test_a_non_success_row_with_old_figures_is_not_published` (failed or pending, with figures) goes RED under the review's mutation: DONE != FAILED.
   - The live `failed-figures` case goes RED on the resurrection (`'complete' == 'failed'`), per the fixer's log.
   - Both assert the FAILED/transient outcome, which is what the mutation changes.
4. **The new chain pin can fail.**
   - `test_failed_write_is_conditional_on_nothing_published` pins the method sequence and every argument string.
   - Dropping `not_`, dropping `.or_`, changing a column, changing a status list or reverting to `upsert` each turns it RED. The fixer's log shows the upsert revert as `['upsert'] == ['update', …]`.
5. **The census is unchanged.** There is still one payload-shaped statement, `EXPECTED_INERT_SITES = 1`, the payload is unstamped, and the five keys are as before. This matches the 222-CONTEXT.md rulings.

### Warnings

#### R2-WR-01: SFH-01 is only half closed. The outcome is still decided from the stale read, so on the last attempt the bridge writes `failed` over the row published in between (MEDIUM, data-integrity)

**Files:**
- `analytics-service/services/job_worker.py:2922`: the publish read.
- `job_worker.py:3009-3021`: the conditional UPDATE, whose result is discarded.
- `job_worker.py:3034-3041`: the unconditional `FAILED` return.
- `supabase/schema/functions/sync_strategy_analytics_status.sql:744-754`: branch (b).
- `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py:447-476`: the race test.

**Issue:** The conditional UPDATE stops the handler's own overwrite. That is the half that is fixed: `computation_warned` and the status survive the handler. But the handler still returns `FAILED/transient` whenever the read said "nothing published", even when the UPDATE matched no row because a concurrent writer had just published. What follows comes from reading the SQL:

- **Last attempt.** `mark_compute_job_failed` sets the job to `failed_final` and runs the bridge. `sync_trades` is not a protected kind, nothing newer of the same kind is `done`, and once the concurrent publisher has finished `v_nonterminal_count = 0`. Branch (b) then runs, and its `SET computation_status = EXCLUDED.computation_status` writes `failed` with the curated transient sentence over the freshly published row. The figures stay, `computation_warned` is kept, and the strategy now reads `failed`. That is SFH-01's stated harm ("a published strategy can read `failed`"), one RPC later instead of in the handler.
- **Earlier attempts.** The job is `failed_retry`, which is unmarked and nonterminal, so `v_refresh_keep` is false. Branch (a) turns a published `complete` row into `computing` until the retry. The retry reads it as published, returns DONE, and branch (c) writes `complete` again. This part self-heals.
- **Why the gate cannot see it.** The race test uses `attempts_before_claim=0`, a non-final attempt, and asserts on `after_handler`, which is the row before the mark RPC and the bridge run. Its seeded row is `complete_with_warnings`, which branch (a) keeps. So it covers neither the bridge nor the last attempt.
- **Overclaims.** The code comment at :3000-3008 says a row published in between "is left untouched". 222-REVIEW-FIX.md says SFH-01 is fixed. Both hold for the handler's write only.

The window is still a single round trip plus the last attempt, which is narrower than before. It is the same harm SFH-01 was routed for, and the fix is small and stays inside the same statement.

**Fix:** decide the return from the write's result. A zero-row UPDATE means one of two things: no row (keep FAILED, and the bridge creates the row) or a row published in between (take the published path). Only a read is added, so it is still one payload-shaped write statement and the census is unaffected:

```python
def _mark_analytics_failed() -> bool:
    _enqueue_failed_payload = {...}  # unchanged, five keys, unstamped
    res = (
        ctx.supabase.table("strategy_analytics")
        .update(_enqueue_failed_payload)
        .eq("strategy_id", strategy_id)
        .not_.in_("computation_status", sorted(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES))
        .or_("computation_status.neq.computing,metrics_json.is.null")
        .execute()
    )
    return bool(getattr(res, "data", None))

wrote = await db_execute(_mark_analytics_failed)
if not wrote and await db_read_with_retry(_strategy_has_published_numbers):
    logger.error("sync_trades: ... published between the read and the write — writing nothing, returning DONE")
    _nothing_published = False  # fall through to the DONE return
```

Extend the live race test to the last attempt (`attempts_before_claim=None`) and assert the row after the mark RPC (`row` from `_drive`) still reads `complete_with_warnings`. Neuter the re-check and confirm the test goes RED with `'failed'`.

### Info (LOW; recorded here only, per the repo rule)

#### R2-IN-01: No live case observes the UPDATE positively matching, and the race test stays green if the UPDATE errors

**File:** `test_sync_trades_enqueue_failure_bridge_live.py:447-476`, with the swallowing `except` at `job_worker.py:3022`.

**Issue:** The write sits inside the `except Exception` that logs and swallows. A PostgREST 400 would leave the row untouched, and the race test would still pass. So the fix report's statement that this test is "the live proof that the PostgREST `not_.in_` and `or_` syntax is accepted" does not hold.

No live case shows the UPDATE writing a non-published row either:
- `failed-figures` ends where branch (b) puts it anyway.
- The no-row cases match nothing.

The match is load-bearing on a `failed` row with `computation_warned = true`, a real state because branch (b) keeps `warned`. If the UPDATE missed that row, branch (a) would resurrect it to `complete_with_warnings`.

Rated LOW because the offline chain pin fixes every string, and the serialised query was verified here, so no plausible code mutation survives.

**Fix (if taken):** add a live case seeded with `failed` + `computation_warned: True` + `metrics_json`, using `attempts_before_claim=0` and `after_handler`. Assert `computation_warned is False` and that the handler's own sentence is stored.

#### R2-IN-02: A JSON `null` in `metrics_json` splits the Python read from the filter

**File:** `job_worker.py:2916` against `:3017`.

**Issue:** Python treats both a SQL NULL and a jsonb `'null'` as `None`, so a `computing` row holding jsonb `'null'` counts as "not published". The PostgREST `metrics_json.is.null` filter and the bridge's `v_has_figures` (`IS NOT NULL`) treat that row as carrying figures. The result is that the UPDATE skips the row while the handler returns FAILED. This only matters if some writer stores a jsonb `'null'`; none was found.

**Fix:** none needed now.

#### R2-IN-03: With no row and a failed mark RPC, the strategy stays row-less until the reaper requeues

**File:** `job_worker.py:2996-3021`.

**Issue:** The old upsert created a `failed` row. The UPDATE creates nothing, so if `mark_compute_job_failed` also fails, nothing writes the row until the reaper reclaims the job. The fixer flagged this as needing the founder's confirmation (222-REVIEW-FIX.md, "requires human verification"). It is recorded here so that confirmation is not lost. The trigger is a double fault.

### Round 2 verdict

- **WR-01:** closed.
- **SFH-01:** half closed. The handler no longer overwrites the row, but its FAILED return still lets bridge branch (b) mark the row published in between as `failed` on the last attempt (R2-WR-01).
- **Open MEDIUM+:** 1 (R2-WR-01, data-integrity). Status: `issues_found`.

_Round 2 reviewed: 2026-11-25T15:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 3

**Reviewed:** 2026-11-25T14:28:44Z
**Scope:** `git diff 5d52587f3..HEAD -- . ':!.planning'`. That is commit `12b56c5e4` (the R2-WR-01 fix), and it touches three files:
- `analytics-service/services/job_worker.py`, the enqueue-failure tail of `run_sync_trades_job`
- `analytics-service/tests/test_job_worker.py`
- `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py`

**Status:** clean. No MEDIUM or higher remains.

**Evidence base.** This round measured the tests itself instead of relying on the fixer's log.
- The local-stack lane was booted from this worktree with the unmodified `scripts/local-stack/run.sh up`. It is loopback only (`127.0.0.1:54421`), and the replay set was the phase's one migration.
- The lane handoff was exported as CI's python job does it: `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY` and `LANE_DB_URL`.
- GREEN at HEAD: the live module ran `8 passed`, and the offline gate set ran `31 passed`.
- `mypy --strict services/job_worker.py`: no issues.
- The lane was then stopped with `run.sh down`. 0 `supabase_*` containers and 0 volumes remain, and the tracked tree is unchanged.

### What holds

1. **R2-WR-01 is closed end to end.** Trace:
   - **The race case (row published between the read and the write).** The conditional UPDATE matches 0 rows, so `.data == []` and `wrote` is False. The re-read sees the published row, so `_nothing_published = False` and the handler falls through to `DONE`. `mark_compute_job_done` (mark_compute_job_done.sql:39-43 sets `done` under the claim fence; :130 runs the bridge) then calls `sync_strategy_analytics_status`. A `done` job cannot enter `live_failures`, which selects `f.status = 'failed_final'` only. From there:
     - With the publisher already finished, branch (c) keeps `complete_with_warnings` (the `computation_warned` arm) and writes no error.
     - With the publisher still in flight, branch (a) runs. Its status CASE (sync_strategy_analytics_status.sql:646-654) keeps `complete_with_warnings` for a warned row, and turns a plain `complete` row into `computing` (`v_refresh_keep` is false while an unmarked job is in flight). It keeps `computation_warned`, because it clears that only for a `writer`-stamped error of an unprotected job, and this tail's payload is never stamped. The publisher's own `done` then resolves the row through branch (c).

     Either way, the `failed_final` that let branch (b) write `failed` in round 2 is no longer produced. This is the same outcome as the published-at-first-read path, which round 1 traced.
   - **Nothing published (no row).** The UPDATE matches 0 rows. The re-read finds no row, so the result is `False` and `_nothing_published` stays True. The handler returns `FAILED/transient` and `mark_compute_job_failed` runs the bridge, which INSERTs `computing` (branch (a), `failed_retry`) or `failed` with the curated transient sentence (branch (b), `failed_final`). This is unchanged from round 2.
   - **Nothing published (a row that is not published, e.g. `failed` or `pending` with figures).** The UPDATE matches, so `wrote` is True and there is no re-read. The handler returns `FAILED`, and the result is unchanged.
   - **Published at the first read, or that read unreadable.** The new block sits under `if _nothing_published:` and so is never reached. There is no write and the handler returns DONE. Unchanged.
2. **`update()` really returns the matched rows in `.data` with this repo's client.**
   - Production gets `ctx.supabase` from `_exchange_preflight`, which calls `get_supabase()` (job_worker.py:1866). That is a plain `create_client(url, service_key)` in services/db.py. `_force_http1` only rebuilds the httpx session with the same headers. There are no `ClientOptions` and no global `Prefer` header.
   - Pinned and installed: `postgrest==2.33.0` / `supabase==2.33.0` (requirements.txt:172, :255). The installed `SyncRequestBuilder.update` signature defaults `returning=ReturnMethod.representation`, and `pre_update` sends `Prefer: return=representation`, so PostgREST echoes the patched rows. A zero-row PATCH returns `[]`.
   - The live race test's client is `wrap_live_db_client(create_client(...))`, a transparent transport shim, so it measures the same `.data` shape.
   - **Closure does not depend on that default.** Suppose a future `returning='minimal'` default made `.data` empty on every UPDATE (the trade `tests/test_mt5_session_episodes.py:150` records for another writer). Then `wrote` would always be False. A row that was really written then re-reads as `failed`, which is not published, so the handler still returns FAILED. The only cost is one extra read. The unsafe direction would be a truthy `.data` on a zero-row match, which PostgREST does not produce. Measured as mutation M4 below.
3. **The tests can fail.** Each mutation below was applied to `job_worker.py` from a byte backup kept in the scratchpad, and run against the live lane plus the offline enqueue-failure, census and failed-status gates. After the last one the file was restored, and `cmp` against the backup was silent.

   | mutation | result |
   |---|---|
   | M1: drop the re-read (`if False and not wrote …`) | RED: the race test `assert 'failed' == 'complete_with_warnings'`, which is bridge branch (b) over the row published in between |
   | M2: a zero-row result means DONE with no re-read (`if not wrote:`) | RED: `test_nothing_published_ends_failed_with_the_retries_exhausted_sentence` `assert 'complete' == 'failed'`, and `test_nothing_published_on_a_first_attempt_retries_and_reads_computing` `assert 'complete' == 'computing'` |
   | M3: always "wrote" (`return True`) | RED: the race test, `'failed' == 'complete_with_warnings'` |
   | M4: never "wrote" (`return False`) | GREEN, `38 passed`. This is the safe direction (point 2), and it is expected |
   | M5: unguarded FAILED return | RED: the race test, `'failed' == 'complete_with_warnings'` |

   Every RED above comes from a row read AFTER the mark RPC and the bridge (`row` from `_drive`). The race test also asserts `result.outcome == DONE` and `job["status"] == "done"`. The race hook fires after every `_strategy_has_published_numbers` read, the re-read included, and it upserts the same row again each time, which is harmless.
4. **The census and the founder rulings are unchanged.** There is still one payload-shaped write statement, the payload is unstamped and has the same five keys, and `EXPECTED_INERT_SITES` is untouched. The offline chain pin (`test_failed_write_is_conditional_on_nothing_published`) now filters out only the mock's `.data` bookkeeping call. The method sequence and every argument string are still pinned.
5. **R2-IN-01 is narrowed.** The race test now runs as the last attempt and asserts after the bridge. If the UPDATE raised (for example a PostgREST 400 on the `not_.in_` / `or_` syntax), the `except` would keep `_nothing_published` True and return FAILED, and branch (b) would write `failed` over the race row. The race test would then go RED. That follows from the code path and was not run as a separate mutation. R2-IN-01's other half still stands: no live case shows the UPDATE matching and writing a non-published row.

### Info (LOW; recorded here only, per the repo rule)

#### R3-IN-01: No offline harness reaches the new `not wrote` branch. Only the live module gates it

**Files:**
- `analytics-service/tests/test_job_worker.py:3299-3370` (`_run`)
- `analytics-service/tests/test_failed_status_logged.py:280-330`

**Issue:** Both harnesses return a bare `MagicMock` from the UPDATE chain's `execute()`, so `.data` is a truthy `MagicMock` and `wrote` is always True. That holds even when the scripted publish read is "no row", which is a world where the UPDATE could not have matched. The re-read and the R2-WR-01 DONE path therefore run only in the live module.

That module runs in CI: the roster entry is `_LANE_SUPABASE_FAIL_IN_CI` at `test_live_db_reach_roster.py:231`, and `ci.yml`'s python job exports `SUPABASE_TEST_URL` from the lane handoff at about `:5860`. It also hard-fails when the lane env is unset under `CI=true`. That is why this is INFO.

**Fix (if taken):** in `_run`, set the UPDATE chain's `execute.return_value = MagicMock(data=[] if read is None else [{}])`. Then add an offline case where the re-read returns a published row and the handler returns DONE.

#### R3-IN-02: If the re-read raises, the handler returns FAILED, the opposite of the first read's "unreadable means DONE" rule, and the log line then misdescribes what happened

**File:** `analytics-service/services/job_worker.py:3025-3043`

**Issue:** The re-read is inside the mark `try`. If it raises, `_nothing_published` stays True and the handler returns FAILED. On the last attempt, branch (b) then writes `failed`, and for a strategy published in that window this is the R2-WR-01 harm. The fixer disclosed this as a known limit.

It needs four things at once: the enqueue failure, a lost race, a re-read failure and the last attempt. In the common no-row case, FAILED is the right outcome anyway.

The `except` also logs "failed to mark strategy_analytics as failed … wizard may still hang". When it is the re-read that raised, the UPDATE either succeeded or matched nothing, so that sentence is wrong.

**Fix (if taken):** give the re-read its own `try` and its own log line, and keep FAILED on its exception. Do not carry over the first read's "unreadable means DONE" rule here. In the common no-row case `wrote` is False, so DONE would send the bridge to branch (c), and the row would read `complete` with no analytics on a double fault. That is the SC-3 erasure this phase closes.

#### R3-IN-03: A publisher that lands after the handler's last decision still reaches branch (b) on the last attempt

**File:** `analytics-service/services/job_worker.py:3009-3055`, against `supabase/schema/functions/sync_strategy_analytics_status.sql` branch (b)

**Issue:** The fix closes the window between the read and the write. Two shorter windows remain before `mark_compute_job_failed` takes its advisory lock:
- **After a successful UPDATE.** The row was not published, and then a publisher lands.
- **After a re-read that found no row.**

On the last attempt, the bridge's branch (b) then writes `failed` over the newly published row. The `sync_trades` `failed_final` also keeps poisoning the row until a later `sync_trades` `done` supersedes it, because supersession is per kind.

**Why this is not R2-WR-01's class.** It is the accepted ERRC-03 option (a) outcome, not a race. Take an ordinary last-attempt FAILED with no race at all. A publisher of another kind that finishes an hour later reaches the bridge through its own `mark_compute_job_done`. With nothing in flight, the unsuperseded `sync_trades` `failed_final` is a live, unprotected failure, so `v_failed_count > 0` and branch (b) (sync_strategy_analytics_status.sql:744-750, `SET computation_status = EXCLUDED.computation_status`) writes `failed`. The in-window publisher gets exactly that outcome, one call earlier. R2-WR-01 was different: there, the strategy was already published before the handler's decision, and the decision was taken on a stale read. Here the handler decided correctly on what existed when it decided.

If the founder ever wants a later publish to clear a `sync_trades` `failed_final`, that is a change to the bridge's per-kind supersession, not to this handler.

**Fix:** none needed now.

### Round 3 verdict

- **R2-WR-01:** closed. The live race test is RED under M1, M3 and M5. The no-row tests are RED under M2. Everything was GREEN at HEAD.
- **SFH-01:** closed. Neither the handler's write nor the bridge it triggers marks a row published in between as `failed`.
- **Open MEDIUM+:** 0. Status: `clean`.
- **Recorded LOW/INFO:**
  - R2-IN-01, now narrowed
  - R2-IN-02
  - R2-IN-03
  - R3-IN-01
  - R3-IN-02
  - R3-IN-03

_Round 3 reviewed: 2026-11-25T14:28:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter round 3 (appended by the orchestrator)

### SFH-R3-01 (MEDIUM per SFH, disputed by the round-3 reviewer as R3-IN-02): re-read failure after a zero-row write returns FAILED

**File:** `analytics-service/services/job_worker.py` (the R2-WR-01 re-read in the enqueue-failure tail of `run_sync_trades_job`).

Triple fault: the enqueue fails, a concurrent job publishes between the publish read and the conditional write (so the write matches 0 rows), and the re-read itself raises. The handler then returns FAILED, and on the last attempt bridge branch (b) can write `failed` over the published row. The log line also says "wizard may still hang", which is misleading.

**Disposition (orchestrator):** this survived three review rounds. The round-3 reviewer argues that treating an unreadable re-read as DONE would bring back the SC-3 outcome (`complete` with no analytics) for the far more common no-row case, so FAILED is the right default and only the log line is wrong. The two readings conflict and the window needs three faults together, so it is NOT fixed in this phase. Per the repo rule it is routed: the ship PR books a TODOS entry owned by Phase 251 SYNCSTORE (which already owns `run_sync_trades_job` and depends on 222). SFH-R3 LOWs (write-raises residual in the T-222-13 family; test filter note) are recorded only.
