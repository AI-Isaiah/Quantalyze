---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
verified: 2026-11-14T13:20:00Z
status: passed
score: 5/6 must-haves verified by test; the sixth (WR-01 lock order) accepted on the code check by founder decision 2026-11-14
verified_at_sha: d8a1bae51441f84af35ed0e90c0c4b4c989e414e
drift_subjects:
  - analytics-service/services/trade_resume.py
  - analytics-service/routers/exchange.py
  - analytics-service/routers/cron.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/ingestion/long_fetch.py
  - src/lib/ledger-refresh-marker.ts
  - supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql
  - supabase/migrations/down/20261114130000-rollback.sql
  - supabase/schema/functions/_record_enqueue_dedup.sql
  - supabase/schema/functions/_enqueue_compute_job_internal.sql
  - supabase/tests/test_enqueue_dedup_record_retract.sql
  - analytics-service/tests/test_fetch_trades_resume_seed.py
  - analytics-service/tests/test_sync_trades_resume_seed.py
  - analytics-service/tests/test_stitch_composite_entry_snapshot.py
behavior_unverified: 1
behavior_unverified_items:
  - truth: "The D11 helper cannot disturb the Phase 164.9.3.1 ancestor-first lock order: it skips done_pending_children rows (WR-01) and its other waits are plain waits, never a cycle"
    test: "On a two-session lane (or in PROD-like load), run a diamond fan-in where one session holds mark_compute_job_done / mark_compute_job_failed cascading over a done_pending_children child while a second session sends a correlation_id enqueue that dedups onto that child and onto the cascading job's own running row"
    expected: "No deadlock (no 40P01), the enqueue returns the existing id, and no dedup event or retraction lands on the done_pending_children child"
    why_human: "The only gate is single-session. The DPC-SKIP arm proves the skip effect, not the absence of a lock wait or cycle. The fixer and reviewer both record this as a locking argument from the code, with the two-session proof (review option c) not built."
founder_decisions:
  - item: "WR-01 lock-order argument for _record_enqueue_dedup"
    decision: "Merge on the code check (founder, 2026-11-14). The lock-order safety rests on the code argument in the migration header; the two-session pg-lane diamond test (review option c) is not built."
  - item: "CI readings on the PR head"
    decision: "Read on PR #1271 head 0bd3deb37: sql-tests, sql-mutation and python green; sql-gate-lint (baseline content-drift) and test-db-drift red in the expected-red-until-apply state, as predicted. Merged as aabe74272; Supabase Migrate run 43594887781 applied 20261114130000 to TEST and PROD."
human_verification_resolved:
  - test: "Lock-order argument for _record_enqueue_dedup (WR-01)"
    expected: "No deadlock or lock wait cycle between a correlation_id dedup enqueue and mark_compute_job_done / mark_compute_job_failed / defer_compute_job fan-in cascades"
    why_human: "Single-session gates cannot prove the absence of a wait cycle. Founder review of the argument in the migration header, or a two-session pg-lane test."
  - test: "CI on the PR head: sql-tests (local-stack lane with the D-F replay), sql-mutation FULL, test-db-drift"
    expected: "sql-tests replays 20261114130000 on the committed dump and the restated REVOKE holds against the real Supabase default-grant trigger; sql-mutation FULL reads ARMS_FLOOR 846 and FILES_FLOOR against a real biting count; baseline-content-drift and VAC-08 stay in their known expected-red-until-apply state (2 DRIFT rows on _enqueue_compute_job_internal/7 and /10 and 1 SNAPSHOT_MISSING for _record_enqueue_dedup/4)"
    why_human: "The Docker local-stack was deliberately not booted (disk). ARMS_FLOOR 846 is a static annotated count, an upper bound on biting. Only CI's full run compares it with a real count."
---

# Phase 211: SYNCJOBS Verification Report

**Phase Goal:** Sync and job bookkeeping are correct on every path: a user-triggered trade fetch no longer seeds from the poll-overwritten `last_sync_at`, the enqueue dedup no longer drops the caller's metadata, and composite `_stamp_failed` stops reading status live. Closes TODOS `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`, `161.1-D11` and `161.1-D5`.
**Verified:** 2026-11-14 at HEAD `d8a1bae51441f84af35ed0e90c0c4b4c989e414e`
**Status:** passed (2026-11-14, founder decision "Merge on the code check" for WR-01; the original status was human_needed: no gaps, one behavior-dependent truth has no behavioral test)
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: a user-triggered fetch cannot skip trades that the poll's `last_sync_at` write would hide (route AND queued `sync_trades` job) | VERIFIED | `routers/exchange.py:1775-1776` seeds `since_ms = parse_since_ms(_hw_by_strategy.get(req.strategy_id))` from `load_strategy_high_waters` (`services/trade_resume.py`, the single moved definition; `cron.py:22` imports it under `_load_strategy_high_waters`). `job_worker.py` `run_sync_trades_job`: `daily_since_ms` from the same helper off the event loop; `fills_since_ms` = `last_fetched_trade_timestamp` cursor, falling back to `daily_since_ms`, never `last_sync_at`. The 7-day span guard, the `last_sync_at` / `account_balance_usdt` write-back and the MT5 arm are unchanged. I neutered the route to `key_data.get("last_sync_at")`: 3 of 4 route tests went RED. I neutered the job seed likewise: 3 of 3 job tests went RED. Both restored byte-identical (sha1 before and after match). `LAST-FETCHED-TRADE-TS-AHEAD` is left open as decided. |
| 2 | SC-2: a dedup enqueue keeps the caller's metadata by a recorded rule (D11 option B, "Record + drop the flag") | VERIFIED | Migration `20261114130000` creates `compute_job_dedup_events` (RLS on, deny-all policy, service_role SELECT only) and `_record_enqueue_dedup`, called at SITE A (look-up hit) and SITE B (lost-race re-read) of both overloads. I diffed the migration's two overload bodies against their latest prior definitions: 10-arg equals `20261024120000:499` exactly once the helper calls are removed, 7-arg equals `20260716090000:49` except for `public.` qualification. The helper retracts through `public.retract_ledger_refresh_marker` (no second UPDATE), only for the three marker-capable kinds, with a `correlation_id` and no caller marker, and skips parented enqueues, NULL/empty/non-object metadata and `done_pending_children` rows; oversize metadata is recorded as `{oversize_bytes: n}`. No caller key is merged. I ran the gate through the mutation runner on the pg-lane (scratch cluster): baseline exit 0, 16/16 arms RED with identity ok, restore exit 0. D11-5 census re-checked: SQL fan-outs send fixed `source`-only metadata, `keys/sync` and `intro` are authenticated user routes, and the only background `correlation_id` senders are `reconcile-strategies` and `sync-funding`, whose kinds are outside the retraction's kind scope. |
| 3 | SC-3: composite `_stamp_failed` uses the status captured at job start | VERIFIED | `run_stitch_composite_job` takes `_entry_computation_status` once at entry, gated on `ledger-refresh-composite`; `_stamp_failed` sets `existing_status = _entry_computation_status`; the stamp-time SELECT now reads only `data_quality_flags` (live, for M-2). A failed entry read is logged at ERROR, captured, and raised as `RefreshMarkerRereadUnavailable` (transient); a programming error propagates. Unmarked jobs issue no extra read. I neutered the assignment to the live column: both F2-direction tests went RED. Restored byte-identical. |
| 4 | SC-4: each fix has a test that goes RED when reverted | VERIFIED | The RED runs above cover D5 and both LASTSYNC-SEED readers. D11 is covered by the 16 gate arms, each with a RED-UNDER twin, confirmed biting in my runner run. The vitest census and parity tests also pass. |
| 5 | D11 parity: the SQL marker list and retraction function equal the Python and TypeScript constants, and no comment still describes D-02 as open for a `correlation_id` caller | VERIFIED | `test_compute_job_metadata_merge_parity.py` and `src/lib/ledger-refresh-marker.test.ts` read the `_record_enqueue_dedup.sql` snapshot and pass. `long_fetch.py` and `ledger-refresh-marker.ts` now say CLOSED IN SQL for `correlation_id` callers, name the Python/TS retractions as backstops, and name `finalize-wizard` / `csv-finalize` as the residual (D11-9). |
| 6 | The helper does not disturb the Phase 164.9.3.1 ancestor-first lock order (D11-10 and review WR-01) | PRESENT_BEHAVIOR_UNVERIFIED | Present and wired: the helper skips parented enqueues and `done_pending_children` rows through a plain SELECT, and the DPC-SKIP arm pins the skip. The residual claim that the helper's other waits are plain waits and cannot form a cycle is an argument from the code (REVIEW IN-06 records the header's list of waits as incomplete, behaviour correct). The only gate is single-session, so the absence of a wait cycle is not exercised. See Human Verification. |

**Score:** 5/6 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/trade_resume.py` | the one stored-high-water definition | VERIFIED | Leaf module, imported by `exchange.py`, `cron.py`, `job_worker.py` |
| `routers/exchange.py` | route seeds from the high-water | VERIFIED | wired, tests RED when reverted |
| `services/job_worker.py` | job seeds and D5 snapshot | VERIFIED | wired, tests RED when reverted |
| `supabase/migrations/20261114130000_...sql` | table, helper, both overloads, ACL, verify | VERIFIED | applied on the pg-lane; catalogue verify block present; no stale `20261114120000` reference remains in code |
| `supabase/migrations/down/20261114130000-rollback.sql` | manual rollback | VERIFIED | present, renamed with the migration; rollback proof recorded in the plan 03 summary |
| `supabase/schema/functions/_record_enqueue_dedup.sql`, `_enqueue_compute_job_internal.sql` | generated snapshots | VERIFIED | `npm run schema:functions:check`: current, 133 functions |
| `supabase/tests/test_enqueue_dedup_record_retract.sql` | 16-arm gate | VERIFIED | 16/16 biting |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `exchange.py` `fetch_trades` | `trade_resume.load_strategy_high_waters` | direct call, mapping value to `parse_since_ms` | WIRED |
| `cron.py` | `trade_resume.load_strategy_high_waters` | import as `_load_strategy_high_waters`; cron tests green | WIRED |
| `job_worker.run_sync_trades_job` | `trade_resume.load_strategy_high_waters` | `db_execute(lambda: ...)` | WIRED |
| `_enqueue_compute_job_internal` (both overloads) | `_record_enqueue_dedup` | `PERFORM` at SITE A and SITE B, not at the fresh-insert return | WIRED |
| `_record_enqueue_dedup` | `retract_ledger_refresh_marker` | direct call, no own UPDATE | WIRED |
| `_stamp_failed` | entry snapshot | closure variable `_entry_computation_status` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
|----------|---------------|--------|-----------|--------|
| `fetch_trades` | `since_ms` | `trades` table newest `is_fill = false` row | Yes | FLOWING |
| `run_sync_trades_job` | `daily_since_ms`, `fills_since_ms` | same helper, plus `api_keys.last_fetched_trade_timestamp` | Yes | FLOWING |
| `_stamp_failed` | `existing_status` | `strategy_analytics.computation_status` read at entry | Yes | FLOWING |
| `compute_job_dedup_events` | `caller_metadata` | `p_metadata` of the deduped caller | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase pytest files | `.venv/bin/python -m pytest` over the 7 phase test files (from `analytics-service/`) | 224 passed | PASS |
| Neighbouring cron / job_worker suites | pytest over 7 files | 341 passed, 3 skipped | PASS |
| mypy strict on the 4 changed modules | `mypy services/trade_resume.py routers/exchange.py routers/cron.py services/job_worker.py` | no issues | PASS |
| D11 gate, all arms bite | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_enqueue_dedup_record_retract.sql` | baseline 0, `arms: 16/16/0`, `biting: 16`, restore 0 | PASS |
| vitest census and parity | 6 files (ledger-refresh-marker, mutation-runner-floors, gate-family-meta, mutation-annotation-parser, drift-check-scripts, lint-sql-gates) plus ci-anti-skip contract and critical-regressions | all pass (1300, then 181) | PASS |
| SQL gate lint and snapshot currency | `lint-sql-gates.mjs`; `npm run schema:functions:check` | 0 findings; current | PASS |
| `baseline-content-drift-check.mjs` | direct run | 3 findings (DRIFT `_enqueue_compute_job_internal/7` and `/10`, SNAPSHOT_MISSING `_record_enqueue_dedup/4`) | EXPECTED RED until apply-on-merge and the post-apply re-dump; documented in the migration header and plan 03 summary, no allowlist row added |

### Probe Execution

No phase-declared probes. SKIPPED.

### Requirements Coverage

Plan frontmatter declares `SC-1`, `SC-2`, `SC-3`, `SC-4`. These are the ROADMAP success criteria, not REQUIREMENTS.md ids (ROADMAP `Requirements: TBD`, and REQUIREMENTS.md has no Phase 211 mapping), so there is nothing to cross-reference and nothing orphaned. All four are covered by truths 1 to 4.

| Requirement | Source Plan | Status |
|-------------|-------------|--------|
| SC-1 | 211-01, 211-04 | SATISFIED |
| SC-2 | 211-03, 211-05, 211-07 | SATISFIED |
| SC-3 | 211-02 | SATISFIED |
| SC-4 | 211-01..07 | SATISFIED |

### Anti-Patterns Found

None blocking. No `TBD`, `FIXME` or `XXX` in the phase's added lines. Open review items are Info only (IN-01 to IN-06), recorded by policy and not fixed:

| Item | Severity | Impact |
|------|----------|--------|
| IN-02 (also the rls-policy-auditor LOW): `GRANT EXECUTE ... TO service_role` on `_record_enqueue_dedup` is unnecessary and lets a direct service_role caller write dedup events and retract markers; contradicts the table comment | Info | no cross-tenant scope |
| IN-01: a retraction failure can abort the caller's enqueue | Info | not realistic today |
| IN-03, IN-04, IN-05, IN-06 | Info | none affects the goal |

### Human Verification (resolved 2026-11-14, see Founder resolution)

#### 1. Lock-order argument for the dedup helper (WR-01)

**Test:** Review the lock argument in the migration header against `mark_compute_job_done`, `mark_compute_job_failed` and `defer_compute_job`, or build the two-session pg-lane diamond test (review option c).
**Expected:** No deadlock between a `correlation_id` dedup enqueue and a fan-in cascade; no event or retraction on a `done_pending_children` child.
**Why human:** The gate is single-session and cannot prove an absent wait cycle.

#### 2. CI readings on the PR head

**Test:** Read `sql-tests` (D-F replay of the new migration on the local-stack lane), `sql-mutation` FULL (ARMS_FLOOR 846, FILES_FLOOR, WAIVED_CEILING 0) and `test-db-drift` against the head SHA with the expected check count.
**Expected:** All green except the two known expected-red-until-apply drift reads above.
**Why human:** The Docker local-stack and the full mutation corpus were not run here, by instruction; ARMS_FLOOR 846 is a static upper bound until CI measures it.

### Founder resolution (2026-11-14)

- **WR-01 (item 1): "Merge on the code check."** The founder accepted the lock-order argument in the migration header as sufficient. The two-session test was not built, and `behavior_unverified: 1` above stays true as a fact about the evidence: the absence of a wait cycle is argued, not exercised. Status moved `human_needed` -> `passed` on this decision, with no code change.
- **CI readings (item 2):** read on PR #1271 head `0bd3deb37`: `sql-tests`, `sql-mutation` and `python` green; `sql-gate-lint` (baseline content-drift) and `test-db-drift` red in the expected-red-until-apply state. Merged as `aabe74272`; Supabase Migrate run `43594887781` applied the migration to TEST and PROD.
- **D11-9 residual:** routed to Phase 214 FRESHTRUTH by founder decision 2026-11-14 (TODOS `211-D11-RESIDUAL-UNCORRELATED-SENDERS`, owner Phase 214).

⛔ **CURRENCY 2026-11-14 (records PR after the ship).** This report was written at `d8a1bae51`, before the ship branch's last commits. Where it names a floor as a current value it is stale: the ship rebased onto Phase 210 and raised `ARMS_FLOOR` in `scripts/mutation-floors.mjs` past the 846 cited above, the `ci.yml` anti-skip gate credit for `test_enqueue_dedup_record_retract.sql` moved 15 -> 16 (`ALL 16 ARMS EXECUTED`, the WR-01 DPC-SKIP arm) with that job's `ARMS_FLOOR` 460 -> 461, and the drift-check pin followed to 461. Read current values by symbol (`grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR)' scripts/mutation-floors.mjs`; `grep -n 'ARMS_FLOOR=' .github/workflows/ci.yml`), never from this report. The migration number `20261114130000` cited throughout is the shipped one. The 846 mentions above are kept as the reading at verification time.

### Ship-step notes (not gaps)

- TODOS entries `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`, `161.1-D11` and `161.1-D5` are still present in `TODOS.md`. The plans forbid editing `TODOS.md`; the ship step owns deleting them. `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays open.
- The ship step must book the D11-9 residual (finalize-wizard and csv-finalize send no `correlation_id`) as a new TODOS entry, and write the CHANGELOG entry and VERSION bump.
- Migration `20261114130000` sorts after the newest migration on `origin/main` (`20261114120000`, Phase 210). No other main migration is newer.
- Review artifacts record migration-reviewer pass 2 clean and rls-policy-auditor 0 CRITICAL/HIGH/MEDIUM.

### Gaps Summary

No gaps. All four ROADMAP success criteria are met in the code and were exercised: I reverted each of the three fixes and watched its tests go RED, and every one of the 16 SQL gate arms bites on a fresh lane. The status is human_needed only because the lock-order claim for the new SQL helper rests on a code argument that no multi-session test exercises, and because CI's full-lane readings have not run.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
