---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
verified: 2026-11-24T16:45:00Z
status: human_needed
verified_at_sha: 981e341100db5906f23788a93f7c8d117c46e00c
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - supabase/migrations/20261124120000_jobledger_attempt_failures.sql
  - supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql
  - supabase/migrations/20261124120200_compute_job_claim_renewal.sql
  - supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql
  - supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql
  - supabase/migrations/20261124120500_poll_positions_cohort.sql
  - supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql
  - supabase/migrations/20261124120700_sanitize_user_attempt_failures.sql
  - supabase/schema/functions/mark_compute_job_failed.sql
  - supabase/schema/functions/record_compute_job_attempt_error.sql
  - supabase/schema/functions/reset_stalled_compute_jobs.sql
  - supabase/schema/functions/reclaim_stuck_compute_jobs.sql
  - supabase/schema/functions/renew_compute_job_claims.sql
  - supabase/schema/functions/record_reconcile_readmit_exhaustions.sql
  - supabase/schema/functions/first_hop_enqueue_sweep.sql
  - supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql
  - supabase/schema/functions/record_orphan_reaped_attempt.sql
  - analytics-service/main_worker.py
  - analytics-service/services/readmit_ceiling_alert.py
  - docs/runbooks/jobledger-go-live.md
human_verification:
  - test: "HEAL-01 PROD go-live: after merge and the PROD apply of 20261124120400, follow docs/runbooks/jobledger-go-live.md (P0 marker query, P1 to P6 pre-flight, Step 1 registration of hourly first_hop_enqueue_sweep at minute 55, Step 1b evidence read, Step 2 manifest re-capture)"
    expected: "cron.job holds one active first-hop-enqueue-sweep entry, the manifest agrees with live PROD, and the first tick returns the documented jsonb counts"
    why_human: "The sweep is deliberately NOT scheduled by any migration (vitest jobledger-migrations-schedule-nothing pins this); registration is a post-merge PROD write. Until it is done the dropped-first-enqueue heal does not run in production. REQUIREMENTS carries HEAL-01 as Blocked (PROD go-live pending)."
  - test: "PR CI: local-stack lane (sql-tests with every phase migration applied), VAC-04 body-hash acknowledgements for the five re-based functions (mark_compute_job_failed, reset_stalled_compute_jobs, reclaim_stuck_compute_jobs, enqueue_poll_positions_for_all_strategies, sanitize_user), baseline-content-drift expected red until re-dump"
    expected: "sql-tests green, VAC-04 reports the same hashes as the migration headers"
    why_human: "Docker is unavailable on the verification host; these proofs come from the PR's CI."
---

# Phase 227: JOBLEDGER Verification Report

**Phase Goal:** A failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job (seam S3).
**Verified:** 2026-11-24T16:45:00Z at HEAD 981e341100db5906f23788a93f7c8d117c46e00c
**Status:** human_needed (every truth verified in code; three post-merge or pre-merge human items remain)
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria 1 to 6)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Attempt 1 fails, attempt 2 succeeds: attempt 1's cause stays readable; a stall or watchdog reset leaves a reason distinct from a real error; the M-1137 `last_error` clear on re-claim still holds (MT5D-01) | VERIFIED | `compute_job_attempt_failures` (migration 0000:126) is append-only: RLS on, no policy, `REVOKE ALL ... GRANT SELECT` to service_role only, no FK to `compute_jobs` (survives retention prunes), `cause_class` CHECK over `error / watchdog_reset / stall_reclaim / orphan_reaped`, `UNIQUE (job_id, claim_token, cause_class)`. `mark_compute_job_failed` inserts the `error` row in the failing transaction, before any later claim. `claim_compute_jobs_with_priority.sql:405` still carries `last_error = NULL -- M-1137/M-1138` and the claim pair is untouched in the diff. `reset_stalled_compute_jobs` (both passes) and `reclaim_stuck_compute_jobs` write `watchdog_reset` / `stall_reclaim` rows via a data-modifying CTE, so class tells stall from error. `record_orphan_reaped_attempt` trigger records reaped orphans. Worker-lost real errors go through `record_compute_job_attempt_error` (token-attested). Lane gate `test_compute_job_attempt_failures.sql` re-run by me: baseline exit 0, 22/22 arms biting (E1 drives attempt 1 fail, attempt 2 done, cause readable, last_error cleared); `test_orphan_reaped_attempt_record.sql` 4/4 biting. |
| 2 | A finalize-wizard strategy whose first `sync_trades` enqueue dropped is re-enqueued or shown in a named state, by its own mechanism (key present, no job ever, longer grace); a healthy new strategy is not caught (HEAL-01) | VERIFIED (code); mechanism not live in PROD until go-live, see human item 1 | `first_hop_enqueue_sweep()` is its own SECDEF function and table `first_hop_enqueue_retries`, not a predicate on `reconcile_dropped_enqueue_sweep`. Candidate = private, live key, no `compute_jobs` row on the strategy and no in-flight key-scoped job (allocator-book kinds excluded), no trades / csv returns / `strategy_keys`, analytics absent or `pending`. Grace is 90 minutes from the sweep's own first observation; re-enqueue once (`ON CONFLICT DO NOTHING`, stamped); after a failed retry the named state is `failed` plus one fixed sentence, guarded to `pending` rows only. Healthy look-alikes (H10a-d, H6b) are excluded by arms. Gate `test_first_hop_enqueue_sweep.sql` re-run: baseline exit 0, 23/23 arms biting. Registration is runbook-only (`docs/runbooks/jobledger-go-live.md`, 391 lines, marker-guarded); the only `cron.schedule` text in the eight migrations is a comment, and vitest `jobledger-migrations-schedule-nothing` passes. |
| 3a | A `derive_allocator_equity` job behind a long-running batch-mate runs once, never reset and run twice (HEAL-02) | VERIFIED | `renew_compute_job_claims(uuid[], uuid[])` is a token-fenced SECDEF lease renewal (renews only status `running` under its own `claim_token`; the watchdog NULLs the token so a reset row cannot be renewed). Worker (`main_worker.py` dispatch_tick ~1130-1210) renews the job and its waiting batch-mates before each dispatch and skips a job the watchdog took (`CLAIM_FENCE_SKIP`); `_heartbeat` (1327) renews waiting rows only, never the running one, throttled and bounded. Lane gate `test_compute_job_claim_renewal.sql` re-run by me: R1 (25-minute waiter renewed, real watchdog with the 20-minute override does not reset it) 5/5 biting. pytest `tests/test_main_worker.py` + `tests/test_readmit_ceiling_alert.py`: 123 passed, including fence-skip, heartbeat-renews-waiting-only, renew-error and renew-hang cases. |
| 3b | A readmit that reaches its ceiling emits the founder-chosen signal, and the signal outlives the job rows' retention (HEAL-03) | VERIFIED | Founder ruling (CONTEXT, 2026-11-23): durable row plus page through `ops_alert`. `reconcile_readmit_exhaustions` has no FK to `compute_jobs`, `UNIQUE (strategy_id, generation_key)`; `record_reconcile_readmit_exhaustions()` reuses the sweep predicate with the ceiling inverted, pinned by vitest `readmit-exhaustion-predicate-parity` (passes). `services/readmit_ceiling_alert.py` calls the detector then pages through `ops_alert`, stamping `paged_at` only after delivery; wired from `watchdog_loop` behind its own guard. Gate `test_reconcile_readmit_exhaustions.sql` re-run: 9/9 biting; pytest `test_readmit_ceiling_alert.py` passes. |
| 4 | A job reclaimed after a crash keeps its curated error sentence, and its strategy's analytics status follows the reclaim; the lane arm that re-stamps a different sentence under the same job id shows the reclaimed one surviving (HEAL-04) | VERIFIED | Both `reset_stalled_compute_jobs` and `reclaim_stuck_compute_jobs` now loop sorted `(strategy_id, kind)` and call `sync_strategy_analytics_status` under the bridge advisory lock. Arm B1 of `test_reset_stalled_bridge_provenance.sql` seeds S1 and markers, resets, asserts strategy reads `computing` with sentence and markers NULL, then restamps a different S2 under the SAME job id and asserts S2 / writer / job id survive. Re-run by me: baseline exit 0, 6/6 arms biting (B4 is the reclaim variant). |
| 5 | The daily positions poll enqueues private strategies too, and the `poll_positions` enqueue stays live (HEAL-05) | VERIFIED (with a recorded cohort caveat) | `enqueue_poll_positions_for_all_strategies` status list now `published, pending_review, private`, key liveness conjunct added, health = done `sync_trades` job OR `strategy_sync_cursors` row inside 30 days; still calls `enqueue_compute_job(... 'poll_positions' ...)` and the worker's daily loop still calls the RPC. Gate `test_enqueue_poll_positions_cohort.sql` re-run: 11/11 biting. Fresh PROD measurement (orchestrator, 2026-11-23, 227-06-SUMMARY): cohort 1 -> 7, 3 private strategies newly enter; widening is not inert. Caveat recorded in the SUMMARY, not hidden: 6 other private strategies with a live key have neither a recent cursor nor a recent done job and stay outside the cohort on today's data. The health conjunct was the planner's call (CONTEXT:26), so this is a design limit and not a gap against the SC wording. |
| 6 | PROOF-01: each gate RED on neutered copy with named arm first, restored from byte backup and GREEN, recorded verbatim; RED-UNDER twins and RED-UNDER-SETUP; raising retries or a threshold is not a close; migrations pass migration-reviewer and rls-policy-auditor before merge, in the serial lane | VERIFIED | All seven new gates carry RED-UNDER twins on every arm; I ran each through `scripts/mutation-runner/run.mjs --file`: every arm RED with identity ok, baseline and restore exit 0, working tree clean afterwards (names: claim_renewal 5, poll_cohort 11, bridge_provenance 6, orphan_reaped 4, readmit_exhaustions 9, first_hop 23, attempt_failures 22 = 80 arms, 0 waived). Plan SUMMARYs record neuter / RED / `cp` back / `cmp` exit 0 / GREEN (cmp evidence present in plans 01-08 and 11). Per user brief: full mutation run 990/990 biting. Vitest floors/census tests (`mutation-runner-floors`, `drift-check-scripts`) pass. No retry count or watchdog threshold was raised. Reviewer half DONE (orchestrator addendum below): migration-reviewer clean at 7c547514f, rls-policy-auditor clean. Rollbacks live in `supabase/migrations/down/` off the auto-apply path. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| 8 migrations 20261124120000..700 | VERIFIED | Present, substantive (1 to 778 lines each), each with catalogue self-verify and manual rollback in `down/`. |
| `compute_job_attempt_failures`, `reconcile_readmit_exhaustions`, `first_hop_enqueue_retries` tables | VERIFIED | RLS on, no API-role access, no FK to `compute_jobs`; ledger erased with owner (cascade columns and `sanitize_user` migration 0700), GDPR manifest updated. |
| Functions: `record_compute_job_attempt_error`, `renew_compute_job_claims`, `record_reconcile_readmit_exhaustions`, `first_hop_enqueue_sweep`, `record_orphan_reaped_attempt` and re-based `mark_compute_job_failed`, `reset_stalled_compute_jobs`, `reclaim_stuck_compute_jobs`, `enqueue_poll_positions_for_all_strategies` | VERIFIED | Present in `supabase/schema/functions/` snapshots matching the migrations. |
| `analytics-service/services/readmit_ceiling_alert.py`, `main_worker.py` changes | VERIFIED | Substantive, wired (import at main_worker.py:116, call in `watchdog_loop`). |
| `docs/runbooks/jobledger-go-live.md`, `compute-queue.md` section | VERIFIED | Present. |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| `mark_compute_job_failed` | ledger | WIRED | INSERT in the failing transaction, ahead of the claim's `last_error = NULL`. |
| watchdog / reclaim | ledger + status bridge | WIRED | CTE insert plus sorted bridge loop. |
| worker dispatch_tick / `_heartbeat` | `renew_compute_job_claims` | WIRED | Pre-dispatch fence and heartbeat both call `_renew_claims`; error and hang paths bounded. |
| worker failure paths | `record_compute_job_attempt_error` | WIRED | Lock-bound (55P03) and late-mark (55006 / not-running) branches, class-only logging. |
| `watchdog_loop` | `page_readmit_exhaustions` -> detector RPC -> `ops_alert` | WIRED | Guarded; source `reconcile_readmit_ceiling` in both Python and TS contracts. |
| `first_hop_enqueue_sweep` | pg_cron | NOT SCHEDULED BY DESIGN | Registered by hand at go-live per runbook (human item 1). |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Ledger rows | cause, error_text | `compute_jobs` row columns at failure / reset time | Yes (copied from the job row or the attesting ledger row) | FLOWING |
| Exhaustion page | strategy id, count, generation key | detector over `strategies` / `compute_jobs` markers | Yes | FLOWING |
| Poll cohort | strategy ids | `strategies` join `api_keys` plus job or cursor | Yes (PROD measurement 1 -> 7) | FLOWING |

### Behavioral Spot-Checks (run by this verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 7 SQL gates, baseline green and every arm biting | `node scripts/mutation-runner/run.mjs --file supabase/tests/<gate>.sql` x7 | all baselines exit 0, 80/80 arms RED with identity ok, restores exit 0, tree clean | PASS |
| Worker fence / heartbeat / lost-mark / readmit page | `.venv/bin/python -m pytest tests/test_main_worker.py tests/test_readmit_ceiling_alert.py` (from analytics-service) | 123 passed | PASS |
| Schedule-nothing census, predicate parity, floors, drift-check | `npx vitest run` on 4 files | 4 files, 1099 tests passed | PASS |
| Full-suite figures (user-supplied, not re-run): mutation 990/990, pytest 15280/0, mypy strict clean, vitest 2 pre-existing failures in `compute.conventions.test.ts` identical on origin/main plus 2 load timeouts passing alone | n/a | accepted per brief | NOTED |

### Probe Execution

No `probe-*.sh` declared by the phase. Not applicable.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|-------------|--------|----------|
| MT5D-01 | 01, 02, 07, 08, 10, 11 | SATISFIED | Truth 1 |
| HEAL-01 | 05, 10, 11 | SATISFIED in code; PROD registration pending (Blocked in REQUIREMENTS, human item 1) | Truth 2 |
| HEAL-02 | 03, 08, 10, 11 | SATISFIED | Truth 3a |
| HEAL-03 | 04, 09, 10, 11 | SATISFIED | Truth 3b |
| HEAL-04 | 02, 10, 11 | SATISFIED | Truth 4 |
| HEAL-05 | 06, 10, 11 | SATISFIED | Truth 5 |

All six IDs appear in PLAN frontmatter and in REQUIREMENTS.md; no orphaned requirement is mapped to Phase 227 without a plan. REQUIREMENTS.md checkboxes are still `[ ]` and the traceability rows still read Pending (HEAL-01 Blocked); updating them belongs to phase completion.

### Anti-Patterns Found

None blocking. No `TBD / FIXME / XXX` markers in the migrations, the new Python module or the first-hop gate. 227-REVIEW.md round 3 is clean (0 Critical, 0 Warning, 7 Info) and 227-SECURITY.md is `secured` with 0 open threats.

### Human Verification Required

1. **HEAL-01 PROD go-live (post-merge).** Run `docs/runbooks/jobledger-go-live.md` after the PROD apply: marker query first, P1 to P6, Step 1 registration at minute 55, Step 1b evidence read, Step 2 manifest re-capture. Expected: one active `first-hop-enqueue-sweep` cron entry, manifest equals live PROD, first tick returns the documented counts. Why human: deliberately not a migration, a PROD write.
2. ~~migration-reviewer and rls-policy-auditor~~ CLOSED by the orchestrator, see the addendum.
3. **PR CI proofs** the host cannot produce (no Docker): local-stack `sql-tests` with the phase migrations applied, VAC-04 hash acknowledgements for four re-based functions, baseline-drift red expected until the re-dump.

### Gaps Summary

No code gaps. The phase goal is achieved in the codebase: failed-attempt causes are recorded in an append-only ledger ahead of the unchanged M-1137 clear; watchdog resets and reclaims record their cause and re-derive the strategy status; claim renewal stops a queued derive job from being reset twice; a readmit ceiling leaves a durable row and a delivered page; the poll cohort covers private strategies. Status is `human_needed` solely for the post-merge HEAL-01 registration, the owed pre-merge reviewer runs, and CI-only proofs. One observation for the founder, recorded in 227-06-SUMMARY and not a gap: on today's PROD data 6 live-key private strategies stay outside the poll cohort because they have neither a recent cursor nor a recent done sync job.

---

_Verified: 2026-11-24T16:45:00Z_
_Verifier: Claude (gsd-verifier)_


## Orchestrator addendum (2026-11-24)

Human item 2 (SC-6 reviewer half) is closed. Both reviewers ran in the review rounds; their verdicts were reported to the orchestrator and are recorded here:
- migration-reviewer at 412ba5222: 0 CRITICAL / 0 HIGH / 1 MEDIUM (rollback 20261124120000 did not refuse while 20261124120700's sanitize_user deletes from the ledger, = review WR-05). Fixed in 7c547514f. Narrow re-check at 7c547514f: CLEAN, 0/0/0/0.
- rls-policy-auditor at 412ba5222: CLEAN, 0/0/0/0, no leak scopes. The later round-3 diff touched no RLS, grant or policy.
