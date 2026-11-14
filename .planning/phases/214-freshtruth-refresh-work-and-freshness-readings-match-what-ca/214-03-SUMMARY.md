---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 03
subsystem: supabase
tags: [sql, fan-out, ledger-refresh, cooldown, no-advance, mutation-gate, security-definer]
requires: ["214-02"]
provides:
  - "public.enqueue_ledger_refresh_for_strategies re-based: a no-advance strategy gets a 7-day attempt cooldown, never an exclusion (SC-2, first half)"
  - "arms NA1-NA4 with RED-UNDER-M twins; every pre-existing twin re-pointed to the new migration"
  - "manual rollback restoring the 20261030120000 body, proven on the lane"
affects: [214-06, 214-07]
tech-stack:
  added: []
  patterns: ["forward CREATE OR REPLACE FUNCTION re-based on the latest body", "OR spliced after the existence subquery close paren", "matched-pair arms with a twin per conjunct", "DROP-free rollback restoring the prior body verbatim"]
key-files:
  created:
    - supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql
    - supabase/migrations/down/20261114152300-rollback.sql
  modified:
    - supabase/tests/test_ledger_refresh_fanout.sql
    - analytics-service/tests/test_ledger_refresh_gates.py
    - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
key-decisions:
  - "The no-advance signal is OR-ed into the marks-paused WHEN after the EXISTS close paren, so the weekly window stays one occurrence and the staleness view is untouched"
  - "The signal's third conjunct is written as AND EXISTS, never a second WHEN EXISTS, so twin P2's find stays at one occurrence"
  - "Re-pointing the 34 existing twins moved into the Task 1 commit instead of Task 2, so no commit leaves a twin mutating dead text"
  - "The fan-out gate's apply list gained the csv kind registration migration, because the new fixtures insert compute_analytics_from_csv jobs"
metrics:
  duration: "about 1 hour 15 minutes"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 48000
  tasks: 3
  commits: 3
plan_head_before: 67b043b60969a3b41ec4eed1a2af59ebd6b417c1
plan_head_after: f51a2e2d47ba483949917ddc5383eb1b2d426d84
---

# Phase 214 Plan 03: no-advance strategies are capped to a weekly attempt Summary

A single-key strategy whose view reason is `series_behind`, whose last return date is 8 or more days old and which has a `done` `compute_analytics_from_csv` job created on or after `last_return_date + 5` now gets a 7-day attempt cooldown in the fan-out instead of 20 hours; it is admitted again once its last attempt is older than 7 days (cap, never exclude), and the staleness view is not touched.

## What was built

- `20261114152300_ledger_fanout_no_advance_weekly_cap.sql`: forward re-base of the single-key body copied from `20261030120000`. The one executable edit is an `OR (...)` of three conjuncts (`lrs.stale_reason = 'series_behind'`; `(CURRENT_DATE - lrs.last_return_date) >= 8`; `AND EXISTS` over `public.compute_jobs cj3` with kind, `status = 'done'` and `created_at >= (lrs.last_return_date + 5)::timestamptz`, one predicate per line) spliced after the close paren of the marks-paused `EXISTS` and before `THEN INTERVAL '7 days'`. `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, the restated `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` and the catalogue-only STEP 2 are carried unchanged; the STEP 2 messages and the NOTICE name `20261114152300`, `COMMENT ON FUNCTION` gains a Phase 214 sentence. Header in the analog's section order (OPS warning, forward-not-edit, decision, what changes, scope boundary, VAC-04 ack, re-base discipline, disjointness, blast radius) with no find string in the prose.
- `test_ledger_refresh_fanout.sql`: arms NA1 (capped at a day, re-admitted at 8 days), NA2 (age 7 keeps 20 hours), NA3 (a `failed_final` analytics job is not a completed run), NA4 (a done job older than the stale day does not count), each with a `RED-UNDER-M` twin and a `TEST FAILED (<arm>)` message naming the likely cause; all 34 existing edit twins re-pointed; apply list extended; arm count 31 to 35 in the three mentions and the executed notice; a header paragraph records the sixth re-point and the three new list entries.
- `test_ledger_refresh_gates.py`: `_FANOUT_MIGRATION_NAME` moved (dated paragraph), `20261030120000_ledger_fanout_marks_paused_weekly.sql` added to `_FANOUT_SUPERSEDED_MIGRATION_NAMES`, window 8 (`20261114152300` to `20261114152301`) appended with its measurement comment.
- `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql`: regenerated; the only function snapshot that moved.
- `down/20261114152300-rollback.sql`: Phase 211 header shape (manual, undoes, keeps, costs, ledger row left in place), the `20261030120000` body verbatim (diffed byte-for-byte against the original block), its COMMENT and REVOKE, a catalogue-only check (SECURITY DEFINER, pinned path, owner-only EXECUTE). It does not spell the composite function's name.

## Evidence

VAC-04 ack (step 1, measured on the committed snapshot before regeneration; the FIFTH field, `live`): `7e59ca404259753a030382af4ad1bd5827b289c2997ede17e4a00dcfff8fbd3a`. The migration's `-- prod-body-ack:` line carries exactly that value. It is earned only if VAC-04 on the PR reports the same hash for PROD.

SC-7 drill (Task 1), lane whose apply list stops at `20261030120000` (both new entries dropped), quoted:

```
psql:supabase/tests/test_ledger_refresh_fanout.sql:2722: ERROR:  P0001: TEST FAILED (NA1): a stale series_behind strategy at age 20 whose completed derive and compute run is 1 day old was enqueued (1 new job(s)), expected 0 — the no-advance cap is gone, so an idle account whose refresh cannot move its series is re-derived every day. ...
```
(exit 3). Full list: `ALL 32 ARMS EXECUTED` after NA1, then `ALL 35 ARMS EXECUTED (A, B, C, D, E, F, G, H, I, J, K, L, M1, M2, N, N2, N3, P, P1, P2, P3, P4, P5, NA1, NA2, NA3, NA4, Q, R, S1, T, U, V1, V2, W) and passed`, no `TEST FAILED`, no `SKIP:`, and the apply NOTICE `Migration 20261114152300: ... re-based` (not an exception).

Rollback proof (Task 3): the fan-out gate with the full list plus the rollback file. The rollback applied and printed `Rollback 20261114152300: the single-key ledger fan-out restored to the 20261030120000 body; SECURITY DEFINER, pinned search_path and owner-only EXECUTE verified`; the gate then stopped with `TEST FAILED (NA1)` (exit 3) and no pre-existing arm failed (the plan's verify command, including the negated pre-existing-arm grep, passed).

Subset mutation run on the gate file (per-file line, quoted): `file test_ledger_refresh_fanout.sql: sections 41 / judged 41 / annotated 41 / waived 0 / biting 41`, `arms: 41/41/0`, `biting: 41`, `lane-invocations: 41` (the two tallies agree), `No defects in the SUBSET`. NA1 to NA4 each printed `RED (identity ok)`. No arm before NA1 seeds a `compute_analytics_from_csv` job (grep of the file at HEAD before this plan: 0 hits), so none can trip an NA twin first; NA1 to NA4 are the only seeders and each is the first failure at its own arm.

Find-count table (every `find` over the raw final bytes of its target file, declared occurrences against measured `split(find).length - 1`; 39 rows, 0 mismatches):

| arm(s) | target | declared | measured |
|---|---|---|---|
| A, M1, K, L, M2, B, P, C, D, P1, P2, P3, P4, P5, NA1, NA2, NA3, NA4, G1, G2, H, H/inactive, H/revoked, H/disconnected, R, N, N2, N3, U, V1, V2, W, W/deadlock, E (two non-interval steps) | new migration | 1 | 1 |
| E (interval step, `nth` 1) | new migration | 2 | 2 |
| F (interval step, `nth` 1) | new migration | 2 | 2 |
| T (interval step, `nth` 2) | new migration | 2 | 2 |
| Q | `20260716130000_strategies_status_private.sql` | 1 | 1 |

Needle hygiene counts on the new file: `THEN INTERVAL '7 days'` 1, `INTERVAL '20 hours'` 2, `WHEN EXISTS (` 1, `CURRENT_DATE - 3, 'YYYY-MM-DD')` 1, composite name or tag 0, schedule or unschedule verb 0, `PERFORM` of a fan-out 0, one `prod-body-ack` line. `grep -a 'RED-UNDER-M:' ... | grep -a -c marks_paused_weekly` is 0; the setup line names the new file once; `ALL 31 ARMS` count is 0 and `ALL 35 ARMS EXECUTED` is 3. `UPDATE ... strategy_analytics` count in the gate is 0, unchanged; every new fixture seeds by INSERT.

Other checks: `pytest tests/test_ledger_refresh_gates.py tests/test_sql_gate_scoped_updates.py` 41 passed (re-run with the rollback present); `schema:functions:check` current (133 functions); `lint-migration-data-dependence` self-test OK and corpus `0 NEW`; `lint-sql-gates` self-test OK and 0 findings; `lint-app-guc` 0 findings.

Vitest files that read migrations or snapshots (59 discovered by the plan's grep, 58 run, 53 passed, 1 skipped, 4 red, 7 failing tests), every red one with its first failing line:

| file | first failing assertion | reason | owner |
|---|---|---|---|
| `src/__tests__/mutation-runner-floors.test.ts` | `ARMS_FLOOR is 848` against 861 declared twins; naive-vs-parser marker count 861 against 848 | census, arm count moved (Phase 211 and plans 02, 03 add arms) | plan 07 |
| `src/__tests__/mutation-annotation-parser.test.ts` | `expected 861 to be 848` and `978 to be 965` (real-corpus twin and needle counts) | census | plan 07 |
| `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | `expected 474 to be 461`; and `ci.yml's derivation credits test_enqueue_dedup_record_retract.sql with 16 arms; the file declares 18` | census; the second is the Phase 211 table row, and after it is fixed this plan's gate file (31 now 35 arms in the ci.yml table) is the next one it will name | plan 07 |
| `src/__tests__/check-planning-hygiene.test.ts` | `ABSOLUTE-HOME-PATH: .planning/phases/214-.../214-01-PLAN.md:174` | NOT caused by this plan: a local absolute home path sits in plan 01's tracked PLAN.md; rewrite it repo-relative | orchestrator or plan 07 |

No migration-reading vitest file other than those four is red.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The new fixtures' analytics jobs hit `compute_jobs_kind_fkey`**
- **Found during:** Task 1, first lane run (`insert or update on table "compute_jobs" violates foreign key constraint "compute_jobs_kind_fkey"`)
- **Issue:** the lane registers the `derive_broker_dailies` kind but not `compute_analytics_from_csv`; the pre-existing arms never inserted that kind.
- **Fix:** appended `supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql` to `RED-UNDER-SETUP`, immediately before `20260614120000_derive_broker_dailies_kind.sql` (the position every sibling gate uses; the later migration widens the constraints it touches as a strict superset). The SC-7 drill still drops the last two entries, so it still stops at `20261030120000`.
- **Files modified:** `supabase/tests/test_ledger_refresh_fanout.sql`
- **Commit:** `96bea854a`

**2. [Ordering] Re-pointing the 34 existing twins landed in Task 1, not Task 2**
- **Why:** the plan's own rule (TRAP E) is that the apply-list entry and the twin re-point land in one commit, otherwise a commit exists where 34 twins mutate dead text. Task 2's step 2 therefore became verification only (recount table above).
- **Commit:** `96bea854a`

No other deviations.

## Known Stubs

None.

## Threat Flags

None. The new subquery reads only `public.compute_jobs`, schema-qualified; the body's hardening (search_path pin, REVOKE, owner-only EXECUTE) is asserted at apply by the unchanged check 11, check 2 and the restated REVOKE.

## Notes for later plans and the orchestrator

- Plan 06 appends the skip counter to this same migration file. The STEP 2 needles and the three arm-count mentions are already in the shape it needs; plan 06 must keep the new file's `find` counts as tabulated and re-run the recount.
- Expected red until later plans: the census tests above (plan 07); `baseline-content-drift` and VAC-08 until apply-on-merge plus the records re-dump (a stale-baseline red counts as green per the founder rule).
- SC-4 (orchestrator, after merge): the long-idle strategy stays a stale row with its reason, and its next derive comes about a week after its last one. SC-6 (orchestrator, before merge): migration-reviewer and rls-policy-auditor clean.
- The VAC-04 ack is earned only if VAC-04 on the PR reports the same PROD hash; if it differs, fold PROD's difference in rather than editing the pragma.
- No PROD read or write was made in this plan; the blast-radius paragraph of the migration says so.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql, supabase/migrations/down/20261114152300-rollback.sql, supabase/tests/test_ledger_refresh_fanout.sql, analytics-service/tests/test_ledger_refresh_gates.py, supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
- FOUND commits: 96bea854a, e94b2d932, f51a2e2d4
