---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 03
subsystem: database
tags: [enqueue-dedup, compute-jobs, refresh-marker, secdef-helper, d11, tdd, 161.1-D11]

requires: []
provides:
  - "migration 20261114120000: side table compute_job_dedup_events, SECURITY DEFINER helper _record_enqueue_dedup, both overloads of _enqueue_compute_job_internal re-based with a helper call at SITE A and SITE B"
  - "gate supabase/tests/test_enqueue_dedup_record_retract.sql born with the SITE-A arm (plan 05 adds 14 more)"
affects: [TODOS 161.1-D11, SC-2, SC-4, plan 05, plan 06, plan 07]

status: complete
actuals:
  tokens: 22000
  tasks: 3
  commits: 3
plan_head_before: d0228dc0f0df100860f4adc4b6c6f61cc022fe3f
plan_head_after: ac5aab51d9c31fa587cee743a25cce2a376b9cfb

tech-stack:
  added: []
  patterns:
    - "dedup-hit side effects delegated to one SECDEF helper called from both return sites of both overloads, so the overload bodies stay byte-for-byte except four tagged PERFORM lines"
    - "marker retraction reuses public.retract_ledger_refresh_marker; one marker list in code, no second UPDATE of compute_jobs"
    - "catalogue-only migration verify block, no body-text assertion, so a gate twin can edit the body without aborting its own apply"

key-files:
  created:
    - supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql
    - supabase/migrations/down/20261114120000-rollback.sql
    - supabase/tests/test_enqueue_dedup_record_retract.sql
    - supabase/schema/functions/_record_enqueue_dedup.sql
  modified:
    - supabase/schema/functions/_enqueue_compute_job_internal.sql
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs

key-decisions:
  - "Founder option B (D11, 2026-11-14): record the caller's metadata on every dedup hit and retract an inherited refresh marker for a correlation-id caller; merge nothing else into the job row"
  - "Migration timestamp 20261114120000 kept: it sorts after the newest migration at HEAD (20261110150000)"
  - "No supabase db push and no remote CLI: the migration is proven on the throwaway pg-lane and the mutation runner only; it reaches TEST then PROD through merge CI"

requirements-completed: [SC-2, SC-4]
---

# Phase 211 Plan 03: Enqueue dedup records the caller and retracts an inherited refresh marker Summary

An enqueue that dedups onto an in-flight job now records the caller's `p_metadata` in `compute_job_dedup_events` and, for a correlation-id caller on a marker-capable kind, retracts the refresh marker the job inherited, at both return sites of both overloads of `_enqueue_compute_job_internal` (TODOS `161.1-D11`, SC-2). This plan ran in two executor sessions: the first did Task 1 and ran out of context, this one did Tasks 2 and 3 and the SUMMARY.

## What changed

- **Migration `20261114120000_enqueue_dedup_record_retract.sql`**: the side table `public.compute_job_dedup_events` (`id`, `job_id` FK ON DELETE CASCADE, `caller_metadata`, `retracted_marker`, `deduped_at`; object and 8192-byte CHECKs; index on `job_id`; RLS ENABLE without FORCE and a deny-all policy; REVOKE ALL then GRANT SELECT to `service_role` only). The helper `public._record_enqueue_dedup(uuid, text, jsonb, uuid[])` (SECDEF, `search_path = public, pg_catalog`, no EXCEPTION block). Both overloads re-based byte for byte (7-arg from `20260716090000`, 10-arg from section (3) of `20261024120000`) plus four tagged `PERFORM` lines. ACL and the 10-arg `COMMENT ON FUNCTION` restated. A catalogue-only verify block.
- **Gate `test_enqueue_dedup_record_retract.sql`**: arm SITE-A, a resync-tail call (correlation id, no `source`) deduping onto a marked `derive_broker_dailies` job; its twin deletes the 10-arg SITE A call line.
- **Snapshots**: `_record_enqueue_dedup.sql` created, `_enqueue_compute_job_internal.sql` re-sourced from the new migration (both sections).
- **Censuses**: `NAME_SET_RATCHET` row `_record_enqueue_dedup` (`snapshot-only`, 2026-11-14), `COMPARED_FLOOR` 134 -> 135 with a dated MOVED note.
- **VAC-04**: one earned `prod-body-ack` per re-based overload.
- **Rollback `down/20261114120000-rollback.sql`**: restores both prior bodies, restates ACL and the 10-arg comment, drops the helper, keeps the table.

## D11-5 census (Task 1 step 0, taken before the migration was written)

Run by the first session on this tree (carried forward from its handoff, not re-run in the second session). Result: **no background `correlation_id` sender beyond the two D11-8 cron routes.** The only background senders of `correlation_id` to `enqueue_compute_job` are `src/app/api/cron/reconcile-strategies/route.ts` (kind `reconcile_strategy`) and `src/app/api/cron/sync-funding/route.ts` (kind `sync_funding`); neither kind is in the retraction's kind scope, so "no background retraction" is structural. The first session classified the other listed files as user-initiated paths or non-senders (type and helper files). Step 0b: latest 10-arg definition `20261024120000`, latest 7-arg `20260716090000`, nothing newer; `20261114120000` sorts after the newest migration `20261110150000` at HEAD.

## RED / GREEN evidence (Task 1)

`tdd-red-evidence` has no psql adapter, so the raw lane output is the RED evidence.

- RED, helper calls removed: the pg-lane run failed on `TEST FAILED (SITE-A): the refresh marker is still on the job after a correlation-id caller deduped onto it ...`, psql exit 3.
- GREEN (re-run in this session after the Task 2 header edit): `ALL 1 ARMS EXECUTED (SITE-A): an enqueue that dedups onto a marked refresh job through the optimistic look-up returns that job, retracts the marker for a correlation-id caller with no source key, leaves the other keys alone and records exactly one event with the caller metadata and the retracted marker.`
- Subset mutation run (SC-4), re-run in this session:
  `scope: SUBSET 1/82 annotated files: test_enqueue_dedup_record_retract.sql`
  `arm SITE-A exit 3 RED (identity ok)`
  `file test_enqueue_dedup_record_retract.sql: sections 1 / judged 1 / annotated 1 / waived 0 / biting 1`
  `No defects in the SUBSET: every annotated arm of these 1 of 82 annotated files bit its own arm first.` (exit 0)

## Task 2 readings

- `npm run schema:functions:check` reads `SQL function snapshot is current (133 functions)` and `DRIFT-05 gate (a): baseline 132 name(s) vs migration-replay 133 name(s) - agree, with 1 ratcheted disagreement(s) carried`.
- `node scripts/baseline-content-drift-check.mjs`: `functions compared 135 - MATCH 129, DRIFT 5, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`, `findings 3`. The three findings are the expected ones: `DRIFT _enqueue_compute_job_internal/7`, `DRIFT _enqueue_compute_job_internal/10` (2 differing lines each) and `SNAPSHOT_MISSING _record_enqueue_dedup/4`. No allowlist row was added. New `COMPARED_FLOOR` is **135**.
- `--diff-bodies` against origin/main: two DRIFT rows, `_enqueue_compute_job_internal` arity 7 and arity 10, 2 differing lines each (the two added helper calls per overload). The helper has no PROD body and no pragma.
- `npx vitest run src/__tests__/baseline-content-drift-allowlist.test.ts src/__tests__/sql-body-normalize.test.ts`: 2 files, 55 tests passed. `lint-migration-data-dependence.mjs --self-test` and the corpus run: clean, 0 NEW. `lint-app-guc.mjs`: 0 findings. After the pragmas were added, `npm run schema:functions` and the check were re-run: the snapshot did not move.

## Task 3 readings

Rollback proof on the lane: with `--post-apply supabase/migrations/down/20261114120000-rollback.sql` the scratch gate printed `ROLLBACK CHECK OK: helper gone, both overloads present and clean, table kept` (helper absent, both overloads exist with no helper reference in the comment-stripped definition, ACL intact, table kept). The same gate without the rollback raised `TEST FAILED (ROLLBACK): the helper still exists`, so it can fail. The rollback's 10-arg body is `diff`-identical to `20261024120000` lines 499-751 and the 7-arg extract is identical to `20260716090000` lines 49-175.

The ten existing gates, run against the new body (apply list runs through `20261114120000`), final line each, all green (exit 0, no `TEST FAILED` or `ERROR:`):

| Gate | Final line |
|---|---|
| `test_enqueue_internal_destrict` | `parts 1+3, 2, 4, 5 and 6 executed.` |
| `test_compute_analytics_kind_retired` | `Part 1 OK: both overloads reject compute_analytics via invalid_parameter_value ...` |
| `test_enqueue_race_loss_40001` | `ALL 3 ARMS EXECUTED (R1, R2, R3) and passed` |
| `test_enqueue_compute_job_dedupe_non_terminal` | `ALL ASSERTIONS PASSED (B1, B2)` |
| `test_resync_retry_single_job` | `ALL ASSERTIONS PASSED (a, b, c)` (needed stand-ins, below) |
| `test_compute_job_metadata_merge` | `ALL 13 ARMS EXECUTED (1..13)` |
| `test_fan_in_failure_cascade` | `ALL 8 ARMS EXECUTED (FC8, FC1 ... FC7) and passed` |
| `test_fan_in_lock_order_race` | `ALL 8 ARMS EXECUTED (FL1 ... FL8) and passed` |
| `test_ledger_refresh_fanout` | `ALL 31 ARMS EXECUTED (A ... W) and passed` (needed stand-ins, below) |
| `test_ledger_refresh_composite_arm` | `ALL 23 ARMS EXECUTED (A ... W) and passed` (needed stand-ins, below) |

Command-line-only apply-list additions (no gate's `RED-UNDER-SETUP` line was edited; `git diff --quiet` over the four named gates exits 0):
- `test_resync_retry_single_job` (first run failed with `relation "strategy_verifications" does not exist`): its own four extras `20260501055202_strategy_verifications.sql`, `20260501055213_strategy_verifications_rls_polish.sql`, `20260510172738_strategy_verifications_state_machine.sql` and `20260726000225_strategy_verifications_tenant_scope_uniq.sql`, inserted into the D11 list in timestamp position.
- `test_ledger_refresh_fanout` and `test_ledger_refresh_composite_arm` (first run failed with `enqueue_ledger_refresh_for_strategies` / `enqueue_ledger_composite_refresh` not registered): each gate's own `RED-UNDER-SETUP` list with the D11 list's missing entries inserted after their D11 predecessor, ending in `20261024120000`, `20261106120000`, `20261114120000`. A first merge that re-sorted migrations by filename misplaced the `system_flags` and `cron_runs` fixtures (`relation "public.system_flags" does not exist`), so the merge keeps each list's own order.

Local stack: **not run** (disk). The host had 1.9 GB free against the plan's 10 GB bar. "local-stack not run (disk); CI sql-tests is the authoritative reading." The restated REVOKE against the real Supabase default-grant event trigger therefore has no reading here; it is carried by the migration's catalogue verify block and CI.

## Census tests that are red until plan 06 (expected)

I ran every `src` and `scripts` test file that reads `supabase/migrations`, `supabase/schema`, `supabase/tests`, `baseline.sql` or `schema/functions` (72 files in one vitest run, 4 failed, 10 tests). All four failing files are on the expected list, and every failure is a count drift from the one new gate file:
- `mutation-runner-floors.test.ts` (3): marker count, `FILES_FLOOR`, `ARMS_FLOOR`.
- `mutation-annotation-parser.test.ts` (4): corpus ratio and class sums (`expected 831 to be 830`, `expected 944 to be 943`).
- `lint-sql-gates.test.ts` (1): `scanned 109 file(s)` vs the pinned `scanned 108 file`. `node scripts/lint-sql-gates.mjs` itself reads `0 finding(s)`.
- `contracts/ci-anti-skip-gate.contract.test.ts` (2): the F10 static accounting.

`gate-family-meta.test.ts` and `drift-check-scripts.test.ts` were expected red but ran green (952 tests passed); they are not red outside the list, they are simply not red yet. **No test went red outside the expected list.**

## Deviations from Plan

**1. [Deviation, recorded as the orchestrator requires] No `supabase db push`.** The plan has no push task; the migration is proven only on the throwaway pg-lane, the mutation runner and the existing gates. It reaches TEST then PROD through merge CI.

**2. [Rule 3 - blocking tooling] `tdd-red-evidence` has no psql adapter.** The raw lane output (exit 3 on `TEST FAILED (SITE-A)`) is the RED evidence, plus the mutation runner's `RED (identity ok)`.

**3. [Rule 1 - verify grep] The verify RAISE text was reworded** to "row level security forced on" so the code-line `FORCE ROW LEVEL SECURITY` grep reads 0. The check itself is unchanged.

**4. [Plan acceptance wording] `grep -c -a "'_record_enqueue_dedup'" scripts/dump-sql-functions.ts` prints 0, not 1.** That file uses double-quoted strings, as the Phase 191 rows do. The row exists: `grep -c -a '"_record_enqueue_dedup"'` prints 1, and the ratchet check is green with it. Not edited to satisfy the literal grep.

**5. [Rule 3] Extra stand-ins on the command line** for three of the ten existing gates (listed above), as the plan allows; no existing gate was edited.

**6. This plan ran in two executor sessions** (Task 1 in the first, Tasks 2 and 3 and this SUMMARY in the second).

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model: the new table, helper and ACL are exactly T-211-06 to T-211-11; the catalogue verify block asserts the mitigations (SECDEF, pinned `search_path`, no PUBLIC or client EXECUTE, deny-all RLS, grants).

## Review notes for the orchestrator

- migration-reviewer and rls-policy-auditor still owe this migration a pass before merge (the plan puts them at the review stage). Every review it needs must happen before the merge: PROD auto-applies after TEST with no human gate.
- VAC-08 and `baseline-content-drift` go red on the PR by construction (2 DRIFT rows and 1 SNAPSHOT_MISSING) until apply-on-merge and the post-apply re-dump. Plan 06 owns moving the censuses once on the final arm roster.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261114120000_enqueue_dedup_record_retract.sql, supabase/migrations/down/20261114120000-rollback.sql, supabase/tests/test_enqueue_dedup_record_retract.sql, supabase/schema/functions/_record_enqueue_dedup.sql
- FOUND commits: f96362645, 5efedd8f4, ac5aab51d (all ancestors of HEAD)
