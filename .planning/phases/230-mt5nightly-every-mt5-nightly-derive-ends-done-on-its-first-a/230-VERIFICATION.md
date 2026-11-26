---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
verified: 2026-11-26T00:00:00Z
status: human_needed
score: 7/10 must-haves verified
verified_at_sha: ebca5ec64f9ab775ad8bd36ab1d49c9dbaacd806
drift_subjects:
  - analytics-service/services/mt5_xlease.py
  - analytics-service/services/mt5_concurrency.py
  - analytics-service/services/db.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/mt5_relogin.py
  - analytics-service/services/mt5_validation_liveness.py
  - analytics-service/routers/process_key.py
  - analytics-service/scripts/mt5offset_dry_run.py
  - analytics-service/tests/test_mt5_xlease.py
  - analytics-service/tests/test_mt5_xlease_live.py
  - supabase/migrations/20261126140000_mt5_terminal_lease.sql
  - supabase/tests/test_mt5_terminal_lease.sql
  - scripts/mutation-floors.mjs
  - docs/runbooks/mt5-terminal-lease.md
  - docs/runbooks/mt5-clock-replay.md
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "The Python lease client reaches the three lease RPCs through PostgREST and gets Python booleans, exclusivity across 8 independent clients, and expiry takeover on a real database"
    test: "CI python job at the PR head SHA runs analytics-service/tests/test_mt5_xlease_live.py with CI=true on the private local-stack lane (it FAILS, never skips, if the lane variables are absent); CI sql-tests prints a baseline-replay line naming 20261126120000_mt5_terminal_lease.sql and runs supabase/tests/test_mt5_terminal_lease.sql (ALL 8 ARMS EXECUTED)"
    expected: "4 live tests pass; baseline-replay names the lease migration; the gate prints ALL 8 ARMS EXECUTED"
    why_human: "No Docker lane was booted (coordinator load limit 2026-11-25). The live module's logic was only driven against an in-memory fake (plan 07 SUMMARY says so). Presence of the module is not evidence of PostgREST, schema-cache or SQL behaviour."
human_verification:
  - test: "SC-2 (MT5D-02): record seven consecutive nights after BOTH the backfill worker and the API service deploys carry the lease and the migration is applied to PROD. Night 1 is the first 00:40Z derive after the later of those. Run the nightly query in docs/runbooks/mt5-terminal-lease.md section 6 (marker query first), plus the three extra checks."
    expected: "Each night: every MT5 derive_broker_dailies job created in the window is done with attempts=1; no compute_job_attempt_failures row for those jobs; neither service logged mt5_xlease_unavailable; poll_allocator_positions second attempts did not rise; the lease table holds one row per terminal. The seven nights include at least one logged mt5_xlease_waited (a cross-process wait), otherwise the record says 'not discriminating' and the founder decides whether MT5D-02 closes (nine clean nights, 11-06 to 11-14, happened with no fix). No retry budget, watchdog threshold or lease constant raised."
    why_human: "Needs real nights on PROD after deploy. Cannot be met before ship by design. Plan 09 stops at a blocking-human checkpoint and has no SUMMARY, correctly."
  - test: "Plan 09 lane proof: on the private lane, seed with 230-09-night-seed.sql (one MT5 derive job per join path: key-scoped, strategy through strategies.api_key_id, strategy through strategy_keys, plus a non-MT5 job), run 230-09-night-query.sql extracted from the runbook's marked block."
    expected: "The row equals 3|3|2|1|0|1|0|1|0 (the plan 09 verify value), proving the query counts exactly the MT5 derives, second attempts and ledger rows and ignores the non-MT5 job."
    why_human: "Deferred by the load limit to the post-ship session. I confirmed statically that every column the query names exists in supabase/schema/baseline.sql (compute_jobs.api_key_id, strategy_keys.api_key_id, compute_job_attempt_failures.job_id, and the lease table's site), but a static read is not the lane run RESEARCH asked for, because RESEARCH marked those columns [ASSUMED]."
  - test: "SC-3 (MT5D-03): the coordinator runs the read-only capture (script sha256 36aa23fe598ec485791204ec546c5e077e9f610660541a423f8cf62fc1f674e0, write review re-confirmed at 8dbe2a60d, runbook docs/runbooks/mt5-clock-replay.md section 10) on the backfill worker outside 00:40 to 01:40Z and away from the 08:00Z poll, restarts both services, then replays with mt5offset_dry_run --legacy-offset-s 7200 --rule us --days-out and compares the moved day sets with 202's recorded sets (s6, s9, s10, b0 to b1; s2, s5, s8, s13, c0 to c1)."
    expected: "A counts-only line per scope (s2, s5, s6, s8, s9, s10, s13, b0, c0 pairs): attributed to the clock switch, or to a named other cause. The 29 vanished winter rows are recorded under #1196 TINYBASE, #1205 gap closure or 'not attributable', never the clock (7200 and us agree in winter). The repo's record of the setting alone does not count as a replay."
    why_human: "Live capture on the shared terminal is the coordinator's by founder ruling D-02; the phase's agents never run it. Plan 10 stops at a blocking-human checkpoint and has no SUMMARY, correctly. Only the offline hand-off was proven (harness, contract check, seven deliberate breaks caught)."
  - test: "CI head-SHA lane evidence for plan 07 and for the suites not run locally. Once the PR exists, bind each to the head SHA with the expected check count: sql-tests, python (including test_mt5_xlease_live.py under CI=true, coverage floor 80), frontend shards and frontend-coverage, sql-mutation (floors FILES_FLOOR 95, ARMS_FLOOR 1041, WAIVED_CEILING 0 held; full run printed 95 files, 1041 arms, tallies agreeing, in plan 06's transcript at an earlier head), sql-gate-lint, plan-anchor-verify."
    expected: "All green at the PR head SHA. Any census moved by main between now and the push is re-read off the run in the same commit."
    why_human: "The PR head SHA does not exist yet. Plans 06 to 10 ran under a load limit that forbade full suites, mutation runner, e2e and Docker, so no local transcript covers them."
  - test: "Ship-time and post-deploy steps already recorded in plan 08's ship records, which must actually happen: (1) immediately before the PR, marker query then max(version) on PROD, in separate calls, and confirm 20261126120000 still sorts newest (it does at this head: after 20261125212222 from main; it must be re-read because origin/main moves); (2) book [230-MT5-REGISTRY-CROSS-PROCESS-STALE] in TODOS.md (not booked yet: 0 hits) and append the dated lines to [175-NIGHTLY-MT5-DERIVE-CHECK] and 202-MT5-CLOCK-LEAD-01; (3) after the PROD apply, re-dump baseline.sql and regenerate baseline-carried-migrations.txt in the same commit (clears three NAME_SET_RATCHET rows and the SNAPSHOT_MISSING findings); (4) run the post-deploy checks (a) to (d) of the lease runbook section 5; (5) CHANGELOG entry per the repo discipline."
    expected: "Recorded counts and yes/no only."
    why_human: "These need PROD, Railway and the merged PR."
---

# Phase 230: MT5NIGHTLY Verification Report

**Phase Goal:** Every MT5 nightly derive ends `done` on its first attempt, for a named reason. The named cause of `derive_broker_dailies` second attempts is fixed at its root, then seven consecutive nights show `attempts=1`, and the 202 moved values are replayed under both clock settings and attributed (MT5D-02, MT5D-03).
**Verified:** 2026-11-26, at `ebca5ec64f9ab775ad8bd36ab1d49c9dbaacd806`. The lease source, migration and gate are byte-identical to `7a0114a5c`, where I ran the tests. Only `230-SECURITY.md` was added in between.
**Status:** human_needed
**Re-verification:** No, initial verification.

Honest reading: the code half of the phase is delivered and I independently reproduced its proof. The phase GOAL, "seven nights with attempts=1" plus "each moved value attributed", cannot be true yet and nothing in the repo claims it is. Nothing FAILED. Two success criteria are open by design and one behaviour (the client against a real PostgREST and database) has no executed evidence yet. That makes this `human_needed`, not `passed`, and not `gaps_found`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: the cause of MT5 second attempts is named from the records before any fix, and the fix lands at that cause | ✓ VERIFIED (with a stated limit) | `230-DISCUSSION-LOG.md` R-1 to R-3 names it from stored job rows (`attempts=2` on 11-05, 11-15, 11-20, 11-21, 11-23), the backfill worker's first-attempt log lines (MT5CONC-02 login-bracket mismatch on 11-15, 11-20, 11-21, 11-23) and the `mt5_terminal_handover` cron_runs (derive in the worker and `poll_allocator_positions` in the API, interleaved from 01:00Z). Root cause in code: `_MT5_TERMINAL_LOCKS` is an `asyncio.Lock` per process. The fix is at that spot: `mt5_terminal_lease` takes the database lease after the local lock (`mt5_concurrency.py` around line 525), so every call site (`job_worker` x2, `allocator_positions`, `mt5_terminal_scrub`, `mt5_relogin`, `mt5_validation_liveness`, `ingestion/mt5.py`, `routers/exchange.py`) are covered. Limit: 227's own ledger held one post-deploy night (zero MT5 rows), so the cause was named from the job rows, logs and handover records, not from the ledger. The 11-05 night was not read in logs and one 11-23 job failed on a different transient. The ROADMAP's 2026-11-25 research bullet records the same basis. The seven-night read and the wait-log count are what test the attribution. |
| 2 | SC-2: seven consecutive nights, every MT5 derive `done` with `attempts=1`, from stored rows with dates; no retry budget or watchdog raised | ? UNCERTAIN (open by design) | Not measurable before ship and deploy. Plan 09 delivered the runbook section 6, the query and the seed, and stops at a blocking-human checkpoint with no SUMMARY. The "nothing raised" half is verified now: `git diff origin/main...HEAD` shows no `max_attempts`, watchdog or claim-TTL constant changed, and `job_worker.py` gained only the classify arm and its constant. See human items 1 and 2. |
| 3 | SC-3: each unexplained moved value is replayed under both clock settings and attributed | ? UNCERTAIN (open by design) | Capture and replay are the coordinator's (D-02). Delivered and checked: `--days-out` (tests pass, report byte-identical without it), the runbook with capture contract and per-scope arithmetic, and the capture script whose sha256 I recomputed and matched (`36aa23fe...`). No attribution exists yet. See human item 3. |
| 4 | SC-4 / PROOF-01: a test that drives the named cause goes RED on a neutered copy with its named arm first, restored by byte backup, GREEN; any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ in the one serial lane | ✓ VERIFIED | I reproduced it myself. Neuter: line 744 of `services/mt5_xlease.py`, `if granted:` changed to `if True:`, byte backup taken first. `pytest tests/test_mt5_xlease.py -k xproc_01_two` went RED: `AssertionError: XPROC-01 the second process entered before the first left (events=['a-enter', 'b-enter', 'a-exit', 'b-exit']) - the cross-process lease is not serializing the terminal`. Restored by `cp`, `cmp -s` OK, GREEN (`1 passed`). SUMMARYs 01, 02, 04, 05, 06 carry further neuter transcripts. Reviewers: both at `f9c5df4ac` with no MEDIUM or above (plan 08 SUMMARY item 5). They are relayed by the orchestrator, with no stored artifact in the phase dir. I confirmed the lease migration, down file, gate and mirrors are unchanged since that sha: `git diff f9c5df4ac HEAD -- supabase/` shows only origin/main's own migration. One migration, one lane, stamp `20261126120000` is newest in `supabase/migrations`. |
| 5 | Two processes with separate registries never drive the terminal at once; busy and unavailable keep their contracts; every database error fails closed; a missing RPC degrades loudly | ✓ VERIFIED | `tests/test_mt5_xlease.py`, `test_db_is_missing_rpc.py`, `test_mt5offset_dry_run.py`: 101 passed (123.98 s). `test_job_worker.py -k "lease or classify"` plus `test_mt5_concurrency.py` run: 55 passed. mypy strict, CI form, `Success: no issues found in 144 source files`. Three review rounds closed HIGH CR-01, CR2-01 and six SF MEDIUMs; round 3 had no MEDIUM+ from either reviewer. The timing is import-validated (`_validate_xlease_timing`; TTL 90, renew 20, RPC 15, error budget 60, in-flight cap 5). |
| 6 | The Python client works against the real lease RPCs through PostgREST (boolean answers, 8-client exclusivity, expiry takeover) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test_mt5_xlease_live.py` exists with four tests and fails-not-skips under `CI=true` (plan 07 proved the skip and the fail locally). It never ran against a lane. Plan 01's SQL gate (8 arms, each with a biting twin) did run on a real PostgreSQL pg-lane in the executor's transcript, which I did not re-execute. Routed to human verification as CI head-SHA evidence. |
| 7 | Lease RPC security: SECURITY DEFINER with a pinned search_path, service_role only, RLS on with no policy, holder closed literal or UUID, digest not raw key | ✓ VERIFIED | Read in `20261126120000_mt5_terminal_lease.sql`: `SET search_path = public, pg_catalog`; `REVOKE ALL` from PUBLIC, anon, authenticated, service_role then `GRANT SELECT` to service_role only; `ENABLE ROW LEVEL SECURITY`; input validation raises 22023; a catalogue-only self-verify `DO` block. `230-SECURITY.md` records 32 of 32 threats closed at `7a0114a5c`. |
| 8 | A lease outage reaches users only through existing answers (transient retry, fixed note, retryable 424), never a raw text or a bodyless 500 | ✓ VERIFIED | `job_worker.py` classify arm (`MT5_LEASE_UNAVAILABLE_MESSAGE`, still present after the origin/main merge), the holdings arm, both `process_key` arms, and the heal and liveness arms (`mt5_relogin.py:2939`, `mt5_validation_liveness.py:194`) catch the unavailable subclass ahead of busy. Plan 05's tests and its four neuters plus the round-1 SF-M1 work cover them. |
| 9 | MT5D-03 tooling and hand-off exist and are proven offline | ✓ VERIFIED | `mt5offset_dry_run.py --days-out` (20 tests pass in the run above). `docs/runbooks/mt5-clock-replay.md` sections 4 to 10. Section 10 records the script sha256, which matches the file, and the write review re-run at `8dbe2a60d`. The script is deliberately in no tracked path. |
| 10 | Gate and census files agree with the new SQL gate | ✓ VERIFIED (static, at HEAD) | `run.mjs --parse-only`: No static defects. `lint-sql-gates`: 122 files, 0 findings. `dump-sql-functions --check`: current (145 functions), with the three dated snapshot-only ratchet rows carried. `FILES_FLOOR` 95, `ARMS_FLOOR` 1041, `WAIVED_CEILING` 0. The full count is CI's `sql-mutation` at the head SHA (human item 4). |

**Score:** 7/10 truths verified. 1 present, behaviour-unverified (truth 6). 2 open by design (truths 2, 3).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20261126120000_mt5_terminal_lease.sql` + `down/` rollback | table + 3 RPCs | ✓ VERIFIED | Read in full; one atomic acquire statement (`INSERT ... ON CONFLICT DO UPDATE ... WHERE free, expired or same token`) |
| `supabase/tests/test_mt5_terminal_lease.sql` | 8 arms, twins bite | ✓ VERIFIED (static) | Parses as 8 prose, 8 twins, 0 waivers. Lane run is the executor's transcript and CI's. |
| `analytics-service/services/mt5_xlease.py` | client, renew, fence, budget | ✓ VERIFIED | 844 lines, wired from `mt5_concurrency` |
| `analytics-service/tests/test_mt5_xlease.py`, `xlease_fakes.py`, conftest default backend | unit + PROOF-01 | ✓ VERIFIED | 62 tests collected in the file, all pass |
| `analytics-service/tests/test_mt5_xlease_live.py` | lane test | ⚠️ present, never run on a lane | truth 6 |
| `docs/runbooks/mt5-terminal-lease.md` | operator runbook + nightly section | ✓ VERIFIED | Section 6 is the nightly evidence |
| `docs/runbooks/mt5-clock-replay.md` | capture and replay contract | ✓ VERIFIED | |
| `230-09-night-query.sql`, `230-09-night-seed.sql` | lane-proof inputs | ✓ present | Lane proof pending (human item 2) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `mt5_concurrency.mt5_terminal_lease` | `mt5_xlease.acquire_terminal_xlease` | called after the local lock, release in `finally` (DEC-02-A) | WIRED | lines 525 to 612 |
| `mt5_xlease._PostgrestXLeaseBackend` | `acquire/renew/release_mt5_terminal_lease` RPCs | PostgREST rpc calls | WIRED (by name); live answer unverified | truth 6 |
| `job_worker.classify_exception` | `Mt5TerminalLeaseUnavailableError` | isinstance arm, transient | WIRED | line 1314 |
| derive (`job_worker.py:7883`) and holdings poll (`allocator_positions.py:1024`) | the same lease | same `terminal_key` (`session.client.terminal_key`) | WIRED | whether both services point at one gateway is env, checked by the post-deploy checks |
| nightly query | `compute_jobs`, `compute_job_attempt_failures`, `mt5_terminal_leases` | SQL | columns exist in baseline | lane run pending |

### Data-Flow Trace (Level 4)

Not applicable: the phase renders no user-facing data. The only dynamic output is log events and the evidence query, covered by the human items.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Lease, is_missing_rpc, dry-run suites | `pytest tests/test_mt5_xlease.py tests/test_db_is_missing_rpc.py tests/test_mt5offset_dry_run.py -x` from `analytics-service/` | 101 passed | ✓ PASS |
| Classify arm after the origin/main merge | `pytest tests/test_job_worker.py tests/test_mt5_concurrency.py -k "lease or classify"` | 55 passed | ✓ PASS |
| PROOF-01 neuter and byte restore | edit line 744, run `-k xproc_01_two`, `cp` back, `cmp -s` | RED with the named assertion, then GREEN | ✓ PASS |
| mypy strict, CI form | `mypy --strict ... services/ routers/ models/ main*.py sentry_init.py` | no issues in 144 files | ✓ PASS |
| Gate census statics | `run.mjs --parse-only`, `lint-sql-gates.mjs`, `dump-sql-functions.ts --check` | all clean | ✓ PASS |
| Live lane test, sql-tests corpus, full suites, full mutation run | not run (load limit) | | ? SKIP, routed to human item 4 |

### Probe Execution

No `probe-*.sh` is declared by this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MT5D-02 | 01, 02, 04, 05, 06, 07, 08, 09 | the named cause fixed at its root, then seven clean nights | ◐ code delivered, closure needs the nights | truths 1, 4, 5, 6, 7, 8; truth 2 open |
| MT5D-03 | 03, 08, 10 | moved values replayed and attributed | ◐ tooling delivered, closure needs the coordinator's run | truth 9; truth 3 open |

Both IDs are claimed by plans. No orphaned requirement. The plan 08 SUMMARY leaves `requirements-completed` empty on purpose, which is right.

### Anti-Patterns Found

None blocking. `TBD`, `FIXME` and `XXX` have no hit in the phase's modified source, migration, gate or test files. `git diff origin/main...HEAD --name-only` includes `.planning/**`, so the ship branch must be the filtered `-pr` branch (repo ship-planning guard).

### Warnings (not gaps)

- `230-VALIDATION.md` still shows row 230-08-T3 as pending and the sign-off boxes unticked, although the plan 08 SUMMARY records both reviewer verdicts. Stale document, no effect on the goal. `validate-phase` owns it.
- The two migration-reviewer verdicts are recorded by relay in a SUMMARY. The migration is unchanged since the reviewed sha, so they still apply. A fresh run is cheap insurance if the migration is re-stamped at ship.
- LOW items LR3-01 and LR3-02 (a grant older than the loss deadline is fenced with no renew; a late call ending in an exception releases nothing) are recorded only in `230-REVIEW.md`, per the repo's no-LOW-booking rule.
- Known limit carried by plan 08 for the ship entry: per-process holder and settled registries stay in-process (`[230-MT5-REGISTRY-CROSS-PROCESS-STALE]`, not booked in TODOS.md yet); multi-replica is not claimed.

### Gaps Summary

No gaps. Every claim the codebase can answer today is answered: the cause is named, the fix sits at the choke point every MT5 terminal user passes through, PROOF-01 goes RED and GREEN on production code with the byte restore checked by me, the migration is hardened and unchanged since review, and nothing that would mask the symptom (retries, watchdog, TTL) was raised. What is left is the post-ship evidence the criteria themselves require: seven PROD nights, the coordinator's capture and replay, and CI lane evidence bound to a PR head SHA that does not exist yet. A clean `passed` before those would be inflation.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_

## Ship record (2026-11-26, records PR)

- **Shipped** as v0.133.91.0 (#1358), merge commit `9c26bf3f7`. The migration was re-stamped at ship from `20261126120000` to `20261126140000_mt5_terminal_lease.sql`, so it sorts after Phase 238's `20261126130000`. The `drift_subjects` entry above now names the shipped file; the plan SUMMARYs and the body of this report keep the old stamp as written at the time.
- **Applied to PROD** in `supabase-migrate.yml` run 45807605366 (head `9c26bf3f7`, success). The baseline re-dump after that apply is v0.133.91.1 (#1365).
- **CI at the PR head** `c3385b81`, run 45804955452. Green: `python` (`test_mt5_xlease_live.py` ran inside it; its per-test lines are not printed), `sql-tests`, `sql-mutation`, `e2e-seeded`, `test-db-drift`, the frontend shards and `frontend-coverage`. Red: `sql-gate-lint`, and the `frontend` aggregator through it, on baseline-content-drift `SNAPSHOT_MISSING` rows for the three new lease functions. A stale-baseline red is expected before a PROD apply. After the v0.133.91.1 re-dump, main's CI push run 45813118697 at `19ee154a6` succeeded. `sql-tests` printed `baseline-replay: 1 migration(s) newer than the dump: 20261126140000_mt5_terminal_lease.sql` and `ALL 8 ARMS EXECUTED (L1,L2,L3,L4,L5,L6,L7,L8)` for `supabase/tests/test_mt5_terminal_lease.sql`. These are recorded as readings only. The behaviour-unverified item and the CI head-SHA lane item stay open for the verifier to close, and the status stays `human_needed`.
- **Still open, unchanged:** SC-2 needs seven clean nights, counted from the first 00:40Z derive after BOTH services carry the lease (deployed 2026-11-26 with #1358). SC-3 needs the coordinator's capture and replay (plan 10). Plan 09's lane proof is also still open. Plans 09 and 10 have no SUMMARY, which is correct.
