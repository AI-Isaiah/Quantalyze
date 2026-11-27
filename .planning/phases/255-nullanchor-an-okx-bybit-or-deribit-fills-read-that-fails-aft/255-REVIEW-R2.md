---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
round: 2
reviewed: 2026-11-27T11:22:11Z
reviewed_at_sha: 2ca2bcf2d1272dbd381d0841fb07f16d4b7d203f
diff_base: f29793522
depth: deep
scope_note: focused on the three review-fix commits
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_exchange.py
findings:
  critical: 1
  warning: 2
  info: 4
  total: 7
severity_breakdown:
  critical: 0
  high: 1
  medium: 2
  low: 2
  info: 2
status: issues_found
---

# Phase 255: Code Review, Round 2 (review-fix commits)

**Scope.** `git diff f29793522 HEAD -- analytics-service`. The three fix commits are `e7aaa4280`
(SFH-M1, OKX stuck cursor), `7927e48a2` (WR-01, Bybit read deadline) and `bf1ed172f` (WR-02, OKX
`begin` clamp to 89 days). Callers and the worker epilogue were traced in
`analytics-service/services/job_worker.py`, at HEAD and at the phase base `45d7b4e5c`.

**Severity scale.** The tier mapping is the same as round 1: CRITICAL and HIGH go to `critical`,
MEDIUM to `warning`, LOW and INFO to `info`. The project acts on MEDIUM and above.

**`critical: 1` is R2-CR-01, which is UNVERIFIED and PRE-EXISTING** (it dates from audit H-0665,
2026-05). None of the three fix commits introduced it. It is not a fix-round defect of this round,
and it should be routed or probed on its own merits, not fed into a fixer round automatically.

**Necessity.** No `necessity:` count is given. The necessity reference was not read for this
focused round, so no finding is classified on that axis.

## Verdict per question

| Q | Answer |
|---|---|
| 1. Does each fix close its finding without a new MEDIUM+? | **SFH-M1: yes.** **WR-01: partly.** The failure is now named for the common case, but the wedge is unbooked and the heavy first sync round 1 named can still be cancelled (R2-WR-02). **WR-02: no.** The fix introduces a MEDIUM data-integrity regression (R2-WR-01). |
| 2. Does the 89-day clamp silently lose the 89-92 day band? | **Yes, proven on the real worker** (probe below). The run completes, R6 clears the bound under `-infinity`, the cursor advances and `phase2_recovered_at` is stamped. Before Phase 255 the worker already sent unclamped `begin` values older than 3 months from stale seeds (code-proven; PROD exercise not measured). **No option is safe without the venue probe.** An unclamped `begin` also fails silently, and loses far more, if OKX answers an old `begin` with an empty list (proven below). **Recommendation: keep the clamp for now, name it with a non-holding DQ flag when it bites, and let the probe decide the floor.** |
| 3. WR-01 side effects on `run_reconcile_strategy_job` | **No MEDIUM+.** See IN-R2-03. |
| 4. SFH-M1 false truncation on a legitimate last page? | **No.** The `len(data) < 100` arm comes before both stuck arms, so a short final page is still a natural stop with or without a cursor. An empty page is still a natural stop. One fail-safe edge is LOW (IN-R2-01). A related pre-existing seam is **not** covered (R2-CR-01). |

## Critical Issues

### R2-CR-01: HIGH (UNVERIFIED, PRE-EXISTING, not introduced by the fixes): the OKX fills pager sends `after=<tradeId>`, but the venue documents `after` as a `billId` cursor, and the likely failure is an empty page 2 that reads as a natural end

**Data-integrity:** yes. **User-facing:** yes, through fills, positions and trade volume.
**File:** `analytics-service/services/exchange.py`, in `_fetch_raw_trades_okx_inst_type`
(`new_cursor = data[-1].get("tradeId", "")`, then `params["after"] = cursor`).

**Evidence.**
- The round-1 fixer read the OKX v5 page on 2026-11-27 (255-REVIEW-FIX.md, "Observations"). It
  documents `after` as "Pagination of data to return records earlier than the requested billId".
- ccxt 4.5.x `okx.fetch_my_trades`, which uses the same endpoint, carries `# 'after': billId,`.
  Its sample row shows `billId: "317321390265368576"` (18 digits) beside `tradeId: "107601752"`
  (9 digits).
- Phase 167.2.1.1.2.1 RESEARCH assumption A8 recorded the same mismatch and set it aside, because
  that phase paged by `end`.

**Why it matters here.** Suppose OKX reads the sent number as a `billId`. A 9-digit tradeId is far
below every real billId, so page 2 asks for "records earlier than billId 107601752" and the likely
answer is empty. `if not data: natural_break = True` then ends the instType walk as COMPLETE after
its newest 100 fills. That gives no flag, an R6 clear of the bound, and a cursor advanced to the
newest fill. The fills older than the first page are never re-read. SFH-M1 catches only a FULL page
with a missing or repeated cursor, so it does not see this mode. It does catch the other plausible
mode, where OKX ignores the cursor and repeats page 1, and that is an improvement. The PROD probe
recorded in 167.2.1.1.2.1 RESEARCH found two OKX accounts returning exactly 100 fills over 89 days,
so first syncs and busy accounts reach page 2.

**What is not known.** How OKX actually answers `after=<tradeId>` has not been measured. The code
has paged this way since H-0665 (audit 2026-05-07).

**Fix.** Do one of these. (a) Run one read-only probe on an account with more than 100 fills in the
window: page 2 with `after=<last tradeId>` against `after=<last billId>`. (b) Switch the cursor to
the documented field: `new_cursor = data[-1].get("billId", "")`. Update
`TestG12BOkxCursorAndBegin` and the two SFH-M1 fixtures, which build pages from `tradeId`. This is
outside the three findings this round reviews. Route it with an owner if it is not fixed in this
phase.

## Warnings

### R2-WR-01: MEDIUM (introduced by `bf1ed172f`): the 89-day clamp silently drops the far edge of an OKX first-sync retry, then clears the re-read bound and marks the strategy recovered

**Data-integrity:** yes. **User-facing:** yes. The oldest fills of a newly connected OKX strategy are
missing, so position reconstruction can start mid-position, and the strategy reads as recovered.

**File:** `analytics-service/services/exchange.py:3260-3264`
(`since_ms = max(since_ms, _now_ms() - OKX_FILLS_BEGIN_FLOOR_DAYS * 86_400_000)`) and `:719`
(`OKX_FILLS_BEGIN_FLOOR_DAYS: int = 89`). The coverage claim is made in
`analytics-service/services/job_worker.py:2806-2818` (`_walk_start_ms`, `_covers_from_iso`). The
clear is the epilogue `_set_bound(_unread_from_ms, _covers_from_iso)` (`:3109`).

**Mechanism (traced).**
1. Run 1 is an OKX first sync and its fills read fails. The provisional bound is
   `now1 - 93 d` (`OKX_FILLS_REACH_DAYS`).
2. Run 2 seeds from that bound. The worker computes `_walk_start_ms = seed - 1 h` and
   `_covers_from_iso = "-infinity"`, because the walk start is at or before run 2's reach anchor.
   Both are computed from the SEED, never from the `begin` the reader actually sent.
3. The reader clamps the sent `begin` to `now2 - 89 d`, so nothing in `[seed - 1 h, now2 - 89 d)`
   is requested.
4. The read returns cleanly, with no `sync_truncated_*` flag and no raise. `_earliest_through()`
   is `None`, so the RPC takes R6 (`-infinity <= stored bound`) and deletes the bound. The cursor
   advances to the newest fill. No flag names the clamp. Compare Binance's non-holding
   `binance_fills_reach_clamped`.

**Proof on the real worker.** This was a scratch pytest, not committed. It used the plan-01
harness, the real `fetch_raw_trades` → `_fetch_raw_trades_okx`, and the real
`run_sync_trades_job` through `tests/test_okxtrades_cursor.py::_run_job`, with the clock pinned at
2026-07-15T12:00Z. The fake OKX holds a fill 90 days old and one 10 days old, and serves rows at or
after `begin`. The output is annotated: the `#` comments were added and the timestamp is elided.

```
sent begins: {'1776427200000'}                       # 2026-04-17T12:00Z, the 89-day floor
fills ts: ['2026-07-05T12:00:00+00:00'] flags: {}    # the 90-day fill was never requested
run2 since_ms: 1776081599999 anchor: 1776081600000   # seeded from run 1's 93-day bound
bounds after run 2: {}                               # R6 cleared the bound
advance: 2026-07-05T12:00:00+00:00                   # the cursor moved past the band
dq flags stamped: {'phase2_recovered_at': '...'}     # and the strategy reads as recovered
UNCLAMPED sent begins: {'1776078000000'} fills: ['2026-07-05T12:00:00+00:00', '2026-04-16T12:00:00+00:00']
2 passed
```

The `UNCLAMPED` arm is the same reader with `OKX_FILLS_BEGIN_FLOOR_DAYS` monkeypatched out. It sends
`begin = seed - 1 h`, which is 93 d + 1 h back, and returns the band fill.

**Size of the loss.** The lost band runs from 89 days back to whatever OKX really serves. Three
calendar months is 89 to 92 days, depending on the month: 92 on 2026-11-27, 89 only for a window
over February to April of a common year. So on most dates 1 to 3 days at the far edge are lost. A
CLEAN first sync sends no `begin` and walks the venue's whole window, so this is strictly less
history than the run-1 success that the retry stands in for. The trigger is narrow (a failed OKX
first sync, or any seed older than 89 days), but it is the exact scenario Phase 255 exists to make
lossless.

**Was this a regression against sending the older `begin`?** Yes, if OKX honours an old `begin`
(A1 true), which is the premise the codebase already ran on. If OKX answers it with an empty list,
the clamp is the SAFER choice (see the options table):
- **Before Phase 255 the worker sent unclamped `begin` values older than 3 months in normal
  operation.** At the phase base `45d7b4e5c`, `exchange.py:3063` sends `params["begin"] =
  str(since_ms)` with no floor, and has done so since v0.10.0.0. `job_worker.py:2435-2444` seeds a
  set column from `min(column, newest stored fill)`. Any connected OKX strategy whose newest stored
  fill (and column) is more than about 92 days old therefore sent a `begin` past the documented
  reach on every run. RESEARCH A1 ("Today's worker already sends unclamped old `begin` values from
  stale columns") holds by code.
- **Whether any PROD strategy is in that state is UNMEASURED** in this review, which had no PROD
  read path. The query that would settle it: OKX strategies whose newest `trades` row with
  `is_fill` is more than 93 days old and whose `strategy_analytics.data_quality_flags` carries no
  `phase2_fill_ingestion_failed`. ⚠️ That query can rule out only the ERROR mode of a false A1.
  A stale seed in normal operation means a dormant account, which has nothing in the band to
  return, so an empty answer and an honoured `begin` look the same there. It cannot rule out the
  empty-answer mode below.
- Analogy only, since it is a different endpoint: the OKX bills walk (`exchange.py:1914-1925`, then
  `_okx_bills_window_read`) sends `begin` at the UTC day floor of `now - 93 d` to the
  "last 3 months" bills archive on every daily read.

**How the fix diverged from round 1.** Round 1 proposed a clamp at `OKX_FILLS_REACH_DAYS` (93), and
only "if OKX errors" after the read-only probe. Its "lossless" claim rested on the clamp sitting at
or beyond the venue's reach. The fix used 89 days, applied it without the probe, and read the docs
only, which do not settle A1. The 89 is what broke the losslessness premise.

**Options, judged by what happens when each one's venue premise is false.** A false A1 can take
two forms: OKX ERRORS on an old `begin`, or it answers with an EMPTY list.

| Option | Premise | A1 false, error mode | A1 false, empty mode | A1 true |
|---|---|---|---|---|
| Keep the 89-day clamp | OKX serves no more than 89 days | not reached | not reached | **1 to 3 days lost silently** (proven above) |
| Revert the clamp, or clamp at 93 days (93 d + 1 h is already past 92 d) | A1 | every run raises, the bound is kept, the flag is stamped: loud, nothing lost | **the whole ~93-day span is lost silently** (proven below) | lossless |
| Send no `begin` when the seed is at or before the floor | a begin-less paged walk reaches the whole window, as the first sync assumes | not reached | not reached | lossless, unless the H-0666 comment ("without it OKX falls back to its default window (often 7 days) on pages 2+") is right, which contradicts RESEARCH line 237 and is unresolved |

**Empty-mode proof (revert).** The same scratch harness, with the clamp patched out and a fake OKX
that returns `[]` for any `begin` older than 92 days. The output is annotated: the timestamp is
elided.

```
EMPTY-MODE run1 stamp: None | run2 column: None | fills: [] | bounds after run 2: {} |
  run2 advance: None | dq: {'phase2_recovered_at': '...'}
```

Run 1 (a failed OKX first sync) stamps nothing, because only Binance gets the NULL-column reach
stamp. Run 2's clean empty read clears the bound under `-infinity` and leaves the column NULL. Run 3
then seeds from the daily high-water, and the span is gone. That is exactly the loss Phase 255
fixes. So revert's worst case is the full span, and the clamp's worst case is about 3 days.

**Fix (probe-gated; supersedes round 1's "lossless" clamp claim).**
1. **Run the read-only probe before choosing a floor**, on an OKX account that HAS fills in the
   window, ideally inside the 89 to 93 day band, so that an empty answer can be told apart from an
   honoured `begin`. Compare `begin = now - 94 d` with `begin = now - 89 d` and with no `begin`. The
   founder's authorised PROD-read path applies.
2. **Until then, keep the 89-day clamp**, the only option whose worst case is bounded, and make it
   VISIBLE. When the clamp bites (`since_ms` raised), call
   `_record_dq_flag("okx_fills_reach_clamped", True)`. Keep it non-holding, like Binance's
   `binance_fills_reach_clamped`, so a dropped far edge is named on the strategy instead of stamped
   `phase2_recovered_at`. Book the ≤3-day limit in the CHANGELOG entry and TODOS with the probe as
   its trigger.
3. **After the probe.** If OKX serves the band, raise the floor to the measured edge, or revert.
   If it errors or answers empty, keep the clamp at the measured edge. Any floor below OKX's real
   reach must keep the epilogue honest about what was READ, never only what was seeded: either
   compute `_covers_from_iso` from the `begin` actually sent, or keep the flag above.

### R2-WR-02: MEDIUM (WR-01 not closed for the keys it named): the Bybit deadline makes most long reads complete loudly, but the wedge is unbooked, and the 840 s clock starts after an unbounded Phase 1

**User-facing:** yes (liveness). **Data-integrity:** no (no span is skipped).
**File:** `analytics-service/services/exchange.py:3338-3343` (the deadline is taken at reader entry)
and `analytics-service/services/job_worker.py:2368` (`fetch_all_trades(ctx.exchange,
since_ms=daily_since_ms)`, with no `read_deadline_s`), `:2679` (`BINANCE_SYNC_FILLS_READ_DEADLINE_S`
= 840) and `:1071` (`"sync_trades": 15 * 60`).

**Issue.**
- **(a) No progress, and nothing booked.** The fixer says so plainly: each deadline refusal re-reads
  the same span. Under RPC R4 each refusal also LOWERS the bound by 1 h + 1 ms (`walk_start - 1`).
  The cancel this replaces left the provisional row at the seed. So the span grows with every
  failed run, and over enough runs a 365-day seed creeps toward Bybit's 730-day `start_too_old`
  line. Round 1 asked for one of two things: "route it" (a TODOS entry plus a founder decision) or
  the read-through root fix. Neither is done. `TODOS.md` carries no 255 entry for it at HEAD.
- **(b) The 840 s budget assumes the pre-read work fits in about 60 s, and for a heavy Bybit first
  sync that is unmeasured.** The 840 s budget was sized for Binance; `BINANCE_SYNC_FILLS_READ_DEADLINE_S`'s
  own comment names the 60 s remainder as the room for "the daily read, the high-water reads …".
  On a Bybit first sync (`daily_since_ms` None), Phase 1's `fetch_all_trades` walks 365 days of
  closed PnL in seven-day windows: at least 53 requests, and the measured busiest week was 44 pages
  at about 0.5 s a page. That is at least about 27 s, and plausibly 60 s or more for a heavy key,
  with no deadline. Add the balance read, the Phase-1 store, at most one in-flight request (ccxt's
  10 s timeout) and the epilogue writes. 840 s of fills reading can then still overrun 900 s, and
  `wait_for` cancels before the epilogue. That is the exact case round 1 named first ("A first sync
  for a heavy new Bybit key"). The new tests drive a fake reader clock from zero, so they cannot see
  this.

**Fix.** (a) Book it now, with an owner, a trigger and the R4 creep stated, as a founder decision
next to `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`. Alternatively build the read-through root fix
round 1 described. (b) Give the Bybit read the handler's REMAINING budget rather than a fixed 840.
Take a monotonic stamp at handler entry and pass
`read_deadline_s=max(0.0, BINANCE_SYNC_FILLS_READ_DEADLINE_S - (monotonic() - handler_start))` on
the Bybit branch. Otherwise measure Bybit's Phase-1 time on the heaviest PROD key and record it
beside the constant.

## Info

### IN-R2-01: LOW: SFH-M1 holds for ever if OKX ever ends a FULL final page on a row with an empty `tradeId`

**File:** `analytics-service/services/exchange.py:3221-3234`. A legitimate last page of exactly 100
rows whose last row has no `tradeId` is now an incomplete read on every run: the bound is kept, the
cursor held, and the bound creeps 1 h a run. This fails safe (re-reads, never loses), and OKX
documents `tradeId` on every fill. A short or empty final page is unaffected.

### IN-R2-02: LOW: a narrow band of Bybit reads that completed before WR-01 now refuses on every run

**File:** `analytics-service/services/exchange.py:3338-3343`. A fills read of 840 s up to roughly
`900 - pre-read - tail` seconds used to finish inside the handler and advance the cursor. It now
refuses at 840 s. Because the span then grows (see R2-WR-02 (a)), it refuses again on every later
run. This is the trade the founder accepted for Binance (840 / 900), now applied to Bybit with no
Bybit measurement.

### IN-R2-03: INFO: Q3, the reconcile side effect is not MEDIUM+

**File:** `analytics-service/services/job_worker.py:16257` (`fetch_raw_trades(..., since_ms=since_ms)`
with the 240 s default), `:1348` (a timeout is `transient`), `:1461-1464` (`"deadline"` is not in the
permanent set, so it is `unknown`) and `:4372-4375` (`transient` and `unknown` retry on the same
budget and render the same user sentence).
- **Reachability.** The span is 24 h plus the 1 h overlap, which is ONE seven-day window, capped at
  `BYBIT_EXECUTION_WINDOW_PAGE_CAP` (200) pages. Passing 240 s needs more than 1.2 s per request at the cap.
  That is unlikely. A read of 240 to 300 s, which used to finish inside the old 300 s `wait_for`,
  now refuses (the same narrow band as IN-R2-02), and it is retried.
- **Outcome.** A timeout used to give `transient` and a retry. A deadline refusal now gives
  `unknown` and a retry on the same budget. The portfolio `sync_failure` alert fires only from
  step 5 on a non-clean REPORT (`:16448`), never on a raised fetch, so neither path alerts.
- `scripts/bybit_reconcile.py:623` also inherits the 240 s default. Its fills window is clamped to
  `BYBIT_EXECUTION_RETENTION_DAYS` (about 7 days, one window), so the same bound holds. It is an
  operator script with no handler timeout. Before this commit it was unbounded.

### IN-R2-04: INFO: cosmetic, `sync_truncated_okx_pages` reports 100 for a stuck-cursor stop

**File:** `analytics-service/services/exchange.py:3275-3282`. The fixer noted it already. The stop
is now recorded through the page-cap path, so the page count and the "hit page cap" WARNING are
round numbers, not the real page count. The flag itself is right.

## What holds (verified)

- **SFH-M1** (`e7aaa4280`). The order is empty page, then short page (`< 100`), then the stuck arms,
  so only a FULL page with a missing or repeated cursor flips to `natural_break = False`. The flag
  then reaches the worker as `sync_truncated_okx`, which drives `_fills_incomplete` (cursor held)
  and `_earliest_through()` (bound kept). The new tests run the real reader into the real worker,
  and the recorded neuter output shows all four RED.
- **WR-01** (`7927e48a2`). The check runs before EVERY request, including the first. The deadline
  is taken after the `start_too_old` refusal. `None` means no deadline, so
  `services/ingestion/bybit.py:79` is unchanged. In `run_sync_trades_job` the refusal is caught by
  Phase 2's `except Exception`: the provisional bound is kept, `phase2_fill_ingestion_failed` is
  stamped, the cursor is held and the job completes. No caller reads `exc.reason` except
  `classify_exception`.
- **WR-02** (`bf1ed172f`). The two re-based `test_exchange.py` arms keep their assertions byte for
  byte, and their seeds now sit inside 89 days. Whatever is decided about the clamp, nothing there
  was weakened.

---

_Reviewed: 2026-11-27T11:22:11Z_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: deep (focused)_
