---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 06
subsystem: testing
tags: [sql-gate-census, mutation-floors, anti-skip-floors, ratchet, d11]

requires:
  - "211-05: test_enqueue_dedup_record_retract.sql with 15 twinned arms and its own ALL 15 ARMS EXECUTED sentinel"
provides:
  - "FILES_FLOOR 82 and ARMS_FLOOR 845 in scripts/mutation-floors.mjs, counting the new gate"
  - "sql-tests anti-skip SENTINEL_FLOOR 29 and ARMS_FLOOR 460 with the new derivation-table row"
  - "every corpus-count census test moved by the measured delta"
affects: [SC-4, 211-07]

status: complete
actuals:
  tokens: 45000
  tasks: 2
  commits: 2
plan_head_before: ef248f51f46734f9355b4649fceee831de847a03
plan_head_after: b8dd482cca4dc92d1fa41dd5a7fa90481d4a42c1

key-files:
  created: []
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts

key-decisions:
  - "ARMS_FLOOR 845 is the static annotated-unwaived count printed by --parse-only (an upper bound on biting): the FULL local mutation run was not run (6.9 GB free vs about 15 GB needed). CI sql-mutation FULL (a floors edit forces FULL) is the authoritative biting count."
  - "WAIVED_CEILING stays 0; no waiver added, no floor lowered, no ratchet test relaxed."

requirements-completed: [SC-4]

coverage:
  deliverables:
    - name: "mutation runner floors count the new gate"
      human_judgment: false
      verification:
        - kind: test
          ref: "src/__tests__/mutation-runner-floors.test.ts, src/__tests__/gate-family-meta.test.ts"
          status: pass
    - name: "sql-tests anti-skip floors and derivation table count the new gate"
      human_judgment: false
      verification:
        - kind: test
          ref: "src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts, src/__tests__/drift-check-scripts.test.ts"
          status: pass
    - name: "remaining corpus-count censuses moved, frontend suite green"
      human_judgment: false
      verification:
        - kind: command
          ref: "npm test (Node 22), npm run typecheck, npm run lint"
          status: pass
---

# Phase 211 Plan 06: Census for the D11 enqueue-dedup gate Summary

**The new 15-arm gate is now counted by every floor that makes a deleted or neutered arm visible: mutation `FILES_FLOOR` 81 to 82 and `ARMS_FLOOR` 830 to 845, `sql-tests` `SENTINEL_FLOOR` 28 to 29 and `ARMS_FLOOR` 445 to 460, with each guard shown RED when a floor is set back.**

## Accomplishments

- **Task 1 (tracer).** `scripts/mutation-floors.mjs` raised, each with a dated `RAISED ... (Phase 211 SYNCJOBS plan 06, ...)` paragraph in the Phase 204 shape. `mutation-runner-floors.test.ts` moved (`totalAnchored`, `scope:`, `coverage:`, `arms:`, `biting:`, `lane-invocations:`, `lane-concurrency:`, `per-arm lane time:`, the new per-file row in sorted position, and every derived literal in the severed/extra/garbled/waived/zero/spliced/subset cases). `gate-family-meta.test.ts` keys moved to `FILES_FLOOR=82` and `ARMS_FLOOR=845` with the dated measured comment.
- **Task 2.** `ci.yml` `sql-tests` step: derivation-table row `test_enqueue_dedup_record_retract.sql 15` between `test_cron_sync_tick.sql` and `test_enqueue_race_loss_40001.sql`, `SENTINEL_FLOOR=29`, `ARMS_FLOOR=460`, `+ 15` inserted at the matching position of the sum comment, and a `Re-measured 2026-11-14 (Phase 211 SYNCJOBS, plan 06)` note. `drift-check-scripts.test.ts`, `mutation-annotation-parser.test.ts` (including the by-name list entry) and `lint-sql-gates.test.ts` moved.

## Measured readings (every number below is a tool print from this tree, commit ef248f51f plus plan 06 edits)

| Command | Reading |
|---|---|
| `node scripts/mutation-runner/run.mjs --parse-only` | `coverage: files 82/109`, `arms: 0/845/0   (executed/annotated/waived)`, `pending: 0`, `No static defects`, exit 0 |
| `node scripts/lint-sql-gates.mjs` | `scanned 109 file(s); 0 finding(s)` |
| `grep -a -o 'ALL [0-9]* ARMS EXECUTED' supabase/tests/test_enqueue_dedup_record_retract.sql` | `ALL 15 ARMS EXECUTED` |
| subset run: `printf '%s\n' supabase/tests/test_enqueue_dedup_record_retract.sql > subset; node scripts/mutation-runner/run.mjs --subset-from subset` | `scope: SUBSET 1/82 annotated files: test_enqueue_dedup_record_retract.sql`, `arms: 15/15/0`, `biting: 15`, `lane-invocations: 15 ... plus 1 baseline / 1 restore leg(s)` (the two tallies agree), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`, `per-arm lane time: mean 6.0s over 15 arm run(s)`, every arm `RED (identity ok)`, `No defects in the SUBSET`, exit 0 |
| per-file line | `test_enqueue_dedup_record_retract.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15` |

The expectations in the plan (82/109, 845, scanned 109, 29, 460) matched the measurements exactly. `git diff HEAD...origin/main` over `supabase/tests`, `scripts/mutation-floors.mjs` and `.github/workflows/ci.yml` was empty at fetch time (5 commits ahead, none touching them), so no other gate shifted the numbers.

**FULL mutation run: NOT run.** `df -h` on the data volume read 6.9 GB free against the roughly 15 GB a full run needs, so `ARMS_FLOOR` 845 is the static annotated-unwaived count the parse prints, an upper bound on biting. CI `sql-mutation` FULL on the PR head SHA is the run that compares it with a real biting count. No FULL run is claimed.

## RED before (the stale reading), `npx vitest run` over the six census files

4 files failed, 10 cases (gate-family-meta and drift-check-scripts were green until their pinned strings were moved):

- `lint-sql-gates.test.ts`: `expected 'lint-sql-gates: scanned 109 file(s); …' to match /scanned 108 file/`
- `mutation-annotation-parser.test.ts`: `expected 845 to be 830` (armsSeen); `expected 956 to be 943` (needles.length); `expected 109 to be 108` (two cases, filesTotal)
- `mutation-runner-floors.test.ts`: `expected 845 to be 830` (totalAnchored); `RATCHET STALE: 82 of 109 gate files are now annotated but FILES_FLOOR is still 81. Raise FILES_FLOOR ...`; `The corpus declares 845 twin(s) of which 0 are waivers, so a green run bites 845. ARMS_FLOOR is 830.`
- `ci-anti-skip-gate.contract.test.ts`: `expected 29 to be 28`; `the set of files declaring an 'ALL N ARMS EXECUTED' sentinel no longer matches ci.yml's derivation table ...: expected [ …(29) ] to deeply equal [ …(28) ]`

All 10 turned green after the moves. `stepsSeen` (943 to 956) was not named in the RED output because its `it` fails first on `armsSeen`; it was moved with its sibling `needles.length` and is green.

## Neuter, RED, restore

| Neuter | RED line | Restore |
|---|---|---|
| N1: `FILES_FLOOR` set back 82 to 81 in `scripts/mutation-floors.mjs` | `AssertionError: RATCHET STALE: 82 of 109 gate files are now annotated but FILES_FLOOR is still 81. Raise FILES_FLOOR in scripts/mutation-floors.mjs to 82.: expected 82 to be 81` (1 failed, 132 passed) | `cp` from byte backup, `cmp` exit 0 |
| N2: `ARMS_FLOOR=` in the `sql-tests` step set back 460 to 445 in `ci.yml` | `AssertionError: ARMS_FLOOR disagrees with the sum of its own derivation table: expected 445 to be 460` (2 failed, 31 passed) | `cp` from byte backup, `cmp` exit 0 |

## Verification

- Task 1 verify: `npx vitest run mutation-runner-floors gate-family-meta`: 2 files, 154 tests passed. `node scripts/mutation-runner/run.mjs --parse-only`: exit 0, `No static defects`, `coverage: files 82/109` numerator 82 equals `FILES_FLOOR`.
- Task 2 verify: the four census files, 1146 tests passed. `npm run typecheck` exit 0. `npm run lint` exit 0.
- `npm test` (Node 22.22.1, default TMPDIR): `Test Files  1238 passed | 20 skipped (1258)`, `Tests  26097 passed | 306 skipped (26403)`, exit 0. The 306 skipped and 20 skipped files are the suite's pre-existing skips, not passes.
- Acceptance greps: `grep -a -E '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)'` prints 82, 845, 0; `grep -c -a 'Phase 211 SYNCJOBS plan 06' scripts/mutation-floors.mjs` is 2; `grep -c -a 'file test_enqueue_dedup_record_retract.sql: sections' src/__tests__/mutation-runner-floors.test.ts` is 1; the ci.yml table-row grep is 1 and its number (15) equals the sentinel; `SENTINEL_FLOOR=29`, `ARMS_FLOOR=460`; the `Re-measured 2026-11-14 (Phase 211 SYNCJOBS, plan 06)` grep is 1; the by-name list grep is 1; no CI skip token in any edited file.
- `node scripts/verify-plan-anchors.mjs` on this plan before any edit: OK, 11 claims.

## Deviations from Plan

None to the plan's content. Two environment notes, neither a code defect and neither fixed here:

1. **A first `npm test` pass reported 11 failures that were my own environment.** I had exported `TMPDIR` to the (long) scratchpad path for the red-before and neuter runs; that path overflows the Unix-socket limit that `tsx` needs for its IPC pipe (`EINVAL ... listen`), which broke `gdpr-export-coverage-hook.test.ts` (8 cases), and the loaded host made `ci-apt-bounded` R4 hit its 55 s spawn bound. Re-run with the default `TMPDIR`: both files pass.
2. **`src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (frozen snapshots) fail on the default shell's Node 25.8.1 and pass on Node 22.22.1** (the CI major, `PATH=/opt/homebrew/opt/node@22/bin`). The test does not read the corpus, floors or ci.yml, so it is unrelated to this plan; recorded, not fixed. The final `npm test` above ran on Node 22.

No further census test beyond the plan's `files_modified` list was reddened, so the extra-test rule was not used.

## Not run

- FULL mutation run (disk, above); CI `sql-mutation` owns it.
- Local-stack (Docker) lane: not attempted (host disk).

## Known Stubs

None.

## Threat Flags

None. Only ratchet integers, comments and test pins changed; no endpoint, auth path or schema.

## Self-Check: PASSED

- FOUND: scripts/mutation-floors.mjs, .github/workflows/ci.yml, and the five `src/__tests__/` files in the key-files list
- FOUND commits: 792cb6fe5, b8dd482cc (ancestors of HEAD)
