---
phase: 260-ciheadroom-ci-yml-sits-well-under-github-s-workflow-file-siz
plan: 01
subsystem: ci
tags: [github-actions, workflow-size, ci-gate, comment-move, docs]
requires: []
provides:
  - "scripts/check-workflow-size.mjs: a size gate (ceiling 460800, hard limit 512000) with a boundary-exact --self-test"
  - ".github/workflows/workflow-size.yml: runs the gate on every PR, push to main and dispatch, outside ci.yml"
  - "docs/ci-yml-notes.md: 24 rationale blocks moved verbatim out of ci.yml, anchored"
  - "ci.yml at 406613 bytes (511664 before)"
affects: [ci.yml, critical-regressions registry, CLAUDE.md Timeout paragraph, shared-test-db-mutex runbook]
tech-stack:
  added: []
  patterns:
    - "gate in its own workflow so an oversized file cannot suppress it"
    - "comment move proven lossless by byte-exact reconstruction"
key-files:
  created:
    - scripts/check-workflow-size.mjs
    - .github/workflows/workflow-size.yml
    - src/__tests__/workflow-size-gate.test.ts
    - docs/ci-yml-notes.md
  modified:
    - .github/workflows/ci.yml
    - src/__tests__/critical-regressions.test.ts
    - CLAUDE.md
    - docs/runbooks/shared-test-db-mutex.md
decisions:
  - "No warning tier: a file is over 460800 bytes or it is not (CONTEXT [Gate])"
  - "Appendix A (moving run: bodies into scripts) not taken; only YAML-level comment blocks of 2000 bytes or more moved, frontend job untouched"
metrics:
  tasks: 3
  completed: 2026-11-28
status: complete
actuals:
  tokens: 33600
  tasks: 3
  commits: 4
plan_head_before: 176501797ae4def0e5589c76ccbf117b13b9a999
plan_head_after: 77ed32e61db602bb372a52a8ec77f2bef87cfc6f
---

# Phase 260 Plan 01: CIHEADROOM Summary

ci.yml drops from 511,664 to 406,613 bytes by moving 24 long YAML-level comment blocks verbatim into `docs/ci-yml-notes.md`, and a separate `workflow-size` workflow fails any PR whose workflow file passes 460,800 bytes.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 Tracer: size gate | `a50182dec` | `scripts/check-workflow-size.mjs`, `.github/workflows/workflow-size.yml`, `src/__tests__/workflow-size-gate.test.ts`, `src/__tests__/critical-regressions.test.ts` |
| 2 Move 24 blocks | `c2cb05c54` | `.github/workflows/ci.yml`, `docs/ci-yml-notes.md`, `src/__tests__/workflow-size-gate.test.ts` |
| 3a CLAUDE.md repoint (own commit, droppable alone) | `02d0aaaf6` | `CLAUDE.md` |
| 3b runbook repoint | `77ed32e61` | `docs/runbooks/shared-test-db-mutex.md` |

`commits: 4` is measured (`git rev-list --count ${plan_head_before}..HEAD` at SUMMARY write).

## Task 1 records

**Gate RED on the real tree before the move.** `node scripts/check-workflow-size.mjs` exited 1 with exactly one `::error file=` line, and it was `::error file=.github/workflows/ci.yml::ci.yml is 511664 bytes, over the 460800-byte ceiling; GitHub starts no run for a workflow file above 512000 bytes.` Summary line: `workflow-size: FAIL, 1 of 17 file(s) over the 460800-byte ceiling.`

**Registry test.** After the new workflow file existed and before the list edit, `critical-regressions.test.ts` "classifies exactly the known PR/push-triggered workflows" was RED (`AssertionError: expected [ '.github/workflows/ci.yml', …(8) ] to deeply equal [ '.github/workflows/ci.yml', …(7) ]`, with `+ ".github/workflows/workflow-size.yml"` the extra entry). After the one-line edit: `Test Files 2 passed (2), Tests 211 passed (211)` (gate file plus registry file).

**Neuter (strictly-greater changed to greater-or-equal in `judge`), then restore from a byte backup:**
- `--self-test` went RED: `SELF-TEST FAIL: over-ceiling red (a 460801-byte file must be the only file named)`. It names the over-ceiling leg because that leg also holds the 460,800-byte `under.yml`, which the neuter wrongly names; the at-ceiling file is what tripped it. Exit 1.
- vitest went RED, 3 failed of 19: "460,801 bytes is red and only that file is named; 460,800 beside it is not", "exactly 460,800 bytes is green, with no warning and no error annotation" (the at-ceiling arm), and "--self-test exits 0 and prints its OK line".
- Restore: `cp` from `$SCRATCH/check-workflow-size.mjs.bak`, then `cmp` exit 0. Self-test and vitest (19 of 19) green again.

## Task 2 records

### Derived block table (matches the plan's oracle at `9c5c414b0` on every anchor, byte count and indent; no rebase deviation)

| Anchor | Bytes | Lines | Indent | Stands before |
|---|---|---|---|---|
| changed-paths-1 | 7444 | 104 | 4 | job key `runs-on:` |
| frontend-local-stack-1 | 4968 | 66 | 4 | job key `needs:` |
| frontend-local-stack-2 | 2212 | 29 | 8 | `env:` in step "Capability probe - does the lane ..." |
| frontend-live-db-lane-1 | 5958 | 84 | 4 | job key `needs:` |
| sql-gate-lint-1 | 2064 | 31 | 4 | job key `needs:` |
| sql-gate-lint-2 | 3679 | 55 | 6 | step "Baseline content-drift gate self-test ..." |
| sql-gate-lint-3 | 2396 | 34 | 6 | step "Assert the extractor self-test PRINTED ..." |
| sql-gate-lint-4 | 2356 | 34 | 6 | step "Data-dependence gate self-test ..." |
| sql-gate-lint-5 | 2110 | 30 | 6 | step "Assert the data-dependence scan PRINTED ..." |
| sql-mutation-1 | 18218 | 250 | 4 | job key `needs:` |
| sql-mutation-2 | 2261 | 30 | 8 | `run:` in step "Provision pg_cron for the lane's PostgreSQL (Phase 164.4.1)" |
| sql-mutation-3 | 2738 | 39 | 8 | `run:` in step "Runner self-test - every defect kind still fires" |
| sql-mutation-4 | 3950 | 56 | 8 | `env:` in step "Mutate every annotated RED-UNDER arm and require it to bite" |
| plan-anchor-verify-1 | 2278 | 35 | 4 | job key `if:` |
| sql-tests-1 | 7670 | 110 | 4 | job key `needs:` |
| python-1 | 2120 | 29 | 4 | job key `timeout-minutes:` |
| python-2 | 2676 | 38 | 6 | step "Type gate - mypy strict ..." |
| python-3 | 4030 | 44 | 6 | unnamed step `- run: pytest -n auto ...` |
| test-db-drift-1 | 12037 | 155 | 4 | job key `runs-on:` |
| test-db-drift-2 | 2588 | 31 | 4 | job key `timeout-minutes:` |
| test-db-drift-3 | 3953 | 54 | 6 | step "Wait for the TEST schema apply to conclude ..." |
| e2e-seeded-1 | 2116 | 29 | 4 | job key `timeout-minutes:` |
| e2e-seeded-2 | 3938 | 55 | 4 | job key `needs:` |
| e2e-seeded-3 | 2608 | 36 | 6 | step "Verify build inlined real test-Supabase URL ..." |

Total: 24 blocks, 106,368 bytes, 1,458 lines, 10 jobs. Re-running the scratch mover on the pre-move snapshot reproduces the committed `ci.yml` and `docs/ci-yml-notes.md` byte for byte (`cmp` exit 0 on both). The `frontend` job's 14,324-byte header block stayed (`grep -c 'Aggregator. Branch protection gates on this single required check' .github/workflows/ci.yml` prints 1).

### One-off proof (scratch, never committed; printed values)

```
PROOF a OK  yaml.parse(before) deep-strict-equals yaml.parse(after)
PROOF b OK  YAML-level-comment-stripped texts are byte-identical
PROOF c OK  reconstruction from new ci.yml + doc equals the old ci.yml byte for byte; pointers=24 anchors=24 moved lines=1458
PROOF d OK  frontend job section byte-identical (28487 bytes)
PROOF e OK  job keys and ordered step names identical; jobs=25 steps=201 named=138
PROOF f OK
```

PROOF f, bytes before to after:

| File | Before | After |
|---|---|---|
| analytics-deploy-verify.yml | 23843 | 23843 |
| cassette-refresh.yml | 14532 | 14532 |
| **ci.yml** | **511664** | **406613** |
| contracts.yml | 2483 | 2483 |
| main-ci-cancelled-watcher.yml | 15609 | 15609 |
| migration-drift-check.yml | 18832 | 18832 |
| migration-policy-self-test.yml | 7092 | 7092 |
| migration-policy.yml | 15764 | 15764 |
| mutex-probe.yml | 20657 | 20657 |
| nightly.yml | 5245 | 5245 |
| phase-19-stability.yml | 2949 | 2949 |
| prod-prober.yml | 27469 | 27469 |
| secret-scan-full-history.yml | 14524 | 14524 |
| sql-function-snapshot.yml | 7309 | 7309 |
| sql-mutation-nightly.yml | 64723 | 64723 |
| supabase-migrate.yml | 108841 | 108841 |
| test-restore-from-baseline.yml | 174536 | 174536 |
| **workflow-size.yml** | (new) | **1341** |
| total of the workflow files | 1,036,072 | 932,362 |
| docs/ci-yml-notes.md | (new) | 103,978 |

Post-move scan: `workflow-size: OK, 18 file(s) at or under the 460800-byte ceiling; largest ci.yml at 406613 bytes.` ci.yml headroom: 54,187 bytes to the ceiling, 105,387 bytes to the hard limit. Acceptance greps: 24 pointer lines, 24 anchor lines, 10 `##` sections.

### Reader set, before and after, compared by test id

The reader set is the frozen `git grep -a -l -E "ci\.yml|\.github/workflows"` list: 42 vitest files at this base (the research's 45 was counted at another tree). Both runs serial, one vitest invocation at a time, the baseline taken after the Task 1 commit.

- Before: 2713 tests, 2690 passed, 5 failed.
- After: 2720 tests (the 7 new gate arms), 2688 passed, 14 failed. Tests in before but absent after: 0.

**The 5 baseline failures, each explained.** All five are spawn or test timeouts on this heavily loaded machine (many other agents run vitest at once; the full pass took 4m41s before and 10m30s after wall time):
- `mutation-annotation-parser` R2-W04 REAL CORPUS: `Test timed out in 30000ms`.
- `mutation-runner-floors` IN-05 (`--parse-only` does not print it): `Test timed out in 30000ms`.
- `mutation-runner-floors` 164.3.1-10 GREEN full log: `Test timed out in 5000ms`. This one passed in the after run.
- `ci-apt-bounded` R4 (`scripts/ci-apt.sh --self-test`): `status null, signal SIGKILL`, the 55 s spawn timeout.
- `ci-docs-path-filter` TEST_READ_PLANNING_PATHS derivation: `Test timed out in 5000ms`.

Each of the files holding them passes with 0 failures when run alone on the after tree (`mutation-annotation-parser` 108 tests, `mutation-runner-floors` 133, `ci-apt-bounded` 68, `ci-docs-path-filter` 67).

**Newly failing: 10 ids, all environmental.** Their messages were timeouts (5 s, 20 s, 30 s, 110 s spawn), `SIGKILL` on a spawn, a `git worktree add` that failed under concurrent worktree churn, and two assertions on a spawned script's output that was cut short (`expected 1 to be +0`, missing `SQL self-tests passed`). I re-ran every one of the 8 files alone, serially, on the after tree: `baseline-redump-wiring` 17 tests, `ci-anti-skip-gate.contract` 33, `ci-apt-bounded.contract` 68, `ci-docs-path-filter.contract` 67, `drift-check-scripts` 958, `lint-sql-gates` 74, `local-stack-lane-wiring` 74, `sql-mutation-scope-step` 21: **0 failed in all eight**, so all 10 pass alone. No regression in the move; nothing was changed in any test to make them pass.

**Readers outside the frozen set.** A wider grep found three tests that read other workflow files without naming `ci.yml` (`analytics-deploy-tree-compare.contract`, `prod-prober-incident`, `secret-scan-full-history`); all pass alone (9, 17, 15 tests). After Task 3, the 36 test files that mention `CLAUDE.md` or `shared-test-db-mutex` ran together: 1996 tests, 0 failed. The python and SQL files that mention ci.yml do so in prose or as a path, none reads a moved comment.

## Task 3 phase gate

| Command | Result |
|---|---|
| `grep -c 'sql-mutation-1' CLAUDE.md` | 1 |
| `grep -c 'docs/ci-yml-notes.md' CLAUDE.md` | 1 |
| `grep -c 'docs/ci-yml-notes.md' docs/runbooks/shared-test-db-mutex.md` | 1 |
| Target phrases: "20 minutes is a CEILING, not the next rung" in `sql-mutation-1`; "job skips its dependents" in `test-db-drift-1`; "EDGE WAS ADDED" in `test-db-drift-3` | each found (1) in the section the plan named, so no anchor changed |
| `npx tsx scripts/check-planning-hygiene.ts` | OK, 12828 tracked files scanned; rules 6 and 7 OK; rc 0 |
| `npx tsx scripts/check-canonical-domain.ts` | OK, 4552 tracked files scanned; rc 0 |
| `gitleaks dir docs/ci-yml-notes.md --config .gitleaks.toml` | `scanned ~103978 bytes ... no leaks found`; rc 0 |
| `node scripts/lint-sql-gates.mjs --self-test` | `self-test OK: 7 rules, red+green each.` rc 0 |
| `node scripts/sql-gate-subset.mjs --self-test` | `SELF-TEST PASSED: 31/31 rows, 99/99 assertions`; rc 0 |
| `node scripts/classify-changed-paths.mjs --self-test` | `SELF-TEST PASSED: 25/25`; rc 0 |
| `node scripts/verify-plan-anchors.mjs --self-test` | `SELF-TEST OK`; rc 0 |
| `node scripts/baseline-content-drift-check.mjs --self-test` | `self-test OK: 41 assertions across 4 finding kinds`; rc 0 |
| `node scripts/verify-plan-anchors.mjs --pending` | `claims: 32 checked`, `OK: 9 plan file(s), no stale claims.`; rc 0 |
| `npx eslint src/__tests__/workflow-size-gate.test.ts` | clean, rc 0 (one unused-import warning fixed in Task 1 before the commit) |
| `npm run typecheck` | rc 0, 0 `error TS` lines |
| Commit-message hygiene over `9c5c414b0..HEAD` for the skip-trailer tokens | no match, rc 0 |
| Final `workflow-size-gate.test.ts` plus `critical-regressions.test.ts` | 2 files, 218 tests passed |

CLAUDE.md's `git show --stat` for commit `02d0aaaf6` lists only CLAUDE.md. CHANGELOG.md, VERSION, package.json, TODOS.md, STATE.md and ROADMAP.md were not edited.

## Facts for the ship entry (/gsd-ship owns CHANGELOG, VERSION, package.json)

- Bytes: `ci.yml` 511,664 to 406,613; new `workflow-size.yml` 1,341; new `docs/ci-yml-notes.md` 103,978. All 15 other workflow files byte-identical.
- The new `workflow-size` check adds one check to the expected count on every PR and on main's head.
- The merge push runs one FULL `sql-mutation` pass, because the `changed-paths` and `sql-mutation` job sections change (RESEARCH Pitfall 2; CONTEXT [Consequences]).
- A red or still-running `workflow-size` on a main sha blocks that sha's Railway deploy and makes the next push's predecessor proof run FULL (RESEARCH Pitfall 6; T-260-07, accepted).
- The `critical-regressions` registry list gains `workflow-size.yml`.
- No `TODOS.md` entry is closed by this plan, so none is deleted.

## Deviations from Plan

None to the shipped work; plan executed as written. Notes on the process, none of which changed a deliverable:

1. **[Process] Scratch mover first run.** A bug in my scratch classifier (job tracking skipped a job key that ended a block scalar) produced 25 blocks and 5 jobs on the first run. Fixed in the scratch tool before anything was written to the repo; the rerun matched the oracle exactly.
2. **[Process] PROOF e step count.** It first printed 229 steps because my counter also counted list items under `needs:`; I fixed the proof's counter to count only `steps:` items, giving the oracle's 201 steps and 138 named. The move itself was identical in both runs.
3. **[Process] Denied command.** One `bash -c` helper that ran `rm` on a temp file under `/tmp` was refused by the built-in removal safety check. I did not retry or work around it; I reran the same checks writing to `$SCRATCH` with no `rm`.
4. **[Process] Shared scratchpad.** The scratchpad directory is shared with other sessions; my scratch scripts reused names such as `classify.mjs` and `move-comments.mjs` that held old planning-time scratch tools. Scratch only; nothing tracked.
5. **[Process] Reader-set size.** 42 vitest files in the frozen set, not the research's 45.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (the new workflow's token scope, pins and no `if:` are the T-260-01 and T-260-05 mitigations, pinned by `critical-regressions` and `workflow-size-gate.test.ts`).

## Manual check left for ship (260-VALIDATION.md)

CI actually starts on the PR and the `workflow-size` check appears: count the check runs bound to the head SHA, expecting one more than before.

## Self-Check: PASSED

Created files exist: `scripts/check-workflow-size.mjs`, `.github/workflows/workflow-size.yml`, `src/__tests__/workflow-size-gate.test.ts`, `docs/ci-yml-notes.md`. Commits `a50182dec`, `c2cb05c54`, `02d0aaaf6`, `77ed32e61` are ancestors of HEAD.
