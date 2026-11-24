---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 11
subsystem: ship-records
tags: [schedules-nothing-census, runbook, validation-map, heal-01-hold, ship-records]
status: complete

requires:
  - phase: 227-01..10
    provides: "seven migrations 20261124120000 to 20261124120600, seven gates, worker wiring, censuses"
provides:
  - "src/__tests__/jobledger-migrations-schedule-nothing.test.ts: 25 tests, seven suffix groups plus four calibration cases"
  - "a Phase 227 section in docs/runbooks/compute-queue.md for operators"
  - "the filled 227-VALIDATION.md map: 30 task rows, HEAL-03 row corrected, two open Manual-Only rows, Wave 0 ticked"
  - "HEAL-01 held Blocked in REQUIREMENTS.md (checkbox unticked)"
  - "the verified ship records below (items 1 to 9)"
affects: [phase 227 ship, the phase agent's post-merge go-live and bookkeeping PR]

plan_head_before: c5cdee43edb8c8eef24d919e19e7bf4674118283
plan_head_after: ed72b0ab42b9e799a7017abac15077d891be4317
commits: 3

actuals:
  tokens: 45000
  tasks: 3
  commits: 3

key-files:
  created:
    - src/__tests__/jobledger-migrations-schedule-nothing.test.ts
  modified:
    - docs/runbooks/compute-queue.md
    - .planning/phases/227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate/227-VALIDATION.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "HEAL-01 is recorded nowhere as delivered: its Traceability cell is Blocked and its checkbox stays unticked until the post-merge go-live evidence exists (ship record 7)"
  - "The census builds both pg_cron tokens from parts, so the test file carries the dotted call zero times (grep -c prints 0)"

requirements-completed: []

duration: 55min
completed: 2026-11-24
---

# Phase 227 Plan 11: Close-out Summary

**A vitest census fails the build if any of the seven JOBLEDGER migrations ever schedules a job, the operator runbook explains the new ledger, the renewed claims, the first-hop sweep and the readmit page, and HEAL-01 is held Blocked until the PROD registration is evidenced.**

`commits: 3` counts the three task commits (`plan_head_before..plan_head_after`); the SUMMARY commit follows them.

## Task 1: the schedules-nothing census (tracer)

`src/__tests__/jobledger-migrations-schedule-nothing.test.ts` mirrors the tradesync and outagealert censuses. For each of the seven suffixes it asserts: exists exactly once, reads non-empty and carries its anchor, raw text after `'a' || 'b'` folding carries neither pg_cron token. Both tokens are built from parts. Four in-memory calibration cases prove the scan catches a token in a comment, in a concatenation and in the unschedule form, and passes clean prose.

`npx vitest run src/__tests__/jobledger-migrations-schedule-nothing.test.ts`: `Tests 25 passed (25)`. `grep -c "cron\.schedule" src/__tests__/jobledger-migrations-schedule-nothing.test.ts` prints 0.

### RED proof (PROOF-01), verbatim

Backup, then append a comment line carrying the schedule token (assembled in the shell from parts) to the plan 05 migration, then run the named test:

```
cp supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql <scratch>/fhes.bak ; cmp -s ... -> backed
(appended one comment line carrying the dotted schedule call and a schedule argument list)
FAIL  |jsdom| src/__tests__/jobledger-migrations-schedule-nothing.test.ts > 227 JOBLEDGER migrations schedule nothing (SC-2) > _first_hop_enqueue_sweep.sql > contains no pg_cron schedule or unschedule call, comments included
AssertionError: 20261124120400_first_hop_enqueue_sweep.sql carries cron.schedule. Registration is a post-merge live op through docs/runbooks/jobledger-go-live.md, never a migration.: expected [ 'cron.schedule' ] to deeply equal []
Test Files  1 failed (1)
Tests  1 failed | 24 passed (25)
```

Restore and re-run:

```
cp <scratch>/fhes.bak supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql ; cmp -s ... -> cmp_exit=0
git status --short supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql  -> (empty)
Test Files  1 passed (1) ; Tests  25 passed (25)
```

Exactly the one arm for that suffix failed, naming the file; the other 24 stayed green. The byte restore was confirmed by `cmp` exit 0 and a clean `git status` for the file.

## Task 2: runbook section and validation map

- `docs/runbooks/compute-queue.md`: new `## Phase 227 JOBLEDGER: attempt causes, claim renewal, first-hop sweep, readmit ceiling` before `## Related files`, subsections (a) to (e): the table, its columns, the four cause classes with their writers, the read order and two read-only queries; the renewed `claimed_at` and the changed meaning of Query 3 (with `src/lib/compute-state.ts` left unchanged and its stale comment recorded); the first-hop sweep (90-minute grace anchored on the sweep's own first observation, once only, the named-state sentence, fires only after registration); the readmit-ceiling page (source `reconcile_readmit_ceiling`, `paged_at` delivery-gated, an unpaged-rows query); the watchdog reset now bridging the status. Counts and causes only.
- `227-VALIDATION.md`: 30 task rows for plans 01 to 11 (`grep -c '^| [0-9][0-9]-[0-9] '` prints 30), the HEAL-03 row corrected (its gates are `test_reconcile_readmit_exhaustions.sql`, `readmit-exhaustion-predicate-parity.test.ts`, `test_readmit_ceiling_alert.py` and `ops-alert-contract-parity.test.ts`; no longer the reconcile sweep gate, which this phase leaves untouched), the orphan_reaped gate added, Wave 0 ticked with plan 10's floors (FILES_FLOOR 92, ARMS_FLOOR 979, sentinel 37/568, COMPARED_FLOOR 143, lint scanned 119), and two open Manual-Only rows (the HEAL-01 go-live with the verbatim `cron.job` read, and the post-apply baseline re-dump). `nyquist_compliant` and `status` untouched.
- Verify: `grep -c compute_job_attempt_failures docs/runbooks/compute-queue.md` prints 4; `grep -c test_reconcile_readmit_exhaustions` on the validation file prints 2; the negated home-path and email grep on the runbook finds nothing; `grep -c "Phase 227 JOBLEDGER"` prints 1; `grep -c orphan_reaped` prints 1 (at least 1 required). `npx tsx scripts/check-planning-hygiene.ts` is OK on every rule.

## Task 3: the HEAL-01 hold

`.planning/REQUIREMENTS.md` line of HEAL-01's Traceability row only: `Pending` to `Blocked (PROD go-live pending: first_hop_enqueue_sweep registration)`. Captured before the commit: `git diff -U0 .planning/REQUIREMENTS.md > req-227.diff` (exit 0, scratch directory), `grep -c '^+[^+]'` prints 1, so one line changed. `grep -c -F "| HEAL-01 | Phase 227 | Blocked ("` prints 1; `grep -c -F -- "- [ ] **HEAL-01**"` prints 1 (checkbox unticked). `git diff --stat TODOS.md CHANGELOG.md VERSION package.json` prints nothing.

The orchestrator's own `requirements.mark-complete` for this plan will report HEAL-01 under `not_found` and leave both surfaces unchanged; that is the hold working, not an error.

## Ship records

Every entry below was located now by `git grep -n -F` / `grep -n -F` on its text. Line numbers are as measured at HEAD of this plan's branch (TODOS.md 5295 lines) and WILL drift, so the ship step relocates by content.

### (1) TODOS entries to delete

The ship PR deletes the last four. HEAL-01 is deleted in the go-live bookkeeping PR (item 7), not by the ship.

| Req | Entry (found by content) | Line | Full extent (measured) |
|---|---|---|---|
| HEAL-01 | checkbox item `(D-05) The wizard/API first-hop enqueue drop is NOT covered` (under `## Phase 143 — recorded deferrals`) | 3893 | lines 3893 to 3900 (eight lines, ends with its `Owned by Phase 227` line; a blank line 3901 follows and the next item starts at 3902) |
| HEAL-03 | bullet `The readmit ceiling is SILENT at exactly the moment it gives up` (inside `### Reliability / observability`, a larger entry list) | 1990 | lines 1990 to 2000 only; it ends at its `Owned by Phase 227 ... HEAL-03` line, and the next bullet `Phase-19 hourly cron never decommissioned` starts at 2001 with no blank line between. Delete that bullet only. |
| HEAL-04 | checkbox item `[164.2-RECLAIM-PROVENANCE]` | 887 | lines 887 to 906; blank line 907; next item `[164.2-SEAMCODE-UNION]` at 908 |
| HEAL-02 | section `### 166.5.1-DERIVE-BATCH-RESET-RESIDUAL` | 5102 | lines 5102 to 5112 (Reading, SC-3 status, Fix, Owner/Trigger and the 2026-10-26 close-out line). It is the ONLY entry under its parent heading `## Phase 166.5.1 (SENTRYTRIAGE) — routed items (logged 2026-10-21)` at 5100, so delete 5100 to 5113 together or the heading is left empty before `## Phase 167.2.1.1` at 5114. Its close criterion (a renewed claim age plus a test reproducing a batch-mate wait past 20 minutes without a reset) is met by plan 03 arm R1 and plan 08. |
| HEAL-05 | section `### FANOUT-COHORT-SIBLING-POLL-01` (under `## Phase 164.9 (TESTISOLATION)`) | 1419 | lines 1419 to 1428; blank 1429; the next section `### SYNC-DRIFT-PAYLOAD-LOGGED-VERBATIM-01` starts at 1430 |

All six `grep -c -F` checks of the plan's verify line printed 1 (each entry found exactly once). None was missing; no substitute was guessed.

### (2) The entry the ship KEEPS and re-points

`[175-NIGHTLY-MT5-DERIVE-CHECK]` is at TODOS.md line 1355 (extent 1355 to 1361; next entry at 1363). Its tail already reads `Owned by Phase 227 JOBLEDGER, v1.22; Phase 230 MT5NIGHTLY, v1.22; REQUIREMENTS.md MT5D-01, MT5D-02`. The ship appends one dated line: Phase 227 shipped the per-attempt record (`compute_job_attempt_failures`, all four cause classes), and Phase 230 owns the close (real nights of records read and explained). Do not delete it.

### (3) Pointers that must not dangle (git grep outside .planning and CHANGELOG.md, measured)

- `164.2-RECLAIM-PROVENANCE`: hits only in this phase's own artifacts, `supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql:7`, `supabase/migrations/down/20261124120100-rollback.sql:28` and `supabase/tests/test_reset_stalled_bridge_provenance.sql:14`, each worded as lineage ("TODOS [164.2-RECLAIM-PROVENANCE]" as the thing this phase closes). Not edited: migrations are applied bytes and the VAC-04 acks bind to them; an id cited as history is not a pointer to an open owner. No fix needed.
- `166.5.1-DERIVE-BATCH-RESET-RESIDUAL`: `analytics-service/main_worker.py:386` and `analytics-service/tests/test_main_worker.py:516`. Both already sit directly above a past-tense "2026-11-23, Phase 227 HEAL-02 CLOSED that residual" paragraph (plan 08). They read as history. The ship PR may leave them, or reword "TODOS [id]" to "the deleted TODOS entry [id]" if the reviewer wants no pointer to a deleted entry; no behaviour is attached.
- `FANOUT-COHORT-SIBLING-POLL-01`: `supabase/migrations/20261124120500_poll_positions_cohort.sql:22`, lineage prose ("asked to decide both conjuncts together"). Same treatment: leave.
- `175-NIGHTLY-MT5-DERIVE-CHECK`: `supabase/migrations/20261124120000_jobledger_attempt_failures.sql:64`, and it is the kept entry, so nothing dangles.
- HEAL-01 and HEAL-03 entries carry no id; their text is cited by no file outside `.planning`. No test or script reads those TODOS entries (the ids appear nowhere in `src/__tests__`, `scripts` or `analytics-service/tests`).
- Nothing outside `.planning` cites any deleted id as an open owner, so no pointer needs repointing in the ship PR.

### (4) CHANGELOG names for the ship entry (each name verified to exist in a phase migration or `src/lib/ops-alert-contract.ts` at HEAD)

- Closed by the ship PR: the TODOS entries for HEAL-03 (`The readmit ceiling is SILENT ...`), HEAL-04 (`[164.2-RECLAIM-PROVENANCE]`), HEAL-02 (`166.5.1-DERIVE-BATCH-RESET-RESIDUAL`) and HEAL-05 (`FANOUT-COHORT-SIBLING-POLL-01`). HEAL-01 is named shipped and inert until registration, never closed; the go-live bookkeeping PR's own entry names it closed.
- Tables: `compute_job_attempt_failures` (migration 20261124120000), `reconcile_readmit_exhaustions` (...120300), `first_hop_enqueue_retries` (...120400).
- RPCs: `record_compute_job_attempt_error` (...120000), `renew_compute_job_claims` (...120200), `record_reconcile_readmit_exhaustions` (...120300), `first_hop_enqueue_sweep` (...120400).
- Re-based: `mark_compute_job_failed` (...120000), `reset_stalled_compute_jobs` and `reclaim_stuck_compute_jobs` (...120100), `enqueue_poll_positions_for_all_strategies` (...120500).
- Trigger: `compute_jobs_record_orphan_reaped_attempt` (...120600).
- ops_alert source: `reconcile_readmit_ceiling` (`src/lib/ops-alert-contract.ts` line 23, and the Python set).
- Cron job: `first_hop_enqueue_sweep`, pending its runbook registration.
- Known limits: HEAL-01 inert until registration; the HEAL-03 population is narrow (INT-1); HEAL-05 is add-alongside debt. Also carry from plan 06's PROD measurement: the widening admits 3 private strategies today, all through the done-job arm, and 6 other private strategies with a live key stay outside the cohort on today's data (recorded, not hidden).
- Also carried: the local-stack proof is owed to CI (no Docker on the executor host; plan 10), and the post-apply baseline re-dump is a follow-up (item 7).

### (5) Before merge

`migration-reviewer` and `rls-policy-auditor` must both come back clean on all seven migrations (ROADMAP SC-6). The VAC-04 acks in plans 01 (one for `mark_compute_job_failed`), 02 (two, `reset_stalled_compute_jobs` and `reclaim_stuck_compute_jobs`) and 06 (one, `enqueue_poll_positions_for_all_strategies`) are earned only if VAC-04 on the PR reports the same hashes; the hashes are in the migration headers and the plan 01, 02 and 06 SUMMARYs. VAC-08 is red on the PR by construction until apply-on-merge. Plan 10 recorded `node scripts/baseline-content-drift-check.mjs` exiting non-zero by design until the re-dump (five SNAPSHOT_MISSING and four DRIFT findings); that is a PR-time red the reviewer should expect, recorded not allowlisted.

### (6) PROD-tip timestamp check (owed to the ship step, immediately before opening the PR)

NOT run by this executor: it needs a PROD read, which the ship step takes (marker query first, MCP or one CLI query per call). What was measured locally now: the seven files are stamped 20261124120000, ...120100, ...120200, ...120300, ...120400, ...120500, ...120600 (all seven present in `supabase/migrations`), and the newest migration on `origin/main` is `20261120120000_auth_user_has_password.sql`, so all seven sort after the origin tip. The PROD tip is still to be read. If any PROD version sorts at or after 20261124120000, re-stamp all seven and move every pointer in the same commit: each gate's `RED-UNDER-SETUP` entry and `RED-UNDER-M` path, every self-verify RAISE text naming its migration, the rollback filenames, each plan's prose. The census in this plan uses suffixes and survives a re-stamp.

### (7) Post-merge go-live (the phase agent's; not run here, no PROD write or registration was made)

In one session, each statement its own call (MCP first, or one CLI query per call, never chained), per `docs/runbooks/jobledger-go-live.md`, whose sections exist at HEAD: P0 (line 136), P1 to P6, Step 1 (line 241), Step 1b (line 262), Step 2 (line 284).

- P0 marker query first; stop unless it names PROD.
- P1 to P3, then Step 1 (registration at minute 55; the runbook's own Schedule section says to re-derive the free minute from the committed manifest, which holds 18 jobs at HEAD).
- Step 1b, the verbatim read-only `SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'first_hop_enqueue_sweep';`. It must return exactly one row: schedule `55 * * * *`, command `SELECT public.first_hop_enqueue_sweep();`, active true. Anything else is a failed go-live: HEAL-01 stays held and the failure is reported.
- Step 2, the manifest re-capture; its diff shows exactly one new row carrying that job.

Then ONE bookkeeping PR to main carries: the re-captured manifest; the evidence pasted beside HEAL-01 in the Phase 227 verification report (the marker result naming PROD, the verbatim `cron.job` row, the manifest diff line); HEAL-01's REQUIREMENTS.md hold lifted (Status cell `Complete`, checkbox ticked, same commit as that evidence); HEAL-01's TODOS entry (lines 3893 to 3900, relocate by content) deleted and named closed in that PR's CHANGELOG entry with its VERSION bump. Until it lands, HEAL-01 is recorded as lane-proven with PROD registration pending, nowhere as delivered.

Before that PR: run every test that reads the manifest and fix any count it pins. `git grep -l "cron-manifest.json" -- src/__tests__ scripts` lists 11 files at HEAD (`scripts/baseline-content-drift-check.mjs`, `scripts/classify-changed-paths.mjs`, `scripts/lint-migration-data-dependence-baseline.txt`, `scripts/accounttruth-census.mjs`, `scripts/lint-app-guc.mjs`, `scripts/prod-prober/arms/cron-drift.mjs`, `scripts/prod-prober/arms/cron-obs.mjs`, `scripts/prod-prober/run.mjs`, and under `src/__tests__`: `accounttruth-census.test.ts`, `legacyretire-runbook-forms.test.ts`, `marksource-okx-census-sql.test.ts`, `marksource-okx-nonworking-keys-exec.test.ts`, `prod-prober-wiring.test.ts`, `readmit-exhaustion-predicate-parity.test.ts`; some are scripts that merely name the file). I did not run them against a changed manifest because the manifest does not change in this plan.

After the PROD apply: regenerate `supabase/schema/baseline.sql` per `supabase/schema/BASELINE.md` "## Regenerating", with the carried-migrations marker in the same commit, and delete the five `NAME_SET_RATCHET` rows plan 10 added in `scripts/dump-sql-functions.ts` once the gate reports them ratchet-stale (as #1294 and #1301 did).

### (8) Post-deploy reading

After the first real night, a read-only count of `compute_job_attempt_failures` rows by `cause_class` on PROD (marker query first). That deploy starts Phase 230's clock. The query is in the runbook section (a). This is the open Manual-Only row in the validation map.

### (9) For the orchestrator to carry forward

- Plan 06 Task 3's fresh HEAL-05 measurement was taken by the orchestrator on 2026-11-23 and is in the plan 06 SUMMARY: cohort 1 strategy today to 7, 3 private added via the done-job arm, none via the cursor arm, 6 private strategies with a live key still outside the cohort. Its reading is carried into the CHANGELOG limits above.
- The HEAL-01 candidate count from the runbook's P3, to be taken at registration and recorded in the bookkeeping PR (RESEARCH census (a) predicted zero keyed strategies without a job).
- Local-stack lanes (`sql-tests`, `frontend-local-stack`, `frontend-live-db-lane`, `python`, `e2e-seeded`, and `npm run test:live-db`) were not run on any executor host; CI must bind to the head SHA before merge (plan 10).
- ship.md ships only on a passed verification, while HEAL-01's PROD evidence exists only after merge: this plan wrote no verification status value; reading the report at ship time is the orchestrator's call, as flagged in the plan.

## Deviations from Plan

None. The census carries four calibration cases beyond the plan's minimum (the same set the outagealert census carries). The Task 1 anchor check (`verify-plan-anchors.mjs`) printed `OK: 1 plan file(s), no stale claims.`

## Known Stubs

None.

## Threat Flags

None. T-227-31: the runbook section and this SUMMARY carry counts and our own names only; the runbook's negated home-path and email grep is clean. T-227-32: mitigated by the census and its recorded RED proof. T-227-33: mitigated by the Blocked hold, verified by the three greps above.

## Self-Check: PASSED

- `src/__tests__/jobledger-migrations-schedule-nothing.test.ts`, `docs/runbooks/compute-queue.md`, `227-VALIDATION.md`, `.planning/REQUIREMENTS.md`: present and committed.
- Commits on the branch: 5c61e18dd (census), 0b3356d95 (runbook and validation map), ed72b0ab4 (HEAL-01 hold).
- STATE.md, ROADMAP.md, TODOS.md, CHANGELOG.md, VERSION and package.json untouched (`git diff --stat` empty for the last four).
