---
phase: 204-introauth-the-intro-path-s-database-side-authorization-match
plan: 02
subsystem: testing
tags: [mutation-runner, ratchet, census, anti-skip, sql-gate, vitest]

requires:
  - phase: 204
    provides: plan 01's gate test_contact_requests_insert_intro_authz.sql (15 twinned arms, ALL 15 ARMS EXECUTED sentinel)
provides:
  - FILES_FLOOR 80 -> 81 and ARMS_FLOOR 815 -> 830 at the --parse-only reading, with dated RAISED blocks
  - the registry keys, runner-floor echoes, parser, lint, ci.yml sentinel roster and drift-check pins moved to match
affects: [ship step (CHANGELOG, VERSION), CI sql-mutation FULL, CI sql-tests]

actuals:
  tokens: 17000
  tasks: 3
  commits: 3
plan_head_before: 48219be257ce3bd90e4fd3379835c0faa6c730e0
plan_head_after: 4b02830788136209e5835b3541e4c0a436f48f95

tech-stack:
  added: []
  patterns:
    - "census values copied from the saved --parse-only log and the exit-0 --subset-from run, never computed"

key-files:
  created: []
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts

key-decisions:
  - "FULL local mutation run recorded as not-run (7.9 GB free on the data volume at the start, 11 GB at the end, against the roughly 15 GB a full run needs); ARMS_FLOOR 830 is the static annotated-unwaived count, an upper bound on biting, and CI sql-mutation FULL on the PR head SHA is the authoritative full run"
  - "WAIVED_CEILING stays 0, no waiver added"
  - "The new gate's by-name entry sits after test_compute_jobs_error_kind_copy_parity.sql (sorted position), not after test_compute_job_metadata_merge.sql as the plan text said; the test compares the sorted list and went red until it was moved"

requirements-completed: [D-07, D-08]

coverage:
  - id: D1
    description: "FILES_FLOOR and ARMS_FLOOR equal the measured corpus with the gate (81 files, 830 arms), WAIVED_CEILING 0, registry keys moved in the same commit"
    requirement: D-07
    verification:
      - kind: unit
        ref: "src/__tests__/gate-family-meta.test.ts"
        status: pass
      - kind: other
        ref: "node scripts/mutation-runner/run.mjs --parse-only (coverage: files 81/108, arms: 0/830/0, No static defects)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Runner-floor echoes, per-file row, parser pins, lint scanned count agree with the corpus"
    requirement: D-07
    verification:
      - kind: unit
        ref: "src/__tests__/mutation-runner-floors.test.ts, mutation-annotation-parser.test.ts, lint-sql-gates.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "ci.yml sentinel roster row, SENTINEL_FLOOR 28, anti-skip ARMS_FLOOR 445, drift-check pins"
    requirement: D-07
    verification:
      - kind: unit
        ref: "src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts, src/__tests__/drift-check-scripts.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "A real biting reading over the FULL corpus with the gate in it"
    verification: []
    human_judgment: true
    rationale: "Not run on this host (disk); CI sql-mutation FULL on the PR head SHA owns it"

duration: 15min
completed: 2026-11-10
status: complete
---

# Phase 204 Plan 02: Corpus censuses for the intro-authorization gate Summary

**Every census the new gate file moves now reads 81 annotated files of 108 and 830 annotated arms (anti-skip roster 28 files, 445 arms), each copied from a measured run, with WAIVED_CEILING still 0.**

## Performance

- **Duration:** 15 min
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 7 (all test and census files; no production SQL touched)

## Accomplishments

- Tracer: `--parse-only` and the exit-0 `--subset-from` reading carried end to end into `FILES_FLOOR` (80 -> 81), `ARMS_FLOOR` (815 -> 830) and the two `gate-family-meta` registry keys, each under a dated RAISED block naming Phase 204 INTROAUTH plan 02 (`f1eccf12a`).
- `mutation-runner-floors.test.ts`: every echo of the corpus figures moved (`totalAnchored`, scope 81/81, coverage 81/108, arms/biting/lane-invocations 830, 81 baseline / 81 restore legs, the +1 and -1 offsets, SUBSET 2/81 and 3/81, `biting arms 830 >= 830`), plus a new per-file row copied verbatim from the subset run (`6e6ea941f`).
- Parser (`armsSeen` 830, both `filesTotal` 108, `filesAnnotated` 81, `annotatedFiles` length 81, by-name entry), lint (`scanned 108 file`), `ci.yml` (roster row, `SENTINEL_FLOOR` 27 -> 28, anti-skip `ARMS_FLOOR` 430 -> 445 with `+ 15` in the sum comment at the matching table position, dated paragraph) and `drift-check-scripts.test.ts` (title and two `-ac` pins) (`4b0283078`).

## Task Commits

1. Task 1 (tracer): `f1eccf12a` test(204-02): mutation floors and their registry keys at the measured corpus with the intro-authorization gate
2. Task 2: `6e6ea941f` test(204-02): runner-floor echoes at the measured corpus
3. Task 3: `4b0283078` test(204-02): parser, lint and anti-skip sentinel censuses for the intro-authorization gate

Each commit's file set was checked exactly against the task's list; no `held/` path appeared in any `git show --stat`. `commits: 3` is measured from the persisted ledger (`48219be25..4b0283078`); the SUMMARY commit that follows makes 4.

## Readings (gc-204-)

```
gc-204-census-parse: coverage: files 81/108 | arms: 0/830/0   (executed/annotated/waived)   [exit=0, No static defects]
gc-204-census-subset: exit=0   (scope: SUBSET 1/81 annotated files; arms: 15/15/0; biting: 15; lane-invocations: 15 plus 1 baseline / 1 restore leg(s); per-arm lane time: mean 1.1s over 15 arm run(s); ARMS_FLOOR (static upper bound): 830 annotated-unwaived >= floor 815 before the raise; file test_contact_requests_insert_intro_authz.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15)
gc-204-full-run: not-run (7.9 GB free on /System/Volumes/Data at the start of the plan, 11 GB at the end, against the roughly 15 GB a full run needs; coordinator rule 2 also forbids a full run here; CI sql-mutation FULL owns it)
gc-204-vitest: Test Files  7 passed (7) | Tests  1467 passed (1467)   [mutation-runner-floors, gate-family-meta, mutation-annotation-parser, lint-sql-gates, drift-check-scripts, contracts/ci-anti-skip-gate.contract, critical-regressions; no skipped test]
gc-204-lint: lint-sql-gates: scanned 108 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
gc-204-parse-final: coverage: files 81/108 | arms: 0/830/0 | No static defects. Every prose marker has a twin and every needle still matches. (exit 0)
```

## Moved censuses (old -> new, source run)

| Census | Old | New | Source |
|---|---|---|---|
| `FILES_FLOOR` (+ registry key) | 80 | 81 | `--parse-only` `coverage: files 81/108` |
| `ARMS_FLOOR` (+ registry key) | 815 | 830 | `--parse-only` `arms: 0/830/0` (static bound; subset run biting 15) |
| `WAIVED_CEILING` | 0 | 0 | unchanged |
| runner-floors pins | 80 files / 107 total / 815 arms / 80 legs | 81 / 108 / 830 / 81 legs | parse + subset logs |
| parser `armsSeen`, `filesTotal` x2, `filesAnnotated`, `annotatedFiles` | 815, 107, 80, 80 | 830, 108, 81, 81 | same |
| lint scanned count | 107 | 108 | `node scripts/lint-sql-gates.mjs` |
| ci.yml `SENTINEL_FLOOR` / anti-skip `ARMS_FLOOR` | 27 / 430 | 28 / 445 | the gate's `ALL 15 ARMS EXECUTED` sentinel; `ci-anti-skip-gate.contract.test.ts` |
| drift-check pins | 27 / 430 | 28 / 445 | ci.yml |

## Neuter checks (each RED with the expected message, restored from a `cp` backup, `cmp` identical)

- `FILES_FLOOR` set back to 80: `RATCHET STALE: 81 of 108 gate files are now annotated but FILES_FLOOR is still 80.` plus the registry key mismatch. Restored identical.
- `ARMS_FLOOR` set back to 815: `The corpus declares 830 twin(s) of which 0 are waivers, so a green run bites 830. ARMS_FLOOR is 815.` plus the registry key mismatch and the `biting arms 830 >= 830` echo. Restored identical.
- ci.yml roster row removed: the contract test reports the sentinel-bearing set no longer matches the derivation table. Restored identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] By-name list position in the parser test**
- **Found during:** Task 3
- **Issue:** the plan text said to insert the new file "after `test_compute_job_metadata_merge.sql`", but the list is in sorted order and `test_compute_jobs_error_kind_copy_parity.sql` sorts before `test_contact_requests...`; my first insertion (a line too far, after `test_create_wizard...`) also failed the deep-equal.
- **Fix:** placed it between `test_compute_jobs_error_kind_copy_parity.sql` and `test_create_wizard_strategy_for_key.sql`, which the test accepts.
- **Files modified:** `src/__tests__/mutation-annotation-parser.test.ts`
- **Commit:** `4b0283078`

**2. [Plan text gap] One extra pin in mutation-runner-floors**
- The `GREEN_LOG.replace("scope: FULL 80/80 ...")` in the DIAGNOSTIC-scope case also carried the old figure; vitest named it (one failing test) and it moved to 81/81. Commit `6e6ea941f`.

**Total deviations:** 2 (one bug in my own insertion, one pin the plan did not list). **Impact:** none on scope.

## Known Stubs

None.

## Authentication Gates

None.

## CI-only items for the ship step

`sql-mutation` FULL on the PR head SHA (a floors edit forces FULL; compares 830 with a real biting count and carries the `lane-concurrency:` line), `sql-tests` on the real dump (the gate's sentinel on that lane), `sql-gate-lint`, `plan-anchor-verify`, `frontend-coverage`, and the `frontend` aggregator. The two scopes this plan did not run locally: the FULL mutation run and the real-dump lane.

## Self-Check: PASSED

- `scripts/mutation-floors.mjs` carries `FILES_FLOOR = 81`, `ARMS_FLOOR = 830`, `WAIVED_CEILING = 0` (Task 1 verify command passed against the saved parse log).
- Commits `f1eccf12a`, `6e6ea941f`, `4b0283078` are ancestors of HEAD; `STATE.md`, `ROADMAP.md` and `.planning/state.json` are byte-identical to `a83b7ac8c`.
