---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 03
subsystem: testing
tags: [sql-gate, mutation-runner, census, schema-snapshot, ratchet, todos]

requires:
  - phase: 219-01
    provides: test_profiles_email_sync.sql (ten twinned arms), migration 20261119120000_sync_profile_email_from_auth.sql, public.sync_profile_email_from_auth()
provides:
  - FILES_FLOOR and ARMS_FLOOR raised to the measured values, so deleting the email-sync gate or one of its arms fails sql-mutation (D-08)
  - every pinned mutation census (annotation parser, runner floors, gate-family registry, sql-gate-lint file count) moved with a dated note
  - generated snapshot supabase/schema/functions/sync_profile_email_from_auth.sql
  - dated snapshot-only NAME_SET_RATCHET row and COMPARED_FLOOR raised by one
  - TODOS.md entry [219-EXTRACTOR-UPDATE-OF] (MEDIUM, owner and trigger)
affects: [ship step, the post-apply baseline re-dump, 219 CI sql-mutation FULL run]

actuals:
  tokens: 47500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Census numbers moved by measurement: each pin carries a dated CURRENCY note quoting the command output that measured it"
    - "A new forward-migration function enters the schema snapshot as a dated snapshot-only ratchet row plus a COMPARED_FLOOR raise, never an allowlist row"

key-files:
  created:
    - supabase/schema/functions/sync_profile_email_from_auth.sql
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - TODOS.md

key-decisions:
  - "No ci.yml sentinel census moved: the gate declares no ALL N ARMS EXECUTED sentinel, so ci.yml and drift-check-scripts.test.ts stay byte-unchanged"
  - "The baseline-content-drift finding (SNAPSHOT_MISSING sync_profile_email_from_auth/0) is left standing, not allowlisted: it clears only by the post-apply re-dump (D-10)"
  - "The extractor's UPDATE OF refusal is booked, not built: the fix touches the lane fidelity gate every boot runs"

requirements-completed: [D-06, D-08, D-10]

coverage:
  - id: C1
    description: "The mutation runner counts test_profiles_email_sync.sql as annotated and its ten arms, and FILES_FLOOR / ARMS_FLOOR equal the measured values"
    requirement: "D-08"
    verification:
      - kind: other
        ref: "node scripts/mutation-runner/run.mjs --parse-only (coverage: files 84/111, arms: 0/901/0, No static defects)"
        status: pass
      - kind: other
        ref: "vitest mutation-runner-floors.test.ts FILES_FLOOR / ARMS_FLOOR ratchets (pass)"
        status: pass
    human_judgment: false
  - id: C2
    description: "Every pinned census assertion that the new gate moves is updated and every named census, snapshot and drift test passes"
    requirement: "D-08"
    verification:
      - kind: other
        ref: "vitest run of the ten named files: Test Files 10 passed (10), Tests 1501 passed (1501)"
        status: pass
    human_judgment: false
  - id: C3
    description: "The function snapshot, its snapshot-only ratchet row and COMPARED_FLOOR record the new function without suppressing the finding"
    requirement: "D-06"
    verification:
      - kind: other
        ref: "npm run schema:functions:check (SQL function snapshot is current, 135 functions) and the drift script lines quoted below"
        status: pass
    human_judgment: false
  - id: C4
    description: "The extractor's refusal of UPDATE OF triggers has an owner and a trigger in TODOS.md"
    requirement: "D-06"
    verification:
      - kind: other
        ref: "grep -c '219-EXTRACTOR-UPDATE-OF' TODOS.md prints 1; check-planning-hygiene.ts OK; 0 deleted TODOS lines"
        status: pass
    human_judgment: false
  - id: C5
    description: "CI sql-mutation FULL agrees with the static floors (a real biting count)"
    requirement: "D-08"
    verification: []
    human_judgment: true
    rationale: "The FULL local mutation run was not performed (disk). 901 is the static annotated-unwaived count, an upper bound on biting. CI sql-mutation FULL on the PR head SHA is the run that compares it with a real count; routed to the ship step."

plan_head_before: 266d34b9c1875060c443dcd8a5450d072a34b110
plan_head_after: f7b674b977d6bd9dc66b2be9ee882a368133b35a

duration: 18min
completed: 2026-11-19
status: complete
---

# Phase 219 Plan 03: census pins for the email-sync gate Summary

**The email-sync gate is now counted everywhere a floor or pin looks: FILES_FLOOR 83 -> 84, ARMS_FLOOR 891 -> 901, four vitest census files moved, the new function snapshotted and ratcheted as snapshot-only, COMPARED_FLOOR 136 -> 137, and the extractor's `UPDATE OF` refusal booked as a MEDIUM TODOS entry with an owner and a trigger.**

## Performance

- **Duration:** about 18 min
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files:** 8 modified, 1 created
- **PLAN_BASE:** `266d34b9c1875060c443dcd8a5450d072a34b110` (HEAD at the first edit; the ledger file `gsd-plan-head-before-219-03` holds it)

## Starting and ending values (read by symbol, never restated as prose rules)

Before (`grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-floors.mjs`):

```
1363:export const FILES_FLOOR = 83;
3480:export const ARMS_FLOOR = 891;
3594:export const WAIVED_CEILING = 0;
```

`node scripts/mutation-runner/run.mjs --parse-only` before the edits (HEAD already carried plan 01's gate): `coverage: files 84/111`, `arms: 0/901/0   (executed/annotated/waived)`, `test_profiles_email_sync.sql: 10 prose / 10 twin(s) / 0 waiver(s)`, `No static defects`.

After:

```
1369:export const FILES_FLOOR = 84;
3491:export const ARMS_FLOOR = 901;
3605:export const WAIVED_CEILING = 0;
```

`--parse-only` after: `coverage: files 84/111`, `arms: 0/901/0   (executed/annotated/waived)`, `pending: 0 idiom file(s) without RED-UNDER`, `unreachable: 27 file(s)` (unchanged, the new gate is not in the list), `No static defects`. FILES_FLOOR moved by exactly +1 and ARMS_FLOOR by exactly +10, the gate's biting arm count from plan 01's diagnostic run (`arms: 10/10/0`, `biting: 10`, every arm `RED (identity ok)`).

## What moved, with the measuring reading

| File | Pin | Before | After | Measured by |
|------|-----|--------|-------|-------------|
| scripts/mutation-floors.mjs | FILES_FLOOR | 83 | 84 | `--parse-only` `coverage: files 84/111` |
| scripts/mutation-floors.mjs | ARMS_FLOOR | 891 | 901 | `--parse-only` `arms: 0/901/0` |
| src/__tests__/mutation-annotation-parser.test.ts | armsSeen | 891 | 901 | pin read the new corpus; `--parse-only` |
| src/__tests__/mutation-annotation-parser.test.ts | stepsSeen, needles.length | 1008 | 1018 | +10 edit steps, one per twin; test passed at 1018 |
| src/__tests__/mutation-annotation-parser.test.ts | corpus.filesTotal (twice), filesAnnotated, annotatedFiles | 110, 110, 83, 83 | 111, 111, 84, 84 | `coverage: files 84/111` |
| src/__tests__/mutation-annotation-parser.test.ts | by-name annotated list | no entry | `test_profiles_email_sync.sql` in sorted position | first run RED on the sort order, fixed, green |
| src/__tests__/mutation-runner-floors.test.ts | totalAnchored; the GREEN_LOG and SUBSET_LOG fixtures (scope, coverage, arms, biting, lane-invocations, per-arm lane time, derived literals 890/892 -> 900/902, 83 -> 84 files) plus one per-file row | 891 / 83 / 110 | 901 / 84 / 111 | `--parse-only` |
| src/__tests__/gate-family-meta.test.ts | registry strings `FILES_FLOOR=`, `ARMS_FLOOR=` | 83, 891 | 84, 901 | same commit as the constants |
| src/__tests__/lint-sql-gates.test.ts | `scanned N file` | 110 | 111 | `node scripts/lint-sql-gates.mjs`: `scanned 111 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| scripts/dump-sql-functions.ts | NAME_SET_RATCHET | no row | dated `snapshot-only` row `sync_profile_email_from_auth` | `npm run schema:functions:check` |
| scripts/baseline-content-drift-check.mjs | COMPARED_FLOOR | 136 | 137 | drift script line below |

Every pinned number carries a dated CURRENCY or MOVED note beside it naming Phase 219 ACCOUNTEMAIL plan 03 and the reading that measured it. The sweep for stragglers (`grep -rnwE 'FILES_FLOOR=83|ARMS_FLOOR=891|files 83/110|arms: 891|0/891' src scripts .github`, comments excluded) found only the two registry strings, which are the new values. The per-file row added to the GREEN_LOG fixture is shaped like the diagnostic row and is a fixture line, not a captured one; its comment says so.

## Verification evidence

- Six-file census run (Task 1 verify): `Test Files 1 failed | 5 passed (6)`, the one failure being a self-inflicted sort-order slip in the by-name list; after the fix `mutation-annotation-parser.test.ts` printed `Tests 108 passed (108)`, and the other five were already green.
- Ten-file run (Task 2 verify, the six plus baseline-content-drift-allowlist, status-bridge-side-kinds-drift, local-stack-lane-wiring, prod-prober-wiring): `Test Files  10 passed (10)`, `Tests  1501 passed (1501)`.
- `node scripts/lint-sql-gates.mjs --self-test`: `lint-sql-gates self-test OK: 7 rules, red+green each.`
- `npm run schema:functions` wrote 135 snapshot files, the only new file being `sync_profile_email_from_auth.sql`. `npm run schema:functions:check`: `SQL function snapshot is current (135 functions).` and `DRIFT-05 gate (a): baseline 134 name(s) vs migration-replay 135 name(s) — agree, with 1 ratcheted disagreement(s) carried.`
- `node scripts/baseline-content-drift-check.mjs` (exits 1 by design while a finding stands):

```
baseline-content-drift: functions compared 137 — MATCH 133, DRIFT 3, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 1
::error file=supabase/schema/functions/sync_profile_email_from_auth.sql,line=0::content-drift — SNAPSHOT_MISSING sync_profile_email_from_auth/0 ...
```

  The three mechanical checks of the plan's verify chain hold: `functions compared 137 ` equals COMPARED_FLOOR, `SNAPSHOT_MISSING 1,` is present, and the line `baseline-content-drift: findings 1` is present. CI's baseline-content-drift step is therefore expected RED on the PR until the post-apply re-dump (the precedent's accepted state); no allowlist row was added.
- `node scripts/check-baseline-currency.mjs --replay-set`: `baseline-currency: carried=324 replay=1 marker-sha=match defects=0` and `baseline-replay: 1 migration(s) newer than the dump: 20261119120000_sync_profile_email_from_auth.sql`.
- `npm run typecheck`: no output, exit 0. `npm run lint`: exit 0, `0 errors, 4 warnings` (all four `no-unused-vars` in files this plan did not touch, pre-existing), admin-route manifest, route contract, planning hygiene and canonical-domain checks OK.
- `npx tsx scripts/check-planning-hygiene.ts`: OK. `git diff --numstat` on TODOS.md: `8 0` (8 added, 0 deleted).
- Acceptance: `git diff --name-only 266d34b9c -- .github/workflows/ci.yml src/__tests__/drift-check-scripts.test.ts supabase/schema/baseline.sql supabase/schema/baseline-carried-migrations.txt` printed nothing; `WAIVED_CEILING = 0;` still matches; `grep -c 'Phase 219' scripts/mutation-floors.mjs` is 2; `grep -c test_profiles_email_sync src/__tests__/mutation-annotation-parser.test.ts` is at least 1.

## Task Commits

1. **Task 1 (tracer): floors and every pinned mutation census** - `b108878f4` (test)
2. **Task 2: snapshot, NAME_SET_RATCHET row, COMPARED_FLOOR** - `a56b15a79` (chore)
3. **Task 3: `[219-EXTRACTOR-UPDATE-OF]` TODOS entry** - `f7b674b97` (docs)

## Tracer gate

The tracer slice was the new gate counted by the runner and the four vitest census files. The `<verify>` was re-run end to end after the first failure was fixed (`--parse-only` clean, lint self-test and corpus clean, the census files green), then the expansion tasks ran. No `blocking-human` gate on the tracer.

## Deviations from Plan

**1. [Rule 1 - Bug, in my own edit] by-name list entry inserted out of sorted order**
- **Found during:** Task 2 vitest run (the six-file run in the background)
- **Issue:** I inserted `test_profiles_email_sync.sql` right after the `mt5_server_clock_readings` entry, but `scanCorpus` returns names sorted, so `scanCorpus reports the measured annotated-of-total corpus ratio` failed (`test_profiles_email_sync.sql` expected before `test_okx_archive_rebuild.sql`, received after `test_prod_prober_cadence.sql`).
- **Fix:** moved the entry (and its ADDED comment) between `test_prod_prober_cadence.sql` and `test_profiles_privileged_columns_locked.sql`. The file then ran 108 of 108 green. Fixed before the Task 1 commit.
- **Files modified:** src/__tests__/mutation-annotation-parser.test.ts

**2. [Environmental] No FULL local mutation run**
- The host data volume is nearly full, so the FULL unnarrowed runner pass was not run (project rule). ARMS_FLOOR 901 is the static annotated-unwaived count, an upper bound on biting, with the arms measured by plan 01's diagnostic run. The MOVED notes say so. CI `sql-mutation` FULL on the PR head SHA is the authoritative comparison.

**3. [Plan premise] `--file` diagnostic row not re-run here**
- The GREEN_LOG per-file row for the new gate is shaped like the diagnostic row (`annotated 10 / biting 10`) and flagged in its comment as a fixture line. I did not re-run the lane mutation pass (disk); the structure the test relies on (a row that sums into the aggregate) is verified by the green run.

**Total deviations:** 1 self-fix, 2 notes. **Impact:** none on the shipped state.

## Issues Encountered

None beyond the above. The harness refused two compound `git` command lines; they were split into plain commands.

## Known Stubs

None.

## Threat Flags

None. The plan adds no network endpoint, auth path or schema; T-219-12 and T-219-13 are mitigated (floors raised to measured values and the stale-low ratchet green; WAIVED_CEILING 0, no allowlist row, the SNAPSHOT_MISSING finding left visible).

## Open items routed elsewhere

- **Ship step:** CI `sql-mutation` FULL green on the PR head SHA with the expected check count; `baseline-content-drift` is expected red until the post-apply re-dump; the migration timestamp rename touches `grep -rlna 20261119120000 supabase scripts src .planning/phases/219-*` and, if renamed, the NAME_SET_RATCHET `clearedBy`, the COMPARED_FLOOR note, the TODOS entry and the snapshot header.
- **Post-apply re-dump phase:** must fix `[219-EXTRACTOR-UPDATE-OF]` first, regenerate `baseline-carried-migrations.txt` in the same commit, and DELETE the `sync_profile_email_from_auth` NAME_SET_RATCHET row.
- **TODOS closure rule:** this plan closes no TODOS entry; it opens one.

## Self-Check: PASSED

- FOUND: supabase/schema/functions/sync_profile_email_from_auth.sql
- FOUND: b108878f4
- FOUND: a56b15a79
- FOUND: f7b674b97
- FOUND: `export const FILES_FLOOR = 84;` and `export const ARMS_FLOOR = 901;` in scripts/mutation-floors.mjs
- FOUND: `219-EXTRACTOR-UPDATE-OF` in TODOS.md
