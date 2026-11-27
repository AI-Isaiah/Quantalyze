---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 05
subsystem: ci-gate-censuses
tags: [mutation-floors, sql-tests, census, SECR-04]
requires: [242-02, 242-03, 242-04]
provides: ["ARMS_FLOOR 1089", "sql-tests sentinel table and ARMS_FLOOR=599 moved to the four re-based gates"]
affects: [scripts/mutation-floors.mjs, .github/workflows/ci.yml]
key-files:
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
decisions:
  - "ci-anti-skip-gate.contract.test.ts needed no edit: okCount did not move (the prober gate is lane-only and excluded)"
status: complete
actuals:
  tokens: 60000
  tasks: 2
  commits: 2
plan_head_before: f6fc1a37c4039ffc8c5aa3253fec045a13af905a
plan_head_after: 3b00fba8d65c61fd47ecf4793645e7fd2ff9d720
---

# Phase 242 Plan 05: Censuses and floors Summary

Every number that counts gate arms now agrees with the tree plans 02 to 04 left: the mutation runner's `ARMS_FLOOR` 1079 -> 1089, the sql-tests `ARMS_FLOOR=` sum 589 -> 599, and each pin that restates them, read off failing assertions and the runner, never hand-summed.

`commits: 2` counts the two code commits measured from the ledger (`git rev-list --count f6fc1a37c..3b00fba8d`); this SUMMARY is committed separately after them.

## Base check

`git fetch origin main`, then `FILES_FLOOR = 96`, `ARMS_FLOOR = 1079`, `WAIVED_CEILING = 0` on origin/main and in this tree alike (`git show origin/main:scripts/mutation-floors.mjs | grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)'`). Phase 243 had not moved them, so the plan's expected 1089 stands.

## Values moved (before -> after, and where read)

| Literal | Before | After | Read from |
|---|---|---|---|
| `ARMS_FLOOR` (`scripts/mutation-floors.mjs`) | 1079 | 1089 | `node scripts/mutation-runner/run.mjs --parse-only`: `arms: 0/1089/0   (executed/annotated/waived)`; failing ratchet `The corpus declares 1089 twin(s) of which 0 are waivers ... ARMS_FLOOR is 1079` |
| `FILES_FLOOR` | 96 | 96 (unchanged) | `--parse-only`: `coverage: files 96/123` |
| `WAIVED_CEILING` | 0 | 0 (unchanged) | `--parse-only`: waived 0 |
| gate-family-meta `KNOWN_THRESHOLD_SITES` key | `ARMS_FLOOR=1079` | `ARMS_FLOOR=1089` | the floor constant (the test passed before and after; the key is a restatement kept in step) |
| mutation-runner-floors `totalAnchored` | 1079 | 1089 | failing assertion `expected 1089 to be 1079` |
| mutation-runner-floors synthetic FULL log (`arms:` / `biting:` / `lane-invocations:` / lane-time / spawned / `reports` / splice offsets) | 1079 (offsets 1078, 1080) | 1089 (offsets 1088, 1090) | same-shape move as commit `eedbc2433`; green only when every site agrees with the floor |
| synthetic per-file rows | analytics settings 14, cron_sync 8, ops 14, prober 7 | 17, 11, 16, 9 | each gate's DIAGNOSTIC `--file` run, plans 02, 03, 04 SUMMARYs (`arms: 17/17/0`, `11/11/0`, `16/16/0`, `9/9/0`; biting equal) |
| mutation-annotation-parser `armsSeen` | 1079 | 1089 | failing assertion `expected 1089 to be 1079` |
| mutation-annotation-parser `stepsSeen` | 1232 | 1241 | failing assertion `expected 1241 to be 1232` |
| mutation-annotation-parser `needles.length` | 1232 | 1241 | failing assertion `expected 1241 to be 1232` |
| ci.yml row `test_cron_sync_tick.sql` | 8 | 11 | `grep -a -o -m1 'ALL [0-9]* ARMS EXECUTED'` on the gate: `ALL 11 ARMS EXECUTED` |
| ci.yml row `test_prod_prober_cadence.sql` | 7 | 9 | same: `ALL 9 ARMS EXECUTED` |
| ci.yml row `test_ops_staleness_check.sql` | 14 | 16 | same: `ALL 16 ARMS EXECUTED` |
| ci.yml row `test_analytics_service_settings_and_vault_tick.sql` | 13 | 16 | same: `ALL 16 ARMS EXECUTED` |
| ci.yml `ARMS_FLOOR=` | 589 | 599 | the table's own sum computed in table order (38 rows); contract failure `expected 599 to be 589` |
| ci.yml `SENTINEL_FLOOR=` | 38 | 38 (unchanged) | no sentinel file joined; 38 table rows |
| drift-check-scripts `it` title and `grep -ac ARMS_FLOOR=` argument | 589 | 599 | the ci.yml value |
| `ci-anti-skip-gate.contract.test.ts` | untouched | untouched | stayed green; `okCount` did not move |

## Verification

- Census set, before edits: `Test Files 3 failed | 3 passed (6)`, `Tests 6 failed | 1315 passed (1321)` (mutation-annotation-parser x2, mutation-runner-floors x2 including `RATCHET STALE`-direction ratchet, ci-anti-skip contract x2).
- Census set, after: `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts src/__tests__/lint-sql-gates.test.ts --testTimeout=120000` -> `Test Files 6 passed (6)`, `Tests 1321 passed (1321)`.
- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 96/123`, `arms: 0/1089/0`, `No static defects`.
- `node scripts/lint-sql-gates.mjs`: `scanned 123 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`.
- Acceptance greps: `ARMS_FLOOR=589` 0 in ci.yml and in drift-check-scripts; `SENTINEL_FLOOR=38` 1 in ci.yml; the four table rows match their anchored patterns.

## Deviations from Plan

None. Notes:
- The ARMS_FLOOR floor is the static annotated-unwaived count (1089), an upper bound on biting, as the preceding RAISED entries are; the per-gate DIAGNOSTIC runs each measured biting equal to annotated. A FULL local runner run was not repeated; CI `sql-mutation` FULL on the PR head is the comparison.
- The previous ci.yml `ARMS_FLOOR=` derivation comment was already out of table order (e.g. 22 for compute_job_attempt_failures appeared as 8); it was rewritten in table order as the plan directs, and sums to the floor.
- `gate-family-meta.test.ts` was green before the edit (its key is a restatement, not an assertion against the constant); updated anyway per the plan.
- STATE.md and ROADMAP.md untouched (orchestrator-owned).

## Known Stubs

None.

## Self-Check: PASSED

Commits `f23caa977` and `3b00fba8d` are ancestors of HEAD; the six census files carry the values above.
