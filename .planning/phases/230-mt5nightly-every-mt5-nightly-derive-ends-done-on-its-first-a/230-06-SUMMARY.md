---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 06
subsystem: ci-censuses / mutation floors, function censuses, database types
tags: [mutation-floors, name-set-ratchet, compared-floor, database-types, sentinel-floors, mt5d-02]
requires:
  - phase: 230-01
    provides: test_mt5_terminal_lease.sql (8 arms), three lease functions, the lease table, three function mirrors
provides:
  - "FILES_FLOOR 94 -> 95 and ARMS_FLOOR 1033 -> 1041, read off a full mutation-runner run, WAIVED_CEILING still 0"
  - "three dated snapshot-only NAME_SET_RATCHET rows (acquire, renew, release_mt5_terminal_lease); no allowlist row"
  - "COMPARED_FLOOR 144 -> 147"
  - "mt5_terminal_leases and the three RPC signatures in src/lib/database.types.ts"
  - "ci.yml sql-tests derivation table row plus SENTINEL_FLOOR 38 and ARMS_FLOOR 587"
affects: [230-07, 230-08]

plan_head_before: e38d55e8c5a9412e228d575e5fc5c8a2dd4815e6
plan_head_after: 94c52ff8ea575d660918125cf1fae7e5ccba306c

actuals:
  tokens: 21900
  tasks: 3
  commits: 3

key-files:
  modified:
    - scripts/mutation-floors.mjs
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - src/lib/database.types.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/drift-check-scripts.test.ts
    - .github/workflows/ci.yml

key-decisions:
  - "DEC-06-A The two ci.yml floor constants (SENTINEL_FLOOR, ARMS_FLOOR in the sql-tests step) moved: ci-anti-skip-gate.contract.test.ts re-derives both from the corpus, so a new sentinel-bearing file forces them. No job, step, command, condition or dependency moved."
  - "DEC-06-B The Task 1 full run was repeated on a clean tree after the first one ended with a dirty-checkout defect caused by this plan's own concurrent edits; the clean run is the verdict pasted below."

requirements-completed: [MT5D-02]
status: complete
---

# Phase 230 Plan 06: Census updates for the MT5 terminal lease Summary

**Every census plan 01 shifted now agrees with a measured value: a clean full mutation run (95 files, 1041 arms, tallies agreeing, no waiver), three snapshot-only ratchet rows, the compared floor, the lease types, and the sql-tests sentinel table.**

## Task Commits

1. Task 2, function and table censuses: `42b4ccb0e`
2. Task 1, mutation floors and three vitest pin files: `5953cfe9a`
3. Task 3, lint count, drift-check pins and the ci.yml table and floors: `94c52ff8e`

Task 2 was committed first because it needed no mutation-run measurement; the tracer's measurement fed Task 1's commit.

## Task 1 measurements (verbatim)

Step 0:

```
git fetch origin main                      (ok)
git merge-base --is-ancestor origin/main HEAD   -> exit 0
git rev-parse --short origin/main          -> 2636fb1e5
node scripts/verify-plan-anchors.mjs <230-06-PLAN.md>  -> OK: 1 plan file(s), no stale claims. (exit 0)
```

`node scripts/mutation-runner/run.mjs --parse-only` (exit 0):

```
coverage: files 95/122
arms: 0/1041/0   (executed/annotated/waived)
  supabase/tests/test_mt5_terminal_lease.sql: 8 prose / 8 twin(s) / 0 waiver(s)
✅ No static defects. Every prose marker has a twin and every needle still matches.
```

Full `node scripts/mutation-runner/run.mjs` on the committed tree, exit 0 (about 24 minutes):

```
scope: FULL 95/95 annotated files
lane-concurrency: 4   (gate files in flight at once: min(cap 4, availableParallelism 10) unless overridden; at most 4 for this run's 95 target file(s); lanes within a file run in order)
coverage: files 95/122
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; ...)
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 1041/1041/0   (executed/annotated/waived)
biting: 1041   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 1041   (arm lanes actually spawned — tallied inside runLane, independent of the 1041 the verdict loop counted; plus 95 baseline / 95 restore leg(s))
  file test_mt5_terminal_lease.sql: sections 8 / judged 8 / annotated 8 / waived 0 / biting 8
per-arm lane time: mean 4.8s over 1041 arm run(s)
✅ No defects. Every annotated arm bit its own arm first.
exit=0
```

The two independent arm tallies (`arms:` and `lane-invocations:`) agree at 1041, `biting` equals `annotated` for the new file, and WAIVED_CEILING is still 0 (`grep -a -nE '^export const WAIVED_CEILING = 0;'` prints line 3685). FILES_FLOOR is now 95 (line 1396) and ARMS_FLOOR 1041 (line 3571), each with a dated Phase 230 provenance comment.

The first full run (before the floors were committed) printed the same figures and then one defect, `dirty-checkout`, because this plan was editing census files in the working tree while the runner ran. It is not a corpus defect, and the run above, started on a clean tree, supersedes it.

Pins moved (each with its own dated CURRENCY note, values from a run or from the failing test's own `expected N to be M`): `armsSeen` 1041, `stepsSeen` and `needles.length` 1195 (+9 file steps), `filesTotal` 122 (two sites), annotated files 95 (two sites), by-name list gained `test_mt5_terminal_lease.sql`, `totalAnchored` 1041, the synthetic FULL log (arms, biting, lane-invocations with 95 baseline and restore legs, mean line, per-file row, scope lines), and the two `KNOWN_THRESHOLD_SITES` strings.

Census search for a sibling gate, `git grep -n "test_compute_job_claim_renewal" -- scripts src .github analytics-service`: hits outside Task 1's four files were `.github/workflows/ci.yml` (two comment tables, Task 3), `analytics-service/tests/test_main_worker.py:524` (docstring prose, no census) and `src/__tests__/drift-check-scripts.test.ts:5118` (a comment inside the pin Task 3 moved).

## Task 2 measurements (verbatim)

```
npx tsx scripts/dump-sql-functions.ts --check
  before the rows: snapshot-only: acquire_mt5_terminal_lease / release_mt5_terminal_lease / renew_mt5_terminal_lease (exit 1)
  after:  SQL function snapshot is current (145 functions).
          DRIFT-05 gate (a): baseline 142 name(s) vs migration-replay 145 name(s) — agree, with 3 ratcheted disagreement(s) carried.

node scripts/baseline-content-drift-check.mjs
baseline-content-drift: functions compared 147 — MATCH 140, DRIFT 4, SNAPSHOT_MISSING 3, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 4

npx tsx scripts/check-gdpr-export-coverage.ts
[check-gdpr-export-coverage] OK - manifest covers all 26 declared user-owned tables (manifest size 41).
```

COMPARED_FLOOR is 147 (the measured count; 144 + the three new functions), with a dated MOVED comment. The three SNAPSHOT_MISSING findings (`acquire`, `renew`, `release`) are recorded as expected until the post-apply re-dump and are NOT allowlisted. The fourth finding, `DRIFT commit_scenario_batch/5`, is not this phase's: it is Phase 225's re-base already on origin/main (this plan's migration does not touch that function), noted in the floor's comment. The drift script's exit is advisory here, as the plan says.

`src/lib/database.types.ts` carries `mt5_terminal_leases` (Row, Insert, Update with the six columns) and the three Args and Returns (boolean) with a dated note that a regen against PROD drops them until PROD applies migration 20261126120000. `npm run typecheck` exit 0. The GDPR export census passes with no new manifest row.

## Task 3 measurements (verbatim)

```
node scripts/lint-sql-gates.mjs            lint-sql-gates: scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
node scripts/lint-sql-gates.mjs --self-test  lint-sql-gates self-test OK: 7 rules, red+green each.
grep -a -o -m1 'ALL [0-9]* ARMS EXECUTED' supabase/tests/test_mt5_terminal_lease.sql   ALL 8 ARMS EXECUTED
```

ci.yml: the derivation table gained `test_mt5_terminal_lease.sql  8`; SENTINEL_FLOOR 37 -> 38 and ARMS_FLOOR 579 -> 587 (+ 8 appended to the sum comment), plus a dated provenance note. `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` needed no edit: it re-derives both from the corpus (it read `expected 38 to be 37` before the ci.yml edit). Diff gate: `git diff -U0 .github/workflows/ci.yml` saved, then `grep -a -c -e "^[+-] *run:" -e "^[+-] *uses:" -e "^[+-] *needs:" -e "^[+-] *if:" -e "^[+-] *- name:"` printed 0.

`npm test` full run: `Test Files 12 failed | 1254 passed | 20 skipped`, `Tests 17 failed | 27430 passed | 306 skipped`. The 12 failing files were re-run on their own: 10 passed (the failures were 5000 ms timeouts while the machine was loaded by a parallel executor), `return-stats.single-source.test.ts` passed on a second solo run, and two tests in `src/lib/factsheet/compute.conventions.test.ts` still fail. Those two are unrelated to this plan: an inline snapshot of `skew` differs in the last digit (`-0.11360716852722537` expected, `-0.11360716852722538` received), a floating-point platform difference in code this plan does not touch. Skipped tests (306) are the repo's own standing skips, none added here.

## PROOF-01 (neutered copy, RED with its named arm, restore byte-equal, GREEN)

Each neuter used `cp -p` to scratch, an edit, a run, `cp` back and `cmp -s`.

| Gate | Neuter | RED output (named arm) | After restore |
|---|---|---|---|
| FILES_FLOOR ratchet | `FILES_FLOOR = 94` | `RATCHET STALE: 95 of 122 gate files are now annotated but FILES_FLOOR is still 94.` | GREEN (262 passed across the three pin files) |
| ARMS_FLOOR ratchet | `ARMS_FLOOR = 1033` | `The corpus declares 1041 twin(s) of which 0 are waivers, so a green run bites 1041. ARMS_FLOOR is 1033.` | GREEN |
| COMPARED_FLOOR ratchet | `COMPARED_FLOOR = 144` | `the real corpus now compares 147 function(s) but COMPARED_FLOOR is pinned at 144.` | GREEN (18 passed) |
| NAME_SET_RATCHET | renamed the renew row to `renew_mt5_terminal_leaseX` | `ratchet-stale: renew_mt5_terminal_leaseX — recorded 'snapshot-only' on 2026-11-25, but it is now present on NEITHER side` plus `snapshot-only: renew_mt5_terminal_lease` | `SQL function snapshot is current (145 functions).` |
| ci.yml sentinel derivation | `ARMS_FLOOR=579` | `ARMS_FLOOR disagrees with the sum of its own derivation table: expected 579 to be 587` | GREEN (51 passed with the previous row) |

## Deviations from Plan

**1. [Rule 3 - Blocking] ci.yml moved two non-comment constants.** The plan's truth says ci.yml changes only in comment lines. The sql-tests step's `SENTINEL_FLOOR=37` and `ARMS_FLOOR=579` are shell assignments, and `ci-anti-skip-gate.contract.test.ts` asserts them equal to the corpus-derived table, so the new sentinel-bearing gate file forces `38` and `587` (the Phase 227 ship moved them the same way). No job, step, command, condition or dependency moved, and the plan's diff-gate grep prints 0. Commit `94c52ff8e`.

**2. [Rule 1 - Bug, own edit] A per-file row landed twice.** My scripted insert of the lease file's per-file row matched a comment that quotes the neighbouring file's row; I removed the stray copy before committing, caught by `npm run typecheck`.

**3. Full run repeated.** See DEC-06-B; the clean-tree run is the verdict.

No auth gates. No stubs introduced. No threat flags (no new endpoints, auth paths or schema).

## Open items

- The three ratchet rows and the TS note clear when a baseline re-dump is taken after migration 20261126120000 applies to PROD; the SNAPSHOT_MISSING findings go with it. If the migration is re-stamped at ship time, the `clearedBy` text and the TS comment name the old stamp (plan 08's rehearsal lists them).
- `DRIFT commit_scenario_batch/5` is the Phase 225 re-base, already present on origin/main; not touched here.
- `compute.conventions.test.ts` last-digit snapshot failures are pre-existing and unrelated.
- Docker was not used; the pg-lane runs on a local throwaway cluster, so there is nothing to stop.

## Self-Check: PASSED

- Files exist: all ten modified files present; `230-06-SUMMARY.md` written.
- Commits exist: `42b4ccb0e`, `5953cfe9a`, `94c52ff8e` are ancestors of HEAD.
- `git rev-list --count e38d55e8c..HEAD` printed 3 before this SUMMARY commit, matching `commits: 3`.
