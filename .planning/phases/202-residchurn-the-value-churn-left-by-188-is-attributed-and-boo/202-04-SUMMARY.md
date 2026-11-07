---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 04
subsystem: infra
tags: [prod-read-only, capture, prefix-digest, railway-deploy-proof, migration-ledger]

requires:
  - phase: 202-residchurn
    provides: plan 01 capture kit (check_capture.py, gen_sql.py, rc.py, the ten n_*.sql files, the SHA pin)
provides:
  - the pre-nightly capture $RC/pre, checked against PROD-side md5s
  - c0 prefix-stability proof (54/54 scopes) and the books' c0 basis (7/7, recipe validated against b1)
  - the c0 deploy anchor on both Railway services and the empty c0..pre deploy window, by content
  - the pre ledger triple and the ledger basis sentence (measured from pre, inferred from c0 to pre)
  - compare_prefix.py and deploy_proof.py, reused unchanged by plans 05 to 07
affects: [202-05, 202-06, 202-07, 202-08]

plan_head_before: 1dfbbf465ed59fed3a4250b194153c24869ad2cd
plan_head_after: 095c648b38c92795212936d4a09414a66d9bfdc7
actuals:
  tokens: 8000
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "chk-bound saved results, recomputed locally through rc.read_n before use"
    - "scratch scripts shown RED by neutering a branch and restoring from a byte backup"

key-files:
  created: []
  modified:
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-04-SUMMARY.md

key-decisions:
  - "The books' prefix recipe renders float8 with 15 significant digits (measured 14/14 against 0/14 for the shortest round-trip form); rc.pgtext is left as it is for keys and strategies."
  - "The Railway window is bounded by the list read time (23:24Z), not the PROD read; the 23 minute gap is covered by an origin/main commit check and named as a limit."

requirements-completed: [RESID-01]

coverage:
  - id: D1
    description: "The pre-nightly PROD set is captured idle before the 00:10Z wave and passes every recompute (marker, SHA pin, jobs check)"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I check_capture.py --kind pre --dir $RC/pre --sql-dir $RC/sql (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "c0 is stable up to the pre read: every key and strategy prefix digest equals c0's, and the 7 books have a validated c0 basis"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I compare_prefix.py --self-test (9 checks, RED on two neutered variants) and the real run"
        status: pass
    human_judgment: false
  - id: D3
    description: "No deployment on either Railway service between c0 and the pre list read changed analytics-service or supabase/migrations"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "python3 -I deploy_proof.py --self-test (11 checks, RED on three neutered variants) and the real run, exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The ledger half of D-04 is stated as measured from pre and inferred from c0 to pre, with the two signals and what they do not cover"
    requirement: RESID-01
    verification: []
    human_judgment: true
    rationale: "The inference rests on two signals that cannot see every write path; whether that is enough is the verifier's and plan 07's call (## Limits)"

duration: 35min
completed: 2026-11-06
status: complete
---

# Phase 202 Plan 04: Pre-nightly capture checked, book basis and deploy anchor Summary

**The pre-nightly PROD capture (taken 23:45Z to 23:47Z, before the 00:10Z wave) shows all 54 key and strategy prefix digests equal to c0, the 7 books on a validated c0 basis, and both Railway services still on commit ba3c9012858e with no deployment since c0.**

## Performance

- **Duration:** about 35 min (the resumed segment; Task 1 was the orchestrator's reads)
- **Started:** 2026-11-06T23:20Z (approx., Task 1 prep), resumed 2026-11-06T23:49Z
- **Completed:** 2026-11-06T23:56Z
- **Tasks:** 3 (Task 1 a human-action checkpoint satisfied by the orchestrator; Tasks 2 and 3 executed)
- **Files modified:** 1 tracked (this SUMMARY); scratch under `~/.cache/quantalyze/residchurn`

## Result lines

marker-202: capture=pre alone=PRODUCTION last_query=PRODUCTION taken=2026-11-06T23:47:06Z
gc-c-pre-window: missed=no late=no final_taken=2026-11-06T23:47:06Z before_nightly=yes idle=yes wave_touched=none wave_keys_books=none
gc-c-check: capture=pre marker=PRODUCTION checks=0/0 counts=absent n_files=1/1 jobs=idle sql_sha=ok
gc-c-prefix: capture=pre basis=c0 scopes=54 equal=54 moved=0 moved_scopes=none
gc-c-prefix-books: capture=pre basis=b1-recipe books=7 equal=7 moved=0 moved_books=none
gc-c-pre-books: computed_at_equal_to_c0=7/7 recipe_from_b1=7/7
gc-c-d10-subject: job=2026-11-06T11:25:40Z subject=s7 kind=strategy
gc-c-ledger: capture=pre n=316 max_version=20261106120000 h12=4f5527990733
gc-c-anchor: service=api c0_live=ba3c9012858e created=2026-11-06T14:15:57Z status=SUCCESS list_reaches=2026-10-30T13:20:40Z
gc-c-deploy: window=c0..pre service=api deployments=0 code_diff=empty nonempty=none
gc-c-anchor: service=worker c0_live=ba3c9012858e created=2026-11-06T14:15:57Z status=SUCCESS list_reaches=2026-11-01T14:47:09Z
gc-c-deploy: window=c0..pre service=worker deployments=0 code_diff=empty nonempty=none
gc-c-deploy-gap: lists_taken=2026-11-06T23:24Z pre_final_taken=2026-11-06T23:47:06Z gap_minutes=23 origin_main_commits_since_c0=0
gc-c-migrate-runs: window=c0..pre runs=0 conclusions=none
gc-c-migration-merges: window=c0..pre commits=0 shas=none
gc-c-ledger-basis: c0=not_recorded pre=measured c0_to_pre=inferred migrate_runs=0 migration_commits=0 inference=holds uncovered=other_write_paths

## Accomplishments

- **Pre capture checked (D-02).** `check_capture.py --kind pre` exits 0: the marker reads PRODUCTION alone and inside the last query, the SHA pin on the seven originals holds, and the per-subject jobs file (47 rows) matches its PROD-side `chk`. `final.json` shows `busy` 0 at 23:47:06Z.
- **c0 is stable to the pre read.** All 54 key and strategy scopes carry the same prefix digest, row count, first day and last day as c0. Nothing moved without a nightly, so `gc-c-prefix-moved` has no lines and no scope needs a job named for it.
- **The books' c0 basis is settled.** The pre books' `computed_at` equals c0's on 7/7 (read from the chk-bound `books_prefix.json` lines), and the prefix hashes recomputed locally from b1's arrays equal the pre prefix hashes on 7/7. The pre lines also carry each book's trust and reasons for plans 06 and 07: b3 reads trust false with `out_of_window_flow` and `window_truncated`, the same as b1.
- **D-10 named.** The 2026-11-06T11:25:40Z non-nightly derive belongs to a strategy scope, s7 (research assumption A2 held). It is still that subject's latest `derive_broker_dailies` job, status done, created 11:25:00Z.
- **Deploy anchor (D-04 amended 2026-11-06).** The latest deployment at or before c0 that ran is commit `ba3c9012858e`, created 2026-11-06T14:15:57Z, on both the API and the worker, so there is no skipped deploy. Both lists reach back past 2026-11-02 (API to 2026-10-30, worker to 2026-11-01), so plan 05 has its history too. No deployment on either service was created after it, up to the list read.
- **Ledger.** The pre triple is n=316, max version 20261106120000, h12 4f5527990733, measured. From c0 to pre it is inferred (see Limits).
- **Kit for the later plans.** `compare_prefix.py` and `deploy_proof.py` exist with self-tests, and both were shown RED on neutered variants (restored from a byte backup each time). The c0 MANIFEST has its `## Deploy anchor` section.

## Task Commits

1. **Task 1: orchestrator reads (checkpoint, human-action)** - no commit; resumed with "pre saved" (marker read 23:45:18Z, final query 23:47:06Z, not late)
2. **Task 2: pre capture checked, c0 controls, book basis, D-10** - `804818dfe` (test)
3. **Task 3: deploy anchor and the c0..pre window** - `095c648b3` (feat)

**Plan metadata:** the docs commit that carries this final SUMMARY follows (not counted in `commits:` above, which was measured before it). `commits: 2` is measured with `--grep='(202-04)'` over the range, because plan 02's executor committed on the same branch at the same time and a plain range count would include its commits.

## Files Created/Modified

Tracked: this SUMMARY only. Untracked scratch under `~/.cache/quantalyze/residchurn`: `bin/compare_prefix.py`, `bin/deploy_proof.py`, `deploy/proof-c0-pre.out` and `.exit` (exit 0), the `c0/MANIFEST.md` deploy-anchor section.

## Decisions Made

- **Float8 rendering for the books' prefix recipe is 15 significant digits.** See deviation 1.
- **The Railway window ends at the list read time.** `--until` is the 23:24Z time in `pre-taken.txt`, the last moment the lists speak for, rather than the later PROD read.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's book recipe (`rc.pgtext`) does not reproduce PROD's float8 text**
- **Found during:** Task 2 (first real run of `compare_prefix.py`)
- **Issue:** The plan says to recompute each book's prefix hashes "with `rc.pgtext`", which prints the shortest round-trip form. The first run gave `gc-c-prefix-books ... equal=0 moved=7` although the row counts matched on all 7 and `computed_at` matched c0 on all 7. The hash of every book's returns and curve differed.
- **Root cause (measured, not guessed):** the SQL session that produced the pre read prints `float8::text` with 15 significant digits (`-1.1780921831556902e-05` becomes `-1.17809218315569e-05`). Replaying b1's arrays with C `%.15g` matched 14 of 14 digests (7 books, returns and curve); with 16 or 17 digits it matched 0 of 14. The data had not changed: the book payloads hold 16 and 17 digit values written by the analytics service.
- **Fix:** `pgfloat8_text` in `compare_prefix.py`, used only for the books recipe, plus a self-test assertion on four formatting cases. `rc.pgtext` is untouched: the key and strategy digests it serves were validated by plan 01, so this plan did not change them.
- **Impact for later plans:** plan 06 compares c1's prefix lines with these through the same script, so the rendering is consistent. Anyone writing a new local replay of a `jsonb ... ::float8::text` cast must use the 15 digit form, and should not assume `rc.pgtext` is right for it.
- **Files modified:** `~/.cache/quantalyze/residchurn/bin/compare_prefix.py` (untracked scratch)
- **Verification:** `compare_prefix.py --self-test` OK (10 checks), real run `equal=7 moved=0`
- **Committed in:** `804818dfe` (the SUMMARY lines it produced; the script is untracked)

**2. [Rule 3 - Blocking, narrowed] `check_capture.py` does not see most of the pre files**
- **Found during:** Task 2
- **Issue:** the orchestrator saved the pre results under the plan's names (`keys_prefix.json`, `strats_prefix.json`, `books_prefix.json`, `strat_keys.json`, `ledger.json`), and `check_capture.py` tallies only `n_*.json` files plus `final.json`, so `n_files=1/1` covers only `final.json`.
- **Fix:** no script change. `compare_prefix.py` reads the three prefix files through `rc.read_n` (FATAL on a `chk` mismatch), and I ran `rc.read_n` on `strat_keys.json` and recomputed the ledger `chk` in code (nothing hand-computed): all matched PROD's `chk`. The recorded `gc-c-check` line is the script's real output.
- **Files modified:** none

**3. [Process] TDD order and commits**
- The two scripts are untracked scratch, so the RED/GREEN commit pair the TDD reference describes cannot exist in git. I wrote each script and its `--self-test` together, then proved the test can fail: neutering one branch (the per-scope `h` comparison, the book digest comparison, the git diff, the commit requirement, the reach check), seeing RED on exactly the named checks, and restoring from a byte backup (`cmp` equal). Tracked commits are one per task that changes tracked files.
- A first run of Task 2's commit carried the attribution trailers that the session reminder asked for. The founder's standing memory rule forbids them, so I amended the (unpushed, still-HEAD) commit to remove them before anything else touched it.

### Not done on purpose (orchestrator instruction)

STATE.md, ROADMAP.md, `state.json` and the gsd-tools state and roadmap handlers were not touched: plan 02's executor commits on the same worktree, and the orchestrator updates them after both plans finish.

---

**Total deviations:** 1 auto-fixed bug (Rule 1), 1 narrowed blocker (Rule 3), 1 process note.
**Impact on plan:** deviation 1 was necessary for correctness: without it the book basis would have read 0/7 and wrongly sent the plan to the D-06 stop. No scope creep.

## Issues Encountered

- Railway lists were read at 23:24Z and the PROD read ran 23:45Z to 23:47Z. A deployment created in those 23 minutes would be missing from the lists. The compensating check is `git log origin/main` after the list read, which shows no commit since c0 at all (main's head is still `ba3c90128`), and a redeploy of the same commit would not change any content. This is recorded as a limit, not closed.

## Known Stubs

None. The `$RC/pre/marker-taken.txt` extra file the orchestrator saved was ignored by every check and not deleted.

## Threat Flags

None. No new network endpoint, auth path or schema surface; the plan only reads saved results and lists.

## Limits (for plan 07's `## Limits`)

- **Ledger, c0 to pre, is inferred.** c0 recorded no ledger and the ledger has no applied-at column. The inference rests on zero `supabase-migrate.yml` runs and zero migration commits on `origin/main` between c0 and the pre read. It does not exclude a row written by another path, such as a developer CLI push from a PROD-linked checkout. From the pre read on, the ledger is measured.
- **Deploy window ends at the list read (23:24Z).** The 23 minutes to the PROD read are covered only by the absence of any `origin/main` commit since c0.
- **`wave_touched=none` and `wave_keys_books=none` are trivially true.** The read finished at 23:47:06Z, before the 00:10Z wave could create a job. They would have carried information only on a late read.
- **Prefix equality is a statement about days up to 2026-11-05.** It says nothing about the day after.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05 can use `$RC/deploy/pre-api.json` and `pre-worker.json` (both reach back past 2026-11-02) and `deploy_proof.py`.
- Plan 06 compares c1 with c0 through `compare_prefix.py --kind c1 --books-ref $RC/pre`. c1 must be taken after the 2026-11-07 nightly; the pre read is idle and complete, so no D-06 retake is needed from this plan.
- The pair is not void on anything measured here.

## Self-Check: PASSED

- Scratch files exist: `compare_prefix.py`, `deploy_proof.py`, `deploy/proof-c0-pre.out` (non-empty) and `.exit` (reads 0), the `## Deploy anchor` section in `c0/MANIFEST.md`.
- Commits `804818dfe` and `095c648b3` are ancestors of HEAD.
- Task 2 verify and Task 3 verify commands both exit 0; the uuid and home-path gate prints nothing on this file; `pre/books.json` does not exist.

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-06*
