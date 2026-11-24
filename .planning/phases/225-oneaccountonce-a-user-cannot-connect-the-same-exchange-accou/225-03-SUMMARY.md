---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 03
subsystem: database
tags: [postgres, sql-gate, mutation-gate, wizard-rpc, conn-03]
requires: [225-01]
provides:
  - "no SQL gate under supabase/tests pins the 12-type create_wizard_strategy signature"
  - "each of the three pinning gates applies migration 20261123180000 in its own RED-UNDER-SETUP"
affects: [225-04]
key-files:
  modified:
    - supabase/tests/test_api_keys_exchange_not_user_writable.sql
    - supabase/tests/test_wizard_session_idempotency.sql
    - supabase/tests/test_wizard_composite_fence.sql
key-decisions:
  - "Twins 3f and Part 4a were retargeted from migration 20260814120000 to 20261123180000 (A1 now owns the live function body)"
requirements-completed: [CONN-03]
status: complete
commits: 2
plan_head_before: 6a1084ad5
plan_head_after: 2d9a2760b
estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 2
  confidence: low
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
metrics:
  completed: 2026-11-23
---

# Phase 225 Plan 03: move the remaining 12-type pins to the 13-type create_wizard_strategy Summary

**Three SQL gates now pin the 13-parameter `create_wizard_strategy` and apply A1 on their lane; `grep -a -rlc "integer,text,uuid,text)" supabase/tests | wc -l` prints 0, and every arm in all three files still bites (4/4/0, 1/1/0, 5/5/0, no waiver, no census move).**

## What changed

- `test_api_keys_exchange_not_user_writable.sql`: `v_create_sig` (shared by assertions 5d and 5h) and the two 5h REMEDY strings moved to the 13-type text; A1 appended to `RED-UNDER-SETUP`; arity comment corrected.
- `test_wizard_session_idempotency.sql`: four `has_function_privilege` pins moved; A1 appended.
- `test_wizard_composite_fence.sql`: six pins (including the Part 3a-2b twin `sql` step and its message) moved; A1 appended; stale arity comment corrected. `add_wizard_composite_key` keeps its 11-type signature (composites out of scope, ruling F-2).

## Deviations from Plan

**1. [Rule 1 - Bug] Two twins stopped biting once A1 was applied on the lane**
- **Found during:** Task 2 (first `--file` runs: `3f exit 0 NO-RED`, `Part 4a exit 0 NO-RED`, `❌ 1 defect(s)` in each file)
- **Issue:** the twins edited the `create_wizard_strategy` body inside migration `20260814120000`. A1 (`20261123180000`) is applied after it and re-creates the function, so the edit no longer reached the live function.
- **Fix:** retargeted each twin's `file` to A1. 3f: one edit adding `v_auth_uid UUID;` to A1's DECLARE (the second step, which stood the older migration's e2 body grep down, has no target since A1's verify is catalogue-only). Part 4a: same find/replace (`v_key_id` to `NULL` in the strategies INSERT), now against A1's body (one occurrence). Dated prose note added under each `RED-UNDER`. The plan said "change nothing else"; this was the minimum to keep "no arm lost, none waived".
- **Files modified:** `test_wizard_session_idempotency.sql`, `test_wizard_composite_fence.sql`
- **Commit:** `2d9a2760b`

**2. [Rule 3 - stale comments]** Two arity comments (`12 args and 11 args`, `ELEVEN positional args against the 12-arg signature`) updated to the 13-arg facts; comment-only.

## Runner records (verbatim, after the final edit)

`test_api_keys_exchange_not_user_writable.sql` (exit 2, "No defects in the narrowed scope."):
```
  baseline ... exit 0
  arm 1 / arm 4 / arm 5b / arm 5c scrub half: all exit 3  RED (identity ok)
  restore  ... exit 0
arms: 4/4/0   (executed/annotated/waived)
biting: 4
lane-invocations: 4
```
`test_wizard_session_idempotency.sql` (exit 2):
```
  arm 3f                       exit   3  RED (identity ok)
arms: 1/1/0   (executed/annotated/waived)
biting: 1
lane-invocations: 1
```
`test_wizard_composite_fence.sql` (exit 2):
```
  arm Part 3a-2b / Part 3a / Part 1b / Part 2a / Part 4a: all exit 3  RED (identity ok)
arms: 5/5/0   (executed/annotated/waived)
biting: 5
lane-invocations: 5
```
Static: `lint-sql-gates: scanned 112 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` and `--parse-only`: `arms: 0/914/0`, `No static defects.` (914 unchanged, so no ARMS_FLOOR or census move is owed by this plan).

## PROOF-01

- Arms 1, 4, 5b, 5c, 3f and Part 3a-2b/3a/1b/2a/4a: the runner's twins are the neuters; each is `RED (identity ok)`, the runner restores the pristine file (`restore ... exit 0`) and each next run's baseline is GREEN (above).
- Before the retarget, 3f and Part 4a read `NO-RED` (the defect that drove deviation 1), proving the arms can fail and that the unretargeted twin was vacuous.
- Assertion 5h has no twin of its own and shares `v_create_sig` with 5d, so 5d would mask it. Proven by neuter with byte backup: `cp` backup; edit lines 685 and 689 (5d's two ACL checks) to `IF FALSE AND ...`; run the unchanged gate on the pg-lane (apply list from the file's `RED-UNDER-SETUP`) with a post-apply ACL change on the 13-type signature:
  - `GRANT EXECUTE ... TO authenticated` -> exit 3, `CONNECT-01 REGRESSION (5h): authenticated holds EXECUTE on create_wizard_strategy`
  - `REVOKE EXECUTE ... FROM service_role` -> exit 3, `OUTAGE (5h): service_role lacks EXECUTE on create_wizard_strategy`
  - restore: `cp backup file; cmp` -> `CMP_CLEAN`, `git diff` on the file empty; pristine file with no post-apply: exit 0 (GREEN).
  Without the 5d neuter the same two changes already fail at 5d (`REGRESSION (5d)`, `OUTAGE (5d)`), on the 13-type function.

## Notes for the orchestrator

- No floor or census move is needed from this plan (annotated arm total still 914).
- No new stubs, no new threat surface (T-225-09 mitigated: ACL arms keep biting on the 13-type signature).

## Self-Check: PASSED

Files edited exist; commits `1de301b3a` and `2d9a2760b` are ancestors of HEAD; `grep -a -rlc "integer,text,uuid,text)" supabase/tests | wc -l` = 0.
