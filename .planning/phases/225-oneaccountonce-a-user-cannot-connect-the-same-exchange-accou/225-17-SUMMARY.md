---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 17
subsystem: database
tags: [mutation-runner, sql-gate, commit_scenario_batch, venue_server, baseline-drift, deploy-skew, CONN-03]
requires: [225-16]
provides:
  - the eight existing fingerprint twins edit plan 16's migration (the body that is live)
  - the expected baseline-content DRIFT row for commit_scenario_batch/5 recorded verbatim, not allowlisted
affects: []
tech-stack:
  added: []
  patterns: [retarget a gate's apply list and edit twins to the newest definition of the function, as the unpriced gate did for 20261027120000]
key-files:
  created: []
  modified:
    - supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql
    - supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql
key-decisions:
  - "Task 2 needs no edit to scripts/baseline-content-drift-check.mjs or scripts/dump-sql-functions.ts: no function joined or left the compared set, so COMPARED_FLOOR and NAME_SET_RATCHET do not move; the DRIFT row clears at the next baseline re-dump"
requirements-completed: []
status: partial
commits: 1
plan_head_before: bb4449c5a51a2527f67a7b7c2fd966d599716752
plan_head_after: 826b2a4cd2d08451b203bc9e4230f84e04170717
actuals:
  tokens: 5600
  tasks: 2
  commits: 1
---

# Phase 225 Plan 17: re-point the fingerprint twins, record the drift, gate the merge Summary

Status is partial on purpose: Tasks 1 and 2 are done; Task 3 (the read-only PROD check immediately before PR-2b-2 merges) belongs to the orchestrator and is pending.

## What was built

- **Task 1 (tracer), commit `826b2a4cd`.** In `test_commit_scenario_batch_fingerprint_sameday_empty.sql` (6 twins) and `test_commit_scenario_batch_fingerprint_unpriced.sql` (2 twins, 3 edit steps: `unpriced-dropped` has two steps) every `edit` step now targets `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql`. Each file's `RED-UNDER-SETUP` list gained `20261123180000_api_keys_venue_server.sql` and `20261125151936_commit_scenario_batch_venue_server_identity.sql`, appended after `20261027120000` in filename order. Find strings are untouched, and plan 16 had already verified each occurs once in the new migration (`steps checked 9 bad 0`); the runner's own occurrence check in `--file` mode agrees (every arm applied and went RED). Each gate carries a dated `RETARGETED 2026-11-25` header note saying why.
- **Task 2: no file change.** `COMPARED_FLOOR` and `NAME_SET_RATCHET` do not move (0 SNAPSHOT_MISSING, 0 SNAPSHOT_ONLY, 144 functions compared as before), and no allowlist row was added. The drift row is recorded here, verbatim below.

## Runner lines (measured at HEAD `826b2a4cd`, verbatim)

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql` (exit 2 by design):

```
  baseline  supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql — exit 0 (4.1s)
  arm sameday-empty-dropped    exit   3  RED (identity ok)  (4.7s)
  arm sameday-nonempty-kept    exit   3  RED (identity ok)  (4.4s)
  arm later-warnings-poll-kept exit   3  RED (identity ok)  (4.6s)
  arm warnings-empty-kept      exit   3  RED (identity ok)  (4.3s)
  arm older-empty-day-kept     exit   3  RED (identity ok)  (3.8s)
  arm sameday-empty-sibling-older exit   3  RED (identity ok)  (3.9s)
  restore   supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql — exit 0 (3.8s)
arms: 6/6/0   (executed/annotated/waived)
biting: 6   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 6   (arm lanes actually spawned — tallied inside runLane, independent of the 6 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_commit_scenario_batch_fingerprint_sameday_empty.sql: sections 6 / judged 6 / annotated 6 / waived 0 / biting 6
No defects in the narrowed scope.
```

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql` (exit 2 by design):

```
  baseline  supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql — exit 0 (4.0s)
  arm unpriced-dropped         exit   3  RED (identity ok)  (3.9s)
  arm older-marker-ignored     exit   3  RED (identity ok)  (4.0s)
  restore   supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql — exit 0 (3.8s)
arms: 2/2/0   (executed/annotated/waived)
biting: 2   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 2   (arm lanes actually spawned — tallied inside runLane, independent of the 2 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_commit_scenario_batch_fingerprint_unpriced.sql: sections 2 / judged 2 / annotated 2 / waived 0 / biting 2
No defects in the narrowed scope.
```

Other checks at HEAD:

- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 94/121`, `arms: 0/1033/0   (executed/annotated/waived)`, `No static defects. Every prose marker has a twin and every needle still matches.` Census unchanged (1033 arms, 94 files; WAIVED_CEILING stays 0, no floors file touched).
- `node scripts/lint-sql-gates.mjs`: `lint-sql-gates: scanned 121 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`
- vitest (`mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `lint-sql-gates`, and the three fingerprint parity tests): `Test Files 7 passed (7)`, `Tests 361 passed (361)`.
- `npm run schema:functions:check`: `SQL function snapshot is current (142 functions).` and `DRIFT-05 gate (a): baseline 142 name(s) vs migration-replay 142 name(s) — agree, with 0 ratcheted disagreement(s) carried.`
- Acceptance greps: `"kind":"edit","file":"supabase/migrations/20261027120000` count 0 in both files; `_commit_scenario_batch_venue_server_identity.sql` lines in the unpriced gate: 3 (>= 3); added lines matching `allowlist` in `git diff origin/main -- scripts/baseline-content-drift-check.mjs`: 0.
- A1 (`test_api_keys_venue_identity_uniq.sql`) catalogue self-verify: baseline legs exit 0 without the two wizard migrations, so they were not added (same measurement as plan 16, deviation 3).

## baseline-content-drift-check (verbatim)

`node scripts/baseline-content-drift-check.mjs` (exit 1 by design until a baseline re-dump):

```
::error file=supabase/schema/functions/commit_scenario_batch.sql,line=0::content-drift — DRIFT commit_scenario_batch/5 snapshot=7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891 chain=68469a606dfbb3aa57503948b08ad3cf0b9295456981e3b04753a4854a6b0e3a differing-lines=32 — the committed supabase/schema/baseline.sql disagrees with the migration chain for `commit_scenario_batch`, and no CONTENT_DRIFT_ALLOWLIST row pins this disagreement.
baseline-content-drift: chain files 142 (supabase/schema/functions/*.sql, sorted)
baseline-content-drift: functions compared 144 — MATCH 140, DRIFT 4, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 1
```

The one finding is the expected `commit_scenario_batch/5` row (baseline = the 20261027120000 body `7a9444d3…`, chain = plan 16's body `68469a60…`). It is not allowlisted and clears when `supabase/schema/baseline.sql` is re-dumped from PROD after the apply (a separate reviewed act that also moves the sha256 in `supabase/schema/BASELINE.md`). `node scripts/baseline-content-drift-check.mjs --self-test`: `baseline-content-drift self-test OK: 41 assertions across 4 finding kinds ...` (exit 0).

## Task 3: PROD before PR-2b-2 — PENDING (orchestrator)

Not attempted by the executor (no PROD access). The orchestrator reads, read-only through the PROD Supabase MCP, one query per call, never chained, immediately before PR-2b-2 merges (preconditions: PR-2b-1 merged with its PROD apply successful; PR-2b-2 open with CI green on the head SHA including VAC-04):

1. `docs/runbooks/oneaccountonce/marker.sql`: answer must name PROD; STOP on NULL or a non-PROD answer.
2. Grant: `has_column_privilege('authenticated','public.api_keys','venue_server','SELECT')` must be true; the same for `anon` must be false. Else STOP.
3. Multi-server groups over ALL `api_keys` rows (live and disconnected): count `(user_id, lower(btrim(exchange)), btrim(venue_account_id))` groups with a non-blank `venue_account_id` and `count(DISTINCT venue_server)` (NULL not counted) of 2 or more. Expect 0.
4. Ambiguous keys: count keys with a non-blank `venue_account_id`, `venue_server` NULL, inside a group from step 3. Expect 0.
5. VAC-04: the PR's `migration-drift-check.yml` log for `commit_scenario_batch/5`; the live hash must equal plan 16's prod-body-ack `7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891`. If it differs, STOP: plan 16 folds the difference into its migration and re-derives the ack; never edit the pragma to match a log.
6. 155.2 freeze, on main: `ls .planning/phases/155.2-*/155.2-12-SUMMARY.md .planning/phases/155.2-*/155.2-14-SUMMARY.md`. Plan 12's SUMMARY present and plan 14's absent means the freeze is active: STOP and report to the founder.
7. Record under "PROD before PR-2b-2" here, as counts and booleans only (no ids, logins, servers or emails; public repo): marker answer (names PROD), grant true / anon false, step 3 count, step 4 count, VAC-04 hash match, the two freeze-file existence answers. A nonzero count in step 3 or 4 is not a code failure; report it to the founder and wait for a go before merging.

Resume signal: `PROD ok: grant, 0, 0, vac04, freeze open`, or the step that stopped.

### PROD before PR-2b-2

Pending. To be filled by the orchestrator.

## Deviations from Plan

None - plan executed as written for Tasks 1 and 2. Notes:

- The `agent-*` commit-time allow-list was not applied: the branch is `gsd/phase-225-pr2b-2`, a caller-designated plan worktree (HEAD attached, not protected), as in plans 14 to 16.
- Per the caller: `STATE.md` and `ROADMAP.md` were not edited, no `state.*`, `roadmap.*` or requirements handler ran, nothing was pushed, no PR was opened. No Co-Authored-By, Claude-Session or "Generated with" trailers were written (the caller's rule and the founder's standing rule override the harness attribution reminder).
- Ship guard: this SUMMARY is a records-side file; it never ships in PR-2b-2. `git diff --name-only origin/main...HEAD | grep -c '^.planning/'` must print 0 on the `-pr` filtered branch before the push.

## Known Stubs

None.

## Threat Flags

None. Test files and a records file only; T-225-55 is mitigated (every twin re-pointed, runner shows each arm biting); T-225-56 and T-225-57 are carried by Task 3, pending.

## Docker and local stacks

None started by this plan. The pg-lane's throwaway cluster is removed by its own EXIT trap. (A Docker Desktop app and a postgres launcher from 12:23PM were already running before this plan and are not this plan's.)

## Self-Check: PASSED

- Commit `826b2a4cd` is an ancestor of HEAD; both gate files are modified and committed.
- Acceptance greps listed above hold. Task 3 is explicitly pending, not claimed.
