---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 04
subsystem: testing
tags: [mutation-runner, floors, census, sql-gate]
requires:
  - phase: 191-03
    provides: "test_compute_job_metadata_merge.sql, the annotated gate whose arms move the floors"
provides:
  - "FILES_FLOOR 80 and ARMS_FLOOR 801 in scripts/mutation-floors.mjs, copied from one full runner run"
  - "gate-family-meta and mutation-runner-floors pins moved to that run's values"
affects: [191-05]
tech-stack:
  added: []
  patterns: ["floors copied from one saved full run, never computed"]
key-files:
  created: []
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
key-decisions:
  - "Floors move +1 file and +10 arms, not +11: the untwinned control arm 11 raises ARM 11 FAILED and is not an annotated arm"
requirements-completed: []  # SC-3 is NOT met by PR 1; it waits for the live two-connection probe, plan 191-09
status: complete
completed: 2026-11-05
commits: 2
plan_head_before: 3fb0cb13609ee6f18e9cc82a862339acbe0a564e
plan_head_after: 992c3a4c0
actuals:
  tokens: 40000
  tasks: 2
  commits: 2
---

# Phase 191 Plan 04: the mutation runner's floors Summary

One full corpus run with the metadata-merge gate in it exited 0 and measured 80 annotated files and 801 biting arms; both floors and every pin that echoes the run were moved to those figures, and no waiver was added.

## Commits

- f68d2b737 test(191-04): raise the mutation floors to one full run's measured counts
- 992c3a4c0 test(191-04): move the pins that echo the full mutation run

## The full run (saved log, no file edited during it)

`node scripts/mutation-runner/run.mjs`, tree clean at HEAD 3fb0cb136, exit 0:

```
scope: FULL 80/80 annotated files
scope-reason: no derivation reason supplied (a direct invocation)
lane-concurrency: 4
coverage: files 80/107
unreachable: 27 file(s) raise outside the runner's identity idiom
lane-blocked: 0 file(s)
lane-probe: pg_cron AVAILABLE
arms: 801/801/0   (executed/annotated/waived)
biting: 801
lane-invocations: 801   (... plus 80 baseline / 80 restore leg(s))
per-arm lane time: mean 1.8s over 801 arm run(s)
No defects. Every annotated arm bit its own arm first.
exit=0
```

The two independent tallies (`arms:` and `lane-invocations:`) agree at 801. New per-file row: `test_compute_job_metadata_merge.sql: sections 10 / judged 10 / annotated 10 / waived 0 / biting 10`.

## Floors

| constant | before | after |
|---|---|---|
| `FILES_FLOOR` | 79 | 80 |
| `ARMS_FLOOR` | 791 | 801 |
| `WAIVED_CEILING` | 0 | 0 |

Each floor carries a dated MEASURED comment naming Phase 191 plan 04 and quoting the run.

## Pins moved

- `gate-family-meta.test.ts`: the `FILES_FLOOR=` and `ARMS_FLOOR=` keys, with the new measurement prepended and the old one kept as LINEAGE.
- `mutation-runner-floors.test.ts`: `totalAnchored` 791 to 801; the green log's scope, target-file count, coverage, arms, biting, lane-invocations (with its 80 baseline / 80 restore legs), mean-time line and the new per-file row; and every dependent splice or expectation (spawned lanes, per-file-row offset, biting-sum offset, severed/extra/garbled lane-invocations, waived and zero splices, the SUBSET log's `2/80` and `80/107`, the FULL scope assertions). Each carries a dated CURRENCY comment naming Phase 191 plan 04.

## Verification

- `node scripts/verify-plan-anchors.mjs` on the plan: OK.
- Before the pin move (floors already moved): `gate-family-meta` 1 failed, `mutation-runner-floors` 30 failed (the stale-low ratchet and the echoes).
- After: `gate-family-meta`, `mutation-runner-floors`, `mutation-annotation-parser`, `lint-sql-gates`: 4 files, 336 tests passed.
- Wider set (critical-regressions, sql-mutation-scope-step, sql-mutation-nightly-parity, mutation-runner-neuter, drift-check-scripts, baseline-redump-wiring, local-stack-lane-wiring): 7 files, 1373 tests passed.

## Deviations from Plan

None - plan executed exactly as written. The expected movement was +10 arms (not +11) as flagged by the 191-03 deviation, and the run confirmed it.

The plan's second "a run after the floors moved exits 0" confirmation was not repeated: the plan specifies ONE full run, and the floors file is not read by any step of this run other than as defaults the run already cleared.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

`scripts/mutation-floors.mjs`, both pinning tests and the saved run log exist; commits f68d2b737 and 992c3a4c0 are ancestors of HEAD.
