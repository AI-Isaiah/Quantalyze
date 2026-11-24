---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
reviewed: 2026-11-24T14:15:50Z
round: 3
depth: standard
diff_range: 068580f66..7c547514f
files_reviewed: 12
files_reviewed_list:
  - supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql
  - supabase/schema/functions/first_hop_enqueue_sweep.sql
  - supabase/tests/test_first_hop_enqueue_sweep.sql
  - supabase/migrations/down/20261124120000-rollback.sql
  - docs/runbooks/jobledger-go-live.md
  - docs/runbooks/compute-queue.md
  - .github/workflows/ci.yml
  - scripts/mutation-floors.mjs
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
findings:
  critical: 0
  warning: 0
  info: 7
  total: 7
  necessity: 0
status: clean
---

# Phase 227: Code Review Report (round 3)

**Reviewed:** 2026-11-24T14:15:50Z
**Depth:** standard (re-review of the round-2 fix range `068580f66..7c547514f`, `.planning` excluded)
**Files Reviewed:** 12
**Status:** clean. No Critical or Warning finding is open. Seven Info items are carried, and by repo rule they are recorded here and not fixed.

## Summary

Both round-2 findings are fixed at `7c547514f`, and the fix diff adds no MEDIUM+ defect.

- **CR-01 is fixed.** The key arm of the `cand` CTE now counts a key-scoped job only while it is in flight (0400:208-213). The list `pending, running, done_pending_children, failed_retry` is exactly the non-terminal half of `compute_jobs_status_check` (`baseline.sql:2043`), and the `OR` is parenthesised correctly. The function snapshot, the COMMENT, the 0400 header, the go-live P3 census (`jobledger-go-live.md:193-205`) and `compute-queue.md` all use the same predicate. New arm H10d (test:641-679) plants a `done` `derive_broker_dailies` job on the candidate's key and asserts the strategy is observed and re-enqueued. Its RED-UNDER-M twin widens the status test to `IS NOT NULL`. H10b keeps the `pending` half.
- **WR-05 is fixed.** The 0000 rollback precondition now refuses while `sanitize_user(uuid)` still mentions the table (`down/20261124120000-rollback.sql:83-85`), and the header gives the order.

### CR-01: every strategy-scoped and key-scoped enqueuer, checked one by one

I went through all 18 jobs in `scripts/prod-prober/cron-manifest.json` (all `active: true`) and every worker-side `enqueue_compute_job` call site.

**Key-scoped jobs on a candidate's key:**

| Source | Kind | Effect on the sweep after the fix |
|---|---|---|
| `derive-allocator-key-dailies` (jobid 42, 00:40) | `derive_broker_dailies`, key mode | Counted only while in flight. H10d pins the `done` case. |
| `poll-allocator-positions` (jobid 15, 01:00) | `poll_allocator_positions` | Never counted, because of the allocator-book NOT IN. H10c pins it. |
| Worker (`routers/process_key.py`, wizard preview chain) | key mode | Counted only while in flight, the guard H10b's rationale describes. |

No other active cron writes a key-scoped job.

**Strategy-scoped jobs.** The strategy arm `cj.strategy_id = s.id` still counts any status. Two active enqueuers do reach a zero-job private candidate:

1. **`cron-sync-trades` (jobid 43, 00:10).** `cron_sync_tick()` posts to `/api/cron-sync`. That endpoint reads every active, connected key that backs a strategy whose status is in `ALLOWED_STRATEGY_STATUSES`, and that set includes `private` (`routers/cron.py:216`, `:2148-2186`).
   - For okx, binance and bybit it first fetches and stores the key's trades. Then D-02 enqueues a strategy-mode `derive_broker_dailies` for every eligible strategy, whether it stored rows or not (`routers/cron.py:1333-1356`).
   - It enqueues nothing when the fetch is degraded, or when the venue is outside `DAILY_PNL_VENUES` (`:850`).
2. **`ledger_refresh_fanout` (jobid 40, hourly at :25).** The function admits `private` (`enqueue_ledger_refresh_for_strategies.sql:344`).
   - `ledger_refresh_staleness` marks a strategy with no analytics row, or a `pending` one, as stale (`baseline.sql:14019`), and the fan-out orders NULL return dates first.
   - On deribit, sfox and mt5 it therefore enqueues a strategy-mode `derive_broker_dailies` within an hour. That beats the 90-minute grace, and `cleared` drops the observation.
   - It enqueues only while `system_flags.ledger_refresh_enabled` is TRUE. `docs/runbooks/match-engine.md:358` expects `t`. I did not measure the PROD value.

The sweep goes blind for these strategies, but nothing is lost, for three reasons:

- **The job that hides the candidate does the first hop's work.** A strategy-mode `derive_broker_dailies` "downloads the API key's entire history", writes strategy-keyed `csv_daily_returns` and chains `compute_analytics_from_csv` (`services/job_worker.py:4957-4970`). cron-sync also runs its trade fetch first.
- **A failure still ends in a named state.** The bridge's `ledger-refresh` protection applies only `AND v_publish_healthy` (`sync_strategy_analytics_status.sql:379`). For a never-computed strategy that conjunct is FALSE, so a `failed_final` derive counts as an unprotected failure, and the `v_failed_count > 0` branch (`:744`) writes `failed` with the per-kind sentence. The cron-sync job carries no marker at all.
- **The re-entry repeats.** Both crons run again (every 24 hours, or after the fan-out's 20-hour cooldown), so a candidate they hide is not abandoned.

**No other enqueuer reaches the cohort:**

- **Worker linked recompute** (`_enqueue_linked_strategy_recompute`, `services/job_worker.py:4304`). It skips any strategy without a dated point in its stored series (`:4394-4395`, the `raw_end` NULL skip), so it never reaches a candidate.
- **`reconcile_dropped_enqueue_sweep` (36).** It requires `csv_daily_returns`, which a candidate never has.
- **`reap_strategy_analytics_stuck_computing` (30).** It touches only `computing` rows.
- **`ops_staleness_check` (44).** It only reads `compute_jobs`.
- **`match_engine_cron_tick` (1)** and every remaining job in the manifest. None writes `compute_jobs`.

IN-07 records that the 0400 header and the runbooks do not describe this narrowing.

### Other checks

- The `find` strings of both mutations occur exactly once in the migration file. H10d's needle is `AND cj.status IN (…)`. H10b's needle is `OR (cj.api_key_id = s.api_key_id`. The header prose does not repeat either one.
- The 0400 `$verify$` block asserts no needle on the key arm, so the H10d mutation cannot abort the apply.
- `git log origin/main` has no commit touching 0400, so editing it in place is safe.
- WR-05:
  - The signature `sanitize_user(uuid)` matches `20261124120700:35`.
  - The body the 0700 rollback restores never mentions the table. The only mentions are in its header comment and in its `position(...)` verify, both outside the function body. The required order (0700 rollback first, then 0000) therefore passes the new check.
  - The full list of DB dependants of the table is the 0000 functions, the 0100 watchdog pair, the 0600 trigger function and the 0700 `sanitize_user`. All are now covered.
- The censuses agree across all four places: 22 -> 23 in the ci.yml table and the sentinel, `ARMS_FLOOR` 578 -> 579, and `mutation-floors.mjs` 989 -> 990. No stale `578` or `989` pin is left in `src/__tests__`. The other file whose sentinel reads `ALL 22 ARMS` is `test_compute_job_attempt_failures.sql`, and 22 is its correct count.

**Coverage.** I did not read the 117 KB `src/__tests__` diff line by line. I grepped it for stale values only. I did not run the SQL corpus or the vitest suite. `necessity-review.md` was read and raises nothing. The allocator-book NOT IN is kept with a stated purpose (an in-flight poll must not clear an observation), so it is not a necessity finding.

## Resolution of earlier rounds

| ID | Round | Severity | Status at `7c547514f` | Evidence |
|---|---|---|---|---|
| CR-01 | 1, 2 | Critical | **Fixed (round 3)** | In-flight key arm (0400:208-213), arm H10d, census and runbooks updated. The strategy arm was checked across all active crons (see Summary). |
| WR-01 | 1 | Warning | Fixed (round 2) | `_is_not_running_refusal` at both failed-mark sites, arm E10, three pytest cases. |
| WR-02 | 1 | Warning | Fixed (round 2) | Owner columns with cascade, copied at all 7 writers. |
| WR-03 | 1 | Warning | Fixed (round 2) | `asyncio.wait_for` around the pre-dispatch renew. |
| WR-04 | 1 | Warning | Fixed (round 2) | Catalogue-only refusals for 0100 and 0600. |
| WR-05 | 2 | Warning | **Fixed (round 3)** | `sanitize_user(uuid)` refusal (`down/20261124120000-rollback.sql:83-85`). The header gives the order. |
| SFH-01 to SFH-06 | 1 | Warning | Fixed (round 2) | See the round-2 report's evidence column. |
| GDPR-ERASE | 1 (coordinator) | — | Fixed (round 2) | `sanitize_user` re-base 0700, arms E11 to E11d. |
| IN-02 | 1 | Info | Closed by SFH-01 | Same defect. |
| IN-01, IN-03, IN-04, IN-05, IN-06 | 1, 2 | Info | Open, not fixed by policy | Carried below. |

## Narrative Findings (AI reviewer)

No Critical or Warning findings.

## Info

### IN-07: The 0400 header and the runbooks do not say that two crons also satisfy the strategy arm

**File:** `supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql:49-74`, `docs/runbooks/jobledger-go-live.md:209-213`, `docs/runbooks/compute-queue.md:486-489`
**Issue:** These places name the two key-scoped fan-outs as what emptied census (a). They do not say that cron-sync's D-02 derive (00:10, okx, binance and bybit) and the ledger fan-out (hourly, deribit, sfox and mt5, when enabled) put a strategy-scoped job on a private candidate, usually inside the grace. The sweep's live cohort is therefore mostly what neither cron reaches: a degraded fetch, a venue outside both sets, or the fan-out disabled.

The behaviour is correct, as the Summary shows. Only the description is incomplete, and a reader of P3 may expect a larger count than the sweep will ever see. The runbook's "a non-zero count here is plausible" understates how small it should be.
**Fix:** Optional. Add one sentence to the DEC-05-C bullet and the P3 "Expected" note naming the two strategy-scoped re-entries.

### IN-08: Only `pending` is pinned among the four in-flight statuses

**File:** `supabase/tests/test_first_hop_enqueue_sweep.sql:584-608` (H10b)
**Issue:** H10b plants a `pending` key job. If someone removed `running`, `done_pending_children` or `failed_retry` from the IN list, no arm would go red. The cost is small: such a change would only let the sweep observe a candidate whose key has a derive running.
**Fix:** Optional. Stage H10b's job as `running` (by UPDATE, as H10d does), or add a second row.

### IN-05 (carried): The GDPR export covers only allocator_id-keyed ledger rows

**File:** `src/lib/gdpr-export-manifest.ts:700-711`
**Issue:** Strategy-keyed and key-keyed rows are erased but not exported. This matches the `compute_jobs` posture.
**Fix:** Optional. Add parent-keyed entries, or route the Art. 15 decision to `/gsd-secure-phase`.

### IN-06 (carried): An attempt in flight at erasure time can write a new ledger row after the DELETE

**File:** `supabase/migrations/20261124120700_sanitize_user_attempt_failures.sql:133-137`
**Issue:** The window is one in-flight attempt. The ledger has no retention.
**Fix:** Optional. Note it in the 0700 header, or include the ledger in the retention work.

### IN-01 (carried): A fence-renew error leaves the job to the watchdog, which records it as a stall

**File:** `analytics-service/main_worker.py:1157-1190`
**Issue:** Unchanged. The ledger row reads `watchdog_reset` for a job that never ran.
**Fix:** Optional.

### IN-03 (carried): Wrong signature in the drift-check floor comment

**File:** `scripts/baseline-content-drift-check.mjs:353`
**Issue:** The comment names `(uuid, text, text, text)`. The real signature is `(uuid, uuid, text, text)`.
**Fix:** Correct the comment.

### IN-04 (carried): The finalize route's "No backstop" comment goes stale once the sweep is registered

**File:** `src/app/api/strategies/finalize-wizard/route.ts:2425-2429`
**Issue:** CR-01 is fixed, so once the sweep is registered it is the backstop this comment says does not exist.
**Fix:** Point the comment at the sweep and `docs/runbooks/jobledger-go-live.md`.

---

_Reviewed: 2026-11-24T14:15:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (round 3)_
