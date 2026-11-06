---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 07
subsystem: go-live
tags: [orchestrator, PROD-read, PR-1, D-01, D-02, D-06, D-07, 181-SC-4, legacy-retire]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plans 01-06 (runbook forms, holding-branch migration, derived-only readers, fixture sweep)"
provides:
  - "PR 1 merged, its migration applied on TEST then PROD, the readers deployed to Vercel production"
  - "R0 and R3 read on PROD before the merge; R0, R1, R2, R3 and cron-state read after the first night"
affects: [176-08, 176-09, 176-10, 176-11 (founder go for PR 2)]

actuals:
  tasks: 3
  commits: 0
---

# Plan 07 Summary: PR 1 go-live

Orchestrator plan. Every step was run by the orchestrator on the founder's standing PROD authorization. No
executor ran any step. Every reading below is a count, and every PROD session opened with the marker query
naming PRODUCTION (`marker_is_prod=1` on every row).

## Task 1: pre-merge gate (2026-10-31, about 17:04Z)

- Code review of PR 1 ran three rounds (176-REVIEW.md; fix rounds 1 and 2) before the merge. The
  migration-reviewer and rls-policy-auditor verdicts were not written to any tracked record, so this SUMMARY
  does not restate them.
- Data-dependence lint: 312 migrations, 83 refusals, 83 allowlisted, **0 NEW**.
- `r0-baseline-unknown`: allocators_with_unknown_baseline=1, rows_with_unknown_baseline=1, allocators_with_any_row=4.
- `r3-bridge-holding` (LR_DEPLOY_DAY=2026-10-31): holding_rows=0, with_delta_30d=0, with_delta_90d=0,
  with_delta_180d=0, needs_recompute=0, computed_since_deploy_day=0, inside_check_window=0,
  outside_check_window=0, aged_candidates_any_branch=0.
- Neither stop fired: `outside_check_window` and `aged_candidates_any_branch` are both 0.

## Task 2: ship, merge, apply, deploy

- PR **#1164**, release **v0.133.12.0** (`176 LEGACYRETIRE PR 1: readers move to the derived curve`), merged
  2026-10-31T20:38Z. PR head SHA carried 31 check runs: 29 success, 2 failure (`sql-gate-lint` and the `frontend` aggregator
  that gates on it), both the stale-baseline content-drift red described next, which this repo counts as green.
- `Supabase Migrate` run **41239837180** on the merge SHA: `apply-test` success, then `apply` success.
- Main CI on the merge SHA (run 41239837234) went red only on `sql-gate-lint`'s baseline-content-drift
  (`compute_bridge_outcome_deltas` DRIFT, `derived_account_return_over` and
  `reset_holding_bridge_outcomes_to_derived_basis` SNAPSHOT_MISSING). This is the expected stale-baseline red
  that the post-apply re-dump clears. The re-dump PR **#1165** (v0.133.12.1) merged, and main CI is green on it
  and on every later main commit.
- Vercel production deployment of the re-dump commit (which contains the PR 1 merge): state success,
  2026-10-31T21:09Z.
- No local `apply.log` was kept. The ledger row and the live body are evidenced by the apply run above, by the
  re-dump (it dumped the new body from PROD) and by the first-night reads, which ran on the new body.

## Task 3: first night read live on PROD (2026-11-01, about 07:00Z)

Read late. The 02:17Z slot was missed, but the 00:40Z derive, the 01:30Z refresh and the 03:00Z bridge cron had
all run on the deployed code.

| form | reading |
|---|---|
| `r0-baseline-unknown` | allocators_with_unknown_baseline=1, rows_with_unknown_baseline=1, allocators_with_any_row=4 (pre: 1/1/4, unchanged) |
| `r3-bridge-holding` (LR_DEPLOY_DAY=2026-10-31) | holding_rows=0, all delta and window counts 0, computed_since_deploy_day=0, aged_candidates_any_branch=0 (identical to pre; no holding-branch rows exist, so D-06 had nothing to recompute) |
| `r1-closed-day-points` (run_day 2026-11-01, closed_day 2026-10-31) | holders=7, with_derived_row=7, trustworthy=6, with_closed_day_point=6 |
| `r2-zero-legacy-and-linked` | all_keys_linked: holders=4, with_derived_row=4, trustworthy=4, with_closed_day_point=4. no_legacy_row: holders=3, with_derived_row=3, trustworthy=3, with_closed_day_point=3 |
| `cron-state` | 4 jobs active: compute_bridge_outcome_deltas `0 3 * * *`, derive-allocator-key-dailies `40 0 * * *`, poll-allocator-positions `0 1 * * *`, refresh-allocator-equity `30 1 * * *` (expected until plan 12). No open retired-kind jobs. |

**Shortfall (181 SC-4 rewritten, D-01):** 1 of 7 holders has no closed-day derived point. That book is refused
`account_duplicate`, which Phase 183 DUPCOUNT fixes. It does not reopen PR 1.

**Browser check of /allocations:** done by the orchestrator in the founder's Chrome, read only,
2026-11-01 about 07:08Z.
- no "Limited equity history" / rebuilding banner: yes
- no "Only N months of history" copy: yes
- Overview equity chart renders for a ready book: yes ("DERIVED FROM PER-KEY RETURNS + FLOWS"), with the D-08
  recorded-equity note present.

**Finding routed outside this phase:** the viewed book's derived curve carries 6 days with |r| above 50%, all
from one Deribit key whose writer chain gives r = pnl / previous level, each beside a same-day flow of 100% or
more of the balance. This is the Deribit flow-timing defect Phase 185 DERIBITFLOWTIME was booked for. It is a
derive-input defect, not a reader defect, so it does not block PR 2.

## Deviations

- No `apply.log` / `first-night.log` files: the post-merge readings were collected in a single local
  `post.log`. Task 2's `ledger-row` / `body-check` forms were not logged separately; see Task 2 above for the
  evidence used instead.
- The migration-reviewer / rls-policy-auditor verdicts are not on record (see Task 1).
- No commits from this plan: the PR 1 release commit is on main (#1164) and the ship branch changes nothing
  under `.planning/`.

## Self-Check: PASSED
