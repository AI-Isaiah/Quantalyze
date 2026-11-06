---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 12
subsystem: operations
tags: [go-live, PR-2, D-02, D-04, SC-2, cron, R4]
requires: ["176-08", "176-09", "176-10", "176-11", "176-17"]
provides:
  - "PROD cron.job without refresh-allocator-equity (unscheduled by the guarded form, not by a migration)"
  - "scripts/prod-prober/cron-manifest.json re-captured without the refresh row"
  - "PR 2 shipped (v0.133.15.0, #1172), applied to TEST then PROD, worker deployed, re-dump merged (#1174)"
  - "the R4 reading: no legacy row written since the new worker went live"
affects: ["176-13", "176-15", "176-16"]
key-files:
  modified:
    - scripts/prod-prober/cron-manifest.json
status: complete
---

# Phase 176 Plan 12: PR 2 go-live Summary

The refresh cron is gone from PROD, the manifest says so, PR 2 is live on TEST, PROD and both Railway
workers, and a reading taken the next day shows no legacy row written since the new worker went live.
PR 3 (the drop) may proceed.

## Task 1: reviews, unschedule, manifest (2026-11-01)

- Reviews: migration-reviewer and rls-policy-auditor ran on the PR 2 migration in the PR 2 review rounds
  (`176-PR2-REVIEW.md`). The data-dependence lint printed `0 NEW` (83 refusals, 83 allowlisted, 313 migrations).
- PROD, marker form first: it named PRODUCTION.
- `cron-state` before: 4 allocator jobs, all active; `refresh-allocator-equity` at `30 1 * * *` with the
  manifest's command; open retired-kind jobs `none`.
- `unschedule-refresh` read-back: `marker_is_prod` 1, `jobs_named_refresh` 0, `other_allocator_jobs` 3.
- `cron-state` after: 3 jobs (`compute_bridge_outcome_deltas` `0 3 * * *`, `derive-allocator-key-dailies`
  `40 0 * * *`, `poll-allocator-positions` `0 1 * * *`), all active; open retired-kind jobs `none`.
- TEST, marker form first: it named TEST. `test-cron-state` listed 0 jobs named `refresh-allocator-equity`,
  so `unschedule-refresh-test` was not run.
- Manifest: re-captured with `--capture-manifest`; the diff (15 lines) is the removed refresh row plus
  `captured_at`. Prober `--self-test` passed. The census and runbook-forms tests passed (2 files, 321 tests).
  Commit `25b1aa7f7`.

## Task 2: PR 2 shipped and applied (2026-11-01)

- PR #1172, release v0.133.15.0, merge SHA `6c919f4f7` (5 workflow runs bound to it).
- `supabase-migrate.yml` run 41324221495 for the merge SHA: success (`apply-test` then `apply`).
- PROD, marker first: `ledger-row` true; `body-check` on `public.request_allocator_holdings_sync(uuid)` with
  needle `reconstruct_allocator_history`: `proc_exists` true, `body_names_needle` false.
- Both Railway workers deployed `121f71cff`, which contains the PR 2 merge (backfill 16:51:00Z, interactive
  17:04:22Z); main's CI green on it. The R4 instant is the interactive worker's deploy: `2026-11-01T17:04:22Z`.
- The post-apply re-dump PR #1174 (v0.133.15.1) merged.

## Task 3: the next-day reading (2026-11-02)

Read at 2026-11-02 about 13:25Z through the Supabase MCP on PROD, the marker form alone first (it named
PRODUCTION). The read came 20h21m after the R4 instant: not a full 24 hours, but after the UTC day boundary
and after the 01:00Z poll slot and the 01:30Z slot the refresh cron used to occupy.

| Reading | Value | Expected |
|---|---|---|
| `marker_is_prod` | 1 | 1 |
| `legacy_rows_since` | 0 | 0 |
| `refresh_cron_rows` | 0 | 0 |
| `retired_kind_jobs_since_by_status` | none | none or terminal only |

`cron-state`: the same 3 jobs as after the unschedule, all active; `refresh-allocator-equity` absent; open
retired-kind jobs `none`.

Hourly prober run 41440070286 (2026-11-02 11:51Z): `cron-drift: 18 PROD job(s) vs 18 manifest job(s), 0
differing`. It reported one unrelated defect, the Railway ssh arm failing `Unauthorized` on its API token;
that is not a cron drift row and is outside this phase.

Founder go for PR 3: "Next 176 and PR3" (2026-11-02).

## Deviations

- Task 3 was read about 20 hours after the R4 instant, not 24. Both nightly slots the legacy writers used
  had passed, and the founder asked for PR 3 on this day.

## Self-Check: PASSED

`/tmp/legacyretire-12/` holds `unschedule.log`, `apply.log`, `since.txt` and `r4.log`; each passes its
plan-verify line (marker present, no uuid).
