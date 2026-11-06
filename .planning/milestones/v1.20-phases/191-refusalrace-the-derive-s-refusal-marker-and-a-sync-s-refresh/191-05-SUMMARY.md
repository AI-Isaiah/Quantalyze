---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 05
subsystem: database
tags: [ship, sc-4, prod-reading]
requirements-completed: [SC-4]
completed: 2026-11-04
---

# Phase 191 Plan 05: PR 1 ship and PROD catalogue check Summary

sc4-migration-reviewer: clean (round 1)
sc4-rls-policy-auditor: clean (round 1)
review-pr1: gsd-code-reviewer and silent-failure-hunter, 3 rounds; round 1 CR-01 HIGH and WR-01 MEDIUM, round 2 WR-02/WR-03/WR-04 MEDIUM, all fixed; round 3 clean from both (191-REVIEW-PR1.md)
pr1-migration-name: 20261106120000_refusalrace_metadata_merge_rpcs.sql (unchanged)
rename-rerun: not-needed
pr1-pr: #1200
pr1-merge: a363392ea668488c50090c7ed0555d103b22bd30
pr1-main-ci: 5 runs, all success
migrate-run: 41932983784 head=a363392ea668488c50090c7ed0555d103b22bd30 apply-test=success apply=success
marker-pr1: PRODUCTION
prod-fn: mark_compute_job_kept_figures secdef=t search_path=public, pg_catalog anon=f authenticated=f public=f service_role=t
prod-fn: retract_ledger_refresh_marker secdef=t search_path=public, pg_catalog anon=f authenticated=f public=f service_role=t
prod-ledger: 1
pgrst-reload: event-trigger 2
redump: deferred to the house re-dump release
gate-pr2: open

## Reading

- PR 1 (#1200) merged at 23:20Z on 2026-11-04 with every check on its head green except
  `sql-gate-lint`'s baseline content-drift step, which read SNAPSHOT_MISSING for the two new
  functions: the expected stale-baseline state before the post-apply re-dump.
- On the merge commit, CI's only red job is the same `sql-gate-lint` step for the same reason;
  Supabase Migrate run 41932983784 ran `apply-test`, `apply`, `redump-dump` and `redump-pr`, all
  success. The `pr1-main-ci` line counts that stale-baseline red as green under the repo's
  standing rule; it is recorded here so the count is not read as five unconditional successes.
- Before the push, PROD's ledger tip read `20261105120000`, so the migration sorts after it.
- After the apply, the marker named PRODUCTION first and alone, then the catalogue, the ledger
  row and the PostgREST event triggers were read. No statement wrote.
- The re-dump PR is #1201 (v0.133.22.1); it also deletes the two `NAME_SET_RATCHET` rows whose
  clearing condition it meets.

## Deviations from Plan

- Shipped by hand rather than through `/gsd-ship` and `/land-and-deploy`, following the same
  CHANGELOG, version, `.planning`-free and head-bound-check rules.
- Review took three rounds, recorded in `191-REVIEW-PR1.md`.

## Self-Check: PASSED
