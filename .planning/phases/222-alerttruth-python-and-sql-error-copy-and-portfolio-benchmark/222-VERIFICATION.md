---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
verified: 2026-11-25T16:45:00Z
status: passed
verified_at_sha: a6d13c9c8fecc8d7e14cef6218be5795d57f4a75
score: 4/6 must-haves verified in code; 2 are pending-at-ship (SC-4 reviewer half, SC-5), not gaps
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - supabase/migrations/20261127120000_computation_error_copy_contact_form.sql
  - supabase/migrations/down/20261127120000-rollback.sql
  - supabase/schema/functions/computation_error_copy.sql
  - supabase/tests/test_sync_status_curated_sentence_survives.sql
  - supabase/tests/test_sync_status_marked_refresh_protected.sql
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/csv-finalize/route.test.ts
  - src/lib/wizardErrors.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/portfolio-analytics-adapter.test.ts
  - analytics-service/routers/portfolio.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/services/csv_validator.py
  - analytics-service/tests/test_no_contact_support_copy.py
  - analytics-service/tests/test_portfolio_benchmark_pairing.py
  - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_computation_error_provenance_census.py
pending_at_ship:
  - "SC-4: migration-reviewer and rls-policy-auditor must be clean at MEDIUM+ before merge (migration auto-applies to TEST then PROD on merge, no human gate)"
  - "SC-4: re-pick the migration stamp from origin/main so it sorts after 225 PR-3's 20261126120000_api_keys_venue_server_index.sql; a re-stamp moves filename, rollback, snapshot header, both RED-UNDER-SETUP entries, the self-verify texts and gate prose together"
  - "SC-5: delete TODOS.md [212-CONTACT-SUPPORT-SURVIVORS], [166.4.1-BENCHMARK-OUTAGE-LABEL], [SYNCTRADES-ENQUEUE-DONE] in the ship PR and name them in the CHANGELOG entry (all three are still present at HEAD, as expected before ship)"
  - "Ship PR books the OQ3 TODOS entry (first_hop_enqueue_sweep.sql still says 'contact support'; founder kept it out of this migration) and the SFH-R3-01 entry routed to Phase 251 SYNCSTORE"
  - "Post-merge: read-only PROD catalogue check of the new arms (marker query first); baseline re-dump PR clears the expected baseline-content DRIFT row (supabase/schema/baseline.sql still carries the old arm text)"
---

# Phase 222: ALERTTRUTH Verification Report

**Phase Goal:** Every Python and SQL error sentence a user can read names the real cause and offers only a channel that exists (the contact form, never "contact support"), a portfolio whose benchmark sources all failed says the benchmark is unavailable, not "stale", and `run_sync_trades_job` no longer returns DONE after recording an analytics failure that the bridge then erases to `complete`.
**Verified:** 2026-11-25
**Status:** passed (code-side). Two success criteria are pending-at-ship by agreement, listed above.
**Re-verification:** No, initial verification.
**Requirements:** ERRC-01, ERRC-02, ERRC-03, all three declared in plan frontmatter (01 and 02 carry ERRC-01, 03 carries ERRC-02, 04 carries ERRC-03) and all three present in REQUIREMENTS.md (lines 160-162, traceability rows 287-289, currently "Pending", which the ship/phase-complete step flips). No orphaned requirement.

## Goal Achievement

### Observable Truths (ROADMAP success criteria, SC-2 and SC-3 judged against their NARROWED text)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | No string in `analytics-service` or in the `computation_error_copy` arms says "contact support"; each names the contact form; csv-finalize `ENQUEUE_LOST_RACE_USER_COPY` is byte-equal to the SQL ELSE arm, and the parity test reads the SQL arm | VERIFIED | `git grep -niE "contact\s+support"` over `analytics-service` (non-test) and `supabase/schema/functions/computation_error_copy.sql` plus the new migration's arms: 0 hits (the only hits in the migration are the self-verify's ILIKE negative guard). Five Python sentences changed at the symbol the plan names (exchange.py `validate_key_permissions`, csv_validator.py `_maybe_auto_normalize_percent_form`, job_worker.py enqueue-failure payload and the member-cap stamp, portfolio.py `_fail_vr`). Migration is the only definition of the function in `supabase/migrations/` (grep), re-bases the 20260826120000 body with signature, IMMUTABLE, NOT STRICT, `SET search_path = pg_catalog`, the CANARY comment and the service_role-only ACL; orphaned arm byte-identical. `route.test.ts` parses the ELSE arm from the snapshot with `readFileSync` (no hand-typed oracle). Ran: `test_no_contact_support_copy.py` (ast scan + anti-vacuity self-test + five per-function pins) inside a 66-test pytest run, all passed; vitest `route.test.ts`, `wizardErrors.test.ts`, both `SyncPreviewStep` render tests: 526 passed. |
| 2 | (NARROWED 2026-11-25, OQ1) A total benchmark source failure (no price source, no recent cached day) is stored with a note distinct from the stale-cache note and `stale=false`; amber only when stale; an adapter-level test pins both; no card rebuild | VERIFIED | `routers/portfolio.py`: `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"`; `benchmark_rets is None` writes it, `elif benchmark_stale` writes the stale note; the comparison's `stale` is `benchmark_note == BENCHMARK_NOTE_STALE`, so NO_SOURCE carries `stale: False`. `test_portfolio_benchmark_pairing.py::TestBenchmarkOutageIsNotStale` drives BOTH real exits of `services.benchmark.get_benchmark_returns` (only the source layer patched: clock, cache client, `db_execute`, price fetch) through `_compute_portfolio_analytics` and asserts the two notes and stale flags differ, `benchmark_twr`/`correlation` None, own TWR kept, `partial_data` False. `portfolio-analytics-adapter.ts` `benchmarkNoteTone` is gated on the `stale` boolean only; adapter tests round-trip the NO_SOURCE payload and pin the tone. All passed in my runs. `services/benchmark.py` unchanged (`git diff` shows no change). See Warning W-1 on the unused export. |
| 3 | (NARROWED 2026-11-25, ERRC-03 option a, OQ2, OQ4) On a failed follow-on enqueue in `run_sync_trades_job`: FAILED/`transient` only when nothing is published; a strategy at `complete`, `complete_with_warnings`, or `computing` with `metrics_json` keeps its publish state and gets no failed write; proven through the bridge, RED before the fix | VERIFIED (behavioral) | `job_worker.py`: `_strategy_has_published_numbers` reads status+`metrics_json` BEFORE any write (success statuses, or `computing` with figures). Published or unreadable: no write, DONE. Nothing published: conditional UPDATE (`not_.in_` success statuses, `or_(computing-with-figures excluded)`), then FAILED / `error_kind="transient"` with a constant, id-free operator sentence; a zero-row UPDATE re-reads and returns DONE if published in between (R2-WR-01). Payload keeps its exact five keys and stays unstamped. Behavioral evidence is mine, not the SUMMARY's: I booted the local-stack lane from this worktree (replayed the phase migration, self-verify NOTICE printed), exported the loopback handoff, and ran `test_sync_trades_enqueue_failure_bridge_live.py`: **8 passed** (real handler, real mark RPCs, real status bridge; nothing-published ends `failed` with the transient sentence and reads `computing` between attempts; published and `complete_with_warnings` cases untouched; the race case). Offline enqueue-failure subset of `test_job_worker.py`: 12 passed; provenance census (EXPECTED_INERT_SITES unchanged) and `test_failed_status_logged.py` passed. RED-before-fix is recorded in the 04 SUMMARY (`assert 'complete' == 'failed'`) and again by the three review rounds' own mutations (M1-M5 RED/GREEN, byte-backup restore with `cmp`). I did not re-run a neuter myself (no source edits allowed). Known residuals are recorded, not hidden: see Warning W-2. |
| 4 | The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, and every census it moves moves in the same PR | PARTIAL: code half VERIFIED, reviewer half PENDING-AT-SHIP | Census half: both pinning SQL gates carry the new sentence and list the new migration in `RED-UNDER-SETUP` (confirmed in the file contents); the parity gate `test_compute_jobs_error_kind_copy_parity.sql` is unchanged and deliberately does not load it (its RED-UNDER-M arms mutate the old file). I ran all three SQL gates with `ON_ERROR_STOP` on the lane: curated-sentence (7 arms), marked-refresh (35 arms), parity (all parts) each printed their ALL-ARMS-EXECUTED / ALL PARTS OK notice. `npm run schema:functions:check`: snapshot current (142 functions). `mutation-runner-floors.test.ts`: 133 passed on re-run (one failure on the first run, a host-load timeout class the 01 SUMMARY also records as passing on isolated re-run; the second run was clean). SUMMARY records mutation runner 8/8 and 1/1 biting with the setup entries, and no census value moved. Reviewer half (migration-reviewer, rls-policy-auditor) is a ship-time gate, not yet run. |
| 5 | The three TODOS entries are deleted in the ship PR and named in its CHANGELOG entry | PENDING-AT-SHIP | All three entries are still in `TODOS.md` at HEAD (lines 246, 614, 666), which is correct before the ship PR. Not a code gap. |
| 6 | PROOF-01: each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`) and GREEN, recorded verbatim in the plan SUMMARY; the parity test reads the SQL arm, never a hand-typed oracle | VERIFIED | All four SUMMARYs carry verbatim RED/GREEN records with `cmp` silent after restore: 01 (csv-finalize parity RED on pre-fix code; both SQL gates RED on the pre-fix body with the first failing arm named, plus the documented deviation for the marked gate's arm name; snapshot-wide pin RED on a neutered snapshot), 02 (scan and per-function pins RED naming exchange.py), 03 (router and adapter RED then GREEN), 04 (live nothing-published RED `'complete' == 'failed'`, published-case RED, census RED). The two review-fix rounds add their own RED/GREEN records (WR-01, SFH-01, R2-WR-01). The csv-finalize oracle is `readFileSync` of the snapshot plus an ELSE-arm regex (read in the diff). I re-verified GREEN at HEAD for every gate named above; I did not re-run the REDs. |

**Score:** 4/6 verified in code; SC-4 reviewer half and SC-5 are pending-at-ship by agreement with the orchestrator, not failures.

### Founder decisions in CONTEXT (OQ1-OQ4, ERRC rulings), honored

| Ruling | Honored? | Evidence |
|--------|----------|----------|
| ERRC-01 wording, "use the contact form" everywhere, orphaned arm untouched | Yes | Migration arms and Python strings read as ruled; member-cap string is "use the contact form to ask for a higher limit" |
| ERRC-02 constant `BENCHMARK_NOTE_NO_SOURCE` on the `(None, True)` exit, distinct from stale | Yes | `portfolio.py` |
| ERRC-03 option a, `EXPECTED_INERT_SITES` unchanged | Yes | Payload unstamped, census passes with count unchanged |
| OQ1 value + rule + adapter test, no card | Yes | `benchmarkNoteTone`, no component added |
| OQ2 `transient` | Yes | `error_kind="transient"` |
| OQ4 `computing` with `metrics_json` counts as published; skip the failed write that clears `computation_warned` | Yes | Predicate and live `complete_with_warnings` case |
| OQ3 `first_hop_enqueue_sweep` stays out | Yes | `supabase/schema/functions/first_hop_enqueue_sweep.sql:20` still says "contact support" by design; TODOS entry is a ship-time item |
| Write scope symbol-limited | Yes | `job_worker.py` diff has exactly two hunks (enqueue-failure tail, member-cap string); `portfolio.py` three (constant, note block, `_fail_vr`) |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261127120000_computation_error_copy_contact_form.sql` | VERIFIED | Substantive; applied cleanly on the lane replay; self-verify (catalogue-only, asserts every arm and the ACL) printed its NOTICE. Applies `SET LOCAL lock_timeout` outside a transaction on the lane (psql WARNING), harmless under Supabase's per-migration wrap, matches house style |
| `supabase/migrations/down/20261127120000-rollback.sql` | VERIFIED (exists, 141 lines) | 01 SUMMARY records it was exercised end to end on the lane |
| `supabase/schema/functions/computation_error_copy.sql` | VERIFIED | Names the new source migration; `schema:functions:check` current |
| `analytics-service/tests/test_no_contact_support_copy.py` | VERIFIED | ast scan with anti-vacuity self-test and five pins |
| `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` | VERIFIED | 8 passed on the lane; registered in the live-DB reach roster (`_LANE_SUPABASE_FAIL_IN_CI`), so CI hard-fails rather than skips |
| `src/lib/portfolio-analytics-adapter.ts` `benchmarkNoteTone` | VERIFIED but ORPHANED | See W-1 |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| `csv-finalize/route.test.ts` | `computation_error_copy.sql` snapshot | WIRED | module-scope `readFileSync` + ELSE-arm regex; parity with `copyWrittenToUser()` |
| both SQL gates | new migration | WIRED | `RED-UNDER-SETUP` apply lists contain it; gates pass on the lane |
| snapshot | migration | WIRED | `-- source migration: 20261127120000_...` header; `schema:functions:check` current |
| `run_sync_trades_job` publish read | status bridge branches | WIRED | proven through the real RPCs and bridge on the lane, 8 passed |
| `test_portfolio_benchmark_pairing.py` | real `get_benchmark_returns` | WIRED | only `services.benchmark` source symbols patched |
| `wizardErrors.test.ts` | exchange.py VALIDATION_UNEXPECTED sentence | WIRED | replayed sentence matches; wizardErrors quote updated |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| `strategy_analytics.computation_error` after enqueue failure | transient sentence | `mark_compute_job_failed` then bridge branch (b) `computation_error_copy('transient')` | yes, read back out of the real table on the lane | FLOWING |
| `benchmark_comparison.note` / `stale` | `get_benchmark_returns` exit | real service, source layer patched | yes | FLOWING |

### Behavioral Spot-Checks and Probes

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Enqueue failure through real handler + bridge | live module on lane (`SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `LANE_DB_URL` exported, loopback) | 8 passed | PASS |
| Python copy scan, benchmark pairing, provenance census, failed-status log, reach roster | pytest, 5 files | 66 passed | PASS |
| Enqueue-failure offline subset | `pytest tests/test_job_worker.py -k "EnqueueFailure or enqueue"` | 12 passed | PASS |
| TS gates | vitest, 5 files | 526 passed | PASS |
| SQL gates on lane | `psql -v ON_ERROR_STOP=1 -f` each of three gate files | all printed their success notice | PASS |
| Snapshot currency | `npm run schema:functions:check` | current | PASS |
| mypy strict, touched Python | `mypy --strict services/job_worker.py routers/portfolio.py` | no issues | PASS |
| `tsc --noEmit` | whole project | clean | PASS |
| Mutation-floor census | `vitest mutation-runner-floors.test.ts` | 133 passed (first run 1 timeout failure, re-run clean) | PASS |

Lane teardown: `scripts/local-stack/run.sh down` run; 0 `supabase_*` containers remain; `git status` shows no tracked change from this verification (the one untracked `222-SECURITY.md` in the phase dir was not created by me).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ERRC-01 | 222-01, 222-02 | No user-readable string in analytics-service or computation_error_copy arms says "contact support"; csv-finalize in byte parity, checked by reading the SQL arm | SATISFIED in code | SC-1 evidence. Out-of-scope survivors are by ruling, see W-3 |
| ERRC-02 | 222-03 | Total benchmark source failure shows wording distinct from stale | SATISFIED (as narrowed by OQ1: stored value, rule, adapter test) | SC-2 evidence |
| ERRC-03 | 222-04 | Failed follow-on enqueue never leaves the strategy reading `complete` with no analytics | SATISFIED (as narrowed by option a: nothing-published case; published strategies are left alone) | SC-3 evidence |

### Anti-Patterns Found

None blocking. Debt-marker scan (`TBD|FIXME|XXX`) over the production files changed by the phase: no unreferenced markers introduced. The remaining "contact support" strings in `src/` are test fixtures, test assertions that forbid the phrase, and comments (for example `route.test.ts:799` asserts `.not.toMatch(/contact support/i)`); none is user-readable production copy in the SC-1 scope.

### Warnings (UNCERTAIN or incomplete wiring, none blocking)

- **W-1: `benchmarkNoteTone` has no production caller.** Nothing renders `benchmark_comparison` (the card was deleted in Phase 195 TRIM), so the amber-only-when-stale rule is code plus a test, not a visible behavior. This is exactly the founder's OQ1 ruling and the narrowed SC-2, so it is not a gap, but it means the "page shows it with its own wording" half of the original ERRC-02 wording is not observable anywhere. knip is non-blocking in CI. If a renderer is ever rebuilt, the tone must come from `benchmarkNoteTone` and the stored `stale` flag.
- **W-2: ERRC-03 double-fault residuals are recorded limits, not closed.** (a) The enqueue and the publish read both failing on a never-published strategy leaves today's outcome (T-222-13, logged at ERROR). (b) SFH-R3-01: enqueue fails, a publisher lands between read and write, and the re-read itself raises, so the handler returns FAILED and branch (b) can write `failed` over the freshly published row on the last attempt. Three review rounds disputed its severity; the orchestrator routed it to Phase 251 SYNCSTORE and the ship PR must book it. (c) R3-IN-01: no offline harness reaches the zero-row/re-read branch; only the live module gates it, and that module is CI-enforced through the reach roster. (d) With no `strategy_analytics` row the handler now writes none; the bridge creates it on the FAILED return, the only gap is a mark-RPC failure right after an enqueue failure on a never-written strategy, until the reaper requeues.
- **W-3: Other SQL "contact support" survivors exist by decision.** `supabase/schema/functions/first_hop_enqueue_sweep.sql:20` (OQ3, founder: book a TODOS entry in the ship PR) and `get_user_compute_jobs` user messages (baseline.sql, older migrations, not part of the `computation_error_copy` arms that SC-1 names). The phase goal's sentence "every ... SQL error sentence" is wider than SC-1's text; SC-1 and the founder's OQ3 ruling define what this phase owns, so these are routed, not failed.
- **W-4: The new migration timestamp is provisional.** It must sort after 225 PR-3's `20261126120000_api_keys_venue_server_index.sql`; that migration is not on this branch's base, so the ordering cannot be checked here. Pending-at-ship item above.
- **W-5: Test-host flakiness observed, not caused by this phase.** `mutation-runner-floors.test.ts` failed once on a loaded host and passed on re-run, consistent with the orchestrator's note about host-load timeouts in files this phase does not touch.

### Human Verification Required

None for the code. The ship-time gates (migration-reviewer, rls-policy-auditor, TODOS deletion, CHANGELOG, stamp re-pick, post-merge PROD catalogue check) are listed under `pending_at_ship` in the frontmatter.

### Gaps Summary

No code gaps. The phase goal is achieved in the codebase for ERRC-01, ERRC-02 (as narrowed) and ERRC-03 (as narrowed): the SQL arms and five Python sentences name the contact form and are held by an ast scan, per-function pins, a snapshot-parsing parity test and snapshot-wide pin; the total benchmark outage is stored as "no price source" with `stale=false`; and a failed follow-on enqueue now ends `failed` (reading `computing` while retries remain) for a never-published strategy and leaves a published strategy's state alone, proven through the real handler, real mark RPCs and real status bridge on the private lane (8 passed in my own run). What remains is ship-time work agreed with the orchestrator.

---

_Verified: 2026-11-25T16:45:00Z_
_Verifier: Claude (gsd-verifier)_
