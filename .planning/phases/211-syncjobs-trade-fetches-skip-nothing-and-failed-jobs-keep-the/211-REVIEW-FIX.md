---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
fixed_at: 2026-11-14T00:00:00Z
review_path: .planning/phases/211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the/211-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 211: Code Review Fix Report

**Fixed at:** 2026-11-14
**Source review:** `.planning/phases/211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the/211-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02; IN-01 to IN-05 were out of scope by instruction)
- Fixed: 2
- Skipped: 0

**Where it ran.** The caller named the existing worktree `/Users/helios-mammut/claude-projects/quantalyze-211` (branch `feat/211-syncjobs`) as the only place to work, so no second worktree was created. All gates ran in that checkout, on the throwaway pg-lane (scratch cluster, loopback only). Nothing touched TEST or PROD, and no `supabase db push`, `link`, `--db-url` or `--project-ref` was run.

**Not run, by instruction (disk was at about 1 GB free).** The Docker local-stack was not booted, so the `sql-tests` lane (committed dump plus the D-F replay) was not exercised. The FULL mutation corpus was not run: the mutation runner ran on the one gate file only, with `--file`. `ARMS_FLOOR` 846 is therefore the static annotated-unwaived count from `--parse-only`, an upper bound on biting. CI `sql-mutation` FULL on the PR head is the run that compares it with a real biting count.

## Fixed Issues

### WR-01: The dedup helper adds row locks inside the enqueue, and the "lock order cannot be disturbed" claim is not proven

**Files modified:** `supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql`, `supabase/schema/functions/_record_enqueue_dedup.sql`, `supabase/tests/test_enqueue_dedup_record_retract.sql`, `scripts/mutation-floors.mjs`, `src/__tests__/mutation-runner-floors.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/gate-family-meta.test.ts`
**Commit:** 3f52ceb60
**Status:** fixed: requires human verification (a locking and logic argument; the gate is single-session and cannot prove the absence of a deadlock)
**Applied fix:** option (b). `public._record_enqueue_dedup` now runs a plain non-locking `SELECT status INTO v_status FROM public.compute_jobs WHERE id = p_job_id` after the existing early-return block. It returns when the status is `done_pending_children`, recording and retracting nothing. The header's "cannot be disturbed" sentence is replaced by the argument it rests on. The helper's contract comment and the function COMMENT gained the new rule.

**The three facts, checked against `supabase/schema/functions/` before writing them. All three hold.**
1. `_fan_in_lock_rows(v_kids, TRUE)` runs in `mark_compute_job_done.sql:112` and `mark_compute_job_failed.sql:205`, and the function body takes `FOR UPDATE OF j` (`_fan_in_lock_rows.sql:59`). In both callers `v_kids` is selected `WHERE status = 'done_pending_children'`. The only code that assigns that status is the enqueue's `v_initial_status` (`_enqueue_compute_job_internal.sql:59` and `:257`), so a row never enters it after insert, and a plain read cannot go stale into it.
2. `claim_compute_jobs` (`:141`), `claim_compute_jobs_with_priority` (`:188`, `:431`), `reclaim_stuck_compute_jobs` (`:45`) and `reset_stalled_compute_jobs` (`:52`, `:79`) all use `FOR UPDATE SKIP LOCKED`.
3. `mark_compute_job_done`'s own status UPDATE is a NO KEY UPDATE. Every unique index on `compute_jobs` that mentions `status` is partial (a `WHERE` predicate), and the only non-partial unique key is `compute_jobs_pkey (id)`. A partial index does not make `status` a key column, so the UPDATE does not conflict with the FK's FOR KEY SHARE.

**One extra finding, recorded in the migration header rather than ignored.** `mark_compute_job_failed.sql:63` and `defer_compute_job.sql:55` take an explicit `FOR UPDATE` on their OWN `running` row as their first row lock. A helper INSERT that dedups onto a running row can therefore WAIT on them. I checked that this is a plain wait and not a cycle: neither function holds any other lock the helper could hold while waiting, because the cascade locks only `done_pending_children` rows, which the helper now never touches. The header says this explicitly, and says the gate is single-session so the claim is an argument from the code, not a two-session proof. If you want that proof, review option (c) (a two-session pg-lane test on a diamond) is still open.

**VAC-04 acks.** No `prod-body-ack` pragma changed. Both pragmas are for the two `_enqueue_compute_job_internal` overloads, which this fix did not touch. Re-measured with `node scripts/sql-body-normalize.mjs --diff-bodies` against `origin/main`'s snapshot: the `live` column still reads `5ca84430...` (7 args) and `f048710a...` (10 args), matching the pragmas. The helper has no PROD body. The down migration drops the helper and carries no copy of its body, so it needed no change.

**Gate arm added: DPC-SKIP** (listed after PARENTED, before EMPTY-META). It seeds a `done_pending_children` derive_broker_dailies job carrying a `ledger-refresh` marker, calls the enqueue unparented with `{correlation_id}`, and asserts: no raise, the call returns the existing id, the job's metadata is byte-identical to the seed (marker kept), and zero `compute_job_dedup_events` rows name it. RED-UNDER twin: replace `IF v_status = 'done_pending_children' THEN` with `IF FALSE THEN`. The header arm list, the "Fifteen arms" sentence and the closing NOTICE now say sixteen.

**Neuter, RED, restore (run by hand on the checkout with `scripts/pg-lane/run.sh`):**
- pristine: exit 0, `ALL 16 ARMS EXECUTED`.
- neutered (the line replaced by `IF FALSE THEN`): exit 3, `TEST FAILED (DPC-SKIP): the fan-in child's metadata is {... "correlation_id": "c-dpc-skip", "refresh_marker_retracted": "ledger-refresh"} after an unparented caller deduped onto it`. It is the first failure, and every earlier arm passed.
- restored with `cp` from a byte backup (`cmp` identical, sha256 `4c1de569...a6a2`, the same before and after): exit 0, `ALL 16 ARMS EXECUTED`.
- No `git checkout`, `restore` or `stash` was used.

**Mutation runner, this file only** (`node scripts/mutation-runner/run.mjs --file supabase/tests/test_enqueue_dedup_record_retract.sql`, exit 2 by design for a narrowed run): baseline exit 0, `arms: 16/16/0`, `biting: 16`, `lane-invocations: 16` (the two tallies agree), all 16 arms `RED (identity ok)`, DPC-SKIP included, restore exit 0, `No defects in the narrowed scope`. `--parse-only` reads `coverage: files 82/109`, `arms: 0/846/0`.

**Censuses moved:**
- `scripts/mutation-floors.mjs`: `ARMS_FLOOR` 845 to 846, with a dated RAISED comment. `FILES_FLOOR` stays 82 and `WAIVED_CEILING` stays 0. `ci.yml` reads the floors from this file and carries no copy of them, so it needed no edit.
- `src/__tests__/mutation-annotation-parser.test.ts`: `armsSeen` 846, `stepsSeen` 957, needle count 957.
- `src/__tests__/mutation-runner-floors.test.ts`: `totalAnchored` 846, plus the synthetic GREEN_LOG fixture and its derived assertions (846/846/0, biting 846, lane-invocations 846, the per-file row 16 sections, the mean line, and the derived mismatch cases).
- `src/__tests__/gate-family-meta.test.ts`: `ARMS_FLOOR=846`.
- Vitest: `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `lint-sql-gates`, `drift-check-scripts` and `critical-regressions` pass (6 files, 1448 tests). `lint-migration-data-dependence`, `sql-mutation-nightly-parity`, `sql-mutation-scope-step`, `sql-body-normalize` and `ledger-refresh-marker` also pass. `node scripts/lint-sql-gates.mjs` reports 0 findings and `lint-app-guc.mjs` reports 0 findings.
- `npm run schema:functions` regenerated `_record_enqueue_dedup.sql`, and `npm run schema:functions:check` reports the snapshot current (133 functions).

### WR-02: A SQL-side retraction leaves no log line (silent-failure-hunter M-1)

**Files modified:** `supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql`, `supabase/schema/functions/_record_enqueue_dedup.sql`
**Commit:** f107b2006
**Applied fix:** right after `v_marker := v_res ->> 'marker';`, the helper now runs `RAISE WARNING '_record_enqueue_dedup: retracted marker % from compute_job %', v_marker, p_job_id;`. The format string is a single literal, per the file's Phase 85 invariant. The header line that said the `retracted_marker` column was the only place that records a SQL retraction now says the helper also raises a WARNING.

**Evidence.** The pg-lane log of the final tree shows four such WARNING lines in the gate run (SITE-A, SITE-B, KIND-COMPOSITE and KIND-CSV: `retracted marker ledger-refresh from compute_job ...`, and one `ledger-refresh-composite`). No WARNING arm was added. plpgsql cannot capture a WARNING without parsing psql output, which the file's idiom does not support cheaply, so the message text is not pinned by an arm. The retraction itself stays pinned by the four arms above. The WARNING does not contain the word UPDATE, so BODY-PIN's no-UPDATE count is unaffected.

**Commit split.** The two findings edit the same migration file. WR-01 was committed first with the WARNING line and its header sentence temporarily removed, then the saved full file was restored byte-for-byte and committed as WR-02. The final tree was gated as a whole.

## Skipped Issues

None.

## Known gaps and residual state

- `node scripts/check-baseline-currency.mjs` reports `baseline-stale`. This predates the fix: the migration is newer than the baseline dump on this branch, and the post-apply re-dump is the migration header's own recorded follow-up.
- The Docker local-stack lane was not booted, so the D-F replay path of this gate was not run in this iteration.
- The two-session lock proof (option (c)) was not built. The fix is option (b), as instructed.
- IN-01 to IN-05 were not touched.

---

_Fixed: 2026-11-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
