---
phase: 253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th
verified: 2026-11-26T13:15:00Z
verified_at_sha: 734e51f53b3590834b7f5539fec08bd39a95690d
# Re-read 2026-11-26 at the records PR: the sha is merge 734e51f5 (#1367), the squash that carries the verified code. The branch sha 5eba0e14 (code verified at 0084b80c) exists only on the local phase branch, so the drift report could not reach it.
status: passed
recheck: "2026-11-26 records re-read: items 1-4 (CI and ship) satisfied by #1367 and the re-dump #1369; items 5-7 resolved by founder rulings 2026-11-26 (AskUserQuestion): \"Keep it on, fix records\" (item 5) and \"Accept both\" (items 6 and 7). Status passed."
score: 5/5 success criteria satisfied in code and local evidence (SC-4 ship-bound parts done at #1367; SC-4's environment premise corrected by founder ruling 2026-11-26); 0 failed, 0 present-behavior-unverified in Python; CI-bound items listed below
behavior_unverified: 0
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/binance_sync_flags.py
  - analytics-service/services/trade_resume.py
  - analytics-service/services/analytics_runner.py
  - supabase/migrations/20261126150000_strategy_fills_reread_bound.sql
  - supabase/migrations/down/20261126150000-rollback.sql
  - supabase/tests/test_strategy_fills_reread_bound.sql
  - supabase/schema/functions/set_strategy_fills_reread_bound.sql
  - scripts/mutation-floors.mjs
human_verification: []
human_items_resolved:
  - test: "Confirm the Railway worker environment has USE_RAW_TRADE_INGESTION unset or false"
    expected: "Switch is off for every venue. The code default is false and no tracked config sets it, but the Railway environment was never read by this phase or this verification."
    measured_2026_11_26: "CONTRARY. `railway variables --kv`, filtered to this one key, reads USE_RAW_TRADE_INGESTION=true on the production environment of both the quantalyze-analytics service (which runs the merged API and job worker, per analytics-service/Dockerfile) and quantalyze-analytics-backfill. The guard at job_worker.py `_RAW_TRADE_INGESTION_ENABLED` is one global flag with no venue condition beside it, so the variable as set turns raw fills ingestion on for Binance and every other venue. Not measured: whether the running deployment carries this value, and whether any Binance key syncs in PROD. No record in CHANGELOG, TODOS, STATE or ROADMAP says the switch was turned on."
    resolved: "Founder ruling 2026-11-26 (AskUserQuestion), verbatim: \"Keep it on, fix records\". The switch is true in PROD on both analytics services and stays on. PROD has 0 Binance api_keys (live: 5 okx, 1 bybit, 8 deribit, 11 mt5; MCP read 2026-11-26), so the Binance gaps cannot fire today; Binance is safe only because no Binance key exists. [253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS] and [253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN] now trigger before the first Binance key connects in PROD. [253-NULL-COLUMN-ANCHOR-ALL-VENUES] is live today on okx, bybit and deribit and is owned by Phase 255 NULLANCHOR (v1.23 HARDEN)."
    why_human: "SC-4 and the routing of [253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS] and [253-NULL-COLUMN-ANCHOR-ALL-VENUES] both rest on the switch being off (it is one global switch, so off for Binance means off for OKX, Bybit and Deribit as well). The env value is unmeasured."
  - test: "Founder decision on routed residual [253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN] (round-4 focused review of 6d0a48a7a)"
    expected: "Accept that WR-03 is narrowed, not closed, and that it must be fixed or guarded before USE_RAW_TRADE_INGESTION is turned on for Binance: while set_strategy_fills_reread_bound is unavailable, cron_sync / fetch-trades can store daily rows and move the seed past a span no bound records."
    resolved: "Founder ruling 2026-11-26 (AskUserQuestion), verbatim: \"Accept both\". The cron-moves-seed residual is accepted."
    why_human: "MEDIUM data-integrity survivor routed (TODOS.md ~line 258, commit 23d591467), not fixed in this phase; acceptance is a founder call. Not re-measured by this verifier (read the entry and its scratch-copy measurement only)."
  - test: "Founder-level read of the round-3 fix commit 6d0a48a7a (WR-03/IN-14/IN-15, the daily store held when the provisional bound is not recorded)"
    expected: "Accept the fail-closed cost (while the bound RPC is down, a Binance run holds its daily sync_trades store)."
    resolved: "Founder ruling 2026-11-26 (AskUserQuestion), verbatim: \"Accept both\". The fail-closed cost of fix 6d0a48a7a is accepted."
    why_human: "Review round 3 was the last round; this fix was not itself re-reviewed. It is covered by 5 RED-on-pre-fix arms and 4 neuters in 253-REVIEW-FIX.md, but it is a data-integrity change."
ci_and_ship_items_satisfied:
  # Re-read 2026-11-26 at the records PR. Each was human_needed only because CI and ship had not run.
  - test: "CI `sql-tests` runs supabase/tests/test_strategy_fills_reread_bound.sql on the real-schema local-stack lane"
    expected: "The gate is GREEN on the real schema (the seed column set of api_keys, strategies, compute_jobs is accepted by every CHECK and trigger). If a seed is refused, the seed is adjusted, never an arm."
    why_human: "No Docker locally. The gate and its 24 twins were run only on the throwaway pg-lane cluster, whose fixtures are not the real schema (253-01-SUMMARY, 'Real-schema run: NOT DONE')."
  - test: "CI python / e2e-seeded lane jobs run the live-DB pytest arms that skip locally"
    expected: "tests/test_sync_trades_preserves_fills.py (2), tests/test_job_worker.py (1) and tests/test_sync_trades_enqueue_failure_bridge_live.py (10) pass with the Phase 253 worker changes."
    why_human: "13 live-DB arms SKIPPED here (LANE_DB_URL unset / local-stack lane not configured). They did not run."
  - test: "CI `sql-mutation` (FULL on this PR, it moves a gate and a migration) compares FILES_FLOOR 96 / ARMS_FLOOR 1065 with a real biting count"
    expected: "No ratchet, lane-blocked or arms-vs-lane-invocations MEASURE_FAIL; biting count is at least 1065."
    why_human: "ARMS_FLOOR 1065 is the static annotated count (this gate adds 24 on top of the merged base; `--parse-only` prints 0/1065/0), not a FULL-run biting count; a FULL corpus run was out of reach under the load limit. This verifier re-ran only this gate file (24/24 biting)."
  - test: "Ship PR: baseline-content-drift / schema:functions checks after the PROD apply"
    expected: "The one SNAPSHOT_MISSING finding for set_strategy_fills_reread_bound is the expected pre-apply state; the post-apply baseline re-dump PR clears the snapshot-only NAME_SET_RATCHET row. migration-reviewer and rls-policy-auditor clean at MEDIUM+ before merge (ROADMAP Depends-on)."
    why_human: "Migration lane review and the re-dump are ship-time acts, not code in this branch. The migration auto-applies to TEST then PROD on merge with no human stop."
  - evidence: "Items 1-4 above, read from #1367's head 245cc113 (CI run 45821931590) and main after #1369: (1) sql-tests SUCCESS, the log runs supabase/tests/test_strategy_fills_reread_bound.sql on the local-stack lane. (2) python SUCCESS (17503 passed, 11 skipped) and e2e-seeded SUCCESS; the three live-DB modules pytest.fail rather than skip under CI=true (tests/live_db_dsn.py and the SUPABASE_TEST_URL guard), so a green job means they ran. (3) sql-mutation SUCCESS: scope FULL 96/96 annotated files, arms 1074/1074/0, biting 1074, lane-invocations 1074, No defects; ARMS_FLOOR is 1074 after the merge onto Phase 225 PR-3. (4) sql-gate-lint reported SNAPSHOT_MISSING set_strategy_fills_reread_bound on #1367 (the expected pre-apply state); supabase-migrate run 45824919779 applied 20261126150000 to TEST then PROD; re-dump #1369 (v0.133.93.1) reports SNAPSHOT_MISSING 0 and deleted the snapshot-only NAME_SET_RATCHET row in scripts/dump-sql-functions.ts. migration-reviewer and rls-policy-auditor were clean before merge, per the 0.133.93.0 CHANGELOG entry."
ship_bound_done:
  - "Shipped as v0.133.93.0 (#1367, merge 734e51f5) with a CHANGELOG entry naming [250-BINANCE-STOP-BELOW-CURSOR] closed and the three routed ids; migration stamp 20261126150000 kept (it sorts after 20261126140500)."
---

# Phase 253: BINANCECURSOR Verification Report

**Phase Goal:** A Binance raw fills read that stops (deadline, `BINANCE_PAGE_CAP`) or loses a symbol (`binance_partial_symbols`) never leaves an unread span that no later run re-reads, even when the fills cursor column is ahead of the strategy's newest stored fill, and the signal that names such a span outlives the sync's own follow-on writes. Closes `[250-BINANCE-STOP-BELOW-CURSOR]`.
**Verified:** 2026-11-26, worktree `quantalyze-wt-253`. Code and tests verified at `0084b80c`; HEAD is now `5eba0e14` (two docs-only commits: the round-4 routing in `TODOS.md` and `253-SECURITY.md`; `git diff --stat 0084b80cc HEAD` lists only those two files).
**Status:** passed (2026-11-26 records re-read; originally human_needed: nothing FAILED, every open item was CI-bound, ship-bound, an env read or a founder acceptance)
**Re-verification:** No, initial verification

## Re-read at the records PR (2026-11-26)

- **Items 1 to 4 are satisfied** by #1367's CI (run `45821931590` on head `245cc113`), the TEST-then-PROD apply in Supabase Migrate run `45824919779` and the re-dump #1369. The `ci_and_ship_items_satisfied` block above carries the readings: `sql-mutation` FULL 96/96 files, `arms: 1074/1074/0`, `biting: 1074`, `No defects`, and `SNAPSHOT_MISSING 0` after the re-dump.
- **Item 5 was measured CONTRARY, then resolved by the founder.** The Railway production variable `USE_RAW_TRADE_INGESTION` reads `true` on both analytics services, read 2026-11-26 with the CLI output filtered to that one key. `quantalyze-analytics` runs the merged API and job worker, and the other service is `quantalyze-analytics-backfill`. `_RAW_TRADE_INGESTION_ENABLED` is one global flag. No venue condition sits beside its guard.
  - **Founder ruling 2026-11-26 (AskUserQuestion), verbatim: "Keep it on, fix records".** The switch stays on.
  - PROD has 0 Binance `api_keys` (live: 5 okx, 1 bybit, 8 deribit, 11 mt5; MCP read 2026-11-26), so the Binance gaps cannot fire today. Binance is safe only because no Binance key exists.
  - ⛔ **CORRECTED 2026-11-26: SC-4 and truth 12 no longer read "the switch stays off for Binance".** They hold for the code: the default is `false` and the comment names the precondition. The environment is on by founder decision. The rows below are kept as lineage.
  - `[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]` and `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` now trigger before the first Binance key connects in PROD.
  - `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` is live today on OKX, Bybit and Deribit. It is owned by Phase 255 NULLANCHOR in v1.23 HARDEN.
  - Phase 250's "off in PROD" line carries a dated ⛔ CORRECTED note.
- **Items 6 and 7: founder ruling 2026-11-26 (AskUserQuestion), verbatim: "Accept both".** The founder accepted the cron-moves-seed residual and the fail-closed cost of fix `6d0a48a7a`.
- **Status: passed.** Every human item is satisfied or resolved, and `phase complete 253` ran in this records PR.

## Per-SC score

| SC | Statement (short) | Verdict | Score |
|----|-------------------|---------|-------|
| SC-1 | Two-run test: run 1's column set by another strategy, run 2 seeded from what run 1 wrote, re-reads the stopped/failed span; RED on today's code; cursor never stamps past stored data | VERIFIED (Python two-run arms executed locally; real-RPC half is CI-bound) | 1/1 |
| SC-2 | Stop-plus-partial flagged by name; predicate compares earliest complete-through instant with the next run's walk start | VERIFIED | 1/1 |
| SC-3 | Sync-time `binance_*` flags (stop_below_cursor, deadline_symbols among them) survive the derive write and the CSV rebuild; an arm proves each | VERIFIED | 1/1 |
| SC-4 | Switch stays off for Binance; `_RAW_TRADE_INGESTION_ENABLED` comment and TODOS entry updated in the ship PR (entry deleted, named in CHANGELOG) | VERIFIED for code/comment/TODOS state; CHANGELOG naming is ship-bound (open, stated not passed); Railway env unmeasured | 1/1 branch-side, ship-bound item open |
| SC-5 | PROOF-01: each gate RED on pre-fix/neutered code with its named arm, restored by `cp` + `cmp`, GREEN, verbatim in SUMMARY | VERIFIED (records present for SC-1/2/3 and the SQL arms; SQL runner re-run independently) | 1/1 |

**Score: 5/5 criteria satisfied on the branch; 0 FAILED; 6 human/CI-bound items; 2 ship-bound items.**

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01/D-04: bound lives in its own per-strategy table; `api_keys.last_fetched_trade_timestamp` and `advance_sync_cursor` unchanged | VERIFIED | `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` creates `strategy_fills_reread_bounds` (PK strategy_id) only; `advance_sync_cursor` migration and snapshot are not in the diff stat; grep of the worker shows `advance_sync_cursor` params untouched (`test_d04_...` passes). |
| 2 | D-05: writer is claim-token fenced like `advance_sync_cursor`; orphan returns FALSE; LEAST toward earlier when not covered; covered sets run's instant; clear only on complete+covered; re-point replaces | VERIFIED | Read the function body: fence block, R0..R7 branches match. Pg-lane runner re-run by this verifier: baseline exit 0, `arms: 24/24/0`, `biting: 24`, `lane-invocations: 24`, 24 x `RED (identity ok)`, `No defects`. Not run on the real schema. |
| 3 | ASVS: anon/authenticated/PUBLIC hold nothing on table or function; service_role holds both; SECDEF with `search_path = public, pg_catalog` | VERIFIED (catalogue verify block + GRANT/EXEC/SECDEF/POLICY arms); real-schema run CI-bound | Migration STEP 2/3/4 read directly. |
| 4 | SC-1 / D-02: worker seeds the fills read from `min(column, stored fills, bound)`; interleave with a sibling strategy advancing the column is re-read | VERIFIED | `job_worker.py` ~2444-2461 (`load_strategy_fills_reread_bound`, lowers `fills_since_ms`). Tests `test_sc1_a_stop_below_a_column_...` (run 1 stamps, `column_after_advance` proves the RPC drops the stamp, run 2 asserts `since_ms == SECOND_STOP_MS`) and `test_d02_three_step_interleave_...` pass. SUMMARY 02 records RED on the pre-fix file (2 failed) and a 17-red census. |
| 5 | D-03: bound sent never later than the earliest complete-through instant; stamp never passes stored data | VERIFIED | `_earliest_through()` feeds both flag and write; `test_d03_...[stop|stop-plus-partial|raised]` pass; SUMMARY 02 neuters P6/P7. |
| 6 | Round-2 CR-02/CR-03: provisional bound written at the seed BEFORE Phase 251's daily store and the read; a failed or orphan write skips the read | VERIFIED | `job_worker.py` 2487-2556 (`_set_bound(_provisional_unread_ms, None)`, `phase2_failed`/`_fills_read_skipped`, `_bound_orphaned`). `TestProvisionalBoundBeforeTheRead` passes; REVIEW-FIX records R2-P0 (9 RED) and R2-P1..P4 neuters, each restored with cp/cmp. |
| 7 | Round-3 WR-03: when the provisional write fails or is orphaned, the Phase-1 daily store is held too (`phase1_read_refused`, `elif trades and not phase1_read_refused`) | VERIFIED (by pytest, not independently neutered) | `job_worker.py` 2530-2531, 2554-2556, 2566. `TestHeldDailyStoreWhenNoBoundIsRecorded` passes; REVIEW-FIX records R3-P0 (5 RED) and R3-P1..P4. Not re-reviewed (human item 6). |
| 8 | SC-2 / D-06: a stop past the column plus a failed symbol is flagged; predicate = earliest complete-through + 1 < column - OVERLAP_WINDOW_MS; partial-only and raised read flagged; overlap-hour stop not flagged | VERIFIED | `job_worker.py` 3036-3062; `test_stop_plus_partial_is_flagged_by_name_and_bounds_the_walk_start`, `test_a_partial_only_...`, `test_a_raised_binance_read_...`, `test_the_overlap_hour_...[3 ids]` pass; SUMMARY 02 P2, P3, P7 RED then GREEN. |
| 9 | SC-3 / D-08: the nine allowlisted `binance_*` keys survive the derive prestamp, the CSV rebuild and the four wholesale failure writers | VERIFIED | `services/binance_sync_flags.py` (allowlist + validators); `job_worker.py` 12284 (carry), 6668 (derive-failed via `read_binance_sync_flags`); `analytics_runner.py` carry + three failure writers. 515 passed (targeted suites) incl. `test_binance_sync_flags.py`, `test_derive_broker_dailies_dualmode.py`, `test_csv_analytics_runner.py`, `test_stamp_io_exhaustive.py`. SUMMARY 04 F1-F16 each RED then GREEN. |
| 10 | D-09: a clean Binance sync clears keys it did not raise; a raised read, switch-off, OKX key and failed load clear nothing | VERIFIED | `job_worker.py` 3244-3257; `TestBinanceSyncFlagClearing` passes; F3/F4/F8 neuters. One arm (`..._failed_flag_load_pops_nothing`) cannot be neutered to RED, disclosed (Deviation 3 of plan 04), the term is defensive. |
| 11 | A carried key never promotes `computation_status` | VERIFIED | CSV-hop arm asserts exact `"complete"` and `computation_warned is False`; passes. |
| 12 | SC-4: `USE_RAW_TRADE_INGESTION` stays off for Binance | VERIFIED in code | `job_worker.py:387-389` default `"false"`, `.lower() == "true"`, byte-unchanged; `git grep` outside .planning/tests shows no tracked config, workflow or Dockerfile sets it. Railway env not read (human item 5). |
| 13 | SC-4: `_RAW_TRADE_INGESTION_ENABLED` comment says the SC-3 gap is CLOSED and how, switch stays off | VERIFIED | `job_worker.py` 343-386: "is CLOSED by Phase 253 BINANCECURSOR", names the table, RPC (migration `20261126150000`), provisional write, predicate, flag carry/clear; "This switch stays off for Binance ... no Phase 253 plan takes (SC-4, D-10)." |
| 14 | SC-4: TODOS `[250-BINANCE-STOP-BELOW-CURSOR]` entry deleted; CHANGELOG names it | PARTIAL, ship-bound | `git diff origin/main...HEAD -- TODOS.md`: the entry is deleted on this branch (commit 893d9ab11) and replaced by the two routed entries. `git grep` finds the id only in `CHANGELOG.md` (history lines 250, 256, 326). No Phase 253 CHANGELOG entry and no VERSION bump exist yet: ship-bound, NOT a pass. |
| 15 | No non-binance sync flag (`sync_truncated_*`) is carried; OKX makes no bound read/write | VERIFIED | `test_an_okx_run_makes_no_bound_read_and_no_bound_write`, `test_a_raised_okx_read_never_sets_a_binance_flag` pass; F4/F8/P4 neuters. |
| 16 | SC-5 / PROOF-01 records | VERIFIED | See PROOF-01 table. |

## PROOF-01 (SC-5) record check

| Gate | Where recorded | RED on neutered/pre-fix | Restore (cp + cmp) | GREEN | Notes |
|------|----------------|-------------------------|--------------------|-------|-------|
| SQL gate, 24 arms | 253-01-SUMMARY | all 24 `RED (identity ok)`, runner output verbatim; hand neuters N1 (LEAST stall) and N2 (fence) with the `TEST FAILED (C4)` / `(FENCE 1)` text | `N1 restore cmp=0`, `N2 restore cmp=0`, `final cmp=0`, `git status` empty | `lane-rc=0` | Re-run by this verifier on the merged tree: 24/24 biting, baseline exit 0. |
| SC-1 arms | 253-02-SUMMARY | P0 (byte copy of pre-fix file): 2 failed; P1: 3 failed; census 17 failed / 33 passed on pre-fix code | `cmp exit=0` after every neuter; `git checkout/restore/stash` never used | `2 passed`, `3 passed`, `50 passed` | Post-merge rounds re-proved in REVIEW-FIX: R1-P0 (3 RED), R2-P0 (9 RED), R3-P0 (5 RED), each with cp/cmp. |
| SC-2 arms | 253-02-SUMMARY | P2 (drop partial term), P3 (drop `phase2_failed` term), P7 (drop overlap): named arms FAILED | `cmp exit=0` | `1 passed`, `1 passed`, `3 passed` | |
| SC-3 arms | 253-04-SUMMARY | F1 (derive), F2 (CSV), F6/F7/F9/F10 (four failure writers), F3/F4/F8 (clear), F5 (parity), F11/F12 (never-raise), F13-F16 (validators, fresh test) | `restore cmp exit=0` each | each GREEN rerun, final `377 passed` | One arm not neuterable to RED, disclosed. |
| Census (plan 03) | 253-03-SUMMARY | snapshot RED without snapshot, ratchet-row neuter RED, COMPARED_FLOOR 144 neuter RED, stale-low floor neuter RED | `restore-cmp=0` | GREEN | Re-run here: 5 vitest files, 354 passed. |

Limit: the Python-side RED/GREEN outputs are the executors' recorded runs. This verifier did not re-neuter `job_worker.py` (editing a source file was out of scope); it re-ran the SQL runner (self-restoring) and the green side of every Python suite.

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` | VERIFIED | Table + deny-all policy + REVOKE/GRANT + fenced SECDEF RPC + catalogue-only verify block, additive. Stale comment: says the epilogue is "the sole caller"; since round 2 there are two calls (provisional + epilogue). Info only. |
| `supabase/migrations/down/20261126150000-rollback.sql` | VERIFIED (exists, correct stamp) | Plan 01 proved it on the pg-lane before the rename; not re-executed here. |
| `supabase/tests/test_strategy_fills_reread_bound.sql` | VERIFIED | 24 annotated arms, 24 biting on pg-lane (re-run). |
| `supabase/schema/functions/set_strategy_fills_reread_bound.sql` + `NAME_SET_RATCHET` snapshot-only row | VERIFIED | Census vitest green. Expected `SNAPSHOT_MISSING` until the post-apply re-dump. |
| `services/trade_resume.py::load_strategy_fills_reread_bound` | VERIFIED, wired | Imported at `job_worker.py:149`, called at 2447, fails open. |
| `services/binance_sync_flags.py` | VERIFIED, wired | Imported at `job_worker.py:143-144` and in `analytics_runner.py`; all call sites present. |
| `tests/_binance_fills.py` (`bound_after_set`, `RereadBounds`) | VERIFIED | Stateful fake; mirror is cross-checked by `test_the_mirror_matches_the_sql_case_table` (11 cases C0-C10). Mirror is not the real RPC: the real RPC half is the SQL gate (CI-bound on real schema). |
| `scripts/mutation-floors.mjs` etc. (census) | VERIFIED | `FILES_FLOOR=96`, `ARMS_FLOOR=1065`, `WAIVED_CEILING=0`; `--parse-only` prints `coverage: files 96/123`, `arms: 0/1065/0`, no static defects. |

## Key Links

| From | To | Via | Status |
|------|----|-----|--------|
| `job_worker.py` | `trade_resume.load_strategy_fills_reread_bound` | seed block | WIRED |
| `job_worker.py` | RPC `set_strategy_fills_reread_bound` | `_set_bound` (provisional + epilogue); param names (`p_strategy_id`, `p_api_key_id`, `p_job_id`, `p_claim_token`, `p_unread_from`, `p_covers_from`) match the migration signature | WIRED (real DB call not executed locally) |
| `job_worker.py` derive prestamp / `analytics_runner.py` | `binance_sync_flags` | `carry_binance_sync_flags` (12284; CSV carry) | WIRED |
| sync flag merge | `clear_absent_binance_sync_flags` | `job_worker.py:3247` | WIRED |
| gate file | migration | `RED-UNDER-SETUP` apply list and every `RED-UNDER-M` edit path name `20261126150000` | WIRED (runner proves needles match) |

## Behavioral Spot-Checks (run by this verifier; no Docker, targeted files only)

| Check | Command | Result |
|-------|---------|--------|
| Phase 253 Python suites | `cd analytics-service && python3 -m pytest tests/test_binancefills_cursor.py tests/test_binance_sync_flags.py tests/test_derive_broker_dailies_dualmode.py tests/test_csv_analytics_runner.py tests/test_stamp_io_exhaustive.py tests/test_okxtrades_cursor.py tests/test_binancefills_e2e.py -q -rs` | `515 passed`, 0 skipped |
| Neighbouring sync_trades suites | same dir: `test_sync_trades_store_truth.py test_sync_trades_preserves_fills.py test_sync_trades_resume_seed.py test_mt5_sync_path.py test_fetch_trades_resume_seed.py test_job_worker.py test_sync_trades_enqueue_failure_bridge_live.py` | `215 passed, 13 skipped`. Skipped (live-DB, did NOT run): `test_sync_trades_preserves_fills.py:115` and `:194` (LANE_DB_URL unset), `test_job_worker.py:4677` (LANE_DB_URL unset), `test_sync_trades_enqueue_failure_bridge_live.py` x10 (local-stack lane not configured) |
| CI mypy command (`ci.yml` Type gate) | `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 146 source files` |
| Census vitest | `npx vitest run --maxWorkers=2 src/__tests__/{mutation-runner-floors,mutation-annotation-parser,lint-sql-gates,gate-family-meta,baseline-content-drift-allowlist}.test.ts` | `5 files, 354 passed` |
| SQL gate on pg-lane | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_fills_reread_bound.sql` | baseline exit 0, `arms: 24/24/0`, `biting: 24`, `lane-invocations: 24`, `No defects`; `git status` clean afterwards |
| Floors | `node scripts/mutation-runner/run.mjs --parse-only` | `coverage: files 96/123`, `arms: 0/1065/0`, no static defects |

Not run: any real-schema SQL run, any live-DB pytest arm, the full mutation corpus, ruff (not installed per REVIEW-FIX), the full Python/vitest suites.

## Routed items (not gaps, provided the switch stays off)

Three entries, all in `TODOS.md`, all dormant while `USE_RAW_TRADE_INGESTION` is off.

| Entry | Class | Why it is routed, not a gap here |
|-------|-------|----------------------------------|
| `[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]` (round-1 WR-01, MEDIUM user-facing) | symbol lists on the anon-readable `data_quality_flags` stay until the next clean sync because SC-3 requires them to survive | Present in `TODOS.md` with owner, trigger (before the switch flips for Binance), fix direction and gate. Founder decision recorded in REVIEW-FIX. Dormant while the switch is off. |
| `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (round-4 focused review of fix `6d0a48a7a`, MEDIUM data-integrity, routed in `23d591467`) | WR-03 is narrowed, not closed: on a set column with no stored fill, a run whose provisional bound write fails holds its own fills read and daily store, but `cron_sync` (`routers/cron.py`) and `/fetch-trades` (`routers/exchange.py`) store daily rows without consulting the bound. After the RPC recovers the next run seeds from `min(column, daily high-water)`, past the unread span, and its clean read clears `phase2_fill_ingestion_failed` | Entry has owner (the phase that flips the Binance switch), trigger (before the flip), fix direction (refuse Binance raw ingestion unless the RPC exists on the target DB, or carry the span on a record independent of both) and gate. Trigger needs the bound RPC to be down longer than a cron cycle with the switch on (worker against a DB without migration `20261126150000`, or that migration rolled back). Measurement is the reviewer's scratch copy; this verifier read the entry, did not re-run it. |
| `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` (round-2 WR-02, widened round 3) | OKX/Bybit/Deribit lose a span on a 429/cancel/raised read after Phase 251's daily store (NULL and set column) | Present in `TODOS.md`, widened with the round-3 measurements; Binance is closed by the provisional bound; owner is the phase that turns the switch on for a further venue. The switch is one global flag, so "off" covers every venue. The env value is unmeasured (human item 5). |

## Requirements Coverage

No requirement IDs are mapped (routed review survivor `[250-BINANCE-STOP-BELOW-CURSOR]`); none orphaned.

## Anti-Patterns

| Scan | Result |
|------|--------|
| `TBD`/`FIXME`/`XXX` in changed non-planning source (debt-marker gate) | None blocking in the files read (migration, `binance_sync_flags.py`, the Phase 253 hunks of `job_worker.py`). A repo-wide marker grep over all 23 changed files was not run. |
| Stubs | None: every new function has a caller and a test; `read_binance_sync_flags` and `load_strategy_fills_reread_bound` fail open by design (pinned). |
| Known recorded-not-fixed limits (from REVIEW-FIX and 253-04-SUMMARY) | (a) a failing guarded flag read in a failure writer carries nothing; (b) the sync epilogue's own failed flag LOAD replaces the column with new keys only; (d) pre-existing `write_needed` reset in the flag-merge chain; round-1/2 double-fault and cost notes (largely superseded by the provisional bound). All dormant while the switch is off and carried into the ship CHANGELOG list. |
| Doc staleness | `253-01-SUMMARY.md` and `253-04-SUMMARY.md` still name stamp `20261126140000` (renamed to `20261126150000` at the Phase 230 merge); the code, gate, snapshot and the `_RAW_TRADE_INGESTION_ENABLED` comment use `150000`. Lineage only. |

## Effect of `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` on the success criteria (judged honestly)

- **SC-1: still VERIFIED as written.** SC-1 is the two-run scenario (column set by another strategy, run 2 seeded from what run 1 wrote), and that is closed and tested with the bound RPC healthy. The residual is a different path: the bound RPC unavailable plus a cron store. It does not make the SC-1 arms fail, and it does not reopen the original `[250-BINANCE-STOP-BELOW-CURSOR]` scenario. It does mean the phase GOAL sentence ("never leaves an unread span that no later run re-reads") holds only while `set_strategy_fills_reread_bound` is available. Under an RPC outage the guarantee is fail-closed for the worker's own writes and open for cron/fetch-trades stores. That is a recorded exception, not a verified absolute.
- **SC-4: reinforced.** Keeping the switch off is now load-bearing for a third routed MEDIUM, and the switch-flip phase carries three preconditions (`[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]`, `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` for other venues, `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`). Nothing in this phase turns the switch on. The unmeasured Railway env (human item 5) matters more now.
- **Status:** unchanged, `human_needed`. I do not downgrade to `gaps_found`: the residual is dormant, booked with an owner and a gate, and outside SC-1..SC-5's wording. If the founder judges the goal sentence to require RPC-outage safety, this becomes a gap.

## Gaps Summary

No FAILED truth and no BLOCKER. The phase goal is achieved in the code and in every check that can run without Docker: the per-strategy bound, the provisional-before-the-read write, the round-3 predicate, the carried and cleared flags, and the switch left off with the comment rewritten. Status is `human_needed` because the SQL gate's first real-schema run, 13 live-DB pytest arms, the FULL `sql-mutation` comparison against ARMS_FLOOR 1065, the migration-lane reviews, the Railway env read, and the ship-bound CHANGELOG/VERSION entry (SC-4's last clause) are all not yet evidenced. None of them is a verified-by-execution claim here.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_
