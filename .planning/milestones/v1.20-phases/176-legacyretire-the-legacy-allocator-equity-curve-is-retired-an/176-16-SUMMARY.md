---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 16
subsystem: operations
tags: [go-live, PR-3, D-02, D-09, drop, R5, R6]
requires: ["176-13", "176-14", "176-15"]
provides:
  - "the pre-drop record of what the drop destroyed (counts and dates)"
  - "PR 3 shipped (v0.133.17.0, #1185), applied to TEST then PROD, read back by R6"
  - "R1, R3 and cron-state read after the drop (interim, before the first post-drop nightly)"
status: complete
pending: []
---

# Phase 176 Plan 16: PR 3 go-live Summary

The legacy table `allocator_equity_snapshots`, its two replace RPCs, `extract_symbol_value_at` and the refresh fan-out
function are gone from PROD, proven by the catalogue. The re-based `delete_allocator_api_key` is live with the D-09 body.
The derived curve still has a closed-day point for every holder, and nothing on PROD names a dropped object.

## Task 1: pre-merge go/no-go (2026-11-02, PROD via the Supabase MCP, marker form alone first: PRODUCTION)

- Reviews: three review rounds and two fix rounds, recorded in `176-PR3-REVIEW.md`. Round 3 was clean in all four
  reviewers: gsd-code-reviewer, silent-failure-hunter, migration-reviewer and rls-policy-auditor. The data-dependence
  lint printed 0 NEW across 314 migrations.
  - Fixed in round 1: CR-01 (VAC-04 ack and gate pathspec) and SFH-3 (the GDPR checker and dollar-quoted DROP).
  - Fixed in round 2: MD-01, under founder decision D-09, a last-key hard delete removes the derived rows.
  - Recorded, not fixed: SFH-1. The migration does not check cron, because that conflicts with D-04.
- `r5-drop-preflight` matched the expected set exactly.
  - `names_table_outside_comments` true: `delete_allocator_api_key`,
    `enqueue_refresh_allocator_equity_for_all`, `extract_symbol_value_at`, `replace_allocator_equity_snapshots`,
    `replace_allocator_equity_snapshots_window`.
  - False: `backfill_api_keys_history_reconstructed_at`.
  - `compute_bridge_outcome_deltas` does not appear.
- `r5-pre-drop-count` is what the drop destroyed:

| Reading | Value |
|---|---|
| `legacy_rows` | 952 |
| `legacy_allocators` | 4 |
| `oldest_asof` | 2025-11-14 |
| `newest_asof` | 2026-10-31 |
| `dependent_objects` | 0 |
| `cron_jobs_naming_table_or_fanout` | 0 |
| `boundary_rows` | 0 |

- `cron-state`: 3 allocator jobs, `refresh-allocator-equity` absent, no open retired-kind job. No stop rule fired, so
  D-02 proceeded.

## Task 2: shipped, applied, read back

- PR #1185, release v0.133.17.0, merge `ce9014d4e`.
- Supabase Migrate run 41518895623: `apply-test` success, `apply` success, re-dump jobs success.
- PROD at about 20:40Z, marker form first (PRODUCTION):

| `r6-drop-applied` column | Value | Expected |
|---|---|---|
| `table_gone` | true | true |
| `bodies_naming_table` | 0 | 0 |
| `dropped_functions_present` | 0 | 0 |
| `boundary_rows` | 0 | 0 |
| `ledger_row_present` (20261104120000) | true | true |

- `body-check` on `public.delete_allocator_api_key(uuid, boolean)`:
  - `proc_exists` true.
  - The body names `snapshot_rebuild_boundary`: false.
  - The body names `key_inputs` and `equity_curve`: true. That is the D-09 Step 4 live.
- No public function body names any of the four dropped functions (0). The newest ledger version is 20261104120000.
- Deployments of the merge SHA: Vercel Production success, the Railway `quantalyze-analytics` production deploy
  success, and the Test environment success.
- Main CI run 41518895740 failed only on `sql-gate-lint`, with the expected `DRIFT delete_allocator_api_key/2` until
  the re-dump, and on the `frontend` aggregator that carries it. The re-dump PR #1186 (v0.133.17.1) is open and the
  coordinator owns it. It also clears plan 13's four `baseline-only` `NAME_SET_RATCHET` rows.

## Task 3: after the drop (interim reading, 2026-11-02 ~20:40Z)

The plan's precondition, that the first post-drop 00:40Z derive and 03:00Z bridge run have completed, is not met yet.
These readings show the state right after the drop. The confirming re-read is due after **2026-11-03T03:00Z**.

| Reading | Plan 07 (after PR 1) | Plan 12 (after PR 2) | Now (after PR 3) |
|---|---|---|---|
| R1 holders / with derived row / trustworthy / with closed-day point | 7 / 7 / 6 / 6 (closed day 2026-10-31) | n/a | 7 / 7 / 7 / 7 (closed day 2026-11-01) |
| R3 holding_rows, all delta and window counts, computed_since_deploy_day | all 0 | n/a | all 0 (LR_DEPLOY_DAY 2026-11-02) |
| cron-state | 4 jobs | 3 jobs, refresh absent | 3 jobs, refresh absent, no open retired-kind job |

- R1: the derived curve's coverage did not drop. It rose from 6 to 7 holders with a closed-day point.
- R3: no holding-branch bridge rows exist on PROD, the same as at plans 07 and 12, so there is nothing to recompute.
  The batch cron `compute_bridge_outcome_deltas` succeeded 3 times in 3 days. Its last run, 2026-11-02 03:00Z, came
  before the drop. Its first post-drop run is 2026-11-03 03:00Z.
- Browser, in the founder's signed-in Chrome: `/allocations` renders the derived Portfolio curve with full history
  through 2026-11-01, and the console shows no errors. Recorded: yes.
- The closure records for the phase close: the SC-3 closures are now true (R6). The ROADMAP close-out edits for 181
  (absorbed, SC-4 rewritten) and 182 (superseded) belong to the phase's closure records.

## Task 3: confirming re-read (2026-11-03, after the first post-drop nightly)

The precondition is met. `compute_bridge_outcome_deltas` succeeded with a run started 2026-11-03T03:00Z, and
`derive-allocator-key-dailies` succeeded at 00:40Z. Read through the main checkout's linked CLI, marker form alone first
(PRODUCTION):

| Reading | Plan 07 | Interim (2026-11-02) | Confirming (2026-11-03) |
|---|---|---|---|
| R1 holders / with derived row / trustworthy / with closed-day point | 7 / 7 / 6 / 6 | 7 / 7 / 7 / 7 (closed day 2026-11-01) | 7 / 7 / 7 / 7 (closed day 2026-11-02) |
| R3 holding_rows and every delta and window count | all 0 | all 0 | all 0 (`computed_since_deploy_day` 0) |
| cron-state | 4 jobs | 3 jobs, refresh absent | 3 jobs, refresh absent, no open retired-kind job |

- R1: the first nightly derive after the drop wrote a closed-day point for all 7 holders. The derived curve kept going
  with the legacy table gone.
- R3: the bridge batch ran after the drop and succeeded. PROD still has no holding-branch rows, so it computed nothing,
  as at plans 07 and 12. Its run no longer depends on the dropped objects.
- The comparison was not a decision. The plan asks for it to be put in front of the founder, and that was done in the
  phase close-out report. The re-dump PR #1186 merged as v0.133.17.1 (merge `6f76ff29c`) with main green.

## Deviations

- Task 3 was read before the first post-drop nightly. The precondition will be met at 2026-11-03 03:00Z, and the R1
  and R3 re-read should be appended then.
- Reads went through the Supabase MCP instead of the main checkout's linked CLI. The coordinator asked for this. The
  SQL is the runbook forms rendered by its renderer, verbatim.
- Task 2's ship and merge steps were run by the coordinator, not in this plan's session.

## Self-Check: PASSED

`/tmp/legacyretire-16/preflight.log`, `apply.log` and `after.log` each pass their plan-verify line: marker present,
expected columns, no uuid.
