---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 01
subsystem: database
tags: [prod-reading, sc-1]
requirements-completed: [SC-1]
completed: 2026-11-04
---

# Phase 191 Plan 01: SC-1 read-only PROD count Summary

Read-only PROD baseline of the jobs the two metadata writers touch, taken before any code change of this phase.

marker: PRODUCTION
sc1-head: abd44b1901141e203eccb3afa79cc1ad8886166a
sc1-read-at: 2026-11-04T21:22Z

sc1: retained_jobs 2913
sc1: jobs_with_read_refusal_kept_figures 0
sc1: jobs_with_refresh_marker_retracted 0
sc1: jobs_with_both 0
sc1: jobs_still_marked_refresh 194
sc1: marker_write_failures 0

## Reading

The marker query ran first and alone from the PROD-linked main checkout, and its answer equalled
`database_marker` in `scripts/prod-prober/cron-manifest.json`. The counts query ran in its own call
afterwards. Every statement read; nothing was written.

No retained job carries the refusal marker yet. The marker writer shipped with Phase 186 and only
fires when a derive refuses a truncated or failed read, which has not happened on a retained job
since. No retained job carries a retracted refresh marker either, so the retraction has not fired
on a retained job. 194 retained jobs still carry a ledger-refresh `source`, which is the normal
state of refresh jobs that no Sync re-used. No job has failed on the marker write.

Limits:
- `retention_compute_jobs_done` reaps `done` jobs at 30 days and `retention_compute_jobs_failed`
  at 90, so these counts describe retained jobs only.
- A lost write leaves no trace. A zero for `jobs_with_both` is not proof the race never fired; it
  is a baseline for plan 10's no-regression reading (SC-5).

## Deviations from Plan

None. The `marker_write_failures` column was added to the counts query as the plan directs.

## Self-Check: PASSED
