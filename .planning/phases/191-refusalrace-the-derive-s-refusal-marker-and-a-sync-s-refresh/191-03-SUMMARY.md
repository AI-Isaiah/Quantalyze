---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 03
subsystem: database
tags: [sql-gate, mutation-runner, jsonb-merge, compute_jobs, census]
requires:
  - phase: 191-02
    provides: "mark_compute_job_kept_figures and retract_ledger_refresh_marker (migration 20261106120000)"
provides:
  - "supabase/tests/test_compute_job_metadata_merge.sql: the metadata-merge gate (sequential key preservation, not a concurrency proof), arms 1-11, ten twins, one untwinned illustration, sentinel; fix round 1 added arms 12 and 13 (single-statement shape of each function, one twin each)"
  - "ci.yml sentinel row, SENTINEL_FLOOR 27, ARMS_FLOOR 416; four pinning tests re-measured"
affects: [191-04, 191-05]
tech-stack:
  added: []
  patterns: ["post-apply sql GRANT twins for ACL arms pinned by a migration verify block", "untwinned control arm raising ARM x FAILED that illustrates the whole-metadata assertion style"]
key-files:
  created:
    - supabase/tests/test_compute_job_metadata_merge.sql
  modified:
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
key-decisions:
  - "Control arm 11 raises with the ARM x FAILED spelling, not TEST FAILED (11)"
requirements-completed: []  # SC-3 is NOT met here: arms 9 and 10 run the writers one after another, so they prove key preservation in sequence only; the concurrency proof is the live two-connection probe, plan 191-09
status: complete
completed: 2026-11-04
commits: 4
plan_head_before: 9a120e7db6a8bc8e196b1d4ae8e3397cf0febdfb
plan_head_after: 30020fd2d5719018fa1bbd45af0f7d9c01c8efed
actuals:
  tokens: 30000
  tasks: 3
  commits: 4
---

# Phase 191 Plan 03: the metadata-merge gate and its censuses Summary

A new SQL gate proves, on a real PostgreSQL, that the refusal marker, the ledger-refresh retraction and a claim-style write keep every key when run one after another in any order (sequential key preservation, not concurrency; plan 191-09's live probe is that proof), pins the single-statement shape of both writers (arms 12 and 13: neither function's body reads compute_jobs outside its UPDATE), shows its twinned properties able to fail, and carries an untwinned control arm (11) that only illustrates the whole-metadata assertion style; the corpus censuses it moves are re-measured.

local-stack-gate: passed
(`scripts/local-stack/run.sh up` booted and replayed `20261106120000_refusalrace_metadata_merge_rpcs.sql` on top of the dump; the gate ran with `psql -v ON_ERROR_STOP=1`, exit 0, `ALL 11 ARMS EXECUTED`. The lane was taken down afterwards. This reading was taken before the one-string change to the control arm's raise text recorded under Deviations; the pg-lane and the runner were re-run after it.)

## Commits

- 510a43760 test(191-03): tracer gate for the metadata merge RPCs, ACL arm and two-writer interleave
- 9fa968334 test(191-03): metadata-merge gate arms 2-8, three-writer interleave, anti-vacuity control and sentinel
- 056636544 test(191-03): control arm raises with the ARM x FAILED spelling
- 30020fd2d test(191-03): move the corpus censuses the metadata-merge gate joins

## The gate

`supabase/tests/test_compute_job_metadata_merge.sql`, 11 arms, one `BEGIN ... ROLLBACK`, one DO block (arms run in order, so each twin's first failure names its arm). Keys: S source, C correlation_id, P member_progress, U unified_backbone_at_claim, K read_refusal_kept_figures, R refresh_marker_retracted.

| arm | proves | twin | occurrences |
|---|---|---|---|
| 1 | marker fn: SECDEF, pinned search_path, service_role only | post-apply `sql` GRANT to authenticated | n/a (sql step) |
| 2 | the same for the retraction | post-apply `sql` GRANT to authenticated | n/a (sql step) |
| 3 | marker keeps S, C, P and sets K | drop the left operand of the merge | 1 |
| 4 | marker on NULL, JSON null, array, string, number metadata gives exactly {K}; unknown id false | `jsonb_typeof` CASE replaced by bare `metadata` | 1 |
| 5 | retraction of each marker; NULL id writes JSON null | first marker list narrowed to `('ledger-refresh')`, `nth` 1 | 2 (nth 1) |
| 6 | non-marker rows are `no_marker`, ctid and metadata unchanged | marker predicate line replaced by `AND TRUE` | 1 |
| 7 | done rows never retracted; every other status is | `AND status <> 'done'` replaced by `AND TRUE` | 1 |
| 8 | unknown and NULL id are `no_row` | `'outcome', 'no_row'` -> `'outcome', 'no_marker'` | 1 |
| 9 | two writers, sequential, both orders equal (not concurrency) | retraction also deletes K | 1 |
| 10 | three writers, sequential, all six orders equal (not concurrency), claim-style write copied from the claim RPC's merge expression | marker also deletes U | 1 |
| 11 | control, untwinned: old read-then-replace loses R and brings S back in this harness | none | n/a |

Every `edit` twin is a byte-exact find with a measured `occurrences`; no twin changed from the plan. The two ACL twins are post-apply `sql` GRANTs as planned (an `edit` widening the GRANT would trip the migration's catalogue verify during the apply).

## Verification

- `node scripts/verify-plan-anchors.mjs` on the plan: OK (5 claims).
- Gate on the pg-lane (setup list from the plan): exit 0, `ALL 11 ARMS EXECUTED (1,2,3,4,5,6,7,8,9,10,11)`.
- Runner `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_metadata_merge.sql`: exit 2 (narrowed diagnostic). Arms 1 to 10 each `RED (identity ok)`. Final reading: `arms: 10/10/0 (executed/annotated/waived)`, `biting: 10`, `lane-invocations: 10`, `coverage: files 80/107`, `sections 10 / judged 10 / annotated 10 / waived 0 / biting 10`, `No defects in the narrowed scope`. No waiver added.
- Control arm illustrates the assertion style: a scratch copy of the gate (outside the repo) with the control's stale read moved after the retraction made the lane raise `ARM 11 FAILED (control)`. That edited the control's own text, not the code under test, so it shows the style of arms 9 and 10 can see a missing key and proves nothing about the two functions. The real file was not touched.
- `node scripts/lint-sql-gates.mjs --self-test` OK (7 rules); corpus scan `scanned 107 file(s); 0 finding(s)`. `node scripts/lint-app-guc.mjs --self-test` and corpus scan: 0 findings.
- `analytics-service/tests/test_sql_gate_scoped_updates.py`: 4 passed (the gate updates only `compute_jobs`).
- Four census test files (`lint-sql-gates`, `mutation-annotation-parser`, `drift-check-scripts`, `contracts/ci-anti-skip-gate.contract`): 1124 passed.
- Wider set (critical-regressions, sql-mutation-scope-step, sql-mutation-nightly-parity, mutation-runner-neuter, baseline-redump-wiring, local-stack-lane-wiring, vac06-mechanism-arms, contracts/*, lint-migration-data-dependence, refdata-allowlist, gate-family-meta, mutation-runner-floors): 1037 passed, 3 failed. The 3 failures are all in `mutation-runner-floors.test.ts` and are the planned stale-low ratchet: `RATCHET STALE: 80 of 107 gate files are now annotated but FILES_FLOOR is still 79`, the ARMS_FLOOR twin (`801 twin(s) ... ARMS_FLOOR is 791`) and the parser count (`expected 801 to be 791`). `gate-family-meta.test.ts` passed at this commit. Plan 04 moves `scripts/mutation-floors.mjs` after one full run.

## Census values moved (all read off the pinning test's own failure, never computed)

| census | before | after |
|---|---|---|
| ci.yml sentinel table | no row | `test_compute_job_metadata_merge.sql 11`, after the fence_errcode row |
| ci.yml `SENTINEL_FLOOR` | 26 | 27 |
| ci.yml `ARMS_FLOOR` (sum comment gets `+ 11` at the table position) | 405 | 416 |
| `drift-check-scripts.test.ts` strings and title | 26 / 405 | 27 / 416 |
| `lint-sql-gates.test.ts` `scanned N file` | 106 | 107 |
| `mutation-annotation-parser.test.ts` `armsSeen` | 791 | 801 |
| same, `stepsSeen` and `needles.length` | 888 | 896 |
| same, `corpus.filesTotal` (two sites) | 106 | 107 |
| same, `corpus.filesAnnotated` and the by-name list length | 79 | 80 |

Each moved pin carries a dated CURRENCY or Re-measured comment naming Phase 191 plan 03.

## Deviations from Plan

**1. [Rule 1 - Bug] Control arm 11 raises `ARM 11 FAILED (control)`, not `TEST FAILED (11)`**
- **Found during:** Task 3 (the census run).
- **Issue:** The plan has the control raise a `TEST FAILED (11)` identity with no twin. `mutation-annotation-parser.test.ts` ("164.4-02: every SECTION an annotated file raises for also carries a twin") counts every `TEST FAILED (N)` section and failed with `{"test_compute_job_metadata_merge.sql":["11"]}`. No migration edit can make the control the first failure, so a twin was not possible, and a waiver is forbidden.
- **Fix:** The control raises with the repo's existing `ARM x FAILED` spelling (precedent: `test_sync_status_marked_refresh_protected.sql`), which the runner deliberately does not attribute. The raise still aborts the file under `ON_ERROR_STOP`, so a blind harness fails CI loudly. The runner now reports `sections 10 / judged 10` instead of 11. The sentinel still counts 11 arms.
- **Files modified:** `supabase/tests/test_compute_job_metadata_merge.sql`. **Commit:** 056636544.

Otherwise: plan executed as written. The pg-lane prints `WARNING: SET LOCAL can only be used in transaction blocks` for the migration's first statement (psql applies it outside a transaction), as recorded in 191-02-SUMMARY.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files found: the gate, ci.yml, and the three pinning tests. Commits 510a43760, 9fa968334, 056636544 and 30020fd2d are ancestors of HEAD. `git status` is clean apart from this SUMMARY.
