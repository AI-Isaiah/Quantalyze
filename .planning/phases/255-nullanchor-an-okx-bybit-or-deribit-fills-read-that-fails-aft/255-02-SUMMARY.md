---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
plan: 02
subsystem: analytics-service
tags: [okx, bybit, deribit, fills-cursor, reread-bound, job_worker, pytest]

requires:
  - phase: 255-01
    provides: SC-1 two-run matrix (26 RED_AT_HEAD arms) and the SC-2 pin
  - phase: 253
    provides: strategy_fills_reread_bounds table, set_strategy_fills_reread_bound RPC, the Binance bound
provides:
  - the per-strategy re-read bound gated on `_bound_read` (Binance, OKX, Bybit, Deribit)
  - per-venue first-sync reach anchors (OKX 93 d, Bybit 365 d, Deribit epoch 0)
  - off-Binance keep predicate (phase2_failed or a truthy sync_truncated_*)
  - TestBoundOffBinance (13 arms)
affects: [255-03]

actuals:
  tokens: 9600
  tasks: 2
  commits: 2
plan_head_before: 7dc27a0ffdbdadaaaaa3b8d6ae931d1ddca09df4
plan_head_after: 01c430a6708884d4b52172371e787338ce8684d9
commits: 2

tech-stack:
  added: []
  patterns:
    - "A venue-neutral bound flag (`_bound_read`) beside the Binance-only predicate flag (`_binance_read`), both kept inert until the Phase-2 block sets them"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/exchange.py
    - analytics-service/services/trade_resume.py
    - analytics-service/tests/test_nullanchor_bound.py
    - analytics-service/tests/test_binancefills_cursor.py
    - analytics-service/tests/test_sync_trades_resume_seed.py
    - analytics-service/tests/test_sync_trades_store_truth.py
    - analytics-service/tests/test_ana_recon_audit.py

key-decisions:
  - "OKX anchor is the new OKX_FILLS_REACH_DAYS (93), Bybit reuses BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS (365, never the 730-day cap), Deribit is epoch 0 (RESEARCH D1); no helper function (D3)"
  - "The NULL-column None-seed fills_anchor_iso branch stays Binance-only (RESEARCH D2)"
  - "Off Binance the epilogue keeps the bound on phase2_failed or any truthy sync_truncated_*, and otherwise lets RPC R6 clear it"

requirements-completed: [SC-1, SC-2]

status: complete
---

# Phase 255 Plan 02: Extend the bound to OKX, Bybit and Deribit Summary

`run_sync_trades_job` now gates the Phase 253 per-strategy re-read bound on `_bound_read` (a ccxt raw fills read on Binance, OKX, Bybit or Deribit), so a fills read that raises, is rate limited or is cancelled after Phase 251's daily store no longer lets the next run's seed skip the unread span; every Binance-only predicate stays on `_binance_read`.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (tracer) | Extend the bound gate to OKX, Bybit and Deribit; plan 01 matrix GREEN | `a9fdef37616b0c354c78f935c23357e3ba9f5b0e` |
| 2 | Off-Binance mechanism arms; venue-neutral reader docstring; census | `01c430a6708884d4b52172371e787338ce8684d9` |

**For plan 255-03:** take the byte backup of the post-fix `job_worker.py` from the final commit of this plan, `01c430a67` (task 2 does not touch `job_worker.py`, so it is byte-identical to task 1's `a9fdef376`).

## What changed

- `services/exchange.py`: `OKX_FILLS_REACH_DAYS: int = 93` with a `#:` comment, beside `BINANCE_FILLS_REACH_DAYS`.
- `services/job_worker.py` (`run_sync_trades_job` only): `_bound_read` declared beside `_binance_read`; per-venue `elif` anchors after the unchanged Binance branch, then `_bound_read = _reach_anchor_ms is not None`; the bound read, provisional write, orphan arm (resets `_bound_read` too), epilogue inputs and epilogue write gates moved to `_bound_read` (each keeping the `_reach_anchor_ms is not None` narrowing mypy needs); `_earliest_through` has the Binance conditions nested under `if _binance_read:` plus one off-Binance `elif` (never reads a `binance_*` key); the `binance_stop_below_cursor` write is `_binance_read`-conjoined at both sites; the venue word is gone from the three "re-read bound" log texts; the module comment above `_RAW_TRADE_INGESTION_ENABLED` now covers the four venues, and its stale "switch stays off" sentence is replaced by the dated founder ruling.
- `services/trade_resume.py`: `load_strategy_fills_reread_bound` docstring only.
- Tests: plan 01's strict expected-failure marker and its 26 uses removed (the docstring says so in prose, without the identifier); the three OKX intent-change assertions in `test_binancefills_cursor.py` renamed or updated with dated Phase 255 notes (2026-11-27); the three hand-rolled `_rpc` fakes answer `set_strategy_fills_reread_bound` truthy; new `TestBoundOffBinance` (13 arms).

## Measurements

- **The 9 fake-suite failures, measured on the gate change alone** (before the fakes were edited): 9 failed, 53 passed across `test_sync_trades_resume_seed.py` (3: `test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day`, `test_failed_high_water_read_gives_full_reach_on_both_reads`, `test_fills_cursor_governs_the_fills_read_only`), `test_sync_trades_store_truth.py` (5: `TestStoreOrder` x3, `test_persist_failure_stamps_persist_failed_flag[ingestion_on]`, `test_clean_read_pops_every_owned_key[ingestion_on]`) and `test_ana_recon_audit.py` (1: `test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance`). This is exactly RESEARCH's census (3, 5, 1). All 9 pass after the fakes answer the bound RPC truthy, in the same commit.
- Task 1 gate: `212 passed` across `test_nullanchor_bound.py`, `test_binancefills_cursor.py`, `test_okxtrades_cursor.py`, `test_sync_trades_resume_seed.py`, `test_sync_trades_store_truth.py`, `test_ana_recon_audit.py` (0 failed, 0 xfailed, 0 xpassed). The 30 matrix arms all pass.
- Task 2 census count line, verbatim (19 files): `901 passed, 13 skipped, 73 warnings in 149.29s (0:02:29)`.
- mypy strict (CI command): `Success: no issues found in 146 source files`. The local binary is 2.0.0 and CI pins 2.4.0, so CI's run is binding.
- `TestBoundOffBinance` collects 13 arms. `node scripts/verify-plan-anchors.mjs` on this plan: `OK: 1 plan file(s), no stale claims.`
- Acceptance greps: RED_AT_HEAD count 0; `_bound_read` in code lines 7; `if _binance_read and _reach_anchor_ms is not None` 0; `sync_truncated_` conjunct 1; `OKX_FILLS_REACH_DAYS: int = 93` 1; `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS` in code lines 2; `Binance re-read bound` 0; `bounds.calls == []` in the Binance file 0; `Phase 255` in the Binance file 3; the three fakes name `set_strategy_fills_reread_bound`; `git diff --quiet ddd5be9f -- supabase TODOS.md CHANGELOG.md VERSION package.json` exits 0.
- Call counts measured, not assumed: the raised-OKX-read test makes `bounds.reads == 1` and `len(bounds.calls) == 2` (provisional write plus the epilogue write after a plain raise), as stated.

## Deviations from Plan

None - plan executed exactly as written.

Notes: the tracer feedback gate (Interactive mode, `<verify>` automated-only) was satisfied by re-running the task's verify commands end to end before moving on; no checkpoint was needed. The wrapped orphan-comment and stale-switch comment edits were made with exact-string replacement asserts, so each matched once.

## Known Stubs

None.

## Threat Flags

None. The edit adds no endpoint, auth path or schema surface. T-255-03 holds: `binance_stop_below_cursor` is written only under `_binance_read` at both sites, and `test_no_binance_key_on_a_non_binance_run` and `test_a_failed_epilogue_bound_write_sets_no_binance_flag` (plan 01) stay green. The bound-orphan arm resets `_bound_read` (T-255-02), pinned by `test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write`. Plan 255-03's neuters (N1 to N10) prove the new arms' bite.

## Self-Check: PASSED

- FOUND: analytics-service/services/exchange.py (OKX_FILLS_REACH_DAYS), analytics-service/tests/test_nullanchor_bound.py (class TestBoundOffBinance)
- FOUND commits: a9fdef376, 01c430a67 (ancestors of HEAD)
- No change under supabase/, TODOS.md, CHANGELOG.md, VERSION, package.json; STATE.md and ROADMAP.md untouched (orchestrator owns them)
