---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 13
subsystem: database-grants
tags: [api-keys, venue-server, column-grant, rls, mutation-gate, conn-03, pr-2b-1]
requires:
  - phase: 225-01
    provides: api_keys.venue_server column and gate arm 6v-no-grant (migration 20261123180000)
provides:
  - authenticated holds SELECT on api_keys.venue_server (owner-only through the existing RLS)
  - gate arm 6v-owner-read, and 6v-no-grant narrowed to browser write and anon
affects: [225-14, 225-15, 225-16, 225-17]
tech-stack:
  added: []
  patterns: [catalogue-only self-verify, column grant shipped ahead of the code that selects it]
key-files:
  created:
    - supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql
    - supabase/migrations/down/20261125132334-rollback.sql
  modified:
    - supabase/tests/test_api_keys_venue_identity_uniq.sql
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
key-decisions:
  - "Task 1 answer (blocking checkpoint, answered before execution): founder chose option (a) on 2026-11-25, verbatim \"Owner-only read (Recommended)\", recorded in 225-CONTEXT.md Q6. Grant SELECT (venue_server) to authenticated, owner-only through the existing RLS, the same way venue_account_id was granted by 20260920120000. Options (b) the SECURITY DEFINER RPC and (c) the digest column were not taken."
  - "Plan 01's no-grant posture (RESEARCH F-4 'no UI reads it') is reversed by that answer; CONTEXT Q2 still says only that the server is plaintext and not a credential."
  - "Migration name 20261125132334 (UTC time at creation, later than origin/main's tip 20261124120700). The placeholder 20261125150000 never reached the tree: every file was written under the real name."
requirements-completed: [CONN-03]
status: complete
actuals:
  tokens: 14000
  tasks: 3
  commits: 2
plan_head_before: 3df6b33511bb9175b718ad9b893c3a2715a82215
plan_head_after: f4587ccb84f3320abd1d38a3a5a6fe3778e52271
---

# Phase 225 Plan 13: the owner may read api_keys.venue_server (PR-2b-1) Summary

One column grant, `GRANT SELECT (venue_server) ON public.api_keys TO authenticated`, so the TypeScript identity twin can read the broker server the way it reads `venue_account_id`; the column grant is owner-scoped by the existing RLS, no browser role gains a write, and anon gains nothing.

## Task 1 answer (decision checkpoint, recorded verbatim)

Founder, 2026-11-25: **"Owner-only read (Recommended)"** (225-CONTEXT.md Q6), which is option (a). The orchestrator relayed it with the dispatch, so the checkpoint was not returned. Tasks 2 and 3 ran on that answer.

## What changed

- **Migration** `supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql`: `SET LOCAL lock_timeout = '3s'`, the one GRANT, the column COMMENT re-issued with plan 01's text minus its last sentence (now: owner may read through the column grant and RLS, anon holds nothing, no browser role may write it), and a `pg_catalog`-only self-verify (authenticated SELECT true; authenticated INSERT and UPDATE false; anon SELECT, INSERT and UPDATE false). It reads no table row, so the TEST apply cannot refuse. No explicit transaction statements. The only `TO anon` text is in comments (`grep -a -v '^ *--' ... | grep -a -c -i "TO anon"` prints 0).
- **Rollback** `supabase/migrations/down/20261125132334-rollback.sql`: marker query first in the header, `BEGIN; ... COMMIT;` carried in the file, `REVOKE SELECT (venue_server) ON public.api_keys FROM authenticated;`, plan 01's COMMENT restored verbatim, catalogue-only verify. It warns to roll the readers back first (42501 otherwise).
- **Gate** `supabase/tests/test_api_keys_venue_identity_uniq.sql`: the new migration is the LAST entry of the RED-UNDER-SETUP apply list; new arm `6v-owner-read` (authenticated SELECT must be true, twin `REVOKE SELECT (venue_server) ON public.api_keys FROM authenticated`) sits directly before `6v-no-grant`; `6v-no-grant` keeps its id but now asserts no authenticated INSERT or UPDATE and nothing for anon (twin `GRANT UPDATE (venue_server) ON public.api_keys TO authenticated`); the final PASS NOTICE clause is rewritten. Synthetic values only.
- **Census** moved in one commit (below).

## Measured, verbatim

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_keys_venue_identity_uniq.sql`, exit 2 (by design for a diagnostic run):

```
  baseline  supabase/tests/test_api_keys_venue_identity_uniq.sql — exit 0 (8.7s)
  arm 6v-owner-read            exit   3  RED (identity ok)  (4.6s)
  arm 6v-no-grant              exit   3  RED (identity ok)  (5.0s)
  restore   supabase/tests/test_api_keys_venue_identity_uniq.sql — exit 0 (4.7s)
coverage: files 93/120
lane-blocked: 0 file(s) probe pg_extension for pg_cron and are not yet annotated — (none; ...)
  pending: 0 idiom file(s) without RED-UNDER — 
arms: 15/15/0   (executed/annotated/waived)
biting: 15   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 15   (arm lanes actually spawned — tallied inside runLane, independent of the 15 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_api_keys_venue_identity_uniq.sql: sections 13 / judged 15 / annotated 15 / waived 0 / biting 15
No defects in the narrowed scope.
```

All 15 arms printed `RED (identity ok)`. Other checks:

- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 93/120`, `arms: 0/1021/0   (executed/annotated/waived)`, `✅ No static defects. Every prose marker has a twin and every needle still matches.`
- `node scripts/lint-sql-gates.mjs`: `lint-sql-gates: scanned 120 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`
- `node scripts/lint-migration-data-dependence.mjs`: `lint-migration-data-dependence: corpus 337 migration(s), 419 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
- `npm run schema:functions:check`: `SQL function snapshot is current (142 functions).`

## Census values moved (each read off a failing test or the parse-only run, not summed)

| Site | Before | After |
|---|---|---|
| `ARMS_FLOOR` (scripts/mutation-floors.mjs, dated RAISED note quoting the parse-only line) | 1020 | 1021 |
| `FILES_FLOOR` | 93 | 93 (no gate file added) |
| `WAIVED_CEILING` | 0 | 0 |
| gate-family-meta `KNOWN_THRESHOLD_SITES` entry `ARMS_FLOOR=` | 1020 | 1021 |
| mutation-runner-floors `totalAnchored` | 1020 | 1021 |
| mutation-runner-floors synthetic FULL log (arms, biting, lane-invocations, mean line, derived offsets 1019/1021 -> 1020/1022) | 1020 | 1021 |
| mutation-runner-floors per-file row for test_api_keys_venue_identity_uniq.sql | sections 12 / judged 14 / annotated 14 / biting 14 | sections 13 / judged 15 / annotated 15 / biting 15 |
| mutation-annotation-parser `armsSeen` | 1020 | 1021 |
| mutation-annotation-parser `stepsSeen`, `needles.length` | 1171 | 1171 (the new twins are `sql` steps, so the file-step walk is unchanged) |

## Test runs

- `gate-family-meta.test.ts` 21 passed; `lint-sql-gates.test.ts` 74 passed; `sec-005-api-keys-projection.test.ts` passed (it still asserts the browser allowlist does not contain `venue_server`, which stays true until plan 15).
- `mutation-runner-floors.test.ts` and `mutation-annotation-parser.test.ts` pass in full except for TIMEOUTS under host load (load average about 180 from other agents): three runner-floors tests (a 30 s real-corpus spawn and two 5 s default-timeout tests) and the parser's REAL CORPUS test (hard-coded `30_000`). Each passed when re-run alone with a raised `--testTimeout`; the parser test, whose timeout is hard-coded, passed from a throwaway copy with the timeout raised to 600 s (the copy was deleted, nothing committed). No assertion failure remained. CI's unloaded runners are the authoritative run.

## Deviations from Plan

None in code. Process notes:

- **Branch name vs the pre-commit allow-list.** The worktree branch is `gsd/phase-225-pr2b-1`, not `agent-*`; I treated it as the orchestrator-designated sequential tree (the dispatch named the branch) and committed there. HEAD was never on a protected branch.
- **Task 1 not returned as a checkpoint**, by the dispatcher's instruction (answer already recorded in CONTEXT Q6).
- `sec-005-api-keys-projection.test.ts` lines 195-198 still say the migration "grants it to nobody". That comment is stale after this plan; it is outside this plan's file list and plan 15 (which adds the column to the roster) owns it.

## Ship notes (for the PR-2b-1 orchestrator)

- CHANGELOG entry (written at ship, same commit as the VERSION bump): the owner can now read the broker server column; plan 01's no-grant posture was reversed by the founder's "Owner-only read (Recommended)" answer. This ships alone: the code selecting the column (plans 14-17) merges only after PROD has applied the grant.
- `git diff --name-only origin/main...HEAD | grep -c '^.planning/'` prints 18 on this work branch before this SUMMARY (the phase plans and CONTEXT copied in its first commit); the PR-2b-1 branch is cut through the `-pr` filter and must print 0.
- Before merge: migration-reviewer and rls-policy-auditor at MEDIUM+, no other open PR touching `supabase/migrations`. After merge: read `has_column_privilege` for authenticated and anon on PROD (marker query first, read-only). No `supabase db push`.
- Migration B `20261125083433` becomes older than the PROD tip once this applies and is renamed in PR-3 (plan 19).

## Known Stubs

None.

## Threat Flags

None. The grant is the surface T-225-39 already covers; T-225-40 (no browser write) is pinned by the self-verify and `6v-no-grant`; T-225-42 (no data-reading guard) by the linter run.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql
- FOUND: supabase/migrations/down/20261125132334-rollback.sql
- FOUND commits 93496484a and f4587ccb8 (ancestors of HEAD)
