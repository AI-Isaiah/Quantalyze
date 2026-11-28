---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
reviewed: 2026-11-28T11:31:59Z
round: 2
reviewed_at_sha: 717bcace3ea25e266ede82b36f8623d622e7eb87
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_seedhold_bound.py
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
  necessity: 0
status: issues_found
---

# Phase 257: Code Review Report, round 2 (fix round)

**Reviewed:** 2026-11-28T11:31:59Z
**Depth:** deep (fix hunks of `cf5da34d7` WR-01 and `614276e13` WR-02, traced into their callers and into the venue readers)
**Files Reviewed:** 3
**Status:** issues_found

**Severity mapping (as in round 1):** Critical (`CR-`) = HIGH or CRITICAL. Warning (`WR-`) = MEDIUM. Info (`IN-`) = LOW or INFO,
recorded here and nowhere else.

## Summary

**Both round-1 findings are closed as written.**

- **WR-01.** On a failed or malformed hold read, the seed now drops to the reach anchor
  (`job_worker.py:2576-2581`), and so does the provisional bound row. The except-arm mark carries
  `_provisional_unread_ms`, which is the same value as before or lower (`:2678`).
- **WR-02.** `load_strategy_seed_hold` orders by `claimed_at` (`trade_resume.py:235`), and the fake
  models it (`test_seedhold_bound.py:250`, `:273`).

**Gates, re-run at `717bcace3`:**
- Every test file that touches the bound or the hold, plus `test_job_worker.py`, gave
  `455 passed, 1 skipped, 2 xfailed`. The files are `test_seedhold_bound`, `test_nullanchor_bound`,
  `test_binancefills_cursor`, `test_okxtrades_cursor`, `test_sync_trades_store_truth`,
  `test_sync_trades_resume_seed` and `test_ana_recon_audit`. The 2 xfailed are the
  `RESIDUAL_DOUBLE_FAULT` arms.
- `mypy --strict` on both fixed files reports `Success`.

**Round-1 probe, reported as it ran.** `test_review257_probe.py` gave **3 passed, 2 failed**:
- **E:** 2/2 pass. Run 2 walks from `1778108400000`, which equals A's walk start.
- **D:** 1/3 pass. bybit-set passes. okx-set and okx-first fail.

The two OKX failures come from the probe, not the code. The probe imports the phase's helpers but not
its autouse `_pinned_clock` fixture (`test_seedhold_bound.py:179-181`), so `_now_ms` was the wall
clock. Wall-clock now minus 93 days (about 2026-08-27) is LATER than the fixture's seed
(2026-07-14), so `min()` cannot lower anything. The span the probe calls "skipped" is older than
OKX's reach at wall-clock time, so the venue could not serve it anyway. That is the IN-06 class and
is carried below as IN-R2-04.

Re-run under the pinned clock, `test_review257_r2_probe.py::test_probe_D2` gives **5/5**
(okx-set, bybit-set, okx-first, bybit-first, binance-set). In every case the intervening run itself
walks from its reach anchor minus the overlap: okx `1776078000000`, bybit `1752577200000`, binance
`1776769200000`. Each of those is at or before run 1's walk start.

**`claimed_at` ordering cannot pick the wrong row through any write path in the repo:**
- Every running-setter stamps `claimed_at = now()`. There are three, at `baseline.sql:2298`, `:2493`
  and `:2712`, the last being `claim_compute_jobs_with_priority.sql:177-178`.
- `mark_compute_job_done` flips only `running` rows with a matching non-NULL token.
- Every path that NULLs `claimed_at` also NULLs the token and sets `pending`: `defer_compute_job`,
  the two watchdogs, and `set_departed_key_history_inclusion`.
- Sync rows of one strategy never overlap. Per batch, `rn_s = 1` and the `running` /
  `done_pending_children` exclusion apply. The CLAIMPAIR pre-rank exclusion keeps a `failed_retry`
  row from running while a pending twin exists.
- So among `done` rows, a later `claimed_at` means a later run, and no producer leaves `claimed_at`
  NULL on a `done` row.

One latent edge remains: the default DESC order puts NULLs first (IN-R2-02).

**Arm D's looser assertion is honest.** It was RED on the pre-fix source (fix report: 4 D arms RED,
the narrower `if False and …` neuter RED too). It encodes the invariant: a complete read by SOME run
covers the span. Its setup has no failing read in the intervening run, so `min()` cannot be satisfied
by a run whose read lost data. D2 shows that the stricter form also holds on all five shapes, so it
could be tightened (IN-R2-01).

**One new MEDIUM, WR-R2-01, and it comes from the fix round 1 prescribed.** The reach floor turns ONE
transient `compute_jobs` read error on a healthy set-column strategy into a full-reach re-read. Where
a reach read cannot complete, the strategy never comes back:
- **Bybit:** a window above the 200-page cap. Every later run raises, persists zero fills, and the
  bound creeps back 1 h per run.
- **OKX:** the page cap. A permanent truncation loop, though the newest fills still land.

Before the fix, a healthy set-column strategy could reach that state only through a double fault or
a first sync. The density premise is UNMEASURED. Measured or exact today: PROD has
`USE_RAW_TRADE_INGESTION` on, with 1 Bybit and 5 OKX keys (`TODOS.md:261`, 2026-11-26 MCP read). The
one measured Bybit key peaked at 121 pages in one window, and that figure is a lower bound
(`exchange.py:256`). The cap is 200 (`exchange.py:259`).

**Binance and Phase 255:** no regression found.
- Binance clamps a seed older than its reach and keeps walking (`exchange.py:2982-2995`), and its
  deadline and page-cap stops carry a read-through bound, so it converges.
- Phase 255's own suite is green.
- A Bybit reach seed (365 days, minus the 1 h overlap) stays inside the 730-day `start_too_old`
  guard (`exchange.py:3556`).

`necessity-review.md` was not re-read for this round. No finding here is a necessity finding.

## Narrative Findings (AI reviewer)

## Warnings

### WR-R2-01: The WR-01 reach floor turns one transient hold-read error into a full-reach re-read that never converges on a venue whose reach read cannot complete

**File:** `analytics-service/services/job_worker.py:2556-2584` (the floor at `:2576-2581`); the non-converging arm at `:3006-3010` (`_earliest_through()`), `services/exchange.py:3775` (Bybit `page_cap` raise, no completed fills carried) and `services/exchange.py:3502-3504` with `:3281-3300` (OKX page cap, newest first)

**Issue:** `_hold_read_failed` is true on any `load_strategy_seed_hold` exception. One PostgREST blip on
that one select now lowers a healthy set-column seed to the reach anchor, and so lowers the
provisional bound row (`_provisional_unread_ms`, `:2631-2633`). The walk then starts at or before the
reach, so `_covers_from_iso` is `-infinity` (`:2968-2972`). Two outcomes follow:

- **Read completes** (Binance; Bybit by deadline stops; any account light enough): the bound clears
  or advances, so the cost is one or a few runs of over-fetch. Deadline stops keep
  `phase2_fill_ingestion_failed` stamped while they last.
- **Read cannot complete:** `_earliest_through()` returns `walk_start - 1` (`:3006-3010`). RPC R4 then
  moves the bound to that point, one overlap plus 1 ms OLDER. The next run seeds from it, walks the
  same unreadable range, and moves the bound back again. The run on which the blip happened is
  never undone. This affects two venues:
  - **Bybit**, when any 7-day window in the last 365 days holds more than 20,000 executions: the
    walk is oldest first and raises `page_cap` with no fills attached. Every later run persists
    **zero** fills and keeps `phase2_fill_ingestion_failed`. The creeping bound eventually crosses
    the 730-day guard and raises `start_too_old` instead. Fills stop flowing for that strategy.
  - **OKX**, when an instType holds more than 10,000 fills in about 3 months: the pager is newest
    first, so the newest fills still land. But every run makes about 400 requests, flags
    `sync_truncated_okx` and holds the fetched cursor, with no end.

Before `cf5da34d7`, a healthy set-column strategy got to the reach only through a first sync, or
through the double fault of the RPC down plus a failed hold read. The fix made it a single fault.
This is the fix round 1 prescribed (round-1 WR-01 **Fix**). Round 1 rated the "permanent stall, no
data loss" of IN-04 as Info. This finding differs in its trigger and its victim: a transient blip
takes a strategy that is healthy today, and on Bybit the loss is fill ingestion itself.

**Measured** with the real worker under the pinned clock (`test_review257_r2_probe.py`). The page cap
and truncation are INJECTED for every run whose walk reaches the modelled dense range. That is a
modelling choice, stated as such, not an observed venue answer.

```
PROBE-G-control (okx, no blip, 4 runs):    since 1778112000000 every run, bounds {}
PROBE-G okx  blip  since 1776081600000 (= reach)   bound 2026-04-13T10:59:59.999
             n0    since 1776077999999             bound 2026-04-13T09:59:59.998
             n1    since 1776074399998             bound 2026-04-13T08:59:59.997
             n2    since 1776070799997             bound 2026-04-13T07:59:59.996
PROBE-G-bybit blip=False (5 runs): since 1778112000000, bounds {}
PROBE-G-bybit blip=True  y0 since 1752580800000 raised page_cap, batches 0, bound 2025-07-15T10:59:59.999
                         y1..y4 since -1 h each run, raised, batches 0, bound -1 h each run
```

**Severity:** MEDIUM, and **unmeasured** in two places:
- whether any PROD Bybit or OKX key has such a window in its reach;
- how often the single select fails.

If the Bybit premise holds, fill ingestion stops for the strategy. That is the data-integrity class
this repo's rule routes to a fixer round. The OKX arm alone is ops cost and noise, which the rule
books.

**Fix (requirements; the snippet is a sketch):**

The fix must satisfy three constraints together:
- A run that could not read the hold must never reach a clean bound clear AND end `done` without the
  mark.
- A transient read error must not cost a full-reach re-read.
- A persistent malformed mark must not wedge the strategy. Refusing forever leaves no newer `done`
  row to supersede it.

The design that meets all three: tell a read ERROR apart from a malformed mark.
- **Read error.** Return `DispatchResult(outcome=DispatchOutcome.FAILED, error_kind="transient", ...)`
  before the provisional bound write and the Phase-1 daily store. The dispatch path is
  `main_worker.py:1394-1405` → `mark_compute_job_failed`. Nothing has been written at that point:
  the daily rows are read but not yet stored. The row ends `failed_retry`, or `failed_final` after
  max attempts. Neither is `done`, so it never hides run 1's mark, and the reader is `done`-only.
  The retry re-reads the hold. The early return must stay inside the existing `try`/`finally` that
  closes the exchange.
- **Malformed mark.** Keep the reach floor only for this case: the claimed row's own mark at
  `:2564-2572`, or a malformed mark on the latest `done` row. `set_compute_job_seed_hold` refuses a
  bad floor with 22023, so this arm sees only hand-written or legacy data. One reach walk there
  replaces the malformed row with a clean `done` row.

```python
# trade_resume.load_strategy_seed_hold: make the malformed case distinguishable, e.g. return
# (None, None, True) for malformed, or a typed error string prefix the caller can test.
if _hold_err is not None and not _hold_malformed:
    logger.error("sync_trades: the seed-hold read failed for strategy %s (%s); failing this "
                 "attempt as transient so no done row hides an earlier mark", strategy_id, _hold_err_cls)
    return DispatchResult(outcome=DispatchOutcome.FAILED, error_kind="transient",
                          error_message="seed-hold read failed")
```

**Tests to change:**
- **Arm D:** assert that the intervening row ends FAILED (not `done`), and that run 2's walk start is
  at or before run 1's.
- **Arm B** keeps passing: run 1's mark stays visible.
- **`test_a_failed_hold_read_writes_the_reach_anchor`:** needs a dated intent-change note. There is
  no write now, and the run fails transient.
- **New arm:** a blip on a healthy set-column strategy must not move its seed. This is the probe-G
  control with a blip.

A bounded retry of the select only lowers the odds. It is not a root-cause fix.

## Info

### IN-R2-01: Arm D could assert on the intervening run alone

**File:** `analytics-service/tests/test_seedhold_bound.py:589-601`

**Issue:** `min(mid_walk, r2_walk) <= run1_walk` is honest: it was RED pre-fix, and its setup gives the
intervening run a complete read. But it is looser than what the code does. Probe D2 shows
`mid_walk <= run1_walk` on all five shapes.

**Fix:** Assert `_two_run_walk_start_ms(mid.out) <= _run1_walk_ms(venue, state)`, so a future change
that drops the floor and happens to walk run 2 back cannot pass. This is moot if WR-R2-01's fix
lands, because arm D then changes shape.

### IN-R2-02: `order("claimed_at", desc=True)` sorts NULLs first

**File:** `analytics-service/services/trade_resume.py:235`

**Issue:** postgrest-py 2.28.3 adds no nulls modifier when `nullsfirst` is `None`. Postgres DESC
defaults to NULLS FIRST, so a `done` sync row with NULL `claimed_at` would outrank every real one. No
write path produces such a row (Summary). Existing rows were not measured.

**Fix:** `.order("claimed_at", desc=True, nullsfirst=False)`. The fake's `order()` signature needs
the kwarg too.

### IN-R2-03: Text the fix left stale

**File:**
- `analytics-service/services/trade_resume.py:222-223, :257`
- `analytics-service/services/job_worker.py:2310-2311`
- `analytics-service/tests/test_seedhold_bound.py:106`

**Issue:**
- The docstring still says the caller's seed-hold write "carries min(reach anchor, seed)".
- The ERROR log still says "failing OPEN to no hold term for this fills read". The caller now floors
  the seed at the reach, so an operator chasing a reach over-fetch reads the opposite of what
  happened.
- The `_hold_read_failed` comment describes the old floor.
- PROOF-01 neuter **H5** names `min(_reach_anchor_ms, _provisional_unread_ms)`, an expression that no
  longer exists. The equivalent neuter now is deleting `_hold_terms.append(_reach_anchor_ms)`
  (`job_worker.py:2581`).

**Fix:** Reword the three comments and the log line. Re-point H5 at the append, with a dated note.

### IN-R2-04: The reach floor taken at the intervening run's clock is later than a first-sync mark by the elapsed time (IN-06, carried)

**File:** `analytics-service/services/job_worker.py:2576-2581`

**Issue:** Run 1's first-sync mark is ITS reach anchor. The floor is the intervening run's reach
anchor, later by the time between the runs. Only on Bybit is that slice still servable, because its
history is 730 days against a 365-day anchor. The arm-D fixtures pin one clock for every run, so they
cannot see it.

**Fix:** None required (as IN-06).

### IN-R2-05: A hold-blip run always raises the venue clamp flag

**File:** `analytics-service/services/job_worker.py:2576-2581`; `services/exchange.py:2982-2995`, `:3477-3486`

**Issue:** The floor is the reach anchor taken before the read. Binance's reader takes its own reach
later, and OKX's `begin` floor is three calendar months plus a day, which is younger than 93 days. So
every such run records `binance_fills_reach_clamped` or `okx_fills_reach_clamped`. Both are
non-holding and neither has a reader under `src/`.

**Fix:** None required. Moot under WR-R2-01's fix.

---

_Reviewed: 2026-11-28T11:31:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
