---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
verified: 2026-11-24T18:00:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: 3e7d377da644403f8fc0f1f94cf6c624ba7110d5
drift_subjects:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/routers/cron.py
  - analytics-service/tests/test_okxtrades_cursor.py
  - analytics-service/tests/test_okxtrades_walk.py
  - analytics-service/tests/test_okxtrades_ccy.py
  - analytics-service/tests/test_cron_router.py
behavior_unverified: 0
overrides_applied: 0
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `549f192d8`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `3e7d377da` (#1330) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only 549f192d8 3e7d377da -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.

# Phase 232: OKXTRADES Verification Report

**Phase Goal:** An OKX read converts or refuses a non-USDT daily bill, completes a first window longer than the page cap, and never lets the trade cursor run ahead of stored trades.
**Verified:** 2026-11-24T18:00:00Z
**Status:** passed (with one reading pending a founder ruling, stated under SC-2, and one post-merge data step, stated under Known limits)
**Re-verification:** No, initial verification

## Required reading of SC-2 (stated explicitly)

SC-2 says "completes across ticks with no daily `error`". It is read as the KEY status `error`, the planner ruling in `232-CONTEXT.md` `<orchestrator_rulings>`, which follows the TODOS entry wording ("reports `error` daily").

- A catch-up tick's key status is `held` with `fetch_partial_prefix: true`, never `error`.
- The `cron_runs` heartbeat row still says `error`, naming `held=1`, on catch-up ticks. It is deliberately NOT changed (`git diff 5217975b6...HEAD -- analytics-service/routers/cron.py` touches no heartbeat or `_NON_OK_STATUSES` code; `held` stays in `_NON_OK_STATUSES`), so a permanent stall stays loud. A self-resolving backlog writes about one such row per catch-up tick except the last.
- This reading is being put to the founder by the coordinator.
- ⭐ **FOUNDER RULING 2026-11-24 (supersedes the bullet above and the "what would change" bullet below, both kept as lineage):** "SC-2 = key status only. SC-2 is met as verified, and the heartbeat row keeps reporting held keys as error." The key-status reading is now the founder's, not only the planner's. SC-2 stays VERIFIED, `status: passed` stands with no pending reading, and the `cron_runs` heartbeat classification of `held` is not to be changed.
- What would change if the founder reads SC-2 as also covering the heartbeat row: SC-2 would be NOT MET as written. A catch-up tick would still write a `cron_runs` row with status `error`, and `test_tracer_a_long_okx_first_window_completes_across_ticks_inside_the_key_budget` asserts exactly that row (`row["status"] == "error"`, `"held=1" in row["error"]`). Closing it would need a separate edit to how the heartbeat classifies `held` plus a way to keep a permanent stall loud (for example, `held` plus `fetch_partial_prefix` counted OK only while the stored high-water advanced between ticks). That is outside the four plans' scope. The status would move to `gaps_found`.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 (VREAD-06): a non-USDT OKX daily P&L bill is converted at a stated rate or refused by name; a test RED on today's code feeds a mixed-currency day | VERIFIED | `services/exchange.py` OKX aggregation (after the type-8 drop and the finite parse): a nonzero amount whose `ccy` is not stable under `price_rule.is_stable_value` is censused, `daily_pnl_non_usd_okx` is recorded, and the function returns `[]`. Stable coins count at 1.0. Token registered in `daily_pnl_read_verdict` (exchange.py:264), `READ_INCOMPLETE_TOKENS` and `_DAILY_PNL_REFUSAL_ORDER` (job_worker.py), and `_fetch_degradation` in cron.py, so it reaches the cron as a degraded read. Tracer `test_okxtrades_ccy.py::test_tracer_a_mixed_currency_day_is_refused_by_name_never_summed` is RED on pre-fix code (it summed 9.5 at face value) and green now. |
| 2 | SC-2 (VREAD-07): a first window longer than the page cap completes across ticks with no daily `error`, `OKX_BILLS_PAGE_CAP` unchanged | VERIFIED under the stated reading | OKXHISTORY did NOT close it (232-02-SUMMARY: pre-fix code ran one `begin`-only loop per endpoint and the tracer goes RED on it). Fix: `fetch_daily_pnl` walks UTC-day-aligned 7-day windows oldest first; cap is per (window, instType, endpoint); deadline or cap stops return a contiguous oldest prefix. `OKX_BILLS_PAGE_CAP = 100` and `OKX_ARCHIVE_PAGE_CAP = 100` are identical at base 5217975b6 and HEAD, and pinned by `test_the_page_caps_are_unchanged`. The cron passes `OKX_CRON_READ_DEADLINE_S = 35.0` to OKX only, stores the prefix, holds `last_sync_at`, every strategy marker and every recompute (`fetch_prefix_only` gates `should_advance_cursor`, `strategy_advances`, `recompute_strategy_ids`; degraded wins). Tracer `TestAnOkxPrefixIsStoredAndHeld::test_tracer_a_long_okx_first_window_completes_across_ticks_inside_the_key_budget` drives 61 days across ticks: every tick stays inside `KEY_SYNC_TIMEOUT` (60 s), every non-final tick is `held` + `fetch_partial_prefix` and never key `error` or `fetch_degraded`, the final tick is `ok`, and the union of stored days equals every day with bills. A single window past the cap still refuses by name (`daily_pnl_truncated_okx`, key `error`), which is the by-design loud case, not a long first window. |
| 3 | SC-3 (VREAD-08): a key whose cursor is ahead of its newest stored trade reads from the stored high-water and re-reads its skipped days; the cursor never advances past stored data | VERIFIED | `run_sync_trades_job`: seed is `min(cursor, newest stored fill, else daily seed)` via the new fail-open `trade_resume.load_strategy_fill_high_water` (`is_fill = true`). The stamp is the newest PERSISTED fill timestamp, or NULL (RPC leaves the column untouched); it never stamps wall-clock now. Gate: `bool(raw_fills) and phase2_complete and not phase2_failed and not phase1_failed and not _fills_incomplete` (`sync_truncated_*` or `binance_partial_symbols`). A bootstrap read that fails, truncates or partially persists anchors a NULL column at its read start, never past it. Pinned by `test_okxtrades_cursor.py` (20 arms incl. refuse-then-clean sequences for gap 1 of the 231 hand-off and the CR-01/CR-02 fix arms). |
| 4 | SC-4: PROOF-01, each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored by `cp` from a byte backup, `cmp`, then GREEN, recorded verbatim in the plan SUMMARY | VERIFIED | Present in all four SUMMARYs. 232-01: pre-fix RED (19 failed) plus N1..N7 blocks (232-01-SUMMARY, "PROOF-01 records"). 232-02: tracer RED and N1..N7 (`proof.log` excerpt, each with `cp restore done; cmp: identical (exit 0, no output)` then GREEN). 232-03: tracer RED plus N1..N8. 232-04: tracer RED plus N1..N6. Fix-round tests (CR-01, CR-02) are recorded in `232-REVIEW.md` `## Fix round 1` (RED assertion text, restore, GREEN counts). Recorded deviations are disclosed, not hidden: 232-02 deviation 1, 232-03 deviation 1 and 232-04 deviation 1 say some registration/cron tests were written green-first and are proven by their neuters instead. I read the records; I did not re-run the neuters. |

**Score:** 4/4 truths verified (0 behavior-unverified)

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/exchange.py` | window walk, ccy census, deadline/cap flags, `_okx_bills_window_read`, `OkxBillsWindowIncomplete` | VERIFIED | read in full for the OKX branch; caps unchanged |
| `analytics-service/services/job_worker.py` | stored-through stamp, seed clamp, anchor, token registration | VERIFIED | diff read |
| `analytics-service/services/trade_resume.py` | `load_strategy_fill_high_water` | VERIFIED | fail-open, `is_fill = true`, wired from `run_sync_trades_job` |
| `analytics-service/routers/cron.py` | OKX-only deadline, prefix gates, `_FETCH_NON_USD_FLAG` | VERIFIED | diff read; heartbeat untouched |
| `tests/test_okxtrades_{cursor,walk,ccy}.py`, `tests/test_cron_router.py` | phase gates | VERIFIED | all pass |
| `docs/runbooks/okxhistory-go-live.md` | dated CORRECTED notes (lineage kept) | VERIFIED | 2 notes added |

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `exchange.fetch_daily_pnl` | `cron._fetch_degradation` / `job_worker` refusal sets | flag `daily_pnl_non_usd_okx` | WIRED |
| `exchange.fetch_daily_pnl` deadline | `cron._sync_single_key` | `read_deadline_s=OKX_CRON_READ_DEADLINE_S` and flag `daily_pnl_deadline_okx` -> `fetch_prefix_only` | WIRED |
| `run_sync_trades_job` | `advance_sync_cursor` RPC | `_p_last_fetched` (stored-through stamp or anchor) | WIRED |
| `run_sync_trades_job` | `trade_resume.load_strategy_fill_high_water` | seed clamp | WIRED |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| cursor stamp | `_p_last_fetched` | `max(coerce_to_aware_utc(fill["timestamp"]) for fill in raw_fills)` of persisted fills | yes | FLOWING |
| fills seed | `fills_since_ms` | `trades` table newest `is_fill = true` row | yes | FLOWING |
| cron prefix | `fetch_prefix_only` | drained DQ flag set by the walk | yes | FLOWING |

## Behavioral Spot-Checks (run by me, from `analytics-service/` with `.venv/bin/python`)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cursor, walk and ccy gates | `pytest tests/test_okxtrades_cursor.py tests/test_okxtrades_walk.py tests/test_okxtrades_ccy.py -q -p no:cacheprovider` | 47 passed | PASS |
| Cron router incl. prefix tracer | `pytest tests/test_cron_router.py -q -p no:cacheprovider` | 192 passed | PASS |
| All four files together | same four files in one run | 239 passed | PASS |
| mypy strict, CI `python` job command | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 142 source files` | PASS |
| Caps unchanged | `git show 5217975b6:analytics-service/services/exchange.py` vs HEAD | 100 / 100 both | PASS |

Step 7c (probes): no probe scripts declared by the phase; skipped.

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VREAD-06 | 232-03 | non-USDT OKX bill converted or refused by name | SATISFIED | SC-1 |
| VREAD-07 | 232-02, 232-04 | long first window completes across ticks, cap not raised | SATISFIED under the SC-2 reading above | SC-2 |
| VREAD-08 | 232-01 | cursor never ahead of stored trade; ahead key re-reads | SATISFIED for the read and the writer; the column values already ahead on PROD are repaired by the post-merge step below | SC-3 |

No orphaned requirements (REQUIREMENTS.md maps only VREAD-06..08 to Phase 232).

## Anti-Patterns Found

None blocking. No TBD/FIXME/XXX introduced by the diff that lacks a follow-up reference was observed in the changed production files' new lines.

## Routed review survivors (known limits, not gaps; none defeats an SC)

All dispositions are in `232-REVIEW.md` (round 1, fix round 1, round 2). CR-01 and CR-02/SFH-01 were fixed (`516cbf217`, `0e700425f`) with RED/cp/cmp/GREEN records. Still open, all latent:

- **CR-03 / SFH-03** (MEDIUM, data-integrity): `okx_archive_job._check_live_realized_flags` (Phase 223's file) does not name `daily_pnl_non_usd_okx`, so an archive reconciliation could take an empty live series as a quiet account. Routed to 223 by ruling Q4. If 232 merges before 223 lands the one-line fix, "refused by name" is unmet on that one reader. Exposure measured nil (all OKX bills USDT).
- **SFH-02** (MEDIUM): a first sync with a NULL cursor and NULL seed has nothing to anchor. Accepted by ruling Q1, raw ingestion is off.
- **SFH-04** (MEDIUM): `run_stitch_composite_job` never drains the DQ buffer (composite work out of scope, rule F-2). Routed.
- **R2-01** (MEDIUM, loud): a Binance symbol that fails every run (for example `BadSymbol`) holds the fills cursor indefinitely. Loud by design. Routed, needs a Binance read design.
- **R2-02** (MEDIUM, silent): a Binance linear key with a set cursor and more than 7 quiet days reads an empty window and the cursor never moves. Routed to the coordinator for a phase; must be closed before Binance raw ingestion is turned on. R2-01 and R2-02 are Binance, not OKX, and dormant while `USE_RAW_TRADE_INGESTION` is off.
- **BINANCE_PAGE_CAP** stop records no flag. Routed.
- **231 gap 3** (Phase-1 persist ordered after the Phase-2 walk) and the never-cleared public `daily_pnl_*` flags: routed to 222 ALERTTRUTH.
- **IN-01..IN-08** (LOW): recorded in REVIEW.md only, not booked.
- Follow-on from the rulings: a marker-present cron strategy whose 30-day window exceeds the OKX cron deadline re-reads the same prefix every tick. It is loud (`held` + `fetch_partial_prefix`).
- `OKX_CRON_READ_DEADLINE_S = 35.0` is an `[ASSUMED]` split, to be tuned from the first PROD `fetch_partial_prefix` ticks. The venue's `begin`/`end` page order is an `[ASSUMED]` fact (IN-01); a violation refuses by name rather than corrupting data.
- **Post-merge data step, not done and not code:** the PROD columns already ahead (2 OKX keys by up to 6 days, 1 Bybit key by 33 days) stay ahead until the one-time re-stamp proposed in `232-01-SUMMARY` (and, per IN-04, it repairs the column, not historical interior holes). The read clamp makes them harmless immediately, so SC-3 holds in code. The re-stamp is a PROD write that the coordinator decides. ⭐ **DONE 2026-11-24:** run after #1330 merged and deployed; 20 rows repaired, 0 keys ahead after. Counts are in `232-01-SUMMARY.md` under `## post-merge:`.

## Human Verification Required

None for the code. Open decision for the coordinator and founder: the SC-2 reading above. ⭐ (2026-11-24) Decided: the founder ruled SC-2 = key status only; see the dated note under SC-2. Housekeeping for ship (not verification): delete `[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]`, `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]` and `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` from `TODOS.md` in the ship PR and name them in the CHANGELOG.

## Gaps Summary

No gaps. All four success criteria are met in code and tests at `549f192d8`. SC-2 is verified under the planner's key-status reading and would become a gap only if the founder reads it as covering the `cron_runs` heartbeat row.

---

_Verified: 2026-11-24T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
