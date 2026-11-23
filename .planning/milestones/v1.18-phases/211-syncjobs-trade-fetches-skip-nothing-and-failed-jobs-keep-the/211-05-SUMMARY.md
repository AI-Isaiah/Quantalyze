---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 05
subsystem: database
tags: [enqueue-dedup, sql-gate, mutation-twins, d11, compute-jobs]

requires:
  - "211-03: migration 20261114120000, the helper _record_enqueue_dedup, the side table, and the SITE-A arm"
provides:
  - "supabase/tests/test_enqueue_dedup_record_retract.sql with 15 named arms, each twinned and measured RED on its own arm"
affects: [SC-2, SC-4, plan 06]

status: complete
actuals:
  tokens: 12500
  tasks: 3
  commits: 3
plan_head_before: f5835f2dcce0e959155b471e296b7dde3f35a506
plan_head_after: 34b9988c7c839051b48e904366d46317dd1a890b

key-files:
  created: []
  modified:
    - supabase/tests/test_enqueue_dedup_record_retract.sql

key-decisions:
  - "Every arm stayed behavioural: no arm was converted to a body-text arm, including SITE-B (the forced race worked on the lane first time). BODY-PIN is body-text by design, as the plan says, because the 7-arg overload is unreachable."
  - "Arms after SITE-B call through one pg_temp helper, dd_call, that captures SQLSTATE and SQLERRM in an inner block and returns them, so every assertion and every TEST FAILED raise sits after the call and directly in the DO body"

requirements-completed: [SC-2, SC-4]
---

# Phase 211 Plan 05: The D11 SQL gate, all 15 arms Summary

**The enqueue-dedup gate now has 15 named arms in the plan's load-bearing order; the mutation runner measures `sections 15 / judged 15 / annotated 15 / waived 0 / biting 15` and every twin reddens its own arm first.**

## Accomplishments

- **Task 1 (tracer), SITE-B.** A `BEFORE INSERT` trigger in a throwaway schema (`dd_gate`: a `shots` sequence, a trigger function, a trigger `WHEN`-bound to the arm's own strategy and kind) plants a still-in-flight competitor carrying `source = ledger-refresh` on the first shot only. The call's own INSERT loses to the partial unique index, its re-read finds the competitor, and the live 10-arg overload takes the SITE B return. The arm asserts no exception, `shots = 1`, the returned id is the competitor's, the marker is retracted with the caller's `correlation_id` on the row, and one event row carries the sent object and `retracted_marker = 'ledger-refresh'`. The competitor is never flipped to `done` and the file has no after-insert trigger in executable SQL (`grep -a -v '^[[:space:]]*--' ... | grep -c 'AFTER INSERT'` prints `0`).
- **Task 2, nine predicate and guard arms.** NO-MERGE, KIND-COMPOSITE, KIND-CSV, MARKED-CALLER, NO-CORRELATION, NON-MARKER-KIND, PARENTED, EMPTY-META, OVERSIZE.
- **Task 3, four boundary arms.** FRESH-INSERT, ACL-HELPER, TABLE, BODY-PIN; header lists all 15 arms; sentinel reads `ALL 15 ARMS EXECUTED (SITE-A, SITE-B, NO-MERGE, KIND-COMPOSITE, KIND-CSV, MARKED-CALLER, NO-CORRELATION, NON-MARKER-KIND, PARENTED, EMPTY-META, OVERSIZE, FRESH-INSERT, ACL-HELPER, TABLE, BODY-PIN): ...`; a header note says D11-2's "a done row is never rewritten" is enforced inside the reused `retract_ledger_refresh_marker` and pinned by arm 7 of `test_compute_job_metadata_merge.sql`.

## The 15 arms in file order, with each twin

| # | Arm | Twin kind | What the twin does |
|---|---|---|---|
| 1 | SITE-A | edit | delete the 10-arg SITE A call line (plan 03) |
| 2 | SITE-B | edit | delete the 10-arg SITE B call line |
| 3 | NO-MERGE | insert-after | add `UPDATE compute_jobs SET metadata = metadata \|\| p_metadata` after `v_bytes := ...` |
| 4 | KIND-COMPOSITE | edit | drop `'stitch_composite'` from the kind list |
| 5 | KIND-CSV | edit | drop `'compute_analytics_from_csv'` from the kind list |
| 6 | MARKED-CALLER | edit | replace the `AND NOT COALESCE(...)` conjunct with `AND TRUE` |
| 7 | NO-CORRELATION | edit | delete the `correlation_id IS NOT NULL` conjunct |
| 8 | NON-MARKER-KIND | edit | add `'process_key_long'` to the kind list |
| 9 | PARENTED | edit | delete the parent-skip clause |
| 10 | EMPTY-META | edit | delete the `p_metadata = '{}'::jsonb` clause |
| 11 | OVERSIZE | edit | replace the oversize `CASE` with plain `p_metadata` |
| 12 | FRESH-INSERT | insert-after (`nth` 2 of 2) | add the helper call after the 10-arg fresh-insert `IF v_new_id IS NOT NULL THEN` |
| 13 | ACL-HELPER | post-apply `sql` | `GRANT EXECUTE ... _record_enqueue_dedup(...) TO authenticated` |
| 14 | TABLE | post-apply `sql` | `GRANT SELECT ON compute_job_dedup_events TO authenticated` |
| 15 | BODY-PIN | edit | delete the `SITE A (7-arg)` call line |

No arm was converted to a body-text arm. BODY-PIN is a body-text arm by design.

## Neuter, RED, restore evidence

Per-file runner line (subset run, final tree): `file test_enqueue_dedup_record_retract.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15`, then `No defects in the SUBSET: every annotated arm of these 1 of 82 annotated files bit its own arm first.` Every arm printed `RED (identity ok)`. The runner restores the migration copy after each arm and its baseline and restore legs both exited 0. Progress at each task: after Task 1 `annotated 2 / waived 0 / biting 2`; after Task 2 `annotated 11 / waived 0 / biting 11`; after Task 3 the line above.

Beyond the runner's identity check, I applied each of the 13 new twins by hand to a scratch copy of the migration and read the first failure line, to confirm each reddens for the intended reason and not for an incidental one. Examples: NO-MERGE reports the merged `{"flow_type": "onboard", "correlation_id": "c-nomerge", "verification_id": "v-second"}` row; NO-CORRELATION reports `"correlation_id": null` with the composite marker retracted; EMPTY-META reports 1 event for NULL/empty/non-object metadata; OVERSIZE reports SQLSTATE 23514 on `compute_job_dedup_events_caller_metadata_size_chk`; FRESH-INSERT reports 1 event row for a job the call inserted itself; ACL-HELPER reports `authenticated can EXECUTE _record_enqueue_dedup`; TABLE reports `authenticated:SELECT`; BODY-PIN reports the 7-arg call count at 1. (The scratch driver is outside the repo; the migration file was never modified, `cmp` against `HEAD` is identical.)

Order check: the SITE-A, SITE-B and FRESH-INSERT twins change the 10-arg call count that BODY-PIN reads, and each is first-failure on its own arm under the runner, so the order rule held with no reordering needed.

## Verification

- Lane (pg-lane, throwaway cluster): `ALL 15 ARMS EXECUTED (...)` on one line with `RAISE NOTICE`; exit 0; no `TEST FAILED`, no `ERROR:`.
- `node scripts/lint-sql-gates.mjs --self-test`: `7 rules, red+green each`. `node scripts/lint-sql-gates.mjs`: `scanned 109 file(s); 0 finding(s)`. `node scripts/lint-app-guc.mjs --self-test` and `node scripts/lint-app-guc.mjs`: `findings 0`.
- Acceptance greps: `grep -c -a 'TEST FAILED (SITE-B)'` = 10 (>= 1); the nine Task 2 arm names total 43 raises (>= 9); `RED-UNDER-M: {"arm":"` lines = 15 on the final file (11 after Task 2); `ALL 15 ARMS EXECUTED` count = 1.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 8 claims, before any edit.

## For plan 06 (census numbers, measured on this tree)

`node scripts/mutation-runner/run.mjs --parse-only`:
- `coverage: files 82/109`
- `arms: 0/845/0   (executed/annotated/waived)` (parse-only executes none; 845 annotated-unwaived, up from 832 when the file carried 2 arms, so the file contributes 15)
- `pending: 0`

`lint-sql-gates` scanned 109 files (the plan 03 move from 108 already happened; this plan adds no file). These counts are for this branch's base; plan 06 re-measures after any `origin/main` gate lands.

Censuses are untouched here, as the plan requires. They stay red until plan 06 (mutation-runner-floors, mutation-annotation-parser, lint-sql-gates test, ci-anti-skip-gate contract).

## Deviations from Plan

**1. [Tooling, not a defect] A pg_temp helper, `dd_call`, carries every call after SITE-B.** The plan says each call sits "inside an inner `BEGIN ... EXCEPTION WHEN OTHERS` block that only captures SQLSTATE and SQLERRM"; the helper is exactly that block, factored once, with the `SET LOCAL ROLE service_role` / `RESET ROLE` pair inside it. It raises no arm identity, so the identity rule and lint R1 hold (lint is clean). SITE-A and SITE-B keep their inline form.

**2. [Header text] "The file creates no table" now reads that SITE-B creates a throwaway schema.** That is the induction object the plan asks for; it dies with the ROLLBACK.

**3. [Process slip, fixed before commit] Backticked prose in an unquoted shell heredoc was command-substituted,** which stripped `_resume_duplicate_job` and `ledger-refresh-composite` from two header lines. Caught by the shell's "command not found" output, restored by hand, committed text verified.

No migration defect was found: every one of the 15 arms is green on the unmodified migration, so no migration edit, no `schema:functions` regeneration, no VAC-04 pragma re-measurement and no rollback re-check were needed. The migration file is byte-identical to its HEAD.

## Not run

- **Local-stack lane (Docker Supabase, `sql-tests`):** not attempted (host disk). The file uses no dblink and no psql meta-command and creates its schema inside its own transaction, so it is written for both lanes, but this gate has no local-stack reading from me. CI `sql-tests` is authoritative.
- **Full-corpus `sql-mutation`:** only the subset gate for this file was run. The full run belongs to CI and plan 06.
- The ten-gate pg-lane recipe from plan 03 was not re-run because the migration did not change.

## Known Stubs

None.

## Threat Flags

None. The only added objects are a test file and, inside its rolled-back transaction, a throwaway schema; no new endpoint, auth path or schema at a trust boundary.

## Self-Check: PASSED

- FOUND: supabase/tests/test_enqueue_dedup_record_retract.sql
- FOUND commits: ac87af454, 79035f6bd, 34b9988c7 (ancestors of HEAD)
