---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 07
subsystem: analytics-service
tags: [trade-read, resumable-read, defer-compute-job, claim-budget, store-fault-fallback, bybit]
status: complete

requires:
  - phase: 171-readceiling
    provides: "plan 02's _read_bybit_window, plan 03's tables, plan 04's trade_read_store"
provides:
  - "_read_bybit_trades_resumable: a Bybit read that keeps each complete 7-day grid window in the store and defers instead of refusing"
  - "_TRADE_READ_CLAIM_BUDGET_S (900 s, env TRADE_READ_CLAIM_BUDGET_S), _validated_claim_budget, _TRADE_READ_DEFER_S (120), _STORE_SETTLE_MS (1 h)"
  - "_defer_reconstruct(supabase, job, deferred, allocator_id, api_key_id, venue): the defer_compute_job call, a reclaim yields DEFERRED"
  - "the unforced handler: scope around the crawl, TradeReadDeferred arm before except Exception, purge on DONE"
  - "_read_bybit_range: the layer-1 loop extracted from _fetch_bybit_trades (also the store-fault fallback)"
affects: [171-08, 171-09, 171-10, 171-11, 171-12]

actuals:
  tokens: 10947
  tasks: 3
  commits: 3
commits: 3
plan_head_before: bb6d7f41fb86f3e88c1339a26878e15c19e59762
plan_head_after: 802cd3280ca46160fe82b8402c9d8b436c28e875

tech-stack:
  added: []
  patterns:
    - "soft claim budget checked only before a window that could be stored; the window holding now is always read live"
    - "store fault = begin_claim None = the layer-1 read for the whole range, so deploy order is not load-bearing"
    - "deferral arm placed before the generic arm (a plain Exception would otherwise fail the job)"

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_trade_read_resume.py

key-decisions:
  - "_read_bybit_window gained a keyword-only earlier_rows (default 0) instead of a second bybit_not_supported raise site: the resumable read keeps one list per window, and the AST pin in test_trade_pages.py (one literal per site) forbids a second raise"
  - "the purge on DONE runs only for a Bybit key or a rebuilt account, not for every venue, so Binance/OKX jobs make no pointless DELETEs (and log nothing in the deploy-before-migration window)"
  - "a fresh window's trades enter the output as unproject(project(t)) (one shape for stored and fresh windows); a trade that does not project is kept as the venue sent it, as layer 1 does"

requirements-completed: [SC-1, SC-2]
---

# Phase 171 Plan 07: the resumable Bybit read, its deferral and its store-fault fallback Summary

A first-connect Bybit reconstruct whose book is too big for one claim now stores each complete grid window it reads, defers through `defer_compute_job` (the job's own claim token, 120 s, a counts-only reason) when the soft 900 s budget runs out at a window boundary, and on the next claim reuses the stored windows, reads only what is left plus the window holding now, writes the history once and purges the key's rows; a missing or failing store leaves every Bybit reconstruct reading exactly as it did before the store existed.

PLAN_BASE `bb6d7f41fb86f3e88c1339a26878e15c19e59762`. `rev-list --count` over the plan: 3 (before this SUMMARY's own commit).

## What was built

- `services/equity_reconstruction.py`
  - `_fetch_bybit_trades` keeps its signature and two-year guard. With a `TradeReadScope` naming both `api_key_id` and `job_id` it returns `_read_bybit_trades_resumable`; otherwise `_read_bybit_range` (plan 02's loop, moved out unchanged).
  - `_read_bybit_trades_resumable`: `begin_claim`; `None` is `_read_bybit_range` for the whole range (no budget, no store call, no extra log line). Grid `origin + k * 7 days`, windows overlapping `[since, now]` oldest first. Stored and loadable: used. Storable (`ws >= since` and `grid end < now - 1 h`): a spent budget raises `TradeReadDeferred(windows_kept, total, trades_kept)`, else read whole, `save_window`, `record_progress` on the first save of the claim (a False save leaves the window unstored, trades stay in the output). The window holding now, the settle hour and a window starting before `since` are read live over `[max(ws, since), min(end, now)]`, never stored, never budget-checked. Completion calls `record_progress`. A stored window starting before `since` is cut to `timestamp >= since`.
  - `_validated_claim_budget(raw, hard_bound)` called at import (`ValueError` unless `0 < budget < hard bound`; text, `nan`, empty all raise).
  - Handler (unforced non-MT5 branch): `TradeReadScope(...)` built immediately before the crawl, `asyncio.wait_for` enclosed in `with store.trade_read_scope(...)`, crawl call unchanged (five positionals). `except store.TradeReadDeferred` before `except Exception` returns `_defer_reconstruct`. Purge before the final DONE return. Docstring paragraphs for the RECONMARKER side effect and the store-fault fallback.
  - `_defer_reconstruct`: `defer_compute_job` through `db_execute`; `CancelledError` re-raised; `_defer_lost_ownership` yields DEFERRED; any other RPC failure re-raised; one counts-only log line; no audit.
- `tests/test_trade_read_resume.py`: 15 tests (plan 02's three, the tracer and reclaim tests, nine pins of Task 2, one extra NotSupported pin).

## Evidence

Tracer (finite 105-grid-window book, 40 trades in each of 30 windows, one 450-trade window above a 2-page segment, a 5-trade tail; fake clock one second per venue request; claim 1 budget 45):

| Run | Venue requests |
|-----|----------------|
| single unscoped pass (oracle) | 109 |
| claim 1 (DEFERRED) | 45 |
| claim 2 (DONE) | 64 |

`p_reason` of claim 1: `trade read deferred (windows 41/105, trades 1610)`, `p_defer_seconds` 120, `p_claim_token` the job's own. After claim 1: 42 store rows (41 windows plus the state row), no snapshot, no derived row, `api_keys` row byte-equal, no failure audit. After claim 2: 730 snapshot rows equal to the oracle's (729 distinct values, so the curve is not flat), no store row left, one `defer_compute_job` call in total.

RED first: `red.log` (both tracer tests FAILED at the missing `er._TRADE_READ_CLAIM_BUDGET_S`, not ERROR). `red-task2.log` is the whole file run against the PLAN_BASE module (restored with `cp`, `cmp` 0): 9 FAILED (tracer, reclaim, never-stored, straddle, tail, both store-fault tests, budget validator, hygiene); the other 5 passed at PLAN_BASE for the reason they are pins of existing or static behaviour: plan 02's three tests, `test_the_store_names_match_the_migration` and `test_an_unscoped_read_is_layer_one_exactly`. After Task 1's code, Task 2's nine tests were GREEN at once: the implementation already carried the straddle rule and the None-state fallback; the drills below are what show them able to fail.

The store-fault WARNING the test saw (class name only): `trade read store unavailable (APIError) key=<key id>: this claim reads without the store`, exactly one. The purge on DONE then logs its own class-only WARNING (`trade read store unavailable (APIError) keys=1: rows left to expire`); the test asserts exactly one begin-claim fault line, every store WARNING naming `APIError`, and the planted signature in no record.

Gates: quick run `179 passed` (before the last two commits; the 15-test file alone is `15 passed`), full analytics suite `12995 passed, 96 skipped` (the same 96 skips as plan 04's baseline, none from this plan), CI mypy line verbatim `Success: no issues found in 124 source files`.

Drills (module backed up to `<scratchpad>/readceiling-07/er.fixed`, edited in place, test run, restored with `cp`, `cmp` exit 0 every time; never git checkout/restore/stash):

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| N the arm | delete `except store.TradeReadDeferred` | `FAILED ...::test_a_bybit_book_too_big_for_one_claim_defers_then_completes` (the generic arm FAILS the job with the store's counts text) | 0 |
| O the window holding now | drop `_STORE_SETTLE_MS` from the storable rule | `FAILED ...::test_the_window_holding_now_is_never_stored` | 0 |
| R boundary-only budget | also check the budget before a live window | `FAILED ...::test_the_tail_is_read_even_after_the_deadline` | 0 |
| W store-fault fallback | `begin_claim` None raises RuntimeError | `FAILED ...::test_a_store_fault_reads_the_book_without_the_store` | 0 |
| P (extra) straddle | storable without `ws >= since` | `FAILED ...::test_a_window_starting_before_the_read_start_is_read_but_never_stored` | 0 |
| X (extra) NotSupported carry | `earlier_rows=0` | `FAILED ...::test_not_supported_keeps_its_meaning_across_windows_and_claims` | 0 |
| Z (extra) purge | purge call replaced by `pass` | `FAILED ...::test_a_bybit_book_too_big_for_one_claim_defers_then_completes` | 0 |

## Deviations from Plan

**1. [Rule 3 - blocking] `earlier_rows` on `_read_bybit_window` instead of a second NotSupported raise**
- **Found during:** Task 1 (`test_every_truncated_read_names_a_closed_site` failed: nine sites, ten literals).
- **Issue:** the resumable read keeps one list per window, so plan 02's `if trades:` could not see rows read in earlier windows or loaded from the store; raising the truncation from the new code duplicated the `bybit_not_supported` literal that the AST pin allows once.
- **Fix:** keyword-only `earlier_rows: int = 0` on `_read_bybit_window` (`if trades or earlier_rows:`); the resumable read passes the rows read or loaded so far. One raise site, plan 02's meaning kept. Files: `equity_reconstruction.py`.

**2. [Rule 2 - judgment] Purge on DONE only for a Bybit key or a rebuilt account**
- The context block says purge before the final DONE for every venue. Binance/OKX jobs never write the store, so a purge would be two pointless DELETEs per job and a WARNING per job in the deploy-before-migration window. The forced rebuild's account keys are covered (`account is not None`).

**3. [Rule 1 - plan text] "exactly one WARNING" in the store-fault test**
- With a missing store the purge on DONE also logs its own best-effort class-only WARNING, so the test pins exactly one begin-claim fault line and that every store WARNING names the class and nothing else, instead of exactly one WARNING in total.

**4. Extra test beyond the plan**: `test_not_supported_keeps_its_meaning_across_windows_and_claims` (drill X showed nothing pinned the carry). Committed as its own `test(171-07)` commit.

**5. Scratch directory**: `/tmp/readceiling-07` is a symlink to a directory under the session scratchpad (the session rule; the plan's verify blocks hardcode the `/tmp` path). The venv is the git-ignored symlink to the main checkout's.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema: the only surface used is plan 03's two service-role tables, through plan 04's store. Threat register: T-171-21 (drill N, tracer asserts the book unchanged on a deferred claim), T-171-23 (55006 test), T-171-24 (planted-signature test across a deferred and a completed claim, store rows included), T-171-34 (two store-fault tests, drill W).

## For the orchestrator and plans 08 to 10

- Names kept as the plan fixed them: `_read_bybit_trades_resumable(exchange, since_ms, now_ms, scope, api_key_id)`, `_defer_reconstruct(supabase, job, deferred, allocator_id, api_key_id, venue)`, `_TRADE_READ_CLAIM_BUDGET_S`, `_TRADE_READ_DEFER_S`, `_STORE_SETTLE_MS`, `_validated_claim_budget`, `_read_bybit_range` (new, the layer-1 loop).
- Plan 08: the job-age check goes in `_read_bybit_trades_resumable` immediately before the `store.deadline_passed(scope)` check on a storable window (raise `store.TradeReadStalled("job_age", state.claims)` when `store.job_too_old(scope)`); the `TradeReadStalled` handler arm goes beside the `TradeReadDeferred` arm, before `except Exception`. `begin_claim` raises `stalled_claims` itself and is not inside any try in the resumable read, so it reaches the handler.
- The scope is built for every unforced non-MT5 venue but only the Bybit read consults it. The forced branch (`_crawl_whole_account`) has no scope yet; the purge already covers `account.account_key_ids`.
- Tests rely on `store._monotonic` as the clock seam and on `er._BYBIT_WINDOW_PAGE_CEILING` being lowered by monkeypatch (a read happens through module globals).
- The in-memory fake stores trade lists by reference, not through JSON; plan 04's own fake round-trips JSON. Nothing here depends on the difference.
- The unforced reconstruct that is deferred holds a zero-snapshot book's first daily refresh (`_RECONSTRUCT_IN_FLIGHT_STATUSES`), documented in the handler docstring; plan 08's 24 h backstop bounds it.

## Self-Check: PASSED

- `analytics-service/services/equity_reconstruction.py` and `analytics-service/tests/test_trade_read_resume.py`: FOUND, nothing under `analytics-service/` uncommitted.
- Commits `f1787d71b`, `1acb5ef8b`, `802cd3280`: ancestors of HEAD on `wt/171-p07`.
- `git diff --stat PLAN_BASE HEAD -- analytics-service/services/` names `equity_reconstruction.py` only. STATE.md and ROADMAP.md untouched.
