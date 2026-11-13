---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 06
subsystem: infra
tags: [prod-read-only, control-capture, prefix-digest, railway-deploy-proof, migration-ledger, pre-registered-predictions]

requires:
  - phase: 202-residchurn
    provides: plan 01 capture kit and SHA pin; plan 04 pre capture, c0 deploy anchor, compare_prefix.py and deploy_proof.py
provides:
  - the post-nightly capture $RC/c1, checked against PROD-side md5s, jobs idle and equal before and after
  - the c0..c1 deploy proof by content on both Railway services (empty), the ledger unchanged, and the pair verdict valid
  - the c0 to c1 prefix comparison: 14 of 54 key and strategy scopes and 6 of 7 books moved across a deploy-free nightly
  - predictions 1, 4 and 5 scored (1 failed, 4 not tested: review round 2 found s6, s9 and s10 had no job between c0 and c1; 5 held)
  - one self-checking row-read file per moved scope (14, k15 included) and groups.json for plan 07
affects: [202-07, 202-08]

plan_head_before: aa70b9a4ec4c55429ae4c3ae6961a780451a9822
plan_head_after: 96027fbe92a0dced4cb021913ebc236d276d4d9b
actuals:
  tokens: 4500
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "chk-bound saved results, recomputed locally through rc.read_n before use"
    - "pair verdict recomputed from its component lines by the task's own verify"

key-files:
  created: []
  modified:
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-06-SUMMARY.md

key-decisions:
  - "groups.json is a list of lists of labels with the group's representative first, because final_attribution.py (plan 02) parses exactly that shape; the plan's wording 'with its representative' is carried by the order."
  - "check_capture.py tallies only n_*.json and final.json, so the other new c1 files were verified separately with rc.read_n and a chk recompute, without editing the script (same narrowing as plan 04)."

requirements-completed: [RESID-01, RESID-02]

coverage:
  - id: D1
    description: "c1 is taken after the 2026-11-07 nightly's derive and compose jobs are all done, marker PRODUCTION alone and inside the last query, and passes every recompute (4/4 md5s, jobs idle and equal before and after, SHA pin)"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I check_capture.py --kind c1 --dir $RC/c1 --pre $RC/pre ... (exit 0) and --gate-only (ready=yes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No Railway deployment on either service between c0 and c1 changed analytics-service or supabase/migrations (none was created at all), and the migration ledger gained no row"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I deploy_proof.py --window-name c0..c1 (exit 0), gh run list supabase-migrate.yml, git log origin/main over supabase/migrations"
        status: pass
    human_judgment: false
  - id: D3
    description: "The ledger half of the pair proof rests on a measured pre-to-c1 comparison and an inferred c0-to-pre half (c0 recorded no ledger)"
    requirement: RESID-01
    verification: []
    human_judgment: true
    rationale: "The inferred half rests on two zero counts that cannot see every write path; whether that suffices is the verifier's and plan 07's call (## Limits)"
  - id: D4
    description: "The scopes and books that moved across a deploy-free nightly are named, predictions 1, 4 and 5 are scored without rows, and the row reads are reduced to one file per distinct moved series"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I compare_prefix.py --kind c1 ... and gen_sql.py rows/lint (14 files, 0 violations)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-07
status: complete
---

# Phase 202 Plan 06: c1 control capture Summary

**c1 (taken 02:56Z to 02:59Z, after the 2026-11-07 nightly) shows a valid pair: no deployment was created on either Railway service since c0 and the ledger gained no row, yet 14 of 54 key and strategy scopes and 6 of 7 books carry different prefix digests, so stored values do move across a deploy-free nightly.**

## Performance

- **Duration:** about 7 min (Tasks 2 and 3; Task 1 was the orchestrator's reads)
- **Started:** 2026-11-07T03:00Z (approx., resume), Task 1's reads ran 02:56:23Z to 02:59:51Z
- **Completed:** 2026-11-07T03:10Z (approx.)
- **Tasks:** 3 (Task 1 a human-action checkpoint satisfied by the orchestrator; Tasks 2 and 3 executed)
- **Files modified:** 1 tracked (this SUMMARY); scratch under `~/.cache/quantalyze/residchurn`

## Result lines

marker-202: capture=c1 alone=PRODUCTION last_query=PRODUCTION taken=2026-11-07T02:59:51Z
gc-c-check: capture=c1 marker=PRODUCTION checks=4/4 counts=ok n_files=1/1 jobs=idle sql_sha=ok
gc-c-deploy: window=c0..c1 service=api deployments=0 code_diff=empty nonempty=none
gc-c-deploy: window=c0..c1 service=worker deployments=0 code_diff=empty nonempty=none
gc-c-ledger: capture=c1 n=316 max_version=20261106120000 h12=4f5527990733 equal_to_pre=yes
gc-c-migrate-runs: window=c0..c1 runs=0 conclusions=none
gc-c-migration-merges: window=c0..c1 commits=0 shas=none
gc-c-pair: verdict=valid api_code_diff=empty worker_code_diff=empty ledger=unchanged migrate_runs=0 migration_commits=0 ledger_c0_to_pre=inferred anchor_stable=yes criterion=D-04-amended-2026-11-06
gc-c-prefix: capture=c1 basis=c0 scopes=54 equal=40 moved=14 moved_scopes=k15,k18,k19,k24,k27,k32,s1,s13,s14,s15,s16,s2,s5,s8
gc-c-prefix-moved: capture=c1 scope=k15 latest_job=2026-11-07T00:40:00Z..2026-11-07T01:23:36Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=k18 latest_job=2026-11-07T00:40:00Z..2026-11-07T00:50:45Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=k19 latest_job=2026-11-07T00:40:00Z..2026-11-07T00:49:16Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=k24 latest_job=2026-11-07T00:40:00Z..2026-11-07T01:36:05Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=k27 latest_job=2026-11-07T00:40:00Z..2026-11-07T01:31:50Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=k32 latest_job=2026-11-07T00:40:00Z..2026-11-07T00:48:50Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=s1 latest_job=2026-11-07T00:10:15Z..2026-11-07T00:23:06Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=s13 latest_job=2026-11-07T01:25:00Z..2026-11-07T01:37:14Z status=done subject_via=self why=moved fields=h,n,last
gc-c-prefix-moved: capture=c1 scope=s14 latest_job=2026-11-07T00:10:22Z..2026-11-07T00:22:11Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=s15 latest_job=2026-11-07T00:10:17Z..2026-11-07T00:23:33Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=s16 latest_job=2026-11-07T00:10:12Z..2026-11-07T00:22:38Z status=done subject_via=self why=moved fields=h
gc-c-prefix-moved: capture=c1 scope=s2 latest_job=2026-11-07T00:25:00Z..2026-11-07T00:25:31Z status=done subject_via=self why=moved fields=h,n,last
gc-c-prefix-moved: capture=c1 scope=s5 latest_job=2026-11-07T00:25:00Z..2026-11-07T00:25:17Z status=done subject_via=self why=moved fields=h,n,last
gc-c-prefix-moved: capture=c1 scope=s8 latest_job=2026-11-07T01:25:00Z..2026-11-07T01:37:02Z status=done subject_via=self why=moved fields=h,n,last
gc-c-prefix-books: capture=c1 basis=pre books=7 equal=1 moved=6 moved_books=b1,b2,b3,b4,b5,b6
gc-c-prefix-book-keys: book=b1 moved_member_keys=k32
gc-c-prefix-book-keys: book=b2 moved_member_keys=k24
gc-c-prefix-book-keys: book=b3 moved_member_keys=k15
gc-c-prefix-book-keys: book=b4 moved_member_keys=k27
gc-c-prefix-book-keys: book=b5 moved_member_keys=k19
gc-c-prefix-book-keys: book=b6 moved_member_keys=k18
gc-c-pred: n=1 held=no moved_outside_set=s13,s2,s5,s8
gc-c-pred: n=4 held=yes moved=none
gc-c-pred-corrected: n=4 held=not_tested reason=no_job_between_c0_and_c1 scopes=s6,s9,s10 latest_derives=2026-11-06T00:25Z,2026-11-06T00:25Z,2026-11-06T01:25Z c0=2026-11-06T15:02Z
gc-c-pred: n=5 held=yes b3=false:out_of_window_flow,window_truncated b2=true b5=true b7=true
gc-c-reads: representatives=k15,k18,k19,k24,k27,k32,s1,s2,s5,s8,s13,s14,s15,s16 files=14 groups=14 moved_scopes_covered=14/14 k15_moved=yes

## Accomplishments

- **Task 1 verified before use, and the capture window measured against the plan's own rule.** All 19 json files, `c1-api.json`, `c1-worker.json` and `c1-taken.txt` exist and are non-empty. `SHA256SUMS.d` reads OK on all seven originals and `gen_sql.py lint` shows 0 violations (`sha256_d=7/7`) after the reads. The marker was read alone first (`marker-taken.txt` says 02:56:23Z; the orchestrator's account said 02:56:12Z; the saved file is what is recorded) and again inside `n_final.sql` (02:59:51Z, busy 0, last done 2026-11-07T01:37:14Z). The plan's window: start no earlier than 01:40Z (met, 02:56Z), the coverage gate `ready=yes busy=0 uncovered=none` (met), and no read within ten minutes before a :25 tick. The capture lasted 3m28s and ended 25m09s before the 03:25Z tick, and the 02:25Z tick fell 31 minutes before it began. Jobs before and after are the same 47 rows (chk 7beaec2a42a0 both). The orchestrator's start time was inside the window; it is measured here, not taken on trust.
- **c1 checked (D-02).** `check_capture.py --kind c1` exits 0: four `d_checks.sql` md5s match, counts are ok, jobs are idle and equal, SHA pin ok. Its `n_files=1/1` covers only `final.json`; the five bound new files (`keys_prefix`, `strats_prefix`, `books_prefix`, `anchor`, `b3_window`) pass `rc.read_n` and the `ledger` and `b3_ki` chk recomputes match PROD's.
- **The pair is valid by the founder's content rule (D-04 amended 2026-11-06).** The Railway lists (10 deployments each, read 03:00Z, reaching back to 2026-11-04) give the same `c0_live` as plan 04's anchor on both services, commit `ba3c9012858e` created 2026-11-06T14:15:57Z. No deployment was created after it on either service up to 02:59:51Z, so `git diff --stat` has nothing to judge and `code_diff=empty` on both. `origin/main` holds no commit at all since c0 (head still `ba3c90128`), `supabase-migrate.yml` has no run created since c0 (the 100-run list reaches back to June), and the c1 ledger triple (n=316, max version 20261106120000, hash prefix 4f5527990733) equals the pre triple.
- **Values moved across a nightly with no deploy and no ledger change.** 14 of the 54 key and strategy scopes carry a different prefix digest (days to 2026-11-05) from c0: six keys (k15, k18, k19, k24, k27, k32) and eight strategies (s1, s2, s5, s8, s13, s14, s15, s16). 6 of 7 books moved, each by exactly one moved member key, and b7 (no moved member) is equal. Attribution is plan 07's; nothing here claims a cause.
- **Predictions scored before any row was read.** P1 failed: s13, s2, s5, s8 moved outside the pre-registered set. P4 held: s6, s9 and s10 did not move (corrected in review round 2: P4 is not tested (corrected in review round 2): s6, s9 and s10 were not re-derived between c0 and c1 (latest derives 2026-11-06 00:25Z, 00:25Z and 01:25Z, all before c0), so "did not move" means no job wrote them; the `gc-c-pred: n=4 held=yes` line above is kept as lineage, `gc-c-pred-corrected` is the reading). P5 held: b3 still reads trust false with `out_of_window_flow,window_truncated`; b2, b5 and b7 are trustworthy. P1 is recorded as measured and changes the attribution; it is not re-scored.
- **Row reads ready.** Every moved scope is its own series (14 groups of one), so there is one self-checking read file per scope: 14 `r_rows_<label>.sql`, k15 among them, all lint-clean.

## What the four P1 misses look like (measured, not explained)

s2, s5, s8 and s13 are strategies, and unlike the other ten they moved in `n` and `last` as well as `h`. At c0 each ended on 2026-11-02; at c1 each ends on 2026-11-05 on the prefix. s5, s8 and s13 gained three days (227 to 230), s2 went from 382 to 356 rows (26 fewer, last day later). The latest derive on each is an hourly :25 job (00:25Z for s2 and s5, 01:25Z for s8 and s13), not the 00:10Z or 00:40Z nightly waves. Whole-table strategy rows went from 3282 to 3273 between c0 and c1. The s2 row count falling is a fact for plan 07 to attribute; this plan does not say why. No code path is named.

## Task Commits

1. **Task 1: orchestrator reads (checkpoint, human-action)** - no commit; resumed with "c1 saved" (marker read 02:56Z, final query 02:59:51Z)
2. **Task 2: c1 checked, deploy history by content, ledger, pair verdict** - `fea68b590` (test)
3. **Task 3: moved scopes and books, predictions 1, 4 and 5, row-read files** - `96027fbe9` (test)

**Plan metadata:** the docs commit that carries this final SUMMARY follows (not counted in `commits:` above, which was measured before it).

## Files Created/Modified

Tracked: this SUMMARY only. Untracked scratch under `~/.cache/quantalyze/residchurn`: `c1/MANIFEST.md`, `c1/moved.json`, `c1/groups.json`, `deploy/proof-c0-c1.out` and `.exit` (reads 0), `sql/r_rows_<label>.sql` x14. Under the session scratchpad (not `$RC/bin`): `plan-06/groups.py` (writes `moved.json` and `groups.json` from the `gc-c-prefix` line), `verify_c1_files.py`, `detail.py`. No script under `$RC/bin` was edited.

## Decisions Made

- **groups.json shape.** `final_attribution.py` requires a list of lists of label strings, and `assemble_c1.py` (plan 07) will take each group's representative from it. So each group is a list with its representative first (a key before a strategy, then the lowest number). All 14 groups hold one label.
- **Whole-scope reads, one per series, as the plan chose.** With every moved scope its own series there is nothing to share, so the choice costs 14 reads (k15 is among them already, so no extra file).
- **Window end for the deploy proof.** `--until` is the final query's time (02:59:51Z) as the plan says; the Railway lists were read at 03:00Z, nine seconds after it, so they cover the whole window.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, narrowed] `check_capture.py` does not see most of the c1 files**
- **Found during:** Task 2
- **Issue:** the files are saved under the plan's names (`keys_prefix.json`, `books_prefix.json`, `ledger.json`, ...) and the script tallies only `n_*.json` plus `final.json`, so `n_files=1/1` covers only `final.json`. This is the same narrowing plan 04 recorded.
- **Fix:** no script change. `rc.read_n` on `keys_prefix`, `strats_prefix`, `books_prefix`, `anchor` and `b3_window` (all pass), and the `chk` of `ledger.json` (`md5(n|max_version|h)`) and `b3_ki.json` (`md5(payload_text)`) recomputed in code (both match). `compare_prefix.py` reads the three prefix files through `rc.read_n` again at Task 3.
- **Files modified:** none (the check lives in a scratchpad script, `plan-06/verify_c1_files.py`)

**2. [Process] No TDD cycle**
- The plan's tasks are reads and comparisons through scripts written and self-tested in plans 01 and 04, so there was no new production code. All four scripts' `--self-test` were re-run at the end and pass (listed in the Self-Check).

---

**Total deviations:** 1 narrowed blocker (Rule 3), 1 process note.
**Impact on plan:** none on the verdict; the extra verification covers what the script skips.

## Issues Encountered

- **A transcription slip in plan 04's SUMMARY.** Its `gc-c-ledger: capture=pre ... h12=4f5527990730` (and the same value in the c0 MANIFEST's deploy-anchor section) does not match the saved `pre/ledger.json`, whose hash begins `4f552799073301bf`, so the true 12-character prefix is `4f5527990733`. The saved pre and c1 ledger files are byte-identical in the row, so `equal_to_pre=yes` is unaffected; the c1 line above uses the real value. I did not edit plan 04's committed SUMMARY or the scratch MANIFEST; a correction is for the orchestrator.
- **Lists are limited to 10 deployments.** Both Railway lists reach back to 2026-11-04, past c0 (2026-11-06T15:02:09Z), so they cover the window; they are not the 50-deep lists plan 04 read.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema surface; only saved results and lists were read, no PROD or Railway call was made by this executor.

## Limits (for plan 07's `## Limits`)

- **Ledger, c0 to pre, is inferred.** c0 recorded no ledger and the ledger has no applied-at column. The inference rests on zero `supabase-migrate.yml` runs and zero migration commits on `origin/main` between c0 and c1 (the whole window, repeated here). It does not exclude a row written by another path, such as a developer CLI push from a PROD-linked checkout. From the pre read to c1 the ledger is measured, and unchanged. The pair line says `ledger_c0_to_pre=inferred` in those words.
- **The deploy proof is only as deep as the lists.** Zero deployments were created after c0's live deployment on either service; a deployment created and removed between the list read (03:00Z) and its listing cannot be ruled out except by the list showing it, and none does.
- **Prefix equality is a statement about days up to 2026-11-05.** It says nothing about 2026-11-06, the day the nightly appended.
- **The pre-registered predictions are scored on digests and book lines only.** Predictions 2 and 3 need rows and are plan 07's.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 07 can run: `gc-c-pair: verdict=valid` and `gc-c-reads:` are in this SUMMARY, `$RC/c1/moved.json` lists 14 labels and `$RC/sql/r_rows_<label>.sql` exists for each (k15 included). The orchestrator reads those 14 files (marker alone first, `n_final.sql` last) into `$RC/rows/`.
- `$RC/c1/groups.json` is 14 singleton groups, representative first.
- The D-05 hold on merges touching `analytics-service/` or `supabase/migrations/**` can lift now that c1 is taken and the pair is valid (D-05 held it until c1). No D-06 retake is needed.

## Self-Check: PASSED

- Scratch files exist and are non-empty: `c1/MANIFEST.md`, `c1/moved.json` (14 labels, k15 among them), `c1/groups.json`, `deploy/proof-c0-c1.out`, `sql/r_rows_k15.sql`; 14 `r_rows_*.sql` equal the length of `moved.json`.
- Commits `fea68b590` and `96027fbe9` are ancestors of HEAD.
- Task 2 and Task 3 verify commands exit 0; exactly one `gc-c-pair:` line; the uuid and home-path gate prints nothing on this file.
- Self-tests re-run at the end: `check_capture.py --self-test` (11 checks OK, red-as-expected), `compare_prefix.py --self-test` (10 checks OK), `deploy_proof.py --self-test` (11 checks OK), `gen_sql.py --self-test` (lint red on write variants, rows lint clean).

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-07*
