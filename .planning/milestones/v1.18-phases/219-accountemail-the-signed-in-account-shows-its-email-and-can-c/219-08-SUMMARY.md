---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 08
subsystem: testing
tags: [sql-gate, mutation-runner, census, schema-snapshot, ratchet, gap-closure]

requires:
  - phase: 219-04
    provides: test_auth_user_has_password.sql (nine twinned arms), migration 20261120120000_auth_user_has_password.sql, public.auth_user_has_password(uuid)
  - phase: 219-03
    provides: the census precedent (what a new gate and a new function move)
provides:
  - FILES_FLOOR 84 -> 85 and ARMS_FLOOR 901 -> 910, read off --parse-only, so deleting the has-password gate or one arm fails sql-mutation (D-08)
  - every pinned mutation census moved with a dated note (annotation parser, runner floors, gate-family registry, sql-gate-lint scanned count)
  - generated snapshot supabase/schema/functions/auth_user_has_password.sql
  - dated snapshot-only NAME_SET_RATCHET row and COMPARED_FLOOR 137 -> 138
affects: [ship step, the post-apply baseline re-dump, 219 CI sql-mutation FULL run]

actuals:
  tokens: 40000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Census numbers moved by measurement: each pin carries a dated CURRENCY note quoting the command output that measured it"
    - "A new forward-migration function enters the schema snapshot as a dated snapshot-only ratchet row plus a COMPARED_FLOOR raise, never an allowlist row"

key-files:
  created:
    - supabase/schema/functions/auth_user_has_password.sql
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs

key-decisions:
  - "No ci.yml sentinel census moved: the gate declares no ALL N ARMS EXECUTED sentinel, so ci.yml and drift-check-scripts.test.ts stay byte-unchanged"
  - "The baseline-content-drift SNAPSHOT_MISSING finding for auth_user_has_password/1 is left standing, not allowlisted: it clears only by the post-apply re-dump (D-10)"

requirements-completed: [GD-05a]

coverage:
  - id: C1
    description: "The mutation runner counts test_auth_user_has_password.sql as annotated and its nine arms; FILES_FLOOR and ARMS_FLOOR equal the measured values"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "node scripts/mutation-runner/run.mjs --parse-only (coverage: files 85/112, arms: 0/910/0, No static defects)"
        status: pass
      - kind: other
        ref: "ARMS_FLOOR neuter to 909: mutation-runner-floors.test.ts went RED (2 failed incl. 'ARMS_FLOOR ratchet > equals the number of NON-WAIVED twins'); restore cmp exit 0, re-run 133 passed"
        status: pass
    human_judgment: false
  - id: C2
    description: "Every pinned census the new gate moves is updated and the named census tests pass"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "six-file set and ten-file set, each file green; load-induced timeouts re-run alone, see Verification evidence"
        status: pass
    human_judgment: false
  - id: C3
    description: "The function snapshot, its snapshot-only ratchet row and COMPARED_FLOOR record the new function without suppressing the finding"
    requirement: "GD-05a"
    verification:
      - kind: other
        ref: "npm run schema:functions:check (current, 136 functions; 2 ratcheted disagreements carried); one-byte neuter exits 1 naming the file, restore cmp exit 0"
        status: pass
    human_judgment: false
  - id: C4
    description: "CI sql-mutation FULL agrees with the static floors (a real biting count)"
    requirement: "D-08"
    verification: []
    human_judgment: true
    rationale: "No FULL local mutation run (disk, as in 219-03). 910 is the static annotated-unwaived count, an upper bound on biting. Plan 04's --file diagnostic measured the new gate at 9/9/0, biting 9. CI sql-mutation FULL on the PR head SHA is the authoritative comparison; routed to the ship step."

plan_head_before: 83ffa019204a85e4c1233f2fbdefb54f3094def1
plan_head_after: 65c56a8f8d7ded43a78653e7b0a04ca373b170d2

duration: 25min
completed: 2026-11-20
status: complete
---

# Phase 219 Plan 08: census pins for the has-password gate Summary

**The has-password gate is now counted everywhere a floor or pin looks: FILES_FLOOR 84 -> 85, ARMS_FLOOR 901 -> 910, four vitest census files moved, the new function snapshotted and ratcheted as snapshot-only, COMPARED_FLOOR 137 -> 138, with the SNAPSHOT_MISSING finding left standing.**

## Performance

- **Tasks:** 2 (1 tracer, 1 auto)
- **Files:** 7 modified, 1 created
- **PLAN_BASE:** `83ffa019204a85e4c1233f2fbdefb54f3094def1` (HEAD at the first edit; ledger file `gsd-plan-head-before-219-08` holds it). Three other commits on the branch in the range (`cff6fcd83`, `938aeb103`, `10105bed9`) are orchestrator docs landed while this ran; this plan made exactly two.

## Starting and ending values (read by symbol)

Before (`grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-floors.mjs`):

```
1369:export const FILES_FLOOR = 84;
3491:export const ARMS_FLOOR = 901;
3605:export const WAIVED_CEILING = 0;
```

`--parse-only` at HEAD (plan 04's gate already present): `coverage: files 85/112`, `arms: 0/910/0   (executed/annotated/waived)`, `pending: 0 idiom file(s) without RED-UNDER`, `unreachable: 27 file(s)` (unchanged, the new gate is not in the list), `test_auth_user_has_password.sql: 9 prose / 9 twin(s) / 0 waiver(s)`, `file test_auth_user_has_password.sql: sections 7 / judged 0 / annotated 9 / waived 0 / biting 0`, `No static defects`.

After:

```
1375:export const FILES_FLOOR = 85;
3502:export const ARMS_FLOOR = 910;
3616:export const WAIVED_CEILING = 0;
```

FILES_FLOOR moved by +1 and ARMS_FLOOR by +9, the arm count of plan 04's diagnostic run (`arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`).

## What moved, with the measuring reading

| File | Pin | Before | After | Measured by |
|------|-----|--------|-------|-------------|
| scripts/mutation-floors.mjs | FILES_FLOOR | 84 | 85 | `--parse-only` `coverage: files 85/112` |
| scripts/mutation-floors.mjs | ARMS_FLOOR | 901 | 910 | `--parse-only` `arms: 0/910/0` |
| mutation-annotation-parser.test.ts | armsSeen | 901 | 910 | `--parse-only` |
| mutation-annotation-parser.test.ts | stepsSeen, needles.length | 1018 | 1028 | this file's run read `expected 1028 to be 1018` (+10 edit steps: nine twins, arm 6's twin carries two edits) |
| mutation-annotation-parser.test.ts | filesTotal (twice), filesAnnotated, annotatedFiles | 111, 111, 84, 84 | 112, 112, 85, 85 | `coverage: files 85/112` |
| mutation-annotation-parser.test.ts | by-name annotated list | no entry | `test_auth_user_has_password.sql` after `test_api_keys_venue_identity_uniq.sql`, before `test_bridge_outcome_deltas_derived.sql` (sorted) | 108 passed |
| mutation-runner-floors.test.ts | totalAnchored; GREEN_LOG and SUBSET_LOG scope, coverage, arms, biting, lane-invocations, per-arm time lines; derived literals 900/902 -> 909/911; the "printed N per-file row(s) but reported M annotated" literals; plus one new per-file row | 901 / 84 / 111 | 910 / 85 / 112 | `--parse-only` |
| gate-family-meta.test.ts | registry keys `FILES_FLOOR=`, `ARMS_FLOOR=` | 84, 901 | 85, 910 | same commit as the constants |
| lint-sql-gates.test.ts | `scanned N file` | 111 | 112 | `node scripts/lint-sql-gates.mjs`: `scanned 112 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| scripts/dump-sql-functions.ts | NAME_SET_RATCHET | no row | dated `snapshot-only` row `auth_user_has_password` | `npm run schema:functions:check` |
| scripts/baseline-content-drift-check.mjs | COMPARED_FLOOR | 137 | 138 | `functions compared 138` |

The runner-floors test needed 30 literal lines moved; each carries a dated CURRENCY note above it naming Phase 219 gap closure plan 08. The sweep for stragglers (`grep -rnaE 'FILES_FLOOR ?= ?84|ARMS_FLOOR ?= ?901|FILES_FLOOR=84|ARMS_FLOOR=901|files 84/111|arms: 901|0/901|scanned 111' src scripts .github`, comment lines excluded) finds only the two new registry strings whose lineage text quotes the old values. The census sweep `grep -rlna 'test_profiles_email_sync' src scripts .github` named exactly five files (the four vitest files plus mutation-floors.mjs), all moved. No census outside the 219-03 set was found. The per-file row added to the GREEN_LOG fixture is a fixture line shaped like the diagnostic row, flagged in its comment.

## Verification evidence

- Six-file census run (Task 1 verify): first attempt `Test Files 1 failed | 5 passed (6)`, the one failure `lint-sql-gates.test.ts > MW02 green fixture executes to the SAME tolerance posture as the real ci.yml`, a subprocess test that passed alone (`Tests 2 passed` with `-t`) and in a full single-file run (`Tests 74 passed (74)`). It failed only under six-file parallel load; no code change.
- Ten-file run (Task 2 verify): `Test Files 2 failed | 8 passed (10)`, `Tests 2 failed | 1499 passed (1501)`. Both failures were `Error: Test timed out in 30000ms` (`mutation-annotation-parser.test.ts` R2-W04 REAL CORPUS, `mutation-runner-floors.test.ts` IN-05 parse-only), subprocess `--parse-only` tests starved by ten parallel files. Re-run together alone: `Test Files 2 passed (2)`, `Tests 241 passed (241)`. The other eight files were green in the ten-file run. So every one of the ten files passes, but not all ten in a single parallel invocation on this host (see Deviations).
- `node scripts/lint-sql-gates.mjs --self-test`: `lint-sql-gates self-test OK: 7 rules, red+green each.`
- ARMS_FLOOR neuter: backup `cp -p` to the scratchpad, edited `ARMS_FLOOR = 909`, `npx vitest run src/__tests__/mutation-runner-floors.test.ts` printed `Tests 2 failed | 131 passed (133)`, failing `ARMS_FLOOR ratchet > equals the number of NON-WAIVED twins — the biting count the run measured` and `164.3.1-10 ... GREEN: a FULL log passes on every event and ref — every existing arm, ARMS_FLOOR included (D-07)`. Restore `cp -p`, `cmp` exit 0, re-run `Tests 133 passed (133)`.
- `npm run schema:functions` wrote 136 snapshot files, the only new file `supabase/schema/functions/auth_user_has_password.sql`. `npm run schema:functions:check`: `SQL function snapshot is current (136 functions).` and `DRIFT-05 gate (a): baseline 134 name(s) vs migration-replay 136 name(s) — agree, with 2 ratcheted disagreement(s) carried.`
- `node scripts/baseline-content-drift-check.mjs` (exits 1 by design while findings stand):

```
::error file=supabase/schema/functions/auth_user_has_password.sql,line=0::content-drift — SNAPSHOT_MISSING auth_user_has_password/1 ...
::error file=supabase/schema/functions/sync_profile_email_from_auth.sql,line=0::content-drift — SNAPSHOT_MISSING sync_profile_email_from_auth/0 ...
baseline-content-drift: functions compared 138 — MATCH 133, DRIFT 3, SNAPSHOT_MISSING 2, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 2
```

  `functions compared 138` equals COMPARED_FLOOR; the verify grep for the two SNAPSHOT_MISSING rows prints 2; the allowlist is unchanged (the same three rows). No allowlist row was added.
- `node scripts/check-baseline-currency.mjs --replay-set`: `baseline-currency: carried=324 replay=2 marker-sha=match defects=0` and `baseline-replay: 2 migration(s) newer than the dump: 20261119120000_sync_profile_email_from_auth.sql 20261120120000_auth_user_has_password.sql`.
- Snapshot neuter: backup `cp -p` to the scratchpad, changed `RETURNS boolean` to `RETURNS  boolean` in the snapshot, `npm run schema:functions:check` exit 1 with `stale:    supabase/schema/functions/auth_user_has_password.sql`; restore `cp -p`, `cmp` exit 0, re-run green (`SQL function snapshot is current (136 functions).`).
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output. `npm run lint`: exit 0, `4 problems (0 errors, 4 warnings)`, the same four pre-existing warnings as 219-03.
- Acceptance: `git diff --name-only 83ffa0192..HEAD -- .github/workflows/ci.yml supabase/schema/baseline.sql supabase/schema/baseline-carried-migrations.txt` printed nothing; `export const WAIVED_CEILING = 0;` matches.

## Task Commits

1. **Task 1 (tracer): floors and every pinned mutation census** - `bb206feaf` (test)
2. **Task 2: snapshot, NAME_SET_RATCHET row, COMPARED_FLOOR** - `65c56a8f8` (chore)

## Tracer gate

The tracer slice was the new gate counted by the runner and the four census files. `<verify>` was re-run end to end (`--parse-only` clean with the new row, lint and self-test clean, the census files green individually) before Task 2. No `blocking-human` gate on the tracer.

## Deviations from Plan

**1. [Environmental] No FULL local mutation run**
- Same as 219-03: the data volume is nearly full. ARMS_FLOOR 910 is the static annotated-unwaived count, an upper bound on biting; the nine arms were measured biting by plan 04's `--file` diagnostic run. The floor notes say so. CI `sql-mutation` FULL on the PR head SHA is authoritative.

**2. [Environmental] Parallel-load timeouts in subprocess-driven census tests**
- Under six- and ten-file parallel invocations on this host, three subprocess tests timed out or failed (listed above). Each passed alone and no code was changed. The plan's verify lines run the files in one invocation; a CI shard runs fewer per worker. Flagged, not fixed: out of scope, and the failures are timing, not census values.

**3. [Plan premise] `--file` diagnostic row not re-run here**
- The GREEN_LOG per-file row for the new gate is a fixture line shaped like plan 04's diagnostic row (`annotated 9 / biting 9`), flagged in its comment as such.

**Total deviations:** none in shipped state; 3 notes.

## Issues Encountered

None beyond the above. The harness refused compound `git` command lines; they were split.

## Known Stubs

None.

## Threat Flags

None. The plan adds no network endpoint, auth path or schema. T-219-32 mitigated (floors raised to measured values, stale-low ratchet proven RED); T-219-33 mitigated (no allowlist row, both SNAPSHOT_MISSING findings visible).

## Open items routed elsewhere

- **Ship step:** CI `sql-mutation` FULL green on the PR head SHA with the expected check count; `baseline-content-drift` is expected red for the two SNAPSHOT_MISSING rows until the post-apply re-dump (stale-baseline red counts as green); a migration timestamp re-pick touches `grep -rlna 20261120120000 supabase scripts src .planning/phases/219-*`, the NAME_SET_RATCHET `clearedBy`, the COMPARED_FLOOR note and the snapshot header.
- **Post-apply re-dump phase:** regenerate `baseline-carried-migrations.txt` in the same commit and DELETE the `auth_user_has_password` NAME_SET_RATCHET row beside the `sync_profile_email_from_auth` one.
- **TODOS closure rule:** this plan closes no TODOS entry and opens none.

## Self-Check: PASSED

- FOUND: supabase/schema/functions/auth_user_has_password.sql
- FOUND: bb206feaf
- FOUND: 65c56a8f8
- FOUND: `export const FILES_FLOOR = 85;` and `export const ARMS_FLOOR = 910;` in scripts/mutation-floors.mjs
- FOUND: `export const COMPARED_FLOOR = 138;` in scripts/baseline-content-drift-check.mjs
