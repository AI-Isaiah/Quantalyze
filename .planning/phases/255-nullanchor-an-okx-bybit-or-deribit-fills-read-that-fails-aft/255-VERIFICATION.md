---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
verified: 2026-11-27T13:00:00Z
status: passed
score: 3/3 verifiable must-haves verified (SC-1, SC-2, SC-4); SC-3 pending-at-ship by design
verified_at_sha: 79ad0aed2b648f67c2620d32e0af24182d4c6b96
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_okxtrades_cursor.py
behavior_unverified: 0
overrides_applied: 0
re_verification: no
gaps: []
---

# Phase 255: NULLANCHOR Verification Report

**Phase Goal:** A fills read on OKX, Bybit or Deribit that raises, is rate limited (429) or is cancelled after Phase 251's daily `sync_trades` store never leaves a span that the next run's seed skips, on a NULL `last_fetched_trade_timestamp` column and on a set column with no stored fill alike.
**Verified:** 2026-11-27, at `79ad0aed2` (the only commit after `9077ed53b` is `255-SECURITY.md`, so the analytics-service source is the same as the round-3 review's)
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | For each of OKX, Bybit, Deribit, on a NULL column and a set column with no stored fill, with a 429, a cancel and a plain raise after run 1 stored a daily row, run 2's walk start is at or before run 1's seed. Each arm RED on `origin/main`. | VERIFIED (4 of 30 arms were GREEN pre-fix, kept as pins; recorded deviation) | Independent pre-fix replay: I copied `analytics-service/` to scratch, swapped in the `45d7b4e5c` versions of `services/exchange.py`, `job_worker.py`, `trade_resume.py`, and ran `tests/test_nullanchor_bound.py::TestNullAnchorMatrix`. Result: exactly 26 FAILED, every one on `AssertionError: NULLANCHOR-WALK-START` (26 matches, so none failed for a premise or harness reason), 4 passed (okx/bybit/deribit-null-plain, okx-null-trunc). Same arms GREEN at HEAD. The mechanism is in code: `_bound_read = _reach_anchor_ms is not None` (job_worker.py ~2437) gates the seed's third term, the provisional `_set_bound(...)` written BEFORE the Phase-1 daily store, and the epilogue write for OKX, Bybit and Deribit. A 429 or cancel skips the epilogue, so the provisional row (at the seed, or the per-venue reach anchor on a first sync) is what run 2's seed lowers to. A plain raise sets `phase2_failed`, so `_earliest_through()` keeps the bound. Bound-RPC failure holds the read and the daily store (fail closed); an orphan answer skips both. |
| SC-2 | Binance's Phase 253 behaviour and `advance_sync_cursor`'s callers do not regress, and a test pins that. | VERIFIED | `_binance_read` is still set only on Binance and still gates every Binance-only predicate (`binance_read_through_ms`, partial symbols, `binance_stop_below_cursor`, flag clear); the Binance branch of `_earliest_through()` is the old code moved under `if _binance_read:`. The Binance deadline stays the fixed 840 s (`_fills_read_deadline_s` is only reduced for Bybit). `TestAdvanceSyncCursorUnchanged` (28 arms, goldens hand-typed from the HEAD measurement) pins the six `advance_sync_cursor` keys and `p_last_fetched_ts` per venue and scenario, and pins that no `binance_*` key appears off Binance. The edits to existing suites are limited to the documented intent change (OKX now makes one bound read and two writes) plus three test fakes that answer the bound RPC True. The Binance arms in `test_binancefills_cursor.py` are untouched. No `supabase/` diff, so no RPC or migration change. |
| SC-3 | `TODOS.md` entry `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` deleted in the ship PR and named in its CHANGELOG entry. | PENDING AT SHIP (not a gap) | Deliberately done at the ship step. `grep -a -c '253-NULL-COLUMN-ANCHOR-ALL-VENUES' TODOS.md` is 1 now, as expected. The hand-over exists in `255-03-SUMMARY.md` ("Ship hand-over (SC-3)", items 1 to 5) with its gate command. See the stale-item note under "Routed to ship". |
| SC-4 | PROOF-01: each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp`, `cmp`), GREEN, recorded verbatim in the plan SUMMARY. | VERIFIED | `255-01-SUMMARY.md` records the unmarked HEAD run (`26 failed, 4 passed`) and the list of FAILED ids. `255-03-SUMMARY.md` records ten neuters N1 to N10 with the neuter diff, the named FAILED node ids, `RED_OK`, `restore cmp exit=0` and `GREEN_OK` per neuter (21 `RED_OK`, 10 `GREEN_OK`). `255-REVIEW-FIX.md` records the same cycle for each review fix. My own pre-fix replay (SC-1 row) independently reproduced the 26 RED arms. I did not repeat the ten neuters. |

**Score:** 3/3 verifiable truths verified; SC-3 is a ship-time deliverable.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/job_worker.py` | `_bound_read` gating, per-venue reach anchors, off-Binance keep predicate, Bybit remaining-budget deadline | VERIFIED | Present, substantive, wired into `run_sync_trades_job`; read in full around the seed, provisional write, `_earliest_through`, and epilogue write. |
| `analytics-service/services/exchange.py` | OKX 93-day anchor, OKX begin floor and `okx_fills_reach_clamped`, OKX pager `billId` cursor, OKX stuck full page is incomplete, Bybit `read_deadline_s` | VERIFIED | All present; `fetch_raw_trades` passes `read_deadline_s` to Bybit only. |
| `analytics-service/services/trade_resume.py` | Venue-neutral bound reader | VERIFIED | Docstring-only change; the reader was already venue-agnostic. |
| `analytics-service/tests/test_nullanchor_bound.py` | SC-1 matrix, SC-2 pin, off-Binance bound arms, review-fix arms, NEUTER block | VERIFIED | 92 arms collected at HEAD; the 8-file run below passes. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| seed in `run_sync_trades_job` | `load_strategy_fills_reread_bound` | `if _bound_read:` third term | WIRED | Lowers `fills_since_ms` to the stored bound; NULL-column anchor follows. |
| provisional bound | Phase-1 daily store | `_set_bound(_provisional_unread_ms, None)` precedes the store; failure sets `phase1_read_refused` | WIRED | A cancel or 429 after the store leaves the row. |
| epilogue | `set_strategy_fills_reread_bound` | `_unread_from_ms = _earliest_through()` then `_set_bound(..., _covers_from_iso)` | WIRED | Keep predicate: `phase2_failed` or any truthy `sync_truncated_*` off Binance. |
| `fetch_raw_trades` | Bybit walk | `read_deadline_s=_fills_read_deadline_s` | WIRED | Handler budget remaining, floored at 1 s. |
| Deribit | bound | reach anchor 0; `fetch_deribit_fills(exchange, since_ms)` ignores the seed | WIRED | Confirmed `_fetch_raw_trades_deribit` is a thin delegate with no windowing; the bound is inert in effect, as documented. |

### Data-Flow Trace (Level 4)

Not applicable to UI. The data path (seed -> bound row -> next run's seed) is exercised end to end by the two-run matrix through the real `run_sync_trades_job` with a stateful `RereadBounds` store, not by a stub that returns a fixed value.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test set at HEAD | `cd analytics-service && python3 -m pytest tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_exchange.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py tests/test_sync_trades_store_truth.py tests/test_ana_recon_audit.py -q` | `608 passed, 1 skipped, 14 warnings in 35.73s` | PASS |
| CI mypy strict | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 146 source files` (local mypy 2.0.0; CI pins 2.4.0) | PASS |
| SC-1 arms on pre-fix services | `pytest tests/test_nullanchor_bound.py -k TestNullAnchorMatrix` in a scratch copy with the `45d7b4e5c` `exchange.py`, `job_worker.py`, `trade_resume.py` | 26 FAILED, all `NULLANCHOR-WALK-START`; 4 passed | PASS (RED as claimed) |
| Whole module on pre-fix services | same, whole module | 56 failed, 36 passed; the 26 walk-start failures plus the off-Binance bound arms and the review-fix arms | PASS |

### Probe Execution

No probe scripts are declared by the phase. Skipped.

### Requirements Coverage

The ROADMAP entry says `Requirements: TBD`; the phase is tracked by SC-1 to SC-4 above. No orphaned requirement IDs.

### Anti-Patterns Found

None blocking. Debt-marker grep (`TBD|FIXME|XXX`) is not relevant to the added lines; the SC-3 "TBD" in ROADMAP is a ledger placeholder owned by the ship step. The scratch copy used for the pre-fix replay was outside the repo; the worktree is clean.

### Human Verification Required

None required for the goal. The two live-venue unknowns below are recorded as routed survivors, not as verification items, because no success criterion depends on them: SC-1 is defined on the walk start the seed produces, and that is behaviorally proven.

## Routed to ship (noted, not phase-goal gaps)

These do not defeat SC-1 or SC-2. They are carried for the ship step and the founder.

1. **R3-WR-01 (MEDIUM, unverified venue behaviour): OKX begin floor unmeasured.** `_okx_fills_begin_floor_ms` sends a `begin` 91 days back on 214 dates a year. If OKX reads "last 3 months" as 90 days and answers an older `begin` with an empty list, a retried read could look complete and clear the bound. The pre-phase code sent an even older `begin` (the unclamped seed), so this phase narrows the exposure, it does not introduce it. A read-only live probe (`begin` = now minus 94, 91, 89 days, and none) settles it. This is the one item where a live check would change a conclusion.
2. **R3-WR-02 (MEDIUM): the clamp leaves no lasting trace.** `okx_fills_reach_clamped` is wiped by the chained derive's prestamp, and the clamp branch logs nothing. Visibility of an accepted loss, not a skipped span.
3. **`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` now reaches OKX, Bybit and Deribit keys.** Scope rewrite and founder decision item are in the hand-over (items 2 and 3).
4. **R2-CR-01 backfill (founder decision, time-sensitive).** The OKX pager sent `tradeId` as `after` before this phase; the fix is in (`billId`), but strategies already synced under the old cursor have a cursor past unread fills. Fills older than the endpoint's 3-month reach become unrecoverable each day.
5. **Hand-over item 4 in `255-03-SUMMARY.md` is stale.** It says to book a residual for the OKX stuck-cursor silent stop. Review fix `e7aaa4280` (SFH-M1) closed it in code (the stop on a full page now sets `natural_break = False`, records `sync_truncated_okx`, keeps the bound); the ship step should not book it.
6. **Recorded deviation from SC-1's wording.** Four arms (`okx/bybit/deribit-null-plain`, `okx-null-trunc`) were GREEN on unmodified code because the Phase 232 bootstrap anchor already covers a plain raise on a NULL column. Kept as regression pins; the CHANGELOG hand-over names this.
7. Other carried items (R2-WR-02 (a) Bybit no-progress re-read and bound creep; Bybit 365-day first-sync sliver; stale bound-table catalog COMMENTs) are in the hand-over and the review files.

## Gaps Summary

No gaps. Every verifiable success criterion holds at the code level: the SC-1 arms were reproduced RED on pre-fix services in an independent replay and are GREEN at HEAD, SC-2 is pinned and the Binance suites pass unchanged, SC-4 evidence is verbatim in the plan SUMMARYs, and CI's mypy strict is clean. SC-3 is a ship-step deliverable with its hand-over in place.

---

_Verified: 2026-11-27T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
