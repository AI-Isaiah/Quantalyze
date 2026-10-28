---
status: passed
verified_at_sha: e7a9e0b1c43501191d3ac47214770640c103cf26
drift_subjects:
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-01-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-01-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-02-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-02-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-03-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-03-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-04-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-04-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-05-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-05-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-06-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-06-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-07-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-07-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-08-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-08-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-09-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-09-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-10-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-10-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-11-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-11-SUMMARY.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-12-PLAN.md"
  - ".planning/phases/171-readceiling-an-account-above-the-trade-read-ceiling-is-read/171-12-SUMMARY.md"
  - "analytics-service/main_worker.py"
  - "analytics-service/scripts/allocator_history_probe.py"
  - "analytics-service/services/equity_reconstruction.py"
  - "analytics-service/services/trade_read_store.py"
  - "supabase/migrations/20261031120000_allocator_trade_reads.sql"
  - "supabase/tests/test_allocator_trade_reads.sql"
---

# Phase 171: READCEILING Verification Report

**Phase Goal:** An allocator account whose trade history exceeds the rebuild's trade-read ceiling is read in full within a bounded budget, or refused with a named reason a later run can clear, instead of refusing on every attempt and never getting a history.
**Verified:** 2026-10-28T12:30:00Z (worktree `quantalyze-171`, branch `feat/171-readceiling`, head `e7a9e0b1c`)
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria are the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | An a6-shaped account (Bybit member plus other venues, 730-day window) is read in full within a bounded budget, or refused with a named reason a later run can clear | VERIFIED | Layer 1: `_read_bybit_window` (`equity_reconstruction.py`) continues a Bybit window past the 100-page ceiling by time, with a closed segment ceiling and typed `site` on every truncation. Layer 2: `_read_bybit_trades_resumable` keeps each complete 7-day window in `trade_read_store`, defers (`TradeReadDeferred` -> `_defer_reconstruct` -> `defer_compute_job`, attempts untouched) when the soft claim budget (900 s, validated below the 1500 s hard bound at import) runs out at a window boundary, and a read with no progress ends by name (`TradeReadStalled`: 3 stalled claims or 24 h job age -> 16th closed refusal token `account_key_read_stalled` on the forced path, FAILED permanent on the unforced path). Stored windows are KEPT on a stall, a new job starts with a fresh stalled count (`last_job_id`), so a later run can clear it. Nothing is written to history on a deferral (decided last in `_crawl_whole_account`, before the sum and persist). `test_an_a6_shaped_book_is_read_whole_and_replays_equal` and `test_a_bybit_book_too_big_for_one_claim_defers_then_completes` pass; replay over claim-union equals single pass. |
| SC-2 | Tests go RED on the current ceiling behaviour (a truncated read that refuses on every attempt) | VERIFIED | Ran the new tests against the merge-base source (`04f5568a9`, extracted to scratch): `test_trade_pages.py` 18 failed / 23 passed; `test_an_over_ceiling_window_is_read_whole` fails with `TruncatedTradeRead: the trade read was cut short...` (a finite 10,500-trade window, exactly the old refusal); `test_an_a6_shaped_book_is_read_whole_and_replays_equal` and the claim-union equality tests also RED; `test_reconstruct_whole_account.py` and `test_bybit_two_year_window.py` do not even collect at base. All GREEN at head. |
| SC-3 | After deploy the TRADEPAGES probe re-reads a6 and the outcome is recorded (counts and tokens only) | VERIFIED (from recorded evidence) | `171-12-SUMMARY.md` (commit `e7a9e0b1c`): PR #1138 merged `dae62ece3`; apply-test and apply success; worker-first deploy order and a 0-minute window recorded; one deployed-probe run 2026-10-28 on `c9458d7b4`. a6: `failure_class none`, `truncated_site none`, 2158 calls, 203279 trades, 1048 s, `window_days 730`, `bybit_members 1`, `other_members 2`. Versus the D-01 reading in `171-05-SUMMARY.md` (truncated at `bybit_window_ceiling`, 1114 calls, 101557 trades, 504 s). Verdict `read-in-full`. Records are counts and tokens only (no uuid, no 10+ digit run besides a CI run id). I cannot query PROD, so this rests on the recorded reading, as instructed. |

**Score:** 3/3 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/trade_read_store.py` (687 lines) | compact chunked windows, claim bookkeeping, ContextVar scope, store-fault disposition | VERIFIED | Substantive; imported by `equity_reconstruction` and `main_worker`; no import cycle by design; mypy strict clean. |
| `analytics-service/services/equity_reconstruction.py` | segment/continuation read, resumable read, defer/stall handling, 16th token | VERIFIED | `_read_bybit_window`, `_read_bybit_range`, `_read_bybit_trades_resumable`, `_defer_reconstruct`, scope set in both forced and unforced handlers, member key binding in `_crawl_account_key`, purge on success. `TRUNCATED_READ_SITES` has 9 sites; every raise passes a `site`. |
| `supabase/migrations/20261031120000_allocator_trade_reads.sql` | two service-role-only tables, FORCE RLS, no policy, CASCADE erasure, catalogue-only verify | VERIFIED | Read in full. REVOKE ALL then GRANT S/I/U/D to service_role only; verify block reads the catalogue only (no data-dependent escape). PROD catalogue after apply recorded in 171-12 SUMMARY: `tables 2, rls forced 2, policies 0, anon/authenticated privileges 0`. |
| `supabase/migrations/down/20261031120000-rollback.sql` | data-keeping rollback | VERIFIED | Renames aside, keeps rows, catalogue-only pre/post checks. |
| `supabase/tests/test_allocator_trade_reads.sql` | 8-arm gate with RED-UNDER twins | VERIFIED | 8 arms plus sentinel; 19 `RED-UNDER` occurrences; census (`ci.yml` SENTINEL_FLOOR 25, ARMS_FLOOR 386; `mutation-floors.mjs` FILES_FLOOR 81, ARMS_FLOOR 816) moved. |
| `analytics-service/main_worker.py` | hourly sweep of expired store rows in watchdog loop | VERIFIED | `sweep_expired_trade_reads` called inside its own try/except in `watchdog_loop`; stamps the clock before purging. |
| `analytics-service/scripts/allocator_history_probe.py` | D-01 keys `truncated_site`, `last_window_age_bucket`, `last_window_calls`, `read_elapsed_s`, deployed-names guard | VERIFIED | Present in record keys, validators, defaults; `missing_deployed_names()` refuses (exit 2) before any decrypt. Its site tuple is pinned to `TRUNCATED_READ_SITES`. |
| `analytics-service/tests/test_trade_read_store_live.py` | live-lane round trip | VERIFIED (CI-only) | Locally 3 of 4 skip ("local-stack lane not configured"); the lane run is recorded in 171-11 SUMMARY (4 passed) and the merged PR's CI was green. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `run_reconstruct_allocator_history_job` (forced + unforced) | `trade_read_store` | `store.trade_read_scope(TradeReadScope(...))` around the pinned crawl | WIRED | Both crawl sites wrapped; scope rides a ContextVar so the pinned five-positional crawl call is unchanged. |
| `_fetch_bybit_trades` | `_read_bybit_trades_resumable` | `store.current_trade_read_scope()` with api key id and job id set | WIRED | No scope (probe) or `begin_claim` None -> `_read_bybit_range` (layer 1 exactly). |
| `_crawl_account_key` | per-member store key | `dataclasses.replace(scope, api_key_id=member id)` | WIRED | Each member reads under its own key; sibling never borrows. |
| `TradeReadDeferred` | `defer_compute_job` | `_defer_reconstruct` RPC (`p_job_id`, `p_defer_seconds`, `p_reason`, `p_claim_token`) | WIRED | Signature matches `20261001120000_compute_job_fence_errcode_55006.sql`; 55006 reclaim yields DEFERRED; arm precedes the generic `except Exception`. |
| `_crawl_whole_account` | refusal vocabulary | `TradeReadStalled` -> `ForcedRebuildRefusedError("account_key_read_stalled")`; `TradeReadDeferred` remembered and raised last | WIRED | Token in `FORCED_REBUILD_ACCOUNT_REASONS` (set is 16); pin tests moved; handoff amended in `167.2.1.1.2-09-SUMMARY.md` (lines 219-225). |
| `watchdog_loop` | `purge_expired` | `sweep_expired_trade_reads` | WIRED | Tested by `test_the_watchdog_loop_runs_the_trade_read_sweep_and_survives_its_failure`. |
| success path | `purge_keys` | after persist, Bybit venue or account rebuild | WIRED | Includes all account member key ids. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| resumable read output | `output` trades | stored windows via `load_window` or live `_read_bybit_window`, both through `_as_stored_trade` (one shape) | Yes; PostgREST round trip proven on the lane (171-11), replay equality proven in `test_a_book_read_across_claims_equals_a_single_pass` | FLOWING |
| probe record | `truncated_site` etc. | exception `.site` or derived from the probe's own call log | Yes; real a6 reading in 171-05 and 171-12 SUMMARYs | FLOWING |

### Behavioral Spot-Checks (run by me, head `e7a9e0b1c`)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test files (trade_pages, resume, store, whole_account, probe, two_year_window, force_rebuild, equity_reconstruction) | `pytest ... -q` from `analytics-service/` | 414 passed | PASS |
| Full analytics suite | `pytest -q -n 4` | 13154 passed, 99 skipped | PASS |
| mypy strict as CI | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Success: no issues found in 125 source files | PASS |
| TS census / floor / lint / anti-skip tests | `vitest run` on mutation-runner-floors, gate-family-meta, lint-sql-gates, drift-check-scripts, mutation-annotation-parser, ci-anti-skip-gate.contract | 6 files, 1275 passed | PASS |
| RED at base (SC-2) | new tests against `04f5568a9` source | 18 failed in `test_trade_pages.py`; over-ceiling and a6-shaped tests fail with `TruncatedTradeRead`; two other files fail at import | PASS (RED as required) |

### Probe Execution

The phase's probe (`scripts.allocator_history_probe`) is a PROD-reading operator tool, run by the orchestrator in plans 05 and 12. I did not and cannot run it (no PROD access). Its recorded output is the SC-3 evidence above. Its unit tests (`test_allocator_history_probe.py`) pass locally.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SC-1 | 02, 03, 04, 06, 07, 08, 09, 10, 11, 12 | ROADMAP success criterion 1 (read in full or named clearable refusal) | SATISFIED | See truth SC-1 |
| SC-2 | 02, 07 | ROADMAP success criterion 2 (RED on current behaviour) | SATISFIED | See truth SC-2 |
| SC-3 | 01, 05, 12 | ROADMAP success criterion 3 (post-deploy a6 re-read recorded) | SATISFIED | See truth SC-3 |

`.planning/REQUIREMENTS.md` has no entry for Phase 171 (ROADMAP says `Requirements: TBD`; grep for `READCEILING`, `Phase 171`, `SC-1` returns nothing). The plans' `requirements:` IDs (SC-1, SC-2, SC-3) are the ROADMAP success criteria, and all three are accounted for. No orphaned requirements.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` added in any phase-modified implementation or migration file. Round-3 code review (`171-REVIEW.md`) and silent-failure hunt (`171-SFH.md`) at `318f3fd09` are clean (0 findings MEDIUM+); the only later source change is the merge of origin/main (Phase 175 MT5OFFSET), not phase code.

### Human Verification Required

None.

### Notes (non-blocking, recorded for the orchestrator)

1. **Out-of-scope vitest failures.** The 2 local failures in `src/lib/factsheet/compute.conventions.test.ts` (last-digit float inline snapshots) are in files this branch does not touch (`git diff origin/main...HEAD --stat` lists nothing under `src/lib/factsheet`). Treated as a local macOS platform artifact, as the orchestrator stated. I did not re-run the full vitest suite.
2. **Layer 2 not exercised on real a6.** The post-deploy probe has no store scope, so it exercised layer 1 only: the read took 1048 s, inside the 1500 s hard bound but over the 900 s claim budget, so a real a6 reconstruct would defer once and resume. Layer 2 is proven by synthetic finite books (plans 07-09), the live local-stack lane (plan 11, CI-run) and review rounds, not by a real a6 job. No a6 job was enqueued, by the founder's "Rebuild none" decision (Phase 173 decides which Bybit histories are rebuilt). This is the booked scope of SC-3, not a gap. 171-12 SUMMARY flags the 900 s budget as an env-tunable (`TRADE_READ_CLAIM_BUDGET_S`) tuning note.
3. **jsonb numeric property.** A stored double of 1e16 or more comes back as a Python `int` (171-11 SUMMARY); numerically equal, replay converts with `float()`, pinned by test. Irrelevant for real trade amounts.
4. **Planning bookkeeping lag (orchestrator-owned, I did not edit it).** In `ROADMAP.md` plans 171-05 and 171-12 are still `[ ]`, `Plans: 10/12`, and the Progress table row reads `171 READCEILING | 0/0 | Not started`. Both plans have complete SUMMARYs.
5. **Local skips.** 99 skipped in the full pytest run include the 3 live-lane tests of `test_trade_read_store_live.py`, which need the CI local stack.
6. **Process deviation recorded, not a gap.** 171-12 SUMMARY records that the marker query ran as its own SQL file rather than at the top of every file, and that the backfill worker started 9 s before the PROD apply finished (deploy order is not load-bearing by design: `begin_claim` None -> layer 1).

## Gaps Summary

No gaps. All three ROADMAP success criteria are verified against the code and the recorded PROD reading; no truth FAILED, no stub or unwired artifact, no blocker anti-pattern.

---

_Verified: 2026-10-28T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
