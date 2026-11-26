---
phase: 253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th
plan: 03
subsystem: tooling
tags: [census, mutation-floors, name-set-ratchet, baseline-content-drift, sql-function-snapshot, proof-01]
requires:
  - "253-01: public.set_strategy_fills_reread_bound and supabase/tests/test_strategy_fills_reread_bound.sql (24 annotated arms)"
provides:
  - "supabase/schema/functions/set_strategy_fills_reread_bound.sql (generated snapshot)"
  - "NAME_SET_RATCHET snapshot-only row for set_strategy_fills_reread_bound"
  - "COMPARED_FLOOR 144 -> 145, FILES_FLOOR 94 -> 95, ARMS_FLOOR 1033 -> 1057, each at a measured value"
  - "the four vitest census files agreeing with the runner's own output"
affects: [253-04]
tech-stack:
  added: []
  patterns: ["generated snapshot plus a dated snapshot-only ratchet row, cleared by the post-apply re-dump", "floors read by symbol and set to the --parse-only value, stale-low caught by the vitest ratchet"]
key-files:
  created:
    - supabase/schema/functions/set_strategy_fills_reread_bound.sql
  modified:
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/gate-family-meta.test.ts
key-decisions:
  - "The ARMS_FLOOR is the static annotated-unwaived count (1033 + 24 = 1057), not a FULL-run biting count: the load limit forbids a full corpus run, so the new value is the old measured value plus this gate's measured arms, and CI sql-mutation FULL on the PR is the run that compares it with a real biting count."
  - "No baseline-content-drift allowlist row: the one SNAPSHOT_MISSING finding is expected until the re-dump taken after the PROD apply (T-253-11)."
status: complete
actuals:
  tokens: 21400
  tasks: 2
  commits: 2
plan_head_before: adedccc58d7cddf56c74305030613f0839fc7155
plan_head_after: df7b35490292c82c06e80722d62cfa0a7d182812
commits: 2
---

# Phase 253 Plan 03: census for the re-read bound gate and function Summary

Every census the new SQL gate and the new function move is moved once, to a measured value, with no relaxed assertion, no waiver and no allowlist row: the generated function snapshot, its `snapshot-only` ratchet row, `COMPARED_FLOOR` 145, `FILES_FLOOR` 95, `ARMS_FLOOR` 1057, and the pins in four vitest files.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | bdb3517de | chore(253-03): snapshot of set_strategy_fills_reread_bound, its snapshot-only ratchet row and COMPARED_FLOOR 144 -> 145 |
| 2 | df7b35490 | test(253-03): move every mutation census for the per-strategy fills re-read bound gate |

`commits: 2` is MEASURED from the ledger (`git rev-list --count adedccc58..HEAD` before this SUMMARY's own commit). The tracer gate (task 1) ran end to end (`schema:functions:check` exit 0, drift check at the measured floor) before task 2 started.

## Census numbers moved, and how each was measured

| Census (read by symbol) | Before | After | Measurement |
|---|---|---|---|
| `NAME_SET_RATCHET` rows for this phase (`scripts/dump-sql-functions.ts`) | 0 | 1 (`set_strategy_fills_reread_bound`, `snapshot-only`, 2026-11-26) | `npm run schema:functions:check` RED without the row, GREEN with it |
| function snapshot count | 142 | 143 | `SQL function snapshot is current (143 functions).` |
| `COMPARED_FLOOR` (`scripts/baseline-content-drift-check.mjs`) | 144 | 145 | `node scripts/baseline-content-drift-check.mjs`: `functions compared 145` |
| `FILES_FLOOR` (`scripts/mutation-floors.mjs`) | 94 | 95 | `--parse-only`: `coverage: files 95/122` |
| `ARMS_FLOOR` | 1033 | 1057 | `--parse-only`: `arms: 0/1057/0`; `--file` run `arms: 24/24/0` (1033 + 24 = 1057) |
| `WAIVED_CEILING` | 0 | 0 | unchanged, `grep -nE '^export const WAIVED_CEILING = 0;'` prints one line |
| `lint-sql-gates` scanned files | 121 | 122 | `lint-sql-gates: scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |

Plan 01's note holds: the gate adds 1 annotated file and 24 biting arms (the plan text said 22). Measured, not trusted: the `--file` run below printed 24/24/0 and `biting: 24`.

**Method for the ARMS_FLOOR (stated because a full corpus run was not allowed under the load limit):** new floor = old measured value (1033) + this gate's measured arms (24) = 1057, and `--parse-only` independently printed `arms: 0/1057/0`, so the two agree. 1057 is therefore the static annotated-unwaived count, an upper bound on biting; the dated comment in `scripts/mutation-floors.mjs` says so, and CI `sql-mutation` FULL on the PR (a floors edit forces FULL) is the run that compares it with a real biting count. No FULL local run was made.

## Measurements, verbatim

`node scripts/mutation-runner/run.mjs --parse-only` (exit 0; full output at `.../scratchpad/253/plan03/parse-only.txt`):

```
coverage: files 95/122
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; the lane hosts pg_cron since Phase 164.4.1, TODOS [REDUNDER-PGCRON] retired 2026-09-05)
arms: 0/1057/0   (executed/annotated/waived)
⚠️ STATIC PARSE ONLY — ZERO arms executed. This is NOT the gate: it cannot
✅ No static defects. Every prose marker has a twin and every needle still matches.
```

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_fills_reread_bound.sql` (exit 2 by design for a diagnostic run; output at `.../scratchpad/253/plan03/file-run.txt`):

```
coverage: files 95/122
arms: 24/24/0   (executed/annotated/waived)
biting: 24   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 24   (arm lanes actually spawned — tallied inside runLane, independent of the 24 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_strategy_fills_reread_bound.sql: sections 24 / judged 24 / annotated 24 / waived 0 / biting 24
No defects in the narrowed scope.
```

`node scripts/baseline-content-drift-check.mjs`:

```
baseline-content-drift: functions compared 145 — MATCH 141, DRIFT 3, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: findings 1
::error file=supabase/schema/functions/set_strategy_fills_reread_bound.sql,line=0::content-drift — SNAPSHOT_MISSING set_strategy_fills_reread_bound/6 snapshot=(absent) chain=26ac962345a65f4aa44d5142e559add0bf29ee0e24b220c9513499f55d1fb7a2 — ...
```

The one finding is the new function, as SNAPSHOT_MISSING, expected until the re-dump taken after the PROD apply (the CI step goes red on a PR that adds a function migration until then, by construction, the same state as the Phase 227 and 225 PRs). The 3 DRIFT rows are the allowlisted ones already at HEAD. No allowlist row added. Self-test: `baseline-content-drift self-test OK: 41 assertions across 4 finding kinds ...`.

`grep -a -rn "COMPARED_FLOOR\|NAME_SET_RATCHET" src/__tests__ scripts .github` outside the two owner files: only `src/__tests__/baseline-content-drift-allowlist.test.ts` (the `RATCHET: COMPARED_FLOOR equals what the REAL corpus compares` test, which reads the constant; no literal to move) and prose in `scripts/prod-body-drift-check.sh` (no pin). Recorded result: no pin named the old value.

`grep -a -n "test_strategy_sync_cursors_rls\|FILES_FLOOR" scripts/sql-gate-subset.mjs`: only two self-test fixtures (`export const FILES_FLOOR = 1;` and `= 2;` inside a synthetic repo). No edit.

## PROOF-01 (verbatim)

All backups live under `.../scratchpad/253/plan03/`; every restore is `cp` from the byte backup followed by `cmp` (exit 0). No `git checkout`, `restore` or `stash` was used.

### Gate 1: the function snapshot and its ratchet row

RED, pre-fix (new function in the migration chain, snapshot not generated, no row):

```
SQL function snapshot is stale (2 finding(s)) — a migration changed a function
  missing:  supabase/schema/functions/set_strategy_fills_reread_bound.sql
  snapshot-only: set_strategy_fills_reread_bound
exit=1
```

After `npm run schema:functions` (`git status --short` showed only `?? supabase/schema/functions/set_strategy_fills_reread_bound.sql`) and the ratchet row:

```
SQL function snapshot is current (143 functions).
DRIFT-05 gate (a): baseline 142 name(s) vs migration-replay 143 name(s) — agree, with 1 ratcheted disagreement(s) carried. ...
exit=0
```

Neuter of the ratchet row (backup `dsf.ts.bak`, `cmp` 0; the row's `name` renamed to `neutered_row_name`), RED, the row is shown to bite in both directions:

```
SQL function snapshot is stale (2 finding(s)) — a migration changed a function
  ratchet-stale: neutered_row_name — recorded 'snapshot-only' on 2026-11-26, but it is now present on NEITHER side. The row describes nothing: DELETE this NAME_SET_RATCHET entry. (clearedBy: a re-dump of supabase/schema/baseline.sql taken after its migration applied to PROD)
  snapshot-only: set_strategy_fills_reread_bound
exit=1
restore-cmp=0
```

Restored, GREEN: `SQL function snapshot is current (143 functions).` exit=0.

### Gate 2: COMPARED_FLOOR

Neuter (backup `bcd.mjs.bak`, `cmp` 0; `COMPARED_FLOOR` set back to 144), `npx vitest run --maxWorkers=2 src/__tests__/baseline-content-drift-allowlist.test.ts`, RED:

```
 × RATCHET: COMPARED_FLOOR equals what the REAL corpus compares — stale in EITHER direction fails
AssertionError: the real corpus now compares 145 function(s) but COMPARED_FLOOR is pinned at 144. Update the constant in the same commit as the change that moved it, and say in the message whether a function was really added or removed.: expected 144 to be 145
 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
restore-cmp=0
```

Restored (floor 145), GREEN: `Test Files  1 passed (1)`, `Tests  18 passed (18)`. `src/__tests__/drift-check-scripts.test.ts`: `Tests  949 passed (949)`.

### Gate 3: FILES_FLOOR, ARMS_FLOOR and the four census vitest files

RED, pre-fix (floors raised to the measured 95 and 1057, pins still at the old corpus), `npx vitest run --maxWorkers=2` over the four files:

```
 Test Files  4 failed (4)
      Tests  36 failed | 300 passed (336)
```

First failures, as the tests reported the values: `expected 1057 to be 1033` (armsSeen, totalAnchored), `expected 1207 to be 1186` (needles), `expected 122 to be 121` (filesTotal, annotated classes), `lint-sql-gates: scanned 122 file(s)` not matching `/scanned 121 file/`, and the gate-family-meta `a threshold site not in KNOWN_THRESHOLD_SITES` for the two new floor keys; the synthetic FULL-log fixtures (`scope: FULL 94/94 ...`) then failed the CI re-assert cases.

GREEN after moving every reported literal:

```
 Test Files  4 passed (4)
      Tests  336 passed (336)
```

Stale-low neuter (backup `floors.mjs.bak`, `cmp` 0; `FILES_FLOOR` set to 94 and `ARMS_FLOOR` to 1033, pins left at the new values), RED:

```
AssertionError: RATCHET STALE: 95 of 122 gate files are now annotated but FILES_FLOOR is still 94. Raise FILES_FLOOR in scripts/mutation-floors.mjs to 95.: expected 95 to be 94
 FAIL ... > ARMS_FLOOR ratchet > equals the number of NON-WAIVED twins — the biting count the run measured
 FAIL ... > 164.3.1-10 — CI re-asserts the cross-check out of process ... > GREEN: a FULL log passes on every event and ref — every existing arm, ARMS_FLOOR included (D-07)
 Test Files  2 failed (2)
      Tests  4 failed | 150 passed (154)
restore-cmp=0
```

Restored, GREEN again: `Test Files  4 passed (4)`, `Tests  336 passed (336)`, and `--parse-only` still prints `coverage: files 95/122` and `arms: 0/1057/0`, equal to the floors.

## Literals moved in the vitest files

- `mutation-runner-floors.test.ts`: `totalAnchored` 1033 -> 1057; synthetic FULL log (`scope: FULL 95/95`, `coverage: files 95/122`, `arms`/`biting`/`lane-invocations` 1057, legs 95/95, lane-concurrency "95 target file(s)", mean-line 1057); a NEW per-file row for `test_strategy_fills_reread_bound.sql` (24/24/24/0/24); derived offsets 1056/1058; "printed 96 per-file row(s) but reported 95 annotated file(s)"; SUBSET fixture `2/95`, `3/95`, coverage `95/122`; `biting arms 1057 >= 1057`; the duplicate/diagnostic scope-line cases.
- `mutation-annotation-parser.test.ts`: `armsSeen` 1057, `stepsSeen` 1207, `needles.length` 1207, `filesTotal` 122 (two sites), `filesAnnotated` 95, `annotatedFiles` length 95 plus the by-name list gains `test_strategy_fills_reread_bound.sql`.
- `lint-sql-gates.test.ts`: scanned 122.
- `gate-family-meta.test.ts`: registry keys `FILES_FLOOR=95` and `ARMS_FLOOR=1057`, with the measurement recorded beside each.
- Every changed literal group carries a dated Phase 253 comment. No assertion relaxed, no tolerance widened, no waiver added.

## Deviations from Plan

None in substance. Two notes, neither a deviation from the plan's intent:

1. **[Rule 3 - blocking] `node_modules` absent in the linked worktree.** `tsx` and `vitest` could not run. A symlink `node_modules -> <main checkout>/node_modules` was created inside the worktree (git-ignored by the repo's own `.gitignore`, never staged). `git status --short` stays clean of it. It can be removed with `rm node_modules` (a symlink, not a directory).
2. **`stepsSeen` not reported by the first RED run.** The test that holds `stepsSeen` aborts at the earlier `armsSeen` assertion, so 1207 was taken from the sibling needle test's report (`expected 1207 to be 1186`) and confirmed by the green run.

## Known Stubs

None.

## Threat Flags

None. T-253-10 (floors set below the corpus) is mitigated by setting the floors to the measured `--parse-only` values and by the stale-low RED shown above; T-253-11 (drift finding silenced) by the `snapshot-only` row with a clearing condition and no content-drift allowlist row.

## Not touched (as the plan requires)

`supabase/schema/baseline.sql` and `supabase/schema/baseline-carried-migrations.txt` are byte-identical to origin/main (`git diff --quiet origin/main -- ...` exit 0), `.github/workflows/ci.yml` unchanged, no gate, migration or Python file, `STATE.md` and `ROADMAP.md` untouched per the orchestrator override. The re-dump of `baseline.sql` after the PROD apply of `20261126140000` is its own PR (precedent #1350); it will turn the ratchet row `ratchet-stale` and the SNAPSHOT_MISSING finding into a MATCH, at which point the row is deleted and `COMPARED_FLOOR` stays 145.

## Self-Check: PASSED

- FOUND: supabase/schema/functions/set_strategy_fills_reread_bound.sql
- FOUND commits: bdb3517de, df7b35490
