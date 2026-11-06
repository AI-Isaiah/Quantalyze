---
status: passed
verified_at_sha: 7fcb98ceb9c6aa8525fcf910f398bfe9ebd6ec94
drift_subjects:
  - supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql
  - supabase/migrations/down/20261106120000-rollback.sql
  - supabase/schema/functions/mark_compute_job_kept_figures.sql
  - supabase/schema/functions/retract_ledger_refresh_marker.sql
  - supabase/tests/test_compute_job_metadata_merge.sql
  - analytics-service/services/job_worker.py
  - analytics-service/services/ingestion/long_fetch.py
  - src/lib/ledger-refresh-marker.ts
  - src/app/api/keys/sync/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - analytics-service/tests/test_compute_job_metadata_merge_live.py
  - analytics-service/tests/test_compute_job_metadata_merge_parity.py
  - analytics-service/tests/test_compute_job_metadata_merge_privilege.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_ledger_refresh_reuse_collision.py
  - src/lib/ledger-refresh-marker.test.ts
  - src/__tests__/audit-coverage.test.ts
---

# Phase 191: REFUSALRACE Verification Report

**Phase goal:** the worker's refusal marker (`read_refusal_kept_figures`) and a Sync's retraction of a refresh marker both merge into `compute_jobs.metadata` instead of replacing the column, so when the two writes interleave both survive.

**Verdict:** passed. 5 of 5 success criteria verified, 0 gaps, 0 human-verification items.

Method: every claim below was read from code at HEAD, re-run, or (for PROD) taken from the recorded readings in the SUMMARYs. No PROD or shared TEST access was made.

## Success criteria

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Read-only PROD count of marker-carrying jobs and retracted refresh markers, recorded before any code change | VERIFIED | `191-01-SUMMARY.md` records `sc1-head`, `marker: PRODUCTION` and the counts: retained 2913, refusal-marker 0, retracted 0, both 0, still-refresh 194, marker-write failures 0. Taken at the head the phase started from, before the migration commit. Its limits are stated: a lost write leaves no trace, so zero for "both" is a baseline, not proof the race never fired. |
| 2 | Both writers merge into `metadata`, each with a test that goes RED on replace behaviour | VERIFIED | See below. |
| 3 | A concurrency test interleaves the two writes and both keys survive | VERIFIED | See below. |
| 4 | Migration passes migration-reviewer and rls-policy-auditor before merge | VERIFIED (recorded) | See below. |
| 5 | Post-deploy PROD reading confirms no regression | VERIFIED | See below. |

### SC-2: both writers merge

- **Migration** `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` (read in full). Two new functions, each a single `UPDATE` with the merge in the SET expression:
  - `mark_compute_job_kept_figures(uuid)` returns boolean: `metadata = (object ? metadata : {}) || jsonb_build_object('read_refusal_kept_figures', true)`, returns `FOUND`.
  - `retract_ledger_refresh_marker(uuid, text)` returns jsonb: `(metadata - 'source') || {refresh_marker_retracted, correlation_id}`, restricted to `status <> 'done'` and the two ledger-refresh markers; reports `retracted | done | no_marker | no_row`.
  - Both SECURITY DEFINER with `search_path = public, pg_catalog`; REVOKE from PUBLIC, anon and authenticated; GRANT to service_role only; a catalogue-only verify block (no table read, so it applies on schema-only TEST). `enqueue_compute_job` is untouched, as D-01 and the amended SC-2 wording say. Rollback exists under `supabase/migrations/down/`.
- **Python marker**, `analytics-service/services/job_worker.py`: `_mark_job_kept_figures` makes one `ctx.supabase.rpc(MARK_KEPT_FIGURES_RPC, ...)` and raises `RuntimeError` unless the answer is exactly `True` (D-07), inside `_stamp_io` with `_STAMP_OP_REFUSAL_MARKER_WRITE` (a write that did not land fails the job TRANSIENT). No read-modify-write remains.
- **Python retraction**, `analytics-service/services/ingestion/long_fetch.py`: `_retract_refresh_marker_on_reuse` makes one rpc, validates the answer is a dict with a known outcome, handles every outcome, and logs plus captures `no_row` loudly (D-08). It has no table access.
- **TypeScript retraction**, `src/lib/ledger-refresh-marker.ts`: `retractInheritedRefreshMarker` makes one rpc through a quoted-literal name (so the audit scanner still counts it as a mutator), throws on rpc error, non-object answers, unknown outcomes, a foreign marker and `no_row`. Both callers (`keys/sync/route.ts`, `finalize-wizard/route.ts`) use it; no `compute_jobs` metadata update remains in either route.
- **RED on replace behaviour, reproduced by me** (each file replaced with its pre-change version from git, tests run, restored from a byte backup, `cmp` silent, `git status` clean):
  - TypeScript helper reverted: 26 failures across `ledger-refresh-marker.test.ts`, the keys/sync route test and the finalize-wizard route test.
  - Python `long_fetch.py` reverted: 18 failed, 49 passed in `test_ledger_refresh_reuse_collision.py`.
  - Python `job_worker.py` reverted: 12 failed, 96 passed in `test_derive_broker_dailies_dualmode.py`.
  - With the tests restored and the code at HEAD, all are green (below).
- **Mutator accounting** pinned in `src/__tests__/audit-coverage.test.ts` (27 passed): the new rpc name is a mutator and the Sync routes' pragmas stay meaningful.

### SC-3: concurrency

- `analytics-service/tests/test_compute_job_metadata_merge_live.py` runs two real connections on the local-stack lane: one holds the row lock inside a function, the other calls the second function in a thread, a third polls `pg_stat_activity` until the second waits on a `Lock`, then the first commits. Both orders end with the marker key, the retraction keys, `member_progress` and the claim-style `unified_backbone_at_claim` all present and `source` gone. A control (the old read-then-replace) loses the marker, and the test raises if it did not.
- The probe cannot skip in CI: `LANE_DB_URL` unset fails under `CI=true`. The `python` CI job exports it from the lane handoff. CI reading for PR 2's head (run `41986726465`): the `python` job concluded `success` (re-read by me through `gh`, head `a6420c24`).
- RED proof by the plan 09 executor: both functions swapped for read-then-replace bodies on the lane gave 2 failed (marker lost in order 1; `source` back and retraction keys gone in order 2) with the Lock waits still observed, so the failure was the lost write. I could not re-run the live half here (no lane; 4 tests skipped locally, as designed).
- The SQL gate `supabase/tests/test_compute_job_metadata_merge.sql` (13 arms, twins, `RED-UNDER` annotations) is honestly scoped in `191-03-SUMMARY.md`: it proves key preservation in sequence and the single-statement shape of each function, not concurrency. The concurrency proof is the live probe. The phase did not claim otherwise.

### SC-4: reviews

- `191-05-SUMMARY.md` records `sc4-migration-reviewer: clean (round 1)` and `sc4-rls-policy-auditor: clean (round 1)`, recorded before the PR 1 merge, plus three code-review rounds in `191-REVIEW-PR1.md` (round 3 clean).
- Limit: the two reviewer agents' own outputs are not archived in the repo, so the verdict lines are the orchestrator's record. What I could check independently agrees with them: the migration text (ACL named for all three grantees, pinned search_path, plain `CREATE FUNCTION`, catalogue-only verify), the PROD catalogue reading in `191-05-SUMMARY.md` and `191-10-SUMMARY.md`, and `analytics-service/tests/test_compute_job_metadata_merge_privilege.py`. PR 1 (#1200) merged only after these lines were recorded.

### SC-5: post-deploy

- `191-10-SUMMARY.md`: PR 2 (#1202) merged; Railway and Vercel both serve the merge commit; main CI 3 runs, all success (re-read by me). `marker-sc5: PRODUCTION` ran first and alone.
- Reading against the SC-1 baseline: marker-carrying 0 (0), retracted 0 (0), both 0 (0), marker-write failures 0 (0), still-refresh 180 (194, explained by the 30-day reaper), retained 2949 (2913). After the deploy, 34 derives finished with 0 marker-write failures. Both functions still SECURITY DEFINER, pinned search_path, service_role-only. Sentry: 0 events in the watched tags.
- Limit, recorded honestly by the plan: no refusal or retraction occurred in the window, so neither writer's merge was exercised on PROD. "No regression" is confirmed (no write failures, ACL intact, no errors) but the race itself was not observable on PROD. That is the nature of the SC-5 criterion as written, not a gap.

## Tests re-run at HEAD

| Check | Result |
|---|---|
| pytest (from `analytics-service/`): metadata-merge parity, privilege, live, reuse-collision, derive dual-mode | 195 passed, 4 skipped (the 4 live-DB tests; they fail rather than skip under `CI=true`) |
| CI mypy line, verbatim | Success: no issues found in 132 source files |
| vitest `src/lib/ledger-refresh-marker.test.ts` | 30 passed |
| vitest `src/__tests__/audit-coverage.test.ts` | 27 passed |
| vitest `src/app/api/keys/sync/route.test.ts` | 46 passed |
| vitest `src/app/api/strategies/finalize-wizard/route.test.ts` | 171 passed |
| Own neuters (3 files reverted from git, restored from byte backups) | RED as required (see SC-2) |

## Notes, none blocking

- The SC-1 and SC-5 readings are recorded counts from the SUMMARYs; they were not re-read, by instruction.
- `191-10-SUMMARY.md`'s verify note is correct: the glob in plan 10 Task 1's last verify also matches two older repo files (under `scripts/local-stack/`), so that single step fails regardless of this phase. It is a plan-verify defect, not a phase gap.
- Known limit carried forward, not a gap: D-02 (the window between the deduped enqueue and the retraction) is unchanged by design and recorded in the ROADMAP, the TODOS closure and both code docstrings.
- The ROADMAP checkboxes for the phase's plans still read `[ ]`; closing them belongs to `phase complete`.
