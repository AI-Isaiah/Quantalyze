---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 17
subsystem: database / SQL gates
tags: [commit_scenario_batch, fingerprint, mutation-runner, retarget, CONN-03]
requires: [225-16]
provides:
  - the eight fingerprint twins (sameday_empty x6, unpriced x2) edit the live venue-server-identity body
affects: [225-19]
key-files:
  created: []
  modified:
    - supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql
    - supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql
key-decisions:
  - "The two drift scripts needed no change: the expected commit_scenario_batch/5 DRIFT row cleared through a baseline re-dump (#1350), never an allowlist row."
status: complete
written_from: "the shipped diff of PR #1348 (merge 2636fb1e5, v0.133.79.0); no executor SUMMARY was written at execution time"
completed: 2026-11-25
---

# Phase 225 Plan 17: fingerprint twins retargeted (PR-2b-2) Summary

Plan 17's code shipped inside PR-2b-2 (#1348, squash `2636fb1e5`, v0.133.79.0, merged 2026-11-25) as commit `test(225-17): the eight fingerprint twins edit the venue-server-identity body that is live`. This SUMMARY was written on 2026-11-26 from that shipped diff, because no SUMMARY was written when the plan ran.

## Task 1: the eight twins bite against the new body (shipped)

Read from `git show 2636fb1e5 -- supabase/tests/test_commit_scenario_batch_fingerprint_*.sql`:

- `test_commit_scenario_batch_fingerprint_sameday_empty.sql`: all six `RED-UNDER-M` twins (`sameday-empty-dropped`, `sameday-nonempty-kept`, `later-warnings-poll-kept`, `warnings-empty-kept`, `older-empty-day-kept`, `sameday-empty-sibling-older`) now edit `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql`. Their `find` and `replace` strings are unchanged.
- `test_commit_scenario_batch_fingerprint_unpriced.sql`: both twins (`unpriced-dropped`, `older-marker-ignored`; three edit steps) moved the same way.
- Both `RED-UNDER-SETUP` lists gained `20261123180000_api_keys_venue_server.sql` and then `20261125151936_commit_scenario_batch_venue_server_identity.sql`, in filename order after `20261027120000`. The two optional wizard-RPC migrations the plan named as a possible addition were NOT added, so the lane did not need them.
- Each file got one dated `RETARGETED 2026-11-25 by Phase 225 plan 17` header note.
- Arms and steps are unchanged, so no census moved for this plan. Plan 16's census move (FILES_FLOOR 93 -> 94, ARMS_FLOOR 1021 -> 1033) is in the same PR and recorded in 225-16-SUMMARY.md.

Plan 16 had already checked the occurrence precondition for these nine steps against the new migration (`steps checked 9 bad 0`, 225-16-SUMMARY.md "Handed to plan 17"). PR #1348's CI, which runs `sql-mutation` and `sql-tests`, was green at merge.

## Task 2: the expected baseline drift (no file change)

`git show --stat 2636fb1e5` touches neither `scripts/baseline-content-drift-check.mjs` nor `scripts/dump-sql-functions.ts`. No allowlist row was added. The expected `DRIFT commit_scenario_batch/5` row (quoted verbatim in 225-16-SUMMARY.md) cleared through the house route instead: `chore(release): v0.133.79.1 — baseline re-dump after the PROD apply of 2636fb1e (#1350)` (`db51435e2`) regenerated `supabase/schema/baseline.sql`, `BASELINE.md` and `baseline-carried-migrations.txt`.

## Task 3: the pre-merge PROD read (not recorded)

No record of the pre-merge read-only PROD pass (plan 13's grant applied, zero owner/exchange/login groups with two or more servers, zero ambiguous keys) exists in this phase directory, ROADMAP or STATE. It cannot be reconstructed after the fact. The same counts are re-measured on PROD before PR-3 (plan 19 Task 3, steps 4 and 5) and recorded in 225-19-SUMMARY.md.

## Deviations from Plan

- The SUMMARY was written after the ship, from the diff, by the phase orchestrator.
- Task 3's record is missing (above).

## Self-Check: PASSED

- FOUND in `origin/main`: both gate files name `20261125151936_commit_scenario_batch_venue_server_identity.sql`; no twin in either file still names `20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql` as its `file`.
