---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
reviewed: 2026-11-24T17:30:44Z
depth: deep
reviewed_at_sha: f25ae9255e216bba5f66adc1a2ad23f893cb5067
diff_base: 5217975b6
files_reviewed: 20
files_reviewed_list:
  - analytics-service/routers/cron.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/_okx_bills.py
  - analytics-service/tests/test_ana_recon_audit.py
  - analytics-service/tests/test_cron_router.py
  - analytics-service/tests/test_daily_pnl_read_verdict.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_derivegaps_probe.py
  - analytics-service/tests/test_exchange.py
  - analytics-service/tests/test_exchange_harness.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_mt5_sync_path.py
  - analytics-service/tests/test_okxtrades_ccy.py
  - analytics-service/tests/test_okxtrades_cursor.py
  - analytics-service/tests/test_okxtrades_walk.py
  - analytics-service/tests/test_sync_trades_resume_seed.py
  - analytics-service/tests/test_walletoffset_probe.py
  - docs/runbooks/okxhistory-go-live.md
findings:
  critical: 0
  warning: 3
  info: 8
  total: 11
status: issues_found
---

# Phase 232: Code Review Report

**Reviewed:** 2026-11-24T17:30:44Z
**Depth:** deep (cross-file: every `fetch_daily_pnl` / `fetch_all_trades` caller and every
reader of the new token were traced)
**Files Reviewed:** 20 (scope `git diff 5217975b6...HEAD -- analytics-service docs`)
**Status:** issues_found

## Summary

The window-major OKX walk (VREAD-07) is sound. Windows are UTC-day aligned, the cap applies per
(window, instType, endpoint), a deadline or cap stop drops the window in progress, and the
result is a contiguous oldest prefix. The 1 ms edge handling is symmetric with the neighbouring
window. `sync_trades`'s payload-span delete (migration 20260510180535) makes storing a prefix
idempotent. The cron's prefix gates (`should_advance_cursor`, `strategy_advances`,
`recompute_strategy_ids`, degraded wins) are correct and share `fetch_degraded`'s scope.
VREAD-06's census sits after the type-8 drop and the finite parse, as ruled.

The defects are at the edges of VREAD-08 and VREAD-06. Two are confirmed by an executed probe
that drives the real `run_sync_trades_job` through the phase's own harness (scratch file, not
committed):

- A fills read that is truncated while the column is NULL "holds" a NULL column. The next run
  then seeds from the daily high-water, which has already moved on, so the truncated span is
  never read again.
- A Binance partial-symbol read stamps the cursor past the failed symbols' unread fills.

The third is a reader of `fetch_daily_pnl` that does not name the new refusal. Ruling Q4 handed
it to Phase 223, but it ships unguarded if 232 merges first.

All three are latent today. `USE_RAW_TRADE_INGESTION` is off, which covers the first two, and
every measured OKX bill is USDT, which covers the third. No critical findings. Phase test files
are green at HEAD (45 passed across `test_okxtrades_{cursor,walk,ccy}.py`).

Necessity review: not assessed separately (no necessity findings). Severity mapping for the
caller's MEDIUM+ bar: the three Warnings are MEDIUM, and every Info is LOW.

## Narrative Findings (AI reviewer)

## Warnings

### CR-01: A truncated fills read at bootstrap holds a NULL cursor, and the next run skips the truncated span (MEDIUM, data-integrity, latent)

**File:** `analytics-service/services/job_worker.py:run_sync_trades_job` (epilogue
`advance_fetched_cursor` / `elif phase2_failed and fills_anchor_iso is not None`; seed branch
`if _fills_cursor_ms is None: fills_since_ms = daily_since_ms`)

**Issue:** Ruling Q7 holds the cursor when any `sync_truncated_*` flag is true. When the column
is NULL, though, holding it changes nothing. The bootstrap anchor fires only on `phase2_failed`.
The OKX fills read (`_fetch_raw_trades_okx`) does not raise on a cap: it returns fills and sets
`sync_truncated_okx`, so `phase2_failed` stays False and nothing is anchored. Sequence:

1. Run 1: the column is NULL and the daily high-water is D0. The fills read from D0 hits the
   page cap and the oldest fills are dropped, because OKX pages newest-first. The fills it did
   return persist, and Phase 1 stores daily rows through today.
2. Run 2: the column is still NULL, so `fills_since_ms = daily_since_ms`, which is now today's
   high-water. The NULL branch never consults the stored-fill high-water. The span the cap
   dropped, starting at D0, is never re-read, and the 232 cursor tests cannot see it.

Probe result (real job, phase harness): run 1 `since=1778112000000` with stamp `None`, then run 2
`since=1779235200000` (= `DAILY_LATER_DAY_START_MS`). `test_a_truncated_fills_read_holds_the_cursor`
asserts the hold with `column=None`, which is exactly the case where the hold protects nothing.
This misses SC-3 ("the cursor never advances past stored data"), because the effective seed
advances past the unread span.

**Fix (minimal):** anchor a held bootstrap read that left an unstored span, truncation
included:
```python
_fills_truncated = any(
    k.startswith("sync_truncated_") and v for k, v in exchange_dq_flags.items()
)
advance_fetched_cursor = (
    bool(raw_fills) and phase2_complete and not phase2_failed
    and not phase1_failed and not _fills_truncated
)
...
elif (phase2_failed or _fills_truncated) and fills_anchor_iso is not None:
    _p_last_fetched = fills_anchor_iso
```
Add a refuse-then-clean arm for the truncated bootstrap that mirrors
`test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears`.

### CR-02: A Binance partial-symbol read stamps the cursor past the failed symbols' unread fills (MEDIUM, data-integrity, latent)

**File:** `analytics-service/services/job_worker.py:run_sync_trades_job` (gate
`advance_fetched_cursor`); producer `services/exchange.py` Binance per-symbol gather
(`_record_dq_flag("binance_partial_symbols", ...)`)

**Issue:** When some symbols fail and at least one succeeds, the Binance fills read returns the
successful symbols' fills and records `binance_partial_symbols`, without raising. The gate checks
only `sync_truncated_*`, so the cursor is stamped at the newest fill of the symbols that
succeeded. On the next run the seed is `min(cursor, newest stored fill)`, which is that same
instant. Every fill of the failed symbols between the old cursor and the new stamp is never
fetched. The cursor sits ahead of those symbols' stored trades, which is the defect VREAD-08
exists to remove. Probe: `fills_flags={"binance_partial_symbols": ["ETHUSDT"]}` with fills in
hand gave `p_last_fetched_ts == "2026-06-05T00:00:00+00:00"` (stamped). Related and
pre-existing: the per-symbol `BINANCE_PAGE_CAP` stop (`for _page in range(BINANCE_PAGE_CAP)
... else: logger.warning`) records no flag. Binance pages oldest-first, so a capped symbol loses
its newest fills, and the max over the other symbols stamps past them silently.

**Fix (minimal):** hold on the partial-symbol flag the same way as on truncation:
```python
_fills_incomplete = any(
    (k.startswith("sync_truncated_") or k == "binance_partial_symbols") and v
    for k, v in exchange_dq_flags.items()
)
```
Use `_fills_incomplete` in place of the truncation conjunct (and in CR-01's anchor branch).
Booking a flag for the Binance per-symbol cap is a separate one-line producer fix. It sits
outside this phase's write scope, so route it if it is not taken here.

### CR-03: `daily_pnl_non_usd_okx` returns `[]` to readers that do not name it, so an empty realized series reaches the OKX archive reconciliation silently (MEDIUM, data-integrity, latent; ruled Q4 hand-off)

**File:** `analytics-service/services/okx_archive_job.py:_check_live_realized_flags` (a Phase 223
file, not edited by ruling Q4); also `services/job_worker.py:_reconstruct_ccxt_member` region
(`realized = await fetch_all_trades(ctx.exchange, since_ms=None)`, no DQ drain)

**Issue:** VREAD-06 makes `fetch_daily_pnl` return `[]` and stamp `daily_pnl_non_usd_okx`.
`_check_live_realized_flags` names only `daily_pnl_fetch_error` and `daily_pnl_truncated_okx`, so
a non-USD refusal passes as a quiet account. `_live_reference` then builds `realized_by_day={}`
and the full-history verdict from an empty series, and hands both to the reconciliation. Its own
docstring forbids this: "an empty series must not reach the reconciliation". Before 232 the same
key produced a face-value sum, which was wrong but not empty. After 232 the rebuild compares
archive days against zero live realized P&L. The stitched-composite ccxt member also never
drains the buffer. It degrades only when funding is present (`if not realized and funding`). A
member with no funding rows gets an empty realized stream, which combine treats as a flat
account. Ruling Q4 deliberately handed the archive-job line to 223. This finding records that
merging 232 before 223 lands that line leaves "refused by name" unmet on this reader.

**Fix (minimal):** in `_check_live_realized_flags`, after the truncation line:
```python
if flags.get("daily_pnl_non_usd_okx"):
    raise _Stop("live_anchor_unusable", "live_realized=non_usd")
```
Either land it in 223 before 232 merges, or take the one line here with the coordinator's
agreement. For the composite member, drain the buffer after the `fetch_all_trades` call and
degrade on any `daily_pnl_read_verdict(...).reasons` (`_CcxtMemberDegrade("realized_stream_unavailable")`),
or route that by name to 222 or 223.

## Info (LOW, not fixed; recorded here only, per the TODOS rule)

### IN-01: The billId-descending self-check rests on an unmeasured venue assumption
`services/exchange.py:_okx_bills_window_read`. If OKX ever served a `begin`/`end`-bounded page
in an order other than billId-descending, every OKX read would refuse by name with
`OkxBillsWindowIncomplete`, loudly, as `error` on every key. The risk is low: the venue's own
`after` contract ("earlier than the requested billId") already implies billId order. RESEARCH
marks it `[ASSUMED]`. A read-only probe on one PROD key after deploy would settle it.

### IN-02: The 35 s OKX cron deadline does not bound the in-flight request
`routers/cron.py:OKX_CRON_READ_DEADLINE_S`. The deadline is checked before each request. A
request started at about 34.9 s still runs to its ccxt timeout and up to about 5 s of 429
backoff, and then come the balance read and the per-strategy RPCs. The 60 s `KEY_SYNC_TIMEOUT`
cancel that stores nothing is still reachable on a slow venue. The split is already recorded as
`[ASSUMED]`, to be tuned from PROD `fetch_partial_prefix` ticks.

### IN-03: An empty prefix, or a present marker, re-reads the same span every tick
`routers/cron.py:_sync_single_key`. A run of empty windows longer than one tick's deadline does
not move the stored high-water, and a present marker is held at its pre-tick value. Both are
loud (`held` + `fetch_partial_prefix`) and recorded as follow-ons. Completion then depends on a
queued `sync_trades` run.

### IN-04: The high-water clamp re-reads only a tail gap, never an interior one
`services/trade_resume.py:load_strategy_fill_high_water`. A span skipped by an old wall-clock
stamp and later buried under newer stored fills cannot be seen through `min(cursor, newest fill)`.
The post-merge PROD re-stamp step booked in 232-01-SUMMARY should say that it repairs the column,
not those historical holes.

### IN-05: A quiet key's fills window grows every run
`run_sync_trades_job`. Accepted by decision and recorded in 232-01-SUMMARY (Bybit refuses past
730 days).

### IN-06: Bills with no `billId` are not deduplicated across a straddling window's two endpoints
`services/exchange.py:fetch_daily_pnl` (the `seen_ids` dedup). A row without a `billId` read from
both `/bills` and `/bills-archive` would be counted twice. Real OKX bills always carry a
`billId`, so this is an edge only.

### IN-07: A missing `billId` on the last row of a full page resets pagination
`_okx_bills_window_read`. `after_id` becomes `""`, so the next request carries no `after` and
re-serves the newest page until the cap, which then refuses by name as
`daily_pnl_truncated_okx`. It is loud but misnamed. Raising `order_drift` there would be more
accurate.

### IN-08: Several `fetch_all_trades` callers never drain the DQ buffer
`routers/exchange.py` (POST `/fetch-trades`) and `routers/portfolio.py` (verify) store or use
whatever comes back. They are pre-existing members of the silent-reader class, and a non-USD
refusal or a capped prefix now reaches them unnamed as well. Cron, queued job and derive are
fine.

---

_Reviewed: 2026-11-24T17:30:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure-hunter round 1 (merged by the phase agent)

- SFH-01 MEDIUM data-integrity: same defect as CR-02 (`binance_partial_symbols` does not hold the fills cursor). Fixed with CR-02.
- SFH-02 MEDIUM data-integrity: no anchor when the cursor and the seed are both NULL and Phase 2 raised. NOT fixed. Orchestrator ruling Q1 in 232-CONTEXT.md accepts and documents this case ("A first sync whose seed is NULL (full reach) has nothing to anchor"). Reported to the coordinator.
- SFH-03 MEDIUM data-integrity: same as CR-03 (`okx_archive_job._check_live_realized_flags` ignores `daily_pnl_non_usd_okx`). Phase 223's file. Ruling Q4 routes the one-line fix to the coordinator for 223. Not edited here.
- SFH-04 MEDIUM data-integrity (low probability): `run_stitch_composite_job` never drains the DQ buffer, so after a page-cap breach the composite NAV roll silently misses the newest days. NOT fixed here: composite work is out of scope by founder rule F-2. Reported to the coordinator.

## Round 1 disposition

Fixer round 1 (topic: fills cursor in `run_sync_trades_job`): CR-01, CR-02 (= SFH-01).
Routed or recorded: CR-03 / SFH-03 (223, Q4), SFH-02 (Q1 accepted), SFH-04 (F-2).

## Fix round 1

Commits: `0e700425f` (CR-02 / SFH-01), `516cbf217` (CR-01). Both in
`analytics-service/services/job_worker.py::run_sync_trades_job`, tests in
`analytics-service/tests/test_okxtrades_cursor.py`.

- CR-02: the stamp gate also holds on `binance_partial_symbols` (`_fills_incomplete`).
- CR-01: the bootstrap anchor fires on `phase2_failed or _fills_incomplete`, so a truncated or
  partial-symbol read on a NULL column anchors at its read start.
- The existing `test_a_truncated_fills_read_holds_the_cursor` used `column=None`, where a hold
  protects nothing and the anchor now writes. It now uses a set column; the NULL-column case is
  the new CR-01 arm.
- NOT fixed: the per-symbol `BINANCE_PAGE_CAP` stop still records no flag. A flag there is a
  producer edit in `services/exchange.py` (outside the named scope, needs its own exchange-level
  test), and read by the hold it would stall the cursor on a symbol that is capped on every run,
  because the held seed re-reads the same oldest 20K fills. That needs a resume-past-cap design,
  not a one-line flag. Left for routing.

PROOF-01 (job_worker.py byte backup in the scratchpad, neuter, RED, restore with `cp`, `cmp`
clean, GREEN):

CR-02 neuter (drop `or key == "binance_partial_symbols"`) RED:
```
E       AssertionError: a partial-symbol fills read must hold the fills cursor (CR-02)
E       assert '2026-06-01T09:00:00+00:00' is None
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_partial_symbols_then_clean_rereads_the_failed_symbols_span
1 failed, 18 deselected in 37.70s
```
Restored, GREEN: `1 passed, 18 deselected in 31.96s`

CR-01 neuter (anchor back to `elif phase2_failed and fills_anchor_iso`) RED:
```
E       AssertionError: a truncated bootstrap read must anchor the NULL column at its read start (CR-01), never at the newest fill it returned
E       assert None == '2026-05-07T00:00:00+00:00'
1 failed, 19 deselected in 15.15s
```
Restored, GREEN: `1 passed, 19 deselected in 10.59s`

Gates at `516cbf217`, from `analytics-service/` with `.venv`: the six-file phase set
`370 passed, 1 skipped`; the full suite `16128 passed, 93 skipped` (0 failures, so no failure
is new against base 5217975b6); `mypy --strict --follow-imports=silent
--config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py
main_worker_healthz.py sentry_init.py`: `Success: no issues found in 142 source files`.

## Round 2 re-review (gsd-code-reviewer, over `33677d8a9..HEAD`)

CR-01 is closed for a bootstrap that has a seed. CR-02 is closed for transient failures. The widened anchor never writes past where the read began: `fills_anchor_iso` is `daily_since_ms`, and `advance_sync_cursor` only moves the column forward. Both new tests go RED with the fix removed (through their run-1 assertions; run 2's seed is fixed by the test's `column=` argument, LOW).

- R2-01 MEDIUM data-integrity, latent (raw ingestion is off, ruling Q1). A Binance symbol that raises `ccxt.BadSymbol` on every run (delisted or unmapped) sets `binance_partial_symbols` every run, so the CR-02 hold keeps the fills cursor at C indefinitely. ccxt caps a linear-market `endTime` at `since + 7d`, so healthy symbols stop ingesting anything newer than C+7d. The stall is LOUD: the flag naming the dead symbol is stamped every run. Before the fix the healthy symbols kept advancing and the failed symbol's span was skipped SILENTLY. Disposition: kept. Under the repo's fail-loud rule a loud stall is preferred to a silent skip. A resume that is not blocked by a venue-unlisted symbol needs a Binance read design (with the BINANCE_PAGE_CAP resume), so it is routed to the coordinator. There is no minimal fix inside `job_worker.py`.
- R2-02 MEDIUM data-integrity, latent (raw ingestion off), round-0 code. A Binance linear key with a set cursor and more than 7 quiet days reads an empty [C, C+7d] window. `bool(raw_fills)` then never stamps, so the cursor never moves again. That stall is SILENT. Phase 232 removed the wall-clock advance on an empty read, and that advance was the source of the cursor running ahead (VREAD-08). The real fix is a window-walking Binance fills read in `exchange.py`, outside this OKX phase's scope. Routed to the coordinator for a phase. It must be closed before raw fills ingestion is turned on for Binance.

Round 2 disposition: no further fixer round. Both survivors need a design, not a minimal fix, and both are dormant while raw ingestion is off. Routed, with CR-03/SFH-03 (223, Q4), SFH-02 (Q1 accepted), SFH-04 (F-2) and BINANCE_PAGE_CAP.

## Routing note (2026-11-24, founder ruling)

R2-01, R2-02 and the `BINANCE_PAGE_CAP` no-flag stop are routed to **Phase 250 BINANCEFILLS** (v1.22), booked with `/gsd-phase` (plain add). Founder ruling 2026-11-24: "R2-02: book a follow-up phase with /gsd-phase (plain add) for a windowed Binance fills read. It must land before USE_RAW_TRADE_INGESTION is turned on for Binance. Fold R2-01 and the BINANCE_PAGE_CAP no-flag item into the same phase's scope." Phase 250's success criteria cover all three and make the `USE_RAW_TRADE_INGESTION` switch for Binance conditional on them.

## Post-review note (ship)

CR-03 / SFH-03 is closed on main: Phase 223 (#1327) landed the `daily_pnl_non_usd_okx` stop in `okx_archive_job._check_live_realized_flags`. Found when the ship branch was rebased.
