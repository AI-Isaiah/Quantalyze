---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 06
subsystem: supabase
tags: [sql, fan-out, ledger-refresh, cron-runs, skip-count, mutation-gate, security-definer]
requires: ["214-03"]
provides:
  - "public.enqueue_ledger_refresh_for_strategies writes one public.cron_runs row per tick that the no-advance weekly cap holds a strategy back, counting each skip with its reason (SC-2, second half)"
  - "arms SK1-SK3 with RED-UNDER-M twins; 17 twin steps recounted for the re-spelled conjuncts"
  - "runbook paragraph: a status ok, error NULL ledger_refresh_fanout row is a skip-count row"
affects: [214-07]
tech-stack:
  added: []
  patterns: ["best-effort instrument write after the last advisory unlock", "NULL-error instrument row that failure readers cannot see", "needle that is a prefix of its twin's rewrite so the apply survives and the arm is first", "arm placed after the arm whose twin it would otherwise pre-empt"]
key-files:
  created: []
  modified:
    - supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql
    - supabase/tests/test_ledger_refresh_fanout.sql
    - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
    - docs/runbooks/ledger-refresh-go-live.md
key-decisions:
  - "The skip row is status ok with error NULL and metadata.cause = the weekly-cap cause: the prober, the failed-attempt cooldown and the refuse-fail-row trigger all key on the failure error string and never see it"
  - "A tick with zero cap skips writes no row (no hourly noise; cron_runs is never purged)"
  - "The skip statement excludes marks-paused strategies so the reason is unambiguous, and counts only strategies with an attempt inside the week and none inside the ordinary window"
  - "Arms SK1-SK3 sit after arm N3, not after NA4, because SK1 asserts the failure-row count is unchanged and N3's twin makes every tick write one"
metrics:
  duration: "not captured (no start time was recorded at executor start; commit timestamps only cover part of the run)"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 12100
  tasks: 3
  commits: 3
plan_head_before: adab81261b13a029485218e9127d93164b055ab7
plan_head_after: 5102e66a084612d399306f9941814bf8ec843a7c
---

# Phase 214 Plan 06: the no-advance weekly cap counts each skip Summary

A tick that holds one or more strategies back only because of the no-advance weekly cap now writes one `public.cron_runs` row (`cron_name 'ledger_refresh_fanout'`, `status 'ok'`, `error NULL`, `metadata` with the function, the cause, `skipped_count` and `skipped_targets` naming each strategy with `days_unmoved`); a tick with no cap skip writes nothing, and the write is best-effort after the last advisory unlock so it can never roll back an enqueue.

`plan_head_after` is the head at the last task commit; the SUMMARY commit follows it. `commits: 3` is `git rev-list --count plan_head_before..plan_head_after`.

## What was built

- **Migration `20261114152300_ledger_fanout_no_advance_weekly_cap.sql`** (plan 03's file, extended):
  - two locals (`v_skipped_count`, `v_skipped_targets`);
  - a skip block after the failure instrument, inside its own `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END`;
  - the skip statement re-spells the candidate query's conjuncts over `ledger_refresh_staleness` joined to `strategies` and `api_keys` (same aliases and text): stale, not composite, lifecycle set, key eligibility, `series_behind`, age 8 or more, the done-tail EXISTS, then NOT marks-paused, an attempt inside 7 days, NO attempt inside 20 hours, no in-flight job;
  - the insert is guarded by `IF v_skipped_count > 0`;
  - STEP 2 check 7 now expects 3 writes; a new needle `v_skip_needle` (`'` + `no_advance_` || `weekly_cap`, no closing quote) with check 10f (present, and after the last `pg_advisory_unlock(`, in the shape of 10c);
  - header section "PHASE 214 SC-2 - THE SKIP COUNT", the RE-BASE and DISJOINTNESS paragraphs brought in line, `COMMENT ON FUNCTION` gains two sentences, the apply NOTICE names the skip row.
  - The VAC-04 `prod-body-ack` line is byte-unchanged (verified by grep for the plan 03 value).
- **Gate `test_ledger_refresh_fanout.sql`:** arms SK1 (a capped strategy is named, age 20, status ok, error NULL, failure count unchanged), SK2 (a strategy inside the ordinary cooldown writes no row), SK3 (a disconnected-key strategy is named in no row), each with a prose `RED-UNDER:` and a `RED-UNDER-M` twin; 17 existing twin steps recounted; the arm count and executed notice moved 35 to 38; a header paragraph records it.
- **Snapshot** `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` regenerated (102 lines added; the only snapshot that moved; `schema:functions:check` current at 133 functions).
- **Runbook** `docs/runbooks/ledger-refresh-go-live.md`: a dated `###` section before the Phase 174 section, with the row shape, why it is not a failure, the growth note, and a read keyed on `cause` that selects counts only (no strategy ids).

## Evidence

SC-7 RED (Task 1), SK1 on plan 03's body (the migration with no skip write; the same lane, the full apply list):

```
psql:supabase/tests/test_ledger_refresh_fanout.sql:2923: ERROR:  P0001: TEST FAILED (SK1): a tick that skipped a no-advance strategy because of the weekly cap wrote 0 skip-count row(s), expected exactly 1 — the cap holds a strategy back in silence, so an operator cannot see which strategies are capped or for how long. Likely cause: the skip-count write is absent, or it files the row under another cause.
```

(exit 3; the preceding job-count check passed, so the strategy was capped as designed.) The first GREEN attempt after adding the skip block failed the apply on check 7 (`writes public.cron_runs 3 time(s) ... expected 2`), which is the intended order: the check then moved to 3.

GREEN on the final bytes, quoted from the lane run:

```
psql:supabase/tests/test_ledger_refresh_fanout.sql:3021: NOTICE:  00000: ALL 38 ARMS EXECUTED (A, B, C, D, E, F, G, H, I, J, K, L, M1, M2, N, N2, N3, P, P1, P2, P3, P4, P5, NA1, NA2, NA3, NA4, SK1, SK2, SK3, Q, R, S1, T, U, V1, V2, W) and passed
```

(exit 0, no `TEST FAILED`, no `SKIP:`, the apply NOTICE `Migration 20261114152300: ... re-based`, not an exception.) At Task 1 the same run printed `ALL 36 ARMS EXECUTED`.

Subset mutation run, final bytes (`--subset-from` on the gate file only), per-file line:

```
file test_ledger_refresh_fanout.sql: sections 44 / judged 44 / annotated 44 / waived 0 / biting 44
arms: 44/44/0   biting: 44   lane-invocations: 44   (the two tallies agree)
No defects in the SUBSET
```

SK1, SK2 and SK3 each printed `RED (identity ok)`. SK1's fixtures cannot trip SK2's or SK3's twin first: SK1's attempts are 1 and 2 days old (outside the 20-hour window, so SK2's twin does not change its outcome) and its key is connected (so SK3's twin does not change it). SK2's key is connected and its attempt is inside the ordinary window, so SK3's twin leaves it uncounted.

Recount table (declared `occurrences` over the raw final bytes of the new migration; every step that changed, with `nth` kept on the candidate query's occurrence, which precedes the skip block in the text, position asserted in the fix script):

| arm | find | before | after | nth |
|---|---|---|---|---|
| E, F | `INTERVAL '20 hours'` (ELSE branch) | 2 | 3 | 1 |
| T | `INTERVAL '20 hours'` (failed-attempt cooldown) | 2 | 3 | 2 |
| E | in-flight status list (`cj2`) | 1 | 2 | 1 |
| P | lifecycle `s.status IN (...)` | 1 | 2 | 1 |
| C | `WHERE lrs.is_stale` | 1 | 2 | 1 |
| D | `lrs.is_composite = FALSE` | 1 | 2 | 1 |
| P4 | `CURRENT_DATE - 3, 'YYYY-MM-DD')` | 1 | 2 | 1 |
| P5 | the flag shape test | 1 | 2 | 1 |
| NA1, NA2 | `(CURRENT_DATE - lrs.last_return_date) >= 8` | 1 | 2 | 1 |
| NA3 | `AND cj3.status = 'done'` | 1 | 2 | 1 |
| NA4 | `(lrs.last_return_date + 5)` | 1 | 2 | 1 |
| H, H/revoked | `ak.sync_status IS DISTINCT FROM 'revoked'` | 1 | 2 | 1 |
| H/inactive | `COALESCE(ak.is_active, TRUE)` | 1 | 2 | 1 |
| H/disconnected | `ak.disconnected_at IS NULL` | 1 | 2 | 1 |
| SK1 (new) | the cause literal | - | 1 | - |
| SK2 (new) | the skip statement's 20-hour time predicate (replaced by a constant false) | - | 1 | - |
| SK3 (new) | `ak.disconnected_at IS NULL` | - | 2 | 2 |

All 41 migration-targeting steps (38 from plan 03 plus the three new) measured against their declared count: 0 mismatches. Unchanged because the skip statement spells them differently: `THEN INTERVAL '7 days'` (P1, P3: the skip statement's 7-day predicate is not preceded by THEN) and `WHEN EXISTS (` (P2: the skip uses `AND NOT EXISTS (`). Needle hygiene: the cause literal appears once and in no comment (`grep -a -c -F` prints 1); `LIMIT` or `venue_rank` lines are 7, unchanged from plan 03's file (so gate 5 still sees one of each); no `'source'` pair, no second `system_flags` read.

Rollback lane proof (plan 03 Task 3, re-run): the full list plus `supabase/migrations/down/20261114152300-rollback.sql` applied (`Rollback 20261114152300: the single-key ledger fan-out restored to the 20261030120000 body; SECURITY DEFINER, pinned search_path and owner-only EXECUTE verified`) and the gate then stopped, exit 3, with exactly one `TEST FAILED`:

```
psql:supabase/tests/test_ledger_refresh_fanout.sql:3021: ERROR:  P0001: TEST FAILED (NA1): a stale series_behind strategy at age 20 whose completed derive and compute run is 1 day old was enqueued (1 new job(s)), expected 0 — the no-advance cap is gone, ...
```

Other checks: `pytest tests/test_ledger_refresh_gates.py` 37 passed and `tests/test_sql_gate_scoped_updates.py` 4 passed; `UPDATE ... strategy_analytics` count in the gate is 0 (every new fixture seeds by INSERT); `schema:functions:check` current; `lint-migration-data-dependence` self-test OK and corpus `0 NEW`; `lint-sql-gates` self-test OK, 0 findings; `lint-app-guc` 0 findings. `ALL 38 ARMS EXECUTED` appears 3 times in the gate (two prose mentions and the notice); `ALL 36` and `ALL 35` appear 0 times.

Vitest census files (expected RED until plan 07, not chased): `mutation-annotation-parser.test.ts` (864 twins and 981 needles against the pinned 848 and 965), `mutation-runner-floors.test.ts` (864 declared twins against `ARMS_FLOOR` 848; marker count), `contracts/ci-anti-skip-gate.contract.test.ts` (477 against 461, and ci.yml's per-file derivation for `test_enqueue_dedup_record_retract.sql`, which names the Phase 211 table row first). Three other files read and passed (`drift-check-scripts`, `gate-family-meta`, `check-planning-hygiene`: the home-path finding plan 03 reported is fixed in `adab81261`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan placement] Arms SK1-SK3 sit after arm N3, not after NA4**
- **Found during:** Task 1 subset mutation run (first run: `arm N3 ... WRONG-ARM(SK1)`).
- **Issue:** SK1 asserts the `candidate_enqueue_failed` row count is unchanged across its tick (required by the plan). Arm N3's twin makes EVERY tick write a failure row, so SK1 placed before N3 became the first failure under N3's twin and stole its attribution (`red-anywhere is not success`).
- **Fix:** moved the three arms to sit right after N3 and before U, with their own failure-count variables (`v_sk_fpre`, `v_sk_fpost`) instead of reusing arm N's pair. The fixtures stay seeded with the other NA fixtures. A prose paragraph in SK1 records why. The executed-notice list is not in execution order, as it already was not.
- **Files modified:** `supabase/tests/test_ledger_refresh_fanout.sql`
- **Commit:** `ca4cad354`

**2. [Ordering] The 17-step recount landed in the Task 1 commit, not Task 2**
- **Why:** the skip statement that repeats the needles is introduced in Task 1, so a Task 1 commit without the recount would leave 17 twins failing with `occurrence-mismatch` (the same reasoning as plan 03's deviation 2). Task 2's recount step became verification: re-measured after SK2 and SK3 (41 steps, 0 mismatches) and the clean subset run below.
- **Commit:** `ca4cad354`

**3. [Rule 2 - Security] The skip handler's WARNING carries SQLSTATE, not SQLERRM**
- **Why:** the plan wrote `RAISE WARNING '...skip-count write failed: %', SQLERRM`. Every other handler in the body is written to keep identifiers out of RAISE text (T-161.1-10), and SQLERRM can quote row values such as a strategy id from a failed statement. The shipped handler formats `SQLSTATE` only, like the dormancy and failure handlers.
- **Commit:** `ca4cad354`

**4. [Process] `npm ci` was not run.** `node_modules` was already installed in this worktree and the lockfile was not touched, so no package was added or changed (same as plan 03). `verify-plan-anchors` ran first and exited 0 (8 claims, no stale).

**5. [Process] The first Task 2 mutation run reported `dirty-checkout` as its only defect.** Cause: I edited the runbook while that run was in flight, so the runner saw the working tree change. All 44 arms had printed `RED (identity ok)`. After committing the gate, I re-ran it with the working tree stable and it reported no defects (the numbers quoted above are that run).

**6. [Plan wording] Check 10f is a separate numbered check rather than a variant of the `v_block_needle` check.** Same shape (present, an unlock before it, none after it), but its own message, so a failure names the skip write and not the failure instrument. The plan said "in the shape of the `v_block_needle` order check".

**7. [Plan wording] SK2's twin makes the 20-hour time predicate a constant false instead of deleting the conjunct.** The conjunct is a multi-line `NOT EXISTS (...)`; replacing its time predicate with `AND FALSE` makes the NOT EXISTS vacuously true (the conjunct is gone in effect), is a single-line unique needle, and bites. It follows the P5 and NA3 precedent.

### Known limit, recorded not fixed

The skip statement does not carry the failed-attempt cooldown conjunct (a strategy named in a failure row inside 20 hours). A strategy that is both capped and named in such a row is still counted as a cap skip. That is accurate (the cap alone holds it past 20 hours, since a failed enqueue inserts no compute job and the cooldown is shorter than the week), and adding the conjunct would add one more repeated needle for no change in what an operator reads.

### Rollback

The manual rollback `supabase/migrations/down/20261114152300-rollback.sql` is unchanged: it restores the 20261030120000 body, which has no skip write. Skip rows already written stay in `cron_runs` (the rollback header already records that ledger rows stay in place). The rollback lane proof still fails first at NA1.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-214-19 (a skip row read as a failure) is mitigated by `error NULL` plus SK1's unchanged-failure-count assertion and the runbook paragraph; T-214-20 (the skip write rolling back the tick) by the best-effort block after the last unlock plus STEP 2 check 10f; T-214-21 and T-214-22 are accepted as planned (strategy ids in `metadata` only, readable under existing RLS, never in RAISE text or tracked files; growth of at most one row per tick, recorded in the header and the runbook).

## Notes for the orchestrator and plan 07

- Census files that move with this plan (plan 07 owns them): `ARMS_FLOOR` and the twin and needle counts (864 twins, 981 needles measured on the real corpus), and ci.yml's per-file arm derivation row for `test_ledger_refresh_fanout.sql`, which must now say 38 arms (it said 31 at plan 03's time and was behind then too).
- This plan did not touch `analytics-service/tests/test_ledger_refresh_gates.py`; its pointers already name this migration (plan 03 moved them) and it stays green (37 passed).
- SC-4 (orchestrator, after merge): the first PROD tick after the long-idle strategy's next attempt writes a skip row naming it; read it by `metadata->>'cause' = 'no_advance_weekly_cap'` and never paste the target ids. SC-6 (before merge): migration-reviewer and rls-policy-auditor clean. The VAC-04 ack is earned only if VAC-04 on the PR reports the same PROD hash.
- No PROD read or write was made in this plan. The Supabase CLI was not run; every proof ran on the throwaway lane (`$TMPDIR/pglane-214-06`, removed afterwards) and the subset mutation run.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql, supabase/tests/test_ledger_refresh_fanout.sql, supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql, docs/runbooks/ledger-refresh-go-live.md
- FOUND commits: ca4cad354, 6c6c75b64, 5102e66a0
