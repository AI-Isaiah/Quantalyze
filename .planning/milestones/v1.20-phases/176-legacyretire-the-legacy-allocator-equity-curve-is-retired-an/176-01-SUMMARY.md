---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 01
subsystem: operator-runbook
tags: [runbook, pg_cron, prod-reads, static-guard, legacyretire]
requires: []
provides:
  - "docs/runbooks/legacyretire-go-live.md: renderer plus sixteen named SQL forms for plans 07, 12 and 16"
  - "src/__tests__/legacyretire-runbook-forms.test.ts: the static guard over those forms and the renderer"
affects: [176-07, 176-12, 176-16]
key-files:
  created:
    - docs/runbooks/legacyretire-go-live.md
    - src/__tests__/legacyretire-runbook-forms.test.ts
  modified: []
status: complete
commits: 2
plan_head_before: e00141c4fc12f761131d40960509bda86cc03093
plan_head_after: 2e882ba831f6cea7950eaed48a7d20bc6846a2b7
actuals:
  tokens: 19700
  tasks: 2
  commits: 2
requirements-completed: [SC-1, SC-2, 181-SC-4]
---

# Phase 176 Plan 01: LEGACYRETIRE operator runbook and its static guard Summary

A committed runbook with a validating renderer and sixteen pinned SQL forms (eleven PROD reads, one TEST read, two guarded PROD cron writes, one guarded TEST cron write, the plain marker read), and a 185-case static test that keeps every form read-only, id-free and marker-first, so plans 07, 12 and 16 run nothing that was written at run time.

## What was built

**Task 1 (tracer), commit `8575d6ec8`.** The runbook skeleton copied from the MARKSOURCE legacy-chain-move runbook: header, the decisions of record quoted verbatim from CONTEXT (D-01, D-02, D-04, D-06, D-07), the three-PR table with the reading that gates each next step, why the cron is not moved by a migration, and the `$LR_SP/form.mjs` renderer (`__MARKER__` from the manifest's `database_marker`, refusals with exit 2 and empty stdout for an unknown form, an unusable marker, an unresolved placeholder, or a missing or malformed `LR_SINCE` / `LR_DEPLOY_DAY` / `LR_VERSION`). Forms: `marker`, `r0-baseline-unknown`. The test was written first and run with the runbook absent.

**Task 2, commit `2e882ba83`.** The remaining fourteen forms: `r3-bridge-holding`, `r1-closed-day-points`, `r2-zero-legacy-and-linked`, `cron-state`, `unschedule-refresh`, `reschedule-refresh`, `r4-legacy-writes-stopped`, `r5-drop-preflight`, `r5-pre-drop-count`, `r6-drop-applied`, `ledger-row`, `body-check`, `test-cron-state`, `unschedule-refresh-test`; the renderer's `LR_PROC` (`^public\.[a-z_]+\([a-z, ]*\)$`) and `LR_NEEDLE` (`^[a-z_]+$`) validation; the Rollback, Merge and deploy hold (no merge 00:30Z to 03:45Z on a day a form is run) and What this runbook does not cover sections.

The three write forms start with `DO $guard$`, refuse unless the marker check holds (PROD: `IS DISTINCT FROM __MARKER__`; TEST: the apply-test predicate spelled in SQL), refuse unless the job is in its expected starting state (compare-and-set on name, schedule `30 1 * * *`, command `SELECT enqueue_refresh_allocator_equity_for_all();`), touch the catalog only through `cron.unschedule('refresh-allocator-equity')` or `cron.schedule('refresh-allocator-equity', ...)` by name, and end with a read-back whose first column is the marker check. `reschedule-refresh` additionally refuses once `to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()')` is NULL, so the rollback cannot schedule a job for a dropped function.

## Evidence

RED first (Task 1), `red-at-base.log`, runbook absent:
`Error: ENOENT: no such file or directory, open '<worktree>/docs/runbooks/legacyretire-go-live.md'` (suite failed to load, `Tests  no tests`).

GREEN (Task 1): `Tests  16 passed (16)`.

RED first (Task 2), the full pin set written before the forms: `Tests  85 failed | 100 passed (185)` (the 100 passing are the Task 1 cases plus refusal cases that pass trivially while a form is absent; each placeholder also has an "is carried by form" and an "is accepted" case that failed). Examples: `unschedule-refresh: the first statement must be the DO $guard$ block`, `unschedule-refresh-test: the whole-word TEST predicate of supabase-migrate.yml`, `the rollback must refuse once PR 3 drops the function`, `the merge hold section must carry ## Merge and deploy hold`.

GREEN (Task 2): `Test Files  1 passed (1)`, `Tests  185 passed (185)`.

Neuter drill (byte backup with `cp`, restore with `cp`, `cmp` after each):
- Added a `--` comment to `r1-closed-day-points`: `Tests  1 failed | 184 passed (185)`, naming `read form r1-closed-day-points ... carries no -- comment`. Restored, `cmp` exit 0.
- Removed the schedule pin from `unschedule-refresh`'s guard: 2 failed (the compare-and-set case and the literal-pin case). Restored, `cmp` exit 0.
- Replaced the function-exists guard of `reschedule-refresh` with `IF false`: 1 failed. Restored, `cmp` exit 0.
- Replaced `IS DISTINCT FROM __MARKER__` with `<> __MARKER__` in `unschedule-refresh`: 1 failed (a NULL marker would no longer refuse). Restored, `cmp` exit 0.

Other checks: `npx tsc --noEmit` clean; `npx eslint src/__tests__/legacyretire-runbook-forms.test.ts` clean; no uuid-shaped literal, no home path and no planning-directory path in the runbook; `node scripts/verify-plan-anchors.mjs` on the plan: 9 claims, OK. The only runbook link is to `marksource-legacy-chain-move-go-live.md`, which exists (the docs link check is offline).

## Local execution check (beyond the plan)

The plan says no SQL runs anywhere; the orchestrator's hard constraints allow local throwaway lanes, and every one of these forms will run on PROD, so I rendered each form and ran it on a throwaway PostgreSQL 16 cluster started from a scratch directory on a unix socket only (not the repo lane, no network, destroyed afterwards). The schema was a hand-written stub carrying only the columns the forms read, a stub `cron` schema and a stub migration ledger. This proves syntax, the guards' refusals and the counting logic against seeded rows; it does NOT prove the real PROD catalog, so the first PROD run of each form is still the real test.

- Every PROD read form ran and returned its columns, `marker_is_prod` = 1 first. Seeded counts matched hand-computed values for `r0`, `r1`, `r2` (including a non-array curve counted as no point without raising), `r3` (holding population 2 of 3 outcome rows; inside and outside the 365-day window 1 and 1; `aged_candidates_any_branch` 2), `cron-state`, `r5-pre-drop-count` (`dependent_objects` 0 for a table with a primary key, foreign key, index, policy and RLS).
- `r5-drop-preflight` stripped a line comment and a multi-line block comment correctly (a function naming the table only in comments read false).
- `unschedule-refresh` removed the job once; a second run was refused by the compare-and-set. `reschedule-refresh` was refused while the job existed, restored it exactly once it did not, and was refused after the fan-out function was dropped. A NULL database comment refused `unschedule-refresh`.
- `unschedule-refresh-test` ran under a marker naming TEST, and was refused under the PROD-marked database, under `contest db` (not a whole word) and under a marker naming both TEST and PROD.

Not verified: pg_cron's exact behaviour of `cron.schedule(name, schedule, command)` and `cron.unschedule(name)` on PROD (the MARKSOURCE runbook's P4 establishes pg_cron 1.3 or later there, which has both).

## Deviations from Plan

None to the plan's behaviour. Notes:

1. **[Scope addition, not a deviation of rule]** the local throwaway-cluster execution check above (hard constraints allow it; the plan text said no SQL anywhere).
2. The acceptance line "`grep -anF '<!-- form: '` lists exactly the `marker` and `r0-baseline-unknown` lines" cannot hold literally: a third match is the renderer's own regular expression on the `const m = md.match(...)` line (the MARKSOURCE runbook has the same). The exact-set assertion in the pin test, which the plan names the authority, passes and extracts forms only from fenced `sql` blocks.
3. `r2-zero-legacy-and-linked` defines "linked" over the allocator's connected keys through `api_keys.user_id`, `strategies.api_key_id` and `strategy_keys`, non-archived, as RESEARCH R2 words it; the baseline's other link rules also compare `strategies.user_id` to the key's owner, which I left out because the shared-key rule of 2026-10-31 counts a link regardless of owner. If plan 07 wants the owner-equality variant, it is a one-line edit with a pin.

## Known Stubs

None.

## Threat Flags

None. The runbook adds no endpoint, auth path or schema; its one PROD write is guarded and pinned (T-176-01, T-176-02, T-176-03 mitigations are the marker-first columns, the write-word and `--` refusals, the compare-and-set guards, and the uuid / home-path / planning-path refusals).

## Handoff to the orchestrator plans

- Plan 07 (PR 1): run `marker`, `r0-baseline-unknown`, `r3-bridge-holding` (export `LR_DEPLOY_DAY` as the migration's apply day for the after-reading) before merge; after the merge's apply, `ledger-row` (`LR_VERSION`) and `body-check` (`LR_PROC`, `LR_NEEDLE`), then `r1-closed-day-points`, `r2-zero-legacy-and-linked`, and `r3-bridge-holding` again after the first 03:00Z run.
- Plan 12 (PR 2): `cron-state`, `unschedule-refresh`, the manifest re-capture in the same session (expected diff: the one job object and `captured_at`), `cron-state`, `r4-legacy-writes-stopped` (`LR_SINCE`). The pin test accepts the manifest with or without the `refresh-allocator-equity` row, so it stays green across the re-capture; re-run it after.
- Plan 16 (PR 3): `r5-drop-preflight` and `r5-pre-drop-count` before merge; `ledger-row` then `r6-drop-applied` after. `r0`, `r2`, `r4` and `r5-pre-drop-count` read the legacy table and error on a missing relation after PR 3, by design.

## CHANGELOG inputs

- Added: `docs/runbooks/legacyretire-go-live.md`, the operator runbook for retiring the legacy allocator equity curve: a validating form renderer and sixteen named SQL forms (PROD readings, the guarded removal of the `refresh-allocator-equity` cron job and its rollback, schema-apply checks, TEST variants). No application behaviour changes.
- Tests: `src/__tests__/legacyretire-runbook-forms.test.ts`, 185 cases pinning the form set, read-only and marker-first rules, the write guards, the recorded cron schedule and command (against the manifest with and without the row), and the renderer's refusals.
- Notes: the runbook is operator-visible only; the removal of the cron job and the drop of the table are later plans of the phase and are not done here.

## Self-Check: PASSED

- `docs/runbooks/legacyretire-go-live.md`: FOUND
- `src/__tests__/legacyretire-runbook-forms.test.ts`: FOUND
- `8575d6ec8` (Task 1): FOUND in history
- `2e882ba83` (Task 2): FOUND in history
