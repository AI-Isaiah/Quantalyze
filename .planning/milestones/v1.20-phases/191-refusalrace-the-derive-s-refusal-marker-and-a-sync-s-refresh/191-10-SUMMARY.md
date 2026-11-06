---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 10
subsystem: database
tags: [ship, sc-5, prod-reading]
requirements-completed: [SC-5]
completed: 2026-11-05
---

# Phase 191 Plan 10: PR 2 ship and post-deploy PROD reading Summary

review-pr2: clean (round 2)
pr2-pr: #1202
pr2-head: a6420c245c4fea5806779c36d41c6a96e7d80a7b
changelog-pr2: ## [0.133.22.3] - 2026-11-05
pr2-checks: 2 runs for head a6420c245c4fea5806779c36d41c6a96e7d80a7b, all success
live-probe-ci: run=41986726465 head=a6420c245c4fea5806779c36d41c6a96e7d80a7b python=success
pr2-merge: 976f67ece637e2b0a693ae2eb94fb1d6d0428dca

## Ship notes

- The first CI run for PR 2 failed only `sql-mutation`: `ubuntu-latest` had moved to an image whose PostgreSQL major is 18, and the lane asserts 16. PR #1203 (v0.133.22.2) pinned the lane jobs to `ubuntu-24.04`; PR 2 merged main and was renumbered to v0.133.22.3. Nothing in PR 2's code changed for it.
- The pre-push redaction hook flagged the loopback-guard test fixtures' fake `user:password@` URLs; the fixtures lost the password (the guard checks the host only), commit `8aa30bbaf`.

## Post-deploy PROD reading

sc5-deploy: merge=976f67ece637e2b0a693ae2eb94fb1d6d0428dca railway=976f67ece637e2b0a693ae2eb94fb1d6d0428dca vercel=976f67ece637e2b0a693ae2eb94fb1d6d0428dca deployed_at=2026-11-05T07:47Z main_ci=3 runs, all success
marker-sc5: PRODUCTION
sc5: retained_jobs 2949
sc5: jobs_with_read_refusal_kept_figures 0
sc5: jobs_with_refresh_marker_retracted 0
sc5: jobs_with_both 0
sc5: jobs_still_marked_refresh 180
sc5: marker_write_failures 0
sc5: derives_finished_after_deploy 34
sc5: marker_write_failures_after_deploy 0
sc5: jobs_marked_kept_figures_after_deploy 0
sc5: jobs_retracted_after_deploy 0
sc5-catalogue: mark_compute_job_kept_figures secdef=t search_path=public, pg_catalog anon=f authenticated=f public=f service_role=t
sc5-catalogue: retract_ledger_refresh_marker secdef=t search_path=public, pg_catalog anon=f authenticated=f public=f service_role=t
sc5-sentry: 0 events since deploy (python=0 keys_sync=0 finalize_wizard=0)

Read on 2026-11-06 at 07:05Z, after the 00:40Z nightly. The marker ran first and alone. Vercel production deployed the merge at 07:37Z and Railway at 07:47Z, so `deployed_at` is the later of the two. The Sentry counts cover the last 24 hours, a window that starts before the deploy and includes everything after it.

## Reading

Done jobs are reaped at 30 days and failed jobs at 90, so a count lower than its SC-1 twin is not by itself a regression.

- `retained_jobs`: 2949 now, against 2913 at SC-1. The retained set moves with the daily fan-out and the reaper.
- `jobs_with_read_refusal_kept_figures`: 0, as at SC-1. No refusal kept figures in the window, so neither writer's merge was exercised on PROD.
- `jobs_with_refresh_marker_retracted`: 0, as at SC-1. No retraction occurred.
- `jobs_with_both`: 0, as at SC-1. No job carries both keys, so this window could not show the race.
- `jobs_still_marked_refresh`: 180, against 194 at SC-1. Old refresh-marked jobs are being reaped, and none of the change is unexplained.
- `marker_write_failures`: 0, as at SC-1. After the deploy, 34 derives finished with no marker-write failure, and both functions keep their SECURITY DEFINER, search path and grants.

sc5-verdict: confirmed

## Verify note

Task 1's verify ends with `test -z "$(git ls-files -- '*sc5.sql' '*catalogue.sql')"`. The glob also matches two repo files that have been on main since 2026-09-24 (`scripts/local-stack/acl-fidelity-catalogue.sql` and `scripts/local-stack/nonpublic-catalogue.sql`), so this step fails no matter what this phase does. Every other condition of that verify passes, and none of the phase's scratch SQL files is tracked: the only tracked files named `sc1.sql`, `sc5.sql`, `marker.sql` or `catalogue.sql` are `docs/runbooks/marksource-okx-census/marker.sql`, which belongs to an earlier phase, and nothing else; the only tracked path outside the phase directory that names the phase is its own migration. The other three verifies pass.
